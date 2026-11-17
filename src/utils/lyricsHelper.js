const { EventEmitter } = require('events');
const { resolveAppleMusicMetadata } = require('./appleMusicHelper');

// Import từ các providers chuyên biệt
const {
  isGarbageLyrics,
  normalizeStr,
  detectVariantTrack,
  cleanTitle,
  cleanArtistName,
  generateSearchVariants,
  generateVietnameseNumberVariants,
  isValidMatch,
  parseLrc,
  hasVietnameseSyllablePattern,
  isVietnameseTrack,
  isLyricLanguageConsistent
} = require('../providers/lyrics/lyricsTextUtils');

const {
  cacheYoutubeSubtitlesMeta,
  youtubeSubtitlesMetaCache,
  isSafeYouTubeUrl,
  extractVideoId,
  normalizeTargetUrl,
  fetchYtdlpInfo,
  resolveTrackLanguageRegion,
  getRankedSubtitleTracks,
  fetchYouTubeDescriptionLyrics,
  fetchYouTubeSubtitles,
  detectYouTubeIntroOffset
} = require('../providers/lyrics/YoutubeCcProvider');

const {
  fetchZingMp3Lyrics,
  findBestZingSong,
  getZingCookie
} = require('../providers/lyrics/ZingMp3Provider');

const {
  buildLrclibResult,
  fetchLrclibLyrics,
  fetchLyricsFallback
} = require('../providers/lyrics/LrclibProvider');

// Hệ thống Event Bus thông báo Lời bài hát về muộn (Hot-Attach Pub/Sub)
const lyricsEvents = new EventEmitter();
lyricsEvents.setMaxListeners(50);

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

/**
 * Đánh giá chất lượng của danh sách lời bài hát đồng bộ (Synced Lyrics)
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
 * Chọn bản lời bài hát tốt nhất từ danh sách ứng viên các tầng
 */
function pickBestLyricsCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (!a.quality.hasAbnormalGap && b.quality.hasAbnormalGap) return -1;
    if (a.quality.hasAbnormalGap && !b.quality.hasAbnormalGap) return 1;

    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

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

/**
 * Tự động sắp xếp và lọc các tầng nguồn theo khu vực ngôn ngữ của bài hát
 */
