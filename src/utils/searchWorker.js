const { parentPort } = require('worker_threads');
const fetch = globalThis.fetch || require('node-fetch');
let yts = null;
try {
  yts = require('yt-search');
} catch (e) {}

// ─── PRE-COMPILED REGEX CONSTANTS (Tối ưu 0ms CPU trên VPS 1 Core) ───────────
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g;

// Từ khóa nhạc cụ, bản biến tấu, cover, hát lại (trên chuỗi đã normalizeVi)
const INSTRUMENT_OR_COVER_NORM_REGEX = /\b(piano|ver\s*piano|piano\s*ver|piano\s*version|guitar|ver\s*guitar|guitar\s*ver|guitar\s*solo|acoustic|ver\s*acoustic|orchestra|symphony|violin|cello|flute|sao\s*truc|saxophone|sax\s*ver|kalimba|ukulele|organ|harp|dan\s*tranh|dan\s*bau|dan\s*nguyet|instrumental|khong\s*loi|nhac\s*cu|beat\s*piano|solo\s*ver|bien\s*tau|cover|hat\s*lai|covered\s*by)\b/i;

// Bắt thêm các ký hiệu viết tắt đặc thù trên tiêu đề gốc chưa bỏ dấu chấm/ngoặc
const INSTRUMENT_OR_COVER_RAW_REGEX = /(?:ver\.?\s*piano|piano\s*ver\.?|ver\.?\s*guitar|guitar\s*ver\.?|ver\.?\s*acoustic|acoustic\s*ver\.?|biến\s*tấu|hát\s*lại|nhạc\s*không\s*lời|\bcover\b|\bacoustic\b|\bpiano\b|\bguitar\b|\borchestra\b|\bviolin\b|\binstrumental\b)/i;

// Từ khóa biến thể nhịp độ / phối khí khác (Remix, Live, Sped up, Slowed, Lofi, Mashup...)
const OTHER_VARIANT_NORM_REGEX = /\b(remix|vinahouse|vinahey|lofi|lo\s*fi|sped\s*up|speed\s*up|slowed|reverb|nightcore|daycore|mashup|megamix|nonstop|bootleg|flip|live|live\s*stage|live\s*session|live\s*performance|hat\s*live|fancam|dance\s*ver|dance\s*practice|performance\s*ver|parody|nhac\s*che|demo|8d|16d|bass\s*boosted)\b/i;

const KARAOKE_NORM_REGEX = /\b(karaoke|beat\s*chuan|nhac\s*song|tong\s*nam|tong\s*nu|tone\s*nam|tone\s*nu|beat\s*goc|tach\s*nhac)\b/i;
const SHORT_NORM_REGEX = /\b(short|shorts|tiktok|reel|reels|capcut)\b/i;
const LONG_NORM_REGEX = /\b(lofi|mix|playlist|1\s*hour|1\s*tieng|2\s*hour|lien\s*khuc|nonstop|full\s*album|tuyen\s*tap)\b/i;
const TV_STAGE_NORM_REGEX = /\b(the\s*masked\s*singer|ca\s*si\s*mat\s*na|anh\s*trai\s*say\s*hi|anh\s*trai\s*vuot\s*ngan\s*chong\s*gai|chi\s*dep\s*dap\s*gio|rap\s*viet|giao\s*lo\s*thoi\s*gian|xuan\s*ha\s*thu\s*dong|may\s*lang\s*thang|in\s*the\s*moonlight|la\s*ca\s*hat\s*ca|forest\s*studio|vie\s*channel|htv2|vtv3|yeah1|fancam|live\s*stage|tuyen\s*tap|nhac\s*tre|lofi\s*chill|audio\s*lyric)\b/i;

