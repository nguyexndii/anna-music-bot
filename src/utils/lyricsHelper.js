const fetch = globalThis.fetch || require('node-fetch');

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
  return cleanTitle(str).replace(/(?:official\s*(?:channel)?|channel|topic|vevo|records|entertainment)/gi, '').trim();
}

function extractArtists(artistStr) {
  if (!artistStr) return [];
  const clean = artistStr.replace(/prod\.?\s*(?:by)?\s*[\w\d_]+/gi, '').trim();
  const parts = clean.split(/\s*(?:ft\.?|feat\.?|x|&|\+|cùng|với|,)\s*/i).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [clean];
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
  const cleanArt = cleanArtistName(rawArtist);

  const titlesToProcess = [primaryClean];
  if (deepClean && deepClean !== primaryClean) {
    titlesToProcess.unshift(deepClean); // Ưu tiên bản đã bỏ ngoặc đơn phụ đề tiếng Anh
  }

  for (const t of titlesToProcess) {
    const rawSegments = t.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => cleanTitle(s)).filter(Boolean);
    const meaningfulSegments = rawSegments.filter(s => s.length >= 2 && !/^(mv|official|audio|video|lyrics)$/i.test(s));

    if (meaningfulSegments.length >= 2) {
      const s1 = meaningfulSegments[0];
      const s2 = meaningfulSegments[1];

      const s1Artists = extractArtists(s1);
      const s2Artists = extractArtists(s2);

      const normCleanArt = cleanArt ? normalizeStr(cleanArt) : '';
      const s1IsArtist = normCleanArt && (s1Artists.some(a => normalizeStr(a).includes(normCleanArt) || normCleanArt.includes(normalizeStr(a))));
      const s2IsArtist = normCleanArt && (s2Artists.some(a => normalizeStr(a).includes(normCleanArt) || normCleanArt.includes(normalizeStr(a))));

      // 1. Combination A: s1 is track, s2 is artist (Mặc định chuẩn nhất cho định dạng YouTube "Tên Bài | Ca Sĩ")
      if (!s1IsArtist) {
        for (const art of s2Artists) {
          queries.push({ track: s1, artist: art, expectedTrack: s1, expectedArtist: art });
          queries.push({ q: `${s1} ${art}`, expectedTrack: s1, expectedArtist: art });
        }
        queries.push({ track: s1, artist: s2, expectedTrack: s1, expectedArtist: s2 });
        queries.push({ q: `${s1} ${s2}`, expectedTrack: s1, expectedArtist: s2 });
      }

      // 2. Trường hợp s2 có feat rõ ràng (e.g. "Donald Gold - OBGTLH ft. Lil Shady" -> s1 là Artist, s2 là Track ft. Artist2)
      const feat2 = splitFeat(s2);
      if (feat2 && s1IsArtist) {
        const exp = [s1, feat2.artistPart];
        queries.push({ track: feat2.titlePart, artist: s1, expectedTrack: feat2.titlePart, expectedArtist: exp });
        queries.push({ track: feat2.titlePart, artist: feat2.artistPart, expectedTrack: feat2.titlePart, expectedArtist: exp });
        queries.push({ q: `${feat2.titlePart} ${s1}`, expectedTrack: feat2.titlePart, expectedArtist: exp });
        queries.push({ q: `${feat2.titlePart} ${feat2.artistPart}`, expectedTrack: feat2.titlePart, expectedArtist: exp });
        queries.push({ q: feat2.titlePart, expectedTrack: feat2.titlePart, expectedArtist: exp });
      }

      // 3. Combination B: s2 is track, s1 is artist (Dành cho định dạng "Ca Sĩ - Tên Bài")
      if (s1IsArtist || !s2IsArtist) {
        for (const art of s1Artists) {
          queries.push({ track: s2, artist: art, expectedTrack: s2, expectedArtist: art });
          queries.push({ q: `${s2} ${art}`, expectedTrack: s2, expectedArtist: art });
        }
        queries.push({ track: s2, artist: s1, expectedTrack: s2, expectedArtist: s1 });
        queries.push({ q: `${s2} ${s1}`, expectedTrack: s2, expectedArtist: s1 });
      }

      // 4. Trường hợp s1 có feat: e.g. "OBGTLH ft. Lil Shady - Donald Gold"
      const feat1 = splitFeat(s1);
      if (feat1 && s2IsArtist) {
        const exp = [s2, feat1.artistPart];
        queries.push({ track: feat1.titlePart, artist: s2, expectedTrack: feat1.titlePart, expectedArtist: exp });
        queries.push({ track: feat1.titlePart, artist: feat1.artistPart, expectedTrack: feat1.titlePart, expectedArtist: exp });
        queries.push({ q: `${feat1.titlePart} ${s2}`, expectedTrack: feat1.titlePart, expectedArtist: exp });
        queries.push({ q: `${feat1.titlePart} ${feat1.artistPart}`, expectedTrack: feat1.titlePart, expectedArtist: exp });
        queries.push({ q: feat1.titlePart, expectedTrack: feat1.titlePart, expectedArtist: exp });
      }
    }

    // Full clean title query
    queries.push({ q: t, expectedTrack: t, expectedArtist: cleanArt || undefined });

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

  // Xử lý trường hợp LRCLIB lưu nguyên tiêu đề video YouTube vào trackName (vd "DÂU TẰM | Low G x tlinh")
  let cleanMatchTrack = match.trackName;
  const trackSegs = cleanMatchTrack.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/);
  if (trackSegs.length > 1) {
    cleanMatchTrack = trackSegs[0];
  }

  const mTrack = normalizeStr(cleanTitle(cleanMatchTrack));
  const mFullTrack = normalizeStr(cleanTitle(match.trackName));
  const mArtist = normalizeStr(match.artistName);

  if (expectedTrack) {
    const eTrack = normalizeStr(cleanTitle(expectedTrack));
    const exactSub = mTrack === eTrack || mTrack.startsWith(eTrack + ' ') || eTrack.startsWith(mTrack + ' ') || mFullTrack === eTrack;
    if (!exactSub) {
      const eWords = eTrack.split(' ').filter(w => w.length >= 2);
      if (eWords.length === 0) return false;
      if (eWords.length <= 3) {
        // Tên ngắn (<= 3 từ): Không được chèn từ lạ vào giữa (ví dụ "bước qua nhau" vs "bước qua đời nhau")
        const mCompact = mTrack.replace(/\s+/g, '');
        const eCompact = eTrack.replace(/\s+/g, '');
        if (!mCompact.includes(eCompact) && !eCompact.includes(mCompact)) {
          return false;
        }
      } else {
        const matchWords = eWords.filter(w => mTrack.includes(w));
        if (matchWords.length < Math.ceil(eWords.length * 0.7)) return false;
      }
    }
  }

  if (expectedArtist) {
    const artistList = Array.isArray(expectedArtist) ? expectedArtist : [expectedArtist];
    const artistOk = artistList.some(art => {
      if (!art) return false;
      const eArtist = normalizeStr(cleanArtistName(art));
      const artistWords = eArtist.split(' ').filter(w => w.length >= 2);
      if (artistWords.length === 0) return true;
      return artistWords.some(w => mArtist.includes(w) || mFullTrack.includes(w));
    });
    if (!artistOk) return false;
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

/**
 * Lấy lời bài hát chuẩn xác từ LRCLIB (Spotify / Apple Music database)
 */
async function fetchLyrics(rawTitle, artist = '', durationMs = 0) {
  if (!rawTitle) return null;

  // Lofi / Chill / Instrumental check
  const lowerTitle = rawTitle.toLowerCase();
  if (lowerTitle.includes('lofi') || lowerTitle.includes('lo-fi') || lowerTitle.includes('chillhop') || lowerTitle.includes('beats to') || lowerTitle.includes('không lời') || lowerTitle.includes('instrumental') || lowerTitle.includes('jazz hip-hop') || lowerTitle.includes('coffee shop')) {
    return {
      title: rawTitle,
      artist: artist || 'Lofi Chill',
      isLofi: true,
      lyrics: 'Bản nhạc Lofi tự động không lời ☕',
      syncedLyrics: null
    };
  }

  const variants = generateSearchVariants(rawTitle, artist);
  const targetDurationSec = durationMs ? durationMs / 1000 : 0;

  for (const item of variants) {
    try {
      // 1. Direct GET if track & artist are isolated
      if (item.track && item.artist) {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(item.track)}&artist_name=${encodeURIComponent(item.artist)}`;
        const res = await fetch(getUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/2.0 (Discord Music Bot)' }
        });
        if (res.ok) {
          const match = await res.json();
          if (match && (match.plainLyrics || match.syncedLyrics)) {
            if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
              const lyrics = match.plainLyrics || match.syncedLyrics;
              const cleanLyrics = lyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();

              return {
                title: match.trackName || rawTitle,
                artist: match.artistName || artist || '',
                lyrics: cleanLyrics,
                syncedLyrics: parseLrc(match.syncedLyrics),
                duration: match.duration,
                autoOffsetMs: 0
              };
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
            // 2. Khi có targetDurationSec > 0: ưu tiên |match.duration - targetDurationSec| <= 7s lên trước
            if (targetDurationSec > 0) {
              results.sort((a, b) => {
                const aValid = isValidMatch(a, item.expectedTrack || item.track, item.expectedArtist || item.artist);
                const bValid = isValidMatch(b, item.expectedTrack || item.track, item.expectedArtist || item.artist);
                if (aValid && !bValid) return -1;
                if (!aValid && bValid) return 1;

                const aHasDur = typeof a.duration === 'number' && a.duration > 0;
                const bHasDur = typeof b.duration === 'number' && b.duration > 0;
                const aDiff = aHasDur ? Math.abs(a.duration - targetDurationSec) : 9999;
                const bDiff = bHasDur ? Math.abs(b.duration - targetDurationSec) : 9999;

                const aClose = aDiff <= 7;
                const bClose = bDiff <= 7;
                if (aClose && !bClose) return -1;
                if (!aClose && bClose) return 1;

                return aDiff - bDiff;
              });
            }

            for (const match of results) {
              const lyrics = match?.syncedLyrics || match?.plainLyrics;
              if (lyrics && lyrics.trim().length > 10) {
                if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                  const cleanLyrics = lyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();

                  return {
                    title: match.trackName || rawTitle,
                    artist: match.artistName || artist || '',
                    lyrics: cleanLyrics,
                    syncedLyrics: parseLrc(match.syncedLyrics),
                    duration: match.duration,
                    autoOffsetMs: 0
                  };
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  // 3. Fallback qua microservice Python (syncedlyrics đa nguồn) nếu LRCLIB không tìm thấy
  const fallbackResult = await fetchLyricsFallback(rawTitle, artist, durationMs);
  if (fallbackResult) {
    return fallbackResult;
  }

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

    // Tách tên bài và ca sĩ nếu tiêu đề có dấu phân cách (ví dụ "Bước Qua Nhau / Vũ." hoặc "Donald Gold - OBGTLH x Lil Shady")
    let cleanTitleOnly = primaryClean;
    const segs = primaryClean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).filter(Boolean);
    if (segs.length >= 2) {
      const feat2 = splitFeat(segs[1]);
      if (feat2) {
        cleanTitleOnly = feat2.titlePart;
        if (!cleanArt || cleanArt === 'Unknown') {
          cleanArt = cleanArtistName(segs[0]);
        }
      } else {
        const feat1 = splitFeat(segs[0]);
        if (feat1) {
          cleanTitleOnly = feat1.titlePart;
          if (!cleanArt || cleanArt === 'Unknown') {
            cleanArt = cleanArtistName(segs[1]);
          }
        } else {
          cleanTitleOnly = segs[0].trim();
          if (!cleanArt || cleanArt === 'Unknown') {
            cleanArt = cleanArtistName(segs[1]);
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
  getLyrics: fetchLyrics
};
