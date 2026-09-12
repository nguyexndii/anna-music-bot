const fetch = globalThis.fetch || require('node-fetch');
const ytdlp = require('yt-dlp-exec');

function normalizeStr(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(str) {
  if (!str) return '';
  let s = str
    .replace(/\[.*?\]|【.*?】/g, ' ')
    .trim();
  s = s.replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
  s = s.replace(/\((?:piano|acoustic|live|remix|official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat|feat\.?|ft\.?|version|ver|catena).*?\)/gi, ' ');
  s = s.replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official)/gi, ' ');
  s = s.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, ' ');
  s = s.replace(/4k|hd|1080p/gi, ' ');
  s = s.replace(/\s*[-|:/\\–—]\s*$/g, '').trim();
  s = s.replace(/^\s*[-|:/\\–—]\s*/g, '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function stripParentheses(str) {
  if (!str) return '';
  return str.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanArtistName(str) {
  if (!str) return '';
  const cleaned = cleanTitle(str).replace(/(?:official\s*(?:channel)?|channel|topic|vevo|records|entertainment|youtube\s*music|youtube)/gi, '').trim();
  if (cleaned.toLowerCase() === 'unknown' || cleaned.toLowerCase() === 'youtube' || cleaned.toLowerCase() === 'youtube music') {
    return '';
  }
  return cleaned;
}

function extractArtists(artistStr) {
  if (!artistStr) return [];
  const clean = artistStr.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, '').trim();
  const parts = clean.split(/(?:\s+(?:ft\.?|feat\.?|x|cùng|với)\s+|[&+,/])/i).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [clean];
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
  // Không dùng 'x' ở đây vì 'x' là ký hiệu kết hợp giữa các nghệ sĩ (Low G x tlinh), không phải tên bài
  const m = str.match(/^(.+?)\s+(?:ft\.?|feat\.?|cùng|với)\s+(.+)$/i);
  if (m) {
    return { titlePart: m[1].trim(), artistPart: m[2].trim() };
  }
  return null;
}

