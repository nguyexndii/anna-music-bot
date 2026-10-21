const fetch = globalThis.fetch || require('node-fetch');

// Bộ nhớ đệm RAM: videoId -> { segments, expiresAt }
const sbCache = new Map();
const MAX_SB_CACHE = 500;
let disabledUntil = 0; // Cầu chì ngắt mạch (Circuit Breaker) khi máy chủ SponsorBlock sập / timeout

function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/v\/)([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(url) ? url : null);
}

/**
 * Phân tích và tính toán phân đoạn cắt kịch mở đầu (intro) và credit kết thúc (outro)
 * Trả về { trimStart, trimEnd, realDurationSec, skippedIntroSec, skippedOutroSec } hoặc null nếu không cần cắt.
 */
async function resolveSponsorBlockTrim(song) {
  if (!song || song.isLive || song.is247) return null;
  const videoId = extractYouTubeId(song.url);
  if (!videoId) return null;

  const totalSec = song.rawDurationSec || (typeof song.duration === 'string' ? parseDurationToSec(song.duration) : Math.floor((song.durationMs || 0) / 1000));
  if (!totalSec || totalSec < 45 || totalSec > 1800) return null; // Chỉ áp dụng cho video từ 45s đến 30 phút

  // 1. Kiểm tra Cầu chì ngắt mạch (nếu server SponsorBlock vừa lỗi 5xx hoặc timeout)
  if (Date.now() < disabledUntil) {
    return null;
  }

  let segments = null;
  const cached = sbCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    segments = cached.segments;
  } else {
    try {
      const apiUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodeURIComponent('["music_offtopic"]')}`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(1500) });

      if (res.status === 404) {
        // Video không có phân đoạn nào trong cơ sở dữ liệu -> Cache 6 giờ để không gọi lại
        if (sbCache.size >= MAX_SB_CACHE) sbCache.delete(sbCache.keys().next().value);
        sbCache.set(videoId, { segments: [], expiresAt: Date.now() + 6 * 3600 * 1000 });
        return null;
      }

      if (res.status >= 500) {
        // Máy chủ SponsorBlock quá tải hoặc lỗi 502/504 -> Ngắt kết nối trong 5 phút để bảo vệ VPS
        disabledUntil = Date.now() + 5 * 60 * 1000;
        console.warn(`[SponsorBlock Circuit Breaker] Máy chủ SponsorBlock phản hồi mã ${res.status}. Tạm ngắt kết nối trong 5 phút.`);
        return null;
      }

      if (!res.ok) return null;

      const data = await res.json();
      segments = Array.isArray(data)
        ? data.map(item => item.segment).filter(s => Array.isArray(s) && s.length === 2)
        : [];

      if (sbCache.size >= MAX_SB_CACHE) sbCache.delete(sbCache.keys().next().value);
      sbCache.set(videoId, { segments, expiresAt: Date.now() + 6 * 3600 * 1000 });
    } catch (err) {
      // Timeout mạng vượt quá 1.5 giây -> Bỏ qua ngay lập tức để không làm chậm luồng phát nhạc
      return null;
    }
  }

  if (!segments || segments.length === 0) return null;

  // 2. Sắp xếp và hợp nhất các phân đoạn chồng lấp (Overlapping segments)
  const merged = segments
    .map(([startTime, endTime]) => ({ startTime: Number(startTime), endTime: Number(endTime) }))
    .filter(s => s.endTime > 0 && s.startTime < totalSec && s.endTime > s.startTime)
    .sort((a, b) => a.startTime - b.startTime)
    .reduce((acc, cur) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.endTime >= cur.startTime - 0.5) {
        prev.endTime = Math.max(prev.endTime, cur.endTime);
      } else {
        acc.push({ ...cur });
      }
      return acc;
    }, []);

  if (merged.length === 0) return null;

  // 3. Xét phân đoạn Intro (chạm đầu <= 3s và dài >= 2.5s) và Outro (chạm đuôi >= totalSec - 4s và dài >= 2s)
  const first = merged[0];
  const last = merged[merged.length - 1];

  let trimStart = 0;
  let trimEnd = totalSec;

  if (first && first.startTime <= 3 && (first.endTime - first.startTime) >= 2.5) {
    trimStart = Math.floor(first.endTime);
  }

  if (last && last.endTime >= totalSec - 4 && (last.endTime - last.startTime) >= 2.0) {
    const candidateEnd = Math.ceil(last.startTime);
    if (candidateEnd > trimStart) {
      trimEnd = candidateEnd;
    }
  }

  const realDurationSec = trimEnd - trimStart;
  const totalTrimmed = trimStart + (totalSec - trimEnd);

  // 4. Ngưỡng bảo vệ an toàn: Không cắt nếu bài còn < 35s hoặc phần cắt chiếm > 50% thời lượng video
  if (totalTrimmed <= 0 || realDurationSec < 35 || totalTrimmed > totalSec * 0.5) {
    return null;
  }

  return {
    trimStart,
    trimEnd,
    realDurationSec,
    skippedIntroSec: trimStart,
    skippedOutroSec: totalSec - trimEnd
  };
}

function parseDurationToSec(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

module.exports = {
  resolveSponsorBlockTrim,
  extractYouTubeId
};