const NON_MUSIC_REGEX = /\b(timer|countdown|study with me|pomodoro|stopwatch|flip clock|alarm sound|clock ticking|white noise|brown noise|pink noise|sound effect|fx sound|tieng dong ho|dong ho dem nguoc|dong ho bam gio|dong ho hen gio|ambient noise)\b/i;
const NON_MUSIC_BLACKLIST_REGEX = /\b(phân\s*tích|cốt\s*truyện|giải\s*thích|tóm\s*tắt|review|đánh\s*giá|hướng\s*dẫn|cách\s*chơi|build\s*nhân\s*vật|tiêu\s*điểm\s*tướng|gameplay|walkthrough|playthrough|let'?s\s*play|highlight|highlights|full\s*match|bình\s*luận|reaction|phản\s*ứng|podcast|talkshow|phỏng\s*vấn|interview|tin\s*tức|điểm\s*tin|tâm\s*sự|vlog|thử\s*thách|challenge|prank|thuyết\s*minh|lồng\s*tiếng|tập\s*\d+|ep\.?\s*\d+|episode\s*\d+|movie\s*recap|tier\s*list|lore|theory|giả\s*thuyết|analysis|explained|video\s*essay|documentary|tài\s*liệu|speedrun|stream\s*vod|livestream\s*archive|trailer\s*breakdown|easter\s*eggs|behind\s*the\s*scenes|making\s*of|hau\s*truong|teaser|trailer)\b/i;

const STUDIO_MASTER_REGEX = /\b(official\s*audio|official\s*music\s*video|official\s*mv|official\s*video|official\s*visualizer|official\s*lyric\s*video)\b/i;
const MUSIC_VIDEO_REGEX = /\b(official\s*music\s*video|official\s*mv|official\s*video)\b/i;

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
  if (typeof str === 'number' && !isNaN(str)) return Math.max(0, Math.floor(str));
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
 * Kiểm tra xem video có chứa từ khóa nhạc cụ / biến thể mà người dùng KHÔNG yêu cầu hay không
 */
function evaluateVariantPenalty(rawTitle, normTitle, normArtist, rawQuery, normQuery, mode = 'official') {
  const combinedCandidateNorm = `${normTitle} ${normArtist}`;
  const isQueryAskingInstrumentOrCover = INSTRUMENT_OR_COVER_NORM_REGEX.test(normQuery) || INSTRUMENT_OR_COVER_RAW_REGEX.test(rawQuery);
  const isQueryAskingOtherVariant = OTHER_VARIANT_NORM_REGEX.test(normQuery);

  // Miễn trừ phạt nhạc cụ / biến thể nếu video là bản phát hành chính thức (Official Audio / MV / Topic)
  // và từ khóa nhạc cụ (Piano, Guitar, Live) thuộc về chính tên gốc của bài hát (như "Piano Man", "Teardrops On My Guitar", "Live While We're Young")
  const isOfficialRelease = /\b(?:official\s*(?:music\s*)?video|official\s*audio|official\s*mv|official\s*lyric\s*video)\b/i.test(rawTitle) || normArtist.includes('topic');
  const hasExplicitVariantTag = /\b(?:ver\.?\s*piano|piano\s*ver|ver\.?\s*guitar|guitar\s*ver|ver\.?\s*acoustic|acoustic\s*ver|cover|solo|fingerstyle|acoustic version|piano version|guitar solo|khong loi|instrumental|bien tau|hat lai|sheet|tutorial|huong dan|live stage|live session|hat live|fancam)\b/i.test(rawTitle);
  const isExemptFromInstrumentPenalty = isOfficialRelease && !hasExplicitVariantTag;

  let isCandidateInstrumentOrCover = INSTRUMENT_OR_COVER_NORM_REGEX.test(normTitle) || INSTRUMENT_OR_COVER_RAW_REGEX.test(rawTitle);
  let isCandidateOtherVariant = OTHER_VARIANT_NORM_REGEX.test(combinedCandidateNorm);

  if (isExemptFromInstrumentPenalty) {
    isCandidateInstrumentOrCover = false;
    // Nếu chỉ dính chữ "live" trong tiêu đề chính thức (ví dụ "Live While We're Young"), không phạt
    if (/\blive\b/i.test(normTitle) && !/\b(?:live\s*stage|live\s*session|hat\s*live|fancam|live\s*concert)\b/i.test(normTitle)) {
      isCandidateOtherVariant = false;
    }
  }

  let penalty = 0;
  let isUnrequestedVariant = false;

  // 1. Phạt cực nặng (-95 đến -100đ) nếu video là bản Piano / Guitar / Acoustic / Nhạc cụ / Cover mà user KHÔNG yêu cầu
  if (isCandidateInstrumentOrCover && !isQueryAskingInstrumentOrCover) {
    penalty += (mode === 'official' ? 100 : 85);
    isUnrequestedVariant = true;
  }

  // 2. Phạt nếu video là bản Remix / Live / Sped up / Slowed / Parody mà user KHÔNG yêu cầu
  if (isCandidateOtherVariant && !isQueryAskingOtherVariant) {
    penalty += (mode === 'official' ? 65 : 35);
    isUnrequestedVariant = true;
  }

  return {
    penalty,
    isUnrequestedVariant,
    isCandidateInstrumentOrCover,
    isCandidateOtherVariant
  };
}

/**
 * Thuật toán chấm điểm và xếp hạng bài hát thông minh (Smart Vietnamese Music Ranking)
 */
function rankAndFilterTracks(tracks, rawQuery, mode = 'official') {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];
  const safeRawQuery = String(rawQuery || '');
  const normQuery = normalizeVi(safeRawQuery);
  const queryWords = normQuery.split(/\s+/).filter(w => w.length >= 1);
  const rawLowerQuery = safeRawQuery.toLowerCase();

  const isQueryAskingKaraoke = KARAOKE_NORM_REGEX.test(normQuery) || /\b(instrumental|beat)\b/.test(normQuery);
  const isQueryAskingShort = SHORT_NORM_REGEX.test(normQuery);
  const isQueryAskingLong = LONG_NORM_REGEX.test(normQuery);
  const isQueryAskingTvOrStage = TV_STAGE_NORM_REGEX.test(normQuery);
  const isQueryAskingNonMusic = NON_MUSIC_REGEX.test(rawLowerQuery) || NON_MUSIC_REGEX.test(normQuery);
  const isQueryAskingNonMusicBlacklist = NON_MUSIC_BLACKLIST_REGEX.test(rawLowerQuery) || NON_MUSIC_BLACKLIST_REGEX.test(normQuery);

  const scored = [];
  for (const t of tracks) {
    let score = 100;
    const rawTitle = String(t.title || '');
    const normTitle = normalizeVi(rawTitle);
    const normArtist = normalizeVi(t.artist);
    const titleLower = rawTitle.toLowerCase();
    const artistLower = (t.artist || '').toLowerCase();
    const sec = parseDurationToSec(t.duration);

    // 0. Loại bỏ video rác không phải âm nhạc
    if (!isQueryAskingNonMusic && (NON_MUSIC_REGEX.test(titleLower) || NON_MUSIC_REGEX.test(normTitle))) {
      continue;
    }
    if (!isQueryAskingNonMusicBlacklist && (NON_MUSIC_BLACKLIST_REGEX.test(titleLower) || NON_MUSIC_BLACKLIST_REGEX.test(normTitle))) {
      continue;
    }
    // 0.1. Loại bỏ video dài trên 30 phút (> 1800s) nếu không tìm mix/lofi/playlist
    if (sec > 1800 && !isQueryAskingLong) {
      continue;
    }
    // 1. Loại bỏ video quá ngắn (Shorts / Teaser < 45 giây)
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

    // 2.1 Cộng điểm khớp cụm từ tên bài hát & ca sĩ chính xác (+30 điểm)
    const cleanTitleNoBracket = normTitle.replace(/\[.*?\]|\(.*?\)/g, '').trim();
    if (
      normTitle.startsWith(normQuery) ||
      cleanTitleNoBracket.startsWith(normQuery) ||
      cleanTitleNoBracket.endsWith(normQuery) ||
      new RegExp(`^(?:[a-z0-9\\s]+\\s*-\\s*)?${normQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*-\\s*[a-z0-9\\s]+)?$`).test(cleanTitleNoBracket)
    ) {
      score += 30;
    }

    // 3. Đánh giá biến thể Nhạc cụ / Piano / Guitar / Cover / Remix TRƯỚC khi cộng điểm Studio Master
    const variantEval = evaluateVariantPenalty(rawTitle, normTitle, normArtist, safeRawQuery, normQuery, mode);
    if (variantEval.penalty > 0) {
      score -= variantEval.penalty;
    }

    // 4. Phân biệt Kênh Nghệ Sĩ Chính Thức vs Kênh Gameshow / TV Show
    const combinedInfo = `${normTitle} ${normArtist}`;
    const isTvShowOrStage = TV_STAGE_NORM_REGEX.test(combinedInfo);
    const isTopic = artistLower.includes('- topic') || /\btopic\b/.test(artistLower);
    const isOfficialChannel = isTopic || artistLower.includes('official') || artistLower.includes('vevo') || Boolean(t.isOfficial);

    if (isTvShowOrStage && !isQueryAskingTvOrStage) {
      score -= (mode === 'official' ? 75 : 45);
    } else if (isOfficialChannel) {
      score += 35;
    }

    // 5. Điểm Bản Gốc Phòng Thu (Studio Master / Official Audio / Official MV)
    // QUAN TRỌNG: Nếu video là bản biến thể không được yêu cầu (ví dụ: "(ver.PIANO) | Official Video"),
    // TUYỆT ĐỐI KHÔNG cộng điểm isStudioMaster (+50) hay isMusicVideo (+20)!
    const isStudioMaster = isTopic || STUDIO_MASTER_REGEX.test(titleLower);
    const isMusicVideo = MUSIC_VIDEO_REGEX.test(titleLower);
    if (!variantEval.isUnrequestedVariant) {
      if (isStudioMaster) {
        score += 50;
        // Ưu tiên nhẹ bản Official Audio / Topic / Visualizer chuẩn phòng thu hơn MV có kịch bản dài
        if (isTopic || /\b(official\s*audio|official\s*visualizer)\b/i.test(titleLower)) {
          score += 12;
        }
      } else if (isMusicVideo) {
        score += 20;
      }
    }

    // 6. Điểm Thời Lượng Chuẩn Âm Nhạc (1p30s – 7p)
    if (sec >= 90 && sec <= 420) {
      score += 20;
    } else if (sec > 900 && !isQueryAskingLong) {
      score -= 35;
    } else if (sec >= 900 && isQueryAskingLong) {
      score += 35;
    }

    // 7. Xử lý Karaoke / Beat
    const isKaraokeVideo = KARAOKE_NORM_REGEX.test(normTitle);
    if (!isQueryAskingKaraoke && isKaraokeVideo) {
      score -= 90;
    }

    // 8. Thưởng thêm cho kênh chính thức ở mode 'official' nếu là bản gốc
    if (mode === 'official' && isOfficialChannel && !variantEval.isUnrequestedVariant && (!isTvShowOrStage || isQueryAskingTvOrStage)) {
      score += 30;
    }

    // 9. Trọng số Lượt Xem (views)
    const views = parseViews(t.viewCountText);
    if (views > 1000 && sec >= 60 && sec <= 500) {
      const viewBonus = Math.min(45, Math.max(0, Math.round((Math.log10(views) - 3) * 10)));
      score += viewBonus;
    }

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
      views
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.views - a.views;
  });

  return scored;
}

