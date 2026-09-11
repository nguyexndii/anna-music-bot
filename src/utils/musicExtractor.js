const os = require('os');
const fs = require('fs');
const path = require('path');

// Tự động vá lỗi thư viện yt-search (tránh lỗi title.trim() undefined khi YouTube trả về playlist/mix không có tiêu đề)
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
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const fetch = globalThis.fetch || require('node-fetch');
const spotifyUrlInfo = require('spotify-url-info')(fetch);

// Đường dẫn file cookies YouTube (Netscape format). Cài trong .env: YTDLP_COOKIES_FILE=/root/anna-music-bot/youtube.cookies
// File này giúp yt-dlp xác thực để bypass kiểm tra bot của YouTube trên Datacenter IP
function getCookiesFile() {
  if (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)) {
    return process.env.YTDLP_COOKIES_FILE;
  }
  const rootCookies = path.resolve(__dirname, '../../youtube.cookies');
  if (fs.existsSync(rootCookies)) {
    return rootCookies;
  }
  const cwdCookies = path.resolve(process.cwd(), 'youtube.cookies');
  if (fs.existsSync(cwdCookies)) {
    return cwdCookies;
  }
  if (fs.existsSync('/root/anna-music-bot/youtube.cookies')) {
    return '/root/anna-music-bot/youtube.cookies';
  }
  return null;
}


/**
 * Định dạng mili-giây sang MM:SS
 */
function formatMs(ms) {
  if (!ms || isNaN(ms)) return '3:30';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function parseDurationToSec(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/**
 * Trích xuất ảnh thumbnail chất lượng cao và chuẩn xác nhất cho bài hát YouTube/Web
 */
function resolveBestThumbnail(entry, fallbackId = null) {
  if (!entry && !fallbackId) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300';
  
  const id = (typeof entry === 'object' ? entry?.id : null) || fallbackId || (typeof entry?.url === 'string' ? entry.url.match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] : null);
  
  // 1. Nếu có YouTube Video ID hợp lệ -> Luôn ưu tiên ảnh hqdefault.jpg chuẩn theo video
  if (id && typeof id === 'string' && id.length === 11) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  // 2. Nếu có mảng thumbnails trong metadata
  if (entry && Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0) {
    const validThumbs = entry.thumbnails.filter(t => t?.url && !t.url.includes('yt3.ggpht.com') && !t.url.includes('default_user') && !t.url.includes('avatar'));
    if (validThumbs.length > 0) {
      const sorted = [...validThumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
      return sorted[0]?.url || validThumbs[validThumbs.length - 1]?.url;
    }
  }

  if (entry?.thumbnail && typeof entry.thumbnail === 'string' && !entry.thumbnail.includes('yt3.ggpht.com') && !entry.thumbnail.includes('default_user')) {
    return entry.thumbnail;
  }

  return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300';
}

/**
 * Tách tên nghệ sĩ và tên bài hát từ tiêu đề
 */
function parseArtistAndTitle(rawTitle) {
  let artist = '';
  let songName = rawTitle || '';

  if (rawTitle.includes('-')) {
    const parts = rawTitle.split('-');
    artist = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    songName = parts.slice(1).join('-').replace(/\[.*?\]|\(.*?\)/g, '').trim();
  } else if (rawTitle.includes('|')) {
    const parts = rawTitle.split('|');
    songName = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    artist = parts.slice(1).join(' ').replace(/\[.*?\]|\(.*?\)/g, '').trim();
  } else {
    songName = rawTitle.replace(/\[.*?\]|\(.*?\)/g, '').trim();
  }

  const cleanSong = songName.replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v/gi, '').trim();
  return { artist, songName: cleanSong, rawSongName: songName };
}

let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyApiToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`
      },
      body: 'grant_type=client_credentials'
    });

    if (res.ok) {
      const data = await res.json();
      spotifyTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000
      };
      return spotifyTokenCache.token;
    }
  } catch (e) {
    console.warn('[Spotify Token Error]:', e.message);
  }
  return null;
}

async function fetchSpotifyPlaylistFull(playlistId) {
  const token = await getSpotifyApiToken();
  if (!token) return null;

  const tracks = [];
  let offset = 0;
  const limit = 100;

  while (offset < 2000) {
    try {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;

      for (const item of data.items) {
        if (item.track && item.track.name) {
          const artistName = item.track.artists ? item.track.artists.map(a => a.name).join(', ') : '';
          const title = artistName ? `${item.track.name} - ${artistName}` : item.track.name;
          const spotifyUrl = item.track.external_urls?.spotify || (item.track.id ? `https://open.spotify.com/track/${item.track.id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`);
          tracks.push({
            title: title,
            url: spotifyUrl,
            searchQuery: `${title}`,
            duration: formatMs(item.track.duration_ms),
            thumbnail: item.track.album?.images?.[0]?.url || null,
            isLive: false
          });
        }
      }

      if (tracks.length >= (data.total || 0) || !data.next) break;
      offset += limit;
    } catch (err) {
      console.warn('[Spotify Playlist Page Error]:', err.message);
      break;
    }
  }

  return tracks.length > 0 ? tracks : null;
}

