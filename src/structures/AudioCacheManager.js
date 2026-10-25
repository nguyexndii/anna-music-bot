const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * AudioCacheManager
 * 
 * Quản lý bộ đệm âm thanh trên SSD (Local Audio Disk Cache) kiểu Muse Bot.
 * Lưu trữ định dạng Ogg Opus (128kbps, ~3.3MB/bài) đã cắt sẵn SponsorBlock.
 * Thuật toán LRU Eviction tự động giải phóng các bài cũ nhất khi tổng dung lượng vượt trần (mặc định 8GB).
 */
class AudioCacheManager {
  constructor() {
    this.cacheDir = path.join(__dirname, '../../data/audio-cache');
    // Mặc định 8 GB (hoặc cấu hình qua biến môi trường AUDIO_CACHE_MAX_GB)
    this.maxCacheBytes = (parseFloat(process.env.AUDIO_CACHE_MAX_GB) || 8) * 1024 * 1024 * 1024;
    // Không lưu cache các bài dài quá 15 phút (900 giây) để tránh ngốn đĩa
    this.maxTrackDurationSec = 900;
    // Bảng chỉ mục file trong RAM: cacheKey -> { filePath, size, lastAccessedAt }
    this.cacheMap = new Map();
    this.totalCacheBytes = 0;
    this.isInitialized = false;
  }

