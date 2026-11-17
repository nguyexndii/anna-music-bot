const {
  resolveAppleMusicMetadata,
  getAppleArtistTopTracks,
  appleMetaCache
} = require('../../utils/appleMusicHelper');

// ═════════════════════════════════════════════════════════════════════════════
// BỘ NHẬN DIỆN VÙNG NGÔN NGỮ & KHÓA CHẶT VÙNG AUTOPLAY (STRICT REGION LOCK)
// Tối ưu Pre-compiled Regex (0ms CPU, không tạo tiến trình con yt-dlp)
// ═════════════════════════════════════════════════════════════════════════════

const VI_DIACRITIC_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỖÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

// Bảng mã chữ viết tượng hình & phi Latinh
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/; // Tiếng Hàn (KR)
const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;                // Tiếng Nhật (JP)
const HANZI_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;   // Chữ Hán (CN / Kanji)
const ANY_CJK_REGEX = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const OTHER_NON_LATIN_REGEX = /[\u0E00-\u0E7F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F]/; // Thái, Nga, Ả Rập, Ấn

// Các từ khóa do YouTube tự động dịch tiêu đề khi truy cập từ IP Việt Nam
const YT_LOCALIZATION_NOISE_REGEX = /\b(mv\s*chính\s*thức|video\s*chính\s*thức|video\s*âm\s*nhạc\s*chính\s*thức|bản\s*chính\s*thức|lời\s*bài\s*hát|phụ\s*đề|vietsub|viet\s*sub|thuyết\s*minh|bản\s*dịch|\bcủa\b)\b/gi;

// Từ điển Nghệ sĩ Việt Nam chuẩn hóa không dấu (Bắt chuẩn cả "Hngle", "Ari", "Quang Hung MasterD", "Lil Z Poet", "52Hz", "buitruonglinh"...)
const VN_ARTISTS_NORM_REGEX = /\b(hngle|ari|quang\s*hung\s*masterd|quang\s*hung|masterd|lil\s*z\s*poet|lil\s*z|son\s*tung|m\s*tp|mtp|hieuthuhai|hurrykng|manbo|negav|gerdnang|rpt\s*mck|mck|ngher|lope\s*pham|tlinh|wren\s*evans|mono|grey\s*d|den\s*vau|vu\s*cat\s*tuong|madihu|bich\s*phuong|hoa\s*minzy|erik|duc\s*phuc|quan\s*a\s*p|quan\s*ap|noo\s*phuoc\s*thinh|dong\s*nhi|ong\s*cao\s*thang|toc\s*tien|binz|soobin|soobin\s*hoang\s*son|rhymastic|justatee|karik|suboi|b\s*ray|bray|amee|hoang\s*dung|chillies|ca\s*hoi\s*hoang|ngot\s*band|da\s*lab|dalab|phan\s*manh\s*quynh|ha\s*anh\s*tuan|my\s*tam|ho\s*ngoc\s*ha|le\s*quyen|trung\s*quan|bui\s*anh\s*tuan|huong\s*tram|chi\s*pu|van\s*mai\s*huong|jsol|hoang\s*duyen|hua\s*kim\s*tuyen|kewtiie|gill|wxrdie|low\s*g|obito|shiki|vstra|tang\s*duy\s*tan|dat\s*g|du\s*uyen|k\s*icm|kicm|trinh\s*dinh\s*quang|mr\s*siro|only\s*c|onlyc|lou\s*hoang|miu\s*le|suni\s*ha\s*linh|lyly|anh\s*tu|dinh\s*dung|acv\s*music|phao|double2t|24k\s*right|rhyder|captain\s*boy|duong\s*domic|phap\s*kieu|jun\s*pham|isaac|st\s*son\s*thach|bui\s*cong\s*nam|kay\s*tran|datkaa|changg|thinh\s*suy|winno|ronboogz|wean|touliver|slimv|masew|hoaprox|2pillz|wokeup|machiot|marzuz|vu\s*phung\s*tien|phuong\s*ly|phuong\s*my\s*chi|dtap|hoang\s*thuy\s*linh|truc\s*nhan|tien\s*tien|tien\s*cookie|bui\s*truong\s*linh|buitruonglinh|dangrangto|52hz|rio|coldzy|16\s*typh|nguyen\s*tran\s*trung\s*quan|dick|umie|droppy|haisam|khanh\s*phuong|ung\s*hoang\s*phuc|lam\s*chan\s*huy|chau\s*khai\s*phong|chu\s*bin|ho\s*quang\s*hieu|bao\s*anh|bui\s*lan\s*huong|nguyen\s*ha|lan\s*nha|le\s*hieu|bang\s*kieu|tuan\s*hung|dan\s*truong|cam\s*ly|quang\s*le|nhu\s*quynh|ca\s*si\s*vu|hoang\s*thai\s*vu)\b/i;