function getDynamicLyricsLayers(configuredLayers, trackRegion) {
  const baseLayers = (Array.isArray(configuredLayers) && configuredLayers.length > 0)
    ? [...configuredLayers]
    : ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'];

  if (trackRegion === 'KR' || trackRegion === 'JP' || trackRegion === 'CN') {
    return baseLayers.filter(l => l !== 'zingmp3');
  }

  if (trackRegion === 'INTL') {
    const withoutZing = baseLayers.filter(l => l !== 'zingmp3');
    if (baseLayers.includes('zingmp3')) {
      withoutZing.push('zingmp3');
    }
    return withoutZing;
  }

  return baseLayers;
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

  const appleMeta = await resolveAppleMusicMetadata(rawTitle, artist).catch(() => null);
  const trackRegion = resolveTrackLanguageRegion({ rawTitle, artist }, appleMeta);
  const activeLayers = getDynamicLyricsLayers(lyricsLayers, trackRegion);

  const cached = getCachedLyrics(cacheKey);
  if (cached) {
    if (cached.notFound) return cached;
    if (isGarbageLyrics(cached.lyrics)) {
      lyricsMemoryCache.delete(cacheKey);
    } else if (cached.isAutoAsr || (cached.source === 'youtube_cc' && !cached.isOfficialCc)) {
      lyricsMemoryCache.delete(cacheKey);
    } else if ((trackRegion === 'KR' || trackRegion === 'JP' || trackRegion === 'CN') && cached.source === 'zingmp3') {
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

  // 1. Ưu tiên chất lượng tuyệt đối: Đợi YouTube CC Subtitles trước
  if (activeLayers.includes('youtube_cc') && isYouTube && normalizedUrl) {
    try {
      const ytSubResult = await fetchYouTubeSubtitles(normalizedUrl, rawTitle, artist, trackKey, userSavedOffsetMs, appleMeta);
      if (ytSubResult?.syncedLyrics && ytSubResult.syncedLyrics.length >= 3) {
        setCachedLyrics(cacheKey, ytSubResult);
        lyricsEvents.emit('lyricsFound', {
          url: normalizedUrl || targetUrl,
          cacheKey,
          trackKey,
          lyricsData: ytSubResult
        });
        return ytSubResult;
      }
    } catch (ytSubErr) {}
  }

  // 2. Đua song song có trọng số cho các nguồn dự phòng còn lại
  const candidates = [];
  let hasTopPriorityPerfectWinner = false;
  let firstCandidateTimestamp = 0;
  const racePromises = [];

  const getLayerPriority = (layerName) => {
    const idx = activeLayers.indexOf(layerName);
    return idx !== -1 ? idx : 999;
  };

  const topRemainingLayer = activeLayers.find(l => l !== 'youtube_cc') || activeLayers[0];

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

    if (layerName === topRemainingLayer && !candidate.quality.hasAbnormalGap) {
      hasTopPriorityPerfectWinner = true;
    }
  };

  // Tầng 2: Zing MP3
  if (activeLayers.includes('zingmp3')) {
    racePromises.push((async () => {
      try {
        const zingResult = await fetchZingMp3Lyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, trackKey, userSavedOffsetMs, appleMeta);
        if (zingResult?.syncedLyrics) {
          recordCandidate('zingmp3', zingResult);
        } else if (zingResult?.lyrics && !plainFallback) {
          plainFallback = zingResult;
        }
      } catch (zingErr) {}
    })());
  }

  // Tầng 3: LRCLIB
  if (activeLayers.includes('lrclib')) {
    racePromises.push((async () => {
      try {
        const lrclibRes = await fetchLrclibLyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, cacheKey, trackKey, userSavedOffsetMs, appleMeta);
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

  // Tầng 4: SyncedLyrics Python Microservice (Staggered 300ms)
  if (activeLayers.includes('syncedlyrics')) {
    racePromises.push((async () => {
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

          if (hasFlawlessCandidate && elapsedSinceFirst >= 650) {
            clearInterval(interval);
            return resolve();
          }

          if (!hasFlawlessCandidate && elapsedSinceFirst >= 1200) {
            clearInterval(interval);
            return resolve();
          }
        }
      }, 30);

      const maxTimeoutMs = (activeLayers.includes('youtube_cc') && isYouTube) ? 4500 : 3500;
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, maxTimeoutMs);
    }),
    Promise.allSettled(racePromises)
  ]);

  const syncedWinner = pickBestLyricsCandidate(candidates);

  if (syncedWinner) {
    setCachedLyrics(cacheKey, syncedWinner);
    lyricsEvents.emit('lyricsFound', {
      url: normalizedUrl || targetUrl,
      cacheKey,
      trackKey,
      lyricsData: syncedWinner
    });
    return syncedWinner;
  }

  if (fallbackRecord && fallbackRecord.syncedLyrics) {
    const isActualRemixMismatch = detectVariantTrack(rawTitle);
    const fallbackRes = await buildLrclibResult(fallbackRecord, rawTitle, artist, normalizedUrl || targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, isActualRemixMismatch);
    if (fallbackRes) setCachedLyrics(cacheKey, fallbackRes);
    return fallbackRes;
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

function prefetchLyrics(rawTitle, artist = '', durationMs = 0, targetUrl = null, lyricsLayers = null) {
  if (!rawTitle) return;
  fetchLyrics(rawTitle, artist, durationMs, targetUrl, lyricsLayers)
    .then(res => {
      if (res && !res.notFound) {
        console.log(`[Lyrics Pre-fetch Cache] Đã nạp sẵn lời bài hát vào RAM: "${rawTitle}" (Source: ${res.source}, AutoOffset: ${res.autoOffsetMs || 0}ms)`);
        if (res.syncedLyrics && targetUrl) {
          lyricsEvents.emit('lyricsFound', {
            url: normalizeTargetUrl(targetUrl) || targetUrl,
            cacheKey: normalizeTargetUrl(targetUrl) || targetUrl,
            trackKey: res.trackKey,
            lyricsData: res
          });
        }
      }
    })
    .catch(() => {});
}

module.exports = {
  lyricsEvents,
  generateSearchVariants,
  cleanSearchVariants: generateSearchVariants,
  generateVietnameseNumberVariants,
  fetchZingMp3Lyrics,
  fetchLyrics,
  fetchLyricsFallback,
  getLyrics: fetchLyrics,
  prefetchLyrics,
  generateTrackKey,
  saveLyricOffset,
  getSavedLyricOffset,
  cacheYoutubeSubtitlesMeta,
  isGarbageLyrics,
  isVietnameseTrack,
  getRankedSubtitleTracks,
  normalizeStr,
  cleanTitle,
  cleanArtistName,
  isValidMatch,
  parseLrc,
  hasVietnameseSyllablePattern,
  isLyricLanguageConsistent,
  detectVariantTrack,
  fetchYouTubeSubtitles,
  fetchYouTubeDescriptionLyrics,
  fetchYtdlpInfo,
  detectYouTubeIntroOffset,
  evaluateLyricsQuality,
  pickBestLyricsCandidate,
  getDynamicLyricsLayers
};
