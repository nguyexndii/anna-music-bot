const { EventEmitter } = require('events');
const { resolveAppleMusicMetadata } = require('./appleMusicHelper');

// Import từ các providers chuyên biệt
const {
  isGarbageLyrics,
  normalizeStr,
  detectVariantTrack,
  detectVariantTag,
  simpleStringHash,
  generateMultiFactorFingerprint,
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

let LyricCache = null;
try {
  LyricCache = require('../database/models/LyricCache');
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
  // Giảm Negative Cache RAM xuống 30s (khi không tìm thấy lời)
  const ttl = item.data?.notFound ? (30 * 1000) : (3600 * 1000);
  if (Date.now() - item.ts > ttl) {
    lyricsMemoryCache.delete(key);
    return null;
  }
  if (item.data && !item.data.notFound) {
    if (item.data.autoOffsetMs === undefined) item.data.autoOffsetMs = 0;
    if (item.data.isRemixOrDurationMismatch === undefined) item.data.isRemixOrDurationMismatch = false;
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
 * Tra cứu bộ nhớ đệm vĩnh viễn trên MongoDB Atlas
 */
async function getPersistentLyricCache(songFingerprint, lookupKeys = []) {
  if (!LyricCache) return null;
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return null;

    let doc = await LyricCache.findOne({ songFingerprint }).lean();
    if (!doc && Array.isArray(lookupKeys) && lookupKeys.length > 0) {
      doc = await LyricCache.findOne({ lookupKeys: { $in: lookupKeys } }).sort({ qualityScore: -1 }).lean();
    }
    return doc;
  } catch (err) {
    console.error('[LyricCache Read Error]:', err.message);
    return null;
  }
}

/**
 * Lưu bộ nhớ đệm vĩnh viễn trên MongoDB Atlas với Multi-Factor Fingerprint
 */
async function savePersistentLyricCache(data, songFingerprint, lookupKeys = []) {
  if (!LyricCache || !data || !songFingerprint || data.notFound) return;
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return;

    const payload = {
      songFingerprint,
      title: data.title || '',
      artist: data.artist || '',
      variantTag: detectVariantTag(data.title || ''),
      durationSec: Math.round(Number(data.duration) || 0),
      type: (Array.isArray(data.syncedLyrics) && data.syncedLyrics.length > 0) ? 'synced' : (data.isLofi ? 'instrumental' : 'plain'),
      lyrics: data.lyrics || '',
      syncedLyrics: Array.isArray(data.syncedLyrics) ? data.syncedLyrics : [],
      source: data.source || 'lrclib',
      qualityScore: data.qualityScore || ((Array.isArray(data.syncedLyrics) && data.syncedLyrics.length > 0) ? 85 : 50),
      language: data.language || 'unknown',
      autoOffsetMs: Number(data.autoOffsetMs) || 0,
      isRemixOrDurationMismatch: Boolean(data.isRemixOrDurationMismatch)
    };

    const validLookupKeys = Array.isArray(lookupKeys) ? lookupKeys.filter(Boolean) : [];

    await LyricCache.findOneAndUpdate(
      { songFingerprint },
      {
        $set: payload,
        $addToSet: { lookupKeys: { $each: validLookupKeys } }
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[LyricCache Write Error]:', err.message);
  }
}

/**
 * Báo lỗi & Hủy Cache chống DoS: Yêu cầu ít nhất 3 user IDs khác nhau báo lỗi
 */
async function reportLyricCacheIssue(songFingerprint, userId) {
  if (!songFingerprint || !userId) return { success: false, reason: 'INVALID_PARAMS' };

  const deleteRamCache = (fp, extraKeys = []) => {
    lyricsMemoryCache.delete(fp);
    for (const [key, val] of lyricsMemoryCache.entries()) {
      if (val?.data?.songFingerprint === fp || (Array.isArray(extraKeys) && extraKeys.includes(key))) {
        lyricsMemoryCache.delete(key);
      }
    }
  };

  deleteRamCache(songFingerprint);

  if (!LyricCache) return { success: false, reason: 'NO_DB' };
  try {
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return { success: false, reason: 'DB_DISCONNECTED' };
    }

    const doc = await LyricCache.findOneAndUpdate(
      { songFingerprint },
      { $addToSet: { reportedBy: String(userId) } },
      { new: true }
    );

    if (!doc) return { success: false, reason: 'NOT_FOUND' };

    const uniqueReporters = new Set(doc.reportedBy || []).size;
    if (uniqueReporters >= 3) {
      await LyricCache.deleteOne({ _id: doc._id });
      deleteRamCache(songFingerprint, doc.lookupKeys);
      console.log(`[LyricCache] Đã xóa cache cho "${doc.title}" sau khi nhận đủ 3 báo lỗi từ 3 người dùng khác nhau.`);
      return { success: true, invalidated: true, uniqueReporters };
    }

    return { success: true, invalidated: false, uniqueReporters };
  } catch (err) {
    return { success: false, reason: err.message };
  }
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

  let targetDurationSec = durationMs ? durationMs / 1000 : 0;
  const rawVideoId = isYouTube ? extractVideoId(normalizedUrl) : null;
  let songFingerprint = generateMultiFactorFingerprint(rawTitle, artist, targetDurationSec, rawVideoId);

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
        songFingerprint: cached.songFingerprint || songFingerprint,
        autoOffsetMs: (cached.autoOffsetMs !== undefined) ? cached.autoOffsetMs : 0,
        isRemixOrDurationMismatch: Boolean(cached.isRemixOrDurationMismatch),
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
      songFingerprint,
      autoOffsetMs: 0,
      isRemixOrDurationMismatch: false,
      userSavedOffsetMs: 0
    };
    setCachedLyrics(cacheKey, lofiResult);
    return lofiResult;
  }

  if (isYouTube && normalizedUrl) {
    try {
      const ytInfo = await fetchYtdlpInfo(normalizedUrl);
      if (ytInfo && ytInfo.duration > 0) {
        targetDurationSec = ytInfo.duration;
        songFingerprint = generateMultiFactorFingerprint(rawTitle, artist, targetDurationSec, rawVideoId);
      }
    } catch (e) {}
  }

  const variantTag = detectVariantTag(rawTitle);
  const isVariant = variantTag !== 'original';
  const lookupKeys = [
    rawVideoId ? `yt:${rawVideoId}` : null,
    trackKey,
    !isVariant ? fallbackKey : null
  ].filter(Boolean);

  // GIAI ĐOẠN 0: Tra cứu MongoDB Persistent Cache (0ms - 5ms)
  const persistentDoc = await getPersistentLyricCache(songFingerprint, lookupKeys);
  if (persistentDoc) {
    if (persistentDoc.type === 'synced' && persistentDoc.qualityScore >= 80 && !isGarbageLyrics(persistentDoc.lyrics)) {
      const res = {
        title: persistentDoc.title || rawTitle,
        artist: persistentDoc.artist || artist,
        lyrics: persistentDoc.lyrics,
        syncedLyrics: persistentDoc.syncedLyrics,
        duration: persistentDoc.durationSec,
        trackKey,
        songFingerprint: persistentDoc.songFingerprint || songFingerprint,
        autoOffsetMs: persistentDoc.autoOffsetMs || 0,
        isRemixOrDurationMismatch: Boolean(persistentDoc.isRemixOrDurationMismatch),
        userSavedOffsetMs: (userSavedOffsetMs !== undefined && userSavedOffsetMs !== null) ? userSavedOffsetMs : 0,
        source: persistentDoc.source || 'lrclib',
        qualityScore: persistentDoc.qualityScore,
        isOfficialCc: persistentDoc.source === 'youtube_cc'
      };
      setCachedLyrics(cacheKey, res);
      return res;
    }

    if (persistentDoc.type === 'plain' || persistentDoc.qualityScore < 70) {
      const plainRes = {
        title: persistentDoc.title || rawTitle,
        artist: persistentDoc.artist || artist,
        lyrics: persistentDoc.lyrics,
        syncedLyrics: null,
        duration: persistentDoc.durationSec,
        trackKey,
        songFingerprint: persistentDoc.songFingerprint || songFingerprint,
        autoOffsetMs: persistentDoc.autoOffsetMs || 0,
        isRemixOrDurationMismatch: Boolean(persistentDoc.isRemixOrDurationMismatch),
        userSavedOffsetMs: userSavedOffsetMs || 0,
        source: persistentDoc.source || 'youtube_description',
        qualityScore: persistentDoc.qualityScore || 50
      };
      setCachedLyrics(cacheKey, plainRes);

      // Cooldown 24h Smart Upgrade
      const UPGRADE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
      const lastAttempt = persistentDoc.lastUpgradeAttemptAt ? new Date(persistentDoc.lastUpgradeAttemptAt).getTime() : 0;
      const shouldAttempt = !persistentDoc.lastUpgradeAttemptAt || (Date.now() - lastAttempt > UPGRADE_COOLDOWN_MS);

      if (shouldAttempt && LyricCache) {
        LyricCache.updateOne({ _id: persistentDoc._id }, { $set: { lastUpgradeAttemptAt: new Date() } }).catch(() => {});
        setImmediate(async () => {
          try {
            const upgraded = await executeParallelWaterfallSearch({
              rawTitle, artist, targetDurationSec, targetUrl, normalizedUrl, cacheKey, trackKey, userSavedOffsetMs,
              activeLayers: ['lrclib', 'youtube_cc', 'zingmp3'], appleMeta, isYouTube, requireSyncedOnly: true
            });
            if (upgraded && Array.isArray(upgraded.syncedLyrics) && upgraded.syncedLyrics.length >= 3) {
              await savePersistentLyricCache(upgraded, songFingerprint, lookupKeys);
              setCachedLyrics(cacheKey, upgraded);
              lyricsEvents.emit('lyricsFound', {
                url: normalizedUrl || targetUrl,
                cacheKey,
                trackKey,
                lyricsData: upgraded
              });
            }
          } catch (e) {}
        });
      }
      return plainRes;
    }
  }

  // GIAI ĐOẠN 1: PARALLEL WATERFALL QUALITY LADDER (Ngắt mạch sớm < 400ms & Grace Window 800ms)
  const winner = await executeParallelWaterfallSearch({
    rawTitle, artist, targetDurationSec, targetUrl, normalizedUrl, cacheKey, trackKey, userSavedOffsetMs,
    activeLayers, appleMeta, isYouTube, requireSyncedOnly: false
  });

  if (winner) {
    winner.songFingerprint = songFingerprint;
    if (winner.autoOffsetMs === undefined) winner.autoOffsetMs = 0;
    if (winner.isRemixOrDurationMismatch === undefined) winner.isRemixOrDurationMismatch = false;
    await savePersistentLyricCache(winner, songFingerprint, lookupKeys);
    setCachedLyrics(cacheKey, winner);
    lyricsEvents.emit('lyricsFound', {
      url: normalizedUrl || targetUrl,
      cacheKey,
      trackKey,
      lyricsData: winner
    });
    return winner;
  }

  const notFoundResult = {
    title: rawTitle,
    artist,
    lyrics: null,
    syncedLyrics: null,
    notFound: true,
    trackKey,
    songFingerprint,
    autoOffsetMs: 0,
    isRemixOrDurationMismatch: false,
    userSavedOffsetMs: 0
  };
  setCachedLyrics(cacheKey, notFoundResult);
  return notFoundResult;
}