function generateSearchVariants(rawTitle, rawArtist = '') {
  if (!rawTitle) return [];

  const queries = [];
  const primaryClean = cleanTitle(rawTitle);
  const deepClean = stripParentheses(primaryClean);
  let cleanArt = cleanArtistName(rawArtist);
  const rawFeatArtists = extractFeatFromRaw(rawTitle);

  // Nếu artist rỗng nhưng tiêu đề có (feat. ...), dùng feat artists làm ca sĩ
  if (!cleanArt && rawFeatArtists.length > 0) {
    cleanArt = rawFeatArtists[0];
  }

  const normCleanArt = cleanArt ? normalizeStr(cleanArt) : '';

  const titlesToProcess = [primaryClean];
  if (deepClean && deepClean !== primaryClean) {
    titlesToProcess.unshift(deepClean); // Ưu tiên bản đã bỏ ngoặc đơn phụ đề tiếng Anh
  }

  for (const t of titlesToProcess) {
    const rawSegments = t.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => cleanTitle(s)).filter(Boolean);
    const meaningfulSegments = rawSegments.filter(s => s.length >= 2 && !/^(mv|official|audio|video|lyrics)$/i.test(s));

    if (meaningfulSegments.length >= 2) {
      // Tìm xem có segment nào khớp với ca sĩ đã biết (channel name) không
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
        // ĐÃ XÁC ĐỊNH RÕ: segment này là Ca Sĩ, các segment còn lại là Tên Bài (hoặc Album)
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
        // Lọc bỏ segment rõ ràng là tên Album nếu còn segment khác
        let candidateTracks = otherSegments.filter(s => !/(?:album|the album|ep|single|vol\.?\s*\d+|ost|soundtrack)/i.test(s));
        if (candidateTracks.length === 0) candidateTracks = otherSegments;

        for (const trackCand of candidateTracks) {
          // 1. Direct GET track + artist
          for (const art of artistList) {
            queries.push({ track: trackCand, artist: art, expectedTrack: trackCand, expectedArtist: artistList });
            queries.push({ q: `${trackCand} ${art}`, expectedTrack: trackCand, expectedArtist: artistList });
          }
          if (artistList.length > 1) {
            queries.push({ track: trackCand, artist: artistSeg, expectedTrack: trackCand, expectedArtist: artistList });
            queries.push({ q: `${trackCand} ${artistSeg}`, expectedTrack: trackCand, expectedArtist: artistList });
          }

          // Trường hợp trackCand có feat: e.g. "Love Game ft. tlinh"
          const feat = splitFeat(trackCand);
          if (feat) {
            const featArtists = [...artistList, feat.artistPart];
            queries.push({ track: feat.titlePart, artist: artistSeg, expectedTrack: feat.titlePart, expectedArtist: featArtists });
            queries.push({ track: feat.titlePart, artist: feat.artistPart, expectedTrack: feat.titlePart, expectedArtist: featArtists });
            queries.push({ q: `${feat.titlePart} ${artistSeg}`, expectedTrack: feat.titlePart, expectedArtist: featArtists });
          }
        }
      } else {
        // Chưa biết chắc segment nào là ca sĩ: Thử cả 2 chiều s1-s2 và s2-s1, TUYỆT ĐỐI KHÔNG tìm q = 1 từ bare
        const s1 = meaningfulSegments[0];
        const s2 = meaningfulSegments[1];
        const s1Artists = extractArtists(s1);
        const s2Artists = extractArtists(s2);

        // Combination A: s1 là Tên Bài, s2 là Ca Sĩ
        for (const art of s2Artists) {
          queries.push({ track: s1, artist: art, expectedTrack: s1, expectedArtist: s2Artists });
          queries.push({ q: `${s1} ${art}`, expectedTrack: s1, expectedArtist: s2Artists });
        }
        queries.push({ track: s1, artist: s2, expectedTrack: s1, expectedArtist: s2Artists });
        queries.push({ q: `${s1} ${s2}`, expectedTrack: s1, expectedArtist: s2Artists });

        // Trường hợp s2 có feat: e.g. "Donald Gold - OBGTLH ft. Lil Shady"
        const feat2 = splitFeat(s2);
        if (feat2) {
          const exp = [s1, feat2.artistPart];
          queries.push({ track: feat2.titlePart, artist: s1, expectedTrack: feat2.titlePart, expectedArtist: exp });
          queries.push({ track: feat2.titlePart, artist: feat2.artistPart, expectedTrack: feat2.titlePart, expectedArtist: exp });
          queries.push({ q: `${feat2.titlePart} ${s1}`, expectedTrack: feat2.titlePart, expectedArtist: exp });
        }

        // Combination B: s2 là Tên Bài, s1 là Ca Sĩ
        for (const art of s1Artists) {
          queries.push({ track: s2, artist: art, expectedTrack: s2, expectedArtist: s1Artists });
          queries.push({ q: `${s2} ${art}`, expectedTrack: s2, expectedArtist: s1Artists });
        }
        queries.push({ track: s2, artist: s1, expectedTrack: s2, expectedArtist: s1Artists });
        queries.push({ q: `${s2} ${s1}`, expectedTrack: s2, expectedArtist: s1Artists });

        // Trường hợp s1 có feat: e.g. "OBGTLH ft. Lil Shady - Donald Gold"
        const feat1 = splitFeat(s1);
        if (feat1) {
          const exp = [s2, feat1.artistPart];
          queries.push({ track: feat1.titlePart, artist: s2, expectedTrack: feat1.titlePart, expectedArtist: exp });
          queries.push({ track: feat1.titlePart, artist: feat1.artistPart, expectedTrack: feat1.titlePart, expectedArtist: exp });
          queries.push({ q: `${feat1.titlePart} ${s2}`, expectedTrack: feat1.titlePart, expectedArtist: exp });
        }
      }
    } else {
      // Chỉ có 1 segment: tiêu đề bài hát đơn (ví dụ "Khởi", "Bước Qua Nhau")
      const allKnownArtists = [];
      if (cleanArt && cleanArt !== 'Unknown' && cleanArt !== 'YouTube Music') {
        allKnownArtists.push(cleanArt);
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

    // Cuối cùng: tìm kiếm theo full clean title kết hợp với artist (nếu có)
    if (cleanArt && cleanArt !== 'Unknown' && cleanArt !== 'YouTube Music') {
      queries.push({ track: t, artist: cleanArt, expectedTrack: t, expectedArtist: cleanArt });
      queries.push({ q: `${t} ${cleanArt}`, expectedTrack: t, expectedArtist: cleanArt });
    }
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
  const mArtist = normalizeStr(cleanArtistName(match.artistName));

  // Tách các phân đoạn của trackName trên LRCLIB (phòng khi LRCLIB lưu dạng "Tên Bài - Ca Sĩ" hoặc "Ca Sĩ | Tên Bài | Album")
  const trackSegs = mRawTrack.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => normalizeStr(cleanTitle(s))).filter(Boolean);
  const candidateTrackNorms = [mFullTrack, ...trackSegs];

  if (expectedTrack) {
    const eTrack = normalizeStr(cleanTitle(expectedTrack));
    if (eTrack) {
      const eWords = eTrack.split(' ').filter(w => w.length >= 2);
      if (eWords.length === 0) return false;

      // Kiểm tra xem có candidate nào khớp với expectedTrack không
      const trackMatched = candidateTrackNorms.some(cand => {
        if (!cand) return false;
        if (cand === eTrack) return true;

        const cWords = cand.split(' ').filter(w => w.length >= 2);
        if (cWords.length === 0) return false;

        if (eWords.length === 1) {
          // Bắt buộc candidate đúng 1 từ và khớp chính xác (ngăn "xa khơi" cho "khởi", "yêu xa" cho "yêu")
          return cWords.length === 1 && cWords[0] === eWords[0];
        }

        if (eWords.length === 2) {
          // Bắt buộc candidate đúng 2 từ và khớp chính xác (ngăn "in love" cho "love game")
          return cWords.length === 2 && cWords[0] === eWords[0] && cWords[1] === eWords[1];
        }

        if (eWords.length === 3) {
          return cand === eTrack || (cWords.length === 3 && cWords.every((w, i) => w === eWords[i]));
        }

        // Tên bài dài (>= 4 từ): Cần ít nhất 75% số từ khớp
        const matchWords = eWords.filter(w => cand.includes(w));
        return matchWords.length >= Math.ceil(eWords.length * 0.75);
      });

      if (!trackMatched) {
        return false;
      }
    }
  }

  if (expectedArtist) {
    const artistList = Array.isArray(expectedArtist) ? expectedArtist : [expectedArtist];
    const validExpectedArtists = artistList.map(a => normalizeStr(cleanArtistName(a))).filter(Boolean);

    if (validExpectedArtists.length > 0) {
      const artistMatched = validExpectedArtists.some(eArt => {
        // 1. Kiểm tra đối chiếu với match.artistName
        if (mArtist && mArtist !== 'various artists' && mArtist !== 'unknown') {
          if (mArtist === eArt || mArtist.includes(eArt) || eArt.includes(mArtist)) {
            return true;
          }
          const eArtWords = eArt.split(' ').filter(w => w.length >= 2);
          if (eArtWords.length > 0 && eArtWords.every(w => mArtist.includes(w))) {
            return true;
          }
        }

        // 2. Nếu match.artistName không khớp hoặc generic, kiểm tra trong trackName
        // Nhưng PHẢI khớp toàn bộ cụm từ nghệ sĩ (eArt) hoặc toàn bộ các từ của nghệ sĩ, KHÔNG ĐƯỢC dùng single word .some()
        if (mFullTrack.includes(eArt)) {
          return true;
        }
        const eArtWords = eArt.split(' ').filter(w => w.length >= 2);
        if (eArtWords.length >= 2 && eArtWords.every(w => mFullTrack.includes(w))) {
          return true;
        }

        return false;
      });

      if (!artistMatched) {
        return false;
      }
    }
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

// Bộ nhớ đệm lời bài hát (In-memory cache) tránh gọi lại nhiều lần gây tốn tài nguyên
const lyricsMemoryCache = new Map();
const MAX_LYRICS_CACHE = 200;

let LyricOffset = null;
try {
  LyricOffset = require('../database/models/LyricOffset');
} catch (e) {}

const lyricOffsetsMemoryCache = new Map();

function generateTrackKey(title, artist = '', targetUrl = null) {
  if (targetUrl) {
    const ytMatch = String(targetUrl).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch) return `yt_${ytMatch[1]}`;
  }
  const cleanT = normalizeStr(cleanTitle(title));
  const cleanA = normalizeStr(cleanArtistName(artist));
  return `song_${cleanT}_${cleanA}`.replace(/\s+/g, '_').slice(0, 100);
}

function getFirstLineTimestampMs(syncedLyrics) {
  if (!syncedLyrics) return 0;
  if (Array.isArray(syncedLyrics)) {
    return syncedLyrics[0]?.time ?? syncedLyrics[0]?.timeMs ?? 0;
  }
  if (typeof syncedLyrics === 'string') {
    const match = syncedLyrics.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      return min * 60000 + sec * 1000 + ms;
    }
  }
  return 0;
}

