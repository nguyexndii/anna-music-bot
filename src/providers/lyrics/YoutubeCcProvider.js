const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');
const {
  normalizeStr,
  cleanTitle,
  cleanArtistName,
  isGarbageLyrics,
  isVietnameseTrack,
  hasVietnameseSyllablePattern,
  VIETNAMESE_REGEX
} = require('./lyricsTextUtils');

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

function normalizeTargetUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const vid = extractVideoId(url);
  if (vid) {
    return `https://www.youtube.com/watch?v=${vid}`;
  }
  return url.trim();
}

// ── BỘ TRÍCH XUẤT METADATA & SUBTITLES YOUTUBE ĐA TẦNG SIÊU NHẸ ──
const ytInfoCache = new Map();
const inFlightYtInfo = new Map();

let cachedCookieHeader = null;
let cachedCookieHeaderTime = 0;
const COOKIE_HEADER_TTL = 10 * 60 * 1000;

function getYouTubeCookieHeader() {
  const now = Date.now();
  if (cachedCookieHeader !== null && (now - cachedCookieHeaderTime < COOKIE_HEADER_TTL)) {
    return cachedCookieHeader;
  }

  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    path.resolve(__dirname, '../../../youtube.cookies'),
    path.resolve(process.cwd(), 'youtube.cookies'),
    '/root/anna-music-bot/youtube.cookies'
  ].filter(Boolean);

  let result = null;
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
          result = `CONSENT=YES+cb; PREF=hl=vi&gl=VN; ${pairs.slice(0, 40).join('; ')}`;
          break;
        }
      }
    } catch (e) {}
  }

  cachedCookieHeader = result || 'CONSENT=YES+cb; PREF=hl=vi&gl=VN';
  cachedCookieHeaderTime = now;
  return cachedCookieHeader;
}

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
        vssId,
        languageCode: lang,
        kind: cap.kind
      }
    ];

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

  try {
    const { isCpuOverloaded } = require('../../utils/systemMonitor');
    if (typeof isCpuOverloaded === 'function' && isCpuOverloaded(0.95)) {
      return null;
    }
  } catch (e) {}

  let extractionSemaphore = null;
  try {
    const mod = require('../../utils/musicExtractor');
    extractionSemaphore = mod.extractionSemaphore;
  } catch (e) {}

  const runDump = async () => {
    try {
      const infoOpts = {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        skipDownload: true,
        socketTimeout: 5,
        retries: 1,
        extractorArgs: 'youtube:player_client=android,ios,mweb',
        jsRuntimes: `node:${process.execPath}`,
        noCheckCertificates: true
      };

      const candidates = [
        process.env.YTDLP_COOKIES_FILE,
        path.resolve(__dirname, '../../../youtube.cookies'),
        path.resolve(process.cwd(), 'youtube.cookies'),
        '/root/anna-music-bot/youtube.cookies'
      ].filter(Boolean);

      for (const cookiePath of candidates) {
        if (fs.existsSync(cookiePath) && fs.statSync(cookiePath).size > 100) {
          infoOpts.cookies = cookiePath;
          break;
        }
      }

      const info = await Promise.race([
        ytdlp(url, infoOpts),
        new Promise((_, rej) => setTimeout(() => rej(new Error('yt-dlp subtitle timeout')), 5500))
      ]).catch(() => null);

      if (!info) return null;
      const videoId = extractVideoId(url);
      if (videoId && (info.subtitles || info.automatic_captions)) {
        cacheYoutubeSubtitlesMeta(videoId, info.subtitles, info.automatic_captions);
      }
      return info;
    } catch (err) {
      return null;
    }
  };

  if (extractionSemaphore && typeof extractionSemaphore.run === 'function') {
    return await extractionSemaphore.run(runDump, 'low');
  }
  return await runDump();
}

