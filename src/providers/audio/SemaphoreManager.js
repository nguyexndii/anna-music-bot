const os = require('os');
const fs = require('fs');
const path = require('path');
const ytdlp = require('yt-dlp-exec');

// Đường dẫn file cookies YouTube (Netscape format). Cài trong .env: YTDLP_COOKIES_FILE=/root/anna-music-bot/youtube.cookies
// File này giúp yt-dlp xác thực để bypass kiểm tra bot của YouTube trên Datacenter IP
function getCookiesFile() {
  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(__dirname, '../../../youtube.cookies'),
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

// Cấu hình player client bypass kiểm tra bot của YouTube trên Datacenter IP (ưu tiên android trả về luồng HTTP phẳng)
const YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=android,mweb,ios';

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

/**
 * Phân giải Direct Stream URL (googlevideo.com) ngầm qua yt-dlp và lưu vào streamUrlCache
 */
async function resolveDirectStreamUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  const cleanTarget = targetUrl.trim();
  if (!cleanTarget) return null;

  const cached = getCachedStreamUrl(cleanTarget);
  if (cached) return cached;

  const baseOpts = {
    getUrl: true,
    format: 'bestaudio/best',
    noPlaylist: true,
    noWarnings: true,
    preferFreeFormats: true,
    socketTimeout: 10,
    retries: 1,
    extractorArgs: YTDLP_EXTRACTOR_ARGS,
    jsRuntimes: `node:${process.execPath}`,
    noCheckCertificates: true,
    '--': [cleanTarget]
  };

  const parseUrl = (raw) => {
    if (typeof raw !== 'string') return null;
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return lines.find(s => s.startsWith('http')) || null;
  };

  try {
    const opts = { ...baseOpts };
    const cFile = getCookiesFile();
    if (cFile) opts.cookies = cFile;
    const directUrl = await ytdlp('', opts);
    const urlStr = parseUrl(directUrl);
    if (urlStr) {
      setCachedStreamUrl(cleanTarget, urlStr);
      return urlStr;
    }
  } catch (e) {
    // Thử lại không cookie với player client dự phòng nếu lần đầu lỗi
    try {
      const retryOpts = { ...baseOpts, extractorArgs: 'youtube:player_client=ios,android' };
      const directUrl = await ytdlp('', retryOpts);
      const urlStr = parseUrl(directUrl);
      if (urlStr) {
        setCachedStreamUrl(cleanTarget, urlStr);
        return urlStr;
      }
    } catch (retryErr) {}
  }
  return null;
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
      const { notifyCookieExpired, checkYouTubeCookieHealth } = require('../../utils/statusNotifier');
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

function getYouTubeCircuitRemainingMinutes() {
  return Math.max(0, Math.ceil((skipYouTubeStreamUntil - Date.now()) / 60000));
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
    if (proc.stdin && typeof proc.stdin.destroy === 'function') {
      try { proc.stdin.destroy(); } catch (e) {}
    }
    if (proc.stdout && typeof proc.stdout.destroy === 'function') {
      try { proc.stdout.destroy(); } catch (e) {}
    }
    if (proc.stderr && typeof proc.stderr.destroy === 'function') {
      try { proc.stderr.destroy(); } catch (e) {}
    }
    if (proc.pid) {
      if (process.platform !== 'win32') {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) {}
      }
      try { process.kill(proc.pid, 'SIGKILL'); } catch (e) {}
    } else if (typeof proc.kill === 'function') {
      try { proc.kill('SIGKILL'); } catch (e) {}
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

module.exports = {
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
  getYouTubeCircuitRemainingMinutes,
  activeProcesses,
  registerProcess,
  killProcess,
  cleanupAllProcesses
};