async function getSavedLyricOffset(trackKey, fallbackKey = null) {
  if (!trackKey) return 0;
  if (lyricOffsetsMemoryCache.has(trackKey)) {
    return lyricOffsetsMemoryCache.get(trackKey);
  }
  if (fallbackKey && lyricOffsetsMemoryCache.has(fallbackKey)) {
    return lyricOffsetsMemoryCache.get(fallbackKey);
  }
  if (!LyricOffset) return 0;
  try {
    let doc = await LyricOffset.findOne({ trackKey }).lean().exec();
    if (!doc && fallbackKey) {
      doc = await LyricOffset.findOne({ trackKey: fallbackKey }).lean().exec();
    }
    const offset = (doc && typeof doc.offsetMs === 'number') ? doc.offsetMs : 0;
    lyricOffsetsMemoryCache.set(trackKey, offset);
    return offset;
  } catch (e) {
    return 0;
  }
}

async function saveLyricOffset(trackKey, offsetMs, title = '', artist = '') {
  if (!trackKey) return;
  const numOffset = Math.round(Number(offsetMs) || 0);
  lyricOffsetsMemoryCache.set(trackKey, numOffset);

  if (!LyricOffset) return;
  try {
    await LyricOffset.findOneAndUpdate(
      { trackKey },
      { offsetMs: numOffset, title: title || '', artist: artist || '', updatedAt: new Date() },
      { upsert: true, new: true }
    );

    const count = await LyricOffset.countDocuments();
    if (count > 2000) {
      const excess = count - 2000;
      const oldestDocs = await LyricOffset.find().sort({ updatedAt: 1 }).limit(excess).select('_id').lean();
      if (oldestDocs.length > 0) {
        await LyricOffset.deleteMany({ _id: { $in: oldestDocs.map(d => d._id) } });
      }
    }
  } catch (e) {
    console.error('[LyricOffset DB Error]:', e.message);
  }
}

function getCachedLyrics(key) {
  if (!key) return null;
  const item = lyricsMemoryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > 3600 * 1000) {
    lyricsMemoryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCachedLyrics(key, data) {
  if (!key || !data) return;
  if (lyricsMemoryCache.size >= MAX_LYRICS_CACHE) {
    const firstKey = lyricsMemoryCache.keys().next().value;
    lyricsMemoryCache.delete(firstKey);
  }
  lyricsMemoryCache.set(key, { data, ts: Date.now() });
}

const VIETNAMESE_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

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
  'vpop', 'v-pop', 'nhac viet', 'nhạc việt'
];

function isVietnameseTrack(context = {}) {
  const { rawTitle = '', artist = '', videoTitle = '', uploader = '' } = context;
  if (VIETNAMESE_REGEX.test(rawTitle) || VIETNAMESE_REGEX.test(artist) || VIETNAMESE_REGEX.test(videoTitle) || VIETNAMESE_REGEX.test(uploader)) {
    return true;
  }
  const textToCheck = `${rawTitle} ${artist} ${videoTitle} ${uploader}`.toLowerCase();
  return KNOWN_VN_KEYWORDS.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return regex.test(textToCheck);
  });
}

