const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec');
const play = require('play-dl');
const yts = require('yt-search');
const fetch = globalThis.fetch || require('node-fetch');

const audioCacheManager = require('../../structures/AudioCacheManager');
const historyManager = require('../../structures/HistoryManager');
const settingsManager = require('../../structures/SettingsManager');
const { executeSearch } = require('../../utils/searchService');

const {
  getCookiesFile,
  YTDLP_EXTRACTOR_ARGS,
  registerProcess,
  killProcess,
  isYouTubeCircuitOpen,
  recordYouTubeFailure,
  recordYouTubeSuccess
} = require('./SemaphoreManager');

const {
  detectTrackRegion,
  normalizeSearchText,
  parseDurationToSec,
  stripYoutubeNoise,
  resolveTrackOriginAndMetaAsync,
  isCandidateMatchingRegion,
  buildAutoplayFallbackQueries,
  NON_MUSIC_BLACKLIST_REGEX,
  ANY_CJK_REGEX,
  EXTRACTOR_INSTRUMENT_NORM_REGEX,
  EXTRACTOR_INSTRUMENT_RAW_REGEX,
  EXTRACTOR_OTHER_VARIANT_NORM_REGEX,
  EXTRACTOR_KARAOKE_NORM_REGEX
} = require('./AppleMusicExtractor');

const ffmpeg = (process.platform === 'linux' && fs.existsSync('/usr/bin/ffmpeg'))
  ? '/usr/bin/ffmpeg'
  : (require('ffmpeg-static') || 'ffmpeg');

const DEFAULT_FALLBACK_THUMB = 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';

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

