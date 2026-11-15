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
const audioCacheManager = require('../structures/AudioCacheManager');
const ffmpeg = (process.platform === 'linux' && fs.existsSync('/usr/bin/ffmpeg'))
  ? '/usr/bin/ffmpeg'
  : (require('ffmpeg-static') || 'ffmpeg');
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
        } else if (stat.isFile() && stat.size <= 100) {
          // Cơ chế Auto-Heal: Tự động khôi phục nếu file cookie bị tiến trình truncate về 0 byte
          const bakFile = c + '.bak';
          if (fs.existsSync(bakFile) && fs.statSync(bakFile).size > 100) {
            console.log(`[Cookie Auto-Heal] Phát hiện file cookie bị rỗng, tự động khôi phục từ: ${bakFile}`);
            try {
              fs.chmodSync(c, 0o666);
              fs.copyFileSync(bakFile, c);
              fs.chmodSync(c, 0o444);
              return c;
            } catch (healErr) {
              return bakFile;
            }
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

// Cấu hình player client bypass kiểm tra bot của YouTube trên Datacenter IP
const YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=ios,android,mweb';
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
  if (typeof str === 'number' && !isNaN(str)) return Math.max(0, Math.floor(str));
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function stripYouTubeTranslatedLabels(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\(\s*(?:mv|video|audio|bản\s*âm\s*thanh|lời\s*bài\s*hát|video\s*âm\s*nhạc|hình\s*ảnh)\s*chính\s*thức\s*\)/gi, ' ')
    .replace(/\[\s*(?:mv|video|audio|bản\s*âm\s*thanh|lời\s*bài\s*hát|video\s*âm\s*nhạc)\s*chính\s*thức\s*\]/gi, ' ')
    .replace(/\b(?:mv|video|bản\s*âm\s*thanh|video\s*âm\s*nhạc)\s+chính\s*thức\b/gi, ' ')
    .replace(/\s+(?:và|của|với|cùng)\s+(?=[a-zA-Z0-9(\[])/gi, ' ')
    .trim();
}

function parseViews(str) {
  if (!str || typeof str !== 'string') return 0;
  const clean = str.replace(/[^\d]/g, '');
  return parseInt(clean, 10) || 0;
}

/**
 * Hàng đợi ưu tiên 2 làn (Priority Semaphore) cho trích xuất nhạc:
 * Hàng đợi 'high' dành cho lệnh trực tiếp của người dùng (/play, /skip, playNow).
 * Hàng đợi 'low' dành cho tác vụ chạy ngầm (preload, autoplay, health check).
 */
class PrioritySemaphore {
  constructor(limit = 3) {
    this.limit = limit;
    this.current = 0;
    this.high = [];
    this.low = [];
  }

  async acquire(priority = 'high') {
    if (this.current < this.limit) {
      this.current++;
      return;
    }
    return new Promise((resolve) => {
      const entry = { resolve };
      if (priority === 'high') {
        this.high.push(entry);
      } else {
        this.low.push(entry);
      }
    });
  }

  release() {
    this.current--;
    if (this.current < 0) this.current = 0;
    if (this.high.length > 0) {
      this.current++;
      const next = this.high.shift();
      next.resolve();
    } else if (this.low.length > 0) {
      this.current++;
      const next = this.low.shift();
      next.resolve();
    }
  }

  async run(taskFn, priority = 'high') {
    await this.acquire(priority);
    try {
      return await taskFn();
    } finally {
      this.release();
    }
  }
}

const MAX_CONCURRENT_EXTRACTION = process.env.MAX_CONCURRENT_EXTRACTION ? parseInt(process.env.MAX_CONCURRENT_EXTRACTION, 10) : 1;
const extractionSemaphore = new PrioritySemaphore(MAX_CONCURRENT_EXTRACTION);

// RAM Cache tái sử dụng Metadata & Direct Stream URL (tối đa 200 mục, TTL theo tham số expire còn hạn >= 30p)
const streamUrlCache = new Map();
const MAX_STREAM_CACHE_SIZE = 200;

function getCachedStreamUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  const cached = streamUrlCache.get(targetUrl);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAt - now < 30 * 60 * 1000) {
    streamUrlCache.delete(targetUrl);
    return null;
  }
  return cached.streamUrl;
}

function setCachedStreamUrl(targetUrl, streamUrl) {
  if (!targetUrl || !streamUrl || typeof streamUrl !== 'string') return;
  const expireMatch = streamUrl.match(/[?&]expire=(\d+)/);
  let expiresAt = 0;
  if (expireMatch && expireMatch[1]) {
    expiresAt = Number(expireMatch[1]) * 1000;
  } else {
    expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  }

  // Bắt buộc còn hạn ít nhất 30 phút
  if (expiresAt - Date.now() < 30 * 60 * 1000) return;

  while (streamUrlCache.size >= MAX_STREAM_CACHE_SIZE) {
    const oldestKey = streamUrlCache.keys().next().value;
    if (oldestKey !== undefined) streamUrlCache.delete(oldestKey);
    else break;
  }
  streamUrlCache.set(targetUrl, { streamUrl, expiresAt });
}

// Circuit Breaker (Cầu chì tự ngắt YouTube khi lỗi 3 bài liên tiếp)
let ytStreamFailures = 0;
let skipYouTubeStreamUntil = 0;

function isYouTubeCircuitOpen(options = {}) {
  // Nếu là yêu cầu trực tiếp từ người dùng (/play, web playNow), cho phép thử phát YouTube ngay để kiểm tra phục hồi (Half-Open)
  if (options?.priority === 'high') {
    return false;
  }
  return Date.now() < skipYouTubeStreamUntil;
}

function recordYouTubeFailure(errorMsg) {
  ytStreamFailures++;
  console.warn(`[YouTube Circuit Breaker] Ghi nhận lỗi phát YouTube (${ytStreamFailures}/3): ${errorMsg}`);
  if (ytStreamFailures >= 3) {
    skipYouTubeStreamUntil = Date.now() + 3 * 60 * 1000; // Ngắt 3 phút (thay vì 10 phút để tránh kẹt SoundCloud quá lâu)
    console.warn('[YouTube Circuit Breaker] Đã lỗi 3 bài liên tiếp! Kích hoạt cầu chì tạm ngắt YouTube 3 phút, chuyển sang SoundCloud.');
    try {
      const { notifyCookieExpired, checkYouTubeCookieHealth } = require('./statusNotifier');
      const client = global._discordClient;
      const isActualCookieIssue = /sign in to confirm|confirm you're not a bot|this content isn't available|login|cookie|bot verification|429/i.test(errorMsg);
      if (isActualCookieIssue && typeof notifyCookieExpired === 'function') {
        notifyCookieExpired(client, null, `YouTube từ chối luồng âm thanh 3 lần liên tiếp: ${errorMsg}`);
      } else if (typeof checkYouTubeCookieHealth === 'function') {
        // Kiểm tra thực tế xem cookie có hỏng thật không trước khi gửi cảnh báo
        checkYouTubeCookieHealth(client, null).catch(() => {});
      }
    } catch (e) {}
  }
}

function recordYouTubeSuccess() {
  if (ytStreamFailures > 0) {
    console.log('[YouTube Circuit Breaker] Phát YouTube thành công, reset bộ đếm lỗi về 0.');
    ytStreamFailures = 0;
  }
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

const EXTRACTOR_INSTRUMENT_NORM_REGEX = /\b(piano|ver\s*piano|piano\s*ver|piano\s*version|guitar|ver\s*guitar|guitar\s*ver|guitar\s*solo|acoustic|ver\s*acoustic|orchestra|symphony|violin|cello|flute|sao\s*truc|saxophone|sax\s*ver|kalimba|ukulele|organ|harp|dan\s*tranh|dan\s*bau|instrumental|khong\s*loi|nhac\s*cu|beat\s*piano|solo\s*ver|bien\s*tau|cover|hat\s*lai|covered\s*by)\b/i;
const EXTRACTOR_INSTRUMENT_RAW_REGEX = /(?:ver\.?\s*piano|piano\s*ver\.?|ver\.?\s*guitar|guitar\s*ver\.?|ver\.?\s*acoustic|acoustic\s*ver\.?|biến\s*tấu|hát\s*lại|nhạc\s*không\s*lời|\bcover\b|\bacoustic\b|\bpiano\b|\bguitar\b|\borchestra\b|\bviolin\b|\binstrumental\b)/i;
const EXTRACTOR_OTHER_VARIANT_NORM_REGEX = /\b(remix|vinahouse|vinahey|lofi|lo\s*fi|sped\s*up|speed\s*up|slowed|reverb|nightcore|daycore|mashup|megamix|nonstop|bootleg|flip|live|live\s*stage|live\s*session|hat\s*live|fancam|dance\s*ver|dance\s*practice|performance\s*ver|parody|nhac\s*che|demo|8d|16d|bass\s*boosted)\b/i;
const EXTRACTOR_KARAOKE_NORM_REGEX = /\b(karaoke|beat\s*chuan|nhac\s*song|tong\s*nam|tong\s*nu|tone\s*nam|tone\s*nu|beat\s*goc|tach\s*nhac|backing\s*track)\b/i;

/**
 * Đánh giá độ khớp toàn diện giữa từ khóa tìm kiếm và ứng viên video YouTube.
 * Bắt buộc ưu tiên tên bài hát và ca sĩ chính xác lên hàng đầu, ngăn tuyệt đối việc
 * bắt nhầm sang bài khác chỉ vì có thời lượng trùng khớp (như sự cố bài 'Truy Lùng' bị đổi thành 'nguyên xi').
 */
function scoreCandidateVideo(v, query, targetDurationSec = 0) {
  if (!v) return -999;
  const rawTitle = String(v.title || '');
  const rawAuthor = String(v.author?.name || v.uploader || v.channel || '');
  const titleLower = rawTitle.toLowerCase();
  const authorLower = rawAuthor.toLowerCase();
  const vTitleNorm = normalizeSearchText(rawTitle);
  const vAuthorNorm = normalizeSearchText(rawAuthor);
  const vCombined = `${vTitleNorm} ${vAuthorNorm}`;

  const cleanQ = query.replace(/\b(audio|official|mv|video|lyric|lyrics)\b/gi, '').trim();
  const normQuery = normalizeSearchText(cleanQ);
  const parts = cleanQ.split(/\s+[-–—|]\s+/).map(p => p.trim()).filter(Boolean);

  let titlePart = parts[0] || cleanQ;
  let artistPart = parts.length > 1 ? parts.slice(1).join(' ') : '';

  const normTitle = normalizeSearchText(titlePart);
  const normArtist = normalizeSearchText(artistPart);

  const titleWords = normTitle.split(' ').filter(w => w.length >= 2 && !['audio', 'video', 'mv', 'official'].includes(w));
  const artistWords = normArtist ? normArtist.split(' ').filter(w => w.length >= 2) : [];

  let score = 0;

  // 0. Đánh giá biến thể Nhạc cụ / Piano / Cover / Remix không được yêu cầu
  const isAskingInstrument = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(normQuery) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(query);
  const isAskingOtherVariant = EXTRACTOR_OTHER_VARIANT_NORM_REGEX.test(normQuery);

  const isCandidateInstrument = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(vTitleNorm) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(rawTitle);
  const isCandidateOtherVariant = EXTRACTOR_OTHER_VARIANT_NORM_REGEX.test(vCombined);

  let isUnrequestedVariant = false;
  if (isCandidateInstrument && !isAskingInstrument) {
    score -= 100; // Phạt nặng -100đ đối với bản Piano / Guitar / Acoustic / Cover không yêu cầu
    isUnrequestedVariant = true;
  }
  if (isCandidateOtherVariant && !isAskingOtherVariant) {
    score -= 65; // Phạt bản Remix / Live / Sped up / Slowed không yêu cầu
    isUnrequestedVariant = true;
  }

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

  // 3.1 Phạt nặng bản hát Live sân khấu / Gameshow / TV Show nếu người dùng không yêu cầu
  const userWantsLiveOrTv = /(?:\[\s*live|\(\s*live|\blive\b|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bdemo\b|the masked singer|ca si mat na|anh trai|chi dep|rap viet|may lang thang|xuan ha thu dong|in the moonlight|la ca hat ca)/i.test(cleanQ);
  const isTvOrStage = /\b(the masked singer|ca si mat na|anh trai say hi|anh trai vuot ngan chong gai|chi dep dap gio|rap viet|giao lo thoi gian|xuan ha thu dong|may lang thang|in the moonlight|la ca hat ca|forest studio|vie channel|htv2|vtv3|yeah1|fancam|live stage|tuyen tap|nhac tre|lofi chill|audio lyric)\b/i.test(`${vTitleNorm} ${vAuthorNorm}`);
  if (!userWantsLiveOrTv && (isLiveStageVideo(v.title) || isTvOrStage)) {
    score -= 100; // Phạt nặng để ưu tiên bản phòng thu chính thức (Official Studio Audio/MV)
  }

  // 4. Ưu tiên topic / official studio audio / official mv (CHỈ cộng nếu KHÔNG phải biến thể trái ý)
  const isTopic = vAuthorNorm.includes('topic') || vTitleNorm.includes('topic');
  if (isTopic) score += 40;
  if (!isUnrequestedVariant && /\b(official audio|official music video|official mv|official video|official visualizer|official lyric video)\b/i.test(vTitleNorm)) {
    score += 35;
  }

  // 4.1 Điểm cộng lượt xem (views)
  const views = v.views || (typeof parseViews === 'function' ? parseViews(v.viewCountText || v.viewsText || '') : 0);
  if (views > 1000 && v.seconds >= 60 && v.seconds <= 500) {
    const viewBonus = Math.min(45, Math.max(0, Math.round((Math.log10(views) - 3) * 10)));
    score += viewBonus;
  }

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

  // 2. Tải trước 5 bài đầu tiên (~100-200ms) để phản hồi API siêu nhanh mà không nghẽn Event Loop
  const firstBatch = tracks.slice(0, 5);
  await enrichBatch(firstBatch);

  // 3. Tải tiếp các bài còn lại ở background để không làm nghẽn API (mỗi đợt 25 bài)
  const remaining = tracks.slice(5);
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

async function searchTrack(query, targetDurationSec = 0) {
  try {
    if (!query || typeof query !== 'string') return null;

    let cleanQuery = query.trim().slice(0, 150).trim();
    // Chống Argument Injection: chặn chuỗi bắt đầu bằng dấu trừ
    if (cleanQuery.startsWith('-')) return null;

    // Tự động chuẩn hóa link Spotify nếu thiếu protocol trước khi kiểm tra an toàn URL
    if ((cleanQuery.includes('spotify.com/') || cleanQuery.startsWith('spotify:')) && !/^https?:\/\//i.test(cleanQuery)) {
      cleanQuery = 'https://' + cleanQuery;
    }

    // Kiểm tra an toàn bảo mật SSRF cho đường dẫn URL ngoại vi
    if (/^https?:\/\//i.test(cleanQuery)) {
      const sanitizedUrl = validateAndSanitizeMusicUrl(cleanQuery);
      if (!sanitizedUrl) {
        console.warn(`[Security Alert: SSRF / Invalid Hostname Blocked] URL không an toàn bị từ chối: ${cleanQuery}`);
        return null;
      }
      cleanQuery = sanitizedUrl;
    }

    // Đồng bộ biến query cho tất cả các nhánh xử lý bên dưới
    query = cleanQuery;

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

          // Tải song song thumbnail từng bài hát từ Spotify oEmbed ở nền để phản hồi playlist ngay lập tức
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
      // 5.1 Xử lý Single YouTube video bằng oEmbed + InnerTube siêu nhẹ (< 1ms CPU, không block Main Thread)
      const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (ytMatch && ytMatch[1] && !query.includes('list=')) {
        const videoId = ytMatch[1];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const defaultThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        try {
          // Bước 1: Kiểm tra cache trong searchService nếu đã có metadata
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

          // Bước 2: Gọi đồng thời oEmbed và InnerTube Player API (Client IOS siêu nhẹ ~15KB JSON, không parse DOM HTML)
          const oEmbedPromise = fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
            signal: AbortSignal.timeout(2000)
          }).then(res => res.ok ? res.json() : null).catch(() => null);

          const innerTubePromise = fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)'
            },
            body: JSON.stringify({
              videoId,
              context: {
                client: {
                  clientName: 'IOS',
                  clientVersion: '19.45.4',
                  hl: 'vi',
                  gl: 'VN'
                }
              }
            }),
            signal: AbortSignal.timeout(2000)
          }).then(res => res.ok ? res.json() : null).catch(() => null);

          const [oembedData, innerData] = await Promise.all([oEmbedPromise, innerTubePromise]);
          const innerDetails = innerData?.videoDetails;

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

          // Bước 3: Luôn trả về kết quả ngay lập tức cho YouTube Watch URL đơn lẻ, TUYỆT ĐỐI không rơi xuống fallback yt-dlp nặng nề
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
          // Trường hợp lỗi mạng, vẫn trả về metadata tối thiểu để phát nhạc, không spawn yt-dlp làm sập CPU
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

const historyManager = require('../structures/HistoryManager');
const settingsManager = require('../structures/SettingsManager');
const {
  resolveAppleMusicMetadata,
  getAppleArtistTopTracks,
  appleMetaCache
} = require('./appleMusicHelper');

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

// ═════════════════════════════════════════════════════════════════════════════
// BỘ NHẬN DIỆN VÙNG NGÔN NGỮ & KHÓA CHẶT VÙNG AUTOPLAY (STRICT REGION LOCK)
// Tối ưu Pre-compiled Regex (0ms CPU, không tạo tiến trình con yt-dlp)
// ═════════════════════════════════════════════════════════════════════════════

const VI_DIACRITIC_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỖÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

// Bảng mã chữ viết tượng hình & phi Latinh
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/; // Tiếng Hàn (KR)
const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;                // Tiếng Nhật (JP)
const HANZI_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;   // Chữ Hán (CN / Kanji)
const ANY_CJK_REGEX = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const OTHER_NON_LATIN_REGEX = /[\u0E00-\u0E7F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F]/; // Thái, Nga, Ả Rập, Ấn

// Các từ khóa do YouTube tự động dịch tiêu đề khi truy cập từ IP Việt Nam
const YT_LOCALIZATION_NOISE_REGEX = /\b(mv\s*chính\s*thức|video\s*chính\s*thức|video\s*âm\s*nhạc\s*chính\s*thức|bản\s*chính\s*thức|lời\s*bài\s*hát|phụ\s*đề|vietsub|viet\s*sub|thuyết\s*minh|bản\s*dịch|\bcủa\b)\b/gi;

// Từ điển Nghệ sĩ Việt Nam chuẩn hóa không dấu (Bắt chuẩn cả "Quang Hung MasterD", "Lil Z Poet"...)
const VN_ARTISTS_NORM_REGEX = /\b(quang\s*hung\s*masterd|quang\s*hung|masterd|lil\s*z\s*poet|lil\s*z|son\s*tung|m\s*tp|mtp|hieuthuhai|hurrykng|manbo|negav|gerdnang|rpt\s*mck|mck|ngher|lope\s*pham|tlinh|wren\s*evans|mono|grey\s*d|den\s*vau|vu\s*cat\s*tuong|madihu|bich\s*phuong|hoa\s*minzy|erik|duc\s*phuc|quan\s*a\s*p|quan\s*ap|noo\s*phuoc\s*thinh|dong\s*nhi|ong\s*cao\s*thang|toc\s*tien|binz|soobin|soobin\s*hoang\s*son|rhymastic|justatee|karik|suboi|b\s*ray|bray|amee|hoang\s*dung|chillies|ca\s*hoi\s*hoang|ngot\s*band|da\s*lab|dalab|phan\s*manh\s*quynh|ha\s*anh\s*tuan|my\s*tam|ho\s*ngoc\s*ha|le\s*quyen|trung\s*quan|bui\s*anh\s*tuan|huong\s*tram|chi\s*pu|van\s*mai\s*huong|jsol|hoang\s*duyen|hua\s*kim\s*tuyen|kewtiie|gill|wxrdie|low\s*g|obito|shiki|vstra|tang\s*duy\s*tan|dat\s*g|du\s*uyen|k\s*icm|kicm|trinh\s*dinh\s*quang|mr\s*siro|only\s*c|onlyc|lou\s*hoang|miu\s*le|suni\s*ha\s*linh|lyly|anh\s*tu|dinh\s*dung|acv\s*music|phao|double2t|24k\s*right|rhyder|captain\s*boy|duong\s*domic|phap\s*kieu|jun\s*pham|isaac|st\s*son\s*thach|bui\s*cong\s*nam|kay\s*tran|datkaa|changg|thinh\s*suy|winno|ronboogz|wean|touliver|slimv|masew|hoaprox|2pillz|wokeup|machiot|marzuz|vu\s*phung\s*tien|phuong\s*ly|phuong\s*my\s*chi|dtap|hoang\s*thuy\s*linh|truc\s*nhan|tien\s*tien|tien\s*cookie|bui\s*truong\s*linh|nguyen\s*tran\s*trung\s*quan|dick|umie|droppy|haisam|khanh\s*phuong|ung\s*hoang\s*phuc|lam\s*chan\s*huy|chau\s*khai\s*phong|chu\s*bin|ho\s*quang\s*hieu|bao\s*anh|bui\s*lan\s*huong|nguyen\s*ha|lan\s*nha|le\s*hieu|bang\s*kieu|tuan\s*hung|dan\s*truong|cam\s*ly|quang\s*le|nhu\s*quynh|vu|vũ)\b/i;

// Từ điển Nghệ sĩ Quốc tế / K-Pop / J-Pop / C-Pop
const INTL_ARTISTS_REGEX = /\b(k\/da|kda|riot\s*games|league\s*of\s*legends|valorant|arcane|pentakill|true\s*damage|heartsteel|miyeon|soyeon|g\s*i\s*dle|gidle|sophie\s*powers|mimi\s*webb|madison\s*beer|taylor\s*swift|the\s*weeknd|alan\s*walker|ed\s*sheeran|bruno\s*mars|ariana\s*grande|billie\s*eilish|justin\s*bieber|post\s*malone|dua\s*lipa|charlie\s*puth|shawn\s*mendes|olivia\s*rodrigo|sabrina\s*carpenter|lana\s*del\s*rey|adele|rihanna|katy\s*perry|lady\s*gaga|maroon\s*5|imagine\s*dragons|coldplay|onerepublic|chainsmokers|linkin\s*park|eminem|drake|kendrick\s*lamar|travis\s*scott|sza|doja\s*cat|vevo)\b/i;
const KPOP_ARTISTS_REGEX = /\b(blackpink|bts|newjeans|aespa|ive|le\s*sserafim|twice|itzy|nmixx|babymonster|illit|kiss\s*of\s*life|stray\s*kids|seventeen|txt|enhypen|exo|bigbang|g\s*dragon|taeyang|iu|taeyeon|jungkook|jimin|lisa|jennie|rose|jisoo|psy|yg\s*entertainment|hybe|smtown|jyp)\b/i;
const JPOP_ARTISTS_REGEX = /\b(yoasobi|ado|kenshi\s*yonezu|fujii\s*kaze|radwimps|aimer|official\s*hige\s*dandism|king\s*gnu|vaundy|imase|hikaru\s*utada|yorushika|zutomayo|creepy\s*nuts|mrs\s*green\s*apple)\b/i;
const CPOP_KEYWORDS_REGEX = /\b(jay\s*chou|jj\s*lin|g\.?e\.?m\.?|eric\s*chou|mayday|douyin|tiktok\s*china|pinyin|mandopop|cpop|c-pop)\b/i;

// Âm tiết & Cấu trúc ngữ âm đặc trưng của Tiếng Việt khi viết KHÔNG DẤU ("Thuy Trieu", "Tinh Minh La Ki"...)
const VN_SYLLABLE_TOKEN_REGEX = /^(thuy|trieu|tinh|minh|la|ki|ky|anh|em|chung|ta|cua|tuong|lai|hien|tai|qua|khu|nguoi|yeu|thuong|nho|buon|vui|khoc|cuoi|trai|tim|giac|mo|mua|nang|gio|may|troi|bien|co|don|lang|quen|chia|tay|gap|nhau|nuoc|mat|doi|cho|vong|tay|ngot|ngao|am|ap|lanh|lung|duong|pho|chieu|thu|dong|xuan|ha|hoang|hon|binh|minh|bong|toi|ngan|van|kiep|duyen|phan|loi|hua|cau|the|chap|nhan|buong|bo|quay|ve|ra|di|o|lai|bao|gio|con|mai|chang|khong|chua|tung|da|dang|se|vua|moi|rat|lam|nhieu|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|ngon|lua|bo|vai|doi|moi|nu|cuoi|tieng|hat|nhip|dieu|phut|giay|dem|khuya|thien|duong|tran|gian|cuoc|doi|thanh|xuan|tuoi|tre|ngay|thang|dai|kho|ngoc|nghech|dam|me|mong|uoc|hy|vong|binh|yen|nhat|nhoa|phai|tan|vo|nat|nguyen|tran|le|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|quang|hung|duc|tuan|hieu|khanh|linh|trang|thao|huong|phuong|ngoc|vy|nhi)$/i;
const VN_PHONETIC_CLUSTER_REGEX = /^(?:ng|nh|kh|gh|ph|tr|ch|gi|qu|th)[aeiouy]{1,3}(?:ng|nh|ch|m|n|p|t|c)?$|^[bcdghklmnpqrstvx]{1,2}(?:uy|ieu|uoi|uoc|uong|oai|oan|oang|ang|anh|ach|inh|ich|ung|uc|oc|ong)$/i;
const COMMON_EN_TOKEN_REGEX = /^(the|and|you|that|was|for|are|with|his|they|this|have|from|one|had|word|but|not|what|all|were|when|your|can|said|there|use|each|which|she|how|their|will|other|about|out|many|then|them|these|some|her|would|make|like|him|into|time|has|look|two|more|go|see|no|way|could|my|than|first|water|been|call|who|now|find|long|down|day|did|get|come|made|may|part|give|got|still|love|baby|know|feel|wanna|gonna|dont|cant|firestarter|fire|night|heart|dream|world|life|light|dark|sky|star|stars|sun|moon|rain|wind|burn|stay|leave|gone|back|home|alone|lonely|broken|forever|never|always|again|tonight|today|kiss|touch|hold|cry|smile|dance|sing|song|music|beat|soul|mind|eyes|fly|fall|run|walk|wait|stop|start|end|begin|lose|win|live|heaven|hell|angel|devil|king|queen|boy|girl|man|woman|friend|friends|lover|shadow|ghost|magic|power|hero|official|video|audio|visualizer|lyrics|lyric|mv|remix|cover|version|ver|topic)$/i;

// Danh sách Nghệ sĩ V-Pop dùng để xoay vòng tìm bài tương tự khi Fallback
const VPOP_SIMILAR_ARTISTS_POOL = [
  'Quang Hùng MasterD', 'Sơn Tùng M-TP', 'HIEUTHUHAI', 'RPT MCK', 'tlinh',
  'Wren Evans', 'MONO', 'Grey D', 'Vũ.', 'Madihu', 'Đen Vâu', 'Soobin',
  'Binz', 'Hoàng Dũng', 'Chillies', 'Da LAB', 'Phan Mạnh Quỳnh', 'Tăng Duy Tân',
  'Rhyder', 'Dương Domic', 'Bích Phương', 'Hòa Minzy', 'AMEE', 'Erik',
  'Đức Phúc', 'Quân A.P', 'Noo Phước Thịnh', 'JustaTee', 'Rhymastic', 'B Ray',
  'Low G', 'Obito', 'WEAN', 'Phương Ly', 'Hoàng Thùy Linh', 'Trúc Nhân', 'Bùi Trường Linh'
];

/**
 * Biểu thức chính quy chặn tuyệt đối các video không phải âm nhạc (phân tích, cốt truyện, review, gameplay, podcast, v.v.)
 */
const NON_MUSIC_BLACKLIST_REGEX = /\b(phân\s*tích|cốt\s*truyện|giải\s*thích|tóm\s*tắt|review|đánh\s*giá|hướng\s*dẫn|cách\s*chơi|build\s*nhân\s*vật|tiêu\s*điểm\s*tướng|gameplay|walkthrough|playthrough|let'?s\s*play|highlight|highlights|full\s*match|bình\s*luận|reaction|phản\s*ứng|podcast|talkshow|phỏng\s*vấn|interview|tin\s*tức|điểm\s*tin|tâm\s*sự|vlog|thử\s*thách|challenge|prank|thuyết\s*minh|lồng\s*tiếng|tập\s*\d+|ep\.?\s*\d+|episode\s*\d+|movie\s*recap|tier\s*list|lore|theory|giả\s*thuyết|analysis|explained|video\s*essay|documentary|tài\s*liệu|speedrun|stream\s*vod|livestream\s*archive|trailer\s*breakdown|easter\s*eggs)\b/i;

function stripYoutubeNoise(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(YT_LOCALIZATION_NOISE_REGEX, ' ')
    .replace(/\b(official\s*music\s*video|official\s*video|official\s*mv|official\s*visualizer|official\s*audio|official\s*lyric\s*video|lyric\s*video|lyrics|visualizer|audio|mv|hd|4k)\b/gi, ' ')
    .replace(/['"‘’“”`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kiểm tra cấu trúc âm tiết Tiếng Việt không dấu (Ví dụ: "Thuy Trieu", "Tinh Minh La Ki")
 */
function hasVietnameseAccentlessPattern(str) {
  if (!str) return false;
  const norm = normalizeSearchText(str);
  const tokens = norm.split(/\s+/).filter(w => w.length >= 2 && !COMMON_EN_TOKEN_REGEX.test(w));
  if (tokens.length === 0) return false;

  let vnCount = 0;
  let enCount = 0;
  const allTokens = norm.split(/\s+/).filter(w => w.length >= 2);
  for (const t of allTokens) {
    if (COMMON_EN_TOKEN_REGEX.test(t)) {
      enCount++;
      continue;
    }
    if (VN_SYLLABLE_TOKEN_REGEX.test(t) || VN_PHONETIC_CLUSTER_REGEX.test(t)) {
      vnCount++;
    }
  }

  if (enCount > vnCount) return false;
  if (tokens.length <= 2) {
    return vnCount >= Math.max(1, tokens.length);
  }
  return vnCount >= 2 && (vnCount / tokens.length) >= 0.5;
}

/**
 * 1. Nhận diện chính xác Vùng Ngôn Ngữ của bài hát ('VI' | 'KR' | 'JP' | 'CN' | 'INTL')
 *    Bắt chuẩn 100% bài Việt viết không dấu ("Quang Hung MasterD - Thuy Trieu")
 *    và bài Quốc tế bị YouTube dịch tiêu đề ("K/DA - FIRESTARTER | MV Chính Thức")
 */
function detectTrackRegion(title = '', artist = '') {
  const rawTitle = String(title || '');
  const rawArtist = String(artist || '');
  const rawCombined = `${rawTitle} ${rawArtist}`.trim();
  if (!rawCombined) return 'INTL';

  const cleanTitle = stripYoutubeNoise(rawTitle);
  const cleanArtist = stripYoutubeNoise(rawArtist);
  const cleanCombined = `${cleanTitle} ${cleanArtist}`.trim();
  const normCombined = normalizeSearchText(cleanCombined);
  const normArtist = normalizeSearchText(cleanArtist);

  // Bước 1: Kiểm tra chữ Hàn (Hangul) / Nhật (Kana) / Trung (Hanzi) TRƯỚC TIÊN
  if (HANGUL_REGEX.test(rawCombined)) return 'KR';
  if (KANA_REGEX.test(rawCombined)) return 'JP';
  if (HANZI_REGEX.test(rawCombined)) {
    if (JPOP_ARTISTS_REGEX.test(normCombined)) return 'JP';
    return 'CN';
  }

  // Bước 2: Kiểm tra từ điển Nghệ sĩ Việt Nam không dấu (Ưu tiên cao nhất cho V-Pop như "Quang Hung MasterD")
  if (VN_ARTISTS_NORM_REGEX.test(normCombined) || VN_ARTISTS_NORM_REGEX.test(normArtist)) {
    return 'VI';
  }

  // Bước 3: Kiểm tra Nghệ sĩ K-Pop / J-Pop / C-Pop / Âu Mỹ viết bằng chữ Latinh
  if (KPOP_ARTISTS_REGEX.test(cleanCombined)) return 'KR';
  if (JPOP_ARTISTS_REGEX.test(cleanCombined)) return 'JP';
  if (CPOP_KEYWORDS_REGEX.test(cleanCombined)) return 'CN';
  if (INTL_ARTISTS_REGEX.test(cleanCombined) || INTL_ARTISTS_REGEX.test(rawCombined)) return 'INTL';

  // Bước 4: Kiểm tra dấu Tiếng Việt thực sự (sau khi đã loại bỏ nhiễu địa phương hóa YouTube)
  if (VI_DIACRITIC_REGEX.test(cleanCombined)) {
    return 'VI';
  }

  // Bước 5: Phân tích hình vị / âm tiết Tiếng Việt không dấu (Bắt chuẩn "'Thuy Trieu'", "Tinh Minh La Ki"...)
  const coreTitle = cleanTitle.replace(/\[.*?\]|\(.*?\)/g, ' ').trim();
  if (hasVietnameseAccentlessPattern(coreTitle) || hasVietnameseAccentlessPattern(cleanArtist)) {
    return 'VI';
  }

  return 'INTL';
}

/**
 * 2. Tách chuẩn xác { cleanArtist, cleanTrackTitle } từ tiêu đề YouTube
 */
function extractCleanArtistAndTitle(rawTitle = '', rawArtist = '') {
  const safeTitle = String(rawTitle || '')
    .replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ')
    .replace(/['"‘’“”`]/g, '')
    .trim();

  const segments = safeTitle
    .split(/\s*(?:[-–—|])\s*/)
    .map(s => stripYoutubeNoise(s).trim())
    .filter(s => s.length > 0 && !/^(official|visualizer|audio|video|mv|lyrics?|lyric\s*video|hd|4k|prod\.?.*|ver\.?.*)$/i.test(s));

  let cleanArtist = stripYoutubeNoise(rawArtist)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*Official(?:\s*Channel)?$/i, '')
    .trim();

  if (['youtube', 'youtube music', 'unknown', 'various artists'].includes(cleanArtist.toLowerCase())) {
    cleanArtist = '';
  }

  let cleanTrackTitle = safeTitle;
  if (segments.length >= 2) {
    const s0 = segments[0];
    const s1 = segments[1];
    if (VN_ARTISTS_NORM_REGEX.test(normalizeSearchText(s1)) && !VN_ARTISTS_NORM_REGEX.test(normalizeSearchText(s0))) {
      cleanArtist = cleanArtist || s1;
      cleanTrackTitle = s0;
    } else {
      cleanArtist = cleanArtist || s0;
      cleanTrackTitle = s1;
    }
  } else if (segments.length === 1) {
    cleanTrackTitle = segments[0];
  }

  return {
    cleanArtist: cleanArtist.trim(),
    cleanTrackTitle: stripYoutubeNoise(cleanTrackTitle).trim()
  };
}

/**
 * 3. Phân tích chi tiết nguồn gốc và metadata bài hát: Bóc tách ca sĩ/tên bài thật, lọc kênh reup/lyric
 */
function analyzeTrackOriginAndMeta(song) {
  if (!song) return { realTitle: '', realArtist: '', region: 'INTL', isRemix: false, isAcoustic: false };

  const rawTitle = typeof song === 'object' ? (song.title || song.searchQuery || '') : String(song || '');
  const rawArtist = typeof song === 'object' ? (song.artist || song.uploader || '') : '';

  const isRemix = /\b(remix|vinahouse|vinahey|dance|edm|quẩy|nonstop|dj\b|mashup)\b/i.test(rawTitle);
  const isAcoustic = /\b(acoustic|chill|lofi|ballad|buồn|guitar|piano)\b/i.test(rawTitle);
  const isCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(rawTitle);

  // 0. Kiểm tra RAM Cache của Apple Music (0ms CPU, không tốn network)
  const cacheKey = `${rawTitle.trim().toLowerCase()}|||${String(rawArtist || '').trim().toLowerCase()}`;
  const cachedApple = appleMetaCache?.get(cacheKey)?.data;
  if (cachedApple) {
    return {
      realTitle: cachedApple.canonicalTitle || rawTitle,
      realArtist: cachedApple.canonicalArtist || rawArtist || 'YouTube',
      cleanTrackTitle: cachedApple.canonicalTitle || rawTitle,
      cleanArtist: cachedApple.canonicalArtist || rawArtist,
      region: cachedApple.region || 'VI',
      appleArtistId: cachedApple.appleArtistId || null,
      primaryGenre: cachedApple.primaryGenre || null,
      appleMeta: cachedApple,
      isRemix,
      isAcoustic,
      isCover,
      rawTitle,
      rawArtist
    };
  }

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
    const extracted = extractCleanArtistAndTitle(rawTitle, rawArtist);
    realArtist = extracted.cleanArtist || rawArtist;
    realTitle = extracted.cleanTrackTitle || rawTitle;
  }

  const region = detectTrackRegion(realTitle, realArtist);

  return {
    realTitle: realTitle || rawTitle,
    realArtist: realArtist || rawArtist || 'YouTube',
    cleanTrackTitle: realTitle,
    cleanArtist: realArtist,
    region,
    isRemix,
    isAcoustic,
    isCover,
    rawTitle,
    rawArtist
  };
}

/**
 * Phân tích metadata bài hát nâng cao bất đồng bộ: Tra cứu Apple Music để lấy Canonical Data
 */
async function resolveTrackOriginAndMetaAsync(song) {
  const syncMeta = analyzeTrackOriginAndMeta(song);
  if (syncMeta.appleMeta) return syncMeta;

  try {
    const appleMeta = await resolveAppleMusicMetadata(syncMeta.rawTitle, syncMeta.rawArtist);
    if (appleMeta) {
      return {
        ...syncMeta,
        realTitle: appleMeta.canonicalTitle || syncMeta.realTitle,
        realArtist: appleMeta.canonicalArtist || syncMeta.realArtist,
        cleanTrackTitle: appleMeta.canonicalTitle || syncMeta.cleanTrackTitle,
        cleanArtist: appleMeta.canonicalArtist || syncMeta.cleanArtist,
        region: appleMeta.region || syncMeta.region,
        appleArtistId: appleMeta.appleArtistId || null,
        primaryGenre: appleMeta.primaryGenre || null,
        appleMeta
      };
    }
  } catch (err) {}
  return syncMeta;
}

/**
 * 4. Kiểm tra nghiêm ngặt ứng viên Autoplay có khớp với vùng ngôn ngữ của bài gốc không
 *    Chặn 100% bài Trung Quốc ("潮汐") lọt vào phiên nghe nhạc Việt ('VI') hoặc Âu Mỹ ('INTL')!
 */
function isCandidateMatchingRegion(candidate, targetRegion = 'VI', seedMeta = null) {
  if (!candidate || !candidate.title) return false;
  const candTitle = String(candidate.title || '');
  const candArtist = String(candidate.artist || candidate.author?.name || candidate.uploader || candidate.channel || '');
  const candCombined = `${candTitle} ${candArtist}`;
  const normCandTitle = normalizeSearchText(candTitle);
  const normCandArtist = normalizeSearchText(candArtist);

  // 0. CHẶN TUYỆT ĐỐI VIDEO PHÂN TÍCH GAME / REVIEW / PODCAST / NGÔN NGỮ LẠ:
  if (NON_MUSIC_BLACKLIST_REGEX.test(candTitle) || NON_MUSIC_BLACKLIST_REGEX.test(candCombined)) {
    return false;
  }
  if (OTHER_NON_LATIN_REGEX.test(candCombined)) {
    return false;
  }

  // 1. Chặn biến thể Nhạc cụ (Piano, Guitar, Acoustic, Cover, Karaoke) nếu bài gốc KHÔNG phải bản nhạc cụ
  const seedRaw = seedMeta ? `${seedMeta.rawTitle || seedMeta.title || ''} ${seedMeta.rawArtist || seedMeta.artist || ''}` : '';
  const normSeed = normalizeSearchText(seedRaw);
  const isSeedInstrumentOrCover = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(normSeed) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(seedRaw);
  const isCandInstrumentOrCover = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(normCandTitle) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(candTitle);
  if (isCandInstrumentOrCover && !isSeedInstrumentOrCover) {
    return false;
  }
  if (EXTRACTOR_KARAOKE_NORM_REGEX.test(normCandTitle)) {
    return false;
  }

  // 2. Chặn phát lặp lại cùng 1 bài hát dưới tên khác hoặc bản dịch tên bài
  if (seedMeta && seedMeta.cleanTrackTitle) {
    const normSeedTrack = normalizeSearchText(seedMeta.cleanTrackTitle);
    const normCandCore = normalizeSearchText(stripYoutubeNoise(candTitle).replace(/\[.*?\]|\(.*?\)/g, ''));
    if (normSeedTrack.length >= 4 && normCandCore === normSeedTrack) {
      return false;
    }
  }

  // 3. Lọc thời lượng chuẩn bài hát (75s - 600s)
  const durationSec = candidate.seconds || (candidate.duration ? parseDurationToSec(candidate.duration) : 0);
  if (durationSec > 0 && (durationSec < 75 || durationSec > 600)) {
    return false;
  }

  const candRegion = detectTrackRegion(candTitle, candArtist);
  const hasAnyCJK = ANY_CJK_REGEX.test(candCombined);

  // 4. KHÓA CHẶT THEO TỪNG VÙNG (STRICT REGION LOCK)
  if (targetRegion === 'VI') {
    // Nếu đang nghe Nhạc Việt:
    // - CẤM TUYỆT ĐỐI mọi bài có chữ Hán (潮汐), chữ Hàn, chữ Nhật!
    if (hasAnyCJK) return false;
    // - CẤM TUYỆT ĐỐI nghệ sĩ Quốc tế / K-Pop / J-Pop / C-Pop
    if (INTL_ARTISTS_REGEX.test(candCombined) || KPOP_ARTISTS_REGEX.test(candCombined) || JPOP_ARTISTS_REGEX.test(candCombined) || CPOP_KEYWORDS_REGEX.test(candCombined)) {
      return false;
    }
    // - Bắt buộc ứng viên phải là nhạc Việt
    return candRegion === 'VI';
  }

  if (targetRegion === 'INTL') {
    // Nếu đang nghe Nhạc Quốc Tế Âu Mỹ (Tiếng Anh):
    // - CẤM TUYỆT ĐỐI chữ Hán (潮汐), chữ Hàn, chữ Nhật!
    if (hasAnyCJK) return false;
    // - CẤM TUYỆT ĐỐI nhảy sang Nhạc Việt hoặc C-Pop / K-Pop / J-Pop!
    if (candRegion !== 'INTL') return false;
    if (VI_DIACRITIC_REGEX.test(stripYoutubeNoise(candCombined)) || VN_ARTISTS_NORM_REGEX.test(`${normCandTitle} ${normCandArtist}`)) {
      return false;
    }
    return true;
  }

  if (targetRegion === 'KR') {
    if (candRegion === 'VI' || candRegion === 'CN') return false;
    return candRegion === 'KR' || HANGUL_REGEX.test(candCombined) || KPOP_ARTISTS_REGEX.test(candCombined);
  }

  if (targetRegion === 'JP') {
    if (candRegion === 'VI' || candRegion === 'CN') return false;
    return candRegion === 'JP' || KANA_REGEX.test(candCombined) || JPOP_ARTISTS_REGEX.test(candCombined);
  }

  if (targetRegion === 'CN') {
    if (candRegion === 'VI') return false;
    return candRegion === 'CN' || HANZI_REGEX.test(candCombined) || CPOP_KEYWORDS_REGEX.test(candCombined);
  }

  return candRegion === targetRegion;
}

/**
 * 5. Xây dựng danh sách từ khóa Fallback thông minh cho Autoplay
 *    Tận dụng Apple Artist Top Tracks (nếu có) và TUYỆT ĐỐI KHÔNG tìm lại chính tên bài hát vừa phát!
 */
async function buildAutoplayFallbackQueries(lastSong, targetRegion = 'VI', seedMeta = null) {
  const meta = seedMeta || (await resolveTrackOriginAndMetaAsync(lastSong));
  const rawTitle = meta.rawTitle || '';
  const cleanArtist = meta.cleanArtist || '';
  const isRemix = meta.isRemix || false;
  const queries = [];

  // Ưu tiên 1: Nếu có appleArtistId từ Apple Music, lấy các bài hát chính thức khác của ca sĩ đó
  if (meta.appleArtistId) {
    try {
      const topTracks = await getAppleArtistTopTracks(meta.appleArtistId, 10);
      if (Array.isArray(topTracks) && topTracks.length > 0) {
        const normCurrentTitle = normalizeSearchText(meta.realTitle);
        for (const track of topTracks) {
          if (normalizeSearchText(track.title) !== normCurrentTitle) {
            queries.push(isRemix ? `${track.title} ${track.artist} remix` : `${track.title} ${track.artist} official audio`);
            if (queries.length >= 2) break;
          }
        }
      }
    } catch (e) {}
  }

  if (targetRegion === 'VI') {
    if (cleanArtist && cleanArtist.length >= 2) {
      queries.push(isRemix ? `${cleanArtist} remix vinahouse` : `${cleanArtist} official mv`);
      queries.push(`${cleanArtist} official audio`);
    }
    const normCurrentArtist = normalizeSearchText(cleanArtist);
    const pool = VPOP_SIMILAR_ARTISTS_POOL.filter(a => normalizeSearchText(a) !== normCurrentArtist);
    const pick1 = pool[Math.floor(Math.random() * pool.length)] || 'Sơn Tùng M-TP';
    const pick2 = pool[Math.floor(Math.random() * pool.length)] || 'HIEUTHUHAI';
    queries.push(isRemix ? `${pick1} remix` : `${pick1} official audio`);
    queries.push(isRemix ? `${pick2} remix` : `${pick2} official mv`);
  } else if (targetRegion === 'KR') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('kpop hit official mv');
  } else if (targetRegion === 'JP') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('jpop hit official audio');
  } else if (targetRegion === 'CN') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('cpop hit official audio');
  } else {
    // INTL (Âu Mỹ)
    if (cleanArtist && cleanArtist.length >= 2) {
      queries.push(`${cleanArtist} official audio`);
      queries.push(`${cleanArtist} official music video`);
    }
    queries.push('pop hits official audio');
  }

  return [...new Set(queries)].slice(0, 4);
}

/**
 * Lớp 1 (Ưu tiên cao nhất): Lấy bài tương tự từ YouTube Mix (RD<videoId>)
 * Duyệt tối đa 25 bài, lọc ngôn ngữ/vibe và chọn ngẫu nhiên có trọng số trong Top 3 bài đạt chuẩn
 */
async function getYoutubeMix(lastSong, guildId = null, playedList = [], targetRegion = null, returnAll = false) {
  if (!lastSong || !lastSong.url) return null;

  try {
    const match = lastSong.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (!match || !match[1]) return null;

    const videoId = match[1];
    const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

    const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
    const region = targetRegion || seedMeta.region;
    const isIntl = region === 'INTL';

    const mixOpts = {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      playlistEnd: 25,
      extractorArgs: isIntl ? `${YTDLP_EXTRACTOR_ARGS};youtube:lang=en` : YTDLP_EXTRACTOR_ARGS,
      httpChunkSize: '10M',
      bufferSize: '64K'
    };
    if (isIntl) {
      mixOpts.geoBypassCountry = 'US';
    }

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

        // Nếu bài gốc là Remix, lọc nhanh chỉ nhận bài có vibe remix
        if (seedMeta.isRemix && !/\b(remix|vinahouse|vinahey|mix|dj|bootleg|dance|ver|quẩy)\b/i.test(entry.title)) {
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

        if (validCandidates.length >= (returnAll ? 10 : 5)) break;
      }

      if (validCandidates.length > 0) {
        if (returnAll) {
          return validCandidates;
        }
        // Chọn ngẫu nhiên có trọng số (Weighted Random) trong Top 3 bài đạt chuẩn
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
    const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
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
      const fullQuery = seedMeta.isRemix
        ? `${trackName} ${trackArtist} remix`.trim()
        : `${trackName} ${trackArtist} official audio`.trim();

      if (isTrackInHistory({ title: fullQuery, url: null }, guildId, playedList, 25)) {
        continue;
      }

      // Xác định locale cho searchTrack theo vùng
      const searchLocale = region === 'INTL' ? 'en' : (region === 'VI' ? 'vi' : 'en');
      const results = await searchMultipleTracks(fullQuery, 5, seedMeta.isRemix ? 'all' : 'official', searchLocale);
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
/**
 * Lớp 3 (Fallback cuối cùng): Logic Heuristic nhận diện thể loại / ca sĩ theo đúng vùng quốc gia
 * Không bao giờ lặp lại tên bài hát vừa phát để tránh YouTube trả về bản dịch tiếng Trung!
 */
async function getHeuristicRelatedTrack(lastSong, guildId = null, playedList = [], targetRegion = null) {
  if (!lastSong || !lastSong.title) return null;

  try {
    const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
    const region = targetRegion || seedMeta.region;

    // Sinh các query fallback chuẩn theo ca sĩ hoặc phong cách, KHÔNG LẶP TÊN BÀI HÁT
    const fallbackQueries = await buildAutoplayFallbackQueries(lastSong, region, seedMeta);
    const searchLocale = region === 'INTL' ? 'en' : (region === 'VI' ? 'vi' : 'en');

    for (const query of fallbackQueries) {
      try {
        console.log(`[Autoplay Heuristic (${region})] Thử tìm bài thay thế: "${query}"`);
        const results = await executeSearch(query, 6, seedMeta.isRemix ? 'all' : 'official', searchLocale);

        if (results && results.length > 0) {
          for (const entry of results) {
            if (!entry || !entry.title) continue;

            const trackUrl = entry.url || (entry.videoId ? `https://www.youtube.com/watch?v=${entry.videoId}` : null);
            if (!trackUrl || trackUrl === lastSong.url) continue;
            if (isTrackInHistory(entry, guildId, playedList, 25)) continue;

            // Kiểm tra nghiêm ngặt xem bài tìm được có khớp vùng và thể loại không
            if (!isCandidateMatchingRegion(entry, region, seedMeta)) {
              continue;
            }

            return {
              title: entry.title,
              url: trackUrl,
              duration: entry.duration || '3:30',
              thumbnail: entry.thumbnail || (entry.videoId ? `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg` : null),
              isLive: Boolean(entry.isLive),
              requestedBy: 'Tự động phát'
            };
          }
        }
      } catch (qErr) {
        console.warn(`[Autoplay heuristic failed for query: "${query}"]:`, qErr.message);
      }
    }
  } catch (err) {
    console.error('[getHeuristicRelatedTrack Error]:', err.message);
  }
  return null;
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

// Tự động dọn dẹp tiến trình con khi Node.js process thoát (Ủy quyền SIGINT/SIGTERM cho index.js gracefulShutdown)
process.on('exit', cleanupAllProcesses);

/**
 * Phát trực tiếp từ stream URL đã được lưu trong bộ nhớ đệm mà không cần gọi yt-dlp
 */
function createDirectFfmpegStream(streamUrl, seekSeconds = 0, playDurationSec = 0, options = {}) {
  const isLowPriority = (options?.priority === 'low');
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-analyzeduration', '0',
      '-probesize', '64k'
    ];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }
    // Cấu hình FFmpeg xuất luồng âm thanh nguyên bản (Bit-perfect Pure Stream) chuẩn Discord Voice:
    // TUYỆT ĐỐI KHÔNG dùng filter động (-af dynaudnorm, loudnorm, acompressor, alc...) để tránh phập phù âm lượng (Audio Pumping)
    ffmpegArgs.push(
      '-thread_queue_size', '512',
      '-i', streamUrl,
      '-vn',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-threads', '1'
    );
    if (playDurationSec && Number(playDurationSec) > 0) {
      ffmpegArgs.push('-t', String(Math.ceil(Number(playDurationSec))));
    }
    ffmpegArgs.push('pipe:1');

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 19 : -5); } catch (e) {}
    }

    let ffmpegStderr = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
      if (ffmpegStderr.length > 4000) ffmpegStderr = ffmpegStderr.slice(-2000);
    });

    ffmpegProcess.stdin?.on('error', () => {});
    ffmpegProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') console.error('[FFmpeg Direct Error]:', err.message);
    });

    let firstChunkReceived = false;
    const passThroughStream = new PassThrough({ highWaterMark: 1 << 19 });
    passThroughStream.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[PassThroughStream Error]:', err.message);
      }
    });
    passThroughStream.on('close', () => {
      killProcess(ffmpegProcess);
    });
    ffmpegProcess.stdout.pipe(passThroughStream);

    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        killProcess(ffmpegProcess);
        reject(new Error('Quá thời gian chờ âm thanh từ Direct Stream (Timeout 12s)'));
      }
    }, 12000);

    ffmpegProcess.stdout.once('data', () => {
      firstChunkReceived = true;
      clearTimeout(safetyTimeout);
      const resource = createAudioResource(passThroughStream, {
        inputType: StreamType.Raw,
        inlineVolume: true
      });
      resource.destroy = () => {
        killProcess(ffmpegProcess);
      };
      resolve(resource);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(safetyTimeout);
      if (!firstChunkReceived) {
        killProcess(ffmpegProcess);
        const lastErr = ffmpegStderr.slice(-200).trim();
        reject(new Error(`FFmpeg Direct exited with code ${code}: ${lastErr}`));
      } else {
        killProcess(ffmpegProcess);
      }
    });
  });
}

