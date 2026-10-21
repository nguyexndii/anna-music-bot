const os = require('os');
const fs = require('fs');

/**
 * Đọc bộ nhớ khả dụng thực tế trên Linux từ /proc/meminfo (MemAvailable bao gồm cả buffers/cache sẵn sàng giải phóng)
 * Tránh đọc sai số liệu os.freemem() vốn chỉ tính MemFree thuần túy.
 */
function getSystemAvailableMemoryMb() {
  if (process.platform === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const m = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/i);
      if (m && m[1]) {
        return Math.round(parseInt(m[1], 10) / 1024);
      }
    } catch (e) {}
  }
  return Math.round(os.freemem() / (1024 * 1024));
}

/**
 * Kiểm tra xem hệ thống có đủ RAM trống để tải trước (preload) bài tiếp theo không.
 * Ngưỡng an toàn mặc định là 300MB (có thể chỉnh qua biến môi trường PRELOAD_MIN_FREE_MB).
 */
function hasEnoughMemoryToPreload() {
  const minFreeMb = parseInt(process.env.PRELOAD_MIN_FREE_MB, 10) || 300;
  const availableMb = getSystemAvailableMemoryMb();

  if (availableMb < minFreeMb) {
    console.warn(`[RAM Guard] RAM khả dụng (${availableMb}MB) thấp hơn ngưỡng an toàn (${minFreeMb}MB). Bỏ qua preload để bảo vệ VPS 2GB.`);
    return false;
  }

  const rssMb = process.memoryUsage().rss / (1024 * 1024);
  if (rssMb >= 500) {
    if (typeof global.gc === 'function') {
      try { global.gc(); } catch (e) {}
    }
  }

  if (rssMb >= 650) {
    console.warn(`[RAM Guard] Tiến trình bot đang sử dụng ${rssMb.toFixed(0)}MB RAM (>= 650MB). Tạm hoãn preload để bảo vệ bộ nhớ.`);
    return false;
  }
  return true;
}

/**
 * Trả về thông số RAM hiện tại (MB)
 */
function getMemoryStats() {
  const mem = process.memoryUsage();
  const availableMemMb = getSystemAvailableMemoryMb();
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  return {
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    freeMemMb: availableMemMb,
    totalMemMb
  };
}

/**
 * Ghi log RAM có định dạng chuẩn
 */
function logMemoryUsage(tag = 'RAM Monitor') {
  const stats = getMemoryStats();
  console.log(`[${tag}] RSS: ${stats.rssMb}MB | Heap: ${stats.heapUsedMb}/${stats.heapTotalMb}MB | Avail Sys: ${stats.freeMemMb}/${stats.totalMemMb}MB`);
}

module.exports = {
  hasEnoughMemoryToPreload,
  getSystemAvailableMemoryMb,
  getMemoryStats,
  logMemoryUsage
};