async function enrichSpotifyTracksWithThumbnails(tracks, defaultCover) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks;

  // 1. Gán thumbnail mặc định là ảnh bìa Playlist/Album trước để không bao giờ bị null
  for (const t of tracks) {
    if (!t.thumbnail && defaultCover) {
      t.thumbnail = defaultCover;
    }
  }

  const enrichBatch = async (batch) => {
    await Promise.allSettled(batch.map(async item => {
      if (!item.uri) return;
      const trackId = item.uri.replace('spotify:track:', '').split('?')[0];
      if (!trackId) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, {
          signal: controller.signal
        });
        if (res.ok) {
          const d = await res.json();
          if (d.thumbnail_url) {
            item.thumbnail = d.thumbnail_url;
          }
        }
      } catch (err) {
        // Giữ fallback defaultCover đã được gán sẵn
      } finally {
        clearTimeout(timeout);
      }
    }));
  };

  // 2. Tải ngay 15 bài đầu tiên (~300-500ms) để phản hồi API siêu nhanh cho người dùng
  const firstBatch = tracks.slice(0, 15);
  await enrichBatch(firstBatch);

  // 3. Tải tiếp các bài còn lại ở background để không làm nghẽn API (mỗi đợt 25 bài)
  const remaining = tracks.slice(15);
  if (remaining.length > 0) {
    (async () => {
      const batchSize = 25;
      for (let i = 0; i < remaining.length; i += batchSize) {
        await enrichBatch(remaining.slice(i, i + batchSize));
      }
    })().catch(() => {});
  }

  return tracks;
}

/**
 * Tìm kiếm và trích xuất thông tin bài hát / Playlist từ YouTube, Spotify, SoundCloud
 * (Tối đa 100 bài đối với Playlist)
 */
async function searchTrack(query, targetDurationSec = 0) {
  try {
    if (!query || typeof query !== 'string') return null;

    let cleanQuery = query.trim();
    // Tự động chuẩn hóa link Spotify nếu thiếu protocol (vd: en.spotify.com/... hoặc open.spotify.com/...)
    if ((cleanQuery.includes('spotify.com/') || cleanQuery.startsWith('spotify:')) && !cleanQuery.startsWith('http://') && !cleanQuery.startsWith('https://')) {
      cleanQuery = 'https://' + cleanQuery;
    }

    // 1. Xử lý Playlist / Album Spotify (Giới hạn tối đa 100 bài)
    if (cleanQuery.includes('spotify.com/playlist/') || cleanQuery.includes('spotify.com/album/')) {
      try {
        // Lấy ảnh bìa Playlist/Album làm fallback chuẩn đẹp
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
          const limited = spotifyTracks.slice(0, 100).map(item => {
            const artistName = item.artist || item.artists?.[0]?.name || '';
            const title = artistName ? `${item.name} - ${artistName}` : item.name;
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
              thumbnail: defaultCover,
              uri: item.uri,
              source: 'spotify',
              isLive: false,
              playlistTitle: playlistTitle || 'Spotify Playlist',
              playlistThumbnail: defaultCover
            };
          });

          // Tải song song thumbnail từng bài hát từ Spotify oEmbed (tối đa 25 bài/đợt, cực nhanh ~1-2s)
          await enrichSpotifyTracksWithThumbnails(limited, defaultCover);
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
          // Ưu tiên tìm kiếm chuẩn theo thời lượng của Spotify để tránh MV có intro phim
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
          noWarnings: true
        };
        const cFile = getCookiesFile();
        if (cFile) plOpts.cookies = cFile;
        const res = await ytdlp(query, plOpts);

        if (res && res.entries && res.entries.length > 0) {
          const playlistTitle = res.title || 'YouTube Playlist';
          const playlistThumb = resolveBestThumbnail(res);
          const limited = res.entries.slice(0, 100);
          return limited.map(e => {
            const trackUrl = e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
            return {
              title: e.title,
              url: trackUrl,
              searchQuery: e.title,
              duration: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '3:30',
              thumbnail: resolveBestThumbnail(e),
              isLive: false,
              playlistTitle: playlistTitle,
              playlistThumbnail: playlistThumb
            };
          });
        }
      } catch (ytErr) {
        console.warn('[YouTube Playlist extraction error]:', ytErr.message);
      }
    }

let soundCloudClientId = null;
async function ensureSoundCloudAuth() {
  if (soundCloudClientId) return soundCloudClientId;
  try {
    soundCloudClientId = await play.getFreeClientID();
    if (soundCloudClientId) {
      await play.setToken({ soundcloud: { client_id: soundCloudClientId } });
    }
  } catch (e) {
    console.warn('[SoundCloud Auth Warning]:', e.message);
  }
  return soundCloudClientId;
}

