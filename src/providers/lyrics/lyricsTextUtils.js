/**
 * Anna Music Bot - Lyrics Text Utilities
 * Xử lý chuỗi, regex từ vựng, nhận diện ngôn ngữ bài hát, sinh biến thể tìm kiếm
 */

// Kiểm tra xem nội dung lời bài hát có bị nhiễm mã CSS (BetterLyrics theme rác từ LRCLIB) hoặc mã HTML hay không
function isGarbageLyrics(text) {
  if (!text || typeof text !== 'string') return false;
  // 1. Kiểm tra theme BetterLyrics / Spotlight hoặc selector CSS
  if (/\/\*[\s\S]*?(?:betterlyrics|spotlight|theme)[\s\S]*?\*\//i.test(text)) return true;
  if (/:root\s*\{|\.[a-zA-Z0-9_-]+\s*\{/i.test(text)) return true;
  // 2. Kiểm tra thuộc tính CSS hoặc biến CSS đặc trưng
  const cssMatches = text.match(/(?:--[a-zA-Z0-9_-]+|var\(--|display\s*:|opacity\s*:|filter\s*:|transform\s*:|position\s*:|background\s*:|margin\s*:|padding\s*:|border-radius\s*:)/gi);
  if (cssMatches && cssMatches.length >= 2) return true;
  // 3. Kiểm tra thẻ HTML phổ biến
  if (/<(?:div|style|script|span|p|html|body|table|head)\b[^>]*>/i.test(text)) return true;
  return false;
}

function normalizeStr(str) {
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

function detectVariantTrack(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return false;
  return /\b(remix|vinahouse|vinahey|sped\s*up|speed\s*up|slowed|reverb|nightcore|bootleg|mashup|nonstop|club\s*mix|dance\s*ver|nhạc\s*quẩy|dj)\b/i.test(rawTitle);
}

function extractOriginalSongTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let s = rawTitle;
  s = s.replace(/[\(\[][^\)\]]*\b(?:remix|vinahouse|vinahey|sped\s*up|speed\s*up|slowed|reverb|nightcore|bootleg|mashup|nonstop|club\s*mix|dance|cover|acoustic|piano|lofi|dj|prod|beat)\b[^\)\]]*[\)\]]/gi, ' ');

  const segments = s.split(/\s*[-–—|:/]\s*/);
  if (segments.length > 1) {
    const kept = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      const isVariantSeg = /\b(remix|vinahouse|vinahey|prod\.?|dj\b|mix|cover|sped\s*up|slowed|reverb|nightcore|official|mv|audio|visualizer)\b/i.test(seg);
      if (i === 0 || !isVariantSeg) {
        kept.push(seg);
      }
    }
    s = kept.join(' - ');
  }

  s = s.replace(/\b(?:remix|vinahouse|vinahey|sped\s*up|speed\s*up|slowed|reverb|nightcore|bootleg|nonstop|club\s*mix)\b.*$/gi, ' ');
  return cleanTitle(s);
}