/**
 * Phát trực tiếp từ file âm thanh trên ổ cứng SSD (Local Audio Disk Cache)
 * Không tải mạng, độ trễ 0ms, mức sử dụng CPU ~ 0%
 */
function createDirectFileStream(filePath, seekSeconds = 0, playDurationSec = 0, options = {}) {
  const isLowPriority = (options?.priority === 'low');
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-loglevel', 'error'
    ];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }
    ffmpegArgs.push(
      '-thread_queue_size', '512',
      '-i', filePath,
      '-vn',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-threads', '1'
    );
    if (playDurationSec && Number(playDurationSec) > 0) {
      ffmpegArgs.push('-t', String(Math.ceil(Number(playDurationSec))));
    }
    ffmpegArgs.push('pipe:1');

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 19 : -5); } catch (e) {}
    }

    let ffmpegStderr = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
      if (ffmpegStderr.length > 4000) ffmpegStderr = ffmpegStderr.slice(-2000);
    });

    ffmpegProcess.stdin?.on('error', () => {});
    ffmpegProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') console.error('[FFmpeg File Direct Error]:', err.message);
    });

    let firstChunkReceived = false;
    const passThroughStream = new PassThrough({ highWaterMark: 1 << 19 });
    passThroughStream.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[PassThroughStream File Error]:', err.message);
      }
    });
    passThroughStream.on('close', () => {
      killProcess(ffmpegProcess);
    });
    ffmpegProcess.stdout.pipe(passThroughStream);

    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        killProcess(ffmpegProcess);
        reject(new Error('Quá thời gian chờ âm thanh từ SSD Cache File (Timeout 15s)'));
      }
    }, 15000);

    ffmpegProcess.stdout.once('data', () => {
      firstChunkReceived = true;
      clearTimeout(safetyTimeout);
      const resource = createAudioResource(passThroughStream, {
        inputType: StreamType.Raw,
        inlineVolume: true
      });
      resource.destroy = () => {
        killProcess(ffmpegProcess);
      };
      resolve(resource);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(safetyTimeout);
      if (!firstChunkReceived) {
        killProcess(ffmpegProcess);
        const lastErr = ffmpegStderr.slice(-200).trim();
        reject(new Error(`FFmpeg File Direct exited with code ${code}: ${lastErr}`));
      } else {
        killProcess(ffmpegProcess);
      }
    });
  });
}