// Cache tạm metadata ytdlp trong 2 phút để tái sử dụng giữa trích xuất CC và căn nhịp intro
const ytInfoCache = new Map();

function getCachedYtdlpInfo(url) {
  const norm = normalizeTargetUrl(url);
  if (!norm) return null;
  const item = ytInfoCache.get(norm);
  if (item && Date.now() - item.ts < 120000) {
    return item.info;
  }
  return null;
}

function setCachedYtdlpInfo(url, info) {
  const norm = normalizeTargetUrl(url);
  if (!norm || !info) return;
  if (ytInfoCache.size > 50) {
    const firstKey = ytInfoCache.keys().next().value;
    ytInfoCache.delete(firstKey);
  }
  ytInfoCache.set(norm, { info, ts: Date.now() });
}

function findTrackInSubs(subsMap, context) {
  if (!subsMap) return null;
  const subKeys = Object.keys(subsMap);
  if (subKeys.length === 0) return null;

  const isVN = isVietnameseTrack(context);

  if (isVN) {
    const viKey = subKeys.find(k => k === 'vi' || k.startsWith('vi-') || k.startsWith('vi_') || k.startsWith('.vi'));
    if (viKey && subsMap[viKey]?.length) return subsMap[viKey];
    return null;
  }

  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(`${context.rawTitle || ''} ${context.videoTitle || ''}`)) {
    const koKey = subKeys.find(k => k === 'ko' || k.startsWith('ko-') || k.startsWith('ko_'));
    if (koKey && subsMap[koKey]?.length) return subsMap[koKey];
    return null;
  }

  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(`${context.rawTitle || ''} ${context.videoTitle || ''}`)) {
    const jaKey = subKeys.find(k => k === 'ja' || k.startsWith('ja-') || k.startsWith('ja_'));
    if (jaKey && subsMap[jaKey]?.length) return subsMap[jaKey];
    return null;
  }

  if (/[\u4E00-\u9FFF]/.test(`${context.rawTitle || ''} ${context.videoTitle || ''}`)) {
    const zhKey = subKeys.find(k => k === 'zh' || k.startsWith('zh-') || k.startsWith('zh_'));
    if (zhKey && subsMap[zhKey]?.length) return subsMap[zhKey];
    return null;
  }

  // Tiếng Anh (Mặc định cho Pop / US-UK / Quốc tế):
  // BẮT BUỘC chỉ chọn tiếng Anh (en, en-orig, en-US, en-GB, en-CA...).
  // TUYỆT ĐỐI KHÔNG nhận ngôn ngữ dịch khác như tiếng Tây Ban Nha (es), Bồ Đào Nha, Pháp, v.v.
  const enKey = subKeys.find(k => k === 'en' || k === 'en-orig' || k === 'en-US' || k === 'en-GB' || k.startsWith('en-') || k.startsWith('en_') || k.startsWith('.en'));
  if (enKey && subsMap[enKey]?.length) return subsMap[enKey];

  return null;
}

function selectBestSubtitleTrack(officialSubs, autoSubs, context = {}, allowAuto = false) {
  // 1. Ưu tiên số 1: Phụ đề chính thức do kênh / nghệ sĩ tải lên (Official Subtitles)
  const officialTrack = findTrackInSubs(officialSubs, context);
  if (officialTrack) return { track: officialTrack, isOfficial: true };

  // 2. Ưu tiên số 2: Phụ đề tự động (Automatic Captions) - chỉ dùng khi allowAuto = true
  if (allowAuto) {
    const autoTrack = findTrackInSubs(autoSubs, context);
    if (autoTrack) return { track: autoTrack, isOfficial: false };
  }

  return null;
}

/**
 * Trích xuất phụ đề CC chính thức trực tiếp từ YouTube Video (Chuẩn nhịp 100% cho MV có intro/outro)
 */
