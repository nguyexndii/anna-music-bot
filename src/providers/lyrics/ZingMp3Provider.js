const crypto = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');
const {
  cleanTitle,
  cleanArtistName,
  generateSearchVariants,
  generateVietnameseNumberVariants,
  normalizeStr,
  detectVariantTrack,
  parseLrc,
  isGarbageLyrics,
  isLyricLanguageConsistent
} = require('./lyricsTextUtils');
const {
  resolveTrackLanguageRegion,
  detectYouTubeIntroOffset
} = require('./YoutubeCcProvider');

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

const ROMAJI_HANGUL_ROMAJA_NOISE_REGEX = /\b(wasurerarenai|sayonara|anata|watashi|kokoro|modorenai|uketomeru|honto\s+ni|dekiru\s+koto|kono\s+mama|kimi\s+no|boku\s+no|aishiteru|saranghae|neukkyeobwa|sesangeul|michyeo|chagapdeon)\b/i;

function findBestZingSong(songs, targetTitle, targetArtist, expectedArtists = [], targetDurationSec = 0) {
  if (!Array.isArray(songs) || songs.length === 0) return null;
  const variants = generateVietnameseNumberVariants(cleanTitle(targetTitle));
  const cleanTargets = variants.map(v => normalizeStr(v)).filter(Boolean);
  const expArtList = (Array.isArray(expectedArtists) && expectedArtists.length > 0)
    ? expectedArtists
    : (targetArtist ? [targetArtist] : []);
  const cleanTargetArtists = expArtList
    .map(a => normalizeStr(cleanArtistName(a)))
    .filter(a => a && !['youtube', 'youtubemusic', 'unknown', 'variousartists'].includes(a));

  const isTitleExactOrStrongMatch = (sName) => {
    if (!sName) return false;
    return cleanTargets.some(ct => {
      if (sName === ct) return true;
      if (ct.length >= 7 && ct.includes(' ') && (sName.includes(ct) || ct.includes(sName))) {
        return true;
      }
      return false;
    });
  };

  if (cleanTargetArtists.length > 0) {
    const exactMatch = songs.find(s => {
      const sName = normalizeStr(s.name);
      const sArtist = normalizeStr(s.artist || s.artistsNames || '');
      const titleMatched = isTitleExactOrStrongMatch(sName);
      const artistMatched = cleanTargetArtists.some(cta => sArtist.includes(cta) || cta.includes(sArtist));
      if (!titleMatched || !artistMatched) return false;
      if (targetDurationSec > 30 && s.duration > 30 && !detectVariantTrack(targetTitle)) {
        if (Math.abs(Number(s.duration) - targetDurationSec) > 25) return false;
      }
      return true;
    });
    return exactMatch || null;
  }

  return songs.find(s => {
    const sName = normalizeStr(s.name);
    if (!cleanTargets.some(ct => sName === ct)) return false;
    if (targetDurationSec > 30 && s.duration > 30) {
      return Math.abs(Number(s.duration) - targetDurationSec) <= 12;
    }
    return true;
  }) || null;
}

async function fetchZingMp3Lyrics(rawTitle, artist = '', targetDurationSec = 0, targetUrl = null, trackKey = null, userSavedOffsetMs = 0, appleMeta = null) {
  try {
    const cleanT = cleanTitle(rawTitle);
    const cleanA = cleanArtistName(artist);
    if (!cleanT && !appleMeta?.canonicalTitle) return null;

    const variants = generateSearchVariants(rawTitle, artist, appleMeta);
    const titleVariants = [];
    const queries = [];
    const expectedArtists = [];

    if (cleanA && cleanA !== 'Unknown') {
      expectedArtists.push(cleanA);
    }

    for (const v of variants) {
      if (v.track && !titleVariants.includes(v.track)) {
        titleVariants.push(v.track);
      }
      if (v.track && v.artist) {
        const p = `${v.track} ${v.artist}`.trim();
        if (!queries.includes(p)) queries.push(p);
      }
      if (v.q && !queries.includes(v.q)) {
        queries.push(v.q);
      }
      if (Array.isArray(v.expectedArtist)) {
        for (const a of v.expectedArtist) {
          if (a && !expectedArtists.includes(a)) expectedArtists.push(a);
        }
      } else if (v.artist && !expectedArtists.includes(v.artist)) {
        expectedArtists.push(v.artist);
      }
    }

    if (titleVariants.length === 0) {
      titleVariants.push(...generateVietnameseNumberVariants(cleanT));
    }
    for (const tv of titleVariants) {
      if (!queries.includes(tv)) queries.push(tv);
    }

    let songList = null;
    let matchedSong = null;

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
          const candidate = findBestZingSong(songs, rawTitle, artist, expectedArtists, targetDurationSec);
          if (candidate) {
            songList = songs;
            matchedSong = candidate;
            break;
          }
        }
      }
    }

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

    const combinedText = plainLyrics || (syncedLyrics ? syncedLyrics.map(s => s.text).join('\n') : '');
    if (!isLyricLanguageConsistent(rawTitle, artist, combinedText)) {
      return null;
    }
    const region = resolveTrackLanguageRegion({ rawTitle, artist }, appleMeta);
    if (region !== 'VI' && ROMAJI_HANGUL_ROMAJA_NOISE_REGEX.test(combinedText)) {
      console.log(`[ZingMP3 Guard] Loại bỏ lời phiên âm Romaji/Romaja không chuẩn cho bài quốc tế: "${rawTitle}"`);
      return null;
    }

    let autoOffsetMs = 0;
    if (syncedLyrics && targetUrl && (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be'))) {
      try {
        autoOffsetMs = await detectYouTubeIntroOffset(targetUrl, syncedLyrics, targetDurationSec, Number(matchedSong.duration || 0));
      } catch (e) {}
    }

    return {
      title: matchedSong.name || rawTitle,
      artist: matchedSong.artist || matchedSong.artistsNames || artist || '',
      lyrics: plainLyrics || (syncedLyrics ? syncedLyrics.map(s => s.text).join('\n') : ''),
      syncedLyrics,
      duration: Number(matchedSong.duration || 0) || targetDurationSec,
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

module.exports = {
  ZING_API_KEY,
  ZING_SECRET_KEY,
  ZING_VERSION,
  getZingCookie,
  formatLrcTimestamp,
  ROMAJI_HANGUL_ROMAJA_NOISE_REGEX,
  findBestZingSong,
  fetchZingMp3Lyrics
};