  /**
   * Khởi tạo bộ đệm: tạo thư mục, xóa file .tmp rác, nạp index vào RAM
   */
  async init() {
    if (this.isInitialized) return;
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const files = await fs.promises.readdir(this.cacheDir);
      for (const file of files) {
        const fullPath = path.join(this.cacheDir, file);
        // Xóa các file .tmp còn sót lại từ lần chạy trước (crash hoặc restart)
        if (file.endsWith('.tmp')) {
          try {
            await fs.promises.unlink(fullPath);
          } catch (e) {}
          continue;
        }

        if (file.endsWith('.opus') || file.endsWith('.ogg')) {
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size < 50 * 1024) {
              // File quá nhỏ (< 50KB) thường là file hỏng, tự động xóa
              await fs.promises.unlink(fullPath).catch(() => {});
              continue;
            }
            const key = file.replace(/\.(opus|ogg)$/, '');
            this.cacheMap.set(key, {
              filePath: fullPath,
              size: stat.size,
              lastAccessedAt: stat.mtimeMs || Date.now()
            });
            this.totalCacheBytes += stat.size;
          } catch (e) {}
        }
      }

      this.isInitialized = true;
      const totalMb = (this.totalCacheBytes / (1024 * 1024)).toFixed(1);
      const maxGb = (this.maxCacheBytes / (1024 * 1024 * 1024)).toFixed(0);
      console.log(`[AudioCache] Đã nạp ${this.cacheMap.size} bài hát từ SSD Cache (~${totalMb}MB / ${maxGb}GB)`);

      // Dọn dẹp nếu tổng dung lượng ban đầu đã vượt hạn mức
      this.evictIfNeeded().catch(() => {});
    } catch (err) {
      console.error('[AudioCache Init Error]:', err.message);
    }
  }

  /**
   * Sinh cache key duy nhất dựa vào URL và mốc cắt SponsorBlock
   */
  getCacheKey(song, trimStart = 0, trimEnd = 0) {
    if (!song) return null;
    const url = typeof song === 'string' ? song : (song.url || song.searchQuery || '');
    if (!url) return null;

    const tStart = Math.round(Number(trimStart) || 0);
    const tEnd = Math.round(Number(trimEnd) || 0);
    const trimSuffix = `t_${tStart}_${tEnd}`;

    // Nếu là liên kết YouTube: trích xuất video ID (11 ký tự)
    const ytMatch = url.match(/(?:v=|youtu\.be\/|vi\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch && ytMatch[1]) {
      return `yt_${ytMatch[1]}_${trimSuffix}`;
    }

    // Các nguồn khác (SoundCloud, Spotify resolved, v.v.): Hash SHA-1 của URL
    const hash = crypto.createHash('sha1').update(url).digest('hex').substring(0, 16);
    return `hash_${hash}_${trimSuffix}`;
  }

  /**
   * Kiểm tra bài hát có đủ điều kiện lưu Cache không
   */
  isCacheable(song) {
    if (!song) return false;
    if (song.isLive || song.duration === 'LIVE') return false;
    if (song.is247 || song.requestedBy === 'Auto (24/7)' || song.requestedBy === 'Auto (24/7 Lofi)') return false;

    // Kiểm tra thời lượng bài hát (chỉ cache bài <= 15 phút)
    let durSec = 0;
    if (typeof song.durationMs === 'number' && song.durationMs > 0) {
      durSec = Math.round(song.durationMs / 1000);
    } else if (typeof song.duration === 'string') {
      const p = song.duration.split(':').map(Number);
      if (!p.some(isNaN)) {
        durSec = p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) : (p.length === 2 ? (p[0] * 60 + p[1]) : p[0]);
      }
    }
    if (durSec > this.maxTrackDurationSec) {
      return false;
    }

    return true;
  }

  /**
   * Lấy đường dẫn file cache nếu có sẵn (Cache Hit) và cập nhật LRU timestamp
   */
  getCachedPath(song, trimStart = 0, trimEnd = 0) {
    if (!this.isCacheable(song)) return null;
    const key = this.getCacheKey(song, trimStart, trimEnd);
    if (!key) return null;

    const entry = this.cacheMap.get(key);
    if (entry && fs.existsSync(entry.filePath)) {
      // LRU Touch: Cập nhật mốc thời gian nghe gần nhất
      entry.lastAccessedAt = Date.now();
      fs.utimes(entry.filePath, new Date(), new Date(), () => {});
      return entry.filePath;
    }

    if (entry) {
      // File đã bị xóa ngoài luồng, dọn khỏi RAM map
      this.totalCacheBytes = Math.max(0, this.totalCacheBytes - entry.size);
      this.cacheMap.delete(key);
    }
    return null;
  }

  /**
   * Tạo đường dẫn file tạm .tmp để FFmpeg ghi luồng âm thanh trong lúc phát
   */
  createTempFilePath(song, trimStart = 0, trimEnd = 0) {
    if (!this.isCacheable(song)) return null;
    const key = this.getCacheKey(song, trimStart, trimEnd);
    if (!key) return null;

    return path.join(this.cacheDir, `${key}.${Date.now()}.tmp`);
  }

  /**
   * Xác nhận hoàn tất lưu file: Đổi tên nguyên tử từ .tmp sang .opus
   */
  async commitCache(song, tempPath, trimStart = 0, trimEnd = 0) {
    if (!tempPath || !fs.existsSync(tempPath)) return;
    const key = this.getCacheKey(song, trimStart, trimEnd);
    if (!key) {
      this.abortTemp(tempPath);
      return;
    }

    try {
      const stat = await fs.promises.stat(tempPath);
      // Nếu file nhỏ hơn 60KB (bị ngắt giữa chừng hoặc lỗi), xóa bỏ
      if (stat.size < 60 * 1024) {
        await fs.promises.unlink(tempPath).catch(() => {});
        return;
      }

      const finalPath = path.join(this.cacheDir, `${key}.opus`);
      await fs.promises.rename(tempPath, finalPath);

      // Cập nhật RAM map
      if (this.cacheMap.has(key)) {
        this.totalCacheBytes -= this.cacheMap.get(key).size;
      }
      this.cacheMap.set(key, {
        filePath: finalPath,
        size: stat.size,
        lastAccessedAt: Date.now()
      });
      this.totalCacheBytes += stat.size;

      const songTitle = typeof song === 'object' ? (song.title || 'Bài hát') : 'Bài hát';
      console.log(`[AudioCache Stored] Đã lưu vào SSD cache: "${songTitle}" (~${(stat.size / (1024 * 1024)).toFixed(2)}MB)`);

      // Kích hoạt dọn dẹp nếu tổng dung lượng vượt trần
      await this.evictIfNeeded();
    } catch (err) {
      console.warn('[AudioCache Commit Warning]:', err.message);
      this.abortTemp(tempPath);
    }
  }

  /**
   * Hủy file tạm nếu bài hát bị skip hoặc lỗi luồng âm thanh
   */
  abortTemp(tempPath) {
    if (!tempPath) return;
    fs.promises.unlink(tempPath).catch(() => {});
  }

  /**
   * Thuật toán LRU Eviction: Xóa các bài cũ nhất ít nghe nhất khi dung lượng vượt quá trần
   */
  async evictIfNeeded() {
    if (this.totalCacheBytes <= this.maxCacheBytes) return;

    // Ngưỡng an toàn sau khi dọn là 90% trần dung lượng
    const targetBytes = this.maxCacheBytes * 0.90;
    console.log(`[AudioCache LRU] Dung lượng hiện tại (${(this.totalCacheBytes / (1024 * 1024 * 1024)).toFixed(2)}GB) vượt trần ${(this.maxCacheBytes / (1024 * 1024 * 1024)).toFixed(0)}GB. Đang dọn dẹp về mức ${(targetBytes / (1024 * 1024 * 1024)).toFixed(2)}GB...`);

    // Sắp xếp các file theo lastAccessedAt tăng dần (cũ nhất lên đầu)
    const sorted = [...this.cacheMap.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    let deletedCount = 0;
    let freedBytes = 0;

    for (const [key, entry] of sorted) {
      if (this.totalCacheBytes <= targetBytes) break;

      try {
        if (fs.existsSync(entry.filePath)) {
          await fs.promises.unlink(entry.filePath);
        }
        this.totalCacheBytes -= entry.size;
        freedBytes += entry.size;
        this.cacheMap.delete(key);
        deletedCount++;
      } catch (e) {}
    }

    console.log(`[AudioCache LRU] Hoàn tất dọn dẹp: Đã xóa ${deletedCount} bài cũ nhất, giải phóng ${(freedBytes / (1024 * 1024)).toFixed(1)}MB trên SSD.`);
  }
}

// Singleton instance toàn hệ thống
const audioCacheManager = new AudioCacheManager();
audioCacheManager.init().catch(() => {});

module.exports = audioCacheManager;
