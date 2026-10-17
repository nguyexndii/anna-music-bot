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
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const fetch = globalThis.fetch || require('node-fetch');
const spotifyUrlInfo = require('spotify-url-info')(fetch);
const { executeSearch } = require('./searchService');

// Đường dẫn file cookies YouTube (Netscape format). Cài trong .env: YTDLP_COOKIES_FILE=/root/anna-music-bot/youtube.cookies
// File này giúp yt-dlp xác thực để bypass kiểm tra bot của YouTube trên Datacenter IP
function getCookiesFile() {
  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(__dirname, '../../youtube.cookies'),
    path.resolve(process.cwd(), 'youtube.cookies'),
    '/root/anna-music-bot/youtube.cookies'
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const stat = fs.statSync(c);
        if (stat.isFile() && stat.size > 100) {
          const sample = fs.readFileSync(c, 'utf8').slice(0, 300);
          if (sample.includes('NETSCAPE') || sample.includes('.youtube.com') || sample.includes('# HTTP Cookie File')) {
            return c;
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

// Cấu hình player client bypass kiểm tra bot của YouTube trên Datacenter IP
const YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=android,mweb';
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

function normalizeSearchText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nhận diện video là bản diễn live trên sân khấu / fancam / concert / listening party / demo
 */
function isLiveStageVideo(title) {
  if (!title || typeof title !== 'string') return false;
  return /(?:\[\s*live|\(\s*live|[\-|–—|]\s*live(?:\s+(?:at|in|on|version|ver|stage|performance)|$|\s*[)\]|])|\blive\s*(?:ver|version|performance|stage|session|at\b|in\b|listening)|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bon\s*stage\b|\bstage\s*(?:ver|version)?\b|\bdemo\b)/i.test(title);
}

/**
 * Đánh giá độ khớp toàn diện giữa từ khóa tìm kiếm và ứng viên video YouTube.
 * Bắt buộc ưu tiên tên bài hát và ca sĩ chính xác lên hàng đầu, ngăn tuyệt đối việc
 * bắt nhầm sang bài khác chỉ vì có thời lượng trùng khớp (như sự cố bài 'Truy Lùng' bị đổi thành 'nguyên xi').
 */
function scoreCandidateVideo(v, query, targetDurationSec = 0) {
  if (!v) return -999;
  const vTitleNorm = normalizeSearchText(v.title);
  const vAuthorNorm = normalizeSearchText(v.author?.name || v.uploader || v.channel || '');
  const vCombined = `${vTitleNorm} ${vAuthorNorm}`;

  const cleanQ = query.replace(/\b(audio|official|mv|video|lyric|lyrics)\b/gi, '').trim();
  const parts = cleanQ.split(/\s+[-–—|]\s+/).map(p => p.trim()).filter(Boolean);

  let titlePart = parts[0] || cleanQ;
  let artistPart = parts.length > 1 ? parts.slice(1).join(' ') : '';

  const normTitle = normalizeSearchText(titlePart);
  const normArtist = normalizeSearchText(artistPart);

  const titleWords = normTitle.split(' ').filter(w => w.length >= 2 && !['audio', 'video', 'mv', 'official'].includes(w));
  const artistWords = normArtist ? normArtist.split(' ').filter(w => w.length >= 2) : [];

  let score = 0;

  // 1. So khớp tên bài hát (tiêu chí quan trọng nhất)
  if (normTitle && vTitleNorm.includes(normTitle)) {
    score += 100;
  } else if (titleWords.length > 0) {
    const matchedCount = titleWords.filter(w => vTitleNorm.includes(w)).length;
    const ratio = matchedCount / titleWords.length;
    score += ratio * 70;
    if (ratio === 0) {
      score -= 120; // Phạt cực nặng nếu tiêu đề hoàn toàn không chứa bất kỳ từ khóa nào của bài hát!
    }
  }

  // 2. So khớp ca sĩ / tác giả
  if (normArtist) {
    if (vAuthorNorm.includes(normArtist)) {
      score += 40; // Kênh chính thức của ca sĩ/nghệ sĩ
    } else if (vTitleNorm.includes(normArtist)) {
      score += 25; // Tiêu đề chứa tên ca sĩ
    } else if (artistWords.length > 0) {
      const matchedArt = artistWords.filter(w => vCombined.includes(w)).length;
      score += (matchedArt / artistWords.length) * 20;
    }
  }

  // 3. Phạt teaser / trailer / reaction / review / parody
  if (/\b(teaser|trailer|reaction|review|preview|tập\s*\d+|parody|hậu\s*trường|behind\s*the\s*scenes)\b/i.test(vTitleNorm)) {
    score -= 80;
  }

  // 3.1 Phạt nặng bản hát Live sân khấu / Fancam / Concert / Listening party / Demo nếu người dùng không yêu cầu Live
  const userWantsLive = /(?:\[\s*live|\(\s*live|\blive\b|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bdemo\b)/i.test(cleanQ);
  if (!userWantsLive && isLiveStageVideo(v.title)) {
    score -= 100; // Phạt nặng để ưu tiên bản phòng thu chính thức (Official Studio Audio/MV)
  }

  // 4. Ưu tiên topic / audio / lyric video / official / album track / studio
  if (vAuthorNorm.includes('topic') || vTitleNorm.includes('topic')) score += 20;
  if (/\b(official\s*(?:audio|video|music\s*video|mv|lyric|lyrics)?|audio|lyric|lyrics|album|studio|visualizer)\b/i.test(vTitleNorm)) score += 15;

  // 5. So khớp thời lượng nếu có targetDurationSec
  if (targetDurationSec > 0 && v.seconds > 0) {
    const diff = Math.abs(v.seconds - targetDurationSec);
    if (diff <= 3) score += 35;
    else if (diff <= 6) score += 20;
    else if (diff <= 15) score += 10;
    else if (diff > 60) score -= Math.min(50, Math.floor((diff - 60) / 2));
  }

  return score;
}

const DEFAULT_FALLBACK_THUMB = 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';

/**
 * Trích xuất ảnh thumbnail chất lượng cao và chuẩn xác nhất cho bài hát YouTube/Web
 */
function resolveBestThumbnail(entry, fallbackId = null) {
  if (!entry && !fallbackId) return DEFAULT_FALLBACK_THUMB;
  
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

  return DEFAULT_FALLBACK_THUMB;
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
            thumbnail: item.track.album?.images?.[0]?.url || DEFAULT_FALLBACK_THUMB,
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

const ALLOWED_MUSIC_HOSTNAMES = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'open.spotify.com',
  'spotify.com',
  'soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com'
]);

/**
 * Kiểm tra và chuẩn hóa URL âm nhạc: Chống Argument Injection, Whitelist Hostname HTTPS và Chặn SSRF
 * @param {string} rawUrl
 * @returns {string|null} URL hợp lệ hoặc null
 */
function validateAndSanitizeMusicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  // 1. Chống Argument Injection vào yt-dlp / ffmpeg CLI
  if (trimmed.startsWith('-')) return null;

  // 2. Nếu là URL có protocol
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      // Bắt buộc giao thức HTTPS bảo mật
      if (parsed.protocol !== 'https:') return null;

      const hostname = parsed.hostname.toLowerCase().trim();

      // Chặn các IP nội bộ / private / loopback
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === '::1' ||
        hostname === '[::1]' ||
        hostname === '0.0.0.0' ||
        hostname === '0' ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return null;
      }

      // Whitelist domain âm nhạc tin cậy
      const isAllowed = ALLOWED_MUSIC_HOSTNAMES.has(hostname) ||
        Array.from(ALLOWED_MUSIC_HOSTNAMES).some(h => hostname.endsWith('.' + h));
      if (!isAllowed) return null;

      return trimmed;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Kiểm tra xem một URL có an toàn để trích xuất âm thanh không (Ngăn chặn tấn công SSRF)
 * Chặn: localhost, private IPv4/IPv6, link-local, cloud metadata service (169.254.169.254)
 */
function isSafeExternalUrl(urlStr) {
  return Boolean(validateAndSanitizeMusicUrl(urlStr));
}

/**
 * Tìm kiếm và trích xuất thông tin bài hát / Playlist từ YouTube, Spotify, SoundCloud
 * (Tối đa 100 bài đối với Playlist)
 */
async function searchTrack(query, targetDurationSec = 0) {
  try {
    if (!query || typeof query !== 'string') return null;

    let cleanQuery = query.trim();
    // Chống Argument Injection: chặn chuỗi bắt đầu bằng dấu trừ
    if (cleanQuery.startsWith('-')) return null;

    // Giới hạn độ dài từ khóa tìm kiếm tối đa 150 ký tự
    cleanQuery = cleanQuery.slice(0, 150).trim();

    // Kiểm tra an toàn bảo mật SSRF cho đường dẫn URL ngoại vi
    if (cleanQuery.startsWith('http://') || cleanQuery.startsWith('https://')) {
      const sanitizedUrl = validateAndSanitizeMusicUrl(cleanQuery);
      if (!sanitizedUrl) {
        console.warn(`[Security Alert: SSRF / Invalid Hostname Blocked] URL không an toàn bị từ chối: ${cleanQuery}`);
        return null;
      }
      cleanQuery = sanitizedUrl;
    }

    // Tự động chuẩn hóa link Spotify nếu thiếu protocol
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
          // Ưu tiên tìm kiếm chuẩn theo thời lượng Spotify
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
          return limited.map((e, idx) => {
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

    // 6. Tìm kiếm YouTube cho từ khóa qua Worker Thread + InnerTube API (Lag Event Loop = 0ms)
    try {
      const results = await executeSearch(cleanQuery, 5, 'official');
      if (results && results.length > 0) {
        return [results[0]];
      }
    } catch (workerSearchErr) {
      console.warn('[searchTrack executeSearch worker error, fallback play-dl]:', workerSearchErr.message);
    }

    // Fallback nhẹ qua play-dl nếu worker gặp sự cố
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

const { getGeminiRecommendation } = require('./geminiHelper');
const historyManager = require('../structures/HistoryManager');
const settingsManager = require('../structures/SettingsManager');

/**
 * Kiểm tra xem một bài hát có nằm trong lịch sử phát gần nhất không (Hỗ trợ cả Video ID, URL và Tiêu đề)
 */
function isTrackInHistory(track, guildId, playedList, limit = 25) {
  if (!track) return false;
  if (guildId && historyManager.isRecentlyPlayed(guildId, track, limit)) {
    return true;
  }
  if (Array.isArray(playedList) && playedList.length > 0) {
    const trackUrl = typeof track === 'object' ? track.url : track;
    const trackTitle = typeof track === 'object' ? track.title : '';
    const trackId = historyManager.extractVideoId ? historyManager.extractVideoId(trackUrl) : null;
    const getTokens = historyManager.getKeywords || ((s) => s.toLowerCase().split(/\s+/));
    const tTokens = trackTitle ? getTokens(trackTitle) : [];

    for (const p of playedList.slice(0, limit)) {
      if (!p) continue;
      const pUrl = typeof p === 'object' ? p.url : p;
      const pTitle = typeof p === 'object' ? p.title : '';
      const pId = historyManager.extractVideoId ? historyManager.extractVideoId(pUrl) : null;
      if (trackId && pId && trackId === pId) return true;
      if (trackUrl && pUrl && trackUrl === pUrl) return true;
      if (tTokens.length > 0 && pTitle) {
        const pTokens = getTokens(pTitle);
        if (pTokens.length > 0) {
          const matches = tTokens.filter(t => pTokens.includes(t));
          if ((matches.length / Math.min(tTokens.length, pTokens.length)) >= 0.7) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Biểu thức chính quy phát hiện tiếng Việt có dấu
 */
const VIETNAMESE_ACCENTED_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * 1. Nhận diện vùng quốc gia/ngôn ngữ của bài hát: 'VI', 'KR', 'JP', 'CN', 'INTL'
 */
function detectTrackRegion(title = '', artist = '') {
  const combined = `${title} ${artist}`.trim();
  if (!combined) return 'INTL';

  // 1. Kiểm tra ký tự tiếng Việt có dấu
  if (VIETNAMESE_ACCENTED_REGEX.test(combined)) {
    return 'VI';
  }

  // 2. Kiểm tra tiếng Hàn (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(combined) || /\b(k-pop|kpop|ost\s*part)\b/i.test(combined)) {
    return 'KR';
  }

  // 3. Kiểm tra tiếng Nhật (Hiragana / Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(combined) || /\b(j-pop|jpop|anime\s*ost)\b/i.test(combined)) {
    return 'JP';
  }

  // 4. Kiểm tra tiếng Trung (Hán tự)
  if (/[\u4E00-\u9FFF]/.test(combined) || /\b(c-pop|cpop|douyin|nhạc\s*hoa)\b/i.test(combined)) {
    return 'CN';
  }

  // 5. Danh sách từ khóa & nghệ sĩ V-Pop không dấu phổ biến
  const vnKeywords = /\b(v-pop|vpop|nhac tre|viet nam|vietnamese|nhac viet|bolero|nhac vang|son tung|mtp|hieuthuhai|mck|madihu|grey d|chillies|hoang dung|den vau|erik|duc phuc|soobin|mono|wren evans|suni ha linh|phuong ly|justatee|rhymastic|binz|tlinh|low g|obito|24k\.right|b ray|karik|quang dung|tuan ngoc|le quyen|bui anh tuan|mr siro|phan manh quynh|trung quan|bao anh|hoa minzy|hoang thuy linh|bich phuong|ha anh tuan|my tam|vinahouse|nhac song|lien khuc)\b/i;
  if (vnKeywords.test(combined)) {
    return 'VI';
  }

  // 6. Danh sách nghệ sĩ K-Pop phổ biến không dấu
  const krKeywords = /\b(bts|blackpink|newjeans|twice|stray kids|txt|enhypen|aespa|ive|le sserafim|iu|taeyeon|exo|bigbang|big bang|seventeen|red velvet|itzy|nmixx|gidle|g-idle)\b/i;
  if (krKeywords.test(combined)) {
    return 'KR';
  }

  // 7. Danh sách nghệ sĩ J-Pop phổ biến
  const jpKeywords = /\b(yoasobi|ado|kenshi yonezu|eve|fujii kaze|aimyon|radwimps)\b/i;
  if (jpKeywords.test(combined)) {
    return 'JP';
  }

  // 8. Mặc định là Nhạc Quốc Tế / US-UK
  return 'INTL';
}

/**
 * 2. Phân tích chi tiết nguồn gốc và metadata bài hát: Bóc tách ca sĩ/tên bài thật, lọc kênh reup/lyric
 */
function analyzeTrackOriginAndMeta(song) {
  if (!song) return { realTitle: '', realArtist: '', region: 'INTL', isRemix: false, isAcoustic: false };

  const rawTitle = typeof song === 'object' ? (song.title || song.searchQuery || '') : String(song || '');
  const rawArtist = typeof song === 'object' ? (song.artist || song.uploader || '') : '';

  // Nhận diện các kênh chuyên đăng lại (Lyric / Reup channel)
  const isReupChannel = /(7clouds|syrebralvibes|taj tracks|unique vibes|lofi girl|cassiopeia|tiktok music|vibes only|superblyrics|chill tracks|sensual musique|dynmk|chillwithtaiki)/i.test(rawArtist);
  const isLyricTitle = /\((?:lyrics?|lyric video|vietsub)\)|\[(?:lyrics?|lyric video|vietsub)\]/i.test(rawTitle);

  let realArtist = '';
  let realTitle = '';

  if ((isReupChannel || isLyricTitle) && rawTitle.includes('-')) {
    const parts = rawTitle.split('-');
    realArtist = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    realTitle = parts.slice(1).join('-')
      .replace(/\[.*?\]|\(.*?\)/g, '')
      .replace(/official|audio|video|lyrics?|vietsub/gi, '')
      .trim();
  } else {
    const parsed = parseArtistAndTitle(rawTitle);
    realArtist = (rawArtist && !/youtube|topic/i.test(rawArtist)) ? rawArtist : parsed.artist;
    realTitle = parsed.songName || rawTitle;
  }

  const region = detectTrackRegion(`${realTitle} ${realArtist}`, realArtist);
  const isRemix = /\b(remix|vinahouse|vinahey|dance|edm|quẩy|nonstop|dj\b|mashup)\b/i.test(rawTitle);
  const isAcoustic = /\b(acoustic|chill|lofi|ballad|buồn|guitar|piano)\b/i.test(rawTitle);

  return {
    realTitle: realTitle || rawTitle,
    realArtist: realArtist || rawArtist || 'YouTube',
    region,
    isRemix,
    isAcoustic,
    rawTitle,
    rawArtist
  };
}

/**
 * 3. Bộ lọc cứng ứng viên Autoplay: Khóa chặt ngôn ngữ & vibe, loại bỏ video rác/ngắn/dài
 */
function isCandidateMatchingRegion(candidate, targetRegion, seedMeta = null) {
  if (!candidate || !candidate.title) return false;
  const candTitle = candidate.title;
  const candArtist = candidate.artist || candidate.uploader || '';
  const candCombined = `${candTitle} ${candArtist}`;

  // 1. CHẶN TUYỆT ĐỐI NHẢY VÙNG (STRICT REGION LOCK):
  const hasViAccents = VIETNAMESE_ACCENTED_REGEX.test(candCombined);
  const hasViKeywords = /\b(nhac tre|v-pop|vpop|nhac viet|remix viet|karaoke|beat chuan|tong nam|tong nu|tone nam|tone nu|nhac song|lien khuc|nhac vang|bolero|dan ca)\b/i.test(candCombined);

  if (targetRegion && targetRegion !== 'VI') {
    // Đang nghe nhạc ngoại (INTL, KR, JP, CN) -> CHẶN TUYỆT ĐỐI bài Việt Nam!
    if (hasViAccents || hasViKeywords) {
      return false;
    }
  } else if (targetRegion === 'VI') {
    // Đang nghe nhạc Việt -> Ưu tiên tuyệt đối bài Việt Nam
    const candRegion = detectTrackRegion(candTitle, candArtist);
    if (candRegion !== 'VI' && !hasViAccents && !hasViKeywords) {
      return false;
    }
  }

  // 2. LỌC THỜI LƯỢNG (Chuẩn bài hát: 75 giây đến 600 giây)
  const durationSec = candidate.seconds || (candidate.duration ? parseDurationToSec(candidate.duration) : 0);
  if (durationSec > 0 && (durationSec < 75 || durationSec > 600)) {
    return false;
  }

  // 3. LỌC NỘI DUNG RÁC (Karaoke, Beat, Reaction, Tập phim, Parody, Live Stage)
  const junkRegex = /\b(karaoke|beat chuẩn|beat karaoke|reaction|parody|tập\s*\d+|phim ngắn|hậu trường|behind the scenes|tiktok compilation)\b/i;
  if (junkRegex.test(candTitle)) {
    return false;
  }
  if (isLiveStageVideo(candTitle)) {
    return false;
  }

  // 4. LỌC VIBE & PHONG CÁCH:
  // Nếu bài gốc KHÔNG PHẢI remix/vinahouse -> Chặn bài ứng viên remix/quẩy
  if (seedMeta && !seedMeta.isRemix) {
    if (/\b(remix|vinahouse|vinahey|bassboost|quẩy|dj\b|mashup|nonstop)\b/i.test(candTitle)) {
      return false;
    }
  }

  return true;
}

/**
 * Lớp 1 (Ưu tiên cao nhất): Lấy bài tương tự từ YouTube Mix (RD<videoId>)
 * Duyệt tối đa 25 bài, lọc ngôn ngữ/vibe và chọn ngẫu nhiên có trọng số trong Top 3 bài đạt chuẩn
 */
async function getYoutubeMix(lastSong, guildId = null, playedList = [], targetRegion = null) {
  if (!lastSong || !lastSong.url) return null;

  try {
    const match = lastSong.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (!match || !match[1]) return null;

    const videoId = match[1];
    const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

    const seedMeta = analyzeTrackOriginAndMeta(lastSong);
    const region = targetRegion || seedMeta.region;

    const mixOpts = {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      playlistEnd: 25,
      extractorArgs: YTDLP_EXTRACTOR_ARGS
    };

    let res = null;
    try {
      res = await ytdlp(mixUrl, mixOpts);
    } catch (anonErr) {
      const cFile = getCookiesFile();
      if (cFile) {
        mixOpts.cookies = cFile;
        res = await ytdlp(mixUrl, mixOpts).catch(() => null);
      }
    }

    if (res && res.entries && res.entries.length > 0) {
      const validCandidates = [];

      for (const entry of res.entries) {
        if (!entry || !entry.title) continue;

        const trackUrl = entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
        if (!trackUrl) continue;

        // Bỏ qua bài vừa phát
        if (trackUrl === lastSong.url || (entry.id && entry.id === videoId)) {
          continue;
        }

        // Bỏ qua bài đã phát trong 25 bài gần nhất
        if (isTrackInHistory(entry, guildId, playedList, 25)) {
          continue;
        }

        // Lọc nghiêm ngặt theo vùng ngôn ngữ và thể loại
        if (!isCandidateMatchingRegion(entry, region, seedMeta)) {
          continue;
        }

        validCandidates.push({
          title: entry.title,
          url: trackUrl,
          duration: entry.duration ? `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}` : '3:30',
          thumbnail: entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null),
          isLive: false,
          requestedBy: 'Auto'
        });

        if (validCandidates.length >= 5) break;
      }

      // Chọn ngẫu nhiên có trọng số (Weighted Random) trong Top 3 bài đạt chuẩn
      if (validCandidates.length > 0) {
        const topCount = Math.min(validCandidates.length, 3);
        const weights = topCount === 1 ? [1] : (topCount === 2 ? [0.65, 0.35] : [0.55, 0.30, 0.15]);
        const r = Math.random();
        let acc = 0;
        let chosenIdx = 0;
        for (let i = 0; i < weights.length; i++) {
          acc += weights[i];
          if (r <= acc) {
            chosenIdx = i;
            break;
          }
        }
        return validCandidates[chosenIdx];
      }
    }
  } catch (err) {
    console.warn('[Autoplay YouTube Mix Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 2 (Fallback thứ 2): Lấy bài tương tự từ Last.fm Similar Track API (Khóa chặt tên nghệ sĩ sạch)
 */
async function getLastfmSimilar(lastSong, guildId = null, playedList = [], targetRegion = null) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey || !lastSong || !lastSong.title) return null;

  try {
    const seedMeta = analyzeTrackOriginAndMeta(lastSong);
    const region = targetRegion || seedMeta.region;
    const artist = seedMeta.realArtist;
    const songName = seedMeta.realTitle;

    if (!artist || !songName || artist === 'YouTube') return null;

    const apiUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(songName)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=15`;
    const response = await fetch(apiUrl);
    if (!response.ok) return null;

    const data = await response.json();
    const tracks = data?.similartracks?.track;
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return null;

    for (const simTrack of tracks) {
      const trackName = simTrack.name;
      const trackArtist = typeof simTrack.artist === 'string' ? simTrack.artist : (simTrack.artist?.name || '');
      const fullQuery = `${trackName} ${trackArtist} official audio`.trim();

      if (isTrackInHistory({ title: fullQuery, url: null }, guildId, playedList, 25)) {
        continue;
      }

      // Xác định locale cho searchTrack theo vùng
      const searchLocale = region === 'VI' ? 'vi' : 'en';
      const results = await searchMultipleTracks(fullQuery, 5, 'official');
      if (results && results.length > 0) {
        for (const found of results) {
          if (found && found.url && found.url !== lastSong.url && !isTrackInHistory(found, guildId, playedList, 25)) {
            if (isCandidateMatchingRegion(found, region, seedMeta)) {
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
      }
    }
  } catch (err) {
    console.warn('[Autoplay Last.fm Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 3 (Fallback cuối cùng): Logic Heuristic nhận diện thể loại / ca sĩ theo đúng vùng quốc gia
 */
async function getHeuristicRelatedTrack(lastSong, guildId = null, playedList = [], targetRegion = null) {
  if (!lastSong || !lastSong.title) return null;

  try {
    const seedMeta = analyzeTrackOriginAndMeta(lastSong);
    const region = targetRegion || seedMeta.region;
    const { realArtist: artist, realTitle: cleanSong, isRemix, isAcoustic } = seedMeta;

    const searchQueries = [];

    if (region === 'INTL') {
      // US-UK: Tuyệt đối không dùng từ khóa tiếng Việt
      if (artist && artist !== 'YouTube') {
        searchQueries.push(`ytsearch8:${artist} greatest hits official audio`);
        searchQueries.push(`ytsearch8:${artist} official audio`);
      }
      searchQueries.push(`ytsearch8:${cleanSong} ${artist} official audio`);
      searchQueries.push(`ytsearch8:${cleanSong} official audio`);
    } else if (region === 'KR') {
      // K-Pop:
      if (artist && artist !== 'YouTube') {
        searchQueries.push(`ytsearch8:${artist} official audio MV`);
        searchQueries.push(`ytsearch8:${artist} top songs`);
      }
      searchQueries.push(`ytsearch8:${cleanSong} ${artist} official`);
    } else if (region === 'JP') {
      // J-Pop:
      if (artist && artist !== 'YouTube') {
        searchQueries.push(`ytsearch8:${artist} official MV`);
      }
      searchQueries.push(`ytsearch8:${cleanSong} ${artist} official audio`);
    } else {
      // Nhạc Việt:
      const lowerTitle = (lastSong.title || '').toLowerCase();
      const isVintageOrBolero = /bolero|nhạc vàng|trịnh|khánh ly|quang dũng|tuấn ngọc|lệ quyên|nhạc xưa|trữ tình|tiền chiến|chế linh|như quỳnh|quang lê/i.test(lowerTitle);

      if (artist && artist.length > 1 && artist !== 'YouTube') {
        if (isVintageOrBolero) {
          searchQueries.push(`ytsearch8:${artist} nhạc trữ tình xưa hay nhất`);
          searchQueries.push(`ytsearch8:${artist} official audio`);
        } else if (isAcoustic) {
          searchQueries.push(`ytsearch8:${artist} bài hát hay nhất`);
          searchQueries.push(`ytsearch8:${artist} official acoustic`);
        } else {
          searchQueries.push(`ytsearch8:${artist} official audio`);
          searchQueries.push(`ytsearch8:${artist} bài hát hay nhất`);
        }
      }

      if (isVintageOrBolero) {
        searchQueries.push(`ytsearch8:${cleanSong} nhạc vàng xưa tuyển chọn`);
      } else if (isAcoustic) {
        searchQueries.push(`ytsearch8:${cleanSong} indie acoustic chill`);
      } else {
        searchQueries.push(`ytsearch8:${cleanSong} ${artist} official audio`);
      }
    }

    for (const query of searchQueries) {
      try {
        const relOpts = {
          dumpSingleJson: true,
          noWarnings: true,
          flatPlaylist: true,
          extractorArgs: YTDLP_EXTRACTOR_ARGS
        };
        const cFile = getCookiesFile();
        if (cFile) relOpts.cookies = cFile;
        const res = await ytdlp(query, relOpts);

        if (res && res.entries && res.entries.length > 0) {
          for (const entry of res.entries) {
            if (!entry || !entry.title) continue;

            const trackUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;
            if (trackUrl === lastSong.url) continue;
            if (isTrackInHistory(entry, guildId, playedList, 25)) continue;

            if (!isCandidateMatchingRegion(entry, region, seedMeta)) {
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
        console.warn(`[Autoplay heuristic failed for query: ${query}]:`, qErr.message);
      }
    }
  } catch (err) {
    console.error('[getHeuristicRelatedTrack Error]:', err.message);
  }
  return null;
}

/**
 * Thuật toán Autoplay Điều Phối Đa Lớp Thông Minh 2.0 (Khóa chặt ngôn ngữ & vibe):
 * 0. Gemini DJ AI (Khi BẬT trong Cài đặt)
 * 1. YouTube Mix (Ưu tiên cao nhất)
 * 2. Last.fm Similar Track (Fallback thứ 2)
 * 3. Heuristic Fallback (Fallback cuối cùng)
 */
async function getRelatedTrack(lastSong, guildIdOrHistory = [], useAi = true, targetRegion = null) {
  if (!lastSong || !lastSong.title) return null;

  const guildId = typeof guildIdOrHistory === 'string' ? guildIdOrHistory : null;
  const playedList = Array.isArray(guildIdOrHistory) ? guildIdOrHistory : (guildId ? historyManager.getHistory(guildId) : []);

  const seedMeta = analyzeTrackOriginAndMeta(lastSong);
  const region = targetRegion || seedMeta.region;

  const guildSettings = guildId ? settingsManager.get(guildId) : null;
  const configuredLayers = (guildSettings && Array.isArray(guildSettings.autoplayLayers) && guildSettings.autoplayLayers.length > 0)
    ? guildSettings.autoplayLayers
    : ['ytmix', 'ai', 'lastfm', 'heuristic'];

  for (const layer of configuredLayers) {
    // 1. Tầng YouTube Mix (list=RD<videoId>)
    if (layer === 'ytmix') {
      const ytMixTrack = await getYoutubeMix(lastSong, guildId, playedList, region);
      if (ytMixTrack) {
        console.log(`[Autoplay] Found via YouTube Mix (${region}): "${ytMixTrack.title}"`);
        return ytMixTrack;
      }
    }

    // 2. Tầng Gemini DJ AI
    else if (layer === 'ai') {
      const aiAllowed = useAi && (guildSettings ? guildSettings.useAiAssistant !== false : true);
      if (aiAllowed) {
        try {
          const aiRec = await getGeminiRecommendation(lastSong, playedList, region);
          if (aiRec && (aiRec.searchQuery || aiRec.title)) {
            const query = aiRec.searchQuery || `${aiRec.title} ${aiRec.artist || ''} official audio`.trim();
            const results = await searchMultipleTracks(query, 5, 'official');
            if (results && results.length > 0) {
              for (const found of results) {
                if (found && found.url && found.url !== lastSong.url && !isTrackInHistory(found, guildId, playedList, 25)) {
                  if (isCandidateMatchingRegion(found, region, seedMeta)) {
                    console.log(`[Autoplay] Found via Gemini DJ AI (${region}): ${found.title} (${aiRec.reason || ''})`);
                    found.requestedBy = 'Auto';
                    return found;
                  }
                }
              }
            }
          }
        } catch (aiErr) {
          console.warn('[Autoplay Gemini AI Warning]:', aiErr.message);
        }
      }
    }

    // 3. Tầng Last.fm Similar Track
    else if (layer === 'lastfm') {
      const lastfmTrack = await getLastfmSimilar(lastSong, guildId, playedList, region);
      if (lastfmTrack) {
        console.log(`[Autoplay] Found via Last.fm (${region}): "${lastfmTrack.title}"`);
        return lastfmTrack;
      }
    }

    // 4. Tầng Heuristic Fallback
    else if (layer === 'heuristic') {
      const heuristicTrack = await getHeuristicRelatedTrack(lastSong, guildId, playedList, region);
      if (heuristicTrack) {
        console.log(`[Autoplay] Found via heuristic fallback (${region}): "${heuristicTrack.title}"`);
        return heuristicTrack;
      }
    }
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
    if (typeof targetQueryOrUrl === 'string' && (targetQueryOrUrl.startsWith('http://') || targetQueryOrUrl.startsWith('https://'))) {
      if (!isSafeExternalUrl(targetQueryOrUrl)) {
        return reject(new Error(`[Security Alert: SSRF Blocked] URL không an toàn: ${targetQueryOrUrl}`));
      }
    }
    const ytdlpOptions = {
      output: '-',
      format: 'bestaudio/best',
      ffmpegLocation: ffmpeg,
      noPlaylist: true,
      noWarnings: true
    };

    if (!isSoundCloud) {
      ytdlpOptions.preferFreeFormats = true;
      ytdlpOptions.extractorArgs = YTDLP_EXTRACTOR_ARGS;
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
    const passThroughStream = new PassThrough({ highWaterMark: 1 << 20 });
    passThroughStream.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[PassThroughStream Error]:', err.message);
      }
    });
    ffmpegProcess.stdout.pipe(passThroughStream);

    // Timeout bảo vệ: Nếu sau 35 giây không có dữ liệu âm thanh nào, tự hủy để failover
    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        reject(new Error('Quá thời gian chờ âm thanh từ nguồn này (Timeout 35s)'));
      }
    }, 35000);

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
          const userWantsLive = /(?:\[\s*live|\(\s*live|\blive\b|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bdemo\b)/i.test(trackTitle || '');
          // Lọc từ khóa cốt lõi để đảm bảo bài thay thế đồng nhất.
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
            if (!userWantsRemix) {
              const t = (v.title || '').toLowerCase();
              if (/\b(remix|mashup|vinahouse|bass\s*boosted|parody|karaoke|beat|slowed|speed\s*up)\b/i.test(t)) return false;
            }

            // BẮT BUỘC: Bản thay thế phải chứa các từ khóa chính của tên bài hát (ít nhất 75% số từ)
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
      let scInfo = await ytdlp(`scsearch10:${scSearchQuery}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true
      });

      // Nếu tìm kiếm chi tiết không có kết quả, thử từ khóa ngắn gọn hơn để không bị rỗng
      if ((!scInfo || !scInfo.entries || scInfo.entries.length === 0) && is247Track && cleanTitle) {
        const compactScQuery = `${cleanTitle.split(/\s+/).slice(0, 3).join(' ')} instrumental`;
        try {
          scInfo = await ytdlp(`scsearch10:${compactScQuery}`, {
            dumpSingleJson: true,
            flatPlaylist: true,
            noWarnings: true
          });
        } catch (e) {}
      }

      if (scInfo && scInfo.entries && scInfo.entries.length > 0) {
        const userWantsRemix = /\b(remix|mashup|vinahouse|dj\b|mix|nonstop|liên\s*khúc)\b/i.test(trackTitle || '');
        let candidateTracks = scInfo.entries.filter(e => {
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

        // Nếu chế độ 24/7 mà ứng viên bị lọc hết (do tên bài không chứa từ khóa lofi trong bộ lọc), lấy bài instrumental bất kỳ hợp lệ
        if (candidateTracks.length === 0 && is247Track && scInfo.entries.length > 0) {
          candidateTracks = scInfo.entries.filter(e => {
            if (!e || (!e.url && !e.webpage_url)) return false;
            if (e.duration && (e.duration < 45 || e.duration > 600)) return false;
            const titleLower = (e.title || '').toLowerCase();
            return !/\b(khá\s*bảnh|kha\s*banh|mặt\s*lồn|troll|meme|chế|hài|bựa|nhạc\s*chế)\b/i.test(titleLower);
          });
        }

        const expectedSec = (typeof trackItem === 'object' && trackItem !== null)
          ? (trackItem.spotifyDurationSec || (trackItem.durationMs ? Math.round(trackItem.durationMs / 1000) : (trackItem.duration ? parseDurationToSec(trackItem.duration) : 0)))
          : 0;

        // Sắp xếp ưu tiên:
        // 1. Đưa các bản karaoke/guide xuống sau bản vocal gốc nếu người dùng không yêu cầu karaoke
        // 2. Ưu tiên bài có thời lượng gần nhất với bản gốc
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
            if (typeof trackItem === 'object' && trackItem !== null) {
              trackItem.url = streamUrl;
              trackItem.isSoundCloud = true;
            }
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
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web & Discord Autocomplete (Siêu tốc độ qua Worker Thread)
 */
async function searchMultipleTracks(query, limit = 20, mode = 'official') {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  query = query.trim();

  if (query.startsWith('http')) {
    const directRes = await searchTrack(query);
    return directRes || [];
  }

  try {
    return await executeSearch(query, limit, mode);
  } catch (err) {
    console.warn('[searchMultipleTracks worker error]:', err.message);
    return [];
  }
}

module.exports = {
  validateAndSanitizeMusicUrl,
  searchTrack,
  searchMultipleTracks,
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack,
  getRelatedTrack,
  createResource,
  analyzeTrackOriginAndMeta,
  detectTrackRegion,
  isCandidateMatchingRegion
};
