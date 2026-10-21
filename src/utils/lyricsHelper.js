const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');

// Bộ đệm RAM lưu sẵn danh sách phụ đề CC trích xuất từ yt-dlp lúc tải bài
const youtubeSubtitlesMetaCache = new Map();
const MAX_YT_SUB_META_CACHE = 150;

function cacheYoutubeSubtitlesMeta(videoId, subtitles, automaticCaptions) {
  if (!videoId || (!subtitles && !automaticCaptions)) return;
  while (youtubeSubtitlesMetaCache.size >= MAX_YT_SUB_META_CACHE) {
    const firstKey = youtubeSubtitlesMetaCache.keys().next().value;
    if (firstKey !== undefined) youtubeSubtitlesMetaCache.delete(firstKey);
    else break;
  }
  youtubeSubtitlesMetaCache.set(String(videoId), {
    subtitles: subtitles || {},
    automaticCaptions: automaticCaptions || {},
    ts: Date.now()
  });
}

/**
 * Kiểm tra xem nội dung lời bài hát có bị nhiễm mã CSS (BetterLyrics theme rác từ LRCLIB) hoặc mã HTML hay không
 */
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

function isSafeYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.startsWith('-')) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const allowedHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
    return allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return m ? m[1] : null;
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
    .replace(/\[.*?\]|【.*?】/g, ' ')
    .trim();
  s = s.replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
  s = s.replace(/\((?:piano|acoustic|live|remix|official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat|feat\.?|ft\.?|version|ver|catena|vinahouse|sped\s*up|slowed|reverb|cover).*?\)/gi, ' ');
  s = s.replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official)/gi, ' ');
  s = s.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, ' ');
  s = s.replace(/4k|hd|1080p/gi, ' ');
  s = s.replace(/(?:^|\s)(?:feat\.?|ft\.?)\s+[^-–—|()\[\]]+/gi, ' ');
  s = s.replace(/\s*[-|:/\\–—]\s*$/g, '').trim();
  s = s.replace(/^\s*[-|:/\\–—]\s*/g, '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const TECHNICAL_PAREN_REGEX = /^(?:official(?:\s+(?:music\s+)?video|\s+mv|\s+audio|\s+lyric(?:s)?)?|mv|audio|video|lyrics?|remix|live(?:\s+session)?|prod\.?(?:\s+by\s+[\w\d_]+)?|feat\.?|ft\.?|beat|karaoke|4k|hd|mp3|full(?:\s+audio|\s+mv)?|teaser|trailer|acoustic(?:\s+version)?|cover)$/i;

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

function generateSearchVariants(rawTitle, rawArtist = '') {
  if (!rawTitle) return [];

  const queries = [];
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

  // Trích xuất các tên bài hát trong ngoặc không phải metadata kỹ thuật (ví dụ: (THẰNG ĐIÊN))
  const parenTitles = extractParentheticalTitles(rawTitle);
  for (const pt of parenTitles) {
    const cleanPt = cleanTitle(pt);
    if (cleanPt && !titlesToProcess.includes(cleanPt)) {
      // Ưu tiên cao nhất: tên trong ngoặc thường là tên tiếng Việt chính xác của bài
      titlesToProcess.unshift(cleanPt);
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

        // Nếu expectedTrack chỉ có 1 hoặc 2 từ (ví dụ: 'thang dien')
        if (eWords.length <= 2) {
          return eWords.every(w => cWords.includes(w) || cand.includes(w));
        }

        // Nếu từ 3 từ trở lên, chỉ cần khớp ít nhất 70% số từ
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
    const eWords = eTrack.split(' ').filter(w => w.length >= 2);
    const isFullTrackExact = candidateTrackNorms.some(cand => {
      if (!cand) return false;
      if (cand === eTrack) return true;
      if (eWords.length >= 2 && eWords.every(w => cand.includes(w))) return true;
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

// Bộ nhớ đệm lời bài hát (In-memory cache)
const lyricsMemoryCache = new Map();
const MAX_LYRICS_CACHE = 200;
const inFlightLyrics = new Map();

let LyricOffset = null;
try {
  LyricOffset = require('../database/models/LyricOffset');
} catch (e) {}

const lyricOffsetsMemoryCache = new Map();
function setLyricOffsetsMemoryCache(key, val) {
  if (lyricOffsetsMemoryCache.size >= 300) {
    const oldest = lyricOffsetsMemoryCache.keys().next().value;
    if (oldest !== undefined) lyricOffsetsMemoryCache.delete(oldest);
  }
  Map.prototype.set.call(lyricOffsetsMemoryCache, key, val);
}

function generateTrackKey(title, artist = '', targetUrl = null) {
  const vid = extractVideoId(targetUrl);
  if (vid) return `yt_${vid}`;
  const cleanT = normalizeStr(cleanTitle(title));
  const cleanA = normalizeStr(cleanArtistName(artist));
  return `song_${cleanT}_${cleanA}`.replace(/\s+/g, '_').slice(0, 100);
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
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return 0;

    let doc = await LyricOffset.findOne({ trackKey }).lean().exec();
    if (!doc && fallbackKey) {
      doc = await LyricOffset.findOne({ trackKey: fallbackKey }).lean().exec();
    }
    const offset = (doc && typeof doc.offsetMs === 'number') ? doc.offsetMs : 0;
    setLyricOffsetsMemoryCache(trackKey, offset);
    return offset;
  } catch (e) {
    return 0;
  }
}

async function saveLyricOffset(trackKey, offsetMs, title = '', artist = '') {
  if (!trackKey) return;
  const numOffset = Math.round(Number(offsetMs) || 0);
  setLyricOffsetsMemoryCache(trackKey, numOffset);

  // Cập nhật trực tiếp vào lyricsMemoryCache nếu bài hát đang được cache
  for (const [, entry] of lyricsMemoryCache.entries()) {
    if (entry?.data && entry.data.trackKey === trackKey) {
      entry.data.userSavedOffsetMs = numOffset;
    }
  }

  if (!LyricOffset) return;
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return;

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
  const ttl = item.data?.notFound ? (10 * 60 * 1000) : (3600 * 1000);
  if (Date.now() - item.ts > ttl) {
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
  'richie', 'icy', 'vpop', 'v-pop', 'nhac viet', 'nhạc việt'
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

// ── BỘ TRÍCH XUẤT METADATA & SUBTITLES YOUTUBE ĐA TẦNG SIÊU NHẸ (0% CPU CHO VPS 1 CORE) ──
const ytInfoCache = new Map();
const inFlightYtInfo = new Map();

function getYouTubeCookieHeader() {
  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(__dirname, '../../youtube.cookies'),
    path.resolve(process.cwd(), 'youtube.cookies'),
    '/root/anna-music-bot/youtube.cookies'
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const pairs = [];
        for (const line of raw.split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          const cols = line.split('\t');
          if (cols.length >= 7 && cols[0].includes('youtube.com')) {
            pairs.push(`${cols[5]}=${cols[6]}`);
          }
        }
        if (pairs.length > 0) {
          return `CONSENT=YES+cb; PREF=hl=vi&gl=VN; ${pairs.slice(0, 40).join('; ')}`;
        }
      }
    } catch (e) {}
  }
  return 'CONSENT=YES+cb; PREF=hl=vi&gl=VN';
}

/**
 * Cắt chuỗi JSON của ytInitialPlayerResponse từ HTML trang Watch bằng thuật toán đếm ngoặc (< 1ms CPU)
 */
function extractJsonAssignedToVar(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const startBrace = html.indexOf('{', idx + marker.length);
  if (startBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startBrace; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(startBrace, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function buildParsedPlayerInfo(data) {
  if (!data || typeof data !== 'object') return null;
  const details = data.videoDetails || {};
  const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  const subtitles = {};
  const autoCaptions = {};

  for (const cap of captions) {
    if (!cap || !cap.baseUrl) continue;
    const lang = cap.languageCode || 'und';
    const vssId = String(cap.vssId || '');
    const isAuto = cap.kind === 'asr' || vssId.startsWith('a.');
    const nameText = cap.name?.runs?.map(r => r.text).join('') || cap.name?.simpleText || lang;

    const entry = [
      {
        ext: 'json3',
        url: cap.baseUrl + (cap.baseUrl.includes('?') ? '&fmt=json3' : '?fmt=json3'),
        rawUrl: cap.baseUrl,
        name: nameText,
        vssId
      }
    ];

    // Tránh ghi đè nếu có nhiều track cùng languageCode
    const targetMap = isAuto ? autoCaptions : subtitles;
    const key = targetMap[lang] ? `${lang}_${vssId || Object.keys(targetMap).length}` : lang;
    targetMap[key] = entry;
  }

  return {
    title: details.title || '',
    uploader: details.author || '',
    channel: details.author || '',
    duration: details.lengthSeconds ? parseInt(details.lengthSeconds, 10) : 0,
    description: details.shortDescription || '',
    subtitles,
    automatic_captions: autoCaptions,
    hasCaptions: captions.length > 0
  };
}

function setCachedYtdlpInfo(url, info) {
  const norm = normalizeTargetUrl(url);
  if (!norm || !info) return;
  if (ytInfoCache.size > 80) {
    const firstKey = ytInfoCache.keys().next().value;
    ytInfoCache.delete(firstKey);
  }
  ytInfoCache.set(norm, { info, ts: Date.now() });
}

async function fetchYtdlpInfo(url) {
  if (!isSafeYouTubeUrl(url)) return null;
  const norm = normalizeTargetUrl(url);
  if (!norm) return null;

  const cachedItem = ytInfoCache.get(norm);
  if (cachedItem && Date.now() - cachedItem.ts < 300000) {
    return cachedItem.info?._empty ? null : cachedItem.info;
  }

  if (inFlightYtInfo.has(norm)) {
    return await inFlightYtInfo.get(norm);
  }

  const p = _executeFetchYtdlpInfo(url, norm);
  inFlightYtInfo.set(norm, p);
  try {
    return await p;
  } finally {
    inFlightYtInfo.delete(norm);
  }
}

async function _executeFetchYtdlpInfo(url, norm) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  let bestPartialInfo = null;
  const cookieHeader = getYouTubeCookieHeader();

  // ── PHƯƠNG PHÁP 1: Tải trực tiếp Watch Page HTML & bóc ytInitialPlayerResponse (~150ms, không bị UNPLAYABLE) ──
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=vi&gl=VN&bpctr=9999999999&has_verified=1`;
    const res = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': cookieHeader
      },
      signal: AbortSignal.timeout(3500)
    });

    if (res.ok) {
      const html = await res.text();
      const playerResponse =
        extractJsonAssignedToVar(html, 'var ytInitialPlayerResponse =') ||
        extractJsonAssignedToVar(html, 'ytInitialPlayerResponse =') ||
        extractJsonAssignedToVar(html, 'window["ytInitialPlayerResponse"] =');

      const parsed = buildParsedPlayerInfo(playerResponse);
      if (parsed) {
        if (parsed.hasCaptions) {
          setCachedYtdlpInfo(url, parsed);
          return parsed;
        }
        if (parsed.title || parsed.duration > 0) {
          bestPartialInfo = parsed;
        }
      }
    }
  } catch (watchErr) {}

  // ── PHƯƠNG PHÁP 2: InnerTube Multi-Client (IOS / WEB_REMIX / TVHTML5_SIMPLY_EMBEDDED_PLAYER) ──
  const innerTubeClients = [
    {
      name: 'IOS',
      version: '19.45.4',
      ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
      extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83' }
    },
    {
      name: 'WEB_REMIX',
      version: '1.20241118.01.00',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extra: {}
    },
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      version: '2.0',
      ua: 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
      extra: {}
    }
  ];

  for (const clientCfg of innerTubeClients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': clientCfg.ua,
          'Cookie': cookieHeader
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: clientCfg.name,
              clientVersion: clientCfg.version,
              hl: 'vi',
              gl: 'VN',
              ...clientCfg.extra
            },
            thirdParty: {
              embedUrl: 'https://www.youtube.com/'
            }
          }
        }),
        signal: AbortSignal.timeout(2500)
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = buildParsedPlayerInfo(data);
        if (parsed) {
          if (parsed.hasCaptions) {
            if (!parsed.description && bestPartialInfo?.description) {
              parsed.description = bestPartialInfo.description;
            }
            setCachedYtdlpInfo(url, parsed);
            return parsed;
          }
          if (!bestPartialInfo && (parsed.title || parsed.duration > 0)) {
            bestPartialInfo = parsed;
          }
        }
      }
    } catch (clientErr) {}
  }

  // ── PHƯƠNG PHÁP 3: @distube/ytdl-core (Chạy trực tiếp trong tiến trình Node.js, không tốn CPU spawn) ──
  try {
    const ytdl = require('@distube/ytdl-core');
    const info = await Promise.race([
      ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${videoId}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ytdl timeout')), 3000))
    ]);
    const pr = info?.player_response;
    const parsed = buildParsedPlayerInfo(pr);
    if (parsed) {
      if (parsed.hasCaptions) {
        setCachedYtdlpInfo(url, parsed);
        return parsed;
      }
      if (!bestPartialInfo && (parsed.title || parsed.duration > 0)) {
        bestPartialInfo = parsed;
      }
    }
  } catch (ytdlErr) {}

  if (bestPartialInfo) {
    setCachedYtdlpInfo(url, bestPartialInfo);
    return bestPartialInfo;
  }

  setCachedYtdlpInfo(url, { _empty: true });
  return null;
}

/**
 * Sắp xếp danh sách các track phụ đề theo thứ tự ưu tiên phù hợp với ngữ cảnh bài hát
 */
function getRankedSubtitleTracks(subsMap, context = {}) {
  if (!subsMap || typeof subsMap !== 'object') return [];
  const entries = Object.entries(subsMap).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
  if (entries.length === 0) return [];

  const isVN = isVietnameseTrack(context);
  const fullContextStr = `${context.rawTitle || ''} ${context.videoTitle || ''} ${context.artist || ''} ${context.uploader || ''}`;
  const isKR = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(fullContextStr);
  const isJP = /[\u3040-\u309F\u30A0-\u30FF]/.test(fullContextStr);
  const isCN = /[\u4E00-\u9FFF]/.test(fullContextStr);

  const scored = entries.map(([key, trackArr]) => {
    const track = trackArr[0];
    const kLow = key.toLowerCase();
    const nameLow = String(track?.name || '').toLowerCase();
    let score = 0;

    // Tránh các bản dịch tự động sang ngôn ngữ khác (vssId có dạng .t.)
    if (track?.vssId && track.vssId.includes('.t.')) {
      score -= 50;
    }

    if (isVN) {
      if (kLow === 'vi' || kLow.startsWith('vi-') || kLow.startsWith('vi_')) score += 100;
      else if (/tiếng việt|vietnamese|việt|viet/i.test(nameLow)) score += 95;
      else if (kLow.startsWith('und')) score += 60;
      else if (kLow.startsWith('en')) score += 30; // Nhiều MV Việt tải lời tiếng Việt vào slot 'en' mặc định
      else score -= 50;
    } else if (isKR) {
      if (kLow.startsWith('ko')) score += 100;
      else if (kLow.startsWith('en')) score += 40;
      else score -= 50;
    } else if (isJP) {
      if (kLow.startsWith('ja')) score += 100;
      else if (kLow.startsWith('en')) score += 40;
      else score -= 50;
    } else if (isCN) {
      if (kLow.startsWith('zh')) score += 100;
      else if (kLow.startsWith('en')) score += 40;
      else score -= 50;
    } else {
      if (kLow === 'en' || kLow === 'en-orig' || kLow.startsWith('en-') || kLow.startsWith('en_')) score += 100;
      else if (kLow.startsWith('und')) score += 60;
      else if (kLow.startsWith('vi')) score += 40;
      else if (['ja', 'ko', 'zh', 'ar', 'ru', 'th', 'hi'].some(l => kLow.startsWith(l))) score -= 50;
      else score += 10;
    }

    return { key, trackArr, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).map(s => s.trackArr);
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function buildCaptionFormatUrl(rawUrl, fmt = 'json3') {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('exp'); // Loại bỏ cờ thử nghiệm exp=xpe gây ra phản hồi 0 byte rỗng từ YouTube
    u.searchParams.set('fmt', fmt);
    return u.toString();
  } catch (e) {
    const clean = rawUrl
      .replace(/([?&])exp=[^&]+/g, '$1')
      .replace(/([?&])fmt=[^&]+/g, '$1')
      .replace(/[?&]&+/g, '?')
      .replace(/\?$/, '');
    return clean + (clean.includes('?') ? `&fmt=${fmt}` : `?fmt=${fmt}`);
  }
}

/**
 * Tải và phân tích nội dung phụ đề từ URL (Hỗ trợ cả định dạng JSON3 và XML/SRV3 fallback)
 */
async function downloadAndParseCaptionEvents(subTarget) {
  if (!subTarget || (!subTarget.url && !subTarget.rawUrl)) return [];
  const rawUrl = subTarget.rawUrl || subTarget.url;
  const json3Url = buildCaptionFormatUrl(rawUrl, 'json3');

  // Thử trực tiếp URL định dạng JSON3 (ưu tiên subTarget.url nếu đã có fmt=json3 chuẩn từ yt-dlp)
  const candidateUrls = [
    subTarget.url,
    json3Url
  ].filter((u, idx, arr) => u && arr.indexOf(u) === idx);

  for (const targetUrl of candidateUrls) {
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          if (Array.isArray(data.events) && data.events.length > 0) {
            return data.events;
          }
        }
      }
    } catch (e) {}
  }

  // 2. Fallback sang định dạng XML (fmt=srv3 hoặc raw) (<text start="12.34" dur="3.2"> hoặc <p t="12340" d="3200">)
  const xmlFallbackUrls = [
    buildCaptionFormatUrl(rawUrl, 'srv3'),
    rawUrl
  ];

  for (const xmlUrl of xmlFallbackUrls) {
    try {
      const res = await fetch(xmlUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const xml = await res.text();
        const events = [];

        // Định dạng 1: <text start="12.34" dur="3.21">...</text>
        const textRegex = /<text\s+[^>]*start="([\d.]+)"[^>]*?(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
        let m;
        while ((m = textRegex.exec(xml)) !== null) {
          const startMs = Math.round(parseFloat(m[1]) * 1000);
          const durMs = m[2] ? Math.round(parseFloat(m[2]) * 1000) : 3000;
          const content = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '')).trim();
          if (content) {
            events.push({
              tStartMs: startMs,
              dDurationMs: durMs,
              segs: [{ utf8: content, tOffsetMs: 0 }]
            });
          }
        }

        // Định dạng 2: <p t="12340" d="3210">...</p>
        if (events.length === 0) {
          const pRegex = /<p\s+[^>]*t="(\d+)"[^>]*?(?:d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/gi;
          while ((m = pRegex.exec(xml)) !== null) {
            const startMs = parseInt(m[1], 10);
            const durMs = m[2] ? parseInt(m[2], 10) : 3000;
            const content = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '')).trim();
            if (content) {
              events.push({
                tStartMs: startMs,
                dDurationMs: durMs,
                segs: [{ utf8: content, tOffsetMs: 0 }]
              });
            }
          }
        }

        if (events.length > 0) {
          return events;
        }
      }
    } catch (e) {}
  }

  return [];
}

/**
 * Làm sạch và chuẩn hóa các dòng phụ đề CC thành mảng Synced Lyrics chuẩn Karaoke
 */
function convertEventsToSyncedLyrics(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return { syncedLyrics: [], plainLines: [] };
  }

  const syncedLyrics = [];
  const plainLines = [];
  const creditNoiseRegex = /^(?:composer|executive producer|music producer|arranged by|mix\s*&?\s*master|director|starring|cast|subtitles?\s*by|caption(?:s|ed)?\s*by|transcribed\s*by|synced\s*by|sáng tác|nhạc sĩ|đạo diễn|diễn viên|phối khí|hòa âm|thu âm|bản quyền|℗|©)\b/i;

  for (const ev of events) {
    const segs = ev.segs || [];
    const rawText = segs.map(s => s.utf8 || '').join('').trim();
    if (!rawText) continue;

    const firstWordSeg = segs.find(s => s && s.utf8 && s.utf8.trim().length > 0);
      const startMs = Number(ev.tStartMs || 0) + Number(firstWordSeg?.tOffsetMs || 0);
    const durMs = Number(ev.dDurationMs || 3500);

    // Tách các dòng nếu 1 caption event gộp 2 câu hát cách nhau bởi dấu xuống dòng
    const subLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const validSubLines = [];

    for (const subLine of subLines) {
      const cleaned = subLine.replace(/^[♪♫♬\s\-–—]+|[♪♫♬\s\-–—]+$/g, '').trim();
      if (!cleaned) continue;
      // Bỏ qua chú thích âm thanh [Âm nhạc], [Music], (Tiếng vỗ tay), [Tiếng cười]...
      if (/^\[[\p{L}\p{N}\s.,!&'-]+\]$/u.test(cleaned) || /^\([\p{L}\p{N}\s.,!&'-]+\)$/u.test(cleaned)) {
        if (/\b(?:âm\s*nhạc|nhạc|tiếng\s*vỗ\s*tay|tiếng\s*cười|tiếng\s*hò\s*reo|music|applause|laughter|intro|outro|lời\s*bài\s*hát|subtitles?|caption)\b/i.test(cleaned)) {
          continue;
        }
      }
      // Bỏ qua dòng credit đầu/cuối MV
      if (creditNoiseRegex.test(cleaned)) {
        continue;
      }
      const capitalized = cleaned.replace(/^([“"‘'(\[]*)(\p{L})/u, (_, p1, p2) => p1 + p2.toUpperCase());
      validSubLines.push(capitalized);
    }

    if (validSubLines.length === 0) continue;

    if (validSubLines.length === 1) {
      const lineText = validSubLines[0];
      const prev = syncedLyrics[syncedLyrics.length - 1];
      // Khử trùng lặp nếu 2 event liên tiếp trùng nội dung sát giờ nhau
      if (prev && prev.text === lineText && Math.abs(startMs - prev.time) < 1500) {
        continue;
      }
      syncedLyrics.push({ time: startMs, text: lineText });
      plainLines.push(lineText);
    } else {
      // Nếu 1 khối CC chứa 2-3 câu hát và kéo dài >= 3.2s, chia đều thời gian theo độ dài câu để chạy Karaoke mượt
      const totalChars = validSubLines.reduce((acc, l) => acc + l.length, 0) || 1;
      let accumulatedMs = startMs;
      const effectiveSpanMs = Math.min(Math.max(durMs, 2400), 9000);

      for (let i = 0; i < validSubLines.length; i++) {
        const lineText = validSubLines[i];
        const lineTime = i === 0 ? startMs : Math.round(accumulatedMs);
        const weight = lineText.length / totalChars;
        accumulatedMs += effectiveSpanMs * weight;

        const prev = syncedLyrics[syncedLyrics.length - 1];
        if (prev && prev.text === lineText && Math.abs(lineTime - prev.time) < 1200) {
          continue;
        }
        syncedLyrics.push({ time: lineTime, text: lineText });
        plainLines.push(lineText);
      }
    }
  }

  return { syncedLyrics, plainLines };
}

/**
 * Trích xuất lời bài hát hoàn chỉnh từ Description của YouTube Video
 */
function extractLyricsFromDescription(description) {
  if (!description || typeof description !== 'string') return null;

  const lyricHeaderRegex = /(?:^|\n)\s*(?:[-–—=~*#\s]*)\s*(?:\[?\s*(?:lyrics?|lời\s*bài\s*hát|loi\s*bai\s*hat|lời\s*nhạc|loi\s*nhac|full\s*lyrics?|lời\s*ca)\s*\]?)\s*[:：\n]/i;
  const match = description.match(lyricHeaderRegex);
  if (!match) return null;

  const startIndex = match.index + match[0].length;
  const rawChunk = description.slice(startIndex).trim();
  if (!rawChunk) return null;

  const lines = rawChunk.split('\n');
  const lyricLines = [];

  const stopKeywordsRegex = /(?:^|\b)(?:©|℗|all rights reserved|bản quyền thuộc về|composer|music producer|arranged by|mix\s*&?\s*master|recording engineer|director|cast|producer|hòa âm|phối khí|sáng tác|nhạc sĩ|ca sĩ|liên hệ|hotline|booking|theo dõi|follow|subscribe|kênh chính thức|link tải|tải nhạc|stream|spotify|apple music|itunes|mp3|nhaccuatui|zingmp3|fanpage|facebook|instagram|tiktok|group|youtube|website|email|đăng ký kênh)\b/i;
  const linkRegex = /https?:\/\/\S+/i;
  const hashtagRegex = /#\w+/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lyricLines.length > 0 && lyricLines[lyricLines.length - 1] !== '') {
        lyricLines.push('');
      }
      continue;
    }

    if (stopKeywordsRegex.test(trimmed) || linkRegex.test(trimmed)) {
      if (lyricLines.length >= 4) break;
      continue;
    }

    if (hashtagRegex.test(trimmed) && trimmed.split(/\s+/).every(w => w.startsWith('#'))) {
      if (lyricLines.length >= 4) break;
      continue;
    }

    const capitalized = trimmed.replace(/^([“"‘'(\[]*)(\p{L})/u, (_, p1, p2) => p1 + p2.toUpperCase());
    lyricLines.push(capitalized);
  }

  while (lyricLines.length > 0 && lyricLines[lyricLines.length - 1] === '') {
    lyricLines.pop();
  }

  const resultText = lyricLines.join('\n').trim();
  const actualLines = lyricLines.filter(l => l.length > 0);
  if (actualLines.length >= 4 && resultText.length >= 50) {
    return resultText;
  }
  return null;
}

async function fetchYouTubeDescriptionLyrics(url, rawTitle = '', artist = '', trackKey = null, userSavedOffsetMs = 0) {
  if (!isSafeYouTubeUrl(url)) return null;
  try {
    const info = await fetchYtdlpInfo(url);
    if (info && info.description) {
      const parsedLyrics = extractLyricsFromDescription(info.description);
      if (parsedLyrics && parsedLyrics.length >= 50) {
        console.log(`[Lyrics Description] Đã trích xuất thành công lời bài hát từ Description video YouTube: ${info.title || url}`);
        return {
          title: info.title || rawTitle,
          artist: info.uploader || info.channel || artist || '',
          lyrics: parsedLyrics,
          syncedLyrics: null,
          duration: info.duration || null,
          autoOffsetMs: 0,
          trackKey,
          userSavedOffsetMs: userSavedOffsetMs || 0,
          source: 'youtube_description',
          isYouTubeDescription: true
        };
      }
    }
  } catch (e) {}
  return null;
}

let _ytdlpExec = null;
function getYtdlpExec() {
  if (!_ytdlpExec) {
    try {
      _ytdlpExec = require('yt-dlp-exec');
    } catch (e) {}
  }
  return _ytdlpExec;
}

async function fetchOfficialSubtitlesViaYtdlp(url) {
  if (!isSafeYouTubeUrl(url)) return null;
  const ytdlp = getYtdlpExec();
  if (!ytdlp) return null;

  const runDump = async (cookiesFile = null) => {
    const infoOpts = {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true
    };
    if (cookiesFile) {
      infoOpts.cookies = cookiesFile;
    }
    return await Promise.race([
      ytdlp(url, infoOpts),
      new Promise((_, rej) => setTimeout(() => rej(new Error('yt-dlp subtitle dump timeout')), 7000))
    ]);
  };

  try {
    // 1. Thử dump không cookies trước (hoàn toàn an toàn, nhanh, không bị chặn bởi cookies YouTube hết hạn)
    let info = await runDump(null).catch(() => null);

    // 2. Nếu không tìm thấy phụ đề và có file cookies, thử lại với cookies
    if (!info || (!info.subtitles && !info.automatic_captions)) {
      const candidates = [
        process.env.YTDLP_COOKIES_FILE,
        path.resolve(__dirname, '../../youtube.cookies'),
        '/root/anna-music-bot/youtube.cookies'
      ].filter(Boolean);
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          const infoWithCookie = await runDump(c).catch(() => null);
          if (infoWithCookie && (infoWithCookie.subtitles || infoWithCookie.automatic_captions)) {
            info = infoWithCookie;
            break;
          }
        }
      }
    }

    if (!info) return null;
    const videoId = extractVideoId(url);
    if (videoId && (info.subtitles || info.automatic_captions)) {
      cacheYoutubeSubtitlesMeta(videoId, info.subtitles, info.automatic_captions);
    }
    return info;
  } catch (err) {
    return null;
  }
}

/**
 * TẦNG 1: Trích xuất phụ đề CC chính thức từ YouTube Video (Duyệt qua mọi candidate track để không bỏ sót)
 */
async function fetchYouTubeSubtitles(url, rawTitle = '', artist = '', trackKey = null, userSavedOffsetMs = 0) {
  if (!isSafeYouTubeUrl(url)) return null;
  const videoId = extractVideoId(url);

  try {
    let info = null;
    // Tầng 0: Kiểm tra metadata phụ đề đã lưu sẵn trong RAM lúc musicExtractor tải bài
    if (videoId && youtubeSubtitlesMetaCache.has(videoId)) {
      const cachedMeta = youtubeSubtitlesMetaCache.get(videoId);
      if (cachedMeta && (cachedMeta.subtitles || cachedMeta.automaticCaptions)) {
        info = {
          title: rawTitle,
          uploader: artist,
          subtitles: cachedMeta.subtitles || {},
          automatic_captions: cachedMeta.automaticCaptions || {}
        };
      }
    }

    // Tầng 1: Nếu chưa có trong RAM metadata, gọi fetchYtdlpInfo (Watch page scrape / InnerTube / ytdl)
    if (!info) {
      info = await fetchYtdlpInfo(url);
    }

    const context = {
      rawTitle,
      artist,
      videoTitle: info?.title || '',
      uploader: info?.uploader || info?.channel || ''
    };

    const isVN = isVietnameseTrack(context);
    const fullContextStr = `${rawTitle || ''} ${context.videoTitle || ''} ${artist || ''} ${context.uploader || ''}`;
    const isKR = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(fullContextStr);
    const isJP = /[\u3040-\u309F\u30A0-\u30FF]/.test(fullContextStr);
    const isCN = /[\u4E00-\u9FFF]/.test(fullContextStr);
    const rankedOfficialTracks = getRankedSubtitleTracks(info?.subtitles || {}, context);
    const rankedAutoTracks = getRankedSubtitleTracks(info?.automatic_captions || {}, context);

    // BƯỚC 1: Duyệt qua tất cả phụ đề chính thức (Official CC do ca sĩ/kênh tải lên)
    for (const candidateTrackList of rankedOfficialTracks) {
      const subTarget = candidateTrackList.find(s => s.ext === 'json3') || candidateTrackList[0];
      if (!subTarget) continue;

      const events = await downloadAndParseCaptionEvents(subTarget);
      if (!events || events.length === 0) continue;

      const { syncedLyrics, plainLines } = convertEventsToSyncedLyrics(events);
      if (syncedLyrics.length >= 5) {
        if (isVN) {
          const sampleText = plainLines.slice(0, 20).join(' ');
          if (!VIETNAMESE_REGEX.test(sampleText)) {
            continue;
          }
        } else if (!isJP && !isKR && !isCN) {
          const sampleText = plainLines.slice(0, 20).join(' ');
          if (/[\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(sampleText)) {
            continue;
          }
        }

        console.log(`[Lyrics CC] Đã trích xuất ${syncedLyrics.length} câu phụ đề CC chính thức từ video YouTube: ${info.title || url}`);
        return {
          title: info.title || rawTitle || 'YouTube Track',
          artist: info.uploader || info.channel || artist || '',
          lyrics: plainLines.join('\n'),
          syncedLyrics,
          duration: info.duration,
          autoOffsetMs: 0,
          trackKey,
          userSavedOffsetMs: userSavedOffsetMs || 0,
          source: 'youtube_cc',
          isOfficialCc: true
        };
      }
    }

    // BƯỚC 1.5: Nếu bước 1 không ra câu nào (do URL timedtext bị rỗng 0 byte từ cờ exp=xpe):
    // Fallback gọi yt-dlp dump-single-json để lấy danh sách URL timedtext chuẩn từ phụ đề chính thức (subtitles)
    try {
      const ytdlpInfo = await fetchOfficialSubtitlesViaYtdlp(url);
      if (ytdlpInfo && ytdlpInfo.subtitles) {
        const ytdlpOfficial = getRankedSubtitleTracks(ytdlpInfo.subtitles || {}, context);
        for (const candidateTrackList of ytdlpOfficial) {
          const subTarget = candidateTrackList.find(s => s.ext === 'json3') || candidateTrackList[0];
          if (!subTarget) continue;

          const events = await downloadAndParseCaptionEvents(subTarget);
          if (!events || events.length === 0) continue;

          const { syncedLyrics, plainLines } = convertEventsToSyncedLyrics(events);
          if (syncedLyrics.length >= 5) {
            if (isVN) {
              const sampleText = plainLines.slice(0, 20).join(' ');
              if (!VIETNAMESE_REGEX.test(sampleText)) {
                continue;
              }
            } else if (!isJP && !isKR && !isCN) {
              const sampleText = plainLines.slice(0, 20).join(' ');
              if (/[\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(sampleText)) {
                continue;
              }
            }

            console.log(`[Lyrics CC yt-dlp] Đã trích xuất ${syncedLyrics.length} câu phụ đề CC chuẩn từ yt-dlp: ${ytdlpInfo.title || url}`);
            return {
              title: ytdlpInfo.title || rawTitle || 'YouTube Track',
              artist: ytdlpInfo.uploader || ytdlpInfo.channel || artist || '',
              lyrics: plainLines.join('\n'),
              syncedLyrics,
              duration: ytdlpInfo.duration || info?.duration,
              autoOffsetMs: 0,
              trackKey,
              userSavedOffsetMs: userSavedOffsetMs || 0,
              source: 'youtube_cc',
              isOfficialCc: true
            };
          }
        }
      }
    } catch (ytdlpFallbackErr) {}
  } catch (e) {}
  return null;
}

/**
 * Tự động tìm mốc bắt đầu hát và tính Intro Delta thông minh giữa YouTube MV và bản Studio (LRCLIB)
 */
async function detectYouTubeIntroOffset(url, syncedLyrics, targetDurationSec, lrcDurationSec = 0) {
  if (!isSafeYouTubeUrl(url) || !syncedLyrics || syncedLyrics.length === 0) return 0;

  // ── BƯỚC 0: Nhận diện đoạn diễn xuất / kịch đầu MV qua SponsorBlock API (~60-150ms) ──
  const videoId = extractVideoId(url);
  if (videoId) {
    try {
      const sbUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodeURIComponent(JSON.stringify(['music_offtopic', 'intro']))}`;
      const sbRes = await fetch(sbUrl, { signal: AbortSignal.timeout(1000) });
      if (sbRes.ok) {
        const segments = await sbRes.json();
        if (Array.isArray(segments)) {
          // Tìm phân đoạn offtopic / intro ở đầu video (bắt đầu trong 3 giây đầu và dài từ 2s đến 180s)
          const introSeg = segments.find(s => Array.isArray(s.segment) && s.segment[0] <= 3.0 && s.segment[1] >= 2.0 && s.segment[1] <= 180.0);
          if (introSeg) {
            const introDurationMs = Math.round(introSeg.segment[1] * 1000);
            console.log(`[Lyrics Auto-Offset SponsorBlock] Phát hiện MV có đoạn kịch/intro đầu video dài ${(introDurationMs / 1000).toFixed(2)}s, tự động lùi mốc lời!`);
            return -introDurationMs;
          }
        }
      }
    } catch (sbErr) {}
  }

  let info = null;
  try {
    info = await fetchYtdlpInfo(url);
  } catch (e) {}

  const actualYtDurationSec = (info && info.duration > 0) ? info.duration : targetDurationSec;

  // ── BƯỚC 1: Căn nhịp chính xác đến từng mili-giây bằng YouTube Captions / Auto-Captions (ASR) ──
  if (info) {
    try {
      const context = {
        rawTitle: syncedLyrics[0]?.text || '',
        videoTitle: info.title || '',
        uploader: info.uploader || ''
      };

      const rankedOfficial = getRankedSubtitleTracks(info.subtitles || {}, context);
      const rankedAuto = getRankedSubtitleTracks(info.automatic_captions || {}, context);
      const candidateTrackLists = [...rankedOfficial, ...rankedAuto];

      for (const trackList of candidateTrackLists.slice(0, 2)) {
        const subTarget = trackList[0];
        const events = await downloadAndParseCaptionEvents(subTarget);
        if (!events || events.length === 0) continue;

        // Gom các từ kèm timestamp thực tế trong 150 giây đầu của MV
        const maxSearchMs = 150000;
        const wordTimeline = [];

        for (const ev of events) {
          const baseStart = Number(ev.tStartMs || 0);
          if (baseStart > maxSearchMs) break;
          const segs = ev.segs || [];
          for (const seg of segs) {
            const segTime = baseStart + Number(seg.tOffsetMs || 0);
            const normWords = normalizeStr(seg.utf8 || '').split(/\s+/).filter(Boolean);
            for (const w of normWords) {
              wordTimeline.push({ word: w, time: segTime });
            }
          }
        }

        if (wordTimeline.length >= 8) {
          let candidateLines = syncedLyrics
            .filter(l => l.text && normalizeStr(l.text).split(/\s+/).filter(w => w.length >= 2).length >= 2)
            .slice(0, 12);

          const normVideoTitle = normalizeStr(info.title || '');
          if (candidateLines.length > 2) {
            const firstLineNorm = normalizeStr(candidateLines[0].text);
            if (normVideoTitle.includes(firstLineNorm) || firstLineNorm.length <= 5) {
              candidateLines = candidateLines.slice(1, 11);
            } else {
              candidateLines = candidateLines.slice(0, 10);
            }
          }

          const detectedOffsets = [];

          for (const targetLine of candidateLines) {
            const targetWords = normalizeStr(targetLine.text).split(/\s+/).filter(w => w.length >= 2);
            if (targetWords.length < 2) continue;

            let bestMatchTime = null;
            let bestScore = 0;

            for (let i = 0; i < wordTimeline.length; i++) {
              const windowEndTime = wordTimeline[i].time + 6500;
              const windowWords = [];
              for (let j = i; j < wordTimeline.length && wordTimeline[j].time <= windowEndTime; j++) {
                windowWords.push(wordTimeline[j].word);
              }

              let matched = 0;
              for (const tw of targetWords) {
                if (windowWords.includes(tw)) matched++;
              }

              const ratio = matched / targetWords.length;
              if (matched >= 2 && ratio >= 0.6 && matched > bestScore) {
                bestScore = matched;
                bestMatchTime = wordTimeline[i].time;
              }
            }

            if (bestMatchTime !== null) {
              const offset = targetLine.time - bestMatchTime;
              detectedOffsets.push(offset);
            }
          }

          if (detectedOffsets.length >= 2) {
            detectedOffsets.sort((a, b) => a - b);
            const medianOffset = detectedOffsets[Math.floor(detectedOffsets.length / 2)];
            if (Math.abs(medianOffset) >= 500 && medianOffset >= -180000 && medianOffset <= 15000) {
              console.log(`[Lyrics Auto-Offset ASR] Phát hiện độ lệch Intro MV ${(medianOffset / 1000).toFixed(2)}s (${detectedOffsets.length} câu khớp), đã tự động đồng bộ!`);
              return Math.round(medianOffset);
            }
          }
        }
      }
    } catch (asrErr) {}
  }

  // Chỉ tin cậy độ lệch khi có nhận diện giọng nói ASR/CC khớp thực tế ở Bước 1.
  // Tuyệt đối không đoán mò qua chênh lệch thời lượng (Duration Delta) vì phần chênh lệch thường là Outro/Credit cuối MV,
  // việc đoán mò sẽ làm hỏng nhịp các bài hát bắt đầu ngay từ giây 0 (như BAND4BAND).
  return 0;
}

async function buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey = null, userSavedOffsetMs = 0, isRemixOrDurationMismatch = false) {
  const cleanLyrics = (match.syncedLyrics || match.plainLyrics || '').replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
  if (isGarbageLyrics(cleanLyrics)) {
    return null;
  }
  const parsed = match.syncedLyrics ? parseLrc(match.syncedLyrics) : null;
  let autoOffsetMs = 0;

  if (parsed && targetUrl && (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be'))) {
    try {
      autoOffsetMs = await detectYouTubeIntroOffset(targetUrl, parsed, targetDurationSec, Number(match.duration || 0));
    } catch (e) {}
  }

  const isTrueRemix = detectVariantTrack(rawTitle);
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
    source: isTrueRemix ? 'lrclib_original_fallback' : 'lrclib',
    isRemixOrDurationMismatch: Boolean(isTrueRemix && isRemixOrDurationMismatch),
    hasTriedCc: isYt
  };
  setCachedLyrics(cacheKey, lrclibResult);
  return lrclibResult;
}

function normalizeTargetUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const vid = extractVideoId(url);
  if (vid) {
    return `https://www.youtube.com/watch?v=${vid}`;
  }
  return url.trim();
}

const ZING_API_KEY = '88265e23d4284f25963e6eedac8fbfa3';
const ZING_SECRET_KEY = '2aa2d1c561e809b267f3638c4a307aab';
const ZING_VERSION = '1.6.34';

let zingCookieCache = '';
let zingCookieTime = 0;

async function getZingCookie() {
  if (zingCookieCache && Date.now() - zingCookieTime < 3600000) {
    return zingCookieCache;
  }
  try {
    const res = await fetch('https://zingmp3.vn', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(4000)
    });
    const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    if (rawCookies && rawCookies.length > 0) {
      zingCookieCache = rawCookies.map(c => c ? c.split(';')[0] : '').filter(Boolean).join('; ');
      zingCookieTime = Date.now();
    }
  } catch (e) {}
  return zingCookieCache;
}

function formatLrcTimestamp(ms) {
  const totalSec = Math.max(0, ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const hundredths = Math.floor((totalSec % 1) * 100);
  return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;
}

function findBestZingSong(songs, targetTitle, targetArtist) {
  if (!Array.isArray(songs) || songs.length === 0) return null;
  const cleanTarget = normalizeStr(cleanTitle(targetTitle));
  const cleanTargetArtist = normalizeStr(targetArtist || '');

  // 1. Tìm bài trùng cả tên và ca sĩ
  if (cleanTargetArtist) {
    const exactMatch = songs.find(s => {
      const sName = normalizeStr(s.name);
      const sArtist = normalizeStr(s.artist || s.artistsNames || '');
      return (sName === cleanTarget || sName.includes(cleanTarget) || cleanTarget.includes(sName)) &&
             (sArtist.includes(cleanTargetArtist) || cleanTargetArtist.includes(sArtist));
    });
    if (exactMatch) return exactMatch;
  }

  // 2. Tìm bài trùng tên bài hát
  const titleMatch = songs.find(s => {
    const sName = normalizeStr(s.name);
    return sName === cleanTarget || sName.includes(cleanTarget) || cleanTarget.includes(sName);
  });
  if (titleMatch) return titleMatch;

  // 3. Fallback bài đầu tiên
  return songs[0];
}

async function fetchZingMp3Lyrics(rawTitle, artist = '', targetDurationSec = 0, targetUrl = null, trackKey = null, userSavedOffsetMs = 0) {
  try {
    const cleanT = cleanTitle(rawTitle);
    const cleanA = cleanArtistName(artist);
    if (!cleanT) return null;

    // Thử truy vấn: 1) Tên bài + ca sĩ, 2) Tên bài đơn thuần
    const queries = [];
    if (cleanA && cleanA !== 'Unknown') {
      queries.push(`${cleanT} ${cleanA}`.trim());
    }
    queries.push(cleanT);

    let songList = null;
    for (const q of queries) {
      const acUrl = `https://ac.zingmp3.vn/complete?type=artist,song,key,hub&num=5&query=${encodeURIComponent(q)}`;
      const acRes = await fetch(acUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);

      if (acRes && acRes.ok) {
        const acData = await acRes.json().catch(() => null);
        const songs = acData?.data?.[0]?.song;
        if (Array.isArray(songs) && songs.length > 0) {
          songList = songs;
          break;
        }
      }
    }

    if (!songList || songList.length === 0) return null;

    const matchedSong = findBestZingSong(songList, rawTitle, artist);
    if (!matchedSong || !matchedSong.id) return null;

    const songId = matchedSong.id;
    const ctime = String(Math.floor(Date.now() / 1000));
    const path = '/api/v2/lyric/get/lyric';
    const hash = crypto.createHash('sha256').update(`ctime=${ctime}id=${songId}version=${ZING_VERSION}`).digest('hex');
    const sig = crypto.createHmac('sha512', ZING_SECRET_KEY).update(Buffer.from(path + hash, 'utf8')).digest('hex');
    const cookie = await getZingCookie();

    const lyricApiUrl = `https://zingmp3.vn/api/v2/lyric/get/lyric?id=${songId}&ctime=${ctime}&version=${ZING_VERSION}&sig=${sig}&apiKey=${ZING_API_KEY}`;
    const lyricRes = await fetch(lyricApiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://zingmp3.vn/',
        'Cookie': cookie
      },
      signal: AbortSignal.timeout(3500)
    }).catch(() => null);

    if (!lyricRes || !lyricRes.ok) return null;
    const lyricData = await lyricRes.json().catch(() => null);
    if (!lyricData || lyricData.err !== 0 || !lyricData.data) return null;

    let syncedLyrics = null;
    let plainLyrics = null;

    // Phân tích data.sentences (Karaoke chuẩn xác từng câu và mốc thời gian dạng mảng { time, text })
    if (Array.isArray(lyricData.data.sentences) && lyricData.data.sentences.length > 0) {
      const syncedItems = [];
      const plainLines = [];

      for (const sent of lyricData.data.sentences) {
        if (!sent || !Array.isArray(sent.words) || sent.words.length === 0) continue;
        const lineText = sent.words.map(w => w.data || '').join(' ').trim();
        if (!lineText) continue;
        const startMs = sent.words[0].startTime || 0;
        syncedItems.push({ time: startMs, text: lineText });
        plainLines.push(lineText);
      }

      if (syncedItems.length > 0) {
        syncedLyrics = syncedItems;
      }
      if (plainLines.length > 0) {
        plainLyrics = plainLines.join('\n');
      }
    }

    // Dự phòng qua data.file (.lrc URL)
    if (!syncedLyrics && lyricData.data.file && typeof lyricData.data.file === 'string' && lyricData.data.file.startsWith('http')) {
      try {
        const fileRes = await fetch(lyricData.data.file, { signal: AbortSignal.timeout(3000) });
        if (fileRes && fileRes.ok) {
          const lrcText = await fileRes.text();
          if (lrcText && lrcText.trim().length > 10 && !isGarbageLyrics(lrcText)) {
            const parsed = parseLrc(lrcText.trim());
            if (parsed && parsed.length > 0) {
              syncedLyrics = parsed;
              plainLyrics = parsed.map(p => p.text).join('\n');
            }
          }
        }
      } catch (fileErr) {}
    }

    if (!syncedLyrics && !plainLyrics) return null;

    let autoOffsetMs = 0;
    if (syncedLyrics && targetUrl && (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be'))) {
      try {
        autoOffsetMs = await detectYouTubeIntroOffset(targetUrl, syncedLyrics, targetDurationSec, targetDurationSec);
      } catch (e) {}
    }

    return {
      title: matchedSong.name || rawTitle,
      artist: matchedSong.artist || matchedSong.artistsNames || artist || '',
      lyrics: plainLyrics || (syncedLyrics ? syncedLyrics.map(s => s.text).join('\n') : ''),
      syncedLyrics,
      duration: targetDurationSec || Number(matchedSong.duration || 0),
      autoOffsetMs,
      trackKey,
      userSavedOffsetMs: (userSavedOffsetMs !== undefined && userSavedOffsetMs !== null) ? userSavedOffsetMs : 0,
      source: 'zingmp3'
    };
  } catch (err) {
    console.warn('[ZingMp3 Lyrics] Lỗi tra cứu lời bài hát:', err.message);
    return null;
  }
}

async function fetchLrclibLyrics(rawTitle, artist = '', targetDurationSec = 0, targetUrl = null, cacheKey = null, trackKey = null, userSavedOffsetMs = 0) {
  const variants = generateSearchVariants(rawTitle, artist).slice(0, 6);
  let plainFallback = null;
  let fallbackRecord = null;

  for (const item of variants) {
    try {
      if (item.track && item.artist) {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(item.track)}&artist_name=${encodeURIComponent(item.artist)}`;
        const res = await fetch(getUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' },
          signal: AbortSignal.timeout(2500)
        }).catch(() => null);
        if (res && res.ok) {
          const match = await res.json().catch(() => null);
          if (match && (match.plainLyrics || match.syncedLyrics)) {
            if (!isGarbageLyrics(match.plainLyrics) && !isGarbageLyrics(match.syncedLyrics)) {
              if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
                const isExactTier1 = (durDiff <= 15) || (!detectVariantTrack(rawTitle) && durDiff <= 60) || (targetDurationSec === 0);

                if (isExactTier1) {
                  if (match.syncedLyrics && match.syncedLyrics.trim().length > 10) {
                    const built = await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, false);
                    if (built) return { exactSynced: built };
                  } else if (!plainFallback && match.plainLyrics) {
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
                } else {
                  if (!fallbackRecord || (!fallbackRecord.syncedLyrics && match.syncedLyrics)) {
                    fallbackRecord = match;
                  }
                }
              }
            }
          }
        }
      }

      const queryStr = item.q || `${item.track || ''} ${item.artist || ''}`.trim();
      if (queryStr) {
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(queryStr)}`;
        const res = await fetch(searchUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' },
          signal: AbortSignal.timeout(2500)
        }).catch(() => null);

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          const results = Array.isArray(data) ? data : (data ? [data] : []);
          if (results.length > 0) {
            results.sort((a, b) => {
              const aValid = isValidMatch(a, item.expectedTrack || item.track, item.expectedArtist || item.artist);
              const bValid = isValidMatch(b, item.expectedTrack || item.track, item.expectedArtist || item.artist);
              if (aValid && !bValid) return -1;
              if (!aValid && bValid) return 1;

              if (targetDurationSec > 0) {
                const aDiff = typeof a.duration === 'number' ? Math.abs(a.duration - targetDurationSec) : 9999;
                const bDiff = typeof b.duration === 'number' ? Math.abs(b.duration - targetDurationSec) : 9999;
                return aDiff - bDiff;
              }
              return 0;
            });

            for (const match of results) {
              const hasSynced = Boolean(match?.syncedLyrics && match.syncedLyrics.trim().length > 10);
              const hasPlain = Boolean(match?.plainLyrics && match.plainLyrics.trim().length > 10);

              if ((hasSynced || hasPlain) && !isGarbageLyrics(match.plainLyrics) && !isGarbageLyrics(match.syncedLyrics) && isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
                const isExactTier1 = (durDiff <= 15) || (!detectVariantTrack(rawTitle) && durDiff <= 60) || (targetDurationSec === 0);

                if (isExactTier1) {
                  if (hasSynced) {
                    const built = await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, false);
                    if (built) return { exactSynced: built };
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
                } else {
                  if (!fallbackRecord || (!fallbackRecord.syncedLyrics && match.syncedLyrics)) {
                    fallbackRecord = match;
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  return { plainFallback, fallbackRecord };
}

/**
 * Điều phối lấy lời bài hát đa tầng
 */
/**
 * Đánh giá chất lượng của danh sách lời bài hát đồng bộ (Synced Lyrics)
 * - Đếm số câu hát
 * - Tìm khoảng trống lớn nhất giữa 2 câu hát liên tiếp (maxGapMs)
 * - Phát hiện lỗ thủng bất thường (gap >= 22000ms giữa 2 câu hát trong bài)
 * Ví dụ thực tế: Zing MP3 bị rỗng 33.16s đoạn song ca của Changg trong bài "Và Thế Giới Đã Mất Đi Một Người Cô Đơn"
 */
function evaluateLyricsQuality(syncedLyrics) {
  if (!Array.isArray(syncedLyrics) || syncedLyrics.length === 0) {
    return { valid: false, count: 0, maxGapMs: 0, abnormalGaps: 0, hasAbnormalGap: false };
  }
  const count = syncedLyrics.length;
  if (count < 4) {
    return { valid: false, count, maxGapMs: 0, abnormalGaps: 0, hasAbnormalGap: false };
  }

  let maxGapMs = 0;
  let abnormalGaps = 0;

  for (let i = 0; i < count - 1; i++) {
    const curTime = Number(syncedLyrics[i].time) || 0;
    const nextTime = Number(syncedLyrics[i + 1].time) || 0;
    const gap = nextTime - curTime;
    if (gap > maxGapMs) {
      maxGapMs = gap;
    }
    // Lỗ hổng bất thường: khoảng cách giữa 2 câu liên tiếp >= 22 giây (22000ms)
    if (gap >= 22000) {
      abnormalGaps++;
    }
  }

  return {
    valid: true,
    count,
    maxGapMs,
    abnormalGaps,
    hasAbnormalGap: abnormalGaps > 0
  };
}

/**
 * Chọn bản lời bài hát tốt nhất từ danh sách ứng viên các tầng:
 * 1. Bản lời KHÔNG BỊ THỦNG LỖ (không có gap >= 22s) luôn thắng bản bị thủng lỗ
 * 2. Tôn trọng thứ tự ưu tiên activeLayers do người dùng cấu hình
 * 3. Nếu cùng thứ tự ưu tiên: bản nào có nhiều câu hơn sẽ thắng
 */
function pickBestLyricsCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    // Tiêu chí 1: Nguồn không bị thủng đoạn luôn thắng nguồn bị thủng đoạn
    if (!a.quality.hasAbnormalGap && b.quality.hasAbnormalGap) return -1;
    if (a.quality.hasAbnormalGap && !b.quality.hasAbnormalGap) return 1;

    // Tiêu chí 2: Tôn trọng thứ tự ưu tiên (priority thấp hơn = đứng trước trong activeLayers)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // Tiêu chí 3: Số lượng câu hát nhiều hơn
    return b.quality.count - a.quality.count;
  });

  const best = sorted[0];
  if (sorted.length > 1) {
    const runnerUp = sorted[1];
    if (runnerUp.quality.hasAbnormalGap && !best.quality.hasAbnormalGap) {
      console.log(`[Lyrics Quality Guard] Nguồn "${runnerUp.source}" bị thủng đoạn ${Math.round(runnerUp.quality.maxGapMs / 1000)}s. Tự động chọn nguồn "${best.source}" đầy đủ hơn (${best.quality.count} câu vs ${runnerUp.quality.count} câu).`);
    }
  }

  return best.result;
}

async function fetchLyrics(rawTitle, artist = '', durationMs = 0, targetUrl = null, lyricsLayers = null) {
  if (!rawTitle || typeof rawTitle !== 'string') return null;

  const safeTitle = rawTitle.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150);
  const safeArtist = (typeof artist === 'string' ? artist : '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150);
  if (!safeTitle) return null;

  const normalizedUrl = normalizeTargetUrl(targetUrl);
  const cacheKey = normalizedUrl || `${safeTitle}_${safeArtist}_${durationMs || 0}`;

  if (inFlightLyrics.has(cacheKey)) {
    return await inFlightLyrics.get(cacheKey);
  }

  const p = _executeFetchLyrics(safeTitle, safeArtist, durationMs, targetUrl, normalizedUrl, cacheKey, lyricsLayers);
  inFlightLyrics.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlightLyrics.delete(cacheKey);
  }
}

async function _executeFetchLyrics(rawTitle, artist, durationMs, targetUrl, normalizedUrl, cacheKey, lyricsLayers) {
  const isYouTube = Boolean(normalizedUrl && (normalizedUrl.includes('youtube.com') || normalizedUrl.includes('youtu.be')));
  const trackKey = generateTrackKey(rawTitle, artist, normalizedUrl);
  const fallbackKey = generateTrackKey(rawTitle, artist, null);
  const userSavedOffsetMs = await getSavedLyricOffset(trackKey, fallbackKey);

  const activeLayers = (Array.isArray(lyricsLayers) && lyricsLayers.length > 0)
    ? lyricsLayers
    : ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'];

  const cached = getCachedLyrics(cacheKey);
  if (cached) {
    if (cached.notFound) return cached;
    if (isGarbageLyrics(cached.lyrics)) {
      lyricsMemoryCache.delete(cacheKey);
    } else if (activeLayers.includes(cached.source) || !cached.source) {
      return {
        ...cached,
        trackKey,
        userSavedOffsetMs: (userSavedOffsetMs !== undefined && userSavedOffsetMs !== null) ? userSavedOffsetMs : (cached.userSavedOffsetMs || 0)
      };
    }
  }

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

  let targetDurationSec = durationMs ? durationMs / 1000 : 0;

  if (isYouTube && normalizedUrl) {
    try {
      const ytInfo = await fetchYtdlpInfo(normalizedUrl);
      if (ytInfo && ytInfo.duration > 0) {
        targetDurationSec = ytInfo.duration;
      }
    } catch (e) {}
  }

  let plainFallback = null;
  let fallbackRecord = null;
  let fallbackResult = null;

  // ── ĐUA SONG SONG CÓ TRỌNG SỐ & PHÁT HIỆN THỦNG ĐOẠN (SMART GAP-RESILIENT RACE) ──
  const candidates = [];
  let hasTopPriorityPerfectWinner = false;
  let firstCandidateTimestamp = 0;
  const racePromises = [];

  const getLayerPriority = (layerName) => {
    const idx = activeLayers.indexOf(layerName);
    return idx !== -1 ? idx : 999;
  };

  const recordCandidate = (layerName, res) => {
    if (!res || !Array.isArray(res.syncedLyrics) || res.syncedLyrics.length < 3) return;
    const quality = evaluateLyricsQuality(res.syncedLyrics);
    const candidate = {
      source: layerName,
      priority: getLayerPriority(layerName),
      result: res,
      quality
    };
    candidates.push(candidate);
    if (!firstCandidateTimestamp) {
      firstCandidateTimestamp = Date.now();
    }
    // Nếu là nguồn ưu tiên số 1 của người dùng VÀ không bị thủng đoạn -> Chốt thắng ngay (0ms delay)
    if (candidate.priority === 0 && !candidate.quality.hasAbnormalGap) {
      hasTopPriorityPerfectWinner = true;
    }
  };

  // Tầng 1: YouTube CC (Chạy ngay t = 0ms nếu có cấu hình)
  if (activeLayers.includes('youtube_cc') && isYouTube && normalizedUrl) {
    racePromises.push((async () => {
      try {
        const ytSubResult = await fetchYouTubeSubtitles(normalizedUrl, rawTitle, artist, trackKey, userSavedOffsetMs);
        if (ytSubResult?.syncedLyrics) {
          recordCandidate('youtube_cc', ytSubResult);
        }
      } catch (ytSubErr) {}
    })());
  }

  // Tầng 2: Zing MP3 (Chạy ngay t = 0ms nếu có cấu hình)
  if (activeLayers.includes('zingmp3')) {
    racePromises.push((async () => {
      try {
        const zingResult = await fetchZingMp3Lyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, trackKey, userSavedOffsetMs);
        if (zingResult?.syncedLyrics) {
          recordCandidate('zingmp3', zingResult);
        } else if (zingResult?.lyrics && !plainFallback) {
          plainFallback = zingResult;
        }
      } catch (zingErr) {}
    })());
  }

  // Tầng 3: LRCLIB (Chạy ngay t = 0ms nếu có cấu hình)
  if (activeLayers.includes('lrclib')) {
    racePromises.push((async () => {
      try {
        const lrclibRes = await fetchLrclibLyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, cacheKey, trackKey, userSavedOffsetMs);
        if (lrclibRes?.exactSynced?.syncedLyrics) {
          recordCandidate('lrclib', lrclibRes.exactSynced);
        }
        if (!plainFallback && lrclibRes?.plainFallback) {
          plainFallback = lrclibRes.plainFallback;
        }
        if (!fallbackRecord && lrclibRes?.fallbackRecord) {
          fallbackRecord = lrclibRes.fallbackRecord;
        }
      } catch (lrclibErr) {}
    })());
  }

  // Tầng 4: SyncedLyrics Python Microservice (Staggered Start sau 300ms để tiết kiệm CPU/RAM cho VPS)
  if (activeLayers.includes('syncedlyrics')) {
    racePromises.push((async () => {
      // Đợi 300ms xem các nguồn tốc độ cao (ZingMP3/LRCLIB) có hoàn tất trước không
      await new Promise(r => setTimeout(r, 300));
      if (hasTopPriorityPerfectWinner) return;

      try {
        const fbRes = await fetchLyricsFallback(rawTitle, artist, targetDurationSec * 1000);
        if (fbRes?.syncedLyrics) {
          fbRes.trackKey = trackKey;
          fbRes.userSavedOffsetMs = userSavedOffsetMs || 0;
          if (isYouTube && normalizedUrl) {
            try {
              fbRes.autoOffsetMs = await detectYouTubeIntroOffset(normalizedUrl, fbRes.syncedLyrics, targetDurationSec, Number(fbRes.duration || 0));
            } catch (e) {}
          }
          recordCandidate('syncedlyrics', fbRes);
        } else if (fbRes?.lyrics && !fallbackResult) {
          fallbackResult = fbRes;
        }
      } catch (fbErr) {}
    })());
  }

  // Đua song song thông minh:
  // - Nếu nguồn ưu tiên #1 hoàn hảo: Chốt ngay không chờ
  // - Nếu nguồn về trước bị thủng đoạn (gap >= 22s): Cho phép cửa sổ đợi 700ms để nguồn khác cứu cánh
  // - Nếu nguồn về trước không phải ưu tiên #1: Chờ cửa sổ ưu tiên ngắn 250ms
  await Promise.race([
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (hasTopPriorityPerfectWinner) {
          clearInterval(interval);
          return resolve();
        }

        if (candidates.length > 0) {
          const elapsedSinceFirst = Date.now() - firstCandidateTimestamp;
          const hasFlawlessCandidate = candidates.some(c => !c.quality.hasAbnormalGap);

          // Trường hợp 1: Đã có nguồn không bị thủng lỗ và đã qua cửa sổ ưu tiên 250ms
          if (hasFlawlessCandidate && elapsedSinceFirst >= 250) {
            clearInterval(interval);
            return resolve();
          }

          // Trường hợp 2: Tất cả nguồn hiện tại đều bị thủng lỗ -> Chờ tối đa 1200ms để LRCLIB/khác hoàn thành cứu cánh
          if (!hasFlawlessCandidate && elapsedSinceFirst >= 1200) {
            clearInterval(interval);
            return resolve();
          }
        }
      }, 30);

      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 3500);
    }),
    Promise.allSettled(racePromises)
  ]);

  const syncedWinner = pickBestLyricsCandidate(candidates);

  if (syncedWinner) {
    setCachedLyrics(cacheKey, syncedWinner);
    return syncedWinner;
  }

  // Nếu không tầng nào ra Synced Lyrics chuẩn, thử lấy fallback synced từ bản gốc lệch thời lượng (LRCLIB)
  if (fallbackRecord && fallbackRecord.syncedLyrics) {
    const isActualRemixMismatch = detectVariantTrack(rawTitle);
    return await buildLrclibResult(fallbackRecord, rawTitle, artist, normalizedUrl || targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, isActualRemixMismatch);
  }

  // Tầng dự phòng cuối: Trích xuất lời từ Description YouTube
  if (isYouTube && normalizedUrl) {
    try {
      const descLyrics = await fetchYouTubeDescriptionLyrics(normalizedUrl, rawTitle, artist, trackKey, userSavedOffsetMs);
      if (descLyrics && descLyrics.lyrics && descLyrics.lyrics.length >= 50) {
        setCachedLyrics(cacheKey, descLyrics);
        return descLyrics;
      }
    } catch (descErr) {}
  } else if (!isYouTube) {
    try {
      const searchQuery = `${cleanTitle(rawTitle)} ${cleanArtistName(artist)}`.trim();
      if (searchQuery) {
        const { executeSearch } = require('./searchService');
        const sRes = await executeSearch(searchQuery, 1, 'official');
        const topVideo = sRes?.[0];
        if (topVideo && topVideo.url) {
          const ccRes = await fetchYouTubeSubtitles(topVideo.url, rawTitle, artist, trackKey, userSavedOffsetMs);
          if (ccRes && ccRes.syncedLyrics && ccRes.syncedLyrics.length >= 5) {
            setCachedLyrics(cacheKey, ccRes);
            return ccRes;
          }
          const descRes = await fetchYouTubeDescriptionLyrics(topVideo.url, rawTitle, artist, trackKey, userSavedOffsetMs);
          if (descRes && descRes.lyrics && descRes.lyrics.length >= 50) {
            setCachedLyrics(cacheKey, descRes);
            return descRes;
          }
        }
      }
    } catch (ytSearchErr) {}
  }

  if (fallbackRecord) {
    const isActualRemixMismatch = detectVariantTrack(rawTitle);
    return await buildLrclibResult(fallbackRecord, rawTitle, artist, normalizedUrl || targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, isActualRemixMismatch);
  }

  if (fallbackResult && fallbackResult.lyrics) {
    fallbackResult.trackKey = trackKey;
    fallbackResult.userSavedOffsetMs = userSavedOffsetMs || 0;
    setCachedLyrics(cacheKey, fallbackResult);
    return fallbackResult;
  }
  if (plainFallback) {
    setCachedLyrics(cacheKey, plainFallback);
    return plainFallback;
  }

  const notFoundResult = {
    title: rawTitle,
    artist,
    lyrics: null,
    syncedLyrics: null,
    notFound: true,
    trackKey,
    userSavedOffsetMs: 0
  };
  setCachedLyrics(cacheKey, notFoundResult);
  return notFoundResult;
}