function extractSoundCloudTitleFromUrl(url) {
  if (!url) return 'SoundCloud Track';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const slug = parts[parts.length - 1];
      return slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  } catch (e) {}
  return 'SoundCloud Track';
}

    // 4. Xử lý SoundCloud (Cả bài hát đơn và Playlist / Album - Giới hạn 100 bài)
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

      // Fallback
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
      // 5.1 Xử lý Single YouTube video bằng oEmbed / yts (Tránh spawn yt-dlp ngốn 100% CPU trên VPS 1 core)
      const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (ytMatch && ytMatch[1] && !query.includes('list=')) {
        const videoId = ytMatch[1];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const defaultThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        try {
          const oEmbedPromise = fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null);

          const ytsPromise = Promise.race([
            yts({ videoId }),
            new Promise(resolve => setTimeout(() => resolve(null), 2500))
          ]).catch(() => null);

          const [oembedData, ytsData] = await Promise.all([oEmbedPromise, ytsPromise]);
          const resolvedTitle = ytsData?.title || oembedData?.title;

          if (resolvedTitle) {
            return [{
              title: resolvedTitle,
              url: videoUrl,
              duration: ytsData?.timestamp || (ytsData?.seconds ? `${Math.floor(ytsData.seconds / 60)}:${String(ytsData.seconds % 60).padStart(2, '0')}` : '3:30'),
              thumbnail: defaultThumb,
              artist: oembedData?.author_name || ytsData?.author?.name || 'YouTube',
              isLive: Boolean(ytsData?.live)
            }];
          }
        } catch (fastYtErr) {
          console.warn('[Fast YouTube single video fallback]:', fastYtErr.message);
        }
      }

      try {
        const infoOpts = {
          dumpSingleJson: true,
          noWarnings: true,
          callHome: false,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true
        };
        const cFile = getCookiesFile();
        if (cFile) infoOpts.cookies = cFile;
        const info = await ytdlp(query, infoOpts);
        return [{
          title: info.title || 'Audio Stream',
          url: info.webpage_url || query,
          duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : 'Live Stream',
          thumbnail: info.thumbnail || null,
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

    // 6. Tìm kiếm YouTube cho từ khóa (Tự động ưu tiên bản Audio / Lyric Video chuẩn nhịp nếu user không ghi rõ 'mv')
    try {
      const userWantsRemix = /\b(remix|mix|mashup|vinahouse|cover|speed\s*up|slowed|nightcore|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi)\b/i.test(query);
      const isExplicitMv = /\bmv\b|\bvideo\b|\bm\/v\b/i.test(query);
      const r = await yts(query);
      if (r && r.videos && r.videos.length > 0) {
        let candidateVideos = r.videos;
        if (!userWantsRemix) {
          const cleanFiltered = candidateVideos.filter(v => {
            const t = (v.title || '').toLowerCase();
            if (v.seconds > 600) return false;
            return !/\b(remix|mashup|vinahouse|bass\s*boosted|speed\s*up|slowed|nightcore|cover|parody|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi\s*ver|tiktok)/i.test(t);
          });
          if (cleanFiltered.length > 0) {
            candidateVideos = cleanFiltered;
          }
        }

        let best = candidateVideos[0];
        if (targetDurationSec > 0 && candidateVideos.length > 1) {
          const sorted = [...candidateVideos].sort((a, b) => {
            const aDiff = Math.abs((a.seconds || 0) - targetDurationSec);
            const bDiff = Math.abs((b.seconds || 0) - targetDurationSec);
            const aIsTopic = Boolean((a.author?.name || '').toLowerCase().includes('topic') || (a.title || '').toLowerCase().includes('topic'));
            const bIsTopic = Boolean((b.author?.name || '').toLowerCase().includes('topic') || (b.title || '').toLowerCase().includes('topic'));
            const aIsAudio = Boolean(/audio|lyric/i.test(a.title || ''));
            const bIsAudio = Boolean(/audio|lyric/i.test(b.title || ''));

            // Nếu thời lượng lệch không quá 4 giây: Ưu tiên cực cao (tránh MV có intro phim)
            const aGoodDur = aDiff <= 4;
            const bGoodDur = bDiff <= 4;
            if (aGoodDur && !bGoodDur) return -1;
            if (!aGoodDur && bGoodDur) return 1;

            if (aGoodDur && bGoodDur) {
              if (aIsTopic && !bIsTopic) return -1;
              if (!aIsTopic && bIsTopic) return 1;
              if (aIsAudio && !bIsAudio) return -1;
              if (!aIsAudio && bIsAudio) return 1;
            }

            return aDiff - bDiff;
          });
          best = sorted[0];
        } else if (!isExplicitMv && candidateVideos.length > 1) {
          const audioCandidate = candidateVideos.slice(0, 6).find(t => {
            const title = (t.title || '').toLowerCase();
            const author = (t.author?.name || '').toLowerCase();
            return (title.includes('audio') || title.includes('lyric') || title.includes('topic') || author.includes('topic')) && !title.includes('teaser') && !title.includes('trailer');
          });
          if (audioCandidate) {
            best = audioCandidate;
          }
        }
        return [{
          title: best.title,
          url: best.url,
          duration: best.timestamp || (best.seconds ? `${Math.floor(best.seconds / 60)}:${String(best.seconds % 60).padStart(2, '0')}` : '3:30'),
          seconds: best.seconds || 0,
          thumbnail: best.thumbnail || `https://i.ytimg.com/vi/${best.videoId}/hqdefault.jpg`,
          artist: best.author?.name || 'YouTube',
          isLive: Boolean(best.live)
        }];
      }
    } catch (ytsErr) {
      console.warn('[searchTrack yt-search error, fallback play-dl]:', ytsErr.message);
    }

    // Fallback qua play-dl nếu yt-search lỗi
    try {
      const searchResults = await play.search(query, { limit: 1, source: { youtube: 'video' } });
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

    // Fallback: yt-dlp search nếu play-dl gặp lỗi
    try {
      const sOpts = {
        dumpSingleJson: true,
        noWarnings: true,
        flatPlaylist: true
      };
      const cFile = getCookiesFile();
      if (cFile) sOpts.cookies = cFile;
      const res = await ytdlp(`ytsearch3:${query}`, sOpts);

      if (res && res.entries && res.entries.length > 0) {
        const bestEntry = res.entries[0];
        const url = bestEntry.url || `https://www.youtube.com/watch?v=${bestEntry.id}`;
        return [{
          title: bestEntry.title,
          url: url,
          duration: bestEntry.duration ? `${Math.floor(bestEntry.duration / 60)}:${String(bestEntry.duration % 60).padStart(2, '0')}` : '3:30',
          thumbnail: resolveBestThumbnail(bestEntry),
          artist: bestEntry.uploader || bestEntry.channel || 'YouTube',
          isLive: false
        }];
      }
    } catch (ytErr) {
      console.warn('[yt-dlp keyword search fallback error]:', ytErr.message);
    }

    return null;
  } catch (error) {
    console.error('Error in searchTrack:', error);
    return null;
  }
}

/**
 * Lớp 1 (Ưu tiên cao nhất): Lấy bài tương tự từ YouTube Mix (RD<videoId>)
 */
async function getYoutubeMix(lastSong, playedUrls = []) {
  if (!lastSong || !lastSong.url) return null;

  try {
    const match = lastSong.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (!match || !match[1]) return null;

    const videoId = match[1];
    const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

    const mixOpts = {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      playlistEnd: 15
    };
    const cFile = getCookiesFile();
    if (cFile) mixOpts.cookies = cFile;
    const res = await ytdlp(mixUrl, mixOpts);

    if (res && res.entries && res.entries.length > 0) {
      for (const entry of res.entries) {
        if (!entry || !entry.title) continue;

        const trackUrl = entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
        if (!trackUrl) continue;

        if (trackUrl === lastSong.url || playedUrls.includes(trackUrl)) {
          continue;
        }

        return {
          title: entry.title,
          url: trackUrl,
          duration: entry.duration ? `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}` : '3:30',
          thumbnail: entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null),
          isLive: false,
          requestedBy: 'Auto'
        };
      }
    }
  } catch (err) {
    console.warn('[Autoplay YouTube Mix Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 2 (Fallback thứ 2): Lấy bài tương tự từ Last.fm Similar Track API
 */
async function getLastfmSimilar(lastSong, playedUrls = []) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey || !lastSong || !lastSong.title) return null;

  try {
    const { artist, songName } = parseArtistAndTitle(lastSong.title);
    if (!artist || !songName) return null;

    const apiUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(songName)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=10`;
    const response = await fetch(apiUrl);
    if (!response.ok) return null;

    const data = await response.json();
    const tracks = data?.similartracks?.track;
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return null;

    for (const simTrack of tracks) {
      const trackName = simTrack.name;
      const trackArtist = typeof simTrack.artist === 'string' ? simTrack.artist : (simTrack.artist?.name || '');
      const fullQuery = `${trackName} ${trackArtist}`.trim();

      // Bỏ qua nếu bài hát đã có trong lịch sử phát
      if (playedUrls.some(u => typeof u === 'string' && u.toLowerCase().includes(trackName.toLowerCase()))) {
        continue;
      }

      const results = await searchTrack(fullQuery);
      if (results && results.length > 0) {
        const found = results[0];
        if (found.url && !playedUrls.includes(found.url) && found.url !== lastSong.url) {
          return {
            title: found.title,
            url: found.url,
            duration: found.duration || '3:30',
            thumbnail: found.thumbnail || null,
            isLive: false,
            requestedBy: 'Auto'
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Autoplay Last.fm Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 3 (Fallback cuối cùng): Logic Heuristic nhận diện thể loại / ca sĩ và lọc từ khóa rác
 */
async function getHeuristicRelatedTrack(lastSong, playedUrls = []) {
  if (!lastSong || !lastSong.title) return null;

  try {
    const rawTitle = lastSong.title;
    const lowerTitle = rawTitle.toLowerCase();
    const isOriginalRemix = /remix|vinahey|house|edm/i.test(rawTitle);

    const { artist, songName } = parseArtistAndTitle(rawTitle);
    const cleanSong = songName;

    const isVintageOrBolero = /bolero|nhạc vàng|trịnh|khánh ly|quang dũng|tuấn ngọc|ngọc lan|lệ quyên|nhạc xưa|trữ tình|tiền chiến|chế linh|như quỳnh|hương lan|thanh tuyền|quang lê|duy khánh|phạm duy/i.test(lowerTitle);
    const isIndieOrChill = /vũ|thịnh suy|chillies|ngọt|đinh dũng|trang|marzuz|hoàng dũng|fishy|greyd|kai đinh|mr siro|acoustic|chill|lofi|ballad|buồn/i.test(lowerTitle);

    const searchQueries = [];

    if (artist && artist.length > 1) {
      if (isVintageOrBolero) {
        searchQueries.push(`ytsearch8:${artist} nhạc trữ tình xưa hay nhất`);
        searchQueries.push(`ytsearch8:${artist} official audio`);
      } else if (isIndieOrChill) {
        searchQueries.push(`ytsearch8:${artist} bài hát hay nhất`);
        searchQueries.push(`ytsearch8:${artist} official acoustic`);
      } else {
        searchQueries.push(`ytsearch8:${artist} official audio`);
        searchQueries.push(`ytsearch8:${artist} greatest hits`);
      }
    }

    if (isVintageOrBolero) {
      searchQueries.push(`ytsearch8:${cleanSong} nhạc vàng xưa tuyển chọn`);
    } else if (isIndieOrChill) {
      searchQueries.push(`ytsearch8:${cleanSong} indie acoustic chill`);
      searchQueries.push(`ytsearch8:${cleanSong} acoustic official`);
    } else {
      searchQueries.push(`ytsearch8:${cleanSong} ${artist} official`);
      searchQueries.push(`ytsearch8:${cleanSong} official audio`);
    }

    const junkPattern = /(remix|vinahey|house|edm|bassboost|1 hour|1h|karaoke|beat chuẩn|beat karaoke|instrumental|reaction|parody|speed up|slowed|nightcore|tập \d+|liên khúc|nonstop|dj|tiktok mashup|quẩy|playlist)/i;

    for (const query of searchQueries) {
      try {
        const relOpts = {
          dumpSingleJson: true,
          noWarnings: true,
          flatPlaylist: true
        };
        const cFile = getCookiesFile();
        if (cFile) relOpts.cookies = cFile;
        const res = await ytdlp(query, relOpts);

        if (res && res.entries && res.entries.length > 0) {
          for (const entry of res.entries) {
            if (!entry || !entry.title) continue;

            const trackUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

            if (trackUrl === lastSong.url || playedUrls.includes(trackUrl)) continue;

            if (!isOriginalRemix && junkPattern.test(entry.title)) {
              continue;
            }

            if (entry.duration && (entry.duration > 600 || entry.duration < 60)) {
              continue;
            }

            return {
              title: entry.title,
              url: trackUrl,
              duration: entry.duration ? `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}` : '3:30',
              thumbnail: entry.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
              isLive: false,
              requestedBy: 'Auto'
            };
          }
        }
      } catch (qErr) {
        console.warn(`[Autoplay search failed for query: ${query}]:`, qErr.message);
      }
    }
  } catch (err) {
    console.error('[getHeuristicRelatedTrack Error]:', err.message);
  }
  return null;
}

const { getGeminiRecommendation } = require('./geminiHelper');

const historyManager = require('../structures/HistoryManager');

/**
 * Thuật toán Autoplay Điều Phối Đa Lớp Thông Minh (Chống lặp lại 20 bài gần nhất):
 * 0. Gemini DJ AI (Khi BẬT trong Cài đặt)
 * 1. YouTube Mix (Ưu tiên cao)
 * 2. Last.fm Similar Track (Fallback thứ 2)
 * 3. Heuristic Fallback (Fallback cuối cùng)
 */
async function getRelatedTrack(lastSong, guildIdOrHistory = [], useAi = true) {
  if (!lastSong || !lastSong.title) return null;

  const guildId = typeof guildIdOrHistory === 'string' ? guildIdOrHistory : null;
  const playedList = Array.isArray(guildIdOrHistory) ? guildIdOrHistory : (guildId ? historyManager.getHistory(guildId) : []);

  // 0. Lớp 0 (Siêu ưu tiên nếu bật Trí tuệ nhân tạo): Gemini DJ AI
  if (useAi) {
    try {
      const aiRec = await getGeminiRecommendation(lastSong.title, playedList);
      if (aiRec && (aiRec.searchQuery || aiRec.title)) {
        const query = aiRec.searchQuery || `${aiRec.title} ${aiRec.artist || ''}`.trim();
        const results = await searchTrack(query);
        if (results && results.length > 0) {
          const found = results[0];
          const isRepeat = guildId ? historyManager.isRecentlyPlayed(guildId, found, 20) : playedList.some(p => typeof p === 'string' ? p === found.url : (p.url === found.url || p.title === found.title));

          if (found.url && !isRepeat && found.url !== lastSong.url) {
            console.log(`[Autoplay] Found via Gemini DJ AI: ${found.title} (${aiRec.reason || ''})`);
            found.requestedBy = 'Auto';
            return found;
          }
        }
      }
    } catch (aiErr) {
      console.warn('[Autoplay Gemini AI Warning]:', aiErr.message);
    }
  }

  // 1. Lớp 1: YouTube Mix (Ưu tiên cao)
  const ytMixTrack = await getYoutubeMix(lastSong, playedList);
  if (ytMixTrack) {
    console.log('[Autoplay] Found via YouTube Mix');
    return ytMixTrack;
  }

  // 2. Lớp 2: Last.fm Similar Track (Fallback thứ 2)
  const lastfmTrack = await getLastfmSimilar(lastSong, playedList);
  if (lastfmTrack) {
    console.log('[Autoplay] Found via Last.fm');
    return lastfmTrack;
  }

  // 3. Lớp 3: Heuristic Fallback (Fallback cuối cùng)
  const heuristicTrack = await getHeuristicRelatedTrack(lastSong, playedList);
  if (heuristicTrack) {
    console.log('[Autoplay] Found via heuristic fallback');
    return heuristicTrack;
  }

  return null;
}

// Bộ quản lý tiến trình con (FFmpeg & yt-dlp) để chống tràn / rò rỉ RAM (Zombie processes)
const activeProcesses = new Set();

function registerProcess(proc) {
  if (!proc) return;
  activeProcesses.add(proc);
  const cleanup = () => {
    activeProcesses.delete(proc);
  };
  proc.on('exit', cleanup);
  proc.on('close', cleanup);
  proc.on('error', cleanup);
}

function killProcess(proc) {
  if (!proc) return;
  activeProcesses.delete(proc);
  try {
    if (proc.pid) {
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch (e) {}
      if (process.platform === 'linux') {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch (e) {}
      }
    } else if (typeof proc.kill === 'function') {
      proc.kill('SIGKILL');
    }
  } catch (e) {}
}

function cleanupAllProcesses() {
  for (const proc of activeProcesses) {
    killProcess(proc);
  }
}

// Tự động dọn dẹp tiến trình con khi Node.js process thoát
process.on('exit', cleanupAllProcesses);
process.on('SIGINT', () => { cleanupAllProcesses(); process.exit(); });
process.on('SIGTERM', () => { cleanupAllProcesses(); process.exit(); });

/**
 * Tạo một luồng phát đơn qua yt-dlp & FFmpeg với cơ chế kiểm tra gói dữ liệu đầu tiên (First-Chunk Confirmation)
 * Nếu YouTube bị chặn bot (ra 0 byte / code 183), hàm sẽ reject ngay lập tức để kích hoạt cơ chế Failover.
 */
function createSingleStream(targetQueryOrUrl, crossfadeSeconds = 0, seekSeconds = 0, isSoundCloud = false) {
  return new Promise((resolve, reject) => {
    const ytdlpOptions = {
      output: '-',
      format: 'bestaudio/best',
      ffmpegLocation: ffmpeg,
      noPlaylist: true,
      noWarnings: true
    };

    if (!isSoundCloud) {
      ytdlpOptions.preferFreeFormats = true;
      const cookiesFile = getCookiesFile();
      if (cookiesFile) {
        ytdlpOptions.cookies = cookiesFile;
      }
    }

    let ytdlpStreamProcess = null;
    try {
      ytdlpStreamProcess = ytdlp.exec(targetQueryOrUrl, ytdlpOptions);
      if (ytdlpStreamProcess) registerProcess(ytdlpStreamProcess);
      try {
        if (ytdlpStreamProcess && ytdlpStreamProcess.pid && process.platform === 'linux') {
          os.setPriority(ytdlpStreamProcess.pid, 10);
        }
      } catch (e) {}
    } catch (err) {
      return reject(err);
    }

    if (!ytdlpStreamProcess || !ytdlpStreamProcess.stdout) {
      return reject(new Error(`Không thể khởi chạy yt-dlp cho: ${targetQueryOrUrl}`));
    }

    const ffmpegArgs = [];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }

    ffmpegArgs.push(
      '-analyzeduration', '0',
      '-probesize', '64k',
      '-i', 'pipe:0',
      '-vn'
    );

    if (crossfadeSeconds && Number(crossfadeSeconds) > 0) {
      const fadeSec = Math.min(1.5, Number(crossfadeSeconds));
      ffmpegArgs.push('-af', `afade=t=in:ss=0:d=${fadeSec}`);
    }

    ffmpegArgs.push(
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-threads', '1',
      'pipe:1'
    );

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    registerProcess(ffmpegProcess);
    try {
      if (ffmpegProcess.pid && process.platform === 'linux') {
        os.setPriority(ffmpegProcess.pid, 10);
      }
    } catch (e) {}

    let ffmpegStderr = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
      if (ffmpegStderr.length > 4000) ffmpegStderr = ffmpegStderr.slice(-2000);
    });

    let ytdlpStderr = '';
    ytdlpStreamProcess.stderr.on('data', (chunk) => {
      ytdlpStderr += chunk.toString();
      if (ytdlpStderr.length > 4000) ytdlpStderr = ytdlpStderr.slice(-2000);
    });

    ffmpegProcess.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[FFmpeg stdin Error]:', err.message);
      }
    });

    ytdlpStreamProcess.stdout.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[yt-dlp stdout Error]:', err.message);
      }
    });

    ytdlpStreamProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[yt-dlp Process Error]:', err.message);
      }
    });

    ffmpegProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[FFmpeg Process Error]:', err.message);
      }
    });

    ytdlpStreamProcess.stdout.pipe(ffmpegProcess.stdin);

    let firstChunkReceived = false;
    const passThroughStream = new PassThrough({ highWaterMark: 1024 * 512 });
    passThroughStream.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[PassThroughStream Error]:', err.message);
      }
    });
    ffmpegProcess.stdout.pipe(passThroughStream);

    // Timeout bảo vệ: Nếu sau 18 giây không có dữ liệu âm thanh nào, tự hủy để failover
    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        reject(new Error('Quá thời gian chờ âm thanh từ nguồn này (Timeout 18s)'));
      }
    }, 18000);

    // Khi nhận được gói âm thanh đầu tiên: Xác nhận luồng chạy tốt 100%!
    ffmpegProcess.stdout.once('data', () => {
      firstChunkReceived = true;
      clearTimeout(safetyTimeout);

      const resource = createAudioResource(passThroughStream, {
        inputType: StreamType.Raw,
        inlineVolume: true
      });

      resource.destroy = () => {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
      };

      resolve(resource);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(safetyTimeout);
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        const lastErr = (ytdlpStderr || ffmpegStderr).slice(-200).trim();
        reject(new Error(`FFmpeg exited with code ${code}: ${lastErr}`));
      } else {
        if (code !== 0 && code !== null) {
          const lastErr = (ffmpegStderr || ytdlpStderr).slice(-200).trim();
          if (lastErr) console.warn(`[FFmpeg exited code ${code}]:`, lastErr);
        }
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
      }
    });
  });
}

/**
 * Tạo Discord AudioResource với kiến trúc Failover Tự Động 3 Tầng Siêu Bền Vững:
 * Tầng 1: YouTube Direct (tv_embedded & android_creator clients, bypass bot check)
 * Tầng 1.5: YouTube Alternate Search (Tự động chuyển sang bản tải lên/MV khác nếu link chính bị YouTube kiểm duyệt)
 * Tầng 2: SoundCloud Fallback (Lọc nghiêm ngặt thời lượng và từ khóa, chặn tuyệt đối playlist/remix dài)
 */
async function createResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0) {
  let targetUrl = typeof trackItem === 'string' ? trackItem : (trackItem.url || trackItem.searchQuery);
  const trackTitle = typeof trackItem === 'object' ? (trackItem.title || trackItem.searchQuery) : trackItem;

  // Nếu track chưa có direct URL hoặc là link Spotify: tìm kiếm URL YouTube trước
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
          if (searchRes[0].duration) {
            trackItem.duration = searchRes[0].duration;
          }
          if (searchRes[0].seconds) {
            trackItem.durationMs = searchRes[0].seconds * 1000;
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

  // TẦNG 1: Thử phát từ YouTube URL chính
  try {
    return await createSingleStream(targetUrl, crossfadeSeconds, seekSeconds, false);
  } catch (ytErr) {
    const errMsg = ytErr.message.split('\n')[0];
    console.warn(`[YouTube Stream Blocked/Failed for "${trackTitle}"]: ${errMsg}`);

    const rawTitle = typeof trackItem === 'object' ? (trackItem.title || trackItem.searchQuery || '') : (trackTitle || '');
    const cleanTitle = (rawTitle || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ')
      .replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official|full\s*hd|4k|1080p)/gi, ' ')
      .replace(/[-|:/\\–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // TẦNG 1.5: Thử tìm các bản YouTube thay thế (Duyệt nhiều bản để vượt qua bot check)
    if (cleanTitle) {
      try {
        console.log(`[YouTube Alternate] Đang tìm bản YouTube thay thế cho "${cleanTitle}"...`);
        const ytsResults = await yts(cleanTitle);
        if (ytsResults && ytsResults.videos && ytsResults.videos.length > 0) {
          const targetId = (typeof targetUrl === 'string')
            ? (targetUrl.match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || '')
            : '';
          const userWantsRemix = /\b(remix|mashup|vinahouse|dj\b|mix|nonstop|liên\s*khúc)\b/i.test(trackTitle || '');
          const candidateVideos = ytsResults.videos.filter(v => {
            if (!v || !v.url) return false;
            if (targetId && v.videoId === targetId) return false;
            if (v.seconds && (v.seconds < 45 || v.seconds > 600)) return false;
            if (!userWantsRemix) {
              const t = (v.title || '').toLowerCase();
              if (/\b(remix|mashup|vinahouse|bass\s*boosted|parody|karaoke|beat|slowed|speed\s*up)\b/i.test(t)) return false;
            }
            return true;
          });

          for (const altVideo of candidateVideos.slice(0, 4)) {
            try {
              console.log(`[YouTube Alternate] Thử phát bản thay thế: "${altVideo.title}" (${altVideo.url})`);
              const resource = await createSingleStream(altVideo.url, crossfadeSeconds, seekSeconds, false);
              if (typeof trackItem === 'object' && trackItem !== null) {
                trackItem.url = altVideo.url;
              }
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

    // TẦNG 2 (FAILOVER SOUNDCLOUD CÓ LỌC NGHIÊM NGẶT & DUYỆT NHIỀU ỨNG VIÊN):
    // Duyệt qua danh sách kết quả, bỏ qua các bản DRM Go+ để phát bản hợp lệ tốt nhất
    console.log(`[Failover] Đang tìm kiếm bản phát chuẩn trên SoundCloud cho "${trackTitle}"...`);
    try {
      const is247Track = Boolean(trackItem && (trackItem.is247 || trackItem.requestedBy === 'Auto (24/7)' || trackItem.requestedBy === 'Auto'));
      const scSearchQuery = is247Track ? `${cleanTitle || 'lofi hip hop'} instrumental` : (cleanTitle || 'lofi chill');
      const scInfo = await ytdlp(`scsearch10:${scSearchQuery}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true
      });

      if (scInfo && scInfo.entries && scInfo.entries.length > 0) {
        const userWantsRemix = /\b(remix|mashup|vinahouse|dj\b|mix|nonstop|liên\s*khúc)\b/i.test(trackTitle || '');
        const candidateTracks = scInfo.entries.filter(e => {
          if (!e || (!e.url && !e.webpage_url)) return false;
          // Loại bỏ bài quá ngắn (<45s là preview SoundCloud Go+) hoặc quá dài (>600s là playlist/mashup 20 phút)
          if (e.duration && (e.duration < 45 || e.duration > 600)) return false;
          const titleLower = (e.title || '').toLowerCase();

          // Chặn triệt để các bài meme, nhạc chế, hài hước, troll mạng
          if (/\b(khá\s*bảnh|kha\s*banh|mặt\s*lồn|troll|meme|chế|hài|đụ|đụ\s*má|vãi|bựa|tiktok\s*remix|quẩy|nhạc\s*chế)\b/i.test(titleLower)) {
            return false;
          }

          if (is247Track) {
            // Chế độ 24/7 Lofi bắt buộc phải là Lofi/Chill/Instrumental chuẩn, không lời
            if (!/\b(lofi|lo-fi|chill|beats?|instrumental|relax|study|coffee|sleep|ambient|piano|jazzhop)\b/i.test(titleLower)) {
              return false;
            }
          }

          if (!userWantsRemix) {
            if (/\b(playlist|mashup|vinahouse|dj\b|nonstop|liên\s*khúc|tổng\s*hợp|remix|flip|bootleg)\b/i.test(titleLower)) return false;
          }
          return true;
        });

        const expectedSec = (typeof trackItem === 'object' && trackItem !== null)
          ? (trackItem.spotifyDurationSec || (trackItem.durationMs ? Math.round(trackItem.durationMs / 1000) : (trackItem.duration ? parseDurationToSec(trackItem.duration) : 0)))
          : 0;

        // Sắp xếp ưu tiên:
        // 1. Đưa các bản karaoke/guide xuống sau bản vocal gốc nếu người dùng không yêu cầu karaoke
        // 2. So khớp thời lượng: ưu tiên bài có độ dài gần nhất với bản gốc (tránh chọn trúng bản bị cắt xén intro/outro)
        if (!userWantsRemix) {
          candidateTracks.sort((a, b) => {
            const aKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(a.title || '');
            const bKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(b.title || '');
            if (aKaraoke && !bKaraoke) return 1;
            if (!aKaraoke && bKaraoke) return -1;

            if (expectedSec > 45 && a.duration && b.duration) {
              const diffA = Math.abs(a.duration - expectedSec);
              const diffB = Math.abs(b.duration - expectedSec);
              return diffA - diffB;
            }
            return 0;
          });
        }

        // Lần lượt thử stream các ứng viên, nếu gặp bản bị DRM Go+ thì tự động thử ngay ứng viên tiếp theo
        for (const candidate of candidateTracks.slice(0, 6)) {
          try {
            const streamUrl = candidate.webpage_url || candidate.url;
            console.log(`[SoundCloud] Đang thử phát ứng viên: "${candidate.title}" (${candidate.duration}s)...`);
            const resource = await createSingleStream(streamUrl, crossfadeSeconds, seekSeconds, true);
            console.log(`[SoundCloud] Phát thành công bản chuẩn: "${candidate.title}"`);
            return resource;
          } catch (scStreamErr) {
            console.warn(`[SoundCloud Candidate DRM/Failed - thử tiếp]: "${candidate.title}" - ${scStreamErr.message.split('\n')[0]}`);
          }
        }
      }
    } catch (scSearchErr) {
      console.warn('[SoundCloud Search Filter Error]:', scSearchErr.message);
    }

    throw new Error(`Không thể phát bài hát "${trackTitle}": Cả nguồn YouTube và SoundCloud đều không tìm thấy bản thu chuẩn hợp lệ.`);
  }
}

