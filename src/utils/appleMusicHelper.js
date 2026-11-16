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

  // Bóc tách nếu có dạng "Ca sĩ - Bài hát" hoặc "Bài hát - Ca sĩ"
  let cleanArtist = String(rawArtist || '').replace(/\s*-\s*Topic$/i, '').trim();
  let cleanTrack = title;

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      const p0 = parts[0].trim();
      const p1 = parts.slice(1).join(' - ').trim();
      const normArt = normalizeSearchText(cleanArtist);
      const normP0 = normalizeSearchText(p0);
      const normP1 = normalizeSearchText(p1);

      if (normArt && (normP1.includes(normArt) || normP1 === normArt)) {
        // Tiêu đề dạng: "Tên bài hát - Ca sĩ" (ví dụ: "3107 3 - W/n ft. Duongg")
        cleanTrack = p0;
        cleanArtist = cleanArtist || p1;
      } else {
        // Tiêu đề dạng chuẩn: "Ca sĩ - Tên bài hát"
        cleanArtist = cleanArtist || p0;
        cleanTrack = p1;
      }
    }
  }

  // Làm sạch feat/ft./prod. để iTunes Search API không bị nhiễu
  cleanTrack = cleanTrack.replace(/\s*[\(\[](?:feat\.?|ft\.?|prod\.?|produced\s*by|beat\s*by|cùng|với)\s*[^()\[\]]+[\)\]]/gi, ' ')
                         .replace(/\s+(?:feat\.?|ft\.?|prod\.?|produced\s*by)\s+.+$/gi, ' ')
                         .trim();

  const queryParts = [];
  if (cleanArtist && cleanArtist.toLowerCase() !== 'youtube') {
    queryParts.push(cleanArtist);
  }
  if (cleanTrack) {
    const normArt = normalizeSearchText(cleanArtist);
    const normTrk = normalizeSearchText(cleanTrack);
    // Tránh lặp lại tên nghệ sĩ nếu trackName vô tình dính tên nghệ sĩ
    if (!normArt || normTrk !== normArt) {
      queryParts.push(cleanTrack);
    }
  }

  const finalQuery = queryParts.join(' ').replace(/\s+/g, ' ').trim();
  return {
    finalQuery: finalQuery || title,
    cleanArtist,
    cleanTrack
  };
}