async function fetchYouTubeSubtitles(url, rawTitle = '', artist = '', allowAuto = false, trackKey = null, userSavedOffsetMs = 0) {
  if (!url || typeof url !== 'string' || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return null;
  }
  try {
    let info = getCachedYtdlpInfo(url);
    if (!info) {
      info = await Promise.race([
        ytdlp(url, {
          dumpSingleJson: true,
          skipDownload: true,
          noWarnings: true,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
      ]);
      if (info) setCachedYtdlpInfo(url, info);
    }

    const context = {
      rawTitle,
      artist,
      videoTitle: info.title || '',
      uploader: info.uploader || info.channel || ''
    };

    const isVN = isVietnameseTrack(context);

    // Ưu tiên phụ đề chính thức (info.subtitles), chỉ dùng auto captions khi allowAuto = true
    const selected = selectBestSubtitleTrack(info.subtitles, info.automatic_captions, context, allowAuto);
    if (!selected || !selected.track || !Array.isArray(selected.track) || selected.track.length === 0) {
      return null;
    }

    const chosenTrackList = selected.track;
    const isOfficial = selected.isOfficial;

    const subTarget = chosenTrackList.find(s => s.ext === 'json3') || chosenTrackList[0];
    if (!subTarget || !subTarget.url) return null;

    let timedtextUrl = subTarget.url;
    if (!timedtextUrl.includes('fmt=json3')) timedtextUrl += '&fmt=json3';

    const res = await fetch(timedtextUrl);
    if (!res.ok) return null;

    const data = await res.json();
    const events = data.events || [];
    const syncedLyrics = [];
    const plainLines = [];

    for (const ev of events) {
      const segs = ev.segs || [];
      let text = segs.map(s => s.utf8 || '').join('').replace(/\r?\n/g, ' ').trim();
      if (!text) continue;

      // Loại bỏ nốt nhạc ♪ ♫ và các ký tự đặc biệt ở đầu/cuối
      const cleaned = text.replace(/^[♪♫\s\-–—]+|[♪♫\s\-–—]+$/g, '').trim();
      if (!cleaned) continue;

      // Bỏ qua các chú thích âm thanh như [Âm nhạc], [Music], (Applause), [Tiếng vỗ tay]...
      if (/^\[[\w\s\u00C0-\u1EF9]+\]$/i.test(cleaned) || /^\([\w\s\u00C0-\u1EF9]+\)$/i.test(cleaned)) continue;

      // Tự động viết hoa chữ cái đầu tiên của câu hát để hiển thị chỉn chu, đẹp mắt
      const capitalized = cleaned.replace(/^([“"‘'(\[]*)(\p{L})/u, (_, p1, p2) => p1 + p2.toUpperCase());

      syncedLyrics.push({
        time: ev.tStartMs || 0,
        text: capitalized
      });
      plainLines.push(capitalized);
    }

    if (syncedLyrics.length >= 5) {
      // Safety net: Nếu bài hát là tiếng Việt nhưng nội dung phụ đề CC trích xuất lại không có bất kỳ chữ tiếng Việt nào
      // (chứng tỏ đây là bản dịch tiếng Anh cho khán giả quốc tế) -> Từ chối và chuyển sang LRCLIB
      if (isVN) {
        const sampleText = plainLines.slice(0, 15).join(' ');
        if (!VIETNAMESE_REGEX.test(sampleText)) {
          console.log(`[Lyrics CC] Bỏ qua phụ đề dịch ngoại ngữ cho bài hát tiếng Việt: ${info.title || rawTitle}`);
          return null;
        }
      }

      console.log(`[Lyrics CC] Đã trích xuất ${syncedLyrics.length} câu phụ đề CC (${isOfficial ? 'Chính thức' : 'Tự động AI'}) từ video YouTube: ${info.title || url}`);
      return {
        title: info.title || 'YouTube Track',
        artist: info.uploader || info.channel || '',
        lyrics: plainLines.join('\n'),
        syncedLyrics,
        duration: info.duration,
        autoOffsetMs: 0,
        trackKey,
        userSavedOffsetMs: userSavedOffsetMs || 0,
        source: isOfficial ? 'youtube_cc' : 'youtube_auto_cc',
        isOfficialCc: isOfficial
      };
    }
  } catch (e) {
    // Không làm gián đoạn luồng chính nếu trích xuất CC lỗi
  }
  return null;
}

/**
 * Tự động tìm mốc bắt đầu hát từ YouTube Captions khi MV có đoạn intro thoại (như phim ngắn 15-45s)
 */
async function detectYouTubeIntroOffset(url, syncedLyrics, targetDurationSec) {
  if (!url || !syncedLyrics || syncedLyrics.length === 0) return 0;
  try {
    let info = getCachedYtdlpInfo(url);
    if (!info) {
      info = await Promise.race([
        ytdlp(url, {
          dumpSingleJson: true,
          skipDownload: true,
          noWarnings: true,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
      ]);
      if (info) setCachedYtdlpInfo(url, info);
    }

    const selected = selectBestSubtitleTrack(info.subtitles || {}, info.automatic_captions || {}, {
      rawTitle: syncedLyrics[0]?.text || '',
      videoTitle: info.title || '',
      uploader: info.uploader || ''
    }, true);
    const track = selected?.track;
    const json3 = track?.find(f => f.ext === 'json3') || track?.[0];
    if (!json3 || !json3.url) return 0;

    let timedtextUrl = json3.url;
    if (!timedtextUrl.includes('fmt=json3')) timedtextUrl += '&fmt=json3';
    const res = await fetch(timedtextUrl);
    if (!res.ok) return 0;
    const data = await res.json();
    const events = data.events || [];
    if (events.length === 0) return 0;

    // Lấy tối đa 5 câu lyric đầu tiên có ý nghĩa (>= 2 từ) để so khớp nhịp
    const candidateLines = syncedLyrics
      .filter(l => l.text && l.text.trim().split(/\s+/).length >= 2)
      .slice(0, 5);

    if (candidateLines.length === 0) return 0;

    // Chỉ tìm trong 50 giây đầu của video để phát hiện đoạn intro skit/nói chuyện của MV, tránh bắt nhầm điệp khúc lặp lại ở giữa bài
    const maxSearchMs = Math.min(50000, targetDurationSec > 0 ? targetDurationSec * 1000 : 50000);
    const searchEvents = events.filter(ev => (ev.tStartMs || 0) <= maxSearchMs && ev.segs && ev.segs.length > 0);

    const detectedOffsets = [];

    for (const targetLine of candidateLines) {
      const targetWords = targetLine.text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .filter(w => w.length >= 2);

      if (targetWords.length < 2) continue;

      let bestMatchTime = null;
      let bestScore = 0;

      for (const ev of searchEvents) {
        const text = (ev.segs || [])
          .map(s => s.utf8 || '')
          .join('')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, '');

        let score = 0;
        for (const w of targetWords) {
          if (text.includes(w)) score++;
        }
        if (score >= 2 && score > bestScore) {
          bestScore = score;
          bestMatchTime = ev.tStartMs;
        }
      }

      if (bestMatchTime !== null && bestScore >= Math.min(2, targetWords.length)) {
        const offset = bestMatchTime - targetLine.time;
        detectedOffsets.push(offset);
      }
    }

    if (detectedOffsets.length > 0) {
      detectedOffsets.sort((a, b) => a - b);
      const medianOffset = detectedOffsets[Math.floor(detectedOffsets.length / 2)];
      // Giới hạn độ lệch intro thực tế: từ -8s đến tối đa +45s (hỗ trợ cả các MV có intro kịch bản thoại dài như Maroon 5 Animals)
      if (Math.abs(medianOffset) >= 600 && medianOffset >= -8000 && medianOffset <= 45000) {
        console.log(`[Lyrics Auto-Offset] Phát hiện lệch nhịp intro/outro MV dài ${(medianOffset / 1000).toFixed(2)}s, đã tự động căn nhịp!`);
        return medianOffset;
      }
    }
  } catch (e) {}
  return 0;
}

async function buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey = null, userSavedOffsetMs = 0) {
  const cleanLyrics = match.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
  const parsed = parseLrc(match.syncedLyrics);
  let autoOffsetMs = 0;

  // Nếu bài đang phát từ link YouTube:
  // Tự động tìm mốc bắt đầu hát từ YouTube Captions để căn chỉnh nhịp chuẩn 100% với video!
  if (targetUrl && (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) && targetDurationSec > 0) {
    const detectedOffset = await detectYouTubeIntroOffset(targetUrl, parsed, targetDurationSec);
    if (detectedOffset !== 0) {
      for (const line of parsed) {
        line.time += detectedOffset;
      }
      autoOffsetMs = detectedOffset;
    }
  }

  const isYt = Boolean(targetUrl && (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')));
  const lrclibResult = {
    title: match.trackName || rawTitle,
    artist: match.artistName || artist || '',
    lyrics: cleanLyrics,
    syncedLyrics: parsed,
    duration: match.duration,
    autoOffsetMs,
    trackKey,
    userSavedOffsetMs: userSavedOffsetMs || 0,
    source: 'lrclib',
    hasTriedCc: isYt
  };
  setCachedLyrics(cacheKey, lrclibResult);
  return lrclibResult;
}

function normalizeTargetUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch) {
    return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  }
  return url.trim();
}

/**
 * Lấy lời bài hát chuẩn xác từ YouTube CC hoặc LRCLIB (Spotify / Apple Music database)
 */
async function fetchLyrics(rawTitle, artist = '', durationMs = 0, targetUrl = null) {
  if (!rawTitle) return null;

  const normalizedUrl = normalizeTargetUrl(targetUrl);
  const cacheKey = normalizedUrl || `${rawTitle.trim()}_${(artist || '').trim()}_${durationMs || 0}`;
  const isYouTube = Boolean(normalizedUrl && (normalizedUrl.includes('youtube.com') || normalizedUrl.includes('youtu.be')));

  const trackKey = generateTrackKey(rawTitle, artist, normalizedUrl);
  const fallbackKey = generateTrackKey(rawTitle, artist, null);
  const userSavedOffsetMs = await getSavedLyricOffset(trackKey, fallbackKey);

  const cached = getCachedLyrics(cacheKey);
  if (cached) {
    if (!isYouTube || cached.source === 'youtube_cc' || cached.isLofi || cached.hasTriedCc) {
      return {
        ...cached,
        trackKey,
        userSavedOffsetMs: (userSavedOffsetMs !== undefined && userSavedOffsetMs !== null) ? userSavedOffsetMs : (cached.userSavedOffsetMs || 0)
      };
    }
  }

  // Lofi / Chill / Instrumental check
  const lowerTitle = rawTitle.toLowerCase();
  if (lowerTitle.includes('lofi') || lowerTitle.includes('lo-fi') || lowerTitle.includes('chillhop') || lowerTitle.includes('beats to') || lowerTitle.includes('không lời') || lowerTitle.includes('instrumental') || lowerTitle.includes('jazz hip-hop') || lowerTitle.includes('coffee shop')) {
    const lofiResult = {
      title: rawTitle,
      artist: artist || 'Lofi Chill',
      isLofi: true,
      lyrics: 'Bản nhạc Lofi tự động không lời ☕',
      syncedLyrics: null,
      trackKey,
      userSavedOffsetMs: 0
    };
    setCachedLyrics(cacheKey, lofiResult);
    return lofiResult;
  }

  // 1. TẦNG 1: Ưu tiên phụ đề YouTube CC trực tiếp nếu phát từ link YouTube
  // Đối với MV ca nhạc (như Starboy, Nơi Này Có Anh...), video thường có đoạn phim intro/outro dài 20-50s.
  // Phụ đề CC do kênh/nghệ sĩ gắn trực tiếp trên YouTube sẽ chuẩn nhịp 100% theo đúng video mà không bị lệch.
  if (isYouTube) {
    try {
      const ytSubPromise = fetchYouTubeSubtitles(normalizedUrl, rawTitle, artist, false, trackKey, userSavedOffsetMs);
      const ytSubResult = await Promise.race([
        ytSubPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 15000))
      ]);
      if (ytSubResult && ytSubResult.syncedLyrics && ytSubResult.syncedLyrics.length >= 5) {
        setCachedLyrics(cacheKey, ytSubResult);
        return ytSubResult;
      }
    } catch (ytSubErr) {}
  }

  // 2. TẦNG 2: Tìm kiếm LRCLIB (Spotify / Apple Music database) nếu không có CC
  const variants = generateSearchVariants(rawTitle, artist);
  const targetDurationSec = durationMs ? durationMs / 1000 : 0;
  let plainFallback = null;

  for (const item of variants) {
    try {
      // 2.1 Direct GET if track & artist are isolated
      if (item.track && item.artist) {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(item.track)}&artist_name=${encodeURIComponent(item.artist)}`;
        const res = await fetch(getUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' }
        });
        if (res.ok) {
          const match = await res.json();
          if (match && (match.plainLyrics || match.syncedLyrics)) {
            if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
              const firstLineMs = getFirstLineTimestampMs(match.syncedLyrics);
              const isLateStart = firstLineMs > 25000;
              const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
              const isMvMismatch = isLateStart && durDiff > 8;

              if (!isMvMismatch) {
                if (match.syncedLyrics && match.syncedLyrics.trim().length > 10) {
                  return await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs);
                } else if (!plainFallback && match.plainLyrics) {
                  plainFallback = {
                    title: match.trackName || rawTitle,
                    artist: match.artistName || artist || '',
                    lyrics: match.plainLyrics.trim(),
                    syncedLyrics: null,
                    duration: match.duration,
                    autoOffsetMs: 0,
                    trackKey,
                    userSavedOffsetMs: userSavedOffsetMs || 0
                  };
                }
              }
            }
          }
        }
      }

      // 2. SEARCH endpoint if direct get fails or query string given
      const queryStr = item.q || `${item.track || ''} ${item.artist || ''}`.trim();
      if (queryStr) {
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(queryStr)}`;
        const res = await fetch(searchUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' }
        });

        if (res.ok) {
          const data = await res.json();
          let results = Array.isArray(data) ? data : [data];
          if (results.length > 0) {
            // Sắp xếp kết quả:
            // 1. Ưu tiên bài hợp lệ cả tên lẫn ca sĩ (isValidMatch)
            // 2. Ưu tiên bài KHÔNG BỊ TRỄ INTRO (>25s) nếu đối chiếu với audio thông thường
            // 3. Khi có targetDurationSec > 0: ưu tiên |match.duration - targetDurationSec| <= 8s lên trước
            results.sort((a, b) => {
              const aValid = isValidMatch(a, item.expectedTrack || item.track, item.expectedArtist || item.artist);
              const bValid = isValidMatch(b, item.expectedTrack || item.track, item.expectedArtist || item.artist);
              if (aValid && !bValid) return -1;
              if (!aValid && bValid) return 1;

              const aFirstLine = getFirstLineTimestampMs(a.syncedLyrics);
              const bFirstLine = getFirstLineTimestampMs(b.syncedLyrics);
              const aLate = aFirstLine > 25000;
              const bLate = bFirstLine > 25000;

              if (targetDurationSec > 0) {
                const aDiff = typeof a.duration === 'number' ? Math.abs(a.duration - targetDurationSec) : 9999;
                const bDiff = typeof b.duration === 'number' ? Math.abs(b.duration - targetDurationSec) : 9999;

                // Nếu cả hai bản đều gần thời lượng (<= 8s), ưu tiên bản không trễ intro
                if (aDiff <= 8 && bDiff <= 8) {
                  if (!aLate && bLate) return -1;
                  if (aLate && !bLate) return 1;
                }
                return aDiff - bDiff;
              } else {
                if (!aLate && bLate) return -1;
                if (aLate && !bLate) return 1;
              }

              return 0;
            });

            for (const match of results) {
              const hasSynced = Boolean(match?.syncedLyrics && match.syncedLyrics.trim().length > 10);
              const hasPlain = Boolean(match?.plainLyrics && match.plainLyrics.trim().length > 10);

              if (hasSynced || hasPlain) {
                if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                  const firstLineMs = getFirstLineTimestampMs(match.syncedLyrics);
                  const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
                  // Nếu câu đầu tiên > 25s trong khi thời lượng bị lệch > 8s, bỏ qua bản MV để tìm bản studio phía sau
                  if (firstLineMs > 25000 && durDiff > 8) {
                    continue;
                  }

                  if (hasSynced) {
                    return await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs);
                  } else if (!plainFallback && hasPlain) {
                    plainFallback = {
                      title: match.trackName || rawTitle,
                      artist: match.artistName || artist || '',
                      lyrics: match.plainLyrics.trim(),
                      syncedLyrics: null,
                      duration: match.duration,
                      autoOffsetMs: 0,
                      trackKey,
                      userSavedOffsetMs: userSavedOffsetMs || 0,
                      source: 'lrclib'
                    };
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  // 2.8 Nếu là YouTube và LRCLIB chưa tìm thấy synced lyrics: Thử trích xuất YouTube Auto CC trước khi nhận plain lyrics
  if (isYouTube) {
    try {
      const autoCcResult = await fetchYouTubeSubtitles(normalizedUrl, rawTitle, artist, true, trackKey, userSavedOffsetMs);
      if (autoCcResult && autoCcResult.syncedLyrics && autoCcResult.syncedLyrics.length >= 5) {
        setCachedLyrics(cacheKey, autoCcResult);
        return autoCcResult;
      }
    } catch (e) {}
  }

  // 2.9 Nếu LRCLIB có bản lyric đọc (plain lyrics) thì dùng trước khi sang microservice/AI
  if (plainFallback) {
    setCachedLyrics(cacheKey, plainFallback);
    return plainFallback;
  }

  // 3. TẦNG 3: Fallback qua microservice Python (syncedlyrics đa nguồn: Musixmatch, NetEase...) nếu LRCLIB không tìm thấy
  const fallbackResult = await fetchLyricsFallback(rawTitle, artist, durationMs);
  if (fallbackResult) {
    fallbackResult.trackKey = trackKey;
    fallbackResult.userSavedOffsetMs = userSavedOffsetMs || 0;
    setCachedLyrics(cacheKey, fallbackResult);
    return fallbackResult;
  }

  // 4. TẦNG 4: ĐỐI VỚI NHẠC KHÔNG PHẢI YOUTUBE (Spotify, SoundCloud, tìm theo tên...):
  // Nếu các kho lời chuẩn (LRCLIB, Syncedlyrics) đều không có, lúc này mới đi tìm video trên YouTube
  // để trích xuất phụ đề CC làm cứu cánh trước khi gọi AI.
  if (!isYouTube) {
    try {
      const searchQuery = `${cleanTitle(rawTitle)} ${cleanArtistName(artist)}`.trim();
      if (searchQuery) {
        const yts = require('yt-search');
        const ytSearchPromise = (async () => {
          const sRes = await yts(searchQuery);
          const topVideo = sRes?.videos?.[0];
          if (topVideo && topVideo.url) {
            return await fetchYouTubeSubtitles(topVideo.url, rawTitle, artist, true, trackKey, userSavedOffsetMs);
          }
          return null;
        })();

        const ytSearchResult = await Promise.race([
          ytSearchPromise,
          new Promise(resolve => setTimeout(() => resolve(null), 8000))
        ]);

        if (ytSearchResult && ytSearchResult.syncedLyrics && ytSearchResult.syncedLyrics.length >= 5) {
          setCachedLyrics(cacheKey, ytSearchResult);
          return ytSearchResult;
        }
      }
    } catch (ytSearchErr) {}
  }

  // Không sử dụng Gemini AI để đoán lời bài hát nữa theo yêu cầu
  return null;
}

/**
 * Microservice fallback đa nguồn qua Python syncedlyrics (Musixmatch, NetEase, Genius...)
 */
async function fetchLyricsFallback(rawTitle, artist = '', durationMs = 0) {
  const fallbackBaseUrl = process.env.LYRICS_FALLBACK_URL || 'http://127.0.0.1:8787/lyrics';
  try {
    const primaryClean = stripParentheses(cleanTitle(rawTitle));
    const targetDurationSec = durationMs ? Math.floor(durationMs / 1000) : 0;
    let cleanArt = cleanArtistName(artist);

    // Tách tên bài và ca sĩ nếu tiêu đề có dấu phân cách (ví dụ "DONALD GOLD - ADAMN" hoặc "Bước Qua Nhau / Vũ.")
    let cleanTitleOnly = primaryClean;
    const segs = primaryClean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).filter(Boolean);
    if (segs.length >= 2) {
      const s0 = segs[0].trim();
      const s1 = segs[1].trim();
      const normArt = cleanArt ? normalizeStr(cleanArt) : '';
      const s0IsArt = normArt && (normalizeStr(s0).includes(normArt) || normArt.includes(normalizeStr(s0)));
      const s1IsArt = normArt && (normalizeStr(s1).includes(normArt) || normArt.includes(normalizeStr(s1)));

      if (s0IsArt) {
        // segs[0] là ca sĩ (vd "DONALD GOLD - ADAMN"), segs[1] là tên bài hát
        cleanTitleOnly = s1;
        cleanArt = cleanArtistName(s0);
      } else if (s1IsArt) {
        // segs[1] là ca sĩ (vd "ADAMN - DONALD GOLD"), segs[0] là tên bài hát
        cleanTitleOnly = s0;
        cleanArt = cleanArtistName(s1);
      } else {
        const feat2 = splitFeat(s1);
        if (feat2) {
          cleanTitleOnly = feat2.titlePart;
          if (!cleanArt || cleanArt === 'Unknown') {
            cleanArt = cleanArtistName(s0);
          }
        } else {
          cleanTitleOnly = s0;
          if (!cleanArt || cleanArt === 'Unknown') {
            cleanArt = cleanArtistName(s1);
          }
        }
      }
    }

    const url = new URL(fallbackBaseUrl);
    url.searchParams.set('title', cleanTitleOnly);
    if (cleanArt && cleanArt !== 'Unknown') {
      url.searchParams.set('artist', cleanArt);
    }
    if (targetDurationSec > 0) {
      url.searchParams.set('duration', String(targetDurationSec));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && (data.syncedLyrics || data.plainLyrics)) {
        const plain = data.plainLyrics || (Array.isArray(data.syncedLyrics) ? data.syncedLyrics.map(l => l.text).join('\n') : '');
        return {
          title: rawTitle,
          artist: artist || '',
          lyrics: plain.trim(),
          syncedLyrics: Array.isArray(data.syncedLyrics) && data.syncedLyrics.length > 0 ? data.syncedLyrics : null,
          duration: targetDurationSec || null,
          autoOffsetMs: 0
        };
      }
    }
  } catch (e) {
    // An toàn: không bao giờ làm crash bot chính nếu microservice offline hoặc timeout
  }
  return null;
}

module.exports = {
  cleanSearchVariants: generateSearchVariants,
  fetchLyrics,
  fetchLyricsFallback,
  getLyrics: fetchLyrics,
  generateTrackKey,
  saveLyricOffset,
  getSavedLyricOffset
};