async function _executeFetchYtdlpInfo(url, norm) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const cookieHeader = getYouTubeCookieHeader();

  // PHƯƠNG PHÁP 1: InnerTube JSON API
  const innerTubeClients = [
    {
      name: 'ANDROID_VR',
      version: '1.60.19',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
      skipThirdParty: true
    },
    {
      name: 'IOS',
      version: '20.03.02',
      ua: 'com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)',
      extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.2.1.22C161' },
      skipThirdParty: true
    },
    {
      name: 'WEB_REMIX',
      version: '1.20250115.01.00',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extra: {}
    }
  ];

  let fallbackParsedInfo = null;

  for (const clientCfg of innerTubeClients) {
    try {
      const contextClient = {
        clientName: clientCfg.name,
        clientVersion: clientCfg.version,
        hl: 'vi',
        gl: 'VN',
        ...clientCfg.extra
      };
      const contextObj = {
        client: contextClient,
        ...(clientCfg.skipThirdParty ? {} : {
          thirdParty: {
            embedUrl: 'https://www.youtube.com/'
          }
        })
      };

      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': clientCfg.ua,
          'Cookie': cookieHeader
        },
        body: JSON.stringify({
          videoId,
          context: contextObj
        }),
        signal: AbortSignal.timeout(2500)
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = buildParsedPlayerInfo(data);
        const hasValidDetails = Boolean(data?.videoDetails?.videoId || parsed?.title || (parsed?.duration > 0));
        if (parsed && hasValidDetails) {
          if (parsed.hasCaptions) {
            setCachedYtdlpInfo(url, parsed);
            return parsed;
          }
          if (!fallbackParsedInfo) {
            fallbackParsedInfo = parsed;
          }
        }
      }
    } catch (clientErr) {}
  }

  // PHƯƠNG PHÁP 2: Tải Watch Page HTML
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
      if (parsed && parsed.hasCaptions) {
        const finalInfo = fallbackParsedInfo ? {
          ...fallbackParsedInfo,
          ...parsed,
          subtitles: { ...(fallbackParsedInfo.subtitles || {}), ...(parsed.subtitles || {}) },
          automatic_captions: { ...(fallbackParsedInfo.automatic_captions || {}), ...(parsed.automatic_captions || {}) },
          hasCaptions: true
        } : parsed;
        setCachedYtdlpInfo(url, finalInfo);
        return finalInfo;
      }
    }
  } catch (watchErr) {}

  // PHƯƠNG PHÁP 3: Fallback yt-dlp
  try {
    const ytdlpInfo = await fetchOfficialSubtitlesViaYtdlp(url);
    if (ytdlpInfo && (ytdlpInfo.subtitles || ytdlpInfo.automatic_captions)) {
      const merged = {
        title: ytdlpInfo.title || fallbackParsedInfo?.title || '',
        uploader: ytdlpInfo.uploader || ytdlpInfo.channel || fallbackParsedInfo?.uploader || '',
        channel: ytdlpInfo.channel || ytdlpInfo.uploader || fallbackParsedInfo?.channel || '',
        duration: ytdlpInfo.duration || fallbackParsedInfo?.duration || 0,
        description: ytdlpInfo.description || fallbackParsedInfo?.description || '',
        subtitles: ytdlpInfo.subtitles || {},
        automatic_captions: ytdlpInfo.automatic_captions || {},
        hasCaptions: true
      };
      setCachedYtdlpInfo(url, merged);
      return merged;
    }
  } catch (ytdlpFallbackErr) {}

  if (fallbackParsedInfo) {
    setCachedYtdlpInfo(url, fallbackParsedInfo);
    return fallbackParsedInfo;
  }

  setCachedYtdlpInfo(url, { _empty: true });
  return null;
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

function resolveTrackLanguageRegion(context = {}, appleMeta = null) {
  if (appleMeta && appleMeta.region) return appleMeta.region;
  try {
    const { detectTrackRegion } = require('../../utils/musicExtractor');
    if (typeof detectTrackRegion === 'function') {
      const reg = detectTrackRegion(
        `${context.rawTitle || ''} ${context.videoTitle || ''}`.trim(),
        `${context.artist || ''} ${context.uploader || ''}`.trim()
      );
      if (reg) return reg;
    }
  } catch (e) {}
  return isVietnameseTrack(context) ? 'VI' : 'INTL';
}

