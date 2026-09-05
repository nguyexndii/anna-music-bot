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
    }

    // Cuối cùng: tìm kiếm theo full clean title kết hợp với artist (nếu có)
    if (cleanArt && cleanArt !== 'Unknown' && cleanArt !== 'YouTube Music') {
      queries.push({ track: t, artist: cleanArt, expectedTrack: t, expectedArtist: cleanArt });
      queries.push({ q: `${t} ${cleanArt}`, expectedTrack: t, expectedArtist: cleanArt });
    }
    // Chỉ fallback q = t nếu không có artist nào
    queries.push({ q: t, expectedTrack: t, expectedArtist: cleanArt || undefined });
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
      // Kiểm tra xem có candidate nào khớp với expectedTrack không
      const trackMatched = candidateTrackNorms.some(cand => {
        if (!cand) return false;
        if (cand === eTrack || cand.startsWith(eTrack + ' ') || eTrack.startsWith(cand + ' ')) {
          return true;
        }
        const eWords = eTrack.split(' ').filter(w => w.length >= 2);
        if (eWords.length === 0) return false;
        if (eWords.length <= 3) {
          // Tên bài ngắn (1-3 từ): Không được lẫn từ lạ hoặc khác biệt
          const cCompact = cand.replace(/\s+/g, '');
          const eCompact = eTrack.replace(/\s+/g, '');
          return cCompact.includes(eCompact) || eCompact.includes(cCompact);
        } else {
          // Tên bài dài: Cần ít nhất 75% số từ khớp
          const matchWords = eWords.filter(w => cand.includes(w));
          return matchWords.length >= Math.ceil(eWords.length * 0.75);
        }
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

/**
 * Trích xuất phụ đề tiếng Việt (CC Subtitles) trực tiếp từ YouTube Video (Khớp 1000% cho Underground Rap MV)
 */
async function fetchYouTubeSubtitles(url) {
  if (!url || typeof url !== 'string' || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return null;
  }
  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true
    });

    const subs = info.subtitles || {};
    const auto = info.automatic_captions || {};

    // Ưu tiên phụ đề tiếng Việt do nghệ sĩ gắn (subs.vi), sau đó auto.vi, sau đó tiếng Anh
    const viSubList = subs.vi || subs['vi-VN'] || auto.vi || auto['vi-VN'] || subs.en || auto.en;
    if (!viSubList || !Array.isArray(viSubList) || viSubList.length === 0) {
      return null;
    }

    const subTarget = viSubList.find(s => s.ext === 'json3') || viSubList[0];
    if (!subTarget || !subTarget.url) return null;

    const res = await fetch(subTarget.url);
    if (!res.ok) return null;

    const data = await res.json();
    const events = data.events || [];
    const syncedLyrics = [];
    const plainLines = [];

    for (const ev of events) {
      const segs = ev.segs || [];
      const text = segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text || text === '[âm nhạc]' || text === '[Âm nhạc]' || text === '[Nhạc]' || text === '♪') continue;
      syncedLyrics.push({
        time: ev.tStartMs || 0,
        text
      });
      plainLines.push(text);
    }

    if (syncedLyrics.length >= 3) {
      console.log(`[Lyrics CC] Đã trích xuất ${syncedLyrics.length} câu phụ đề CC chuẩn từ video YouTube!`);
      return {
        title: info.title || 'YouTube Track',
        artist: info.uploader || info.channel || '',
        lyrics: plainLines.join('\n'),
        syncedLyrics,
        duration: info.duration,
        autoOffsetMs: 0,
        source: 'youtube_cc'
      };
    }
  } catch (e) {}
  return null;
}

/**
 * Lấy lời bài hát chuẩn xác từ LRCLIB (Spotify / Apple Music database)
 */
async function fetchLyrics(rawTitle, artist = '', durationMs = 0, targetUrl = null) {
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
  let plainFallback = null;

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
              if (match.syncedLyrics && match.syncedLyrics.trim().length > 10) {
                const cleanLyrics = match.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
                return {
                  title: match.trackName || rawTitle,
                  artist: match.artistName || artist || '',
                  lyrics: cleanLyrics,
                  syncedLyrics: parseLrc(match.syncedLyrics),
                  duration: match.duration,
                  autoOffsetMs: 0
                };
              } else if (!plainFallback && match.plainLyrics) {
                plainFallback = {
                  title: match.trackName || rawTitle,
                  artist: match.artistName || artist || '',
                  lyrics: match.plainLyrics.trim(),
                  syncedLyrics: null,
                  duration: match.duration,
                  autoOffsetMs: 0
                };
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
              const hasSynced = Boolean(match?.syncedLyrics && match.syncedLyrics.trim().length > 10);
              const hasPlain = Boolean(match?.plainLyrics && match.plainLyrics.trim().length > 10);

              if (hasSynced || hasPlain) {
                if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                  if (hasSynced) {
                    const cleanLyrics = match.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
                    return {
                      title: match.trackName || rawTitle,
                      artist: match.artistName || artist || '',
                      lyrics: cleanLyrics,
                      syncedLyrics: parseLrc(match.syncedLyrics),
                      duration: match.duration,
                      autoOffsetMs: 0
                    };
                  } else if (!plainFallback && hasPlain) {
                    plainFallback = {
                      title: match.trackName || rawTitle,
                      artist: match.artistName || artist || '',
                      lyrics: match.plainLyrics.trim(),
                      syncedLyrics: null,
                      duration: match.duration,
                      autoOffsetMs: 0
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

  // 2.5 Fallback Tầng 2: Trích xuất phụ đề YouTube CC trực tiếp (chuẩn nhịp 100% cho MV Rap Việt)
  if (targetUrl) {
    try {
      const ytSubResult = await fetchYouTubeSubtitles(targetUrl);
      if (ytSubResult && ytSubResult.syncedLyrics && ytSubResult.syncedLyrics.length >= 3) {
        return ytSubResult;
      }
    } catch (ytSubErr) {}
  }

  // 2.8 Nếu LRCLIB có bản lyric đọc (plain lyrics) thì dùng trước khi sang microservice/AI
  if (plainFallback) {
    return plainFallback;
  }

  // 3. Fallback qua microservice Python (syncedlyrics đa nguồn) nếu LRCLIB không tìm thấy
  const fallbackResult = await fetchLyricsFallback(rawTitle, artist, durationMs);
  if (fallbackResult) {
    return fallbackResult;
  }

  // 4. Fallback Tầng 3 qua Gemini AI ("Lyric Đọc" / Plain Lyrics hoàn chỉnh nếu cả LRCLIB & Microservice không có)
  try {
    const { getSongLyrics } = require('./geminiHelper');
    const geminiResult = await getSongLyrics(rawTitle, artist);
    if (geminiResult && geminiResult.lyrics && geminiResult.lyrics.trim().length > 10) {
      return {
        title: geminiResult.title || rawTitle,
        artist: geminiResult.artist || artist || '',
        lyrics: geminiResult.lyrics.trim(),
        syncedLyrics: null,
        duration: targetDurationSec || null,
        autoOffsetMs: 0,
        isAiGenerated: true
      };
    }
  } catch (aiErr) {
    console.warn('[Gemini AI Lyrics Fallback Error]:', aiErr.message);
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
  getLyrics: fetchLyrics
};
