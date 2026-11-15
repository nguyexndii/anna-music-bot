const fetch = globalThis.fetch || require('node-fetch');

// Regex kiểm tra dấu tiếng Việt
const VI_DIACRITIC_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỖÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;
const HANZI_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

// Bộ đệm RAM cho kết quả Apple Music (LRU Cache tối đa 500 bản ghi)
const appleMetaCache = new Map();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 giờ
const NEGATIVE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút cho kết quả không tìm thấy

// Cache danh sách bài hát theo artistId
const appleArtistTracksCache = new Map();

// Coalescing: Chống gửi trùng request đang chờ phản hồi
const inFlightRequests = new Map();

function normalizeSearchText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Làm sạch chuỗi tiêu đề thô từ YouTube để tìm kiếm chuẩn xác trên iTunes API
 */
function cleanQueryForApple(rawTitle, rawArtist = '') {
  let title = String(rawTitle || '');

  // Xóa các cụm kỹ thuật YouTube thường thấy
  title = title
    .replace(/\[\s*(?:official|music|video|audio|mv|lyrics?|vietsub|visualizer|4k|hd|fhd|live|stage).*?\]/gi, ' ')
    .replace(/\(\s*(?:official|music|video|audio|mv|lyrics?|vietsub|visualizer|4k|hd|fhd|live|stage).*?\)/gi, ' ')
    .replace(/\b(?:official\s*(?:music\s*)?video|official\s*visualizer|official\s*audio|official\s*mv|official\s*lyrics?|visualizer|audio\s*official|lyric\s*video|music\s*video|mv\s*chính\s*thức|video\s*chính\s*thức|bản\s*chính\s*thức)\b/gi, ' ')
    .replace(/\b(?:ver\.?\s*piano|ver\.?\s*guitar|ver\.?\s*acoustic|piano\s*ver|guitar\s*ver|acoustic\s*ver|remix\s*vinahouse)\b/gi, ' ')
    .replace(/['"‘’“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Bóc tách nếu có dạng "Ca sĩ - Bài hát"
  let cleanArtist = String(rawArtist || '').replace(/\s*-\s*Topic$/i, '').trim();
  let cleanTrack = title;

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      cleanArtist = cleanArtist || parts[0].trim();
      cleanTrack = parts.slice(1).join(' - ').trim();
    }
  }

  const queryParts = [];
  if (cleanArtist && cleanArtist.toLowerCase() !== 'youtube') {
    queryParts.push(cleanArtist);
  }
  if (cleanTrack) {
    queryParts.push(cleanTrack);
  }

  const finalQuery = queryParts.join(' ').replace(/\s+/g, ' ').trim();
  return {
    finalQuery: finalQuery || title,
    cleanArtist,
    cleanTrack
  };
}

/**
 * Suy luận vùng ngôn ngữ (Region) từ metadata của Apple Music
 */
function inferRegionFromAppleItem(item) {
  if (!item) return 'INTL';

  const genre = String(item.primaryGenreName || '').toLowerCase();
  const trackName = String(item.trackName || '');
  const artistName = String(item.artistName || '');
  const collectionName = String(item.collectionName || '');
  const combined = `${trackName} ${artistName} ${collectionName}`;

  // 1. Nhận diện Nhạc Việt (VI)
  if (
    genre.includes('v-pop') ||
    genre.includes('vietnamese') ||
    genre.includes('nhạc việt') ||
    genre.includes('nhac viet') ||
    genre.includes('trữ tình') ||
    genre.includes('bolero') ||
    VI_DIACRITIC_REGEX.test(trackName) ||
    VI_DIACRITIC_REGEX.test(artistName)
  ) {
    return 'VI';
  }

  // 2. Nhận diện K-Pop / Hàn Quốc (KR)
  if (genre.includes('k-pop') || genre.includes('korean') || HANGUL_REGEX.test(combined)) {
    return 'KR';
  }

  // 3. Nhận diện J-Pop / Anime / Nhật Bản (JP)
  if (genre.includes('j-pop') || genre.includes('anime') || genre.includes('kayokyoku') || genre.includes('japanese') || KANA_REGEX.test(combined)) {
    return 'JP';
  }

  // 4. Nhận diện C-Pop / Mandopop / Trung Quốc (CN)
  if (genre.includes('mandopop') || genre.includes('c-pop') || genre.includes('cantopop') || genre.includes('chinese') || HANZI_REGEX.test(combined)) {
    return 'CN';
  }

  // 5. Mặc định là Nhạc Quốc tế / US-UK (INTL)
  return 'INTL';
}

/**
 * Tra cứu và chuẩn hóa Metadata động qua Apple Music (iTunes Search API)
 * Hoàn toàn miễn phí, không cần token/key, có cache RAM & chống trùng request.
 *
 * @param {string} rawTitle - Tiêu đề thô từ YouTube
 * @param {string} rawArtist - Tên kênh/ca sĩ thô từ YouTube
 * @returns {Promise<Object|null>} Object canonical metadata hoặc null nếu không tìm thấy
 */
