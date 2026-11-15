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

  const totalSec = song.ytDurationSec || song.rawDurationSec || (typeof song.duration === 'string' ? parseDurationToSec(song.duration) : Math.floor((song.durationMs || 0) / 1000));
  if (!totalSec || totalSec < 45 || totalSec > 1800) return null; // Chỉ áp dụng cho video từ 45s đến 30 phút

  // 1. Không cắt các bản Audio, Lyric Video, Visualizer, Topic, Cover, Remix, Live (vốn không có kịch bản MV)
  const fullTitle = `${song.title || ''} ${song.artist || ''} ${song.searchQuery || ''}`;
  if (/\b(official\s*audio|audio|lyric\s*video|lyrics|visualizer|topic|cover|remix|live)\b/i.test(fullTitle)) {
    return null;
  }

  // 2. Không cắt nếu thời lượng video YouTube đã khớp với bản nhạc chuẩn Spotify (lệch <= 10s)
  if (song.spotifyDurationSec && song.spotifyDurationSec > 0 && Math.abs(totalSec - song.spotifyDurationSec) <= 10) {
    return null;
  }

  // 3. Kiểm tra Cầu chì ngắt mạch (nếu server SponsorBlock vừa lỗi 5xx hoặc timeout)
  if (Date.now() < disabledUntil) {
    return null;
  }

  let items = null;
  const cached = sbCache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) {
    items = cached.items;
  } else {
    try {
      const apiUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodeURIComponent('["music_offtopic"]')}`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(1500) });

      if (res.status === 404) {
        // Video không có phân đoạn nào trong cơ sở dữ liệu -> Cache 6 giờ để không gọi lại
        if (sbCache.size >= MAX_SB_CACHE) sbCache.delete(sbCache.keys().next().value);
        sbCache.set(videoId, { items: [], expiresAt: Date.now() + 6 * 3600 * 1000 });
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
      // Chỉ nhận phân đoạn đã được locked bởi trusted user HOẶC có số phiếu bình chọn >= 2 (bỏ qua 0 vote hoặc vote âm)
      items = Array.isArray(data)
        ? data.filter(item => item && Array.isArray(item.segment) && item.segment.length === 2 && (item.locked === 1 || (typeof item.votes === 'number' && item.votes >= 2)))
        : [];

      if (sbCache.size >= MAX_SB_CACHE) sbCache.delete(sbCache.keys().next().value);
      sbCache.set(videoId, { items, expiresAt: Date.now() + 6 * 3600 * 1000 });
    } catch (err) {
      // Timeout mạng vượt quá 1.5 giây -> Bỏ qua ngay lập tức để không làm chậm luồng phát nhạc
      return null;
    }
  }

  if (!items || items.length === 0) return null;

  // 4. Sắp xếp và hợp nhất các phân đoạn chồng lấp (Overlapping segments)
  const merged = items
    .map(item => ({
      startTime: Number(item.segment[0]),
      endTime: Number(item.segment[1]),
      locked: item.locked,
      votes: item.votes || 0
    }))
    .filter(s => s.endTime > 0 && s.startTime < totalSec && s.endTime > s.startTime)
    .sort((a, b) => a.startTime - b.startTime)
    .reduce((acc, cur) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.endTime >= cur.startTime - 0.5) {
        prev.endTime = Math.max(prev.endTime, cur.endTime);
        prev.votes = Math.max(prev.votes, cur.votes);
        if (cur.locked === 1) prev.locked = 1;
      } else {
        acc.push({ ...cur });
      }
      return acc;
    }, []);

  if (merged.length === 0) return null;

  // 5. Xét phân đoạn Intro (chạm đầu <= 3s và dài >= 2.5s) và Outro (chạm đuôi >= totalSec - 4s và dài >= 2s)
  const first = merged[0];
  const last = merged[merged.length - 1];

  let trimStart = 0;
  let trimEnd = 0;
  let hasOutroTrim = false;

  if (first && first.startTime <= 3 && (first.endTime - first.startTime) >= 2.5) {
    const candTrimStart = Math.floor(first.endTime);
    // Giới hạn an toàn cho Intro: Nếu cắt > 15s thì bắt buộc video phải >= 240s và phân đoạn phải có locked = 1 hoặc votes >= 3
    if (candTrimStart > 15) {
      if (totalSec >= 240 && (first.locked === 1 || first.votes >= 3)) {
        trimStart = candTrimStart;
      }
    } else {
      trimStart = candTrimStart;
    }
  }

  if (last && last.endTime >= totalSec - 4 && (last.endTime - last.startTime) >= 2.0) {
    const candidateEnd = Math.ceil(last.startTime);
    if (candidateEnd > trimStart && candidateEnd < totalSec) {
      trimEnd = candidateEnd;
      hasOutroTrim = true;
    }
  }

  const effectiveEnd = hasOutroTrim ? trimEnd : totalSec;
  const realDurationSec = effectiveEnd - trimStart;
  const skippedOutroSec = hasOutroTrim ? (totalSec - trimEnd) : 0;
  const totalTrimmed = trimStart + skippedOutroSec;

  // 6. Ngưỡng bảo vệ an toàn: Không cắt nếu bài còn < 35s hoặc phần cắt chiếm > 50% thời lượng video
  if (totalTrimmed <= 0 || realDurationSec < 35 || totalTrimmed > totalSec * 0.5) {
    return null;
  }

  return {
    trimStart,
    trimEnd: hasOutroTrim ? trimEnd : 0,
    realDurationSec,
    skippedIntroSec: trimStart,
    skippedOutroSec
  };
}

function parseDurationToSec(durationStr) {
  if (typeof durationStr === 'number' && !isNaN(durationStr)) return Math.max(0, Math.floor(durationStr));
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
