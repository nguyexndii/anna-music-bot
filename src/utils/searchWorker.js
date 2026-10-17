const { parentPort } = require('worker_threads');
const fetch = globalThis.fetch || require('node-fetch');
let yts = null;

try {
  yts = require('yt-search');
} catch (e) {}

/**
 * Chuẩn hóa chuỗi tiếng Việt: Bỏ dấu, chữ thường để so khớp chính xác
 */
function normalizeVi(str) {
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
 * Chuyển chuỗi định dạng MM:SS hoặc HH:MM:SS thành số giây
 */
function parseDurationToSec(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/**
 * Trích xuất số lượt xem từ chuỗi text
 */
function parseViews(str) {
  if (!str || typeof str !== 'string') return 0;
  const clean = str.replace(/[^\d]/g, '');
  return parseInt(clean, 10) || 0;
}

/**
 * Thuật toán chấm điểm và xếp hạng bài hát thông minh (Smart Vietnamese Music Ranking)
 */
function rankAndFilterTracks(tracks, rawQuery, mode = 'official') {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];
  const normQuery = normalizeVi(rawQuery);
  const queryWords = normQuery.split(/\s+/).filter(w => w.length >= 1);
  const rawLowerQuery = rawQuery.toLowerCase();

  const isQueryAskingKaraoke = /\b(karaoke|beat|instrumental|nhac song|tone nam|tone nu|tong nam|tong nu)\b/.test(normQuery);
  const isQueryAskingShort = /\b(short|shorts|tiktok)\b/.test(normQuery);
  const isQueryAskingLong = /\b(lofi|mix|playlist|1 hour|1 tieng|lien khuc|list|nhac tre|nonstop|full|album)\b/.test(normQuery);
  const isQueryAskingVariant = /\b(remix|cover|live|lofi|sped up|speed up|slowed|mashup|acoustic|vinahouse)\b/.test(normQuery);

  const scored = [];

  for (const t of tracks) {
    let score = 100;
    const normTitle = normalizeVi(t.title);
    const normArtist = normalizeVi(t.artist);
    const titleLower = (t.title || '').toLowerCase();
    const artistLower = (t.artist || '').toLowerCase();
    const sec = parseDurationToSec(t.duration);

    // 1. Loại bỏ video quá ngắn (Shorts / cut dưới 45 giây) trừ khi người dùng chủ động tìm shorts/tiktok
    if (sec > 0 && sec < 45 && !isQueryAskingShort) {
      continue;
    }
    if (sec > 0 && sec < 60 && !isQueryAskingShort) {
      score -= 60;
    }

    // 2. Điểm khớp từ khóa tìm kiếm
    if (normTitle.includes(normQuery) || normArtist.includes(normQuery)) {
      score += 50;
    }
    for (const word of queryWords) {
      if (word.length <= 1) continue;
      if (normTitle.includes(word)) {
        score += 15;
        if (rawLowerQuery.includes(word) && titleLower.includes(word)) {
          score += 5; // Khớp có dấu chính xác
        }
      }
      if (normArtist.includes(word)) {
        score += 10;
      }
    }

    // 3. Điểm Kênh Chính Chủ & Uy Tín
    const isTopic = artistLower.includes('- topic') || artistLower.includes('topic');
    const isOfficialChannel = isTopic || artistLower.includes('official') || artistLower.includes('vevo') || Boolean(t.isOfficial);
    if (isOfficialChannel) {
      score += 35;
    }
    if (/\b(official music video|official mv|official audio|official lyric video|official video)\b/i.test(titleLower)) {
      score += 25;
    }

    // 4. Điểm Thời Lượng Chuẩn Âm Nhạc (1p30s – 7p)
    if (sec >= 90 && sec <= 420) {
      score += 20;
    } else if (sec > 900 && !isQueryAskingLong) {
      score -= 35; // Trừ điểm video quá dài (1 hour, liên khúc) nếu người dùng không yêu cầu
    }

    // 5. Xử lý Karaoke / Beat
    const isKaraokeVideo = /\b(karaoke|beat chuan|nhac song|tong nam|tong nu|tone nam|tone nu|beat)\b/.test(normTitle);
    if (!isQueryAskingKaraoke && isKaraokeVideo) {
      score -= 80;
    }

    // 6. Xử lý Chế độ 'official' vs 'all'
    const isVariantVideo = /\b(remix|cover|live|lofi|sped up|speed up|slowed|mashup|vinahouse|dance ver|parody)\b/.test(normTitle);
    if (mode === 'official') {
      if (isOfficialChannel) {
        score += 30;
      }
      if (!isQueryAskingVariant && isVariantVideo) {
        score -= 45;
      }
    }

    // Làm sạch tên nghệ sĩ (xóa bỏ hậu tố thừa)
    const cleanArtist = (t.artist || 'YouTube')
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/\s*Official(?:\s*Channel)?$/i, '')
      .trim() || 'YouTube';

    scored.push({
      title: t.title,
      url: t.url,
      duration: t.duration || '3:30',
      thumbnail: t.thumbnail,
      artist: cleanArtist,
      isLive: Boolean(t.isLive),
      isOfficial: isOfficialChannel,
      score,
      views: parseViews(t.viewCountText)
    });
  }

  // Sắp xếp theo score giảm dần, nếu điểm bằng nhau thì ưu tiên lượt views cao hơn
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.views - a.views;
  });

  return scored;
}