const createCachedFfmpegStream = createDirectFileStream;

/**
 * Tạo một luồng phát đơn qua yt-dlp & FFmpeg với cơ chế kiểm tra gói dữ liệu đầu tiên (First-Chunk Confirmation)
 * Nếu YouTube bị chặn bot (ra 0 byte / code 183), hàm sẽ reject ngay lập tức để kích hoạt cơ chế Failover.
 */
async function createSingleStream(targetQueryOrUrl, crossfadeSeconds = 0, seekSeconds = 0, isSoundCloud = false, bypassCookie = false, playDurationSec = 0, cacheOptions = null, options = {}) {
  const isLowPriority = (options?.priority === 'low');
  if (typeof targetQueryOrUrl !== 'string' || !targetQueryOrUrl.trim()) {
    throw new Error('Target không hợp lệ');
  }
  const cleanTarget = targetQueryOrUrl.trim();
  if (cleanTarget.startsWith('-')) {
    throw new Error(`[Security Alert: Argument Injection Blocked] Target bắt đầu bằng dấu trừ (-): ${cleanTarget}`);
  }
  if (cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://')) {
    if (!isSafeExternalUrl(cleanTarget)) {
      throw new Error(`[Security Alert: SSRF Blocked] URL không an toàn: ${cleanTarget}`);
    }
  }

  // Tái sử dụng direct stream URL từ RAM Cache nếu còn hạn >= 30p
  const cachedStreamUrl = getCachedStreamUrl(cleanTarget);
  if (cachedStreamUrl && !bypassCookie) {
    try {
      console.log(`[Stream Cache Hit] Tái sử dụng trực tiếp Stream URL cho: "${cleanTarget}"`);
      return await createDirectFfmpegStream(cachedStreamUrl, seekSeconds, playDurationSec, options);
    } catch (cacheErr) {
      console.warn('[Stream Cache Failed, fallback sang yt-dlp stream]:', cacheErr.message);
      streamUrlCache.delete(cleanTarget);
    }
  }

  return new Promise((resolve, reject) => {
    const ytdlpOptions = {
      output: '-',
      format: 'bestaudio/best',
      ffmpegLocation: ffmpeg,
      noPlaylist: true,
      noWarnings: true,
      noProgress: true,
      socketTimeout: 10,
      retries: 2,
      bufferSize: '64K',
      httpChunkSize: '10M',
      concurrentFragments: 1,
      noCheckCertificates: true,
      jsRuntimes: `node:${process.execPath}`
    };

    if (!isSoundCloud) {
      ytdlpOptions.preferFreeFormats = true;
      ytdlpOptions.extractorArgs = bypassCookie ? 'youtube:player_client=ios,android' : YTDLP_EXTRACTOR_ARGS;
      const cookiesFile = bypassCookie ? null : getCookiesFile();
      if (cookiesFile) {
        ytdlpOptions.cookies = cookiesFile;
      }
    }

    ytdlpOptions['--'] = [cleanTarget];

    let ytdlpStreamProcess = null;
    try {
      ytdlpStreamProcess = ytdlp.exec('', ytdlpOptions);
      if (ytdlpStreamProcess) registerProcess(ytdlpStreamProcess);
    } catch (err) {
      return reject(err);
    }

    if (!ytdlpStreamProcess || !ytdlpStreamProcess.stdout) {
      return reject(new Error(`Không thể khởi chạy yt-dlp cho: ${cleanTarget}`));
    }

    if (process.platform === 'linux' && ytdlpStreamProcess.pid) {
      try { os.setPriority(ytdlpStreamProcess.pid, isLowPriority ? 19 : 5); } catch (e) {}
    }

    const ffmpegArgs = [];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }

    // Cấu hình FFmpeg xuất luồng âm thanh nguyên bản (Bit-perfect Pure Stream) chuẩn Discord Voice:
    // TUYỆT ĐỐI KHÔNG dùng filter động (-af dynaudnorm, loudnorm, acompressor, alc...) để tránh phập phù âm lượng (Audio Pumping)
    ffmpegArgs.push(
      '-analyzeduration', '0',
      '-probesize', '64k',
      '-thread_queue_size', '512',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-threads', '1'
    );
    if (playDurationSec && Number(playDurationSec) > 0) {
      ffmpegArgs.push('-t', String(Math.ceil(Number(playDurationSec))));
    }
    ffmpegArgs.push('pipe:1');

    // Nếu có tùy chọn lưu cache SSD (Cache Miss): Chỉ nén thêm luồng thứ hai libopus nếu người dùng cấu hình rõ ràng (tránh tốn CPU x3 trên VPS 1 core)
    const enableDiskCache = process.env.ENABLE_DISK_AUDIO_CACHE === 'true';
    if (enableDiskCache && cacheOptions?.tempPath) {
      const { isCpuOverloaded } = require('./systemMonitor');
      const isCpuBusyForCache = (typeof isCpuOverloaded === 'function' ? isCpuOverloaded(0.85) : Boolean(os.loadavg && os.loadavg()[0] > 0.85));
      if (isCpuBusyForCache) {
        cacheOptions?.onAbort?.();
        cacheOptions = null;
      } else {
        ffmpegArgs.push(
          '-vn',
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-compression_level', '0',
          '-f', 'ogg'
        );
        if (playDurationSec && Number(playDurationSec) > 0) {
          ffmpegArgs.push('-t', String(Math.ceil(Number(playDurationSec))));
        }
        ffmpegArgs.push('-y', cacheOptions.tempPath);
      }
    } else if (cacheOptions?.tempPath) {
      // Bỏ qua ghi cache ngầm khi đang phát trên VPS 1 core để dành 100% tài nguyên cho luồng âm thanh thời gian thực
      cacheOptions?.onAbort?.();
      cacheOptions = null;
    }

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 19 : -5); } catch (e) {}
    }

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
    const passThroughStream = new PassThrough({ highWaterMark: 1 << 19 });
    passThroughStream.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[PassThroughStream Error]:', err.message);
      }
    });
    passThroughStream.on('close', () => {
      try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
      killProcess(ffmpegProcess);
      killProcess(ytdlpStreamProcess);
      cacheOptions?.onAbort?.();
    });
    ffmpegProcess.stdout.pipe(passThroughStream);

    // Timeout bảo vệ: Cần 36 giây vì trên VPS 1 core CPU, yt-dlp + deno mất khoảng 18-22 giây để giải mã JS challenge của YouTube
    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        cacheOptions?.onAbort?.();
        reject(new Error('Quá thời gian chờ âm thanh từ nguồn này (Timeout 36s)'));
      }
    }, 36000);

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
        cacheOptions?.onAbort?.();
      };

      resolve(resource);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(safetyTimeout);
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        cacheOptions?.onAbort?.();
        const lastErr = (ytdlpStderr || ffmpegStderr).slice(-200).trim();
        reject(new Error(`FFmpeg exited with code ${code}: ${lastErr}`));
      } else {
        if (code !== 0 && code !== null) {
          const lastErr = (ffmpegStderr || ytdlpStderr).slice(-200).trim();
          if (lastErr) console.warn(`[FFmpeg exited code ${code}]:`, lastErr);
          cacheOptions?.onAbort?.();
        } else {
          // Lưu cache thành công khi FFmpeg hoàn tất tiến trình với mã 0
          cacheOptions?.onCommit?.();
        }
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
      }
    });
  });
}