function getRankedSubtitleTracks(subsMap, context = {}, appleMeta = null, allowAsr = false) {
  if (!subsMap || typeof subsMap !== 'object') return [];
  const entries = Object.entries(subsMap).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
  if (entries.length === 0) return [];

  const region = resolveTrackLanguageRegion(context, appleMeta);
  const isVN = region === 'VI';
  const isKR = region === 'KR';
  const isJP = region === 'JP';
  const isCN = region === 'CN';

  const scored = entries.map(([key, trackArr]) => {
    const track = trackArr[0];
    const kLow = key.toLowerCase();
    const nameLow = String(track?.name || '').toLowerCase();
    const vssId = String(track?.vssId || '');
    const langCode = String(track?.languageCode || kLow).toLowerCase();
    const isAsr = track?.kind === 'asr' || vssId.startsWith('a.');
    let score = 0;

    // Tránh các bản dịch tự động sang ngôn ngữ khác (vssId có dạng .t.)
    if (vssId.includes('.t.') || kLow.includes('tlang=')) {
      return { key, trackArr, score: -999 };
    }

    // Nếu không cho phép Auto ASR mà track là ASR -> Loại bỏ ngay lập tức!
    if (!allowAsr && isAsr) {
      return { key, trackArr, score: -999 };
    }

    const isViLang = langCode === 'vi' || langCode.startsWith('vi-') || langCode.startsWith('vi_') || kLow === 'vi' || kLow.startsWith('vi-') || kLow.startsWith('vi_');
    const isViName = /tiếng việt|vietnamese|việt|viet|vietsub/i.test(nameLow);

    if (isVN) {
      if (isViLang && !isAsr) {
        score += 150;
      } else if (isViLang) {
        score += 100;
      } else if (isViName && !isAsr) {
        score += 120;
      } else if (isViName) {
        score += 85;
      } else if (kLow.startsWith('und')) {
        score += 45;
      } else if (!isAsr && (kLow.startsWith('en') || langCode.startsWith('en'))) {
        score += 15;
      } else {
        score -= 150;
      }
    } else if (isKR) {
      if (isViLang || isViName) score -= 999;
      else if (kLow.startsWith('ko') || langCode.startsWith('ko')) score += 150;
      else if (kLow.startsWith('en') || langCode.startsWith('en')) score += 60;
      else if (kLow.startsWith('und')) score += 30;
      else score -= 50;
    } else if (isJP) {
      if (isViLang || isViName) score -= 999;
      else if (kLow.startsWith('ja') || langCode.startsWith('ja')) score += 150;
      else if (kLow.startsWith('en') || langCode.startsWith('en')) score += 60;
      else if (kLow.startsWith('und')) score += 30;
      else score -= 50;
    } else if (isCN) {
      if (isViLang || isViName) score -= 999;
      else if (kLow.startsWith('zh') || langCode.startsWith('zh')) score += 150;
      else if (kLow.startsWith('en') || langCode.startsWith('en')) score += 50;
      else if (kLow.startsWith('und')) score += 30;
      else score -= 50;
    } else {
      if (isViLang || isViName) {
        score -= 999;
      } else if (kLow === 'en' || kLow === 'en-orig' || kLow.startsWith('en-') || kLow.startsWith('en_') || langCode.startsWith('en')) {
        score += 150;
      } else if (kLow.startsWith('und')) {
        score += 30;
      } else {
        score -= 50;
      }
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

function buildCaptionFormatUrl(rawUrl, fmt = 'json3', stripExp = false) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    const sparams = (u.searchParams.get('sparams') || '').split(',').map(s => s.trim().toLowerCase());
    const isExpInSparams = sparams.includes('exp');

    if (stripExp || !isExpInSparams) {
      u.searchParams.delete('exp');
    }
    u.searchParams.set('fmt', fmt);
    return u.toString();
  } catch (e) {
    const hasExpInSparams = /[?&]sparams=[^&]*\bexp\b/i.test(rawUrl);
    let clean = rawUrl;
    if (stripExp || !hasExpInSparams) {
      clean = clean.replace(/([?&])exp=[^&]+/g, '$1');
    }
    clean = clean
      .replace(/([?&])fmt=[^&]+/g, '$1')
      .replace(/[?&]&+/g, '?')
      .replace(/\?$/, '');
    return clean + (clean.includes('?') ? `&fmt=${fmt}` : `?fmt=${fmt}`);
  }
}

async function downloadAndParseCaptionEvents(subTarget) {
  if (!subTarget || (!subTarget.url && !subTarget.rawUrl)) return [];
  const rawUrl = subTarget.rawUrl || subTarget.url;
  const json3Url = buildCaptionFormatUrl(rawUrl, 'json3');

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Origin': 'https://www.youtube.com',
    'Referer': 'https://www.youtube.com/',
    'Cookie': getYouTubeCookieHeader()
  };

  const fetchCaptionTextWithExpFallback = async (targetUrl, fmt = 'json3') => {
    try {
      let res = await fetch(targetUrl, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(3500)
      });
      let text = res.ok ? await res.text() : '';

      if (res.ok && (!text || text.trim().length === 0)) {
        const strippedUrl = buildCaptionFormatUrl(targetUrl, fmt, true);
        if (strippedUrl && strippedUrl !== targetUrl) {
          const fallbackRes = await fetch(strippedUrl, {
            headers: browserHeaders,
            signal: AbortSignal.timeout(3500)
          });
          if (fallbackRes.ok) {
            text = await fallbackRes.text();
          }
        }
      }
      return text;
    } catch (e) {
      return '';
    }
  };

  const candidateUrls = [
    subTarget.url,
    json3Url
  ].filter((u, idx, arr) => u && arr.indexOf(u) === idx);

  for (const targetUrl of candidateUrls) {
    const text = await fetchCaptionTextWithExpFallback(targetUrl, 'json3');
    if (text && text.trim().startsWith('{')) {
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data.events) && data.events.length > 0) {
          return data.events;
        }
      } catch (parseErr) {}
    }
  }

  const xmlFallbackUrls = [
    buildCaptionFormatUrl(rawUrl, 'srv3'),
    rawUrl
  ];

  for (const xmlUrl of xmlFallbackUrls) {
    const xml = await fetchCaptionTextWithExpFallback(xmlUrl, 'srv3');
    if (xml) {
      const events = [];
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
  }

  return [];
}

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

    const subLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const validSubLines = [];

    for (const subLine of subLines) {
      let cleaned = subLine.replace(/^[♪♫♬\s\-–—]+|[♪♫♬\s\-–—]+$/g, '').trim();
      cleaned = cleaned.replace(/^[>»]+\s*/g, '').trim();
      cleaned = cleaned.replace(/\[\s*(?:âm\s*nhạc|nhạc|tiếng\s*vỗ\s*tay|tiếng\s*cười|tiếng\s*hò\s*reo|music|applause|laughter|intro|outro|lời\s*bài\s*hát|subtitles?|caption|instrumental)\s*\]/gi, '').trim();
      cleaned = cleaned.replace(/\(\s*(?:âm\s*nhạc|nhạc|tiếng\s*vỗ\s*tay|tiếng\s*cười|tiếng\s*hò\s*reo|music|applause|laughter|intro|outro|instrumental)\s*\)/gi, '').trim();
      cleaned = cleaned.replace(/^[♪♫♬\s\-–—]+|[♪♫♬\s\-–—]+$/g, '').trim();
      if (!cleaned) continue;
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
      if (prev && prev.text === lineText && Math.abs(startMs - prev.time) < 1500) {
        continue;
      }
      syncedLyrics.push({ time: startMs, text: lineText });
      plainLines.push(lineText);
    } else {
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

async function fetchYouTubeSubtitles(url, rawTitle = '', artist = '', trackKey = null, userSavedOffsetMs = 0, appleMeta = null) {
  if (!isSafeYouTubeUrl(url)) return null;
  const videoId = extractVideoId(url);

  try {
    let info = null;
    if (videoId && youtubeSubtitlesMetaCache.has(videoId)) {
      const cachedMeta = youtubeSubtitlesMetaCache.get(videoId);
      const hasAnySubs = (cachedMeta?.subtitles && Object.keys(cachedMeta.subtitles).length > 0) ||
                         (cachedMeta?.automaticCaptions && Object.keys(cachedMeta.automaticCaptions).length > 0);
      if (hasAnySubs) {
        info = {
          title: rawTitle,
          uploader: artist,
          subtitles: cachedMeta.subtitles || {},
          automatic_captions: cachedMeta.automaticCaptions || {}
        };
      }
    }

    if (!info) {
      info = await fetchYtdlpInfo(url);
    }
    if (!info) return null;

    const context = {
      rawTitle,
      artist,
      videoTitle: info?.title || '',
      uploader: info?.uploader || info?.channel || ''
    };

    const region = resolveTrackLanguageRegion(context, appleMeta);
    const isVN = region === 'VI';
    const isKR = region === 'KR';
    const isJP = region === 'JP';
    const isCN = region === 'CN';

    // CHỈ duyệt phụ đề chính thức (Official CC) - TUYỆT ĐỐI KHÔNG LẤY AUTO ASR!
    const rankedOfficialTracks = getRankedSubtitleTracks(info?.subtitles || {}, context, appleMeta, false);
    if (!rankedOfficialTracks || rankedOfficialTracks.length === 0) {
      return null;
    }

    const validateAndBuildCcResult = (syncedLyrics, plainLines) => {
      const minLines = 5;
      if (syncedLyrics.length < minLines) return null;
      const sampleText = plainLines.slice(0, 25).join(' ');
      if (isVN) {
        const hasVnAccents = VIETNAMESE_REGEX.test(sampleText);
        if (!hasVnAccents) {
          const englishStopWords = /\b(the|and|you|that|with|have|this|from|they|will|would|there|their|what|about|which|when|make|like|time|just|know|take|people|into|year|your|good|some|could|them|other|than|then|now|look|only|come|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/gi;
          const engMatches = sampleText.match(englishStopWords) || [];
          const hasVnSyllables = typeof hasVietnameseSyllablePattern === 'function' && hasVietnameseSyllablePattern(sampleText);
          if (engMatches.length >= 6 && !hasVnSyllables) return null;
        }
      } else {
        if (VIETNAMESE_REGEX.test(sampleText)) return null;
        if (!isJP && !isKR && !isCN && /[\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(sampleText)) {
          return null;
        }
      }

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
    };

    for (const candidateTrackList of rankedOfficialTracks) {
      const subTarget = candidateTrackList.find(s => s.ext === 'json3') || candidateTrackList[0];
      if (!subTarget) continue;

      const events = await downloadAndParseCaptionEvents(subTarget);
      if (!events || events.length === 0) continue;

      const { syncedLyrics, plainLines } = convertEventsToSyncedLyrics(events);
      const res = validateAndBuildCcResult(syncedLyrics, plainLines);
      if (res) {
        console.log(`[Lyrics CC Official] Đã trích xuất ${syncedLyrics.length} câu phụ đề CC chính thức từ video YouTube: ${info.title || url}`);
        return res;
      }
    }
  } catch (e) {}
  return null;
}

async function detectYouTubeIntroOffset(url, syncedLyrics, targetDurationSec, lrcDurationSec = 0) {
  if (!isSafeYouTubeUrl(url) || !syncedLyrics || syncedLyrics.length === 0) return 0;

  // BƯỚC 0: Nhận diện SponsorBlock API
  const videoId = extractVideoId(url);
  if (videoId) {
    try {
      const sbUrl = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${encodeURIComponent(JSON.stringify(['music_offtopic']))}`;
      const sbRes = await fetch(sbUrl, { signal: AbortSignal.timeout(1000) });
      if (sbRes.ok) {
        const segments = await sbRes.json();
        if (Array.isArray(segments)) {
          const introSeg = segments.find(s =>
            Array.isArray(s.segment) &&
            s.segment[0] <= 3.0 &&
            s.segment[1] >= 2.0 &&
            s.segment[1] <= 180.0 &&
            (s.locked === 1 || Number(s.votes) >= 2)
          );
          if (introSeg) {
            const introDurationMs = Math.round(introSeg.segment[1] * 1000);
            console.log(`[Lyrics Auto-Offset SponsorBlock] Phát hiện MV có đoạn kịch/offtopic đầu video dài ${(introDurationMs / 1000).toFixed(2)}s, tự động lùi mốc lời!`);
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

  // BƯỚC 1: Căn nhịp qua YouTube Captions / Auto-Captions (ASR)
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

  return 0;
}

module.exports = {
  cacheYoutubeSubtitlesMeta,
  youtubeSubtitlesMetaCache,
  isSafeYouTubeUrl,
  extractVideoId,
  normalizeTargetUrl,
  getYouTubeCookieHeader,
  extractJsonAssignedToVar,
  buildParsedPlayerInfo,
  setCachedYtdlpInfo,
  fetchYtdlpInfo,
  resolveTrackLanguageRegion,
  getRankedSubtitleTracks,
  decodeHtmlEntities,
  buildCaptionFormatUrl,
  downloadAndParseCaptionEvents,
  convertEventsToSyncedLyrics,
  extractLyricsFromDescription,
  fetchYouTubeDescriptionLyrics,
  fetchOfficialSubtitlesViaYtdlp,
  fetchYouTubeSubtitles,
  detectYouTubeIntroOffset
};