// Từ điển Nghệ sĩ Quốc tế / K-Pop / J-Pop / C-Pop
const INTL_ARTISTS_REGEX = /\b(olivia\s*rodrigo|beyonce|beyoncé|bruno\s*mars|taylor\s*swift|the\s*weeknd|alan\s*walker|ed\s*sheeran|ariana\s*grande|billie\s*eilish|justin\s*bieber|post\s*malone|dua\s*lipa|charlie\s*puth|shawn\s*mendes|sabrina\s*carpenter|lana\s*del\s*rey|adele|rihanna|katy\s*perry|lady\s*gaga|maroon\s*5|imagine\s*dragons|coldplay|onerepublic|chainsmokers|linkin\s*park|eminem|drake|kendrick\s*lamar|travis\s*scott|sza|doja\s*cat|billy\s*joel|one\s*direction|k\/da|kda|riot\s*games|league\s*of\s*legends|valorant|arcane|pentakill|true\s*damage|heartsteel|miyeon|soyeon|sophie\s*powers|mimi\s*webb|madison\s*beer|vevo)\b/i;
const KPOP_ARTISTS_REGEX = /\b(rosé|rose|illit|aespa|g\s*i\s*dle|gidle|\(?g\)?-?i-dle|blackpink|bts|newjeans|ive|le\s*sserafim|twice|itzy|nmixx|babymonster|kiss\s*of\s*life|stray\s*kids|seventeen|txt|enhypen|exo|bigbang|g\s*dragon|taeyang|iu|taeyeon|jungkook|jimin|lisa|jennie|jisoo|psy|yg\s*entertainment|hybe|smtown|jyp)\b/i;
const JPOP_ARTISTS_REGEX = /\b(yoasobi|ayase|ado|kenshi\s*yonezu|fujii\s*kaze|radwimps|aimer|official\s*hige\s*dandism|king\s*gnu|vaundy|imase|hikaru\s*utada|yorushika|zutomayo|creepy\s*nuts|mrs\s*green\s*apple)\b/i;
const CPOP_KEYWORDS_REGEX = /\b(jay\s*chou|jj\s*lin|g\.?e\.?m\.?|eric\s*chou|mayday|ren\s*ran|tinh\s*lung|ngai\s*than|tang\s*trieu|chau\s*tham|dong\s*lan|mong\s*nhien|dinh\s*dai\s*huong|douyin|tiktok\s*china|pinyin|mandopop|cpop|c-pop)\b/i;

// Âm tiết & Cấu trúc ngữ âm đặc trưng của Tiếng Việt khi viết KHÔNG DẤU ("Thuy Trieu", "Tinh Minh La Ki"...)
const VN_SYLLABLE_TOKEN_REGEX = /^(thuy|trieu|tinh|minh|la|ki|ky|anh|em|chung|ta|cua|tuong|lai|hien|tai|qua|khu|nguoi|yeu|thuong|nho|buon|vui|khoc|cuoi|trai|tim|giac|mo|mua|nang|gio|may|troi|bien|co|don|lang|quen|chia|tay|gap|nhau|nuoc|mat|doi|cho|vong|tay|ngot|ngao|am|ap|lanh|lung|duong|pho|chieu|thu|dong|xuan|ha|hoang|hon|binh|minh|bong|toi|ngan|van|kiep|duyen|phan|loi|hua|cau|the|chap|nhan|buong|bo|quay|ve|ra|di|o|lai|bao|gio|con|mai|chang|khong|chua|tung|da|dang|se|vua|moi|rat|lam|nhieu|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|ngon|lua|bo|vai|doi|moi|nu|cuoi|tieng|hat|nhip|dieu|phut|giay|dem|khuya|thien|duong|tran|gian|cuoc|doi|thanh|xuan|tuoi|tre|ngay|thang|dai|kho|ngoc|nghech|dam|me|mong|uoc|hy|vong|binh|yen|nhat|nhoa|phai|tan|vo|nat|nguyen|tran|le|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|quang|hung|duc|tuan|hieu|khanh|linh|trang|thao|huong|phuong|ngoc|vy|nhi)$/i;
const VN_PHONETIC_CLUSTER_REGEX = /^(?:ng|nh|kh|gh|ph|tr|ch|gi|qu|th)[aeiouy]{1,3}(?:ng|nh|ch|m|n|p|t|c)?$|^[bcdghklmnpqrstvx]{1,2}(?:uy|ieu|uoi|uoc|uong|oai|oan|oang|ang|anh|ach|inh|ich|ung|uc|oc|ong)$/i;
const COMMON_EN_TOKEN_REGEX = /^(the|and|you|that|was|for|are|with|his|they|this|have|from|one|had|word|but|not|what|all|were|when|your|can|said|there|use|each|which|she|how|their|will|other|about|out|many|then|them|these|some|her|would|make|like|him|into|time|has|look|two|more|go|see|no|way|could|my|than|first|water|been|call|who|now|find|long|down|day|did|get|come|made|may|part|give|got|still|love|baby|know|feel|wanna|gonna|dont|cant|firestarter|fire|night|heart|dream|world|life|light|dark|sky|star|stars|sun|moon|rain|wind|burn|stay|leave|gone|back|home|alone|lonely|broken|forever|never|always|again|tonight|today|kiss|touch|hold|cry|smile|dance|sing|song|music|beat|soul|mind|eyes|fly|fall|run|walk|wait|stop|start|end|begin|lose|win|live|heaven|hell|angel|devil|king|queen|boy|girl|man|woman|friend|friends|lover|shadow|ghost|magic|power|hero|official|video|audio|visualizer|lyrics|lyric|mv|remix|cover|version|ver|topic)$/i;

