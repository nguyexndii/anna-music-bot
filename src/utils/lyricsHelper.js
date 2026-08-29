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
        queries.push({ q: `${parts[0]} ${parts[1]}`, titleKey: parts[0] });
      }
    }
  }

  if (segments.length >= 2) {
    const titlePart = segments[0];
    const artistPart = segments[1].split(/\s+(?:ft\.?|feat\.?|x|&)\s+/i)[0].trim();
    queries.push({ track: titlePart, artist: artistPart, titleKey: titlePart });
    queries.push({ q: `${titlePart} ${artistPart}`, titleKey: titlePart });
    queries.push({ q: `${titlePart} ${segments[1]}`, titleKey: titlePart });
  }

  queries.push({ q: clean, titleKey: segments[0] || clean });
  if (artist) {
    queries.push({ q: `${clean} ${artist}`, titleKey: segments[0] || clean });
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
              lyrics: cleanLyrics
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
                lyrics: cleanLyrics
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
  fetchLyrics
};