// ─── BỘ NHỚ ĐỆM RAW TRACKS (Chống spam API, giữ raw results để đổi mode tức thì 0ms) ───
const rawTrackCache = new Map();
const RAW_CACHE_MAX = 200;
const RAW_CACHE_TTL_MS = 15 * 60 * 1000;

function getCachedRawTracks(cacheKey) {
  const cached = rawTrackCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.time > RAW_CACHE_TTL_MS) {
    rawTrackCache.delete(cacheKey);
    return null;
  }
  return cached.tracks;
}

function setCachedRawTracks(cacheKey, tracks) {
  if (rawTrackCache.size >= RAW_CACHE_MAX) {
    const firstKey = rawTrackCache.keys().next().value;
    if (firstKey) rawTrackCache.delete(firstKey);
  }
  rawTrackCache.set(cacheKey, { time: Date.now(), tracks });
}

/**
 * Tầng 1: Tìm kiếm trực tiếp qua YouTube InnerTube Search API
 */
async function searchWithInnerTube(query, locale = 'vi') {
  const isEn = locale === 'en';
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240726.00.00',
        hl: isEn ? 'en' : 'vi',
        gl: isEn ? 'US' : 'VN'
      }
    },
    query: query,
    params: 'EgIQAQ%3D%3D'
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
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
        const cleanTitle = (title || '').replace(INVISIBLE_CHARS_REGEX, '').trim();
        const cleanArtist = (artist || 'YouTube').replace(INVISIBLE_CHARS_REGEX, '').trim();
        const safeTitle = cleanTitle || (cleanArtist && cleanArtist !== 'YouTube' ? `${cleanArtist} - Audio` : (vr.videoId ? `Bài hát không tên (${vr.videoId})` : 'Bài hát không tên'));
        tracks.push({
          title: safeTitle,
          url: `https://www.youtube.com/watch?v=${vr.videoId}`,
          videoId: vr.videoId,
          artist: cleanArtist || 'YouTube',
          duration,
          thumbnail,
          isLive,
          isOfficial,
          viewCountText
        });
      }
    }
    return tracks;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Tầng 2: Fallback qua yt-search
 */
