const os = require('os');
const fs = require('fs');
const path = require('path');

// Vá lỗi yt-search thiếu tiêu đề
try {
  const ytSearchDist = path.join(__dirname, '../../node_modules/yt-search/dist/yt-search.js');
  if (fs.existsSync(ytSearchDist)) {
    let code = fs.readFileSync(ytSearchDist, 'utf8');
    let changed = false;
    if (code.includes('title: title.trim()')) {
      code = code.replace(/title:\s*title\.trim\(\)/g, 'title: (typeof title === "string" ? title.trim() : "")');
      changed = true;
    }
    if (code.includes('_title.trim()')) {
      code = code.replace(/_title\.trim\(\)/g, '(_title || "").trim()');
      code = code.replace(/_title2\.trim\(\)/g, '(_title2 || "").trim()');
      code = code.replace(/_title3\.trim\(\)/g, '(_title3 || "").trim()');
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(ytSearchDist, code, 'utf8');
    }
  }
} catch (e) {}

const ytdlp = require('yt-dlp-exec');
const play = require('play-dl');
const yts = require('yt-search');
const fetch = globalThis.fetch || require('node-fetch');

const audioCacheManager = require('../structures/AudioCacheManager');
const historyManager = require('../structures/HistoryManager');
const settingsManager = require('../structures/SettingsManager');
const { executeSearch } = require('./searchService');

// Nạp các module con từ providers/audio
const {
  getCookiesFile,
  YTDLP_EXTRACTOR_ARGS,
  PrioritySemaphore,
  extractionSemaphore,
  streamUrlCache,
  MAX_STREAM_CACHE_SIZE,
  getCachedStreamUrl,
  setCachedStreamUrl,
  resolveDirectStreamUrl,
  isYouTubeCircuitOpen,
  recordYouTubeFailure,
  recordYouTubeSuccess,
  activeProcesses,
  registerProcess,
  killProcess,
  cleanupAllProcesses
} = require('../providers/audio/SemaphoreManager');

const {
  VI_DIACRITIC_REGEX,
  HANGUL_REGEX,
  KANA_REGEX,
  HANZI_REGEX,
  ANY_CJK_REGEX,
  OTHER_NON_LATIN_REGEX,
  YT_LOCALIZATION_NOISE_REGEX,
  VN_ARTISTS_NORM_REGEX,
  INTL_ARTISTS_REGEX,
  KPOP_ARTISTS_REGEX,
  JPOP_ARTISTS_REGEX,
  CPOP_KEYWORDS_REGEX,
  VN_SYLLABLE_TOKEN_REGEX,
  VN_PHONETIC_CLUSTER_REGEX,
  COMMON_EN_TOKEN_REGEX,
  VPOP_SIMILAR_ARTISTS_POOL,
  NON_MUSIC_BLACKLIST_REGEX,
  EXTRACTOR_INSTRUMENT_NORM_REGEX,
  EXTRACTOR_INSTRUMENT_RAW_REGEX,
  EXTRACTOR_OTHER_VARIANT_NORM_REGEX,
  EXTRACTOR_KARAOKE_NORM_REGEX,
  normalizeSearchText,
  parseDurationToSec,
  stripYoutubeNoise,
  hasVietnameseAccentlessPattern,
  isVuArtist,
  detectTrackRegion,
  extractCleanArtistAndTitle,
  analyzeTrackOriginAndMeta,
  resolveTrackOriginAndMetaAsync,
  isCandidateMatchingRegion,
  buildAutoplayFallbackQueries
} = require('../providers/audio/AppleMusicExtractor');

const {
  formatMs,
  DEFAULT_FALLBACK_THUMB,
  spotifyUrlInfo,
  getSpotifyApiToken,
  fetchSpotifyPlaylistFull,
  enrichSpotifyTracksWithThumbnails
} = require('../providers/audio/SpotifyExtractor');

const {
  ffmpeg,
  ALLOWED_MUSIC_HOSTNAMES,
  parseViews,
  stripYouTubeTranslatedLabels,
  isLiveStageVideo,
  scoreCandidateVideo,
  resolveBestThumbnail,
  parseArtistAndTitle,
  ensureSoundCloudAuth,
  extractSoundCloudTitleFromUrl,
  validateAndSanitizeMusicUrl,
  isSafeExternalUrl,
  isTrackInHistory,
  createDirectFfmpegStream,
  createDirectFileStream,
  createCachedFfmpegStream,
  createSingleStream,
  createSoundCloudFailoverStream,
  fetchInnerTubeMix,
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack
} = require('../providers/audio/YoutubeExtractor');

/**
 * Kiểm tra an toàn chống SSRF và Argument Injection cho URL âm nhạc
 */
function isSafeMusicQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const trimmed = query.trim();
  if (trimmed.startsWith('-')) return false;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();
      const allowedDomains = [
        'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
        'youtu.be',
        'open.spotify.com', 'spotify.link',
        'soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com'
      ];
      if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|localhost|::1)/.test(hostname)) {
        return false;
      }
      return allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch (e) {
      return false;
    }
  }
  return true;
}

/**
 * Tìm kiếm và trích xuất thông tin bài hát / Playlist từ YouTube, Spotify, SoundCloud
 */
async function searchTrack(query, targetDurationSec = 0) {
  try {
    if (!query || typeof query !== 'string') return null;

    let cleanQuery = query.trim().slice(0, 150).trim();
    if (cleanQuery.startsWith('-')) return null;

    if ((cleanQuery.includes('spotify.com/') || cleanQuery.startsWith('spotify:')) && !/^https?:\/\//i.test(cleanQuery)) {
      cleanQuery = 'https://' + cleanQuery;
    }

    if (/^https?:\/\//i.test(cleanQuery)) {
      const sanitizedUrl = validateAndSanitizeMusicUrl(cleanQuery);
      if (!sanitizedUrl) {
        console.warn(`[Security Alert: SSRF / Invalid Hostname Blocked] URL không an toàn bị từ chối: ${cleanQuery}`);
        return null;
      }
      cleanQuery = sanitizedUrl;
    }

    query = cleanQuery;

    // 1. Xử lý Playlist / Album Spotify (Giới hạn tối đa 100 bài)
    if (cleanQuery.includes('spotify.com/playlist/') || cleanQuery.includes('spotify.com/album/')) {
      try {
        let defaultCover = null;
        let playlistTitle = null;
        try {
          const details = await spotifyUrlInfo.getDetails(cleanQuery);
          defaultCover = details?.preview?.image || null;
          playlistTitle = details?.preview?.title || null;
        } catch (e) {
          try {
            const data = await spotifyUrlInfo.getData(cleanQuery);
            defaultCover = data?.coverArt?.sources?.[0]?.url || null;
            playlistTitle = data?.name || data?.title || null;
          } catch (e2) {}
        }

        const spotifyTracks = await spotifyUrlInfo.getTracks(cleanQuery);
        if (spotifyTracks && spotifyTracks.length > 0) {
          const limited = spotifyTracks.slice(0, 100).map((item, idx) => {
            const artistName = item.artist || item.artists?.[0]?.name || '';
            const rawTitle = (item.name || item.title || `Bài hát #${idx + 1}`).trim();
            const title = artistName && !rawTitle.includes(artistName) ? `${rawTitle} - ${artistName}` : rawTitle;
            const spotifyId = item.id || (item.uri ? item.uri.replace('spotify:track:', '').split('?')[0] : null);
            const spotifyUrl = item.external_urls?.spotify || (spotifyId ? `https://open.spotify.com/track/${spotifyId}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`);
            const spotifyDurSec = item.duration ? Math.round(item.duration / 1000) : 0;
            return {
              title: title,
              artist: artistName,
              url: spotifyUrl,
              searchQuery: `${title}`,
              duration: formatMs(item.duration),
              durationMs: item.duration || 0,
              spotifyDurationSec: spotifyDurSec,
              thumbnail: defaultCover || DEFAULT_FALLBACK_THUMB,
              uri: item.uri,
              source: 'spotify',
              isLive: false,
              playlistTitle: playlistTitle || 'Spotify Playlist',
              playlistThumbnail: defaultCover || DEFAULT_FALLBACK_THUMB
            };
          }).filter(t => t.title && t.title.trim() !== '');

          enrichSpotifyTracksWithThumbnails(limited, defaultCover).catch(() => {});
          return limited;
        }
      } catch (spErr) {
        console.warn('[Spotify Playlist extraction error]:', spErr.message);
      }
    }

    // 2. Xử lý Single Track Spotify
    if (cleanQuery.includes('spotify.com/track/')) {
      try {
        let trackThumb = null;
        const trackId = cleanQuery.split('/track/')[1]?.split('?')[0];
        if (trackId) {
          try {
            const oRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
            if (oRes.ok) {
              const oData = await oRes.json();
              trackThumb = oData.thumbnail_url;
            }
          } catch (e) {}
        }

        const trackData = await spotifyUrlInfo.getData(cleanQuery);
        if (trackData && trackData.name) {
          const artistName = trackData.artists?.[0]?.name || trackData.artist || '';
          const title = artistName ? `${trackData.name} - ${artistName}` : trackData.name;
          const spotifyDurSec = trackData.duration ? Math.round(trackData.duration / 1000) : (trackData.duration_ms ? Math.round(trackData.duration_ms / 1000) : 0);
          let results = await searchTrack(title, spotifyDurSec);
          if (!results || results.length === 0) {
            results = await searchTrack(`${title} Audio`, spotifyDurSec);
          }
          if (results && results.length > 0) {
            if (trackThumb) {
              results[0].thumbnail = trackThumb;
            }
            results[0].source = 'spotify';
            results[0].spotifyDurationSec = spotifyDurSec;
            return results;
          }
        }
      } catch (spTrackErr) {
        console.warn('[Spotify Track extraction error]:', spTrackErr.message);
      }
    }

    // 3. Xử lý Playlist YouTube (Giới hạn tối đa 100 bài)
    if (query.includes('youtube.com/playlist') || (query.includes('youtube.com/watch') && query.includes('list='))) {
      try {
        const plOpts = {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
          yesPlaylist: true,
          noWarnings: true,
          httpChunkSize: '10M',
          bufferSize: '64K'
        };
        const cFile = getCookiesFile();
        if (cFile) plOpts.cookies = cFile;
        const res = await ytdlp(query, plOpts);

        if (res && res.entries && res.entries.length > 0) {
          const playlistTitle = res.title || 'YouTube Playlist';
          const playlistThumb = resolveBestThumbnail(res);
          const limited = res.entries.slice(0, 100);
          return limited.map((e) => {
            const trackUrl = e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
            const safeTitle = (e.title || e.name || '').trim();
            const dur = e.duration ? (typeof e.duration === 'string' ? e.duration : `${Math.floor(e.duration / 60)}:${String(Math.floor(e.duration % 60)).padStart(2, '0')}`) : '3:30';
            return {
              title: safeTitle,
              url: trackUrl,
              searchQuery: safeTitle,
              duration: dur,
              thumbnail: resolveBestThumbnail(e),
              isLive: false,
              playlistTitle: playlistTitle,
              playlistThumbnail: playlistThumb || DEFAULT_FALLBACK_THUMB
            };
          }).filter(t => t.url && t.title && !['[private video]', '[deleted video]'].includes(t.title.toLowerCase()));
        }
      } catch (ytErr) {
        console.warn('[YouTube Playlist extraction error]:', ytErr.message);
      }
    }

    // 4. Xử lý SoundCloud (Bài đơn & Playlist - Giới hạn 100 bài)
    if (query.includes('soundcloud.com')) {
      try {
        await ensureSoundCloudAuth();
        const scData = await play.soundcloud(query);

        if (scData && scData.type === 'playlist') {
          const allTracks = await scData.all_tracks();
          const limited = allTracks.slice(0, 100);
          const playlistTitle = scData.name || scData.title || 'SoundCloud Playlist';
          const playlistThumb = scData.thumbnail || null;
          return limited.map(track => ({
            title: track.name || 'SoundCloud Track',
            url: track.permalink || track.url || query,
            duration: track.durationInMs ? formatMs(track.durationInMs) : '3:30',
            thumbnail: track.thumbnail || null,
            isLive: false,
            playlistTitle: playlistTitle,
            playlistThumbnail: playlistThumb
          }));
        }

        if (scData && scData.name) {
          return [{
            title: scData.name,
            url: scData.permalink || scData.url || query,
            duration: scData.durationInMs ? formatMs(scData.durationInMs) : '3:30',
            thumbnail: scData.thumbnail || null,
            isLive: false
          }];
        }
      } catch (scErr) {
        console.warn('[SoundCloud play-dl error, falling back to yt-dlp]:', scErr.message);
      }

      try {
        const info = await ytdlp(query, {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
          noWarnings: true
        });

        if (info.entries && Array.isArray(info.entries) && info.entries.length > 0) {
          const limited = info.entries.slice(0, 100);
          return limited.map(item => {
            let trackTitle = item.title || item.name;
            if (!trackTitle || trackTitle === 'SoundCloud Track') {
              trackTitle = extractSoundCloudTitleFromUrl(item.url || item.webpage_url);
            }
            return {
              title: trackTitle,
              url: item.url || item.webpage_url || query,
              duration: item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '3:30',
              thumbnail: item.thumbnail || info.thumbnail || null,
              isLive: false
            };
          });
        }

        let singleTitle = info.title;
        if (!singleTitle || singleTitle === 'SoundCloud Track') {
          singleTitle = extractSoundCloudTitleFromUrl(info.webpage_url || query);
        }

        return [{
          title: singleTitle,
          url: info.webpage_url || query,
          duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}` : '3:30',
          thumbnail: info.thumbnail || null,
          isLive: false
        }];
      } catch (ytdlpErr) {
        console.warn('[SoundCloud yt-dlp error]:', ytdlpErr.message);
      }
    }

    // 5. Xử lý đường dẫn Direct HTTP/HTTPS (File audio hoặc Livestream)
    if (query.startsWith('http://') || query.startsWith('https://')) {
      const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (ytMatch && ytMatch[1] && !query.includes('list=')) {
        const videoId = ytMatch[1];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const defaultThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        try {
          let cachedMeta = null;
          try {
            const { getCachedResults } = require('./searchService');
            const cachedList = getCachedResults(videoUrl) || getCachedResults(videoId);
            if (Array.isArray(cachedList) && cachedList.length > 0 && cachedList[0].url) {
              cachedMeta = cachedList[0];
            }
          } catch (e) {}

          if (cachedMeta) {
            return [{
              title: cachedMeta.title,
              url: videoUrl,
              duration: cachedMeta.duration || '3:30',
              thumbnail: cachedMeta.thumbnail || defaultThumb,
              artist: cachedMeta.artist || 'YouTube',
              isLive: Boolean(cachedMeta.isLive)
            }];
          }

          const oEmbedPromise = fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
            signal: AbortSignal.timeout(2000)
          }).then(res => res.ok ? res.json() : null).catch(() => null);

          const innerTubeClients = [
            {
              name: 'ANDROID_VR',
              version: '1.60.19',
              ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
              extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' }
            },
            {
              name: 'IOS',
              version: '20.03.02',
              ua: 'com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)',
              extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.2.1.22C161' }
            }
          ];

          let innerData = null;
          for (const cCfg of innerTubeClients) {
            try {
              const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': cCfg.ua
                },
                body: JSON.stringify({
                  videoId,
                  context: {
                    client: {
                      clientName: cCfg.name,
                      clientVersion: cCfg.version,
                      hl: 'vi',
                      gl: 'VN',
                      ...cCfg.extra
                    }
                  }
                }),
                signal: AbortSignal.timeout(2200)
              });
              if (res.ok) {
                const d = await res.json();
                if (d?.videoDetails?.videoId || d?.videoDetails?.lengthSeconds) {
                  innerData = d;
                  break;
                }
              }
            } catch (err) {}
          }

          const oembedData = await oEmbedPromise;
          const innerDetails = innerData?.videoDetails;

          try {
            const rawCaps = innerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (Array.isArray(rawCaps) && rawCaps.length > 0) {
              const { cacheYoutubeSubtitlesMeta } = require('./lyricsHelper');
              if (typeof cacheYoutubeSubtitlesMeta === 'function') {
                const subMap = {};
                const autoMap = {};
                for (const cap of rawCaps) {
                  if (!cap || !cap.baseUrl) continue;
                  const lang = cap.languageCode || 'und';
                  const vssId = String(cap.vssId || '');
                  const isAuto = cap.kind === 'asr' || vssId.startsWith('a.');
                  const nameText = cap.name?.runs?.map(r => r.text).join('') || cap.name?.simpleText || lang;
                  const entry = [{ ext: 'json3', url: cap.baseUrl + (cap.baseUrl.includes('?') ? '&fmt=json3' : '?fmt=json3'), rawUrl: cap.baseUrl, name: nameText, vssId, languageCode: lang, kind: cap.kind }];
                  const targetMap = isAuto ? autoMap : subMap;
                  const key = targetMap[lang] ? `${lang}_${vssId || Object.keys(targetMap).length}` : lang;
                  targetMap[key] = entry;
                }
                cacheYoutubeSubtitlesMeta(videoId, subMap, autoMap);
              }
            }
          } catch (capErr) {}

          const rawTitle = innerDetails?.title || oembedData?.title || '';
          const rawArtist = oembedData?.author_name || innerDetails?.author || 'YouTube';
          const cleanTitle = String(rawTitle).replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();
          const cleanArtist = String(rawArtist).replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();

          const safeTitle = cleanTitle || (cleanArtist && cleanArtist !== 'YouTube' ? `${cleanArtist} - Audio` : `Bài hát YouTube (${videoId})`);
          const safeArtist = cleanArtist || 'YouTube';

          let parsedDuration = '3:30';
          let durationSec = 210;
          if (innerDetails?.lengthSeconds) {
            const sec = parseInt(innerDetails.lengthSeconds, 10);
            if (!isNaN(sec) && sec > 0) {
              durationSec = sec;
              parsedDuration = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            }
          }

          return [{
            title: safeTitle,
            url: videoUrl,
            duration: parsedDuration,
            seconds: durationSec,
            ytDurationSec: durationSec,
            rawDurationSec: durationSec,
            thumbnail: defaultThumb,
            artist: safeArtist,
            isLive: Boolean(innerDetails?.isLiveContent)
          }];
        } catch (fastYtErr) {
          console.warn('[Fast YouTube single video fallback]:', fastYtErr.message);
          return [{
            title: `Bài hát YouTube (${videoId})`,
            url: videoUrl,
            duration: '3:30',
            thumbnail: defaultThumb,
            artist: 'YouTube',
            isLive: false
          }];
        }
      }

      try {
        const infoOpts = {
          dumpSingleJson: true,
          noWarnings: true,
          callHome: false,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true,
          httpChunkSize: '10M',
          bufferSize: '64K'
        };
        const cFile = getCookiesFile();
        if (cFile) infoOpts.cookies = cFile;
        let info = null;
        try {
          info = await ytdlp(query, infoOpts);
        } catch (initialErr) {
          if (infoOpts.cookies) {
            delete infoOpts.cookies;
            info = await ytdlp(query, infoOpts);
          } else {
            throw initialErr;
          }
        }
        try {
          const { cacheYoutubeSubtitlesMeta } = require('./lyricsHelper');
          if (typeof cacheYoutubeSubtitlesMeta === 'function' && info) {
            cacheYoutubeSubtitlesMeta(info.id || query, info.subtitles, info.automatic_captions);
          }
          if (info.url && typeof setCachedStreamUrl === 'function') {
            setCachedStreamUrl(info.webpage_url || query, info.url);
          }
        } catch (subErr) {}
        const cleanInfoTitle = String(info.title || '').replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();
        const cleanInfoUploader = String(info.uploader || '').replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();
        return [{
          title: cleanInfoTitle || (cleanInfoUploader ? `${cleanInfoUploader} - Audio` : (info.id ? `Bài hát không tên (${info.id})` : 'Audio Stream')),
          url: info.webpage_url || query,
          duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : 'Live Stream',
          thumbnail: info.thumbnail || null,
          artist: cleanInfoUploader || 'YouTube',
          isLive: Boolean(info.is_live)
        }];
      } catch (err) {
        console.warn('[yt-dlp info error, fallback to direct stream]:', err.message);
        return [{
          title: 'Direct Audio Stream',
          url: query,
          duration: 'Live Stream',
          thumbnail: null,
          isLive: true
        }];
      }
    }

    // 6. Tìm kiếm YouTube cho từ khóa qua Worker Thread
    try {
      const results = await executeSearch(cleanQuery, 5, 'official');
      if (results && results.length > 0) {
        return [results[0]];
      }
    } catch (workerSearchErr) {
      console.warn('[searchTrack executeSearch worker error, fallback play-dl]:', workerSearchErr.message);
    }

    try {
      const searchResults = await play.search(cleanQuery, { limit: 1, source: { youtube: 'video' } });
      if (searchResults && searchResults.length > 0) {
        const track = searchResults[0];
        return [{
          title: track.title,
          url: track.url,
          duration: track.durationRaw || '3:30',
          thumbnail: resolveBestThumbnail(track),
          artist: track.channel?.name || 'YouTube',
          isLive: Boolean(track.live)
        }];
      }
    } catch (pErr) {}

    return null;
  } catch (error) {
    console.error('Error in searchTrack:', error);
    return null;
  }
}

/**
 * Trích xuất luồng âm thanh theo kiến trúc Failover 3 tầng có tích hợp Circuit Breaker
 */
async function _doCreateResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0, options = {}) {
  let targetUrl = typeof trackItem === 'string' ? trackItem : (trackItem.url || trackItem.searchQuery);
  const trackTitle = typeof trackItem === 'object' ? (trackItem.title || trackItem.searchQuery) : trackItem;

  const isSpotifyUrl = typeof targetUrl === 'string' && targetUrl.includes('spotify.com');
  if (!targetUrl || isSpotifyUrl || (!targetUrl.startsWith('http') && trackItem.searchQuery)) {
    try {
      const searchTarget = trackItem.searchQuery || trackItem.title || trackTitle;
      const expSec = (typeof trackItem === 'object' && trackItem !== null)
        ? (trackItem.spotifyDurationSec || (trackItem.durationMs ? Math.round(trackItem.durationMs / 1000) : (trackItem.duration ? parseDurationToSec(trackItem.duration) : 0)))
        : 0;
      let searchRes = await searchTrack(searchTarget, expSec);
      if (!searchRes || searchRes.length === 0) {
        searchRes = await searchTrack(`${searchTarget} Audio`, expSec);
      }
      if (searchRes && searchRes.length > 0 && searchRes[0].url) {
        targetUrl = searchRes[0].url;
        if (typeof trackItem === 'object' && trackItem !== null) {
          trackItem.url = targetUrl;
          const resolvedSec = searchRes[0].ytDurationSec || searchRes[0].seconds || parseDurationToSec(searchRes[0].duration);
          if (resolvedSec > 0) {
            trackItem.ytDurationSec = resolvedSec;
            trackItem.rawDurationSec = resolvedSec;
            trackItem.duration = searchRes[0].duration || `${Math.floor(resolvedSec / 60)}:${String(resolvedSec % 60).padStart(2, '0')}`;
            trackItem.durationMs = resolvedSec * 1000;
          } else if (searchRes[0].duration) {
            trackItem.duration = searchRes[0].duration;
          }
          if (!trackItem.thumbnail && searchRes[0].thumbnail) {
            trackItem.thumbnail = searchRes[0].thumbnail;
          }
        }
      }
    } catch (e) {
      console.warn('[Resolve track URL failed]:', e.message);
    }
  }

  const rawTitle = typeof trackItem === 'object' ? (trackItem.title || trackItem.searchQuery || '') : (trackTitle || '');
  let cleanTitle = (rawTitle || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, ' ')
    .replace(/#[\w\d_-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ')
    .replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official|full\s*hd|4k|1080p)/gi, ' ')
    .replace(/\b(\d+\s*hours?|\d+h|extended\s*loop|loop|mixset|compilation)\b/gi, ' ')
    .replace(/[-|:/\\–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const userSeek = Number(seekSeconds) || 0;
  const trimStart = (typeof trackItem === 'object' && trackItem?.trimStart) ? Number(trackItem.trimStart) : 0;
  const trimEnd = (typeof trackItem === 'object' && trackItem?.trimEnd) ? Number(trackItem.trimEnd) : 0;
  const effectiveSeek = trimStart + userSeek;
  const playDurationSec = (trimEnd > effectiveSeek) ? (trimEnd - effectiveSeek) : 0;

  const cachedEntry = audioCacheManager.findCachedEntry(trackItem, trimStart, trimEnd);
  if (cachedEntry && fs.existsSync(cachedEntry.filePath)) {
    try {
      console.log(`[AudioCache Hit] Phát tức thì từ SSD Cache: "${trackTitle}" (Seek: ${userSeek}s, Trim: ${cachedEntry.trimStart}s - ${cachedEntry.trimEnd}s)`);
      const cachePlayDurationSec = (cachedEntry.trimEnd > cachedEntry.trimStart)
        ? Math.max(0, (cachedEntry.trimEnd - cachedEntry.trimStart) - userSeek)
        : playDurationSec;
      return await createDirectFileStream(cachedEntry.filePath, userSeek, cachePlayDurationSec, options);
    } catch (cachePlayErr) {
      console.warn(`[AudioCache Read Failed]:`, cachePlayErr.message);
    }
  }

  let cacheOptions = null;
  if (userSeek === 0 && audioCacheManager.isCacheable(trackItem)) {
    const tempPath = audioCacheManager.createTempFilePath(trackItem, trimStart, trimEnd);
    if (tempPath) {
      let isDone = false;
      cacheOptions = {
        tempPath,
        onCommit: () => {
          if (!isDone) {
            isDone = true;
            audioCacheManager.commitCache(trackItem, tempPath, trimStart, trimEnd).catch(() => {});
          }
        },
        onAbort: () => {
          if (!isDone) {
            isDone = true;
            audioCacheManager.abortTemp(tempPath);
          }
        }
      };
    }
  }

  if (isYouTubeCircuitOpen(options)) {
    cacheOptions?.onAbort?.();
    console.log(`[Circuit Breaker Active] YouTube đang ngắt tạm thời (còn ${Math.ceil((skipYouTubeStreamUntil - Date.now()) / 60000)}p), chuyển thẳng sang SoundCloud.`);
    return await createSoundCloudFailoverStream(trackItem, cleanTitle, trackTitle, crossfadeSeconds, effectiveSeek, playDurationSec, options);
  }

  // TẦNG 1: Thử phát từ YouTube URL chính
  try {
    const res = await createSingleStream(targetUrl, crossfadeSeconds, effectiveSeek, false, false, playDurationSec, cacheOptions, options);
    recordYouTubeSuccess();
    return res;
  } catch (ytErr) {
    cacheOptions?.onAbort?.();
    const errMsg = ytErr.message.split('\n')[0];
    console.warn(`[YouTube Stream Blocked/Failed for "${trackTitle}"]: ${errMsg}`);

    const isCookieBotError = /sign in to confirm|confirm you're not a bot|this content isn't available|login|cookie|bot verification|403|429/i.test(errMsg);
    if (isCookieBotError) {
      try {
        const { notifyCookieExpired } = require('./statusNotifier');
        const client = global._discordClient;
        if (typeof notifyCookieExpired === 'function' && client) {
          notifyCookieExpired(client, null, `YouTube từ chối luồng âm thanh (${errMsg}) khi phát "${trackTitle}"`);
        }
      } catch (e) {}

      try {
        console.log(`[YouTube Failover] Thử lại trực tiếp "${targetUrl}" không dùng cookie (android,ios)...`);
        const noCookieRes = await createSingleStream(targetUrl, crossfadeSeconds, effectiveSeek, false, true, playDurationSec, null, options);
        recordYouTubeSuccess();
        return noCookieRes;
      } catch (noCookieErr) {
        console.warn(`[YouTube No-Cookie Retry Failed]: ${noCookieErr.message.split('\n')[0]}`);
      }
    }

    // TẦNG 1.5: Thử tìm các bản YouTube thay thế
    if (cleanTitle) {
      try {
        console.log(`[YouTube Alternate] Đang tìm bản YouTube thay thế cho "${cleanTitle}"...`);
        const ytsResults = await yts(cleanTitle);
        if (ytsResults && ytsResults.videos && ytsResults.videos.length > 0) {
          const targetId = (typeof targetUrl === 'string')
            ? (targetUrl.match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || '')
            : '';
          const userWantsRemix = /\b(remix|mashup|vinahouse|dj\b|mix|nonstop|liên\s*khúc)\b/i.test(trackTitle || '');
          const userWantsLive = /(?:\[\s*live|\(\s*live|\blive\b|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bdemo\b)/i.test(trackTitle || '');
          const userWantsCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(trackTitle || '');
          const songSegments = (rawTitle || '').replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ').split(/\s*[-–—|:]\s*/).filter(Boolean);
          const songTitlePart = songSegments.length >= 2 ? songSegments.slice(1).join(' ') : (rawTitle || '');
          const coreTitleWords = songTitlePart
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2 && !/^(official|music|video|audio|lyrics|mv|full|prod|feat|ft)$/i.test(w));

          const candidateVideos = ytsResults.videos.filter(v => {
            if (!v || !v.url) return false;
            if (targetId && v.videoId === targetId) return false;
            if (v.seconds && (v.seconds < 45 || v.seconds > 600)) return false;
            if (!userWantsLive && isLiveStageVideo(v.title)) return false;
            if (!userWantsCover && /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(v.title || '')) return false;
            if (!userWantsRemix) {
              const t = (v.title || '').toLowerCase();
              if (/\b(remix|mashup|vinahouse|bass\s*boosted|parody|karaoke|beat|slowed|speed\s*up)\b/i.test(t)) return false;
            }

            if (coreTitleWords.length > 0) {
              const normCand = (v.title || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, ' ');
              const matchedWords = coreTitleWords.filter(w => normCand.includes(w));
              if (matchedWords.length / coreTitleWords.length < 0.75) {
                return false;
              }
            }

            return true;
          });

          const isAudioLyric = (video) => /\b(official\s*audio|audio|lyrics?|lyric\s*video|topic|visualizer)\b/i.test(`${video.title || ''} ${video.author?.name || ''}`);
          candidateVideos.sort((a, b) => {
            const aMatch = isAudioLyric(a) ? 1 : 0;
            const bMatch = isAudioLyric(b) ? 1 : 0;
            return bMatch - aMatch;
          });

          for (const altVideo of candidateVideos.slice(0, 2)) {
            try {
              console.log(`[YouTube Alternate] Thử phát bản thay thế: "${altVideo.title}" (${altVideo.url})`);
              const resource = await createSingleStream(altVideo.url, crossfadeSeconds, effectiveSeek, false, false, playDurationSec, null, options);
              if (typeof trackItem === 'object' && trackItem !== null) {
                trackItem.url = altVideo.url;
              }
              recordYouTubeSuccess();
              return resource;
            } catch (altErr) {
              console.warn(`[YouTube Alternate Failed]: "${altVideo.title}" - ${altErr.message.split('\n')[0]}`);
            }
          }
        }
      } catch (altErr) {
        console.warn('[YouTube Alternate Error]:', altErr.message);
      }
    }

    recordYouTubeFailure(errMsg);

    // TẦNG 2: Failover sang SoundCloud
    return await createSoundCloudFailoverStream(trackItem, cleanTitle, trackTitle, crossfadeSeconds, effectiveSeek, playDurationSec, options);
  }
}

/**
 * Tạo Discord AudioResource được bọc qua hàng đợi ưu tiên 2 làn PrioritySemaphore
 */
async function createResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0, options = {}) {
  const priority = options?.priority || trackItem?.priority || 'high';
  return await extractionSemaphore.run(async () => {
    return await _doCreateResource(trackItem, crossfadeSeconds, seekSeconds, { ...options, priority });
  }, priority);
}

/**
 * Thuật toán Autoplay Điều Phối Đa Lớp Lấy Danh Sách Bài Hát Cho Bộ Đệm (Autoplay Pool):
 * Ưu tiên YouTube Mix (trả về 5-10 bài đạt chuẩn) -> Last.fm -> Heuristic
 */
async function getRelatedTracksPool(lastSong, guildIdOrHistory = [], useAi = false, targetRegion = null) {
  if (!lastSong || !lastSong.title) return [];

  const guildId = typeof guildIdOrHistory === 'string' ? guildIdOrHistory : null;
  const playedList = Array.isArray(guildIdOrHistory) ? guildIdOrHistory : (guildId ? historyManager.getHistory(guildId) : []);

  const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
  const region = targetRegion || seedMeta.region;

  const guildSettings = guildId ? settingsManager.get(guildId) : null;
  const configuredLayers = (guildSettings && Array.isArray(guildSettings.autoplayLayers) && guildSettings.autoplayLayers.length > 0)
    ? guildSettings.autoplayLayers
    : ['ytmix', 'lastfm', 'heuristic'];

  for (const layer of configuredLayers) {
    if (layer === 'ai') {
      try {
        const { getGeminiRecommendation } = require('./geminiHelper');
        const aiRec = await getGeminiRecommendation(lastSong, playedList, region);
        if (aiRec) {
          console.log(`[Autoplay Pool] Gợi ý thành công từ AI Gemini: "${aiRec.title}" (${aiRec.artist || 'AI'})`);
          const query = aiRec.searchQuery || `${aiRec.title} ${aiRec.artist || ''}`.trim();
          const searchRes = await searchTrack(query);
          if (Array.isArray(searchRes) && searchRes.length > 0 && searchRes[0]?.url) {
            const track = {
              ...searchRes[0],
              requestedBy: 'Auto'
            };
            if (!NON_MUSIC_BLACKLIST_REGEX.test(track.title || '')) {
              return [track];
            }
          }
        }
      } catch (aiErr) {
        console.warn('[Autoplay AI Gemini Error]:', aiErr.message);
      }
    } else if (layer === 'ytmix') {
      const candidates = await getYoutubeMix(lastSong, guildId, playedList, region, true);
      if (Array.isArray(candidates) && candidates.length > 0) {
        const filtered = candidates.filter(t => t && !NON_MUSIC_BLACKLIST_REGEX.test(t.title || ''));
        if (filtered.length > 0) {
          console.log(`[Autoplay Pool] Nạp ${filtered.length} bài vào bộ đệm từ YouTube Mix (${region})`);
          return filtered;
        }
      }
    } else if (layer === 'lastfm') {
      const lastfmTrack = await getLastfmSimilar(lastSong, guildId, playedList, region);
      if (lastfmTrack && !NON_MUSIC_BLACKLIST_REGEX.test(lastfmTrack.title || '')) {
        return [lastfmTrack];
      }
    } else if (layer === 'heuristic') {
      const heuristicTrack = await getHeuristicRelatedTrack(lastSong, guildId, playedList, region);
      if (heuristicTrack && !NON_MUSIC_BLACKLIST_REGEX.test(heuristicTrack.title || '')) {
        return [heuristicTrack];
      }
    }
  }

  return [];
}

/**
 * Lấy 1 bài tương tự tiếp theo (Tương thích ngược, gọi từ getRelatedTracksPool)
 */
async function getRelatedTrack(lastSong, guildIdOrHistory = [], useAi = false, targetRegion = null) {
  const pool = await getRelatedTracksPool(lastSong, guildIdOrHistory, useAi, targetRegion);
  return (pool && pool.length > 0) ? pool.find(t => t && !NON_MUSIC_BLACKLIST_REGEX.test(t.title || '')) || null : null;
}

/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web & Discord Autocomplete
 */
async function searchMultipleTracks(query, limit = 20, mode = 'official', locale = 'vi') {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  query = query.trim();

  if (query.startsWith('http')) {
    const directRes = await searchTrack(query);
    return directRes || [];
  }

  try {
    return await executeSearch(query, limit, mode, locale);
  } catch (err) {
    console.warn('[searchMultipleTracks worker error]:', err.message);
    return [];
  }
}

module.exports = {
  // Semaphore & Process Management
  cleanupAllProcesses,
  PrioritySemaphore,
  extractionSemaphore,
  isYouTubeCircuitOpen,
  streamUrlCache,
  setCachedStreamUrl,
  getCachedStreamUrl,
  resolveDirectStreamUrl,

  // Core Extractor & Search
  validateAndSanitizeMusicUrl,
  searchTrack,
  searchMultipleTracks,
  createResource,

  // Autoplay & Related
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack,
  getRelatedTrack,
  getRelatedTracksPool,

  // Apple Music & Region Detection
  analyzeTrackOriginAndMeta,
  resolveTrackOriginAndMetaAsync,
  extractCleanArtistAndTitle,
  buildAutoplayFallbackQueries,
  detectTrackRegion,
  isCandidateMatchingRegion
};