/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web
 */
/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web (Siêu tốc độ)
 */
async function searchMultipleTracks(query, limit = 20, mode = 'official') {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  query = query.trim();

  if (query.startsWith('http')) {
    const directRes = await searchTrack(query);
    return directRes || [];
  }

  // Helper chạy tác vụ với timeout an toàn, tránh treo Node.js Event Loop
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Search timeout (${ms}ms)`)), ms))
  ]);

  // 1. Ưu tiên cao nhất: yt-search (Lấy cả Playlists/Albums và Videos đầy đủ)
  try {
    const isPlaylistQuery = /\balbum\b|\bplaylist\b|\btuyển tập\b|\bdanh sách phát\b/i.test(query);
    const r = await withTimeout(yts(query), 4000);
    if (r) {
      const playlistResults = (r.playlists || []).slice(0, isPlaylistQuery ? 8 : 4).map(p => ({
        title: p.title,
        url: p.url,
        duration: p.videoCount ? `${p.videoCount} bài` : 'Playlist',
        thumbnail: p.thumbnail || `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120`,
        artist: p.author?.name || 'YouTube Playlist',
        isPlaylist: true,
        itemCount: p.videoCount,
        isLive: false
      }));

      let rawVideos = r.videos || [];
      const userWantsRemix = /\b(remix|mix|mashup|vinahouse|cover|speed\s*up|slowed|nightcore|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi)\b/i.test(query);

      if (mode === 'official' && !userWantsRemix) {
        const remixPattern = /\b(remix|mashup|vinahouse|bass\s*boosted|speed\s*up|slowed|nightcore|cover|parody|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi\s*ver|tiktok)/i;
        const cleanOfficialVideos = rawVideos.filter(v => {
          const title = (v.title || '').toLowerCase();
          if (v.seconds > 600) return false; // Loại bỏ video dài > 10 phút (1 hour mix, compilation)
          if (remixPattern.test(title)) return false; // Lọc sạch remix, cover, vinahouse, v.v.
          return true;
        });

        // Nếu có các bản thu chuẩn, chỉ hiển thị bản thu chuẩn
        if (cleanOfficialVideos.length >= 2) {
          rawVideos = cleanOfficialVideos;
        } else if (cleanOfficialVideos.length > 0) {
          // Đưa các bản thu chuẩn lên đầu danh sách
          const cleanIds = new Set(cleanOfficialVideos.map(v => v.videoId));
          rawVideos = [...cleanOfficialVideos, ...rawVideos.filter(v => !cleanIds.has(v.videoId))];
        }

        const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        rawVideos = rawVideos.map(v => {
          let score = 0;
          const title = (v.title || '').toLowerCase();
          const author = (v.author?.name || '').toLowerCase();

          // Khớp từ khóa tìm kiếm
          const matchedWords = qWords.filter(w => title.includes(w) || author.includes(w));
          score += (matchedWords.length / Math.max(1, qWords.length)) * 100;

          // Điểm cộng kênh chính chủ và bản thu chuẩn
          if (author.includes('topic') || author.includes('official') || author.includes('records') || author.includes('vevo')) score += 40;
          // Ưu tiên mạnh bản audio
          if (title.includes('official audio') || title.includes('(audio)') || title.includes('audio version')) score += 50;
          if (title.includes('audio') || title.includes('bản thu')) score += 25;
          if (title.includes('lyric video') || title.includes('lyrics')) score += 15;

          // Phạt nhẹ MV nếu đã có bản audio (để bản audio/bản thu chuẩn xếp trên MV)
          if (title.includes('official music video') || title.includes('official mv') || title.includes('official video') || title.includes('(mv)') || title.includes('[mv]')) {
            score -= 10;
          }

          return { ...v, score };
        }).sort((a, b) => b.score - a.score);
      }

      const videoResults = rawVideos.map(v => ({
        title: v.title,
        url: v.url,
        duration: v.timestamp || (v.seconds ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}` : '3:30'),
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        artist: v.author?.name || 'YouTube',
        isPlaylist: false,
        isLive: Boolean(v.live)
      }));

      // Nếu từ khóa chứa 'album' hoặc 'playlist' -> Ưu tiên playlist lên đầu!
      const combined = isPlaylistQuery
        ? [...playlistResults, ...videoResults]
        : (playlistResults.length > 0 ? [playlistResults[0], ...videoResults, ...playlistResults.slice(1)] : videoResults);

      if (combined.length > 0) {
        return combined.slice(0, Math.min(limit, 25));
      }
    }
  } catch (ytsErr) {
    console.warn('[searchMultipleTracks yt-search notice]:', ytsErr.message);
  }

  // 2. Fallback nhẹ qua play-dl (không spawn process nặng)
  try {
    const searchResults = await withTimeout(
      play.search(query, { limit: Math.min(limit, 15), source: { youtube: 'video' } }),
      3000
    );
    if (searchResults && searchResults.length > 0) {
      return searchResults.map(track => ({
        title: track.title,
        url: track.url,
        duration: track.durationRaw || '3:30',
        thumbnail: resolveBestThumbnail(track),
        artist: track.channel?.name || 'YouTube',
        isLive: Boolean(track.live)
      }));
    }
  } catch (err) {}

  // 3. Fallback an toàn qua yt-dlp nếu cả yt-search và play-dl đều không trả về kết quả
  try {
    const smOpts = {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true
    };
    const cFile = getCookiesFile();
    if (cFile) smOpts.cookies = cFile;
    const ytRes = await withTimeout(
      ytdlp(`ytsearch${Math.min(limit, 15)}:${query}`, smOpts),
      4500
    );
    if (ytRes && ytRes.entries && Array.isArray(ytRes.entries) && ytRes.entries.length > 0) {
      return ytRes.entries.map(e => ({
        title: e.title,
        url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
        duration: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '3:30',
        thumbnail: resolveBestThumbnail(e),
        artist: e.uploader || e.channel || 'YouTube',
        isLive: false
      })).filter(t => t.url);
    }
  } catch (ytErr) {
    console.warn('[searchMultipleTracks yt-dlp fallback notice]:', ytErr.message);
  }

  return [];
}

module.exports = {
  searchTrack,
  searchMultipleTracks,
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack,
  getRelatedTrack,
  createResource
};