async function searchWithYtSearch(query) {
  if (!yts) return [];
  const r = await yts(query);
  if (!r || !r.videos || r.videos.length === 0) return [];
  return r.videos.map(v => {
    const cleanTitle = (v.title || '').replace(INVISIBLE_CHARS_REGEX, '').trim();
    const cleanArtist = (v.author?.name || 'YouTube').replace(INVISIBLE_CHARS_REGEX, '').trim();
    const safeTitle = cleanTitle || (cleanArtist && cleanArtist !== 'YouTube' ? `${cleanArtist} - Audio` : (v.videoId ? `Bài hát không tên (${v.videoId})` : 'Bài hát không tên'));
    return {
      title: safeTitle,
      url: v.url,
      videoId: v.videoId,
      duration: v.timestamp || (v.seconds ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}` : '3:30'),
      thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      artist: cleanArtist || 'YouTube',
      isLive: Boolean(v.live),
      isOfficial: Boolean((cleanArtist || '').toLowerCase().includes('topic') || (cleanArtist || '').toLowerCase().includes('official')),
      viewCountText: v.views ? `${v.views} views` : ''
    };
  });
}

if (parentPort) {
  parentPort.on('message', async (task) => {
    const { id, query, limit = 20, mode = 'official', locale = 'vi' } = task;
    try {
      const rawCacheKey = `${(query || '').toLowerCase().trim()}|${locale}`;
      let rawTracks = getCachedRawTracks(rawCacheKey);
      if (!rawTracks || rawTracks.length === 0) {
        const cleanQ = (query || '').trim();
        const isShortOrTimeQuery = /^\d{1,2}\s*(?:h|hr|hrs|hour|hours|gio|tieng)$/i.test(cleanQ) || (cleanQ.length <= 3 && !/^\d+$/.test(cleanQ));
        try {
          if (isShortOrTimeQuery) {
            const extraQuery = `${cleanQ} bài hát`;
            const [baseList, extraList] = await Promise.all([
              searchWithInnerTube(cleanQ, locale).catch(() => []),
              searchWithInnerTube(extraQuery, locale).catch(() => [])
            ]);
            const map = new Map();
            for (const item of [...baseList, ...extraList]) {
              const k = item.videoId || item.url;
              if (k && !map.has(k)) map.set(k, item);
            }
            rawTracks = Array.from(map.values());
          } else {
            rawTracks = await searchWithInnerTube(cleanQ, locale);
          }
        } catch (innerTubeErr) {
          try {
            if (isShortOrTimeQuery) {
              const extraQuery = `${cleanQ} bài hát`;
              const [baseList, extraList] = await Promise.all([
                searchWithYtSearch(cleanQ).catch(() => []),
                searchWithYtSearch(extraQuery).catch(() => [])
              ]);
              const map = new Map();
              for (const item of [...baseList, ...extraList]) {
                const k = item.videoId || item.url;
                if (k && !map.has(k)) map.set(k, item);
              }
              rawTracks = Array.from(map.values());
            } else {
              rawTracks = await searchWithYtSearch(cleanQ);
            }
          } catch (ytsErr) {}
        }
        if (Array.isArray(rawTracks) && rawTracks.length > 0) {
          setCachedRawTracks(rawCacheKey, rawTracks);
        }
      }
      if (!rawTracks || rawTracks.length === 0) {
        parentPort.postMessage({ id, results: [], alternateResults: [], alternateMode: mode === 'official' ? 'all' : 'official' });
        return;
      }
      const rankedOfficial = rankAndFilterTracks(rawTracks, query, 'official').slice(0, Math.min(limit, 30));
      const rankedAll = rankAndFilterTracks(rawTracks, query, 'all').slice(0, Math.min(limit, 30));
      const isOfficial = mode === 'official';
      const results = isOfficial ? rankedOfficial : rankedAll;
      const alternateResults = isOfficial ? rankedAll : rankedOfficial;
      const alternateMode = isOfficial ? 'all' : 'official';
      parentPort.postMessage({
        id,
        results,
        alternateResults,
        alternateMode,
        query,
        limit,
        locale
      });
    } catch (err) {
      parentPort.postMessage({ id, results: [], alternateResults: [], error: err.message });
    }
  });
}

module.exports = {
  rankAndFilterTracks,
  evaluateVariantPenalty,
  normalizeVi,
  searchWithInnerTube,
  searchWithYtSearch
};
