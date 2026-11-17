const fetch = globalThis.fetch || require('node-fetch');
const {
  isGarbageLyrics,
  parseLrc,
  detectVariantTrack,
  isLyricLanguageConsistent,
  isValidMatch,
  generateSearchVariants,
  stripParentheses,
  cleanTitle,
  cleanArtistName,
  normalizeStr
} = require('./lyricsTextUtils');
const { detectYouTubeIntroOffset } = require('./YoutubeCcProvider');

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
  return lrclibResult;
}

async function querySingleLrclibVariant(item, rawTitle, artist, targetDurationSec, targetUrl, cacheKey, trackKey, userSavedOffsetMs) {
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
          if (!isGarbageLyrics(match.plainLyrics) && !isGarbageLyrics(match.syncedLyrics) && isLyricLanguageConsistent(rawTitle, artist, match.plainLyrics || match.syncedLyrics)) {
            if (isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
              const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
              const isExactTier1 = (durDiff <= 15) || (!detectVariantTrack(rawTitle) && durDiff <= 60) || (targetDurationSec === 0);

              if (isExactTier1) {
                if (match.syncedLyrics && match.syncedLyrics.trim().length > 10) {
                  const built = await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, false);
                  if (built) return { exactSynced: built };
                } else if (match.plainLyrics) {
                  return {
                    plainFallback: {
                      title: match.trackName || rawTitle,
                      artist: match.artistName || artist || '',
                      lyrics: match.plainLyrics.trim(),
                      syncedLyrics: null,
                      duration: match.duration,
                      autoOffsetMs: 0,
                      trackKey,
                      userSavedOffsetMs: userSavedOffsetMs || 0,
                      source: 'lrclib'
                    }
                  };
                }
              } else {
                return { fallbackRecord: match };
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

            if ((hasSynced || hasPlain) && !isGarbageLyrics(match.plainLyrics) && !isGarbageLyrics(match.syncedLyrics) && isLyricLanguageConsistent(rawTitle, artist, match.plainLyrics || match.syncedLyrics) && isValidMatch(match, item.expectedTrack || item.track, item.expectedArtist || item.artist)) {
              const durDiff = (targetDurationSec > 0 && typeof match.duration === 'number') ? Math.abs(match.duration - targetDurationSec) : 0;
              const isExactTier1 = (durDiff <= 15) || (!detectVariantTrack(rawTitle) && durDiff <= 60) || (targetDurationSec === 0);

              if (isExactTier1) {
                if (hasSynced) {
                  const built = await buildLrclibResult(match, rawTitle, artist, targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, false);
                  if (built) return { exactSynced: built };
                } else if (hasPlain) {
                  return {
                    plainFallback: {
                      title: match.trackName || rawTitle,
                      artist: match.artistName || artist || '',
                      lyrics: match.plainLyrics.trim(),
                      syncedLyrics: null,
                      duration: match.duration,
                      autoOffsetMs: 0,
                      trackKey,
                      userSavedOffsetMs: userSavedOffsetMs || 0,
                      source: 'lrclib'
                    }
                  };
                }
              } else {
                return { fallbackRecord: match };
              }
            }
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

async function fetchLrclibLyrics(rawTitle, artist = '', targetDurationSec = 0, targetUrl = null, cacheKey = null, trackKey = null, userSavedOffsetMs = 0, appleMeta = null) {
  const variants = generateSearchVariants(rawTitle, artist, appleMeta).slice(0, 6);
  let plainFallback = null;
  let fallbackRecord = null;

  // Chạy song song 3 biến thể ưu tiên cao nhất cùng lúc (Promise.all)
  const primaryVariants = variants.slice(0, 3);
  const secondaryVariants = variants.slice(3);

  const primaryResults = await Promise.all(
    primaryVariants.map(v => querySingleLrclibVariant(v, rawTitle, artist, targetDurationSec, targetUrl, cacheKey, trackKey, userSavedOffsetMs))
  );

  for (const res of primaryResults) {
    if (!res) continue;
    if (res.exactSynced) return { exactSynced: res.exactSynced };
    if (!plainFallback && res.plainFallback) plainFallback = res.plainFallback;
    if (!fallbackRecord && res.fallbackRecord) fallbackRecord = res.fallbackRecord;
  }

  // Nếu 3 biến thể đầu chưa ra exactSynced, duyệt tuần tự các biến thể phụ còn lại
  for (const item of secondaryVariants) {
    const res = await querySingleLrclibVariant(item, rawTitle, artist, targetDurationSec, targetUrl, cacheKey, trackKey, userSavedOffsetMs);
    if (!res) continue;
    if (res.exactSynced) return { exactSynced: res.exactSynced };
    if (!plainFallback && res.plainFallback) plainFallback = res.plainFallback;
    if (!fallbackRecord && res.fallbackRecord) fallbackRecord = res.fallbackRecord;
  }

  return { plainFallback, fallbackRecord };
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

module.exports = {
  buildLrclibResult,
  querySingleLrclibVariant,
  fetchLrclibLyrics,
  fetchLyricsFallback
};
