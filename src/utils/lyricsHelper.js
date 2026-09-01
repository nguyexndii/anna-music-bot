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
  return str
    .replace(/\[.*?\]/g, '')
    .replace(/\((?:piano|acoustic|live|remix|official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat|feat\.?|ft\.?|version|ver|catena).*?\)/gi, '')
    .replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official)/gi, '')
    .replace(/4k|hd|1080p/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtists(artistStr) {
  if (!artistStr) return [];
  const clean = artistStr.replace(/prod\.?\s*by.*/gi, '').trim();
  const parts = clean.split(/\s*(?:ft\.?|feat\.?|x|&|\+|cùng|với|,)\s*/i).map(s => s.trim()).filter(Boolean);
  return parts;
}

function generateSearchVariants(rawTitle, rawArtist = '') {
  if (!rawTitle) return [];

  const queries = [];
  const primaryClean = cleanTitle(rawTitle);

  const rawSegments = primaryClean.split(/\s*[-|:/\\–—]\s*/).map(s => cleanTitle(s)).filter(Boolean);
  const meaningfulSegments = rawSegments.filter(s => s.length >= 2 && !/^(mv|official|audio|video|lyrics)$/i.test(s));

  if (meaningfulSegments.length >= 2) {
    const s1 = meaningfulSegments[0];
    const s2 = meaningfulSegments[1];

    const s1Artists = extractArtists(s1);
    const s2Artists = extractArtists(s2);

    for (const art of s2Artists) {
      queries.push({ track: s1, artist: art, expectedTrack: s1, expectedArtist: art });
      queries.push({ q: `${s1} ${art}`, expectedTrack: s1, expectedArtist: art });
    }
    queries.push({ track: s1, artist: s2, expectedTrack: s1, expectedArtist: s2 });
    queries.push({ q: `${s1} ${s2}`, expectedTrack: s1, expectedArtist: s2 });

    for (const art of s1Artists) {
      queries.push({ track: s2, artist: art, expectedTrack: s2, expectedArtist: art });
      queries.push({ q: `${s2} ${art}`, expectedTrack: s2, expectedArtist: art });
    }
    queries.push({ track: s2, artist: s1, expectedTrack: s2, expectedArtist: s1 });
    queries.push({ q: `${s2} ${s1}`, expectedTrack: s2, expectedArtist: s1 });
  }

  for (const seg of meaningfulSegments) {
    queries.push({ q: seg, expectedTrack: seg });
  }

  if (rawArtist && rawArtist !== 'Unknown' && rawArtist !== 'YouTube Music' && !rawArtist.includes('Topic') && !rawArtist.includes('Entertainment') && !rawArtist.includes('WxLF')) {
    queries.push({ track: primaryClean, artist: rawArtist, expectedTrack: primaryClean, expectedArtist: rawArtist });
    queries.push({ q: `${primaryClean} ${rawArtist}`, expectedTrack: primaryClean, expectedArtist: rawArtist });
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
  const mTrack = normalizeStr(match.trackName);
  const mArtist = normalizeStr(match.artistName);

  if (expectedTrack) {
    const eTrack = normalizeStr(cleanTitle(expectedTrack));
    const trackOk = mTrack.includes(eTrack) || eTrack.includes(mTrack);
    if (!trackOk) {
      const eWords = eTrack.split(' ').filter(w => w.length >= 2);
      if (eWords.length === 0) return false;
      const matchWords = eWords.filter(w => mTrack.includes(w));
      if (matchWords.length < Math.min(2, eWords.length)) return false;
    }
  }

  if (expectedArtist) {
    const eArtist = normalizeStr(expectedArtist);
    const artistWords = eArtist.split(' ').filter(w => w.length >= 2);
    if (artistWords.length > 0) {
      const artistOk = artistWords.some(w => mArtist.includes(w) || mTrack.includes(w));
      if (!artistOk) return false;
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

              let autoOffsetMs = 0;
              if (targetDurationSec > 0 && match.duration && (targetDurationSec - match.duration > 8) && (targetDurationSec - match.duration < 120)) {
                autoOffsetMs = Math.round((targetDurationSec - match.duration) * 1000);
              }

              return {
                title: match.trackName || rawTitle,
                artist: match.artistName || artist || '',
                lyrics: cleanLyrics,
                syncedLyrics: parseLrc(match.syncedLyrics),
                duration: match.duration,
                autoOffsetMs
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
          const results = Array.isArray(data) ? data : [data];
          if (results.length > 0) {
            for (const match of results) {
              const lyrics = match?.syncedLyrics || match?.plainLyrics;
              if (lyrics && lyrics.trim().length > 10) {
                if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
                  const cleanLyrics = lyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();

                  let autoOffsetMs = 0;
                  if (targetDurationSec > 0 && match.duration && (targetDurationSec - match.duration > 8) && (targetDurationSec - match.duration < 120)) {
                    autoOffsetMs = Math.round((targetDurationSec - match.duration) * 1000);
                  }

                  return {
                    title: match.trackName || rawTitle,
                    artist: match.artistName || artist || '',
                    lyrics: cleanLyrics,
                    syncedLyrics: parseLrc(match.syncedLyrics),
                    duration: match.duration,
                    autoOffsetMs
                  };
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

module.exports = {
  cleanSearchVariants: generateSearchVariants,
  fetchLyrics,
  getLyrics: fetchLyrics
};
