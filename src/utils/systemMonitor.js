const os = require('os');

/**
 * Kiểm tra xem hệ thống có đủ RAM trống để tải trước (preload) bài tiếp theo không.
 * Ngưỡng an toàn mặc định là 300MB (có thể chỉnh qua biến môi trường PRELOAD_MIN_FREE_MB).
 */
function hasEnoughMemoryToPreload() {
  const minFreeMb = parseInt(process.env.PRELOAD_MIN_FREE_MB, 10) || 300;
  const freeMemMb = os.freemem() / (1024 * 1024);
  if (freeMemMb < minFreeMb) {
    console.warn(`[RAM Guard] RAM trống (${freeMemMb.toFixed(0)}MB) thấp hơn ngưỡng an toàn (${minFreeMb}MB). Bỏ qua preload để bảo vệ VPS 2GB.`);
    return false;
  }
  return true;
}

/**
 * Trả về thông số RAM hiện tại (MB)
 */
function getMemoryStats() {
  const mem = process.memoryUsage();
  const freeMemMb = os.freemem() / (1024 * 1024);
  const totalMemMb = os.totalmem() / (1024 * 1024);
  return {
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    freeMemMb: Math.round(freeMemMb),
    totalMemMb: Math.round(totalMemMb)
  };
}

/**
 * Ghi log RAM có định dạng chuẩn
 */
function logMemoryUsage(tag = 'RAM Monitor') {
  const stats = getMemoryStats();
  console.log(`[${tag}] RSS: ${stats.rssMb}MB | Heap: ${stats.heapUsedMb}/${stats.heapTotalMb}MB | Free Sys: ${stats.freeMemMb}/${stats.totalMemMb}MB`);
}

module.exports = {
  hasEnoughMemoryToPreload,
  getMemoryStats,
  logMemoryUsage
};
