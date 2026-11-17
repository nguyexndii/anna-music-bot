const os = require('os');
const { AudioPlayerStatus } = require('@discordjs/voice');
const {
  createResource,
  searchTrack,
  searchMultipleTracks,
  analyzeTrackOriginAndMeta,
  resolveTrackOriginAndMetaAsync,
  isCandidateMatchingRegion,
  buildAutoplayFallbackQueries,
  getRelatedTracksPool
} = require('../../utils/musicExtractor');
const lofiDiscovery = require('../../utils/lofiDiscovery');
const {
  createNowPlayingCard,
  createErrorEmbed,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
} = require('../../utils/embed');
const settingsManager = require('../SettingsManager');
const historyManager = require('../HistoryManager');
const sessionManager = require('../SessionManager');
const lofiHistoryManager = require('../LofiHistoryManager');
const { logAction } = require('../../utils/debugLogger');
const { hasEnoughMemoryToPreload, logMemoryUsage } = require('../../utils/systemMonitor');
const { isStrictAdmin } = require('../../utils/permissionHelper');
const config = require('../../config');

function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseDurationToMs(str) {
  return parseDurationToSeconds(str) * 1000;
}

function formatSecondsToDuration(totalSec) {
  if (!totalSec || totalSec <= 0) return '0:00';
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

class QueuePlaybackEngine {
  constructor(queue) {
    this.queue = queue;
  }

  get guild() {
    return this.queue.guild;
  }

  get songs() {
    return this.queue.songs;
  }

  set songs(val) {
    this.queue.songs = val;
  }

  get currentSong() {
    return this.queue.currentSong;
  }

  set currentSong(val) {
    this.queue.currentSong = val;
  }

  get player() {
    return this.queue.player;
  }

  get currentResource() {
    return this.queue.currentResource;
  }

  set currentResource(val) {
    this.queue.currentResource = val;
  }

  _clearBufferingWatchdog() {
    if (this.queue._bufferingTimeout) {
      clearTimeout(this.queue._bufferingTimeout);
      this.queue._bufferingTimeout = null;
    }
  }

  _startBufferingWatchdog() {
    this._clearBufferingWatchdog();
    this.queue._bufferingTimeout = setTimeout(async () => {
      if (this.player?.state?.status === AudioPlayerStatus.Buffering && !this.queue.isDestroyed && !this.queue.isStopped) {
        console.warn(`[AudioPlayer Watchdog] Player bị kẹt ở trạng thái Buffering quá 18s tại ${this.guild.name}! Tự động bỏ qua bài.`);
        if (this.currentResource) {
          this._cleanupResource(this.currentResource);
          this.currentResource = null;
        }
        if (this.songs.length > 0) {
          await this.playNext();
        } else if (this.queue.mode247) {
          this.currentSong = null;
          await this._play247BackgroundLofi();
        } else {
          this._handleSongEnd();
        }
      }
    }, 18000);
  }

  isCurrentSongLofi() {
    if (!this.currentSong) return false;
    return Boolean(
      this.currentSong.is247 ||
      this.currentSong.requestedBy === 'Auto (24/7)' ||
      this.currentSong.requestedBy === 'Auto (24/7 Lofi)' ||
      (typeof this.currentSong.requestedBy === 'string' && this.currentSong.requestedBy.includes('24/7'))
    );
  }

  clearPlayCountTimer() {
    if (this.queue._playCountTimer) {
      clearTimeout(this.queue._playCountTimer);
      this.queue._playCountTimer = null;
    }
  }

  clearPreloadTimer() {
    if (this.queue.preloadTimer) {
      clearTimeout(this.queue.preloadTimer);
      this.queue.preloadTimer = null;
    }
  }

  _clearCrossfadeTimer() {
    if (this.queue.crossfadeTimer) {
      clearTimeout(this.queue.crossfadeTimer);
      this.queue.crossfadeTimer = null;
    }
    if (this.queue._crossfadeInterval) {
      clearInterval(this.queue._crossfadeInterval);
      this.queue._crossfadeInterval = null;
    }
    if (this.queue._fadeInInterval) {
      clearInterval(this.queue._fadeInInterval);
      this.queue._fadeInInterval = null;
    }
    this.queue._isCrossfading = false;
  }

  clearCrossfadeTimer() {
    this._clearCrossfadeTimer();
  }

  _startSessionSaveInterval() {
    this._clearSessionSaveInterval();
    this.queue._sessionSaveInterval = setInterval(() => {
      if (this.queue.isPlaying && this.currentSong && !this.queue.isPaused) {
        this._saveSessionState();
      }
    }, 15000);
  }

  _clearSessionSaveInterval() {
    if (this.queue._sessionSaveInterval) {
      clearInterval(this.queue._sessionSaveInterval);
      this.queue._sessionSaveInterval = null;
    }
  }

  scheduleCrossfade() {
    this._clearCrossfadeTimer();
    if (!this.currentSong || this.queue.isDestroyed || this.queue.isStopped || this.queue.paused) return;
    const cfSec = this.queue.crossfadeDuration;
    if (!cfSec || cfSec <= 0) return;

    const isLofiCurrent = this.isCurrentSongLofi();
    if (this.currentSong.isLive || (isLofiCurrent && this.songs.length === 0)) return;

    const totalDurationMs = this.currentSong.durationMs || parseDurationToMs(this.currentSong.duration);
    if (totalDurationMs < 20000) return;

    const currentPlayedMs = (this.currentSong.seekPosition || 0) * 1000 + (this.currentResource?.playbackDuration || 0);
    const remainingMs = totalDurationMs - currentPlayedMs;
    const triggerMs = remainingMs - (cfSec * 1000);

    if (triggerMs <= 0) {
      if (remainingMs > 500) {
        this._startFadeOut(Math.min(cfSec, Math.floor(remainingMs / 1000)));
      }
      return;
    }

    this.queue.crossfadeTimer = setTimeout(() => {
      this.queue.crossfadeTimer = null;
      this._startFadeOut(cfSec);
    }, triggerMs);
  }

  async _startFadeOut(cfSec) {
    if (this.queue._isCrossfading || !this.currentSong || this.queue.isDestroyed || this.queue.isStopped || this.queue.paused || !cfSec || cfSec <= 0) return;
    this.queue._isCrossfading = true;

    if (this.queue._fadeInInterval) {
      clearInterval(this.queue._fadeInInterval);
      this.queue._fadeInInterval = null;
    }

    this._triggerNextTrackPreload();

    const steps = Math.max(1, Math.round(cfSec * 5));
    let step = 0;
    const baseVol = this.queue.volume / 100;
    const minVol = 0.02;

    this.queue._crossfadeInterval = setInterval(() => {
      step++;
      if (this.currentResource && this.currentResource.volume) {
        const fraction = step / steps;
        const curVol = baseVol - (baseVol - minVol) * fraction;
        try {
          this.currentResource.volume.setVolume(Math.max(minVol, curVol));
        } catch (e) {}
      }

      if (step >= steps) {
        this._clearCrossfadeTimer();
        this._earlyTransitionToNext();
      }
    }, 200);
  }

  _earlyTransitionToNext() {
    if (this.queue.isDestroyed || this.queue.isStopped) return;
    console.log(`[MusicQueue Crossfade] Kết thúc fade-out, chuyển bài sớm sang bài kế tiếp...`);
    if (this.player.state.status === AudioPlayerStatus.Idle) {
      this._handleSongEnd();
    } else {
      this.player.stop(true);
    }
  }

  async _triggerNextTrackPreload() {
    return this._prefetchNextTrack();
  }

  async _prefetchNextTrack() {
    if (this.queue._isPreloading || this.queue.preloadedResource || this.queue.isDestroyed || this.queue.isStopped) return;
    if (!hasEnoughMemoryToPreload()) {
      console.log('[MusicQueue Preload] RAM > 85%, hủy preload ngầm để tiết kiệm tài nguyên');
      return;
    }

    const nextTrack = (this.songs.length > 0) ? this.songs[0] : this.queue.prefetchedSong;
    if (!nextTrack) return;
    const targetKey = nextTrack.url || nextTrack.searchQuery;
    if (!targetKey) return;

    const audioCacheManager = require('../AudioCacheManager');
    const cachedEntry = audioCacheManager.findCachedEntry(nextTrack);

    const guildSettings = settingsManager.get(this.guild.id);
    if (nextTrack && !nextTrack.trimStart && !nextTrack._sbChecked && guildSettings.autoSkipOfftopic !== false && !nextTrack.is247 && !nextTrack.isLive) {
      nextTrack._sbChecked = true;
      try {
        if ((typeof nextTrack.url === 'string' && nextTrack.url.includes('spotify.com')) || (!nextTrack.ytDurationSec && !nextTrack.rawDurationSec)) {
          try {
            const { searchTrack } = require('../../utils/musicExtractor');
            const searchTarget = nextTrack.searchQuery || nextTrack.title;
            const expSec = nextTrack.spotifyDurationSec || (nextTrack.durationMs ? Math.round(nextTrack.durationMs / 1000) : (nextTrack.duration ? parseDurationToSeconds(nextTrack.duration) : 0));
            const ytRes = await searchTrack(searchTarget, expSec);
            if (ytRes && ytRes.length > 0 && ytRes[0].url) {
              nextTrack.url = ytRes[0].url;
              const sec = ytRes[0].ytDurationSec || ytRes[0].seconds;
              if (sec > 0) {
                nextTrack.ytDurationSec = sec;
                nextTrack.rawDurationSec = sec;
                nextTrack.duration = formatSecondsToDuration(sec);
                nextTrack.durationMs = sec * 1000;
              }
            }
          } catch (resolveErr) {}
        }

        if (cachedEntry) {
          nextTrack.trimStart = cachedEntry.trimStart;
          nextTrack.trimEnd = cachedEntry.trimEnd;
          if (cachedEntry.trimStart > 0 || cachedEntry.trimEnd > 0) {
            const rawDur = nextTrack.rawDurationSec || parseDurationToSeconds(nextTrack.duration);
            nextTrack.skippedIntroSec = cachedEntry.trimStart || 0;
            nextTrack.skippedOutroSec = (rawDur > 0 && cachedEntry.trimEnd > 0 && rawDur > cachedEntry.trimEnd) ? (rawDur - cachedEntry.trimEnd) : 0;
            if (rawDur > 0) {
              const realSec = (cachedEntry.trimEnd > cachedEntry.trimStart)
                ? (cachedEntry.trimEnd - cachedEntry.trimStart)
                : Math.max(1, rawDur - cachedEntry.trimStart);
              nextTrack.realDurationSec = realSec;
              nextTrack.duration = formatSecondsToDuration(realSec);
              nextTrack.durationMs = realSec * 1000;
            }
          }
          console.log(`[AudioCache SB-Hit] "${nextTrack.title}": Tái sử dụng mốc cắt từ SSD Cache (${cachedEntry.trimStart}s - ${cachedEntry.trimEnd}s, bỏ qua mạng SponsorBlock)`);
        } else {
          const { resolveSponsorBlockTrim } = require('../../utils/sponsorBlockHelper');
          const trimInfo = await resolveSponsorBlockTrim(nextTrack);
          if (trimInfo) {
            nextTrack.trimStart = trimInfo.trimStart;
            nextTrack.trimEnd = trimInfo.trimEnd;
            nextTrack.realDurationSec = trimInfo.realDurationSec;
            nextTrack.rawDurationSec = nextTrack.rawDurationSec || parseDurationToSeconds(nextTrack.duration);
            nextTrack.rawDuration = nextTrack.rawDuration || nextTrack.duration;
            nextTrack.duration = formatSecondsToDuration(trimInfo.realDurationSec);
            nextTrack.durationMs = trimInfo.realDurationSec * 1000;
            nextTrack.skippedIntroSec = trimInfo.skippedIntroSec;
            nextTrack.skippedOutroSec = trimInfo.skippedOutroSec;
          }
        }
      } catch (sbErr) {}
    }

    const isSingleCore = Array.isArray(os.cpus()) && os.cpus().length <= 1;
    if (isSingleCore && !cachedEntry) {
      console.log(`[Single-Core Safe Preload] 1 vCPU phát hiện: "${nextTrack.title}" chưa có trong SSD Cache, bỏ qua audio preload ngầm để chống giật lag.`);
      const isSpotify = typeof nextTrack.url === 'string' && nextTrack.url.includes('spotify.com');
      if (!nextTrack.url || isSpotify || (!nextTrack.url.startsWith('http') && nextTrack.searchQuery)) {
        try {
          const searchTarget = nextTrack.searchQuery || nextTrack.title;
          const searchRes = await searchTrack(searchTarget);
          if (searchRes && searchRes.length > 0 && searchRes[0].url) {
            nextTrack.url = searchRes[0].url;
            if (searchRes[0].duration && !nextTrack.duration) nextTrack.duration = searchRes[0].duration;
            if (searchRes[0].thumbnail && !nextTrack.thumbnail) nextTrack.thumbnail = searchRes[0].thumbnail;
          }
        } catch (e) {}
      }
      return;
    }

    this.queue._isPreloading = true;
    try {
      const res = await createResource(nextTrack, 0, 0, { priority: 'low' });
      if (res && !this.queue.isDestroyed && !this.queue.isStopped) {
        if (this.queue.preloadedResource) {
          this._cleanupResource(this.queue.preloadedResource);
        }
        this.queue.preloadedResource = res;
        const finalKey = nextTrack.url || nextTrack.searchQuery || targetKey;
        this.queue.preloadedSongUrl = finalKey;
        console.log(`[MusicQueue Preload] Đã tải trước thành công bài kế tiếp (priority: low): "${nextTrack.title}" (key: ${finalKey})`);
      } else if (res) {
        this._cleanupResource(res);
      }
    } catch (err) {
      console.warn('[MusicQueue Preload Warning]:', err.message);
    } finally {
      this.queue._isPreloading = false;
    }
  }

  _cleanupResource(resource) {
    if (resource && typeof resource.destroy === 'function') {
      try {
        resource.destroy();
      } catch (e) {}
    }
  }

  _sanitizeTrack(song, idx = 0) {
    if (!song) return null;
    if (typeof song === 'string') {
      return {
        title: 'Bài hát yêu cầu',
        url: song,
        searchQuery: song,
        duration: '3:30',
        thumbnail: 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg'
      };
    }
    const rawTitle = String(song.title || song.name || song.rawSongName || '').replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();
    const rawArtist = String(song.artist || song.uploader || '').replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '').trim();

    let safeTitle = rawTitle;
    if (!safeTitle) {
      const vidMatch = String(song.url || song.searchQuery || '').match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const vidId = vidMatch ? vidMatch[1] : null;
      safeTitle = (rawArtist && rawArtist !== 'YouTube') ? `${rawArtist} - Audio` : (vidId ? `Bài hát không tên (${vidId})` : `Bài hát #${idx + 1}`);
    }
    song.title = safeTitle;
    song.artist = rawArtist || 'YouTube';
    if (!song.url && song.searchQuery) {
      song.url = `https://www.youtube.com/results?search_query=${encodeURIComponent(song.searchQuery)}`;
    }
    if (!song.thumbnail) {
      song.thumbnail = 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';
    }
    if (!song.duration) {
      song.duration = '3:30';
    }
    return song;
  }

  _attachRequester(song, requestUser) {
    if (!song) return;
    song.requestedBy = requestUser;
    if (requestUser) {
      if (typeof requestUser === 'object') {
        song.requestedByName = requestUser.displayName || requestUser.globalName || requestUser.username || requestUser.user?.displayName || requestUser.user?.username || null;
        song.requestedById = requestUser.id || requestUser.user?.id || null;
        if (!song.requestedByAvatar) {
          song.requestedByAvatar = typeof requestUser.displayAvatarURL === 'function'
            ? requestUser.displayAvatarURL({ dynamic: true, size: 64 })
            : (requestUser.user && typeof requestUser.user.displayAvatarURL === 'function'
              ? requestUser.user.displayAvatarURL({ dynamic: true, size: 64 })
              : (song.requestedById && requestUser.avatar ? `https://cdn.discordapp.com/avatars/${song.requestedById}/${requestUser.avatar}.png` : null));
        }
      } else if (typeof requestUser === 'string') {
        song.requestedByName = requestUser;
      }
    }
  }

  getUserSongs() {
    return (this.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
  }

  async addSong(song, requestUser) {
    this.queue.voiceManager.clear247IdleTimer();
    this.queue.autoplayPool = [];
    this.queue.prefetchedSong = null;
    song = this._sanitizeTrack(song);
    if (!song) return null;
    this._attachRequester(song, requestUser);
    song.is247 = false;
    song.isUserRequest = true;

    const isCurrentLofi = this.isCurrentSongLofi() || this.queue._is247Loading;
    this.queue.isQueueOnHold = false;

    if (isCurrentLofi) {
      this.queue._skipRequested = true;
      this.queue._isPreemptingLofi = true;
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      this.queue.prefetchedSong = null;

      this.songs.unshift(song);
      this._saveSessionState();
      this.queue.voiceManager.clearDisconnectTimer();
      this.queue.voiceManager.clearEmptyRoomTimer();

      if (this.player.state.status === AudioPlayerStatus.Idle) {
        await this.playNext();
      } else {
        this.player.stop(true);
      }
      return { song, position: 1, isPlayingNow: true };
    }

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      this.songs.push(song);
      this._saveSessionState();
      this.queue.voiceManager.clearDisconnectTimer();
      this.queue.voiceManager.clearEmptyRoomTimer();
      await this.playNext();
      return { song, position: 1, isPlayingNow: true };
    }

    const isUserTrack = (s) => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)';
    const firstAutoIdx = this.songs.findIndex(s => !isUserTrack(s));

    if (firstAutoIdx !== -1) {
      this.songs.splice(firstAutoIdx, 0, song);
    } else {
      this.songs.push(song);
    }

    if (this.songs[0] === song && this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }

    this._saveSessionState();
    this.queue.voiceManager.clearDisconnectTimer();
    this.queue.voiceManager.clearEmptyRoomTimer();
    this.schedulePreload();
    this.queue.cardRenderer.scheduleRepostNowPlayingCard(1500);

    const userSongs = this.getUserSongs();
    const position = userSongs.findIndex(s => s === song) + 1;
    return { song, position: position > 0 ? position : 1, isPlayingNow: false };
  }

  async addSongs(songArray, requestUser) {
    this.queue.voiceManager.clear247IdleTimer();
    this.queue.autoplayPool = [];
    this.queue.prefetchedSong = null;
    const existingUrls = new Set((this.songs || []).map(s => s.url).filter(Boolean));
    if (this.currentSong?.url) existingUrls.add(this.currentSong.url);

    const sanitized = [];
    for (let i = 0; i < songArray.length; i++) {
      const s = this._sanitizeTrack(songArray[i], i);
      if (s) {
        if (s.url && existingUrls.has(s.url)) continue;
        if (s.url) existingUrls.add(s.url);
        this._attachRequester(s, requestUser);
        s.is247 = false;
        s.isUserRequest = true;
        sanitized.push(s);
      }
    }
    if (sanitized.length === 0) return null;

    const MAX_QUEUE_SIZE = 200;
    const remainingSlots = Math.max(0, MAX_QUEUE_SIZE - this.songs.length);
    if (remainingSlots <= 0) {
      console.warn(`[Queue Overflow] Hàng chờ guild ${this.guild?.id} đã đạt giới hạn tối đa ${MAX_QUEUE_SIZE} bài.`);
      return null;
    }
    const finalTracks = sanitized.slice(0, remainingSlots);

    const isCurrentLofi = this.isCurrentSongLofi() || this.queue._is247Loading;
    this.queue.isQueueOnHold = false;

    if (isCurrentLofi) {
      this.queue._skipRequested = true;
      this.queue._isPreemptingLofi = true;
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      this.queue.prefetchedSong = null;

      this.songs.unshift(...finalTracks);
      this._saveSessionState();
      this.enrichMissingThumbnails().catch(() => {});
      this.queue.voiceManager.clearDisconnectTimer();
      this.queue.voiceManager.clearEmptyRoomTimer();

      if (this.player.state.status === AudioPlayerStatus.Idle) {
        await this.playNext();
      } else {
        this.player.stop(true);
      }
      return { count: finalTracks.length, firstPosition: 1, isPlayingNow: true };
    }

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      this.songs.push(...finalTracks);
      this._saveSessionState();
      this.enrichMissingThumbnails().catch(() => {});
      this.queue.voiceManager.clearDisconnectTimer();
      this.queue.voiceManager.clearEmptyRoomTimer();
      await this.playNext();
      return { count: finalTracks.length, firstPosition: 1, isPlayingNow: true };
    }

    const isUserTrack = (s) => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)';
    const firstAutoIdx = this.songs.findIndex(s => !isUserTrack(s));

    if (firstAutoIdx !== -1) {
      this.songs.splice(firstAutoIdx, 0, ...finalTracks);
    } else {
      this.songs.push(...finalTracks);
    }

    if (this.songs[0] === finalTracks[0] && this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }

    this._saveSessionState();
    this.enrichMissingThumbnails().catch(() => {});
    this.queue.voiceManager.clearDisconnectTimer();
    this.queue.voiceManager.clearEmptyRoomTimer();
    this.schedulePreload();
    this.queue.cardRenderer.scheduleRepostNowPlayingCard(1500);

    const userSongs = this.getUserSongs();
    const firstPosition = userSongs.findIndex(s => s === finalTracks[0]) + 1;
    return { count: finalTracks.length, firstPosition: firstPosition > 0 ? firstPosition : 1, isPlayingNow: false };
  }

  async addTrack(track) {
    return this.addSong(track, track.requestedBy || 'Web User');
  }

  schedulePreload() {
    this.clearPreloadTimer();
    if (!this.currentSong || this.queue.isDestroyed || this.queue.isStopped) return;

    const is247 = Boolean(this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)' || this.currentSong.isLive);
    const totalSec = parseDurationToSeconds(this.currentSong.duration);

    if (is247 || totalSec <= 0) return;

    const currentPlayedMs = (this.currentSong.seekPosition || 0) * 1000 + (this.currentResource?.playbackDuration || 0);
    const remainingMs = (totalSec * 1000) - currentPlayedMs;
    const triggerAfterMs = Math.max(500, remainingMs - 22000);

    this.queue.preloadTimer = setTimeout(async () => {
      this.queue.preloadTimer = null;
      await this._executePreloadFlow();
    }, triggerAfterMs);
  }

  async _executePreloadFlow() {
    if (!this.currentSong || this.queue.isDestroyed || this.queue.isStopped) return;

    let nextTrack = (this.songs && this.songs.length > 0) ? this.songs[0] : null;

    if (!nextTrack) {
      const guildSettings = settingsManager.get(this.guild.id);
      if (guildSettings.autoplay !== false && this.queue.voiceManager.getHumanMemberCount() > 0 && this.currentSong.requestedBy !== 'Auto (24/7)') {
        if (this.queue.prefetchedSong && this.currentSong?.url && this.queue.prefetchedSong._seedUrl !== this.currentSong.url) {
          this.queue.prefetchedSong = null;
        }

        if (this.queue.autoplayPool && this.queue.autoplayPool.length > 0) {
          while (this.queue.autoplayPool.length > 0) {
            const candidate = this.queue.autoplayPool.shift();
            if (candidate._seedUrl && this.currentSong?.url && candidate._seedUrl !== this.currentSong.url) {
              continue;
            }
            if (candidate && candidate.url && !this.queue.history.includes(candidate.url) && candidate.url !== this.currentSong.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
              const isEnCandidate = settingsManager.get(this.guild.id)?.language === 'en';
              candidate.requestedBy = isEnCandidate ? 'Autoplay' : 'Tự động phát';
              candidate._seedUrl = this.currentSong?.url;
              this.queue.prefetchedSong = candidate;
              nextTrack = candidate;
              console.log(`[Autoplay Preload Pool Hit (0ms)] Nạp sẵn bài từ bộ đệm: "${candidate.title}"`);
              break;
            }
          }
        }

        if (!nextTrack && !this.queue.prefetchedSong) {
          await this._prefetchAutoplayTrack();
          nextTrack = this.queue.prefetchedSong;
        } else if (!nextTrack && this.queue.prefetchedSong) {
          if (this.currentSong?.url && this.queue.prefetchedSong._seedUrl !== this.currentSong.url) {
            this.queue.prefetchedSong = null;
            await this._prefetchAutoplayTrack();
          }
          nextTrack = this.queue.prefetchedSong;
        }
      }
    }

    if (!nextTrack) return;

    await this._prefetchNextTrack();

    try {
      const { prefetchLyrics } = require('../../utils/lyricsHelper');
      const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
      const durMs = parseDurationToMs(nextTrack.duration);
      prefetchLyrics(nextTrack.title, nextTrack.artist, durMs, nextTrack.url, guildSettings?.lyricsLayers);
    } catch (lyricPrefetchErr) {}
  }

  async playNext() {
    if (this.queue._isPlayingNext) return;
    this.queue._isPlayingNext = true;
    this.queue.skipVotes.clear();
    this.queue.prefetchedSong = null;
    this.queue.autoplayPool = [];

    try {
      if (this.songs.length === 0) return;

      this.queue.isStopped = false;
      this.queue.isDestroyed = false;
      this.queue._pendingButtonAction = null;
      this.queue.cardRenderer.clearLiveLyrics();
      this.clearPreloadTimer();
      this._clearCrossfadeTimer();
      this._clearSessionSaveInterval();
      const conn = await this.queue.connect();

      const nextSong = this.songs.shift();
      if (!nextSong) return;
      const initialSeekSeconds = Number(nextSong.initialSeekSeconds) || 0;
      delete nextSong.initialSeekSeconds;

      this.currentSong = this._sanitizeTrack(nextSong);
      if (!this.currentSong || !this.currentSong.title) {
        const safeTitle = (nextSong?.title || nextSong?.name || nextSong?.searchQuery || 'Bài hát yêu cầu').trim();
        this.currentSong = {
          ...nextSong,
          title: safeTitle || 'Bài hát yêu cầu',
          url: nextSong?.url || `https://www.youtube.com/results?search_query=${encodeURIComponent(safeTitle)}`,
          thumbnail: nextSong?.thumbnail || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
          duration: nextSong?.duration || '3:30'
        };
      }
      if (!this.currentSong?.is247 && this.currentSong?.requestedBy !== 'Auto (24/7)') {
        this.queue._skipRequested = false;
        this.queue._isPreemptingLofi = false;
      }
      this.currentSong.seekPosition = initialSeekSeconds;
      const reqByStr = typeof this.currentSong?.requestedBy === 'string' ? this.currentSong.requestedBy : '';
      const isAutoTrack = reqByStr.includes('Auto') || reqByStr.includes('Tự động') || reqByStr.includes('Autoplay');
      if (!this.currentSong?.is247 && !isAutoTrack) {
        try {
          const { detectTrackRegion } = require('../../utils/musicExtractor');
          const detectedReg = detectTrackRegion(this.currentSong.title, this.currentSong.artist);
          if (detectedReg) {
            this.queue.sessionRegion = detectedReg;
          }
        } catch (e) {}
      }
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.queue.paused = false;
      try { this.player.unpause(); } catch (e) {}
      this._saveSessionState();

      const guildSettings = settingsManager.get(this.guild.id);
      this.queue.crossfadeDuration = typeof guildSettings.crossfadeDuration === 'number' ? guildSettings.crossfadeDuration : 0;
      const crossfade = this.queue.crossfadeDuration;

      if (this.currentSong && !this.currentSong.trimStart && !this.currentSong._sbChecked && guildSettings.autoSkipOfftopic !== false && !this.currentSong.is247 && !this.currentSong.isLive) {
        this.currentSong._sbChecked = true;
        try {
          if ((typeof this.currentSong.url === 'string' && this.currentSong.url.includes('spotify.com')) || (!this.currentSong.ytDurationSec && !this.currentSong.rawDurationSec)) {
            try {
              const { searchTrack } = require('../../utils/musicExtractor');
              const searchTarget = this.currentSong.searchQuery || this.currentSong.title;
              const expSec = this.currentSong.spotifyDurationSec || (this.currentSong.durationMs ? Math.round(this.currentSong.durationMs / 1000) : (this.currentSong.duration ? parseDurationToSeconds(this.currentSong.duration) : 0));
              const ytRes = await searchTrack(searchTarget, expSec);
              if (ytRes && ytRes.length > 0 && ytRes[0].url) {
                this.currentSong.url = ytRes[0].url;
                const sec = ytRes[0].ytDurationSec || ytRes[0].seconds;
                if (sec > 0) {
                  this.currentSong.ytDurationSec = sec;
                  this.currentSong.rawDurationSec = sec;
                  this.currentSong.duration = formatSecondsToDuration(sec);
                  this.currentSong.durationMs = sec * 1000;
                }
              }
            } catch (resolveErr) {}
          }

          const audioCacheManager = require('../AudioCacheManager');
          const cachedEntry = audioCacheManager.findCachedEntry(this.currentSong);
          if (cachedEntry) {
            this.currentSong.trimStart = cachedEntry.trimStart;
            this.currentSong.trimEnd = cachedEntry.trimEnd;
            if (cachedEntry.trimStart > 0 || cachedEntry.trimEnd > 0) {
              const rawDur = this.currentSong.rawDurationSec || parseDurationToSeconds(this.currentSong.duration);
              this.currentSong.skippedIntroSec = cachedEntry.trimStart || 0;
              this.currentSong.skippedOutroSec = (rawDur > 0 && cachedEntry.trimEnd > 0 && rawDur > cachedEntry.trimEnd) ? (rawDur - cachedEntry.trimEnd) : 0;
              if (rawDur > 0) {
                const realSec = (cachedEntry.trimEnd > cachedEntry.trimStart)
                  ? (cachedEntry.trimEnd - cachedEntry.trimStart)
                  : Math.max(1, rawDur - cachedEntry.trimStart);
                this.currentSong.realDurationSec = realSec;
                this.currentSong.duration = formatSecondsToDuration(realSec);
                this.currentSong.durationMs = realSec * 1000;
              }
            }
            console.log(`[AudioCache SB-Hit] "${this.currentSong.title}": Tái sử dụng mốc cắt từ SSD Cache (${cachedEntry.trimStart}s - ${cachedEntry.trimEnd}s, bỏ qua mạng SponsorBlock)`);
          } else {
            const { resolveSponsorBlockTrim } = require('../../utils/sponsorBlockHelper');
            const trimInfo = await resolveSponsorBlockTrim(this.currentSong);
            if (trimInfo) {
              this.currentSong.trimStart = trimInfo.trimStart;
              this.currentSong.trimEnd = trimInfo.trimEnd;
              this.currentSong.realDurationSec = trimInfo.realDurationSec;
              this.currentSong.rawDurationSec = this.currentSong.rawDurationSec || parseDurationToSeconds(this.currentSong.duration);
              this.currentSong.rawDuration = this.currentSong.rawDuration || this.currentSong.duration;
              this.currentSong.duration = formatSecondsToDuration(trimInfo.realDurationSec);
              this.currentSong.durationMs = trimInfo.realDurationSec * 1000;
              this.currentSong.skippedIntroSec = trimInfo.skippedIntroSec;
              this.currentSong.skippedOutroSec = trimInfo.skippedOutroSec;
            }
          }
        } catch (sbErr) {}
      }

      const targetKey = this.currentSong.url || this.currentSong.searchQuery;
      let resource = null;

      const isPreloadMatch = Boolean(
        this.queue.preloadedResource && (
          this.queue.preloadedSongUrl === targetKey ||
          this.queue.preloadedSongUrl === this.currentSong.url ||
          this.queue.preloadedSongUrl === this.currentSong.searchQuery ||
          (this.currentSong.originalUrl && this.queue.preloadedSongUrl === this.currentSong.originalUrl)
        )
      );

      if (!initialSeekSeconds && isPreloadMatch) {
        resource = this.queue.preloadedResource;
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
        console.log(`[MusicQueue 0ms Hit] Nối bài tức thì từ luồng Preload (0ms): "${this.currentSong.title}"`);
      } else {
        if (this.queue.preloadedResource) {
          this._cleanupResource(this.queue.preloadedResource);
          this.queue.preloadedResource = null;
          this.queue.preloadedSongUrl = null;
        }
        resource = await createResource(this.currentSong, 0, initialSeekSeconds, { priority: 'high' });
      }

      if (this.queue._isPreemptingLofi && (this.currentSong?.is247 || this.currentSong?.requestedBy === 'Auto (24/7)') && this.songs.length > 0) {
        this._cleanupResource(resource);
        this.queue._isPreemptingLofi = false;
        this.queue._isPlayingNext = false;
        return await this.playNext();
      }

      if (this.currentResource && this.currentResource !== resource) {
        this._cleanupResource(this.currentResource);
      }
      this.currentResource = resource;

      if (this.queue._fadeInInterval) {
        clearInterval(this.queue._fadeInInterval);
        this.queue._fadeInInterval = null;
      }
      if (this.queue._crossfadeInterval) {
        clearInterval(this.queue._crossfadeInterval);
        this.queue._crossfadeInterval = null;
      }

      const cfSec = this.queue.crossfadeDuration;
      if (cfSec > 0 && resource.volume && !initialSeekSeconds) {
        const targetVol = this.queue.volume / 100;
        const startVol = 0.05 * targetVol;
        resource.volume.setVolume(startVol);
        const fadeInSteps = Math.max(1, Math.round(Math.min(cfSec, 4) * 5));
        let currentStep = 0;
        this.queue._fadeInInterval = setInterval(() => {
          if (!this.currentResource || !this.currentResource.volume || this.queue._isCrossfading) {
            if (this.queue._fadeInInterval) clearInterval(this.queue._fadeInInterval);
            this.queue._fadeInInterval = null;
            return;
          }
          currentStep++;
          const fraction = currentStep / fadeInSteps;
          const newVol = startVol + (targetVol - startVol) * fraction;
          try {
            this.currentResource.volume.setVolume(Math.min(targetVol, newVol));
          } catch (e) {}
          if (currentStep >= fadeInSteps) {
            if (this.queue._fadeInInterval) clearInterval(this.queue._fadeInInterval);
            this.queue._fadeInInterval = null;
            if (this.currentResource?.volume) {
              try { this.currentResource.volume.setVolume(targetVol); } catch (e) {}
            }
          }
        }, 200);
      } else if (resource.volume) {
        resource.volume.setVolume(this.queue.volume / 100);
      }

      if (conn) {
        conn.subscribe(this.player);
      }

      this.player.play(resource);
      if (this.currentSong) {
        if (initialSeekSeconds > 0) {
          this.currentSong.startTime = Date.now() - (initialSeekSeconds * 1000);
          this.currentSong.seekPosition = initialSeekSeconds;
        } else {
          this.currentSong.startTime = Date.now();
          this.currentSong.seekPosition = 0;
        }
        logMemoryUsage(`Track Start: ${(this.currentSong.title || '').slice(0, 25)}`);

        if (!this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
          this.queue.lastNonLofiSong = this.currentSong;
          if (!this.queue.history.includes(this.currentSong.url)) {
            this.queue.history.unshift(this.currentSong.url);
            if (this.queue.history.length > 50) this.queue.history.pop();
          }
          historyManager.addRecentHistory(this.guild.id, this.currentSong).catch(() => {});

          const songForLyric = this.currentSong;
          setTimeout(() => {
            if (this.currentSong === songForLyric && !this.queue.isDestroyed && !this.queue.isStopped) {
              try {
                const { prefetchLyrics } = require('../../utils/lyricsHelper');
                const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
                const durMs = songForLyric.durationMs || parseDurationToMs(songForLyric.duration);
                prefetchLyrics(songForLyric.title, songForLyric.artist, durMs, songForLyric.url, guildSettings?.lyricsLayers);
              } catch (e) {}
            }
          }, 2000);

          this.clearPlayCountTimer();
          const durSec = parseDurationToSeconds(this.currentSong.duration);
          const waitMs = (durSec > 0 && durSec < 30) ? Math.max(3000, Math.floor((durSec / 3) * 1000)) : 10000;
          const songToRecord = this.currentSong;

          this.queue._playCountTimer = setTimeout(() => {
            if (this.currentSong === songToRecord && !this.queue.isDestroyed && !this.queue.isStopped && !songToRecord._playCountRecorded) {
              songToRecord._playCountRecorded = true;
              historyManager.incrementPlayCount(this.guild.id, songToRecord).catch(() => {});
            }
          }, waitMs);
        }

        const requesterName = this.currentSong.requestedByName ||
          (typeof this.currentSong.requestedBy === 'object'
            ? (this.currentSong.requestedBy.displayName || this.currentSong.requestedBy.username)
            : this.currentSong.requestedBy) || 'Auto';

        logAction('TRACK_START', {
          guild: this.guild.name,
          guildId: this.guild.id,
          channelId: this.queue.voiceChannel?.id,
          title: this.currentSong.title || 'Unknown',
          url: this.currentSong.url || 'N/A',
          duration: this.currentSong.duration || 'N/A',
          requestedBy: requesterName,
          is247: Boolean(this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)')
        });
      }

      if (this.currentSong?.requestedBy === 'Auto (24/7)') {
        setVoiceChannelStatus(this.queue.voiceChannel, '♾️ 24/7 Mode');
      } else {
        const voiceTitle = (this.currentSong?.title || this.currentSong?.name || 'Đang phát nhạc').trim();
        setVoiceChannelStatus(this.queue.voiceChannel, `🎶 ${voiceTitle}`);
      }

      this.schedulePreload();
      this.scheduleCrossfade();
      this._startSessionSaveInterval();

      this.queue._pendingButtonAction = null;
      const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);
      if (this.queue.textChannel && guildSettings.announceSongs !== false && !is247Lofi) {
        try {
          const cardPayload = createNowPlayingCard(this.currentSong, this.queue);
          let edited = false;
          if (this.queue.nowPlayingMessage) {
            try {
              const lastMessages = await this.queue.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
              const isLastMessage = lastMessages && lastMessages.first()?.id === this.queue.nowPlayingMessage.id;

              if (isLastMessage) {
                logAction('MESSAGE_EDIT', {
                  type: 'NOW_PLAYING_CARD_V2',
                  channelId: this.queue.textChannel.id,
                  messageId: this.queue.nowPlayingMessage.id,
                  song: (this.currentSong?.title || '').slice(0, 60)
                });
                await this.queue.nowPlayingMessage.edit(cardPayload);
                edited = true;
              } else {
                logAction('MESSAGE_DELETE', {
                  type: 'NOW_PLAYING_CARD_OLD',
                  channelId: this.queue.textChannel.id,
                  messageId: this.queue.nowPlayingMessage.id
                });
                await this.queue.nowPlayingMessage.delete().catch(() => {});
                this.queue.nowPlayingMessage = null;
              }
            } catch (e) {
              this.queue.nowPlayingMessage = null;
            }
          }

          if (!edited) {
            logAction('MESSAGE_SEND', {
              type: 'NOW_PLAYING_CARD_V2',
              channelId: this.queue.textChannel.id,
              guildId: this.guild.id,
              song: (this.currentSong?.title || '').slice(0, 60)
            });
            const msg = await this.queue.textChannel.send(cardPayload);
            this.queue.nowPlayingMessage = msg;
          }

          if (!is247Lofi) {
            this.queue.cardRenderer.startLiveLyrics();
          }
        } catch (cardError) {
          console.warn(`[Card Send Warning] Không thể gửi card Now Playing tới kênh ${this.queue.textChannel.id}:`, cardError.message);
        }
      } else if (is247Lofi && this.queue.nowPlayingMessage) {
        try {
          this.queue.cardRenderer.clearLiveLyrics();
          this.queue._is247Skipping = false;
          await this.queue.nowPlayingMessage.edit(createNowPlayingCard(this.currentSong, this.queue)).catch(() => {});
        } catch (npErr) {}
      }
    } catch (error) {
      console.error(`[Play Error] ${this.currentSong?.title || 'Unknown'}:`, error);
      const failedSong = this.currentSong;
      const is247Lofi = Boolean(failedSong?.requestedBy === 'Auto (24/7)' || failedSong?.is247);

      this.queue.lastPlayErrorUrl = failedSong?.url || null;
      this.queue.lastPlayErrorTitle = failedSong?.title || null;

      if (!is247Lofi) {
        logAction('PLAY_ERROR', {
          guildId: this.guild.id,
          channelId: this.queue.textChannel?.id,
          song: failedSong?.title || 'Unknown',
          url: failedSong?.url || 'N/A',
          error: error.message || String(error),
          is247: false
        });
      }

      if (this.queue.textChannel && !is247Lofi) {
        const lang = settingsManager.get(this.guild.id)?.language;
        this.queue.textChannel.send({
          embeds: [createErrorEmbed(lang === 'en' ? `Could not play **${failedSong?.title || 'selected'}**: ${error.message}` : `Không thể phát bài **${failedSong?.title || 'đã chọn'}**: ${error.message}`)],
          flags: 4096
        }).catch(() => {});
      }

      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();

      this.queue._isPlayingNext = false;
      await this._handleSongEnd();
    } finally {
      this.queue._isPlayingNext = false;
    }
  }

  async _handleSongEnd() {
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    this.queue.skipVotes.clear();
    if (this.queue._isPlayingNext || this.queue.isDestroyed || this.queue.isStopped || this.queue._switchingTo247) return;

    const lastSong = this.currentSong;
    const wasExplicitSkip = Boolean(this.queue._skipRequested);
    const wasPrevious = Boolean(this.queue._isPreviousAction);
    const wasPreemptingLofi = Boolean(this.queue._isPreemptingLofi);
    this.queue._skipRequested = false;
    this.queue._isPreviousAction = false;
    this.queue._isPreemptingLofi = false;

    if (wasPreemptingLofi && this.songs.length > 0) {
      this.clearPlayCountTimer();
      this.currentSong = null;
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.queue.isQueueOnHold = false;
      await this.playNext();
      return;
    }

    if (lastSong) {
      logAction('TRACK_END', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.queue.voiceChannel?.id,
        title: lastSong.title || 'Unknown',
        wasSkip: wasExplicitSkip,
        is247: Boolean(lastSong.is247 || lastSong.requestedBy === 'Auto (24/7)')
      });
    }

    this.clearPlayCountTimer();

    if (!wasPrevious && lastSong && !lastSong.is247 && lastSong.requestedBy !== 'Auto (24/7)') {
      this.queue.lastUserTrack = lastSong;
      this.queue.history.push(lastSong.url);
      if (this.queue.history.length > 50) this.queue.history.shift();

      this.queue.previousSongs.push(lastSong);
      if (this.queue.previousSongs.length > 5) this.queue.previousSongs.shift();
    }

    if (!wasExplicitSkip && !wasPrevious && this.queue.loopMode === 'song' && lastSong && !lastSong.is247 && lastSong.requestedBy !== 'Auto (24/7)') {
      this.songs.unshift(lastSong);
    } else if (!wasExplicitSkip && !wasPrevious && this.queue.loopMode === 'queue' && lastSong) {
      this.songs.push(lastSong);
    }

    this.currentSong = null;
    if (this.currentResource) {
      this._cleanupResource(this.currentResource);
      this.currentResource = null;
    }

    const activeChannel = this.queue.voiceManager.getVoiceChannel();
    const humanCount = this.queue.voiceManager.getHumanMemberCount();
    const guildSettings = settingsManager.get(this.guild.id);
    const wasLofiTrack = Boolean(lastSong?.requestedBy === 'Auto (24/7)' || lastSong?.is247);
    const isFailedTrack = Boolean(lastSong && (
      (this.queue.lastPlayErrorUrl && lastSong.url === this.queue.lastPlayErrorUrl) ||
      (this.queue.lastPlayErrorTitle && lastSong.title === this.queue.lastPlayErrorTitle)
    ));
    const songToRelate = (!isFailedTrack && lastSong && !wasLofiTrack)
      ? lastSong
      : (this.queue.lastNonLofiSong || (this.queue.previousSongs.length > 0 ? this.queue.previousSongs[this.queue.previousSongs.length - 1] : null));

    if (humanCount === 0 && this.queue.mode247) {
      this.queue.isQueueOnHold = true;
      this.queue.prefetchedSong = null;
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.currentSong = null;
      if (this.player) this.player.stop();
      const lang = settingsManager.get(this.guild.id)?.language;
      setVoiceChannelStatus(activeChannel, lang === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
      console.log(`[MusicQueue 24/7] Phòng trống (${this.guild.name}) - Đưa bot về chế độ 24/7 Sleep Mode (0% CPU)`);
      return;
    }

    if (this.songs.length > 0 && (!this.queue.isQueueOnHold || wasExplicitSkip || wasPreemptingLofi)) {
      this.queue.isQueueOnHold = false;
      await this.playNext();
      return;
    }

    if (wasLofiTrack && this.queue.mode247) {
      if (isFailedTrack) {
        setTimeout(() => {
          if (this.queue.mode247 && !this.currentSong && !this.queue.isDestroyed) {
            this._play247BackgroundLofi();
          }
        }, 5000);
        return;
      }
      await this._play247BackgroundLofi();
      return;
    }

    if (this.queue.prefetchedSong) {
      if (
        this.queue.prefetchedSong.url === lastSong?.url ||
        this.queue.prefetchedSong.title === lastSong?.title ||
        (this.queue.prefetchedSong._seedUrl && lastSong?.url && this.queue.prefetchedSong._seedUrl !== lastSong.url)
      ) {
        this.queue.prefetchedSong = null;
      }
    }

    if (this.queue.prefetchedSong && humanCount > 0 && guildSettings.autoplay !== false && !wasLofiTrack) {
      if (this.queue.prefetchedSong._seedUrl && lastSong?.url && this.queue.prefetchedSong._seedUrl !== lastSong.url) {
        this.queue.prefetchedSong = null;
      } else if (historyManager.isRecentlyPlayed(this.guild.id, this.queue.prefetchedSong, 25)) {
        this.queue.prefetchedSong = null;
      } else {
        const nextTrack = this._sanitizeTrack(this.queue.prefetchedSong);
        this.queue.prefetchedSong = null;
        if (nextTrack) {
          const isEnAutoplay = settingsManager.get(this.guild.id)?.language === 'en';
          nextTrack.requestedBy = isEnAutoplay ? 'Autoplay' : 'Tự động phát';
          nextTrack.is247 = false;
          nextTrack.isUserRequest = false;
          this.songs.push(nextTrack);
          await this.playNext();
          return;
        }
      }
    }

    if (this.queue.autoplayPool && this.queue.autoplayPool.length > 0 && humanCount > 0 && guildSettings.autoplay !== false && !wasLofiTrack) {
      while (this.queue.autoplayPool.length > 0) {
        const candidate = this.queue.autoplayPool.shift();
        if (candidate._seedUrl && lastSong?.url && candidate._seedUrl !== lastSong.url) {
          continue;
        }
        if (candidate && candidate.url && !this.queue.history.includes(candidate.url) && candidate.url !== songToRelate?.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
          const sanitizedRel = this._sanitizeTrack(candidate);
          if (sanitizedRel) {
            const isEnRel = settingsManager.get(this.guild.id)?.language === 'en';
            sanitizedRel.requestedBy = isEnRel ? 'Autoplay' : 'Tự động phát';
            sanitizedRel.is247 = false;
            sanitizedRel.isUserRequest = false;
            this.songs.push(sanitizedRel);
            console.log(`[Autoplay Pool Hit (0ms)] Nối bài ngay từ bộ đệm: "${sanitizedRel.title}"`);
            await this.playNext();
            return;
          }
        }
      }
    }

    if (humanCount > 0) {
      if (guildSettings.autoplay !== false && songToRelate && !wasLofiTrack) {
        const useAi = guildSettings.useAiAssistant !== false;
        const seedMeta = await resolveTrackOriginAndMetaAsync(songToRelate);
        let targetRegion = seedMeta.region;
        if (this.queue.sessionRegion && this.queue.sessionRegion === 'VI' && targetRegion === 'INTL') {
          targetRegion = 'VI';
        } else if (this.queue.sessionRegion && !targetRegion) {
          targetRegion = this.queue.sessionRegion;
        }

        let relatedTrack = null;
        try {
          const pool = await getRelatedTracksPool(songToRelate, this.guild.id, useAi, targetRegion);
          if (pool && pool.length > 0) {
            relatedTrack = pool[0];
            this.queue.autoplayPool = pool.slice(1).map(t => {
              const isEnPool = settingsManager.get(this.guild.id)?.language === 'en';
              t.requestedBy = isEnPool ? 'Autoplay' : 'Tự động phát';
              return t;
            });
            console.log(`[Autoplay Pool] Nạp bài "${relatedTrack.title}" và lưu ${this.queue.autoplayPool.length} bài vào bộ đệm`);
          }
        } catch (getRelErr) {
          console.warn('[getRelatedTracksPool Error]:', getRelErr.message);
        }

        if (!relatedTrack && songToRelate) {
          try {
            const fallbackQueries = await buildAutoplayFallbackQueries(songToRelate, targetRegion, seedMeta);
            const fallbackLocale = targetRegion === 'INTL' ? 'en' : (targetRegion === 'VI' ? 'vi' : 'en');

            for (const fallbackQuery of fallbackQueries) {
              if (relatedTrack) break;
              console.log(`[Autoplay Fallback Query (${targetRegion})] Thử tìm bài thay thế: "${fallbackQuery}"`);
              const fallbackResults = await searchMultipleTracks(fallbackQuery, 10, seedMeta.isRemix ? 'all' : 'official', fallbackLocale);
              if (fallbackResults && fallbackResults.length > 0) {
                relatedTrack = fallbackResults.find(t =>
                  t && t.url &&
                  t.url !== songToRelate.url &&
                  t.url !== this.queue.lastPlayErrorUrl &&
                  t.title !== this.queue.lastPlayErrorTitle &&
                  !historyManager.isRecentlyPlayed(this.guild.id, t, 25) &&
                  isCandidateMatchingRegion(t, targetRegion, seedMeta)
                ) || null;
              }
            }
          } catch (fbErr) {
            console.warn('[Autoplay Fallback Error]:', fbErr.message);
          }
        }

        if (relatedTrack) {
          const sanitizedRel = this._sanitizeTrack(relatedTrack);
          if (sanitizedRel) {
            sanitizedRel.requestedBy = 'Tự động phát';
            sanitizedRel.is247 = false;
            sanitizedRel.isUserRequest = false;
            this.songs.push(sanitizedRel);
            await this.playNext();
            return;
          }
        }

        console.warn(`[Autoplay] Không tìm thấy bài kế tiếp cho "${songToRelate.title}", giữ bot ở trạng thái chờ người nghe.`);
        clearVoiceChannelStatus(activeChannel);
        return;
      }

      if (this.queue.mode247 && wasLofiTrack) {
        await this._play247BackgroundLofi();
        return;
      }

      if (!this.queue.mode247) {
        clearVoiceChannelStatus(activeChannel);
        const timeoutSeconds = guildSettings.emptyChannelTimeout || 60;
        this.queue.voiceManager.startDisconnectTimer(timeoutSeconds * 1000);
        return;
      } else {
        await this._play247BackgroundLofi();
        return;
      }
    }

    if (this.queue.mode247) {
      this.queue.prefetchedSong = null;
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      setVoiceChannelStatus(activeChannel, '♾️ 24/7 Mode');
      await this._play247BackgroundLofi();
    } else {
      clearVoiceChannelStatus(activeChannel);
      const timeoutSeconds = guildSettings.emptyChannelTimeout || 60;
      this.queue.voiceManager.startDisconnectTimer(timeoutSeconds * 1000);
    }
  }

  async _play247BackgroundLofi() {
    this.queue.cardRenderer.clearLiveLyrics();
    if (!this.queue.mode247 || this.currentSong) return;
    try {
      this.queue._is247Loading = true;
      setVoiceChannelStatus(this.queue.voiceChannel, '♾️ 24/7 Mode');

      const LOFI_BLACKLIST_REGEX = /\b(ea7|phonk|trap|vinahouse|nonstop|remix|tiktok|shorts|short|karaoke|lyrics|lyric|vocal|vocals|with\s*vocals|singing|podcast|ft\.|feat\.|parody|meme|8d|nightcore|sped up|bass boosted|car music|sad edit|amv|gaming|workout|gym|rock|metal|rap|hiphop|vpop|khá\s*bảnh|kha\s*banh|mặt\s*lồn|chế|hài|bựa)\b/i;

      const isLiveOrRadio = (t) => {
        if (!t) return true;
        if (t.isLive || t.live) return true;
        if (typeof t.duration === 'string' && t.duration.toLowerCase().includes('live')) return true;
        const text = `${t.title || ''} ${t.artist || ''} ${t.uploader || ''}`.toLowerCase();
        return /\b(live\s*stream|trực\s*tiếp|24\/7\s*live|🔴|\bradio\b)\b/i.test(text);
      };

      const isBlacklisted = (t) => {
        if (!t || isLiveOrRadio(t)) return true;
        const text = `${t.title || ''} ${t.artist || ''} ${t.uploader || ''}`.toLowerCase();
        return LOFI_BLACKLIST_REGEX.test(text);
      };

      const isValidDuration = (t) => {
        if (!t) return false;
        if (t.isLive || t.live || (typeof t.duration === 'string' && t.duration.toLowerCase().includes('live'))) {
          return true;
        }
        let sec = t.seconds || parseDurationToSeconds(t.duration) || 0;
        if (sec === 0 && t.durationMs) sec = Math.floor(t.durationMs / 1000);
        return sec >= 45 && sec <= 14400;
      };

      let cleanTrack = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const recentHistory = lofiHistoryManager.getHistory(this.guild.id);
        if (this.songs.length > 0 || this.currentSong || !this.queue.mode247) {
          this.queue._is247Loading = false;
          return;
        }

        let query = '';
        let dynInfo = null;

        if (attempt < 3) {
          const recentTitles = recentHistory.slice(-15).map(h => h.title);
          dynInfo = lofiDiscovery.getDynamicLofiSearchQuery(recentTitles);
          query = dynInfo.query;
          console.log(`[24/7 Lofi Discovery] Thử lần ${attempt}: Vibe [${dynInfo.vibeSlot}] Nghệ sĩ [${dynInfo.artist}] Query: "${query}" cho guild ${this.guild.name}`);
        } else {
          dynInfo = lofiDiscovery.getDynamicLofiSearchQuery([]);
          query = dynInfo?.query || 'chillhop music beats to study relax to lofi instrumental';
          console.log(`[24/7 Lofi Discovery] Thử lần 3 (Failover Dynamic Lofi): Query: "${query}" cho guild ${this.guild.name}`);
        }

        const results = await searchTrack(query);

        if (this.songs.length > 0 || this.currentSong || !this.queue.mode247) {
          this.queue._is247Loading = false;
          return;
        }

        if (results && results.length > 0) {
          const validList = results.filter(t => !isBlacklisted(t) && isValidDuration(t));
          const sortedList = [...validList].sort((a, b) => {
            const secA = a.seconds || parseDurationToSeconds(a.duration) || 0;
            const secB = b.seconds || parseDurationToSeconds(b.duration) || 0;
            const isLongA = secA >= 600 ? 1 : 0;
            const isLongB = secB >= 600 ? 1 : 0;
            if (isLongB !== isLongA) return isLongB - isLongA;
            return secB - secA;
          });

          cleanTrack = sortedList.find(t => !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 100));
          if (!cleanTrack) {
            cleanTrack = sortedList.find(t => !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 50));
          }
          if (!cleanTrack) {
            cleanTrack = sortedList[0] || results.find(t => !isBlacklisted(t) && !isLiveOrRadio(t)) || results.find(t => !isLiveOrRadio(t)) || null;
          }
        }

        if (cleanTrack) break;

        if (attempt === 2) {
          lofiHistoryManager.clearGuildHistory(this.guild.id);
        }
      }

      if (!cleanTrack) {
        console.warn(`[24/7 Lofi Background] Kích hoạt Fallback Stream cho guild ${this.guild.name}`);
        cleanTrack = {
          title: 'Đài Phát Thanh Lofi 24/7',
          url: config.default247Stream || 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          artist: 'Lofi Girl',
          duration: 'LIVE',
          isLive: true,
          is247: true,
          requestedBy: 'Auto (24/7)'
        };
      }

      if (cleanTrack && typeof cleanTrack === 'object') {
        const sanitized = this._sanitizeTrack(cleanTrack) || cleanTrack;
        sanitized.is247 = true;
        sanitized.requestedBy = 'Auto (24/7)';
        lofiHistoryManager.addTrack(this.guild.id, sanitized);

        this.queue._lofiRetryCount = 0;
        this.songs.unshift(sanitized);
        logAction('SWITCH_TO_247_LOFI', {
          guild: this.guild.name,
          guildId: this.guild.id,
          channelId: this.queue.voiceChannel?.id,
          track: sanitized.title
        });
        await this.playNext();
        return;
      }

      console.warn(`[24/7 Lofi Background] Chưa tìm được bài Lofi phù hợp cho máy chủ ${this.guild.name}, thử lại sau 4 giây...`);
      setTimeout(() => {
        if (this.queue.mode247 && !this.currentSong && !this.queue.isDestroyed && this.songs.length === 0) {
          this._play247BackgroundLofi();
        }
      }, 4000);
    } catch (e) {
      console.warn('[24/7 Lofi Background Error]:', e.message);
      if (!this.queue.isDestroyed && this.queue.mode247 && !this.currentSong && this.songs.length === 0) {
        this.queue._lofiRetryCount = (this.queue._lofiRetryCount || 0) + 1;
        const delay = Math.min(3000 + (this.queue._lofiRetryCount * 1000), 10000);
        setTimeout(() => {
          if (this.queue.mode247 && !this.currentSong && !this.queue.isDestroyed && this.songs.length === 0) {
            this._play247BackgroundLofi();
          }
        }, delay);
      }
    } finally {
      this.queue._is247Loading = false;
    }
  }

  async _play247LofiBackground() {
    return this._play247BackgroundLofi();
  }

  setVolume(vol) {
    this._clearCrossfadeTimer();
    this.queue.volume = Math.max(0, Math.min(100, vol));
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.queue.volume / 100);
    }
    settingsManager.update(this.guild.id, { defaultVolume: this.queue.volume });
    this.scheduleCrossfade();
  }

  pause() {
    if (!this.queue.paused) {
      this._clearCrossfadeTimer();
      if (this.queue.liveLyricsTimer) {
        clearTimeout(this.queue.liveLyricsTimer);
        this.queue.liveLyricsTimer = null;
      }
      this.player.pause();
      this.queue.paused = true;
      this.queue.cardRenderer.refreshNowPlayingCard();
    }
  }

  resume() {
    if (this.queue.paused) {
      this.player.unpause();
      this.queue.paused = false;
      this.scheduleCrossfade();
      if (this.queue.hasSyncedLyrics) {
        this.queue.cardRenderer.scheduleNextLyricUpdate(this.currentSong);
      } else {
        this.queue.cardRenderer.refreshNowPlayingCard();
        this.queue.cardRenderer.scheduleProgressBarUpdate(this.currentSong);
      }
    }
  }

  togglePause() {
    if (this.queue.paused) {
      this.resume();
      return false;
    } else {
      this.pause();
      return true;
    }
  }

  async seek(seconds) {
    if (!this.currentSong || this.queue.isDestroyed || this.queue.isStopped) {
      throw new Error('Không có bài hát nào đang phát để tua');
    }

    const seekSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    console.log(`[MusicQueue Seek] Tua bài "${this.currentSong.title}" đến ${seekSeconds}s tại máy chủ ${this.guild.name}`);

    this._clearCrossfadeTimer();
    this.clearPreloadTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }

    const resource = await createResource(this.currentSong, 0, seekSeconds, { priority: 'high' });

    if (this.currentResource) {
      this._cleanupResource(this.currentResource);
    }
    this.currentResource = resource;
    if (resource.volume) {
      resource.volume.setVolume(this.queue.volume / 100);
    }

    this.currentSong.startTime = Date.now() - (seekSeconds * 1000);
    this.currentSong.seekPosition = seekSeconds;
    this.queue.paused = false;
    if (this.queue.hasSyncedLyrics) {
      this.queue.currentLyricIndex = -1;
      this.queue.cardRenderer.scheduleNextLyricUpdate(this.currentSong);
    }

    if (this.queue.connection) {
      this.queue.connection.subscribe(this.player);
    }

    this.player.play(resource);
    this.schedulePreload();
    if (!this.queue.hasSyncedLyrics) {
      this.queue.cardRenderer.refreshNowPlayingCard();
      this.queue.cardRenderer.scheduleProgressBarUpdate(this.currentSong);
    }
    this.scheduleCrossfade();
    return seekSeconds;
  }

  shuffle() {
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    this._saveSessionState();
    this.queue.cardRenderer.refreshNowPlayingCard();
  }

  checkOrCastSkipVote(member) {
    if (!this.currentSong) return { status: 'no_song' };
    if (this.isCurrentSongLofi()) return { status: 'is_247' };

    const settings = settingsManager.get(this.guild.id);
    const voteSkipEnabled = settings.voteSkipEnabled === true;
    const requesterCanForceSkip = settings.requesterCanForceSkip !== false;

    const isAdmin = isStrictAdmin(member) || member?.guild?.ownerId === member?.id;
    if (isAdmin) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_admin', title };
    }

    const isDJ = settings.djRoleId && member?.roles?.cache?.has(settings.djRoleId);
    if (isDJ) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_dj', title };
    }

    const isRequester = this.currentSong.requestedById && member?.id && (this.currentSong.requestedById === member.id);
    if (requesterCanForceSkip && isRequester) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_requester', title };
    }

    if (!voteSkipEnabled) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_single', title };
    }

    const activeVoiceChannel = this.queue.voiceManager.getVoiceChannel();
    const voiceMembers = activeVoiceChannel?.members?.filter(m =>
      !m.user?.bot && !m.voice?.selfDeaf && !m.voice?.serverDeaf
    ) || new Map();
    const listenerCount = voiceMembers.size;
    if (listenerCount <= 2) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_single', title };
    }

    const requiredVotes = Math.ceil(listenerCount * 0.5);
    const userName = member?.displayName || member?.user?.username || 'User';

    if (this.queue.skipVotes.has(member.id)) {
      this.queue.skipVotes.delete(member.id);
      return {
        status: 'vote_retracted',
        user: userName,
        current: this.queue.skipVotes.size,
        required: requiredVotes
      };
    }

    this.queue.skipVotes.add(member.id);
    if (this.queue.skipVotes.size >= requiredVotes) {
      const title = this.currentSong.title;
      const current = this.queue.skipVotes.size;
      this.skip();
      return {
        status: 'skipped',
        reason: 'vote_passed',
        title,
        current,
        required: requiredVotes
      };
    }

    return {
      status: 'vote_progress',
      user: userName,
      current: this.queue.skipVotes.size,
      required: requiredVotes,
      needed: requiredVotes - this.queue.skipVotes.size
    };
  }

  skip() {
    const now = Date.now();
    if (this.queue._lastSkipTime && (now - this.queue._lastSkipTime < 800)) {
      return false;
    }
    this.queue._lastSkipTime = now;

    this.queue.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this.queue.isQueueOnHold = false;
    this.queue._skipRequested = true;
    this.queue.skipVotes.clear();
    this.clearPreloadTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.prefetchedSong = null;
    this.clearCrossfadeTimer();

    if (this.player.state.status === AudioPlayerStatus.Idle) {
      this._handleSongEnd();
    } else {
      this.player.stop(true);
    }
    return true;
  }

  async playPrevious() {
    const now = Date.now();
    if (this.queue._lastPrevTime && (now - this.queue._lastPrevTime < 1500)) {
      return false;
    }
    this.queue._lastPrevTime = now;

    if (!this.queue.previousSongs || this.queue.previousSongs.length === 0) return false;
    const prevSong = this.queue.previousSongs.pop();
    if (!prevSong) return false;

    this.queue.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this.clearPreloadTimer();
    this.clearCrossfadeTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.prefetchedSong = null;

    if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
      this.songs.unshift(this.currentSong);
    }

    this.songs.unshift(prevSong);
    this.queue._skipRequested = true;
    this.queue._isPreviousAction = true;
    this.queue._pendingButtonAction = null;
    this.player.stop();
    return true;
  }

  async playNow(indexOrTrack, requestUser = null) {
    const idx = typeof indexOrTrack === 'number' ? indexOrTrack : (typeof indexOrTrack === 'string' && /^\d+$/.test(indexOrTrack) ? parseInt(indexOrTrack, 10) : NaN);
    if (!isNaN(idx) && idx >= 0 && idx < this.songs.length) {
      const targetTrack = this.songs.splice(idx, 1)[0];
      if (!targetTrack) return false;
      this.queue.paused = false;
      try { this.player.unpause(); } catch (e) {}
      this.queue.autoplayPool = [];
      this.queue.prefetchedSong = null;
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      if (this.queue.preloadedResource) {
        this._cleanupResource(this.queue.preloadedResource);
        this.queue.preloadedResource = null;
        this.queue.preloadedSongUrl = null;
      }
      this.songs.unshift(targetTrack);
      this.skip();
      return true;
    }
    if (indexOrTrack && typeof indexOrTrack === 'object') {
      if (typeof indexOrTrack.index === 'number' && indexOrTrack.index >= 0 && indexOrTrack.index < this.songs.length) {
        const queued = this.songs[indexOrTrack.index];
        if (queued && ((queued.url && queued.url === indexOrTrack.url) || queued.title === indexOrTrack.title)) {
          return this.playNow(indexOrTrack.index);
        }
      }
      return this.playTrackNow(indexOrTrack, requestUser);
    }
    return false;
  }

  async playTrackNow(song, requestUser = null) {
    this.queue.voiceManager.clear247IdleTimer();
    this.queue.autoplayPool = [];
    this.queue.prefetchedSong = null;
    let sanitized = this._sanitizeTrack(song);
    if (!sanitized) return false;
    if (requestUser) {
      this._attachRequester(sanitized, requestUser);
    }
    sanitized.is247 = false;
    sanitized.isUserRequest = true;
    this.queue.isQueueOnHold = false;
    this.queue.paused = false;
    try { this.player.unpause(); } catch (e) {}
    this.clearPreloadTimer();
    this.clearCrossfadeTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.prefetchedSong = null;
    this.queue.voiceManager.clearDisconnectTimer();
    this.queue.voiceManager.clearEmptyRoomTimer();

    this.songs.unshift(sanitized);
    this._saveSessionState();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this.queue._skipRequested = true;
      this.queue._isPreemptingLofi = true;
      if (this.player.state.status === AudioPlayerStatus.Idle) {
        await this.playNext();
      } else {
        this.player.stop(true);
      }
    }
    return true;
  }

  moveTrack(fromIndex, toIndex) {
    const from = parseInt(fromIndex, 10);
    const to = parseInt(toIndex, 10);
    if (isNaN(from) || isNaN(to) || from < 0 || to < 0 || from >= this.songs.length || to >= this.songs.length) {
      return false;
    }
    const [moved] = this.songs.splice(from, 1);
    this.songs.splice(to, 0, moved);
    this._saveSessionState();
    this.queue.cardRenderer.refreshNowPlayingCard();
    return true;
  }

  moveSong(fromIndex, toIndex) {
    return this.moveTrack(fromIndex, toIndex);
  }

  removeSong(index) {
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= this.songs.length) return null;
    if (idx === 0 && this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    const [removed] = this.songs.splice(idx, 1);
    this._saveSessionState();
    this.queue.cardRenderer.refreshNowPlayingCard();
    return removed || null;
  }

  clearQueue() {
    this.clearPreloadTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.prefetchedSong = null;
    this.queue.autoplayPool = [];
    this.songs = [];
    if (this.queue.loopMode === 'song' || this.queue.loopMode === 'queue') {
      this.queue.loopMode = 'off';
    }
    if (!this.queue.connection || this.queue.connection.state?.status === 'destroyed' || this.queue.connection.state?.status === 'disconnected') {
      this.queue.voiceSessionStartTime = null;
    }
  }

  stop() {
    this.queue.isStopped = true;
    this.queue._pendingButtonAction = null;
    this.queue._isProcessingAction = false;
    this.queue.cardRenderer.clearLiveLyrics();
    if (this.queue._repostCardTimer) {
      clearTimeout(this.queue._repostCardTimer);
      this.queue._repostCardTimer = null;
    }
    this.clearPlayCountTimer();
    this._clearCrossfadeTimer();
    this._clearSessionSaveInterval();
    this.clearPreloadTimer();
    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.autoplayPool = [];
    this.songs = [];
    this.currentSong = null;
    if (this.currentResource) {
      this._cleanupResource(this.currentResource);
      this.currentResource = null;
    }
    this.player.stop(true);
    this._saveSessionState();
    clearVoiceChannelStatus(this.queue.voiceChannel);
    if (!this.queue.mode247) {
      this.queue.destroy();
    }
  }

  setLoop(mode) {
    this.queue.loopMode = mode;
    settingsManager.update(this.guild.id, { loopMode: mode });
  }

  toggleLoop() {
    if (this.queue.loopMode === 'off') {
      this.queue.loopMode = 'song';
    } else if (this.queue.loopMode === 'song') {
      this.queue.loopMode = 'queue';
    } else {
      this.queue.loopMode = 'off';
    }
    settingsManager.update(this.guild.id, { loopMode: this.queue.loopMode });
    return this.queue.loopMode;
  }

  set247(enable) {
    this.queue.mode247 = enable;
    settingsManager.update(this.guild.id, { mode247: enable });
    if (enable) {
      this.queue.voiceManager.clearDisconnectTimer();
      this.queue.voiceManager.clearEmptyRoomTimer();
      if (this.queue.voiceChannel) {
        this._saveSessionState();
      }
    } else {
      this.queue.voiceManager.clear247IdleTimer();
      sessionManager.clearSession(this.guild.id);
      const humanCount = typeof this.queue.voiceManager.getHumanMemberCount === 'function' ? this.queue.voiceManager.getHumanMemberCount() : 1;
      const guildSettings = settingsManager.get(this.guild.id);
      if (humanCount === 0) {
        this.queue.voiceManager.startEmptyRoomTimer(guildSettings?.emptyChannelTimeout || 60);
      } else if (!this.currentSong && (!this.songs || this.songs.length === 0)) {
        this.queue.voiceManager.startDisconnectTimer((guildSettings?.emptyChannelTimeout || 60) * 1000);
      }
    }
  }

  toggle247() {
    this.queue.mode247 = !this.queue.mode247;
    this.set247(this.queue.mode247);
    return this.queue.mode247;
  }

  async switchTo247Lofi() {
    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)'));
    if (isCurrentLofi && this.queue.isPlaying && !this.queue.isPaused && (!this.songs || this.songs.length === 0)) {
      return {
        success: true,
        alreadyActive: true,
        message: 'Bot hiện đang phát nhạc nền Lofi 24/7 thư giãn rồi nhé ☕'
      };
    }

    const now = Date.now();
    if (this.queue._switchingTo247Lock && (now - this.queue._switchingTo247Lock < 3500)) {
      return {
        success: true,
        alreadyActive: true,
        message: 'Đang chuyển sang Lofi 24/7, vui lòng chờ một chút nhé ⏳'
      };
    }
    this.queue._switchingTo247Lock = now;

    this.queue._switchingTo247 = true;
    this.queue.mode247 = true;
    settingsManager.update(this.guild.id, { mode247: true });

    this.queue.voiceManager.clearDisconnectTimer();
    this.queue.voiceManager.clearEmptyRoomTimer();
    this.queue.voiceManager.clear247IdleTimer();
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();

    if (this.queue.preloadedResource) {
      this._cleanupResource(this.queue.preloadedResource);
      this.queue.preloadedResource = null;
      this.queue.preloadedSongUrl = null;
    }
    this.queue.prefetchedSong = null;
    this.queue.autoplayPool = [];

    this.queue.loopMode = 'off';
    if (this.songs && this.songs.length > 0) {
      this.queue.isQueueOnHold = true;
    }

    if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
      this.queue.lastUserTrack = this.currentSong;
    }

    this.clearPlayCountTimer();
    this.currentSong = null;
    if (this.currentResource) {
      this._cleanupResource(this.currentResource);
      this.currentResource = null;
    }

    if (this.player) {
      this.player.stop(true);
    }
    this.queue.isStopped = false;
    this.queue._switchingTo247 = false;

    const activeChannel = this.queue.voiceManager.getVoiceChannel();
    if (activeChannel) {
      setVoiceChannelStatus(activeChannel, '♾️ 24/7 Mode');
    }

    await this._play247BackgroundLofi();

    await sessionManager.saveSession(this.guild.id, {
      voiceChannelId: this.queue.voiceChannel?.id,
      textChannelId: this.queue.textChannel?.id,
      mode247: true,
      status: 'idle_247'
    });

    return {
      success: true,
      alreadyActive: false,
      message: this.songs.length > 0
        ? `Đã chuyển sang Lofi 24/7 (Đang giữ ${this.songs.length} bài trong hàng chờ)`
        : 'Đã chuyển sang chế độ phát Lofi 24/7 thư giãn ☕'
    };
  }

  async toggleLofiMode() {
    const now = Date.now();
    if (this.queue._toggleLofiLock && (now - this.queue._toggleLofiLock < 1500)) {
      return {
        success: true,
        message: 'Thao tác quá nhanh, vui lòng đợi một lát nhé ⏳'
      };
    }
    this.queue._toggleLofiLock = now;

    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)'));

    if (isCurrentLofi) {
      this.queue.paused = false;
      try { this.player?.unpause(); } catch (e) {}
      this.queue.isQueueOnHold = false;
      this.queue._skipRequested = true;

      if (this.songs && this.songs.length > 0) {
        this.currentSong = null;
        if (this.currentResource) {
          this._cleanupResource(this.currentResource);
          this.currentResource = null;
        }
        if (this.player) {
          this.player.stop(true);
        }
        await this.playNext();
        return {
          success: true,
          mode: 'user_music',
          resumedQueue: true,
          count: this.songs.length + 1,
          message: `Tiếp tục phát ${this.songs.length + 1} bài hát trong hàng chờ 🎵`
        };
      }

      const trackToReplay = this.queue.lastUserTrack || (this.queue.previousSongs && this.queue.previousSongs.length > 0 ? this.queue.previousSongs[this.queue.previousSongs.length - 1] : null);
      if (trackToReplay) {
        this.currentSong = null;
        if (this.currentResource) {
          this._cleanupResource(this.currentResource);
          this.currentResource = null;
        }
        if (this.player) {
          this.player.stop(true);
        }
        const songCopy = { ...trackToReplay, is247: false };
        if (songCopy.requestedBy === 'Auto (24/7)') {
          songCopy.requestedBy = 'Phát lại ↺';
        }
        this.songs.push(songCopy);
        await this.playNext();
        return {
          success: true,
          mode: 'user_music',
          replayedTrack: true,
          trackTitle: songCopy.title,
          message: `Phát lại bài hát: "${songCopy.title}" ↺`
        };
      }

      return {
        success: false,
        message: 'Hàng chờ trống và chưa có bài hát nào để phát lại.'
      };
    } else {
      if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
        this.queue.lastUserTrack = this.currentSong;
      }
      return await this.switchTo247Lofi();
    }
  }

  async _prefetchAutoplayTrack() {
    if (this.queue._isPrefetching) return;
    const guildSettings = settingsManager.get(this.guild.id);
    if (!guildSettings.autoplay || !this.currentSong) return;

    if (this.currentSong.requestedBy === 'Auto (24/7)') return;
    if (this.queue.voiceManager.getHumanMemberCount() === 0) return;

    if (this.songs.length === 0 && !this.queue.prefetchedSong) {
      if (this.queue.autoplayPool && this.queue.autoplayPool.length > 0) {
        while (this.queue.autoplayPool.length > 0) {
          const candidate = this.queue.autoplayPool.shift();
          if (candidate && candidate.url && !this.queue.history.includes(candidate.url) && candidate.url !== this.currentSong.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
            candidate.requestedBy = 'Tự động phát';
            candidate._seedUrl = this.currentSong?.url;
            this.queue.prefetchedSong = candidate;
            console.log(`[Autoplay Pre-fetch Pool Hit (0ms)] Nạp sẵn từ bộ đệm: "${candidate.title}"`);
            this.queue.cardRenderer._prefetchQueueLyrics();
            return;
          }
        }
      }

      this.queue._isPrefetching = true;
      try {
        const useAi = guildSettings.useAiAssistant !== false;
        const seedMeta = analyzeTrackOriginAndMeta(this.currentSong);
        let targetRegion = seedMeta.region;
        if (this.queue.sessionRegion && this.queue.sessionRegion === 'VI' && targetRegion === 'INTL') {
          targetRegion = 'VI';
        } else if (this.queue.sessionRegion && !targetRegion) {
          targetRegion = this.queue.sessionRegion;
        }
        const pool = await getRelatedTracksPool(this.currentSong, this.guild.id, useAi, targetRegion);
        if (pool && pool.length > 0) {
          const nextTrack = pool[0];
          nextTrack.requestedBy = 'Tự động phát';
          nextTrack._seedUrl = this.currentSong?.url;
          this.queue.prefetchedSong = nextTrack;
          this.queue.autoplayPool = pool.slice(1).map(t => {
            t.requestedBy = 'Tự động phát';
            t._seedUrl = this.currentSong?.url;
            return t;
          });
          console.log(`[Autoplay Metadata Pre-fetch (${targetRegion})] Đã tìm sẵn bài kế tiếp: "${nextTrack.title}" (${nextTrack.artist || 'YouTube'}) và lưu ${this.queue.autoplayPool.length} bài vào pool`);
          this.queue.cardRenderer.schedulePrefetchLyrics(2000);
        }
      } catch (err) {
        console.warn('[Autoplay Pre-fetch Error]:', err.message);
      } finally {
        this.queue._isPrefetching = false;
      }
    }
  }

  async enrichMissingThumbnails() {
    if (this.queue._isEnrichingThumbs) return;
    this.queue._isEnrichingThumbs = true;
    try {
      const missing = [];
      if (this.currentSong && !this.currentSong.thumbnail) {
        missing.push(this.currentSong);
      }
      for (const s of (this.songs || [])) {
        if (s && !s.thumbnail) {
          missing.push(s);
        }
      }

      if (missing.length === 0) return;

      let changed = false;
      const batchSize = 10;
      for (let i = 0; i < missing.length; i += batchSize) {
        const chunk = missing.slice(i, i + batchSize);
        await Promise.allSettled(chunk.map(async item => {
          if (!item.thumbnail && item.url) {
            const ytM = item.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
            if (ytM && ytM[1]) {
              item.thumbnail = `https://i.ytimg.com/vi/${ytM[1]}/hqdefault.jpg`;
              changed = true;
              return;
            }
          }
          if (item.uri && item.uri.startsWith('spotify:track:')) {
            const trackId = item.uri.replace('spotify:track:', '').split('?')[0];
            try {
              const fetch = globalThis.fetch || require('node-fetch');
              const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
              if (res.ok) {
                const d = await res.json();
                if (d.thumbnail_url) {
                  item.thumbnail = d.thumbnail_url;
                  changed = true;
                  return;
                }
              }
            } catch (e) {}
          }
        }));
      }

      if (changed) {
        this._saveSessionState();
      }
    } finally {
      this.queue._isEnrichingThumbs = false;
    }
  }

  _saveSessionState() {
    if (!this.guild || !this.queue.voiceChannel) return Promise.resolve();
    try {
      const isLofiCurrent = this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247;
      const userSongs = (this.songs || []).filter(s => s && s.requestedBy !== 'Auto (24/7)' && !s.is247);

      let position = 0;
      if (!isLofiCurrent && this.currentSong) {
        if (this.currentResource && typeof this.currentResource.playbackDuration === 'number') {
          position = Math.floor(((this.currentSong.seekPosition || 0) * 1000 + this.currentResource.playbackDuration) / 1000);
        } else {
          position = Math.floor(Number(this.currentSong.seekPosition) || 0);
        }
      }

      return sessionManager.saveSession(this.guild.id, {
        voiceChannelId: this.queue.voiceChannel.id,
        textChannelId: this.queue.textChannel?.id,
        mode247: this.queue.mode247,
        status: (this.queue.isPlaying && !isLofiCurrent) ? 'active' : 'idle_247',
        currentSong: (!isLofiCurrent && this.currentSong) ? this.currentSong : null,
        songs: userSongs,
        position: position,
        voiceSessionStartTime: this.queue.voiceSessionStartTime
      });
    } catch (e) {
      return Promise.resolve();
    }
  }
}

module.exports = QueuePlaybackEngine;