/**
 * Tầng 1: Tìm kiếm trực tiếp qua YouTube InnerTube Search API (Nhanh, nhẹ < 1MB RAM, không parse HTML)
 */
async function searchWithInnerTube(query) {
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240726.00.00',
        hl: 'vi',
        gl: 'VN'
      }
    },
    query: query,
    params: 'EgIQAQ%3D%3D' // Bộ lọc video
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240726.00.00'
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    throw new Error(`InnerTube HTTP error: ${res.status}`);
  }

  const data = await res.json();
  const tracks = [];
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

  for (const section of sections) {
    const contents = section.itemSectionRenderer?.contents || [];
    for (const item of contents) {
      const vr = item.videoRenderer;
      if (!vr || !vr.videoId) continue;
      const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || '';
      const artist = vr.ownerText?.runs?.map(r => r.text).join('') || vr.shortBylineText?.runs?.map(r => r.text).join('') || 'YouTube';
      const duration = vr.lengthText?.simpleText || (vr.thumbnailOverlays?.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText) || '3:30';
      const thumbnails = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;
      const isLive = Boolean(vr.badges?.some(b => b.metadataBadgeRenderer?.style?.includes('LIVE') || b.metadataBadgeRenderer?.label?.toLowerCase().includes('live')));
      const isOfficial = Boolean(vr.ownerBadges?.some(b => b.metadataBadgeRenderer?.style?.includes('OFFICIAL') || b.metadataBadgeRenderer?.style?.includes('VERIFIED')));
      const viewCountText = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || '';

      tracks.push({
        title: title.trim(),
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        videoId: vr.videoId,
        artist: artist.trim(),
        duration,
        thumbnail,
        isLive,
        isOfficial,
        viewCountText
      });
    }
  }

  return tracks;
}

/**
 * Tầng 2: Fallback qua yt-search (chạy hoàn toàn trong Worker thread, an toàn cho Main thread)
 */
async function searchWithYtSearch(query) {
  if (!yts) return [];
  const r = await yts(query);
  if (!r || !r.videos || r.videos.length === 0) return [];
  return r.videos.map(v => ({
    title: v.title,
    url: v.url,
    videoId: v.videoId,
    duration: v.timestamp || (v.seconds ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}` : '3:30'),
    thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    artist: v.author?.name || 'YouTube',
    isLive: Boolean(v.live),
    isOfficial: Boolean((v.author?.name || '').toLowerCase().includes('topic') || (v.author?.name || '').toLowerCase().includes('official')),
    viewCountText: v.views ? `${v.views} views` : ''
  }));
}

/**
 * Lắng nghe lệnh tìm kiếm từ Main Thread
 */
if (parentPort) {
  parentPort.on('message', async (task) => {
    const { id, query, limit = 20, mode = 'official' } = task;
    try {
      let rawTracks = [];
      try {
        rawTracks = await searchWithInnerTube(query);
      } catch (innerTubeErr) {
        // Fallback sang yt-search
        try {
          rawTracks = await searchWithYtSearch(query);
        } catch (ytsErr) {}
      }

      if (!rawTracks || rawTracks.length === 0) {
        parentPort.postMessage({ id, results: [] });
        return;
      }

      // Xếp hạng và chấm điểm thông minh
      const ranked = rankAndFilterTracks(rawTracks, query, mode);
      const results = ranked.slice(0, Math.min(limit, 30));

      parentPort.postMessage({ id, results });
    } catch (err) {
      parentPort.postMessage({ id, results: [], error: err.message });
    }
  });
}

module.exports = {
  rankAndFilterTracks,
  normalizeVi,
  searchWithInnerTube,
  searchWithYtSearch
};