async function fetchLyricsFallback(rawTitle, artist = '', durationMs = 0) {
  const fallbackBaseUrl = process.env.LYRICS_FALLBACK_URL || 'http://127.0.0.1:8787/lyrics';
  try {
    const primaryClean = stripParentheses(cleanTitle(rawTitle));
    const targetDurationSec = durationMs ? Math.floor(durationMs / 1000) : 0;
    let cleanArt = cleanArtistName(artist);

    let cleanTitleOnly = primaryClean;
    const segs = primaryClean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).filter(Boolean);
    if (segs.length >= 2) {
      const s0 = segs[0].trim();
      const s1 = segs[1].trim();
      const normArt = cleanArt ? normalizeStr(cleanArt) : '';
      const s0IsArt = normArt && (normalizeStr(s0).includes(normArt) || normArt.includes(normalizeStr(s0)));
      const s1IsArt = normArt && (normalizeStr(s1).includes(normArt) || normArt.includes(normalizeStr(s1)));

      if (s0IsArt) {
        cleanTitleOnly = s1;
        cleanArt = cleanArtistName(s0);
      } else if (s1IsArt) {
        cleanTitleOnly = s0;
        cleanArt = cleanArtistName(s1);
      } else {
        cleanTitleOnly = s0;
        if (!cleanArt || cleanArt === 'Unknown') {
          cleanArt = cleanArtistName(s1);
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

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' },
      signal: AbortSignal.timeout(3500)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && (data.syncedLyrics || data.plainLyrics)) {
        const plain = data.plainLyrics || (Array.isArray(data.syncedLyrics) ? data.syncedLyrics.map(l => l.text).join('\n') : '');
        if (isGarbageLyrics(plain)) {
          return null;
        }
        return {
          title: rawTitle,
          artist: artist || '',
          lyrics: plain.trim(),
          syncedLyrics: Array.isArray(data.syncedLyrics) && data.syncedLyrics.length > 0 ? data.syncedLyrics : null,
          duration: targetDurationSec || null,
          autoOffsetMs: 0,
          source: data.source || 'syncedlyrics'
        };
      }
    }
  } catch (e) {}
  return null;
}

function prefetchLyrics(rawTitle, artist = '', durationMs = 0, targetUrl = null, lyricsLayers = null) {
  if (!rawTitle) return;
  fetchLyrics(rawTitle, artist, durationMs, targetUrl, lyricsLayers)
    .then(res => {
      if (res && !res.notFound) {
        console.log(`[Lyrics Pre-fetch Cache] Đã nạp sẵn lời bài hát vào RAM: "${rawTitle}" (Source: ${res.source}, AutoOffset: ${res.autoOffsetMs || 0}ms)`);
      }
    })
    .catch(() => {});
}

module.exports = {
  cleanSearchVariants: generateSearchVariants,
  fetchLyrics,
  fetchLyricsFallback,
  getLyrics: fetchLyrics,
  prefetchLyrics,
  generateTrackKey,
  saveLyricOffset,
  getSavedLyricOffset,
  cacheYoutubeSubtitlesMeta,
  isGarbageLyrics
};