function cleanTitle(str) {
  if (!str) return '';
  let s = str
    .replace(/\(\s*#[^)]*\)/g, ' ')
    .replace(/#[\w\d_]+/g, ' ')
    .replace(/\[.*?\]|【.*?】|『.*?』|《.*?》/g, ' ')
    .replace(/\*+[^*]*\*+/g, ' ')
    .replace(/[★☆✧✦~]/g, ' ')
    .trim();
  s = s.replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
  s = s.replace(/\((?:piano|acoustic|live|remix|official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat|feat\.?|ft\.?|version|ver|catena|vinahouse|sped\s*up|slowed|reverb|cover|full|bản\s*full).*?\)/gi, ' ');
  s = s.replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official)/gi, ' ');
  s = s.replace(/\b(?:bản\s+full|full\s+(?:audio|mv|hd|video|version|ver|track|song)|hd\s+full)\b/gi, ' ');
  s = s.replace(/\s+full\s*(?=[-–—|:/()]|$)/gi, ' ');
  s = s.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, ' ');
  s = s.replace(/4k|hd|1080p/gi, ' ');
  s = s.replace(/(?:^|\s)(?:feat\.?|ft\.?)\s+[^-–—|()\[\]]+/gi, ' ');
  s = s.replace(/\s*\([^)a-zA-Z0-9]*\)/g, ' ');
  s = s.replace(/\s*\[[^\]a-zA-Z0-9]*\]/g, ' ');
  s = s.replace(/^\s*\b(?:m\/v|mv)\b\s*/gi, ' ');
  s = s.replace(/\s*\b(?:m\/v|mv)\b\s*$/gi, ' ');
  s = s.replace(/\s*[-|:/\\–—]\s*$/g, '').trim();
  s = s.replace(/^\s*[-|:/\\–—]\s*/g, '').trim();
  s = s.replace(/^\s*\b(?:m\/v|mv)\b\s*/gi, ' ');
  s = s.replace(/\s*\b(?:m\/v|mv)\b\s*$/gi, ' ');
  s = s.replace(/[*~]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const TECHNICAL_PAREN_REGEX = /^(?:official(?:\s+(?:music\s+)?video|\s+mv|\s+audio|\s+lyric(?:s)?)?|mv|audio|video|lyrics?|remix|live(?:\s+session)?|prod\.?(?:\s+by\s+[\w\d_]+)?|(?:feat\.?|ft\.?)\b.*?|beat|karaoke|4k|hd|mp3|full(?:\s+audio|\s+mv)?|teaser|trailer|acoustic(?:\s+version)?|cover|.*?\b(?:ep|album|the album|mini album|single|ost|soundtrack|vol\.?\s*\d+|tập\s*\d+|version|ver|bản\s+thu|cd\s*\d+|tape|vinyl)\b.*?)$/i;

const VIETNAMESE_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;
const CHINESE_CHAR_REGEX = /[\u4E00-\u9FFF]/;
const VIRTUAL_GLOBAL_GROUPS_REGEX = /\b(k\/da|kda|riot\s*games|league\s*of\s*legends|true\s*damage|pentakill|heartsteel)\b/i;
const CJK_SCRIPT_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

// Danh sách nghệ sĩ / nhóm nhạc / hãng game quốc tế phổ biến
const KNOWN_INTL_ARTISTS_REGEX = /\b(k\/da|kda|riot\s*games|league\s*of\s*legends|valorant|arcane|pentakill|true\s*damage|heartsteel|miyeon|soyeon|g\s*i\s*dle|gidle|\(g\)i-dle|sophie\s*powers|mimi\s*webb|madison\s*beer|jaira\s*burns|seraphine|lexie\s*liu|taylor\s*swift|the\s*weeknd|alan\s*walker|ed\s*sheeran|bruno\s*mars|ariana\s*grande|billie\s*eilish|justin\s*bieber|post\s*malone|dua\s*lipa|charlie\s*puth|shawn\s*mendes|camila\s*cabello|olivia\s*rodrigo|sabrina\s*carpenter|lana\s*del\s*rey|adele|rihanna|katy\s*perry|lady\s*gaga|maroon\s*5|imagine\s*dragons|coldplay|onerepublic|chainsmokers|linkin\s*park|eminem|drake|kendrick\s*lamar|travis\s*scott|sza|doja\s*cat|nicki\s*minaj|cardi\s*b|blackpink|bts|newjeans|aespa|ive|le\s*sserafim|twice|itzy|nmixx|babymonster|illit|kiss\s*of\s*life|stray\s*kids|seventeen|txt|enhypen|exo|bigbang|g\s*dragon|taeyang|iu|taeyeon|jungkook|jimin|v\s*bts|lisa|jennie|rose|jisoo|psy|yoasobi|ado|kenshi\s*yonezu|fujii\s*kaze|radwimps|lisa\s*japan|aimer|eve\s*japan|official\s*hige\s*dandism|king\s*gnu|vaundy|imase|jay\s*chou|jj\s*lin|g\.?e\.?m\.?|eric\s*chou|mayday|vevo)\b/i;

// Danh sách nghệ sĩ V-Pop / V-Rap / V-Indie (Chuẩn hóa không dấu)
const KNOWN_VN_ARTISTS_NORM_REGEX = /\b(hngle|ari|w\s*n|wn|w\s*\/\s*n|duongg|nalu|titie|3107|quang\s*hung\s*masterd|quang\s*hung|masterd|lil\s*z\s*poet|lil\s*z|son\s*tung|m\s*tp|mtp|hieuthuhai|hurrykng|manbo|negav|gerdnang|rpt\s*mck|mck|ngher|lope\s*pham|tlinh|wren\s*evans|mono|grey\s*d|den\s*vau|vu\s*cat\s*tuong|madihu|bich\s*phuong|hoa\s*minzy|erik|duc\s*phuc|quan\s*a\s*p|quan\s*ap|noo\s*phuoc\s*thinh|dong\s*nhi|ong\s*cao\s*thang|toc\s*tien|binz|soobin|soobin\s*hoang\s*son|rhymastic|justatee|karik|suboi|b\s*ray|bray|amee|hoang\s*dung|chillies|ca\s*hoi\s*hoang|ngot\s*band|da\s*lab|dalab|phan\s*manh\s*quynh|ha\s*anh\s*tuan|my\s*tam|ho\s*ngoc\s*ha|le\s*quyen|trung\s*quan|bui\s*anh\s*tuan|huong\s*tram|chi\s*pu|van\s*mai\s*huong|jsol|hoang\s*duyen|hua\s*kim\s*tuyen|kewtiie|gill|wxrdie|low\s*g|obito|shiki|vstra|tang\s*duy\s*tan|dat\s*g|du\s*uyen|k\s*icm|kicm|trinh\s*dinh\s*quang|mr\s*siro|only\s*c|onlyc|lou\s*hoang|miu\s*le|suni\s*ha\s*linh|lyly|anh\s*tu|dinh\s*dung|acv\s*music|phao|double2t|24k\s*right|rhyder|captain\s*boy|duong\s*domic|phap\s*kieu|jun\s*pham|isaac|st\s*son\s*thach|bui\s*cong\s*nam|kay\s*tran|datkaa|changg|thinh\s*suy|winno|ronboogz|wean|touliver|slimv|masew|hoaprox|2pillz|wokeup|machiot|marzuz|vu\s*phung\s*tien|phuong\s*ly|phuong\s*my\s*chi|dtap|hoang\s*thuy\s*linh|truc\s*nhan|tien\s*tien|tien\s*cookie|bui\s*truong\s*linh|buitruonglinh|dangrangto|52hz|rio|coldzy|16\s*typh|nguyen\s*tran\s*trung\s*quan|dick|umie|droppy|haisam|khanh\s*phuong|ung\s*hoang\s*phuc|lam\s*chan\s*huy|lam\s*chan\s*khang|chau\s*khai\s*phong|chu\s*bin|ho\s*quang\s*hieu|bao\s*anh|bui\s*lan\s*huong|nguyen\s*ha|lan\s*nha|le\s*hieu|bang\s*kieu|tuan\s*hung|dan\s*truong|cam\s*ly|quang\s*le|nhu\s*quynh|ca\s*si\s*vu|hoang\s*thai\s*vu)\b/i;

// Từ vựng & Âm tiết đặc trưng của bài hát Tiếng Việt khi viết KHÔNG DẤU
const VN_ACCENTLESS_SYLLABLES_REGEX = /^(thuy|trieu|tinh|minh|la|ki|ky|anh|em|chung|ta|cua|tuong|lai|hien|tai|qua|khu|nguoi|yeu|thuong|nho|buon|vui|khoc|cuoi|trai|tim|giac|mo|mua|nang|gio|may|troi|bien|song|co|don|lang|quen|chia|tay|gap|nhau|nuoc|mat|doi|cho|vong|tay|ngot|ngao|am|ap|lanh|lung|duong|pho|chieu|thu|dong|xuan|ha|hoang|hon|binh|minh|bong|toi|ngan|van|kiep|duyen|phan|loi|hua|cau|the|chap|nhan|buong|bo|quay|ve|ra|di|o|lai|bao|gio|con|mai|chang|khong|chua|tung|da|dang|se|vua|moi|rat|lam|nhieu|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram|nghin|ngon|lua|bo|vai|doi|moi|nu|cuoi|tieng|hat|loi|ca|nhip|dieu|phut|giay|dem|khuya|som|thien|duong|tran|gian|cuoc|doi|thanh|xuan|tuoi|tre|ngay|thang|dai|kho|ngoc|nghech|dam|me|mong|uoc|hy|vong|binh|yen|nhat|nhoa|phai|tan|vo|nat|bien|mat|nguyen|tran|le|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|quang|hung|duc|tuan|hieu|khanh|linh|trang|thao|huong|phuong|ngoc|vy|nhi)$/i;
const VN_PHONETIC_CLUSTER_REGEX = /^(?:ng|nh|kh|gh|ph|tr|ch|gi|qu|th|dh)[aeiouy]{1,3}(?:ng|nh|ch|m|n|p|t|c)?$|^[bcdghklmnpqrstvx]{1,2}(?:uy|ieu|uoi|uoc|uong|oai|oan|oang|ang|anh|ach|inh|ich|ung|uc|oc|ong|ep|op|ap)$/i;
const COMMON_ENGLISH_WORDS_REGEX = /\b(the|and|you|that|was|for|are|with|his|they|this|have|from|one|had|word|but|not|what|all|were|when|your|can|said|there|use|each|which|she|how|their|will|other|about|out|many|then|them|these|some|her|would|make|like|him|into|time|has|look|two|more|write|go|see|number|no|way|could|people|my|than|first|water|been|call|who|oil|its|now|find|long|down|day|did|get|come|made|may|part|give|got|still|love|baby|know|feel|wanna|gonna|dont|cant|im|youre|ill|we|us|me|firestarter|fire|starter|night|heart|dream|dreams|world|life|light|dark|sky|stars|sun|moon|rain|wind|flame|stay|leave|gone|back|home|alone|lonely|broken|forever|never|always|again|tonight|today|kiss|touch|hold|cry|smile|dance|sing|song|music|beat|rhythm|soul|mind|eyes|lips|hands|arms|wings|fly|fall|falling|run|running|wait|stop|start|end|begin|lose|win|fight|die|live|living|dead|heaven|hell|angel|devil|boy|girl|man|woman|friends|lover|shadow|magic|power|villain|hero)\b/i;

const KNOWN_VN_KEYWORDS = [
  'masew', 'xesi', 'nhatnguyen', 'sơn tùng', 'son tung', 'm-tp', 'mtp', 'jack', 'j97', 'k-icm',
  'đen vâu', 'den vau', 'đen', 'vũ.', 'vu.', 'tlinh', 'mck', 'hieuthuhai', 'wren evans',
  'mono', 'grey d', 'low g', 'obito', 'wxrdie', '24k.right', 'phao', 'min', 'soobin',
  'tóc tiên', 'toc tien', 'chi pu', 'bảo anh', 'bao anh', 'hoàng thùy linh', 'hoang thuy linh',
  'bích phương', 'bich phuong', 'đức phúc', 'duc phuc', 'erik', 'hương tràm', 'huong tram',
  'hòa minzy', 'hoa minzy', 'noo phước thịnh', 'noo phuoc thinh', 'b ray', 'bray', 'amee',
  'dalab', 'chillies', 'ngọt', 'thịnh suy', 'vũ cát tường', 'vu cat tuong', 'phan mạnh quỳnh',
  'phan manh quynh', 'justatee', 'rhymastic', 'karik', 'wowy', 'suboi', 'trúc nhân', 'truc nhan',
  'văn mai hương', 'van mai huong', 'mee media', 'acv music', '1989s', 'phương ly', 'phuong ly',
  'trịnh thăng bình', 'trinh thang binh', 'khắc việt', 'khac viet', 'khởi my', 'khoi my',
  'quang hùng masterd', 'quang hung masterd', 'lil z poet', 'hurrykng', 'negav', 'gerdnang',
  'rhyder', 'dương domic', 'duong domic', 'pháp kiều', 'phap kieu', 'wean', 'vpop', 'v-pop', 'nhac viet', 'nhạc việt'
];

function isLyricLanguageConsistent(rawTitle, artist, lyricText) {
  if (!lyricText || typeof lyricText !== 'string' || lyricText.length < 20) return true;
  const isVN = isVietnameseTrack({ rawTitle, artist });
  if (isVN) {
    const hasVnAccents = VIETNAMESE_REGEX.test(lyricText);
    if (!hasVnAccents) {
      const englishStopWords = /\b(the|and|you|that|with|have|this|from|they|will|would|there|their|what|about|which|when|make|like|time|just|know|take|people|into|year|your|good|some|could|them|other|than|then|now|look|only|come|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/gi;
      const engMatches = lyricText.match(englishStopWords);
      if (engMatches && engMatches.length >= 8) {
        return false;
      }
    }
  } else {
    // Nếu là bài hát quốc tế (tiếng Anh, Hàn, Nhật...) mà lời nhạc lại chứa nhiều dấu tiếng Việt -> Chắc chắn là bản dịch
    const vnMatches = lyricText.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi);
    if (vnMatches && vnMatches.length >= 6) {
      return false;
    }
  }
  return true;
}

function extractParentheticalTitles(str) {
  if (!str) return [];
  const results = [];
  const matches = [...str.matchAll(/[\(\[]([^\(\)\[\]]+)[\)\]]/g)];
  for (const m of matches) {
    const inside = m[1].trim();
    if (inside && inside.length >= 2 && !TECHNICAL_PAREN_REGEX.test(inside)) {
      results.push(inside);
    }
  }
  return results;
}

function stripParentheses(str) {
  if (!str) return '';
  return str.replace(/[\(\[][^\(\)\[\]]*[\)\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

const VN_NUMBER_WORDS = {
  '0': 'không', '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn',
  '5': 'năm', '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín',
  '10': 'mười'
};

function generateVietnameseNumberVariants(text) {
  if (!text || typeof text !== 'string') return [text];
  const variants = [text];

  if (/\b(?:3107|52\s*hz|16\s*typh|24k|4k|1080p)\b/i.test(text) || /\b\d{3,}\s*\d*\b/.test(text)) {
    return [text];
  }

  const boundaryLeft = '(^|[\\s\\-–—()\\[\\].,!?:;/])';
  const boundaryRight = '(?=$|[\\s\\-–—()\\[\\].,!?:;/])';

  let withWords = text;
  let wordReplaced = false;
  for (const [num, word] of Object.entries(VN_NUMBER_WORDS)) {
    const reg = new RegExp(`${boundaryLeft}${num}${boundaryRight}`, 'gi');
    if (reg.test(withWords)) {
      withWords = withWords.replace(reg, `$1${word}`);
      wordReplaced = true;
    }
  }
  if (wordReplaced && withWords !== text) {
    variants.push(withWords);
  }

  let withNums = text;
  let numReplaced = false;
  for (const [num, word] of Object.entries(VN_NUMBER_WORDS)) {
    const reg = new RegExp(`${boundaryLeft}${word}${boundaryRight}`, 'gi');
    if (reg.test(withNums)) {
      withNums = withNums.replace(reg, `$1${num}`);
      numReplaced = true;
    }
  }
  if (numReplaced && withNums !== text) {
    variants.push(withNums);
  }

  return [...new Set(variants)];
}

function cleanArtistName(str) {
  if (!str) return '';
  const cleaned = cleanTitle(str).replace(/(?:official\s*(?:channel)?|channel|topic|vevo|records|entertainment|youtube\s*music|youtube)/gi, '').trim();
  const low = cleaned.toLowerCase();
  if (['unknown', 'youtube', 'youtube music', 'various artists', 'various', 'chưa rõ', 'nghệ sĩ khác'].includes(low)) {
    return '';
  }
  return cleaned;
}

function extractArtists(artistStr) {
  if (!artistStr) return [];
  const clean = artistStr.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, '').trim();
  const rawParts = clean.split(/(?:\s+(?:ft\.?|feat\.?|x|cùng|với)\s+|[&+,/])/i).map(s => s.trim()).filter(Boolean);
  const expanded = [];
  for (const p of rawParts) {
    const parenMatch = p.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch) {
      const outside = parenMatch[1].trim();
      const inside = parenMatch[2].trim();
      if (outside) expanded.push(outside);
      if (inside && !/^(official|mv|audio|video|lyric|lyrics|remix|live|prod|feat|ft)/i.test(inside)) {
        expanded.push(inside);
      }
    } else {
      const stripped = stripParentheses(p);
      if (stripped) expanded.push(stripped);
    }
  }
  return expanded.length > 0 ? [...new Set(expanded)] : [clean];
}

function extractFeatFromRaw(title) {
  if (!title) return [];
  const match = title.match(/[\(\[](?:feat\.?|ft\.?)\s*([^()\[\]]+)[\)\]]/i);
  if (match) {
    return extractArtists(match[1]);
  }
  return [];
}

function splitFeat(str) {
  if (!str) return null;
  const m = str.match(/^(.+?)\s+(?:ft\.?|feat\.?|cùng|với)\s+(.+)$/i);
  if (m) {
    return { titlePart: m[1].trim(), artistPart: m[2].trim() };
  }
  return null;
}

function stripFeatFromTrack(str) {
  if (!str) return '';
  return str.replace(/\s*[\(\[](?:feat\.?|ft\.?|cùng|với)\s*[^()\[\]]+[\)\]]/gi, ' ')
            .replace(/\s+(?:feat\.?|ft\.?|cùng|với)\s+.+$/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
}

function generateSearchVariants(rawTitle, rawArtist = '', appleMeta = null) {
  if (!rawTitle) return [];

  const queries = [];

  // 0. Ưu tiên số 1: Tên bài và ca sĩ chuẩn có dấu từ Apple Music Metadata
  if (appleMeta && appleMeta.canonicalTitle) {
    const cTrack = appleMeta.canonicalTitle.trim();
    const cArtist = (appleMeta.canonicalArtist || '').trim();
    if (cTrack) {
      if (cArtist) {
        queries.push({ track: cTrack, artist: cArtist, expectedTrack: cTrack, expectedArtist: cArtist });
        queries.push({ q: `${cTrack} ${cArtist}`, expectedTrack: cTrack, expectedArtist: cArtist });
      } else {
        queries.push({ track: cTrack, q: cTrack, expectedTrack: cTrack });
      }
    }
  }

  const primaryClean = cleanTitle(rawTitle);
  const deepClean = stripParentheses(primaryClean);
  let cleanArt = cleanArtistName(rawArtist);
  const rawFeatArtists = extractFeatFromRaw(rawTitle);

  if (!cleanArt && rawFeatArtists.length > 0 && !/[-–—|]/.test(rawTitle)) {
    cleanArt = rawFeatArtists[0];
  }

  const normCleanArt = cleanArt ? normalizeStr(cleanArt) : '';

  const titlesToProcess = [primaryClean];
  if (deepClean && deepClean !== primaryClean) {
    titlesToProcess.unshift(deepClean);
  }

  // Nhận diện tiêu đề chứa cặp nháy đơn hoặc nháy kép (K-Pop / J-Pop / Quốc tế, ví dụ: IVE 아이브 'BANG BANG' MV)
  const quotedMatch = rawTitle.match(/(?:["“]([^"“”]+)["”]|(?:^|[\s(\[])['‘](.+?)['’](?=[\s)\]\-–—]|$))/);
  const topVariants = [];
  if (quotedMatch) {
    const rawQuoted = (quotedMatch[1] || quotedMatch[2] || '').trim();
    const quotedTrack = cleanTitle(rawQuoted);
    const quoteIndex = rawTitle.indexOf(rawQuoted);
    const textBefore = (quoteIndex > 0 ? rawTitle.slice(0, quoteIndex) : '').replace(/['"‘“]/g, '').trim();
    const latinBefore = textBefore
      .replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3040-\u30FF\u4E00-\u9FFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let latinArtist = cleanArtistName(cleanTitle(stripParentheses(latinBefore)));

    if (!latinArtist && cleanArt) {
      const artLatinOnly = cleanArt
        .replace(/[\uAC00-\uD7AF\u1100-\u11FF\u3040-\u30FF\u4E00-\u9FFF]/g, ' ')
        .trim();
      latinArtist = cleanArtistName(cleanTitle(stripParentheses(artLatinOnly || cleanArt)));
    }

    if (quotedTrack) {
      if (latinArtist) {
        topVariants.push({ track: quotedTrack, artist: latinArtist, expectedTrack: quotedTrack, expectedArtist: latinArtist });
        topVariants.push({ q: `${quotedTrack} ${latinArtist}`, expectedTrack: quotedTrack, expectedArtist: latinArtist });
        topVariants.push({ q: `${latinArtist} ${quotedTrack}`, expectedTrack: quotedTrack, expectedArtist: latinArtist });
      }
      topVariants.push({ track: quotedTrack, q: quotedTrack, expectedTrack: quotedTrack, expectedArtist: latinArtist || undefined });

      if (!titlesToProcess.includes(quotedTrack)) {
        titlesToProcess.unshift(quotedTrack);
      }
    }
  }

  queries.push(...topVariants);

  // Trích xuất các tên bài hát trong ngoặc không phải metadata kỹ thuật (ví dụ: (THẰNG ĐIÊN))
  const parenTitles = extractParentheticalTitles(rawTitle);
  for (const pt of parenTitles) {
    const cleanPt = cleanTitle(pt);
    if (cleanPt && !/(?:\b(?:ep|album|single|ost|soundtrack)\b)/i.test(cleanPt) && !titlesToProcess.includes(cleanPt)) {
      titlesToProcess.push(cleanPt);
    }
  }

  if (detectVariantTrack(rawTitle)) {
    const origTitle = extractOriginalSongTitle(rawTitle);
    if (origTitle && !titlesToProcess.includes(origTitle)) {
      titlesToProcess.unshift(origTitle);
    }
    const origDeep = stripParentheses(origTitle);
    if (origDeep && !titlesToProcess.includes(origDeep)) {
      titlesToProcess.unshift(origDeep);
    }
  }

  // Mở rộng các biến thể số học tiếng Việt (ví dụ: "Nguyễn Văn 10" <-> "Nguyễn Văn Mười")
  const numVariants = [];
  for (const t of titlesToProcess) {
    const nv = generateVietnameseNumberVariants(t);
    for (const v of nv) {
      if (!titlesToProcess.includes(v) && !numVariants.includes(v)) {
        numVariants.push(v);
      }
    }
  }
  titlesToProcess.push(...numVariants);

  for (const t of titlesToProcess) {
    const rawSegments = t.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => cleanTitle(s)).filter(Boolean);
    const meaningfulSegments = rawSegments.filter(s => s.length >= 2 && !/^(mv|official|audio|video|lyrics)$/i.test(s));

    if (meaningfulSegments.length >= 2) {
      let detectedArtistSegIdx = -1;
      if (normCleanArt) {
        for (let i = 0; i < meaningfulSegments.length; i++) {
          const seg = meaningfulSegments[i];
          const segArtists = extractArtists(seg);
          if (segArtists.some(a => {
            const nA = normalizeStr(a);
            return nA && (nA === normCleanArt || nA.includes(normCleanArt) || normCleanArt.includes(nA));
          })) {
            detectedArtistSegIdx = i;
            break;
          }
        }
      }

      if (detectedArtistSegIdx !== -1) {
        const artistSeg = meaningfulSegments[detectedArtistSegIdx];
        const artistList = extractArtists(artistSeg);
        if (cleanArt && !artistList.some(a => normalizeStr(a) === normCleanArt)) {
          artistList.push(cleanArt);
        }
        for (const fArt of rawFeatArtists) {
          if (!artistList.some(a => normalizeStr(a) === normalizeStr(fArt))) {
            artistList.push(fArt);
          }
        }

        const otherSegments = meaningfulSegments.filter((_, idx) => idx !== detectedArtistSegIdx);
        let candidateTracks = otherSegments.filter(s => !/(?:album|the album|ep|single|vol\.?\s*\d+|ost|soundtrack)/i.test(s));
        if (candidateTracks.length === 0) candidateTracks = otherSegments;

        for (const trackCand of candidateTracks) {
          const pureCand = stripFeatFromTrack(trackCand);
          const trackCands = pureCand && pureCand !== trackCand ? [trackCand, pureCand] : [trackCand];

          for (const tc of trackCands) {
            for (const art of artistList) {
              queries.push({ track: tc, artist: art, expectedTrack: tc, expectedArtist: artistList });
              queries.push({ q: `${tc} ${art}`, expectedTrack: tc, expectedArtist: artistList });
            }
            if (artistList.length > 1) {
              queries.push({ track: tc, artist: artistSeg, expectedTrack: tc, expectedArtist: artistList });
              queries.push({ q: `${tc} ${artistSeg}`, expectedTrack: tc, expectedArtist: artistList });
            }
          }

          const feat = splitFeat(trackCand);
          if (feat) {
            const featArtists = [...artistList, feat.artistPart];
            queries.push({ track: feat.titlePart, artist: artistSeg, expectedTrack: feat.titlePart, expectedArtist: featArtists });
            queries.push({ track: feat.titlePart, artist: feat.artistPart, expectedTrack: feat.titlePart, expectedArtist: featArtists });
            queries.push({ q: `${feat.titlePart} ${artistSeg}`, expectedTrack: feat.titlePart, expectedArtist: featArtists });
          }
        }
      } else {
        const s1 = meaningfulSegments[0];
        const s2 = meaningfulSegments[1];
        const s1Artists = extractArtists(s1);
        const s2Artists = extractArtists(s2);

        const expB = [...s1Artists];
        if (cleanArt && !expB.some(a => normalizeStr(a) === normCleanArt)) expB.push(cleanArt);

        const expA = [...s2Artists];
        if (cleanArt && !expA.some(a => normalizeStr(a) === normCleanArt)) expA.push(cleanArt);

        queries.push({ track: s2, artist: s1, expectedTrack: s2, expectedArtist: expB });
        queries.push({ track: s1, artist: s2, expectedTrack: s1, expectedArtist: expA });
        queries.push({ q: `${s2} ${s1}`, expectedTrack: s2, expectedArtist: expB });
        queries.push({ q: `${s1} ${s2}`, expectedTrack: s1, expectedArtist: expA });

        for (const art of s1Artists) {
          queries.push({ track: s2, artist: art, expectedTrack: s2, expectedArtist: expB });
          queries.push({ q: `${s2} ${art}`, expectedTrack: s2, expectedArtist: expB });
        }

        for (const art of s2Artists) {
          queries.push({ track: s1, artist: art, expectedTrack: s1, expectedArtist: expA });
          queries.push({ q: `${s1} ${art}`, expectedTrack: s1, expectedArtist: expA });
        }

        const feat1 = splitFeat(s1);
        if (feat1) {
          const exp = [s2, feat1.artistPart];
          if (cleanArt) exp.push(cleanArt);
          queries.push({ track: feat1.titlePart, artist: s2, expectedTrack: feat1.titlePart, expectedArtist: exp });
          queries.push({ track: feat1.titlePart, artist: feat1.artistPart, expectedTrack: feat1.titlePart, expectedArtist: exp });
          queries.push({ q: `${feat1.titlePart} ${s2}`, expectedTrack: feat1.titlePart, expectedArtist: exp });
        }

        const feat2 = splitFeat(s2);
        if (feat2) {
          const exp = [s1, feat2.artistPart];
          if (cleanArt) exp.push(cleanArt);
          queries.push({ track: feat2.titlePart, artist: s1, expectedTrack: feat2.titlePart, expectedArtist: exp });
          queries.push({ track: feat2.titlePart, artist: feat2.artistPart, expectedTrack: feat2.titlePart, expectedArtist: exp });
          queries.push({ q: `${feat2.titlePart} ${s1}`, expectedTrack: feat2.titlePart, expectedArtist: exp });
        }
      }
    } else {
      const allKnownArtists = [];
      if (cleanArt && cleanArt !== 'Unknown' && cleanArt !== 'YouTube Music') {
        const individualArtists = extractArtists(cleanArt);
        for (const ia of individualArtists) {
          if (!allKnownArtists.some(a => normalizeStr(a) === normalizeStr(ia))) {
            allKnownArtists.push(ia);
          }
        }
        if (!allKnownArtists.some(a => normalizeStr(a) === normCleanArt)) {
          allKnownArtists.push(cleanArt);
        }
      }
      for (const fArt of rawFeatArtists) {
        if (!allKnownArtists.some(a => normalizeStr(a) === normalizeStr(fArt))) {
          allKnownArtists.push(fArt);
        }
      }

      for (const art of allKnownArtists) {
        queries.push({ track: t, artist: art, expectedTrack: t, expectedArtist: allKnownArtists });
        queries.push({ q: `${t} ${art}`, expectedTrack: t, expectedArtist: allKnownArtists });
      }
      queries.push({ q: t, expectedTrack: t, expectedArtist: allKnownArtists.length > 0 ? allKnownArtists : undefined });
    }

    if (cleanArt && cleanArt !== 'Unknown' && cleanArt !== 'YouTube Music') {
      queries.push({ track: t, artist: cleanArt, expectedTrack: t, expectedArtist: cleanArt });
      queries.push({ q: `${t} ${cleanArt}`, expectedTrack: t, expectedArtist: cleanArt });
    }
  }

  const pureTrack = stripFeatFromTrack(deepClean || primaryClean);
  if (pureTrack && pureTrack.length >= 2) {
    queries.push({ q: pureTrack, expectedTrack: pureTrack, expectedArtist: undefined });
  }

  const seen = new Set();
  const deduped = [];
  for (const item of queries) {
    const key = (item.track && item.artist ? `${item.track}|${item.artist}` : (item.q || '')).toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}

function isValidMatch(match, expectedTrack, expectedArtist) {
  if (!match || !match.trackName) return false;

  const mRawTrack = match.trackName;
  const mFullTrack = normalizeStr(cleanTitle(mRawTrack));
  const mFullTrackNoParen = normalizeStr(stripParentheses(cleanTitle(mRawTrack)));
  const trackSegs = mRawTrack
    .split(/\s+[-–—|:/]\s+|\s*[|:]\s*/)
    .flatMap(s => [normalizeStr(cleanTitle(s)), normalizeStr(stripParentheses(cleanTitle(s)))])
    .filter(Boolean);
  const candidateTrackNorms = [...new Set([mFullTrack, mFullTrackNoParen, ...trackSegs])];
  const mArtist = normalizeStr(cleanArtistName(match.artistName));

  if (expectedTrack) {
    const eTrack = normalizeStr(stripParentheses(cleanTitle(expectedTrack)));
    if (eTrack) {
      const eWords = eTrack.split(' ').filter(w => w.length >= 2);
      if (eWords.length === 0) return false;

      const trackMatched = candidateTrackNorms.some(cand => {
        if (!cand) return false;
        if (cand === eTrack) return true;
        if (cand.includes(eTrack) || eTrack.includes(cand)) return true;

        const cWords = cand.split(' ').filter(w => w.length >= 2);
        if (cWords.length === 0) return false;

        if (eWords.length <= 2) {
          return eWords.every(w => cWords.includes(w) || cand.includes(w));
        }

        const matchWords = eWords.filter(w => cWords.includes(w) || cand.includes(w));
        return matchWords.length >= Math.ceil(eWords.length * 0.7);
      });

      if (!trackMatched) return false;
    }
  }

  const artistList = expectedArtist ? (Array.isArray(expectedArtist) ? expectedArtist : [expectedArtist]) : [];
  const validExpectedArtists = artistList.map(a => normalizeStr(cleanArtistName(a))).filter(Boolean);

  if (validExpectedArtists.length > 0) {
    const artistMatched = validExpectedArtists.some(eArt => {
      if (mArtist && mArtist !== 'various artists' && mArtist !== 'unknown') {
        if (mArtist === eArt || mArtist.includes(eArt) || eArt.includes(mArtist)) {
          return true;
        }
        const eArtWords = eArt.split(' ').filter(w => w.length >= 2);
        if (eArtWords.length > 0 && eArtWords.every(w => mArtist.includes(w))) {
          return true;
        }
      }
      if (mFullTrack.includes(eArt)) return true;
      const eArtWords = eArt.split(' ').filter(w => w.length >= 2);
      if (eArtWords.length >= 2 && eArtWords.every(w => mFullTrack.includes(w))) {
        return true;
      }
      return false;
    });

    if (!artistMatched) return false;
  } else if (expectedTrack) {
    const eTrack = normalizeStr(stripParentheses(cleanTitle(expectedTrack)));
    const isFullTrackExact = candidateTrackNorms.some(cand => {
      if (!cand) return false;
      if (cand === eTrack) return true;
      if (cand.includes(eTrack) || eTrack.includes(cand)) return true;
      return false;
    });
    if (!isFullTrackExact) return false;
  }

  return true;
}

function parseLrc(lrcString) {
  if (!lrcString || typeof lrcString !== 'string') return null;
  const lines = lrcString.split('\n');
  const result = [];
  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)/);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const timeMs = min * 60000 + sec * 1000 + ms;
      const text = match[4].trim();
      if (text) {
        result.push({ time: timeMs, text });
      }
    }
  }
  return result.length > 0 ? result : null;
}

function hasVietnameseSyllablePattern(cleanStr) {
  if (!cleanStr) return false;
  const norm = normalizeStr(cleanStr);
  const tokens = norm.split(/\s+/).filter(w => w.length >= 2);
  if (tokens.length === 0) return false;

  let vnTokenCount = 0;
  let enTokenCount = 0;

  for (const token of tokens) {
    if (COMMON_ENGLISH_WORDS_REGEX.test(token)) {
      enTokenCount++;
      continue;
    }
    if (VN_ACCENTLESS_SYLLABLES_REGEX.test(token) || VN_PHONETIC_CLUSTER_REGEX.test(token)) {
      vnTokenCount++;
    }
  }

  if (enTokenCount > vnTokenCount) return false;
  if (tokens.length <= 2) {
    return vnTokenCount >= Math.max(1, tokens.length) && enTokenCount === 0;
  }
  return vnTokenCount >= 2 && (vnTokenCount / tokens.length) >= 0.5;
}

function stripVietnameseBoilerplate(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\(\[\{][^\)\]\}]*(?:chính\s*thức|chinh\s*thuc|mv|official|âm\s*nhạc|bản\s*gốc|bản\s*chuẩn|bản\s*dịch|lời\s*việt|vietsub|phụ\s*đề|thuyết\s*minh|karaoke|remix|lyrics|audio|video|visualizer)[^\)\]\}]*[\)\]\}]/gi, ' ')
    .replace(/(?:^|\s+)(?:mv\s*chính\s*thức|video\s*chính\s*thức|video\s*âm\s*nhạc\s*chính\s*thức|bản\s*chính\s*thức|chính\s*thức|chinh\s*thuc|vietsub|viet\s*sub|lời\s*việt|bản\s*dịch|phụ\s*đề|thuyết\s*minh)(?:\s+|$)/gi, ' ')
    .replace(/(?:^|\s+)(?:và|của|với|cùng|từ|hợp\s*tác\s*với|hợp\s*tác\s*cùng|ft\.?|feat\.?|featuring)(?:\s+|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVietnameseTrack(contextOrTitle = {}, maybeArtist = '') {
  let rawTitle = '';
  let artist = '';
  let videoTitle = '';
  let uploader = '';

  if (typeof contextOrTitle === 'string') {
    rawTitle = contextOrTitle;
    artist = typeof maybeArtist === 'string' ? maybeArtist : '';
  } else if (contextOrTitle && typeof contextOrTitle === 'object') {
    rawTitle = contextOrTitle.rawTitle || '';
    artist = contextOrTitle.artist || '';
    videoTitle = contextOrTitle.videoTitle || '';
    uploader = contextOrTitle.uploader || '';
  }

  const rawCombined = `${rawTitle} ${videoTitle} ${artist} ${uploader}`.trim();
  if (!rawCombined) return false;
  const normCombined = normalizeStr(rawCombined);
  const normArtist = normalizeStr(`${artist} ${uploader}`);

  // 1. Nếu có chữ Hàn, Nhật, Trung
  if (CJK_SCRIPT_REGEX.test(rawCombined)) {
    const isExplicitVnCover = /lời\s*việt|nhạc\s*hoa\s*lời\s*việt|vietsub|cover\s*tiếng\s*việt/i.test(rawCombined) ||
      KNOWN_VN_ARTISTS_NORM_REGEX.test(normCombined) ||
      KNOWN_VN_ARTISTS_NORM_REGEX.test(normArtist);
    if (!isExplicitVnCover) {
      return false;
    }
  }

  // 2. Nhận diện Nghệ sĩ V-Pop / V-Rap / V-Indie chuẩn hóa không dấu
  if (KNOWN_VN_ARTISTS_NORM_REGEX.test(normCombined) || KNOWN_VN_ARTISTS_NORM_REGEX.test(normArtist)) {
    return true;
  }

  // 3. Nhận diện Nghệ sĩ / Nhóm nhạc / Hãng game Quốc tế
  if (KNOWN_INTL_ARTISTS_REGEX.test(rawCombined) || KNOWN_INTL_ARTISTS_REGEX.test(normCombined)) {
    return false;
  }

  // 4. Lọc sạch boilerplate tiếng Việt địa phương hóa của YouTube
  const cleanedTitle = stripVietnameseBoilerplate(rawTitle || videoTitle || '');
  const cleanedArtist = stripVietnameseBoilerplate(artist || uploader || '');
  const cleanedCombined = `${cleanedTitle} ${cleanedArtist}`.trim();

  // 5. Nếu sau khi làm sạch tiêu đề/ca sĩ vẫn còn chứa dấu tiếng Việt
  if (VIETNAMESE_REGEX.test(cleanedTitle) || VIETNAMESE_REGEX.test(cleanedArtist)) {
    const words = cleanedCombined.split(/[\s\-–—|(),.!?'"/]+/).filter(Boolean);
    const vnWords = words.filter(w => VIETNAMESE_REGEX.test(w));
    const enWords = words.filter(w => !VIETNAMESE_REGEX.test(w) && COMMON_ENGLISH_WORDS_REGEX.test(w));
    if (vnWords.length >= 1 && enWords.length <= vnWords.length * 2) {
      return true;
    }
  }

  // 6. Phân tích cấu trúc âm tiết Tiếng Việt không dấu
  const coreTitleOnly = cleanedTitle
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/(?:feat\.?|ft\.?|prod\.?).*$/i, ' ')
    .replace(/['"`]/g, ' ')
    .trim();

  if (hasVietnameseSyllablePattern(coreTitleOnly) || hasVietnameseSyllablePattern(cleanedArtist)) {
    return true;
  }

  // 7. Kiểm tra với danh sách từ khóa Việt Nam
  return KNOWN_VN_KEYWORDS.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return regex.test(normCombined);
  });
}

/**
 * Trích xuất nhãn biến thể âm nhạc TRƯỚC KHI làm sạch tiêu đề
 * Nhận diện toàn diện: remix, lofi, mashup, nonstop, bootleg, acoustic, live, speedup, slowed, instrumental, cover
 */
function detectVariantTag(rawTitle = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return 'original';
  const t = rawTitle.toLowerCase();
  if (/\b(lofi|lo-fi|chill|chill\s*ver|chill\s*mix)\b/i.test(t)) return 'lofi';
  if (/\b(remix|mix|club\s*edit|extended\s*mix|vip\s*mix|vinahouse|vinahey)\b/i.test(t)) return 'remix';
  if (/\b(mashup|mash\s*up)\b/i.test(t)) return 'mashup';
  if (/\b(nonstop|non-stop|vinahouse\s*nonstop)\b/i.test(t)) return 'nonstop';
  if (/\b(bootleg|boot\s*leg)\b/i.test(t)) return 'bootleg';
  if (/\b(acoustic|unplugged|piano\s*ver|guitar\s*ver)\b/i.test(t)) return 'acoustic';
  if (/\b(live|concert|tour|recorded\s*live|performance)\b/i.test(t)) return 'live';
  if (/\b(speed\s*up|sped\s*up|nightcore|fast\s*ver)\b/i.test(t)) return 'speedup';
  if (/\b(slowed|reverb|slowed\s*(\+|and)\s*reverb|slowed\s*down)\b/i.test(t)) return 'slowed';
  if (/\b(instrumental|karaoke\s*ver|beat|minus\s*one)\b/i.test(t)) return 'instrumental';
  if (/\b(cover|covered\s*by)\b/i.test(t)) return 'cover';
  return 'original';
}

/**
 * Sinh chuỗi băm chuỗi an toàn ngắn (Fowler–Noll–Vo 32-bit hash)
 */
function simpleStringHash(str = '') {
  let hash = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Sinh khóa Fingerprint chuẩn hóa đa nhân tố
 * - Khung 4s cho bản gốc (dung sai intro/outro nhỏ giữa YouTube và Spotify)
 * - Khung 2s cho bản biến thể (chống va chạm giữa các bản remix/lofi khác nhau)
 * - Fallback băm an toàn từ rawTitle/videoId nếu normTitle bị xóa rỗng bởi cleanTitle
 */
function generateMultiFactorFingerprint(title = '', artist = '', durationSec = 0, rawId = '') {
  const variantTag = detectVariantTag(title);
  let normTitle = normalizeStr(cleanTitle(title));

  // Fallback chống va chạm khi tiêu đề bị cleanTitle xóa rỗng (ví dụ video chỉ có "[Official Music Video]")
  if (!normTitle) {
    normTitle = normalizeStr(title);
  }
  if (!normTitle) {
    normTitle = rawId ? `raw_${rawId}` : `h_${simpleStringHash(title || 'untitled')}`;
  }

  const normArtist = normalizeStr(cleanArtistName(artist)) || 'unknown';
  const step = variantTag === 'original' ? 4 : 2;
  const numDur = Number(durationSec) || 0;
  const durationBucket = numDur > 0 ? Math.round(numDur / step) * step : 0;

  return `fp_${normTitle}__${normArtist}__${variantTag}__${durationBucket}`;
}

/**
 * LỚP 1: Phân loại sơ bộ ngôn ngữ ca từ dựa trên Metadata, Tiêu đề và Vùng nghệ sĩ
 * Hỗ trợ nhận diện toàn diện: Quốc tế, K-Pop, J-Pop, C-Pop và V-Pop
 */
function determinePreliminaryVocalLanguage(title = '', artist = '', artistRegion = 'INTL') {
  const normCombined = `${title} ${artist}`.toLowerCase();

  // Quy tắc ưu tiên 1: Nhóm ảo toàn cầu thuộc Riot Games mặc định hát tiếng Anh
  if (VIRTUAL_GLOBAL_GROUPS_REGEX.test(normCombined)) {
    return { vocalLang: 'en', isAmbiguous: false };
  }

  // Quy tắc ưu tiên 2: Có chứa ký tự Hangul rõ ràng trong tiêu đề hoặc nghệ sĩ
  HANGUL_REGEX.lastIndex = 0;
  if (HANGUL_REGEX.test(title) || (HANGUL_REGEX.lastIndex = 0, HANGUL_REGEX.test(artist))) {
    HANGUL_REGEX.lastIndex = 0;
    return { vocalLang: 'ko', isAmbiguous: false };
  }

  // Quy tắc ưu tiên 3: Có chứa ký tự Hiragana hoặc Katakana tiếng Nhật
  if (JAPANESE_CHAR_REGEX.test(title) || JAPANESE_CHAR_REGEX.test(artist)) {
    return { vocalLang: 'ja', isAmbiguous: false };
  }

  // Quy tắc ưu tiên 4: Có dấu tiếng Việt rõ ràng hoặc nghệ sĩ có vùng VI
  if (VIETNAMESE_REGEX.test(title) || VIETNAMESE_REGEX.test(artist) || artistRegion === 'VI') {
    return { vocalLang: 'vi', isAmbiguous: false };
  }

  // Quy tắc ưu tiên 5: Có Hán tự CJK tiếng Trung (khi không chứa Kana tiếng Nhật)
  if (CHINESE_CHAR_REGEX.test(title) || CHINESE_CHAR_REGEX.test(artist)) {
    return { vocalLang: 'zh', isAmbiguous: false };
  }

  // Quy tắc ưu tiên 6: Nghệ sĩ Đông Á nhưng tiêu đề hoàn toàn là chữ Latinh -> Cần thẩm định Lớp 2
  if (artistRegion === 'KR') {
    return { vocalLang: 'ambiguous_kr', isAmbiguous: true };
  }
  if (artistRegion === 'JP') {
    return { vocalLang: 'ambiguous_jp', isAmbiguous: true };
  }
  if (artistRegion === 'CN' || artistRegion === 'TW' || artistRegion === 'HK') {
    return { vocalLang: 'ambiguous_zh', isAmbiguous: true };
  }

  return { vocalLang: 'en', isAmbiguous: false };
}

/**
 * Trích xuất mẫu phụ đề đại diện với Cơ chế Intro Chant Bypass
 * Bỏ qua 3 dòng mở đầu để tránh các khẩu hiệu/intro chant tiếng Anh phổ biến trong K-Pop
 * (ví dụ: "BLACKPINK in your area / Yeah yeah yeah / Ha how you like that...")
 * Lấy mẫu kiểm định từ dòng thứ 4 đến dòng thứ 12 để tiếp cận lời bài hát chính xác
 */
function extractRepresentativeSampleLines(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  if (lines.length <= 5) {
    return lines.map(l => (typeof l === 'string' ? l : l.text || '')).join(' ');
  }
  const sampleSlice = lines.slice(3, 12);
  return sampleSlice.map(l => (typeof l === 'string' ? l : l.text || '')).join(' ');
}

/**
 * Thuật toán Phân định Hòa điểm (Tie-Breaker Bonus)
 * Giải quyết triệt để trường hợp ca khúc K-Pop hát tiếng Anh (như BTS - Dynamite) khi cả track EN và KO đều đạt 210 điểm
 */
function calculateTieBreakerBonus(track, context = {}) {
  let bonus = 0;
  const trackName = String(track?.name || track?.trackName || '').toLowerCase();
  const vssId = String(track?.vssId || '').toLowerCase();
  const kind = String(track?.kind || '').toLowerCase();
  const langCode = String(track?.languageCode || track?.langCode || '').toLowerCase();

  // 1. Phạt nặng track có nhãn bản dịch do người dùng hoặc cộng đồng đóng góp
  const isTranslation = /\b(?:translation|translated|caption|sub|vietsub|engsub)\b/i.test(trackName) ||
    /(?:tiếng việt|한국어\s*번역|日本語\s*訳)/i.test(trackName);
  if (isTranslation) {
    bonus -= 60;
  }

  // 2. Thưởng track mang nhãn nguyên bản / chính thức
  const isOriginal = /\b(?:original|official|auto-generated)\b/i.test(trackName) ||
    /(?:한국어\s*\(원본\)|english\s*\(original\))/i.test(trackName);
  if (isOriginal) {
    bonus += 25;
  }

  // 3. Ưu tiên track kind: 'standard' / isOfficial thay vì ASR hoặc translation
  if (kind === 'standard' || track?.isOfficial) {
    bonus += 20;
  }
  if (kind === 'asr' || vssId.startsWith('a.')) {
    bonus -= 15;
  }

  // 4. Đối chiếu tín hiệu Nhận diện Giọng nói YouTube ASR (Audio Speech Recognition)
  if (context.youtubeAsrLang) {
    if (langCode.startsWith(context.youtubeAsrLang)) {
      bonus += 35;
    }
  }

  // 5. Đối chiếu Siêu dữ liệu từ LRCLIB Studio Match
  if (context.lrclibVocalLang) {
    if (langCode.startsWith(context.lrclibVocalLang)) {
      bonus += 40;
    }
  }

  return bonus;
}

/**
 * LỚP 2: Thẩm định thực nghiệm qua mẫu ca từ (Subtitle Sample Heuristic) & Phân định Hòa điểm
 * Áp dụng Intro Chant Bypass và tính toán tỷ lệ ký tự Hangul (mở rộng Jamo), Kana, CJK, Latinh
 */
function scoreSubtitleTrackWithHeuristic(track, prelimVocal = {}, context = {}) {
  let score = track.baseScore || track.score || 0;
  const langCode = String(track?.languageCode || track?.langCode || '').toLowerCase();
  const isKoreanTrack = langCode.startsWith('ko');
  const isEnglishTrack = langCode.startsWith('en');
  const isJapaneseTrack = langCode.startsWith('ja');
  const isChineseTrack = langCode.startsWith('zh');

  const sampleText = track.representativeText || 
    (Array.isArray(track.sampleLines) ? extractRepresentativeSampleLines(track.sampleLines) : (track.sampleText || ''));

  const totalLetters = (sampleText.match(/[\p{L}]/gu) || []).length;
  const hangulLetters = (sampleText.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
  const kanaLetters = (sampleText.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const cjkLetters = (sampleText.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latinLetters = (sampleText.match(/[a-zA-Z]/g) || []).length;

  const hangulRatio = totalLetters > 0 ? (hangulLetters / totalLetters) : 0;
  const kanaRatio = totalLetters > 0 ? (kanaLetters / totalLetters) : 0;
  const cjkRatio = totalLetters > 0 ? (cjkLetters / totalLetters) : 0;
  const latinRatio = totalLetters > 0 ? (latinLetters / totalLetters) : 0;

  if (prelimVocal.isAmbiguous && prelimVocal.vocalLang === 'ambiguous_kr') {
    if (hangulRatio >= 0.25) {
      if (isKoreanTrack) {
        score += 160;
      } else if (isEnglishTrack) {
        score += 40;
      } else {
        score -= 50;
      }
    } else if (hangulRatio < 0.05 && latinRatio >= 0.85) {
      if (isEnglishTrack) {
        score += 160;
      } else if (isKoreanTrack) {
        score -= 100;
      }
    }
  }

  if (prelimVocal.isAmbiguous && prelimVocal.vocalLang === 'ambiguous_jp') {
    if (kanaRatio >= 0.15 || (cjkLetters > 0 && kanaRatio >= 0.08)) {
      if (isJapaneseTrack) {
        score += 160;
      } else if (isEnglishTrack) {
        score += 40;
      } else {
        score -= 50;
      }
    } else if (kanaRatio < 0.03 && latinRatio >= 0.85) {
      if (isEnglishTrack) {
        score += 160;
      } else if (isJapaneseTrack) {
        score -= 100;
      }
    }
  }

  if (prelimVocal.isAmbiguous && prelimVocal.vocalLang === 'ambiguous_zh') {
    if (cjkRatio >= 0.25) {
      if (isChineseTrack) {
        score += 160;
      } else if (isEnglishTrack) {
        score += 40;
      } else {
        score -= 50;
      }
    } else if (cjkRatio < 0.05 && latinRatio >= 0.85) {
      if (isEnglishTrack) {
        score += 160;
      } else if (isChineseTrack) {
        score -= 100;
      }
    }
  }

  score += calculateTieBreakerBonus(track, context);
  return score;
}

module.exports = {
  isGarbageLyrics,
  normalizeStr,
  detectVariantTrack,
  detectVariantTag,
  simpleStringHash,
  generateMultiFactorFingerprint,
  determinePreliminaryVocalLanguage,
  extractRepresentativeSampleLines,
  calculateTieBreakerBonus,
  scoreSubtitleTrackWithHeuristic,
  extractOriginalSongTitle,
  cleanTitle,
  cleanArtistName,
  extractArtists,
  extractFeatFromRaw,
  splitFeat,
  stripFeatFromTrack,
  generateSearchVariants,
  generateVietnameseNumberVariants,
  isValidMatch,
  parseLrc,
  hasVietnameseSyllablePattern,
  isVietnameseTrack,
  isLyricLanguageConsistent,
  extractParentheticalTitles,
  stripParentheses,
  stripVietnameseBoilerplate,
  TECHNICAL_PAREN_REGEX,
  VIETNAMESE_REGEX,
  HANGUL_REGEX,
  JAPANESE_CHAR_REGEX,
  CHINESE_CHAR_REGEX,
  CJK_SCRIPT_REGEX,
  VIRTUAL_GLOBAL_GROUPS_REGEX,
  KNOWN_INTL_ARTISTS_REGEX,
  KNOWN_VN_ARTISTS_NORM_REGEX,
  VN_ACCENTLESS_SYLLABLES_REGEX,
  VN_PHONETIC_CLUSTER_REGEX,
  COMMON_ENGLISH_WORDS_REGEX,
  KNOWN_VN_KEYWORDS,
  VN_NUMBER_WORDS
};