/**
 * Động cơ Thác nước Song song (Parallel Waterfall Quality Ladder):
 * Kích hoạt đồng thời các provider, ngắt mạch sớm < 400ms khi tìm thấy bản synced Tier 1 chuẩn,
 * và mở Grace Window 800ms khi Tier 3 (YouTube Description) về đích trước.
 */
async function executeParallelWaterfallSearch({
  rawTitle,
  artist,
  targetDurationSec,
  targetUrl,
  normalizedUrl,
  cacheKey,
  trackKey,
  userSavedOffsetMs,
  activeLayers,
  appleMeta,
  isYouTube,
  requireSyncedOnly = false
}) {
  const candidates = [];
  let plainFallback = null;
  let fallbackRecord = null;
  let fallbackResult = null;

  const getLayerPriority = (layerName) => {
    const idx = activeLayers.indexOf(layerName);
    return idx !== -1 ? idx : 999;
  };

  const isTier1 = (src) => ['youtube_cc', 'lrclib', 'zingmp3'].includes(src);

  return new Promise((resolve) => {
    let isResolved = false;
    let graceTimer = null;

    const safeResolve = (winner) => {
      if (isResolved) return;
      isResolved = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      resolve(winner);
    };

    const checkShortCircuit = (candidate) => {
      if (!candidate || !candidate.result?.syncedLyrics) return false;
      // Ngắt mạch sớm < 400ms: Nguồn Tier 1 có synced lyrics chuẩn (không thủng đoạn)
      if (isTier1(candidate.source) && !candidate.quality.hasAbnormalGap && candidate.quality.count >= 4) {
        // Chỉ ngắt mạch ngay lập tức nếu đây là nguồn có độ ưu tiên cao nhất (#1 trong activeLayers, ví dụ youtube_cc xếp đầu)
        if (candidate.priority === 0) {
          candidate.result.qualityScore = 95;
          safeResolve(candidate.result);
          return true;
        }

        // Nếu nguồn thấp hơn về trước, không được ngắt mạch làm hỏng nguồn ưu tiên cao hơn (như youtube_cc)
        // Mở Grace Window 600ms chờ nguồn ưu tiên cao hơn về đích
        if (!graceTimer) {
          graceTimer = setTimeout(() => {
            if (!isResolved) {
              const winner = pickBestLyricsCandidate(candidates) || plainFallback;
              if (winner) safeResolve(winner);
            }
          }, 600);
        }
      }
      return false;
    };

    const onTier3Arrival = (descResult) => {
      if (isResolved) return;
      if (requireSyncedOnly) return;
      plainFallback = descResult;

      // Nếu đã có candidate synced bất kỳ -> không cần mở Grace Window cho plain
      if (candidates.length > 0) return;

      // Mở Grace Window 800ms chờ Tier 1
      if (!graceTimer) {
        graceTimer = setTimeout(() => {
          if (!isResolved) {
            const winner = pickBestLyricsCandidate(candidates) || plainFallback;
            safeResolve(winner);
          }
        }, 800);
      }
    };

    const taskPromises = [];

    // TẦNG 1: YouTube CC
    if (activeLayers.includes('youtube_cc') && isYouTube && normalizedUrl) {
      taskPromises.push((async () => {
        try {
          const ytSubResult = await fetchYouTubeSubtitles(normalizedUrl, rawTitle, artist, trackKey, userSavedOffsetMs, appleMeta);
          if (ytSubResult?.syncedLyrics && ytSubResult.syncedLyrics.length >= 3) {
            const quality = evaluateLyricsQuality(ytSubResult.syncedLyrics);
            const cand = { source: 'youtube_cc', priority: getLayerPriority('youtube_cc'), result: ytSubResult, quality };
            candidates.push(cand);
            if (checkShortCircuit(cand)) return;
          }
        } catch (e) {}
      })());
    }

    // TẦNG 1: LRCLIB
    if (activeLayers.includes('lrclib')) {
      taskPromises.push((async () => {
        try {
          const lrclibRes = await fetchLrclibLyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, cacheKey, trackKey, userSavedOffsetMs, appleMeta);
          if (lrclibRes?.exactSynced?.syncedLyrics) {
            const quality = evaluateLyricsQuality(lrclibRes.exactSynced.syncedLyrics);
            const cand = { source: 'lrclib', priority: getLayerPriority('lrclib'), result: lrclibRes.exactSynced, quality };
            candidates.push(cand);
            if (checkShortCircuit(cand)) return;
          }
          if (!plainFallback && lrclibRes?.plainFallback) plainFallback = lrclibRes.plainFallback;
          if (!fallbackRecord && lrclibRes?.fallbackRecord) fallbackRecord = lrclibRes.fallbackRecord;
        } catch (e) {}
      })());
    }

    // TẦNG 1: Zing MP3
    if (activeLayers.includes('zingmp3')) {
      taskPromises.push((async () => {
        try {
          const zingResult = await fetchZingMp3Lyrics(rawTitle, artist, targetDurationSec, normalizedUrl || targetUrl, trackKey, userSavedOffsetMs, appleMeta);
          if (zingResult?.syncedLyrics) {
            const quality = evaluateLyricsQuality(zingResult.syncedLyrics);
            const cand = { source: 'zingmp3', priority: getLayerPriority('zingmp3'), result: zingResult, quality };
            candidates.push(cand);
            if (checkShortCircuit(cand)) return;
          } else if (zingResult?.lyrics && !plainFallback) {
            plainFallback = zingResult;
          }
        } catch (e) {}
      })());
    }

    // TẦNG 2: SyncedLyrics Python Microservice (trễ 250ms)
    if (activeLayers.includes('syncedlyrics')) {
      taskPromises.push((async () => {
        await new Promise(r => setTimeout(r, 250));
        if (isResolved) return;
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
            const quality = evaluateLyricsQuality(fbRes.syncedLyrics);
            const cand = { source: 'syncedlyrics', priority: getLayerPriority('syncedlyrics'), result: fbRes, quality };
            candidates.push(cand);
            if (checkShortCircuit(cand)) return;
          } else if (fbRes?.lyrics && !fallbackResult) {
            fallbackResult = fbRes;
          }
        } catch (e) {}
      })());
    }

    // TẦNG 3: YouTube Description
    if (!requireSyncedOnly) {
      if (isYouTube && normalizedUrl) {
        taskPromises.push((async () => {
          try {
            const descLyrics = await fetchYouTubeDescriptionLyrics(normalizedUrl, rawTitle, artist, trackKey, userSavedOffsetMs);
            if (descLyrics && descLyrics.lyrics && descLyrics.lyrics.length >= 50) {
              onTier3Arrival(descLyrics);
            }
          } catch (e) {}
        })());
      } else if (!isYouTube) {
        taskPromises.push((async () => {
          try {
            const searchQuery = `${cleanTitle(rawTitle)} ${cleanArtistName(artist)}`.trim();
            if (searchQuery) {
              const { executeSearch } = require('./searchService');
              const sRes = await executeSearch(searchQuery, 1, 'official');
              const topVideo = sRes?.[0];
              if (topVideo?.url) {
                const ccRes = await fetchYouTubeSubtitles(topVideo.url, rawTitle, artist, trackKey, userSavedOffsetMs);
                if (ccRes?.syncedLyrics && ccRes.syncedLyrics.length >= 5) {
                  const quality = evaluateLyricsQuality(ccRes.syncedLyrics);
                  const cand = { source: 'youtube_cc', priority: getLayerPriority('youtube_cc'), result: ccRes, quality };
                  candidates.push(cand);
                  if (checkShortCircuit(cand)) return;
                }
                const descRes = await fetchYouTubeDescriptionLyrics(topVideo.url, rawTitle, artist, trackKey, userSavedOffsetMs);
                if (descRes && descRes.lyrics && descRes.lyrics.length >= 50) {
                  onTier3Arrival(descRes);
                }
              }
            }
          } catch (e) {}
        })());
      }
    }

    // Khi tất cả hoàn tất
    Promise.allSettled(taskPromises).then(async () => {
      if (isResolved) return;
      const winner = pickBestLyricsCandidate(candidates);
      if (winner) return safeResolve(winner);

      if (fallbackRecord && fallbackRecord.syncedLyrics) {
        const isActualRemixMismatch = detectVariantTrack(rawTitle);
        const fallbackRes = await buildLrclibResult(fallbackRecord, rawTitle, artist, normalizedUrl || targetUrl, targetDurationSec, cacheKey, trackKey, userSavedOffsetMs, isActualRemixMismatch);
        if (fallbackRes) return safeResolve(fallbackRes);
      }
      if (!requireSyncedOnly) {
        if (plainFallback) return safeResolve(plainFallback);
        if (fallbackResult) return safeResolve(fallbackResult);
      }
      safeResolve(null);
    });

    // Timeout trần an toàn
    const maxTimeoutMs = (activeLayers.includes('youtube_cc') && isYouTube) ? 4000 : 3200;
    setTimeout(() => {
      if (!isResolved) {
        const winner = pickBestLyricsCandidate(candidates) || plainFallback || fallbackResult || null;
        safeResolve(winner);
      }
    }, maxTimeoutMs);
  });
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
  getDynamicLyricsLayers,
  executeParallelWaterfallSearch,
  getPersistentLyricCache,
  savePersistentLyricCache,
  reportLyricCacheIssue,
  generateMultiFactorFingerprint
};