// Danh sách Nghệ sĩ V-Pop dùng để xoay vòng tìm bài tương tự khi Fallback
const VPOP_SIMILAR_ARTISTS_POOL = [
  'Quang Hùng MasterD', 'Sơn Tùng M-TP', 'HIEUTHUHAI', 'RPT MCK', 'tlinh',
  'Wren Evans', 'MONO', 'Grey D', 'Vũ.', 'Madihu', 'Đen Vâu', 'Soobin',
  'Binz', 'Hoàng Dũng', 'Chillies', 'Da LAB', 'Phan Mạnh Quỳnh', 'Tăng Duy Tân',
  'Rhyder', 'Dương Domic', 'Bích Phương', 'Hòa Minzy', 'AMEE', 'Erik',
  'Đức Phúc', 'Quân A.P', 'Noo Phước Thịnh', 'JustaTee', 'Rhymastic', 'B Ray',
  'Low G', 'Obito', 'WEAN', 'Phương Ly', 'Hoàng Thùy Linh', 'Trúc Nhân', 'Bùi Trường Linh'
];

/**
 * Biểu thức chính quy chặn tuyệt đối các video không phải âm nhạc (phân tích, cốt truyện, review, gameplay, podcast, v.v.)
 */
const NON_MUSIC_BLACKLIST_REGEX = /\b(phân\s*tích|cốt\s*truyện|giải\s*thích|tóm\s*tắt|review|đánh\s*giá|hướng\s*dẫn|cách\s*chơi|build\s*nhân\s*vật|tiêu\s*điểm\s*tướng|gameplay|walkthrough|playthrough|let'?s\s*play|highlight|highlights|full\s*match|bình\s*luận|reaction|phản\s*ứng|podcast|talkshow|phỏng\s*vấn|interview|tin\s*tức|điểm\s*tin|tâm\s*sự|vlog|thử\s*thách|challenge|prank|thuyết\s*minh|lồng\s*tiếng|tập\s*\d+|ep\.?\s*\d+|episode\s*\d+|movie\s*recap|tier\s*list|lore|theory|giả\s*thuyết|analysis|explained|video\s*essay|documentary|tài\s*liệu|speedrun|stream\s*vod|livestream\s*archive|trailer\s*breakdown|easter\s*eggs)\b/i;

const EXTRACTOR_INSTRUMENT_NORM_REGEX = /\b(piano|ver\s*piano|piano\s*ver|piano\s*version|guitar|ver\s*guitar|guitar\s*ver|guitar\s*solo|acoustic|ver\s*acoustic|orchestra|symphony|violin|cello|flute|sao\s*truc|saxophone|sax\s*ver|kalimba|ukulele|organ|harp|dan\s*tranh|dan\s*bau|instrumental|khong\s*loi|nhac\s*cu|beat\s*piano|solo\s*ver|bien\s*tau|cover|hat\s*lai|covered\s*by)\b/i;
const EXTRACTOR_INSTRUMENT_RAW_REGEX = /(?:ver\.?\s*piano|piano\s*ver\.?|ver\.?\s*guitar|guitar\s*ver\.?|ver\.?\s*acoustic|acoustic\s*ver\.?|biến\s*tấu|hát\s*lại|nhạc\s*không\s*lời|\bcover\b|\bacoustic\b|\bpiano\b|\bguitar\b|\borchestra\b|\bviolin\b|\binstrumental\b)/i;
const EXTRACTOR_OTHER_VARIANT_NORM_REGEX = /\b(remix|vinahouse|vinahey|lofi|lo\s*fi|sped\s*up|speed\s*up|slowed|reverb|nightcore|daycore|mashup|megamix|nonstop|bootleg|flip|live|live\s*stage|live\s*session|hat\s*live|fancam|dance\s*ver|dance\s*practice|performance\s*ver|parody|nhac\s*che|demo|8d|16d|bass\s*boosted)\b/i;
const EXTRACTOR_KARAOKE_NORM_REGEX = /\b(karaoke|beat\s*chuan|nhac\s*song|tong\s*nam|tong\s*nu|tone\s*nam|tone\s*nu|beat\s*goc|tach\s*nhac|backing\s*track)\b/i;

function normalizeSearchText(str) {
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

function parseDurationToSec(str) {
  if (typeof str === 'number' && !isNaN(str)) return Math.max(0, Math.floor(str));
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function stripYoutubeNoise(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/(?:\s*-\s*)?vevo$/i, '')
    .replace(/\bvevo\b/gi, ' ')
    .replace(YT_LOCALIZATION_NOISE_REGEX, ' ')
    .replace(/\b(official\s*music\s*video|official\s*video|official\s*mv|official\s*visualizer|official\s*audio|official\s*lyric\s*video|lyric\s*video|lyrics|visualizer|audio|mv|hd|4k)\b/gi, ' ')
    .replace(/['"‘’“”`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kiểm tra cấu trúc âm tiết Tiếng Việt không dấu (Ví dụ: "Thuy Trieu", "Tinh Minh La Ki")
 */
function hasVietnameseAccentlessPattern(str) {
  if (!str) return false;
  const norm = normalizeSearchText(str);
  const tokens = norm.split(/\s+/).filter(w => w.length >= 2 && !COMMON_EN_TOKEN_REGEX.test(w));
  if (tokens.length === 0) return false;

  let vnCount = 0;
  let enCount = 0;
  const allTokens = norm.split(/\s+/).filter(w => w.length >= 2);
  for (const t of allTokens) {
    if (COMMON_EN_TOKEN_REGEX.test(t)) {
      enCount++;
      continue;
    }
    if (VN_SYLLABLE_TOKEN_REGEX.test(t) || VN_PHONETIC_CLUSTER_REGEX.test(t)) {
      vnCount++;
    }
  }

  if (enCount > vnCount) return false;
  if (tokens.length <= 2) {
    return vnCount >= Math.max(1, tokens.length);
  }
  return vnCount >= 2 && (vnCount / tokens.length) >= 0.5;
}

// Nhận diện nghệ sĩ Vũ an toàn (loại trừ từ vựng "deja vu", "khiêu vũ")
function isVuArtist(rawTitle = '', cleanTitle = '', cleanArtist = '', normArtist = '') {
  const combined = `${rawTitle} ${cleanTitle}`.toLowerCase();
  if (/\bdeja\s+vu\b/i.test(combined)) return false;
  if (normArtist === 'vu' || normArtist === 'vu.' || normArtist === 'ca si vu' || normArtist === 'hoang thai vu') {
    return true;
  }
  if (/\b(?:ca\s*sĩ\s*vũ|ca\s*si\s*vu|hoàng\s*thái\s*vũ|vũ\s*\.)\b/i.test(rawTitle) || /\b(?:ca\s*si\s*vu|hoang\s*thai\s*vu|vu\s*\.)\b/i.test(cleanTitle)) {
    return true;
  }
  if (/(?<!deja\s+|khiêu\s+|dieu\s+)\bvũ\b/i.test(rawTitle)) {
    return true;
  }
  return false;
}

/**
 * 1. Nhận diện chính xác Vùng Ngôn Ngữ của bài hát ('VI' | 'KR' | 'JP' | 'CN' | 'INTL')
 *    Bắt chuẩn 100% bài Việt viết không dấu ("Quang Hung MasterD - Thuy Trieu")
 *    và bài Quốc tế bị YouTube dịch tiêu đề ("K/DA - FIRESTARTER | MV Chính Thức")
 */
function detectTrackRegion(title = '', artist = '') {
  const rawTitle = String(title || '');
  const rawArtist = String(artist || '');
  const rawCombined = `${rawTitle} ${rawArtist}`.trim();
  if (!rawCombined) return 'INTL';

  const cleanTitle = stripYoutubeNoise(rawTitle);
  const cleanArtist = stripYoutubeNoise(rawArtist);
  const cleanCombined = `${cleanTitle} ${cleanArtist}`.trim();
  const normCombined = normalizeSearchText(cleanCombined);
  const normArtist = normalizeSearchText(cleanArtist);

  // Bước 1: Kiểm tra chữ Hàn (Hangul) / Nhật (Kana) / Trung (Hanzi) TRƯỚC TIÊN
  if (HANGUL_REGEX.test(rawCombined)) return 'KR';
  if (KANA_REGEX.test(rawCombined)) return 'JP';
  if (HANZI_REGEX.test(rawCombined)) {
    // Nếu có chữ Hán nhưng thuộc nghệ sĩ K-Pop (fansub 中字) hoặc J-Pop
    if (KPOP_ARTISTS_REGEX.test(cleanCombined) || KPOP_ARTISTS_REGEX.test(normCombined)) return 'KR';
    if (JPOP_ARTISTS_REGEX.test(normCombined) || JPOP_ARTISTS_REGEX.test(cleanCombined)) return 'JP';
    return 'CN';
  }

  // Bước 1.5: Nhận diện K-Pop / J-Pop / C-Pop / Âu Mỹ qua tên nghệ sĩ
  const isVnArtist = VN_ARTISTS_NORM_REGEX.test(normArtist) || isVuArtist(rawTitle, cleanTitle, cleanArtist, normArtist);
  const hasIntlArtist = INTL_ARTISTS_REGEX.test(cleanCombined) || INTL_ARTISTS_REGEX.test(rawCombined) || INTL_ARTISTS_REGEX.test(normArtist) || INTL_ARTISTS_REGEX.test(normCombined);

  if (KPOP_ARTISTS_REGEX.test(cleanCombined) || KPOP_ARTISTS_REGEX.test(normArtist)) return 'KR';
  if (JPOP_ARTISTS_REGEX.test(cleanCombined) || JPOP_ARTISTS_REGEX.test(normArtist)) return 'JP';
  if (CPOP_KEYWORDS_REGEX.test(cleanCombined) || CPOP_KEYWORDS_REGEX.test(normArtist)) return 'CN';

  // Khóa cứng INTL nếu là nghệ sĩ quốc tế (trừ khi có ca sĩ Việt hợp tác) - Ngăn bẫy "deja vu"
  if (hasIntlArtist && !isVnArtist) return 'INTL';

  // Bước 2: Kiểm tra từ điển Nghệ sĩ Việt Nam không dấu (Ưu tiên cao nhất cho V-Pop như "Quang Hung MasterD")
  if (isVnArtist || VN_ARTISTS_NORM_REGEX.test(normCombined)) {
    return 'VI';
  }

  // Bước 4: Kiểm tra dấu Tiếng Việt thực sự (sau khi đã loại bỏ nhiễu địa phương hóa YouTube)
  if (VI_DIACRITIC_REGEX.test(cleanCombined)) {
    return 'VI';
  }

  // Bước 5: Phân tích hình vị / âm tiết Tiếng Việt không dấu (Bắt chuẩn "'Thuy Trieu'", "Tinh Minh La Ki"...)
  const coreTitle = cleanTitle.replace(/\[.*?\]|\(.*?\)/g, ' ').trim();
  if (hasVietnameseAccentlessPattern(coreTitle) || hasVietnameseAccentlessPattern(cleanArtist)) {
    return 'VI';
  }

  return 'INTL';
}

/**
 * 2. Tách chuẩn xác { cleanArtist, cleanTrackTitle } từ tiêu đề YouTube
 */
function extractCleanArtistAndTitle(rawTitle = '', rawArtist = '') {
  const safeTitle = String(rawTitle || '')
    .replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ')
    .replace(/['"‘’“”`]/g, '')
    .trim();

  const segments = safeTitle
    .split(/\s*(?:[-–—|])\s*/)
    .map(s => stripYoutubeNoise(s).trim())
    .filter(s => s.length > 0 && !/^(official|visualizer|audio|video|mv|lyrics?|lyric\s*video|hd|4k|prod\.?.*|ver\.?.*)$/i.test(s));

  let cleanArtist = stripYoutubeNoise(rawArtist)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*Official(?:\s*Channel)?$/i, '')
    .trim();

  if (['youtube', 'youtube music', 'unknown', 'various artists'].includes(cleanArtist.toLowerCase())) {
    cleanArtist = '';
  }

  let cleanTrackTitle = safeTitle;
  if (segments.length >= 2) {
    const s0 = segments[0];
    const s1 = segments[1];
    if (VN_ARTISTS_NORM_REGEX.test(normalizeSearchText(s1)) && !VN_ARTISTS_NORM_REGEX.test(normalizeSearchText(s0))) {
      cleanArtist = cleanArtist || s1;
      cleanTrackTitle = s0;
    } else {
      cleanArtist = cleanArtist || s0;
      cleanTrackTitle = s1;
    }
  } else if (segments.length === 1) {
    cleanTrackTitle = segments[0];
  }

  return {
    cleanArtist: cleanArtist.trim(),
    cleanTrackTitle: stripYoutubeNoise(cleanTrackTitle).trim()
  };
}

/**
 * 3. Phân tích chi tiết nguồn gốc và metadata bài hát: Bóc tách ca sĩ/tên bài thật, lọc kênh reup/lyric
 */
function analyzeTrackOriginAndMeta(song) {
  if (!song) return { realTitle: '', realArtist: '', region: 'INTL', isRemix: false, isAcoustic: false };

  const rawTitle = typeof song === 'object' ? (song.title || song.searchQuery || '') : String(song || '');
  const rawArtist = typeof song === 'object' ? (song.artist || song.uploader || '') : '';

  const isRemix = /\b(remix|vinahouse|vinahey|dance|edm|quẩy|nonstop|dj\b|mashup)\b/i.test(rawTitle);
  const isAcoustic = /\b(acoustic|chill|lofi|ballad|buồn|guitar|piano)\b/i.test(rawTitle);
  const isCover = /\b(cover|hát lại|hat lai|covered\s*by)\b/i.test(rawTitle);

  // 0. Kiểm tra RAM Cache của Apple Music (0ms CPU, không tốn network)
  const cacheKey = `${rawTitle.trim().toLowerCase()}|||${String(rawArtist || '').trim().toLowerCase()}`;
  const cachedApple = appleMetaCache?.get(cacheKey)?.data;
  if (cachedApple) {
    return {
      realTitle: cachedApple.canonicalTitle || rawTitle,
      realArtist: cachedApple.canonicalArtist || rawArtist || 'YouTube',
      cleanTrackTitle: cachedApple.canonicalTitle || rawTitle,
      cleanArtist: cachedApple.canonicalArtist || rawArtist,
      region: cachedApple.region || 'VI',
      appleArtistId: cachedApple.appleArtistId || null,
      primaryGenre: cachedApple.primaryGenre || null,
      appleMeta: cachedApple,
      isRemix,
      isAcoustic,
      isCover,
      rawTitle,
      rawArtist
    };
  }

  const isReupChannel = /(7clouds|syrebralvibes|taj tracks|unique vibes|lofi girl|cassiopeia|tiktok music|vibes only|superblyrics|chill tracks|sensual musique|dynmk|chillwithtaiki)/i.test(rawArtist);
  const isLyricTitle = /\((?:lyrics?|lyric video|vietsub)\)|\[(?:lyrics?|lyric video|vietsub)\]/i.test(rawTitle);

  let realArtist = '';
  let realTitle = '';

  if ((isReupChannel || isLyricTitle) && rawTitle.includes('-')) {
    const parts = rawTitle.split('-');
    realArtist = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    realTitle = parts.slice(1).join('-')
      .replace(/\[.*?\]|\(.*?\)/g, '')
      .replace(/official|audio|video|lyrics?|vietsub/gi, '')
      .trim();
  } else {
    const extracted = extractCleanArtistAndTitle(rawTitle, rawArtist);
    realArtist = extracted.cleanArtist || rawArtist;
    realTitle = extracted.cleanTrackTitle || rawTitle;
  }

  const region = detectTrackRegion(realTitle, realArtist);

  return {
    realTitle: realTitle || rawTitle,
    realArtist: realArtist || rawArtist || 'YouTube',
    cleanTrackTitle: realTitle,
    cleanArtist: realArtist,
    region,
    isRemix,
    isAcoustic,
    isCover,
    rawTitle,
    rawArtist
  };
}

/**
 * Phân tích metadata bài hát nâng cao bất đồng bộ: Tra cứu Apple Music để lấy Canonical Data
 */
async function resolveTrackOriginAndMetaAsync(song) {
  const syncMeta = analyzeTrackOriginAndMeta(song);
  if (syncMeta.appleMeta) return syncMeta;

  try {
    const appleMeta = await resolveAppleMusicMetadata(syncMeta.rawTitle, syncMeta.rawArtist);
    if (appleMeta) {
      return {
        ...syncMeta,
        realTitle: appleMeta.canonicalTitle || syncMeta.realTitle,
        realArtist: appleMeta.canonicalArtist || syncMeta.realArtist,
        cleanTrackTitle: appleMeta.canonicalTitle || syncMeta.cleanTrackTitle,
        cleanArtist: appleMeta.canonicalArtist || syncMeta.cleanArtist,
        region: appleMeta.region || syncMeta.region,
        appleArtistId: appleMeta.appleArtistId || null,
        primaryGenre: appleMeta.primaryGenre || null,
        appleMeta
      };
    }
  } catch (err) {}
  return syncMeta;
}

/**
 * 4. Kiểm tra nghiêm ngặt ứng viên Autoplay có khớp với vùng ngôn ngữ của bài gốc không
 *    Chặn 100% bài Trung Quốc ("潮汐") lọt vào phiên nghe nhạc Việt ('VI') hoặc Âu Mỹ ('INTL')!
 */
function isCandidateMatchingRegion(candidate, targetRegion = 'VI', seedMeta = null) {
  if (!candidate || !candidate.title) return false;
  const candTitle = String(candidate.title || '');
  const candArtist = String(candidate.artist || candidate.author?.name || candidate.uploader || candidate.channel || '');
  const candCombined = `${candTitle} ${candArtist}`;
  const normCandTitle = normalizeSearchText(candTitle);
  const normCandArtist = normalizeSearchText(candArtist);

  // 0. CHẶN TUYỆT ĐỐI VIDEO PHÂN TÍCH GAME / REVIEW / PODCAST / NGÔN NGỮ LẠ:
  if (NON_MUSIC_BLACKLIST_REGEX.test(candTitle) || NON_MUSIC_BLACKLIST_REGEX.test(candCombined)) {
    return false;
  }
  if (OTHER_NON_LATIN_REGEX.test(candCombined)) {
    return false;
  }

  // 1. Chặn biến thể Nhạc cụ (Piano, Guitar, Acoustic, Cover, Karaoke) nếu bài gốc KHÔNG phải bản nhạc cụ
  const seedRaw = seedMeta ? `${seedMeta.rawTitle || seedMeta.title || ''} ${seedMeta.rawArtist || seedMeta.artist || ''}` : '';
  const normSeed = normalizeSearchText(seedRaw);
  const isSeedInstrumentOrCover = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(normSeed) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(seedRaw);
  const isCandInstrumentOrCover = EXTRACTOR_INSTRUMENT_NORM_REGEX.test(normCandTitle) || EXTRACTOR_INSTRUMENT_RAW_REGEX.test(candTitle);
  if (isCandInstrumentOrCover && !isSeedInstrumentOrCover) {
    return false;
  }
  if (EXTRACTOR_KARAOKE_NORM_REGEX.test(normCandTitle)) {
    return false;
  }

  // 2. Chặn phát lặp lại cùng 1 bài hát dưới tên khác hoặc bản dịch tên bài
  if (seedMeta && seedMeta.cleanTrackTitle) {
    const normSeedTrack = normalizeSearchText(seedMeta.cleanTrackTitle);
    const normCandCore = normalizeSearchText(stripYoutubeNoise(candTitle).replace(/\[.*?\]|\(.*?\)/g, ''));
    if (normSeedTrack.length >= 4 && normCandCore === normSeedTrack) {
      return false;
    }
  }

  // 3. Lọc thời lượng chuẩn bài hát (75s - 600s)
  const durationSec = candidate.seconds || (candidate.duration ? parseDurationToSec(candidate.duration) : 0);
  if (durationSec > 0 && (durationSec < 75 || durationSec > 600)) {
    return false;
  }

  const candRegion = detectTrackRegion(candTitle, candArtist);
  const hasAnyCJK = ANY_CJK_REGEX.test(candCombined);

  // 4. KHÓA CHẶT THEO TỪNG VÙNG (STRICT REGION LOCK)
  if (targetRegion === 'VI') {
    // Nếu đang nghe Nhạc Việt:
    // - CẤM TUYỆT ĐỐI mọi bài có chữ Hán (潮汐), chữ Hàn, chữ Nhật!
    if (hasAnyCJK) return false;
    // - CẤM TUYỆT ĐỐI nghệ sĩ Quốc tế / K-Pop / J-Pop / C-Pop
    if (INTL_ARTISTS_REGEX.test(candCombined) || KPOP_ARTISTS_REGEX.test(candCombined) || JPOP_ARTISTS_REGEX.test(candCombined) || CPOP_KEYWORDS_REGEX.test(candCombined)) {
      return false;
    }
    // - Bắt buộc ứng viên phải là nhạc Việt
    return candRegion === 'VI';
  }

  if (targetRegion === 'INTL') {
    // Nếu đang nghe Nhạc Quốc Tế Âu Mỹ (Tiếng Anh):
    // - CẤM TUYỆT ĐỐI chữ Hán (潮汐), chữ Hàn, chữ Nhật!
    if (hasAnyCJK) return false;
    // - CẤM TUYỆT ĐỐI nhảy sang Nhạc Việt hoặc C-Pop / K-Pop / J-Pop!
    if (candRegion !== 'INTL') return false;
    if (VI_DIACRITIC_REGEX.test(stripYoutubeNoise(candCombined)) || VN_ARTISTS_NORM_REGEX.test(`${normCandTitle} ${normCandArtist}`)) {
      return false;
    }
    return true;
  }

  if (targetRegion === 'KR') {
    if (candRegion === 'VI' || candRegion === 'CN') return false;
    return candRegion === 'KR' || HANGUL_REGEX.test(candCombined) || KPOP_ARTISTS_REGEX.test(candCombined);
  }

  if (targetRegion === 'JP') {
    if (candRegion === 'VI' || candRegion === 'CN') return false;
    return candRegion === 'JP' || KANA_REGEX.test(candCombined) || JPOP_ARTISTS_REGEX.test(candCombined);
  }

  if (targetRegion === 'CN') {
    if (candRegion === 'VI') return false;
    return candRegion === 'CN' || HANZI_REGEX.test(candCombined) || CPOP_KEYWORDS_REGEX.test(candCombined);
  }

  return candRegion === targetRegion;
}

/**
 * 5. Xây dựng danh sách từ khóa Fallback thông minh cho Autoplay
 *    Tận dụng Apple Artist Top Tracks (nếu có) và TUYỆT ĐỐI KHÔNG tìm lại chính tên bài hát vừa phát!
 */
async function buildAutoplayFallbackQueries(lastSong, targetRegion = 'VI', seedMeta = null) {
  const meta = seedMeta || (await resolveTrackOriginAndMetaAsync(lastSong));
  const cleanArtist = meta.cleanArtist || '';
  const isRemix = meta.isRemix || false;
  const queries = [];

  // Ưu tiên 1: Nếu có appleArtistId từ Apple Music, lấy các bài hát chính thức khác của ca sĩ đó
  if (meta.appleArtistId) {
    try {
      const topTracks = await getAppleArtistTopTracks(meta.appleArtistId, 10);
      if (Array.isArray(topTracks) && topTracks.length > 0) {
        const normCurrentTitle = normalizeSearchText(meta.realTitle);
        for (const track of topTracks) {
          if (normalizeSearchText(track.title) !== normCurrentTitle) {
            queries.push(isRemix ? `${track.title} ${track.artist} remix` : `${track.title} ${track.artist} official audio`);
            if (queries.length >= 2) break;
          }
        }
      }
    } catch (e) {}
  }

  if (targetRegion === 'VI') {
    if (cleanArtist && cleanArtist.length >= 2) {
      queries.push(isRemix ? `${cleanArtist} remix vinahouse` : `${cleanArtist} official mv`);
      queries.push(`${cleanArtist} official audio`);
    }
    const normCurrentArtist = normalizeSearchText(cleanArtist);
    const pool = VPOP_SIMILAR_ARTISTS_POOL.filter(a => normalizeSearchText(a) !== normCurrentArtist);
    const pick1 = pool[Math.floor(Math.random() * pool.length)] || 'Sơn Tùng M-TP';
    const pick2 = pool[Math.floor(Math.random() * pool.length)] || 'HIEUTHUHAI';
    queries.push(isRemix ? `${pick1} remix` : `${pick1} official audio`);
    queries.push(isRemix ? `${pick2} remix` : `${pick2} official mv`);
  } else if (targetRegion === 'KR') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('kpop hit official mv');
  } else if (targetRegion === 'JP') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('jpop hit official audio');
  } else if (targetRegion === 'CN') {
    if (cleanArtist) queries.push(`${cleanArtist} official mv`);
    queries.push('cpop hit official audio');
  } else {
    // INTL (Âu Mỹ)
    if (cleanArtist && cleanArtist.length >= 2) {
      queries.push(`${cleanArtist} official audio`);
      queries.push(`${cleanArtist} official music video`);
    }
    queries.push('pop hits official audio');
  }

  return [...new Set(queries)].slice(0, 4);
}

module.exports = {
  VI_DIACRITIC_REGEX,
  HANGUL_REGEX,
  KANA_REGEX,
  HANZI_REGEX,
  ANY_CJK_REGEX,
  OTHER_NON_LATIN_REGEX,
  YT_LOCALIZATION_NOISE_REGEX,
  VN_ARTISTS_NORM_REGEX,
  INTL_ARTISTS_REGEX,
  KPOP_ARTISTS_REGEX,
  JPOP_ARTISTS_REGEX,
  CPOP_KEYWORDS_REGEX,
  VN_SYLLABLE_TOKEN_REGEX,
  VN_PHONETIC_CLUSTER_REGEX,
  COMMON_EN_TOKEN_REGEX,
  VPOP_SIMILAR_ARTISTS_POOL,
  NON_MUSIC_BLACKLIST_REGEX,
  EXTRACTOR_INSTRUMENT_NORM_REGEX,
  EXTRACTOR_INSTRUMENT_RAW_REGEX,
  EXTRACTOR_OTHER_VARIANT_NORM_REGEX,
  EXTRACTOR_KARAOKE_NORM_REGEX,
  normalizeSearchText,
  parseDurationToSec,
  stripYoutubeNoise,
  hasVietnameseAccentlessPattern,
  isVuArtist,
  detectTrackRegion,
  extractCleanArtistAndTitle,
  analyzeTrackOriginAndMeta,
  resolveTrackOriginAndMetaAsync,
  isCandidateMatchingRegion,
  buildAutoplayFallbackQueries
};
