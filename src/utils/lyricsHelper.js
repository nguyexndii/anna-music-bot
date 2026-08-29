const fetch = globalThis.fetch || require('node-fetch');

function cleanSearchVariants(rawTitle, artist = '') {
  let clean = (rawTitle || '')
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/(?:year\s*\d+|official|music\s*video|mv|audio|visualizer|lyric\s*video|video|lyrics)/gi, '')
    .replace(/4k|hd|1080p/gi, '')
    .trim();

  const queries = [];

  // Split by //, |, -, :
  const segments = clean.split(/\s*(?:\/\/|\||-|:)\s*/).map(s => s.trim()).filter(Boolean);

  for (const seg of segments) {
    if (/\s+(?:ft\.?|feat\.?|x|&)\s+/i.test(seg)) {
      const parts = seg.split(/\s+(?:ft\.?|feat\.?|x|&)\s+/i).map(s => s.trim());
      if (parts.length >= 2) {
        queries.push({ track: parts[0], artist: parts[1], titleKey: parts[0] });
        queries.push({ track: parts[1], artist: parts[0], titleKey: parts[1] });
        queries.push({ q: `${parts[0]} ${parts[1]}`, titleKey: parts[0] });
        queries.push({ q: `${parts[1]} ${parts[0]}`, titleKey: parts[1] });
      }
    }
  }

  if (segments.length >= 2) {
    const partA = segments[0];
    const partB = segments[1].split(/\s+(?:ft\.?|feat\.?|x|&)\s+/i)[0].trim();
    // Thử cả 2 hướng: Track A - Artist B và Track B - Artist A (phổ biến trên YouTube: Ca sĩ - Tên bài)
    queries.push({ track: partA, artist: partB, titleKey: partA });
    queries.push({ track: partB, artist: partA, titleKey: partB });
    queries.push({ q: `${partA} ${partB}`, titleKey: partA });
    queries.push({ q: `${partB} ${partA}`, titleKey: partB });
    queries.push({ q: `${partA} ${segments[1]}`, titleKey: partA });
    queries.push({ q: `${segments[1]} ${partA}`, titleKey: segments[1] });
  }

  queries.push({ q: clean, titleKey: segments[0] || clean });
  if (artist) {
    queries.push({ q: `${clean} ${artist}`, titleKey: segments[0] || clean });
    queries.push({ track: clean, artist, titleKey: clean });
    if (segments.length > 0) {
      queries.push({ track: segments[0], artist, titleKey: segments[0] });
      if (segments[1]) queries.push({ track: segments[1], artist, titleKey: segments[1] });
    }
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const item of queries) {
    const key = item.track ? `${item.track}|${item.artist}` : item.q;
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

function isGoodMatch(searchItem, match) {
  if (!match || !match.trackName) return false;
  const matchTrack = match.trackName.toLowerCase();
  
  if (searchItem.track) {
    const t = searchItem.track.toLowerCase();
    return matchTrack.includes(t) || t.includes(matchTrack);
  }

  if (searchItem.titleKey) {
    const titleWords = searchItem.titleKey.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    if (titleWords.length > 0) {
      const hasTitleWord = titleWords.some(w => matchTrack.includes(w));
      if (!hasTitleWord) return false;
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
 * Lấy lời bài hát chuẩn xác 100% từ Spotify / Musixmatch (qua LRCLIB)
 */
async function fetchLyrics(rawTitle, artist = '') {
  const variants = cleanSearchVariants(rawTitle, artist);

  for (const item of variants) {
    try {
      if (item.track && item.artist) {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(item.track)}&artist_name=${encodeURIComponent(item.artist)}`;
        const res = await fetch(getUrl, {
          headers: { 'User-Agent': 'AnnaMusicBot/1.0 (Discord Music Bot)' }
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

      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(item.q)}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'AnnaMusicBot/1.0 (Discord Music Bot)' }
      });

      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];
        for (const match of results) {
          if (isGoodMatch(item, match)) {
            const lyrics = match.plainLyrics || match.syncedLyrics;
            if (lyrics && lyrics.trim().length > 15) {
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
    } catch (e) {}
  }
  return null;
}

module.exports = {
  cleanSearchVariants,
  fetchLyrics,
  getLyrics: fetchLyrics
};