/**
 * TẦNG 2: Failover sang SoundCloud khi YouTube bị chặn hoặc Circuit Breaker kích hoạt
 */
async function createSoundCloudFailoverStream(trackItem, cleanTitle, trackTitle, crossfadeSeconds = 0, seekSeconds = 0, playDurationSec = 0, options = {}) {
  console.log(`[Failover] Đang tìm kiếm bản phát chuẩn trên SoundCloud cho "${trackTitle}"...`);
  try {
    const is247Track = Boolean(trackItem && (trackItem.is247 || trackItem.requestedBy === 'Auto (24/7)' || trackItem.requestedBy === 'Auto'));
    const scSearchQuery = is247Track ? `${cleanTitle || 'lofi hip hop'} instrumental` : (cleanTitle || 'lofi chill');
    let scInfo = await ytdlp('', {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      httpChunkSize: '10M',
      bufferSize: '64K',
      '--': [`scsearch10:${scSearchQuery}`]
    });

    // Nếu tìm kiếm chi tiết không có kết quả, thử từ khóa ngắn gọn hơn để không bị rỗng
    if ((!scInfo || !scInfo.entries || scInfo.entries.length === 0) && is247Track && cleanTitle) {
      const compactScQuery = `${cleanTitle.split(/\s+/).slice(0, 3).join(' ')} instrumental`;
      try {
        scInfo = await ytdlp('', {
          dumpSingleJson: true,
          flatPlaylist: true,
          noWarnings: true,
          httpChunkSize: '10M',
          bufferSize: '64K',
          '--': [`scsearch10:${compactScQuery}`]
        });
      } catch (e) {}
    }

    if (scInfo && scInfo.entries && scInfo.entries.length > 0) {
      const userWantsRemix = /\b(remix|mashup|vinahouse|dj\b|mix|nonstop|liên\s*khúc)\b/i.test(trackTitle || '');
      let candidateTracks = scInfo.entries.filter(e => {
        if (!e || (!e.url && !e.webpage_url)) return false;
        if (e.duration && (e.duration < 45 || e.duration > 600)) return false;
        const titleLower = (e.title || '').toLowerCase();

        if (/\b(khá\s*bảnh|kha\s*banh|mặt\s*lồn|troll|meme|chế|hài|đụ|đụ\s*má|vãi|bựa|tiktok\s*remix|quẩy|nhạc\s*chế)\b/i.test(titleLower)) {
          return false;
        }

        if (is247Track) {
          if (!/\b(lofi|lo-fi|chill|beats?|instrumental|relax|study|coffee|sleep|ambient|piano|jazzhop)\b/i.test(titleLower)) {
            return false;
          }
        }

        if (!userWantsRemix) {
          if (/\b(playlist|mashup|vinahouse|dj\b|nonstop|liên\s*khúc|tổng\s*hợp|remix|flip|bootleg)\b/i.test(titleLower)) return false;
        }
        return true;
      });

      if (candidateTracks.length === 0 && is247Track && scInfo.entries.length > 0) {
        candidateTracks = scInfo.entries.filter(e => {
          if (!e || (!e.url && !e.webpage_url)) return false;
          if (e.duration && (e.duration < 45 || e.duration > 600)) return false;
          const titleLower = (e.title || '').toLowerCase();
          return !/\b(khá\s*bảnh|kha\s*banh|mặt\s*lồn|troll|meme|chế|hài|bựa|nhạc\s*chế)\b/i.test(titleLower);
        });
      }

      const userWantsCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(trackTitle || '');
      const expectedSec = (typeof trackItem === 'object' && trackItem !== null)
        ? (trackItem.spotifyDurationSec || (trackItem.durationMs ? Math.round(trackItem.durationMs / 1000) : (trackItem.duration ? parseDurationToSec(trackItem.duration) : 0)))
        : 0;

      candidateTracks.sort((a, b) => {
        // Ưu tiên 1: Đẩy bài Karaoke/Beat xuống sau nếu user không hỏi karaoke
        const aKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(a.title || '');
        const bKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(b.title || '');
        if (aKaraoke && !bKaraoke) return 1;
        if (!aKaraoke && bKaraoke) return -1;

        // Ưu tiên 2: Đẩy bài Cover/Hát lại xuống sau nếu bài gốc không phải cover
        if (!userWantsCover) {
          const aCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(a.title || '');
          const bCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(b.title || '');
          if (aCover && !bCover) return 1;
          if (!aCover && bCover) return -1;
        }

        // Ưu tiên 3: Khớp thời lượng gần nhất với bài gốc
        if (expectedSec > 45 && a.duration && b.duration) {
          const diffA = Math.abs(a.duration - expectedSec);
          const diffB = Math.abs(b.duration - expectedSec);
          return diffA - diffB;
        }
        return 0;
      });

      for (const candidate of candidateTracks.slice(0, 6)) {
        try {
          const streamUrl = candidate.webpage_url || candidate.url;
          console.log(`[SoundCloud] Đang thử phát ứng viên: "${candidate.title}" (${candidate.duration}s)...`);
          const resource = await createSingleStream(streamUrl, crossfadeSeconds, seekSeconds, true, false, playDurationSec, null, options);
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

/**
 * Trích xuất luồng âm thanh theo kiến trúc Failover 3 tầng có tích hợp Circuit Breaker
 */
async function _doCreateResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0, options = {}) {
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

  // CIRCUIT BREAKER: Nếu cầu chì YouTube đang ngắt -> Chuyển thẳng sang SoundCloud Failover
  const userSeek = Number(seekSeconds) || 0;
  const trimStart = (typeof trackItem === 'object' && trackItem?.trimStart) ? Number(trackItem.trimStart) : 0;
  const trimEnd = (typeof trackItem === 'object' && trackItem?.trimEnd) ? Number(trackItem.trimEnd) : 0;
  const effectiveSeek = trimStart + userSeek;
  const playDurationSec = (trimEnd > effectiveSeek) ? (trimEnd - effectiveSeek) : 0;

  // ⚡ LOCAL AUDIO DISK CACHE: Kiểm tra Cache Hit trên SSD (Tìm thông minh theo Video ID)
  const cachedEntry = audioCacheManager.findCachedEntry(trackItem, trimStart, trimEnd);
  if (cachedEntry && fs.existsSync(cachedEntry.filePath)) {
    try {
      console.log(`[AudioCache Hit] Phát tức thì từ SSD Cache: "${trackTitle}" (Seek: ${userSeek}s, Trim: ${cachedEntry.trimStart}s - ${cachedEntry.trimEnd}s)`);
      // Lưu ý: File trong SSD Cache đã được cắt sẵn phần đầu trimStart lúc lưu.
      // Khi phát lại, vị trí 00:00 của file chính là đầu bài hát đã cắt.
      // Do đó chỉ seek theo yêu cầu tua của người dùng (userSeek), tuyệt đối không cộng trimStart!
      const cachePlayDurationSec = (cachedEntry.trimEnd > cachedEntry.trimStart)
        ? Math.max(0, (cachedEntry.trimEnd - cachedEntry.trimStart) - userSeek)
        : playDurationSec;
      return await createDirectFileStream(cachedEntry.filePath, userSeek, cachePlayDurationSec, options);
    } catch (cachePlayErr) {
      console.warn(`[AudioCache Read Failed]:`, cachePlayErr.message);
    }
  }

  // Khởi tạo tùy chọn ghi cache khi Cache Miss (chỉ cache khi bài phát từ đầu 00:00)
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

    // Xử lý lỗi Cookie YouTube / Bot Detection
    const isCookieBotError = /sign in to confirm|confirm you're not a bot|this content isn't available|login|cookie|bot verification|403|429/i.test(errMsg);
    if (isCookieBotError) {
      try {
        const { notifyCookieExpired } = require('./statusNotifier');
        const client = global._discordClient;
        if (typeof notifyCookieExpired === 'function' && client) {
          notifyCookieExpired(client, null, `YouTube từ chối luồng âm thanh (${errMsg}) khi phát "${trackTitle}"`);
        }
      } catch (e) {}

      // Tự động thử lại không dùng cookie với player_client=android,ios
      try {
        console.log(`[YouTube Failover] Thử lại trực tiếp "${targetUrl}" không dùng cookie (android,ios)...`);
        const noCookieRes = await createSingleStream(targetUrl, crossfadeSeconds, effectiveSeek, false, true, playDurationSec, null, options);
        recordYouTubeSuccess();
        return noCookieRes;
      } catch (noCookieErr) {
        console.warn(`[YouTube No-Cookie Retry Failed]: ${noCookieErr.message.split('\n')[0]}`);
      }
    }

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

          // Ưu tiên các bản Audio / Lyrics / Topic / Visualizer lên đầu (nhẹ và ít kẹt luồng hơn MV 4K)
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

    // Chỉ khi TẤT CẢ các nhánh thử YouTube (Chính + No Cookie + Alternate) đều thất bại thì mới ghi nhận 1 lần lỗi bài hát cho Circuit Breaker
    recordYouTubeFailure(errMsg);

    // TẦNG 2: Failover sang SoundCloud
    return await createSoundCloudFailoverStream(trackItem, cleanTitle, trackTitle, crossfadeSeconds, effectiveSeek, playDurationSec, options);
  }
}

/**
 * Tạo Discord AudioResource được bọc qua hàng đợi ưu tiên 2 làn PrioritySemaphore:
 * - Tác vụ người dùng yêu cầu trực tiếp (/play, /skip, web playNow): priority = 'high'
 * - Tác vụ chạy ngầm (preload bài tiếp theo, autoplay): priority = 'low'
 */
async function createResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0, options = {}) {
  const priority = options?.priority || trackItem?.priority || 'high';
  return await extractionSemaphore.run(async () => {
    return await _doCreateResource(trackItem, crossfadeSeconds, seekSeconds, { ...options, priority });
  }, priority);
}

/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web & Discord Autocomplete (Siêu tốc độ qua Worker Thread)
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
  cleanupAllProcesses,
  validateAndSanitizeMusicUrl,
  searchTrack,
  searchMultipleTracks,
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack,
  getRelatedTrack,
  getRelatedTracksPool,
  createResource,
  analyzeTrackOriginAndMeta,
  resolveTrackOriginAndMetaAsync,
  extractCleanArtistAndTitle,
  buildAutoplayFallbackQueries,
  detectTrackRegion,
  isCandidateMatchingRegion,
  PrioritySemaphore,
  extractionSemaphore,
  isYouTubeCircuitOpen,
  streamUrlCache
};