function parseViews(str) {
  if (!str || typeof str !== 'string') return 0;
  const clean = str.replace(/[^\d]/g, '');
  return parseInt(clean, 10) || 0;
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

/**
 * Nhận diện video là bản diễn live trên sân khấu / fancam / concert / listening party / demo
 */
function isLiveStageVideo(title) {
  if (!title || typeof title !== 'string') return false;
  return /(?:\[\s*live|\(\s*live|[\-|–—|]\s*live(?:\s+(?:at|in|on|version|ver|stage|performance)|$|\s*[)\]|])|\blive\s*(?:ver|version|performance|stage|session|at\b|in\b|listening)|liveshow|concert|fancam|listening\s*party|hát\s*live|sân\s*khấu|\bon\s*stage\b|\bstage\s*(?:ver|version)?\b|\bdemo\b)/i.test(title);
}

/**
 * Đánh giá độ khớp toàn diện giữa từ khóa tìm kiếm và ứng viên video YouTube.
 */
function scoreCandidateVideo(v, query, targetDurationSec = 0) {
  if (!v) return -999;
  const rawTitle = String(v.title || '');
  const rawAuthor = String(v.author?.name || v.uploader || v.channel || '');
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

function isSafeExternalUrl(urlStr) {
  return Boolean(validateAndSanitizeMusicUrl(urlStr));
}

/**
 * Kiểm tra xem một bài hát có nằm trong lịch sử phát gần nhất không
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

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 15 : 0); } catch (e) {}
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
        try { passThroughStream.destroy(); } catch (e) {}
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

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 15 : 0); } catch (e) {}
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
        try { passThroughStream.destroy(); } catch (e) {}
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
      ytdlpStreamProcess = ytdlp.exec('', ytdlpOptions, {
        detached: process.platform !== 'win32'
      });
      if (ytdlpStreamProcess) registerProcess(ytdlpStreamProcess);
    } catch (err) {
      return reject(err);
    }

    if (!ytdlpStreamProcess || !ytdlpStreamProcess.stdout) {
      return reject(new Error(`Không thể khởi chạy yt-dlp cho: ${cleanTarget}`));
    }

    if (process.platform === 'linux' && ytdlpStreamProcess.pid) {
      try { os.setPriority(ytdlpStreamProcess.pid, isLowPriority ? 15 : 0); } catch (e) {}
    }

    const ffmpegArgs = [];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }

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

    const enableDiskCache = process.env.ENABLE_DISK_AUDIO_CACHE === 'true';
    if (enableDiskCache && cacheOptions?.tempPath) {
      const { isCpuOverloaded } = require('../../utils/systemMonitor');
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
      cacheOptions?.onAbort?.();
      cacheOptions = null;
    }

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    registerProcess(ffmpegProcess);

    if (process.platform === 'linux' && ffmpegProcess.pid) {
      try { os.setPriority(ffmpegProcess.pid, isLowPriority ? 15 : 0); } catch (e) {}
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

    const onYtdlpEnd = () => {
      try {
        if (ffmpegProcess && ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
          ffmpegProcess.stdin.end();
        }
      } catch (e) {}
    };
    ytdlpStreamProcess.stdout.on('end', onYtdlpEnd);
    ytdlpStreamProcess.on('close', onYtdlpEnd);

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

    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        try { passThroughStream.destroy(); } catch (e) {}
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        cacheOptions?.onAbort?.();
        reject(new Error('Quá thời gian chờ âm thanh từ nguồn này (Timeout 14s)'));
      }
    }, 14000);

    ffmpegProcess.stdout.once('data', () => {
      firstChunkReceived = true;
      clearTimeout(safetyTimeout);

      const resource = createAudioResource(passThroughStream, {
        inputType: StreamType.Raw,
        inlineVolume: true
      });

      resource.destroy = () => {
        try { passThroughStream.destroy(); } catch (e) {}
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
        const aKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(a.title || '');
        const bKaraoke = /karaoke|ガイド無し|instrumental|off\s*vocal|backing\s*track/i.test(b.title || '');
        if (aKaraoke && !bKaraoke) return 1;
        if (!aKaraoke && bKaraoke) return -1;

        if (!userWantsCover) {
          const aCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(a.title || '');
          const bCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(b.title || '');
          if (aCover && !bCover) return 1;
          if (!aCover && bCover) return -1;
        }

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
 * Lấy danh sách YouTube Radio Mix (RD<videoId>) siêu nhẹ qua InnerTube HTTP API
 */
async function fetchInnerTubeMix(videoId) {
  if (!videoId || typeof videoId !== 'string') return null;
  const body = {
    videoId: videoId,
    playlistId: 'RD' + videoId,
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20241126.01.00',
        hl: 'vi',
        gl: 'VN'
      }
    }
  };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const contents = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents;
    if (!contents || !Array.isArray(contents) || contents.length === 0) return null;

    const entries = [];
    for (const wrapper of contents) {
      const item = wrapper?.playlistPanelVideoRenderer;
      if (!item || !item.videoId) continue;
      const title = item.title?.simpleText || (Array.isArray(item.title?.runs) ? item.title.runs.map(r => r.text).join('') : '');
      const artist = item.shortBylineText?.runs?.map(r => r.text).join('') || item.longBylineText?.runs?.map(r => r.text).join('') || '';
      const durStr = item.lengthText?.simpleText || (Array.isArray(item.lengthText?.runs) ? item.lengthText.runs.map(r => r.text).join('') : '') || '3:30';
      const durSec = parseDurationToSec(durStr);
      entries.push({
        id: item.videoId,
        title: title || 'YouTube Video',
        artist: artist || 'YouTube',
        channel: artist || 'YouTube',
        uploader: artist || 'YouTube',
        duration: durSec,
        url: `https://www.youtube.com/watch?v=${item.videoId}`,
        thumbnails: [{ url: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` }]
      });
    }
    return entries.length > 0 ? entries : null;
  } catch (e) {
    return null;
  }
}

/**
 * Lớp 1 (Ưu tiên cao nhất): Lấy bài tương tự từ YouTube Mix (RD<videoId>)
 */
async function getYoutubeMix(lastSong, guildId = null, playedList = [], targetRegion = null, returnAll = false) {
  if (!lastSong || !lastSong.url) return null;

  try {
    const match = lastSong.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (!match || !match[1]) return null;

    const videoId = match[1];
    const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
    const region = targetRegion || seedMeta.region;

    let entries = null;
    try {
      entries = await fetchInnerTubeMix(videoId);
    } catch (itErr) {}

    if (!entries || entries.length === 0) {
      const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
      const mixOpts = {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
        playlistEnd: 25,
        extractorArgs: YTDLP_EXTRACTOR_ARGS,
        httpChunkSize: '10M',
        bufferSize: '64K'
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
      entries = res?.entries || null;
    }

    if (entries && Array.isArray(entries) && entries.length > 0) {
      const validCandidates = [];

      for (const entry of entries) {
        if (!entry || !entry.title) continue;

        const trackUrl = entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
        if (!trackUrl) continue;

        if (trackUrl === lastSong.url || (entry.id && entry.id === videoId)) {
          continue;
        }

        if (isTrackInHistory(entry, guildId, playedList, 25)) {
          continue;
        }

        if (seedMeta.isRemix && !/\b(remix|vinahouse|vinahey|mix|dj|bootleg|dance|ver|quẩy)\b/i.test(entry.title)) {
          continue;
        }

        if (region === 'INTL') {
          const candCombined = `${entry.title} ${entry.artist || entry.uploader || ''}`;
          if (ANY_CJK_REGEX.test(candCombined)) continue;
          if (NON_MUSIC_BLACKLIST_REGEX.test(candCombined)) continue;
          const durationSec = entry.duration || 0;
          if (durationSec > 0 && (durationSec < 75 || durationSec > 600)) continue;
        } else {
          if (!isCandidateMatchingRegion(entry, region, seedMeta)) {
            continue;
          }
        }

        validCandidates.push({
          title: entry.title,
          artist: entry.uploader || entry.channel || entry.artist || 'YouTube',
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
 * Lớp 2 (Fallback thứ 2): Lấy bài tương tự từ Last.fm Similar Track API
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

      const searchLocale = region === 'INTL' ? 'en' : (region === 'VI' ? 'vi' : 'en');
      let results = [];
      try {
        results = await executeSearch(fullQuery, 5, seedMeta.isRemix ? 'all' : 'official', searchLocale);
      } catch (err) {}

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
    const seedMeta = await resolveTrackOriginAndMetaAsync(lastSong);
    const region = targetRegion || seedMeta.region;

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

module.exports = {
  ffmpeg,
  DEFAULT_FALLBACK_THUMB,
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
};