async function resolveAppleMusicMetadata(rawTitle, rawArtist = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return null;

  const cacheKey = `${rawTitle.trim().toLowerCase()}|||${String(rawArtist || '').trim().toLowerCase()}`;
  const now = Date.now();

  // 1. Kiểm tra RAM Cache
  if (appleMetaCache.has(cacheKey)) {
    const entry = appleMetaCache.get(cacheKey);
    if (entry.expiresAt > now) {
      return entry.data; // Có thể là null (Negative Cache) hoặc metadata hợp lệ
    }
    appleMetaCache.delete(cacheKey);
  }

  // 2. In-flight request deduplication (Gom các request cùng lúc)
  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const { finalQuery, cleanTrack, cleanArtist } = cleanQueryForApple(rawTitle, rawArtist);
      if (!finalQuery || finalQuery.length < 2) return null;

      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(finalQuery)}&country=VN&media=music&entity=song&limit=5`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(1800) // Timeout 1.8s an toàn
      });

      if (!res.ok) {
        return null;
      }

      const json = await res.json();
      if (!json || !Array.isArray(json.results) || json.results.length === 0) {
        return null;
      }

      // 3. Tìm ứng viên khớp nhất trong danh sách trả về
      const normRawTitle = normalizeSearchText(rawTitle);
      const normRawArtist = normalizeSearchText(rawArtist);
      const normCleanTrack = normalizeSearchText(cleanTrack);
      const normCleanArtist = normalizeSearchText(cleanArtist);

      let bestMatch = null;
      let highestScore = -1;

      for (const item of json.results) {
        if (!item || !item.trackName) continue;

        const normTrack = normalizeSearchText(item.trackName);
        const normArtist = normalizeSearchText(item.artistName || '');
        let score = 0;

        // So khớp tên bài hát
        if (normTrack === normCleanTrack || normTrack === normRawTitle) {
          score += 50;
        } else if (normRawTitle.includes(normTrack) || normTrack.includes(normCleanTrack)) {
          score += 30;
        }

        // So khớp tên ca sĩ
        if (normArtist && (normRawArtist.includes(normArtist) || normArtist.includes(normCleanArtist))) {
          score += 30;
        } else if (normRawTitle.includes(normArtist)) {
          score += 20;
        }

        if (score > highestScore && score >= 30) {
          highestScore = score;
          bestMatch = item;
        }
      }

      if (!bestMatch) {
        // Nếu không có bài nào khớp trên 30 điểm, lấy bài đầu tiên nếu tên bài nằm trong tiêu đề
        const first = json.results[0];
        const normFirstTrack = normalizeSearchText(first.trackName);
        if (normRawTitle.includes(normFirstTrack) || normFirstTrack.includes(normCleanTrack)) {
          bestMatch = first;
        }
      }

      if (!bestMatch) {
        return null;
      }

      const region = inferRegionFromAppleItem(bestMatch);
      const result = {
        canonicalTitle: bestMatch.trackName,
        canonicalArtist: bestMatch.artistName,
        appleArtistId: bestMatch.artistId || null,
        primaryGenre: bestMatch.primaryGenreName || 'Music',
        durationMs: bestMatch.trackTimeMillis || 0,
        region,
        country: bestMatch.country || 'VNM',
        rawItem: bestMatch
      };

      return result;
    } catch (err) {
      // Bắt lỗi im lặng, trả về null để fallback về bộ phân tích cục bộ
      return null;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  const finalResult = await fetchPromise;

  // 4. Lưu kết quả vào RAM Cache (LRU Eviction nếu vượt quá kích thước)
  if (appleMetaCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = appleMetaCache.keys().next().value;
    if (oldestKey !== undefined) appleMetaCache.delete(oldestKey);
  }

  appleMetaCache.set(cacheKey, {
    data: finalResult,
    expiresAt: now + (finalResult ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)
  });

  return finalResult;
}

/**
 * Lấy danh sách các bài hát nổi bật khác của cùng ca sĩ từ Apple Music Lookup API
 * Dùng làm nguồn mồi cực chuẩn cho Autoplay Fallback (tránh hoàn toàn việc tìm lại tên bài cũ)
 *
 * @param {number|string} artistId - ID của nghệ sĩ trên Apple Music
 * @param {number} limit - Số bài hát tối đa cần lấy
 * @returns {Promise<Array<Object>>} Danh sách bài hát chuẩn của ca sĩ
 */
async function getAppleArtistTopTracks(artistId, limit = 20) {
  if (!artistId) return [];

  const cacheKey = `artist_${artistId}`;
  const now = Date.now();

  if (appleArtistTracksCache.has(cacheKey)) {
    const entry = appleArtistTracksCache.get(cacheKey);
    if (entry.expiresAt > now) {
      return entry.tracks;
    }
    appleArtistTracksCache.delete(cacheKey);
  }

  try {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(artistId)}&entity=song&country=VN&limit=${limit}`;
    const res = await fetch(lookupUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(1800)
    });

    if (!res.ok) return [];

    const json = await res.json();
    if (!json || !Array.isArray(json.results)) return [];

    // Lọc chỉ lấy các mục có wrapperType === 'track' (loại bỏ record thông tin artist)
    const tracks = json.results
      .filter(item => item && item.wrapperType === 'track' && item.trackName)
      .map(item => ({
        title: item.trackName,
        artist: item.artistName,
        primaryGenre: item.primaryGenreName,
        durationMs: item.trackTimeMillis,
        previewUrl: item.previewUrl
      }));

    if (appleArtistTracksCache.size >= 100) {
      const oldest = appleArtistTracksCache.keys().next().value;
      if (oldest !== undefined) appleArtistTracksCache.delete(oldest);
    }

    appleArtistTracksCache.set(cacheKey, {
      tracks,
      expiresAt: now + CACHE_TTL_MS
    });

    return tracks;
  } catch (err) {
    return [];
  }
}

module.exports = {
  resolveAppleMusicMetadata,
  getAppleArtistTopTracks,
  inferRegionFromAppleItem,
  appleMetaCache,
  appleArtistTracksCache
};