// Từ điển nghệ sĩ phục vụ phân vùng chuẩn xác từ Apple Music
const INTL_ARTISTS_REGEX = /\b(bruno\s*mars|olivia\s*rodrigo|beyonce|beyoncé|taylor\s*swift|the\s*weeknd|alan\s*walker|ed\s*sheeran|ariana\s*grande|billie\s*eilish|justin\s*bieber|post\s*malone|dua\s*lipa|charlie\s*puth|shawn\s*mendes|sabrina\s*carpenter|lana\s*del\s*rey|adele|rihanna|katy\s*perry|lady\s*gaga|maroon\s*5|imagine\s*dragons|coldplay|onerepublic|chainsmokers|linkin\s*park|eminem|drake|kendrick\s*lamar|travis\s*scott|sza|doja\s*cat|billy\s*joel|one\s*direction|k\/da|kda|riot\s*games|vevo)\b/i;
const KPOP_ARTISTS_REGEX = /\b(rosé|rose|blackpink|bts|newjeans|aespa|ive|le\s*sserafim|twice|itzy|nmixx|babymonster|illit|kiss\s*of\s*life|stray\s*kids|seventeen|txt|enhypen|exo|bigbang|g\s*dragon|taeyang|iu|taeyeon|jungkook|jimin|lisa|jennie|jisoo|psy|g\s*i\s*dle|gidle|\(?g\)?-?i-dle|yg\s*entertainment|hybe|smtown|jyp)\b/i;
const JPOP_ARTISTS_REGEX = /\b(yoasobi|ayase|ado|kenshi\s*yonezu|fujii\s*kaze|radwimps|aimer|official\s*hige\s*dandism|king\s*gnu|vaundy|imase|hikaru\s*utada|yorushika|zutomayo|creepy\s*nuts|mrs\s*green\s*apple)\b/i;
const CPOP_ARTISTS_REGEX = /\b(jay\s*chou|jj\s*lin|g\.?e\.?m\.?|eric\s*chou|mayday|ren\s*ran|tinh\s*lung|ngai\s*than|tang\s*trieu|chau\s*tham|dong\s*lan|mong\s*nhien|dinh\s*dai\s*huong|douyin|pinyin|mandopop|cpop|c-pop)\b/i;
const KNOWN_VN_ARTISTS_REGEX = /\b(hngle|ari|bảo\s*anh|bao\s*anh|w\s*n|wn|w\s*\/\s*n|duongg|nalu|titie|3107|quang\s*hung\s*masterd|quang\s*hung|masterd|lil\s*z\s*poet|lil\s*z|son\s*tung|m\s*tp|mtp|hieuthuhai|hurrykng|manbo|negav|gerdnang|rpt\s*mck|mck|ngher|lope\s*pham|tlinh|wren\s*evans|mono|grey\s*d|den\s*vau|vu\s*cat\s*tuong|madihu|bich\s*phuong|hoa\s*minzy|erik|duc\s*phuc|quan\s*a\s*p|quan\s*ap|noo\s*phuoc\s*thinh|dong\s*nhi|ong\s*cao\s*thang|toc\s*tien|binz|soobin|soobin\s*hoang\s*son|rhymastic|justatee|karik|suboi|b\s*ray|bray|amee|hoang\s*dung|chillies|ca\s*hoi\s*hoang|ngot\s*band|da\s*lab|dalab|phan\s*manh\s*quynh|ha\s*anh\s*tuan|my\s*tam|ho\s*ngoc\s*ha|le\s*quyen|trung\s*quan|bui\s*anh\s*tuan|huong\s*tram|chi\s*pu|van\s*mai\s*huong|jsol|hoang\s*duyen|hua\s*kim\s*tuyen|kewtiie|gill|wxrdie|low\s*g|obito|shiki|vstra|tang\s*duy\s*tan|dat\s*g|du\s*uyen|k\s*icm|kicm|trinh\s*dinh\s*quang|mr\s*siro|only\s*c|onlyc|lou\s*hoang|miu\s*le|suni\s*ha\s*linh|lyly|anh\s*tu|dinh\s*dung|acv\s*music|phao|double2t|24k\s*right|rhyder|captain\s*boy|duong\s*domic|phap\s*kieu|jun\s*pham|isaac|st\s*son\s*thach|bui\s*cong\s*nam|kay\s*tran|datkaa|changg|thinh\s*suy|winno|ronboogz|wean|touliver|slimv|masew|hoaprox|2pillz|wokeup|machiot|marzuz|vu\s*phung\s*tien|phuong\s*ly|phuong\s*my\s*chi|dtap|hoang\s*thuy\s*linh|truc\s*nhan|tien\s*tien|tien\s*cookie|bui\s*truong\s*linh|buitruonglinh|dangrangto|52hz|rio|coldzy|16\s*typh|nguyen\s*tran\s*trung\s*quan)\b/i;

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
  const normArtist = normalizeSearchText(artistName);

  const isVnArtist = KNOWN_VN_ARTISTS_REGEX.test(normArtist) || KNOWN_VN_ARTISTS_REGEX.test(artistName);

  // 1. Nhận diện K-Pop / Hàn Quốc (KR) TRƯỚC (chặn ROSÉ bị dính dấu É tiếng Việt)
  if (!isVnArtist && (genre.includes('k-pop') || genre.includes('korean') || HANGUL_REGEX.test(combined) || KPOP_ARTISTS_REGEX.test(artistName) || KPOP_ARTISTS_REGEX.test(combined))) {
    return 'KR';
  }

  // 2. Nhận diện J-Pop / Anime / Nhật Bản (JP) TRƯỚC (chặn Kanji bị nhầm sang chữ Hán)
  if (!isVnArtist && (genre.includes('j-pop') || genre.includes('anime') || genre.includes('kayokyoku') || genre.includes('japanese') || KANA_REGEX.test(combined) || JPOP_ARTISTS_REGEX.test(artistName))) {
    return 'JP';
  }

  // 3. Nhận diện C-Pop / Mandopop / Trung Quốc (CN) TRƯỚC (chặn Pinyin có dấu như Cháo Xī bị nhận nhầm sang tiếng Việt)
  if (!isVnArtist && (genre.includes('mandopop') || genre.includes('c-pop') || genre.includes('cantopop') || genre.includes('chinese') || HANZI_REGEX.test(combined) || CPOP_ARTISTS_REGEX.test(artistName))) {
    return 'CN';
  }

  // 3.5. Nhận diện Âu Mỹ / Quốc tế nếu có nghệ sĩ quốc tế đã biết (Bruno Mars, Olivia Rodrigo...)
  if (!isVnArtist && (INTL_ARTISTS_REGEX.test(artistName) || INTL_ARTISTS_REGEX.test(combined))) {
    return 'INTL';
  }

  // 4. Nhận diện Nhạc Việt (VI) (ưu tiên nghệ sĩ Việt, genre V-Pop và dấu tiếng Việt)
  if (
    isVnArtist ||
    genre.includes('v-pop') ||
    genre.includes('vietnamese') ||
    genre.includes('nhạc việt') ||
    genre.includes('nhac viet') ||
    genre.includes('trữ tình') ||
    genre.includes('bolero') ||
    VI_DIACRITIC_REGEX.test(trackName) ||
    VI_DIACRITIC_REGEX.test(artistName) ||
    VI_DIACRITIC_REGEX.test(collectionName)
  ) {
    return 'VI';
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
        if (normCleanArtist && normCleanArtist !== 'youtube') {
          if (normArtist && (normRawArtist.includes(normArtist) || normArtist.includes(normCleanArtist) || normRawTitle.includes(normArtist) || normCleanArtist.includes(normArtist))) {
            score += 35;
          } else {
            // Phạt nếu tên bài trùng nhưng ca sĩ hoàn toàn khác (tránh ca khúc Âu Mỹ cướp bài V-Pop trùng tên)
            score -= 40;
          }
        } else if (normArtist && normRawTitle.includes(normArtist)) {
          score += 20;
        }

        if (score > highestScore && score >= 25) {
          highestScore = score;
          bestMatch = item;
        }
      }

      if (!bestMatch) {
        // Chỉ lấy item đầu tiên nếu không có cleanArtist cụ thể, hoặc nếu item đầu tiên cũng khớp ca sĩ
        const first = json.results[0];
        const normFirstTrack = normalizeSearchText(first.trackName);
        const normFirstArtist = normalizeSearchText(first.artistName || '');
        const artistMatches = !normCleanArtist || normCleanArtist === 'youtube' || normFirstArtist.includes(normCleanArtist) || normCleanArtist.includes(normFirstArtist) || normRawTitle.includes(normFirstArtist);
        if (artistMatches && (normRawTitle.includes(normFirstTrack) || normFirstTrack.includes(normCleanTrack))) {
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
