const fetch = globalThis.fetch || require('node-fetch');

function cleanSearchVariants(rawTitle, rawArtist = '') {
  if (!rawTitle) return [];

  // Remove common YouTube clutter
  let clean = rawTitle
    .replace(/\[(?:official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat).*?\]/gi, '')
    .replace(/\((?:official|mv|audio|visualizer|lyric|video|lyrics|4k|hd|1080p|prod\.?|beat).*?\)/gi, '')
    .replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?)/gi, '')
    .replace(/4k|hd|1080p/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const queries = [];

  // 1. Check for separators: - , | , : , /
  const separatorParts = clean.split(/\s*(?:[-|:/\\])\s*/).map(s => s.trim()).filter(Boolean);

  if (separatorParts.length >= 2) {
    const p1 = separatorParts[0];
    const p2 = separatorParts[1];

    // Case: Artist - Song (very common in VN/US music)
    queries.push({ track: p2, artist: p1, titleKey: p2 });
    // Case: Song - Artist
    queries.push({ track: p1, artist: p2, titleKey: p1 });

    queries.push({ q: `${p1} ${p2}` });
    queries.push({ q: `${p2} ${p1}` });
  }

  // 2. Check for ft. / feat. / x / &
  const ftMatch = clean.match(/(.*?)\s+(?:ft\.?|feat\.?|x|&)\s+(.*)/i);
  if (ftMatch) {
    const mainPart = ftMatch[1].trim();
    const guestPart = ftMatch[2].trim();
    queries.push({ track: mainPart, artist: guestPart, titleKey: mainPart });
    queries.push({ q: `${mainPart} ${guestPart}` });
    queries.push({ q: mainPart });
  }

  // 3. Clean version with parenthesis removed
  const noParens = clean.replace(/\(.*?\)/g, '').trim();
  if (noParens && noParens !== clean) {
    queries.push({ q: noParens });
  }

  // 4. Raw clean query
  queries.push({ q: clean });

  // 5. With provided artist if available
  if (rawArtist && rawArtist !== 'Unknown' && rawArtist !== 'YouTube Music') {
    queries.push({ track: clean, artist: rawArtist });
    queries.push({ q: `${clean} ${rawArtist}` });
    if (separatorParts.length >= 2) {
      queries.push({ track: separatorParts[0], artist: rawArtist });
      queries.push({ track: separatorParts[1], artist: rawArtist });
    }
  }

  // Deduplicate queries
  const seen = new Set();
  const deduped = [];
  for (const item of queries) {
    const key = item.track && item.artist ? `${item.track.toLowerCase()}|${item.artist.toLowerCase()}` : (item.q || '').toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
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
async function fetchLyrics(rawTitle, artist = '') {
  if (!rawTitle) return null;
  const variants = cleanSearchVariants(rawTitle, artist);

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
            const lyrics = match.plainLyrics || match.syncedLyrics;
            const cleanLyrics = lyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
            return {
              title: match.trackName || rawTitle,
              artist: match.artistName || artist || '',
              lyrics: cleanLyrics,
              syncedLyrics: parseLrc(match.syncedLyrics)
            };
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
            // Find first result with lyrics
            for (const match of results) {
              const lyrics = match?.syncedLyrics || match?.plainLyrics;
              if (lyrics && lyrics.trim().length > 10) {
                const cleanLyrics = lyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim();
                return {
                  title: match.trackName || rawTitle,
                  artist: match.artistName || artist || '',
                  lyrics: cleanLyrics,
                  syncedLyrics: parseLrc(match.syncedLyrics)
                };
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
  cleanSearchVariants,
  fetchLyrics,
  getLyrics: fetchLyrics
};


