const {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState
} = require('@discordjs/voice');
const {
  createResource,
  getRelatedTrack,
  getRelatedTracksPool,
  searchTrack,
  searchMultipleTracks,
  analyzeTrackOriginAndMeta,
  isCandidateMatchingRegion
} = require('../utils/musicExtractor');
const lofiDiscovery = require('../utils/lofiDiscovery');
const {
  createNowPlayingCard,
  createNowPlayingBanner,
  createNowPlayingEmbed,
  createMusicControls,
  createErrorEmbed,
  createEmbed,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
} = require('../utils/embed');
const settingsManager = require('./SettingsManager');
const { t } = require('../utils/i18n');
const historyManager = require('./HistoryManager');
const sessionManager = require('./SessionManager');
const lofiHistoryManager = require('./LofiHistoryManager');
const { logAction } = require('../utils/debugLogger');
const { hasEnoughMemoryToPreload, logMemoryUsage } = require('../utils/systemMonitor');
const { isStrictAdmin } = require('../utils/permissionHelper');
const config = require('../config');

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

class MusicQueue {
  constructor(guild, textChannel, voiceChannel, manager) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.manager = manager;

    this.songs = [];
    this.history = [];
    this.autoplayPool = []; // Bộ đệm Autoplay lưu sẵn 5-10 bài liên quan để chuyển bài tức thì (0ms)
    this.currentSong = null;
    this.prefetchedSong = null;
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this._isPreloading = false;
    this.preloadTimer = null;
    this.currentResource = null;
    this.connection = null;

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250
      }
    });

    this.volume = 80;
    this.crossfadeDuration = 0;
    this._crossfadeInterval = null;
    this._fadeInInterval = null;
    this._isCrossfading = false;
    this._sessionSaveInterval = null;
    this.loopMode = 'off';
    this.mode247 = true;
    this.paused = false;

    this.previousSongs = []; // Tối đa 5 bài hát đã nghe trước đó
    this.lastUserTrack = null; // Ghi nhớ bài hát gần nhất của user để phát lại khi quay về từ Lofi
    this.lofiHistory = [];   // Lưu tối đa 50 bài Lofi 24/7 đã phát gần nhất để chống trùng lặp
    this.disconnectTimeout = null;
    this.emptyRoomTimeout = null;
    this.idle247Timeout = null;
    this.crossfadeTimer = null;
    this._playCountTimer = null;
    this.nowPlayingMessage = null;
    this._repostCardTimer = null;
    this._isPrefetching = false;
    this._isPlayingNext = false;
    this.lastNonLofiSong = null; // Ghi nhớ bài hát gần nhất không phải Lofi để Autoplay tương tự
    this._isPreemptingLofi = false; // Cắt ngang Lofi phát ngay tức thì khi có người dùng order
    this._is247Loading = false; // Cờ kiểm tra đang nạp bài Lofi 24/7
    this.isQueueOnHold = false;
    this._bufferingTimeout = null;
    this._lofiRetryCount = 0;

    // Quản lý Live Synced Lyrics trên Discord Embed
    this.liveLyricsTimer = null;
    this.currentLyricText = '';
    this.currentLyricIndex = -1;
    this.cachedSyncedLyrics = null;
    this.hasSyncedLyrics = false;
    this.currentLyricOffsetMs = 0;
    this._lastLyricsEditTime = 0;
    this._lastProgressEditTime = 0;
    this._lastRenderedLyricIdx = -1;
    this._lastRenderedChunkIdx = -1;

    // Khóa thao tác & Optimistic Button State
    this._isProcessingAction = false;
    this._pendingButtonAction = null;
    this.skipVotes = new Set();

    this._initSettings();
    this._setupPlayerEvents();

    // Đăng ký lắng nghe sự kiện Lời bài hát về muộn (Hot-Attach)
    const { lyricsEvents } = require('../utils/lyricsHelper');
    this._onLyricsFound = (event) => {
      if (!this.currentSong || this.isDestroyed || this.isStopped) return;
      if (this.hasSyncedLyrics) return; // Đã có lyrics rồi thì không cần nạp đè
      const currentUrl = this.currentSong.url;
      if (event && event.url && currentUrl && event.url === currentUrl && event.lyricsData) {
        this.attachLateLyrics(this.currentSong, event.lyricsData);
      }
    };
    lyricsEvents.on('lyricsFound', this._onLyricsFound);
  }

  _clearBufferingWatchdog() {
    if (this._bufferingTimeout) {
      clearTimeout(this._bufferingTimeout);
      this._bufferingTimeout = null;
    }
  }

  _startBufferingWatchdog() {
    this._clearBufferingWatchdog();
    this._bufferingTimeout = setTimeout(async () => {
      if (this.player?.state?.status === AudioPlayerStatus.Buffering && !this.isDestroyed && !this.isStopped) {
        console.warn(`[AudioPlayer Watchdog] Player bị kẹt ở trạng thái Buffering quá 18s tại ${this.guild.name}! Tự động bỏ qua bài.`);
        if (this.currentResource) {
          this._cleanupResource(this.currentResource);
          this.currentResource = null;
        }
        if (this.songs.length > 0) {
          await this.playNext();
        } else if (this.mode247) {
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

  get isPlaying() {
    return this.player?.state?.status === AudioPlayerStatus.Playing || (!this.paused && Boolean(this.currentSong));
  }

  get isPaused() {
    return this.paused || this.player?.state?.status === AudioPlayerStatus.Paused;
  }

  clearPlayCountTimer() {
    if (this._playCountTimer) {
      clearTimeout(this._playCountTimer);
      this._playCountTimer = null;
    }
  }

  clearPreloadTimer() {
    if (this.preloadTimer) {
      clearTimeout(this.preloadTimer);
      this.preloadTimer = null;
    }
  }

  _clearCrossfadeTimer() {
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    if (this._crossfadeInterval) {
      clearInterval(this._crossfadeInterval);
      this._crossfadeInterval = null;
    }
    if (this._fadeInInterval) {
      clearInterval(this._fadeInInterval);
      this._fadeInInterval = null;
    }
    this._isCrossfading = false;
  }

  clearCrossfadeTimer() {
    this._clearCrossfadeTimer();
  }

  _startSessionSaveInterval() {
    this._clearSessionSaveInterval();
    this._sessionSaveInterval = setInterval(() => {
      if (this.isPlaying && this.currentSong && !this.isPaused) {
        this._saveSessionState();
      }
    }, 15000);
  }

  _clearSessionSaveInterval() {
    if (this._sessionSaveInterval) {
      clearInterval(this._sessionSaveInterval);
      this._sessionSaveInterval = null;
    }
  }

  scheduleCrossfade() {
    this._clearCrossfadeTimer();
    if (!this.currentSong || this.isDestroyed || this.isStopped || this.paused) return;
    const cfSec = this.crossfadeDuration;
    if (!cfSec || cfSec <= 0) return;

    const isLofiCurrent = this.isCurrentSongLofi();
    if (this.currentSong.isLive || (isLofiCurrent && this.songs.length === 0)) return;

    const totalDurationMs = this.currentSong.durationMs || parseDurationToMs(this.currentSong.duration);
    if (totalDurationMs < 20000) return; // Không áp dụng cho bài < 20s

    const currentPlayedMs = (this.currentSong.seekPosition || 0) * 1000 + (this.currentResource?.playbackDuration || 0);
    const remainingMs = totalDurationMs - currentPlayedMs;
    const triggerMs = remainingMs - (cfSec * 1000);

    if (triggerMs <= 0) {
      if (remainingMs > 500) {
        this._startFadeOut(Math.min(cfSec, Math.floor(remainingMs / 1000)));
      }
      return;
    }

    this.crossfadeTimer = setTimeout(() => {
      this.crossfadeTimer = null;
      this._startFadeOut(cfSec);
    }, triggerMs);
  }

  async _startFadeOut(cfSec) {
    if (this._isCrossfading || !this.currentSong || this.isDestroyed || this.isStopped || this.paused || !cfSec || cfSec <= 0) return;
    this._isCrossfading = true;

    if (this._fadeInInterval) {
      clearInterval(this._fadeInInterval);
      this._fadeInInterval = null;
    }

    // 1. Kích hoạt preload bài kế tiếp ngay lập tức nếu chưa preload
    this._triggerNextTrackPreload();

    // 2. Chu kỳ giảm dần âm lượng (Fade-Out) mỗi 200ms (tổng cộng N * 5 bước) từ this.volume / 100 về 0.02
    const steps = Math.max(1, Math.round(cfSec * 5));
    let step = 0;
    const baseVol = this.volume / 100;
    const minVol = 0.02;

    this._crossfadeInterval = setInterval(() => {
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
    if (this.isDestroyed || this.isStopped) return;
    console.log(`[MusicQueue Crossfade] Kết thúc fade-out, chuyển bài sớm sang bài kế tiếp...`);
    if (this.player.state.status === AudioPlayerStatus.Idle) {
      this._handleSongEnd();
    } else {
      this.player.stop(true);
    }
  }

  async _triggerNextTrackPreload() {
    if (this._isPreloading || this.preloadedResource || this.isDestroyed || this.isStopped) return;
    if (!hasEnoughMemoryToPreload()) {
      console.log('[MusicQueue Preload] RAM > 85%, hủy preload ngầm để tiết kiệm tài nguyên');
      return;
    }

    const nextTrack = (this.songs.length > 0) ? this.songs[0] : this.prefetchedSong;
    if (!nextTrack) return;
    const targetKey = nextTrack.url || nextTrack.searchQuery;
    if (!targetKey) return;

    const guildSettings = settingsManager.get(this.guild.id);
    if (nextTrack && !nextTrack.trimStart && !nextTrack._sbChecked && guildSettings.autoSkipOfftopic !== false && !nextTrack.is247 && !nextTrack.isLive) {
      nextTrack._sbChecked = true;
      try {
        const audioCacheManager = require('./AudioCacheManager');
        const cachedEntry = audioCacheManager.findCachedEntry(nextTrack);
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
          const { resolveSponsorBlockTrim } = require('../utils/sponsorBlockHelper');
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

    this._isPreloading = true;
    try {
      const res = await createResource(nextTrack, 0, 0, { priority: 'low' });
      if (res && !this.isDestroyed && !this.isStopped) {
        if (this.preloadedResource) {
          this._cleanupResource(this.preloadedResource);
        }
        this.preloadedResource = res;
        this.preloadedSongUrl = targetKey;
        console.log(`[MusicQueue Preload] Đã tải trước thành công bài kế tiếp (priority: low): "${nextTrack.title}"`);
      } else if (res) {
        this._cleanupResource(res);
      }
    } catch (err) {
      console.warn('[MusicQueue Preload Warning]:', err.message);
    } finally {
      this._isPreloading = false;
    }
  }

  _cleanupResource(resource) {
    if (resource && typeof resource.destroy === 'function') {
      try {
        resource.destroy();
      } catch (e) {}
    }
  }

  _initSettings() {
    const guildSettings = settingsManager.get(this.guild.id);
    this.mode247 = Boolean(guildSettings.mode247);
    this.volume = guildSettings.defaultVolume || 80;
    this.loopMode = guildSettings.loopMode || 'off';
    this.crossfadeDuration = typeof guildSettings.crossfadeDuration === 'number' ? guildSettings.crossfadeDuration : 0;
  }

  getVoiceChannel() {
    return (
      (this.voiceChannel?.id && this.guild.channels.cache.get(this.voiceChannel.id)) ||
      this.guild.members.me?.voice?.channel ||
      this.voiceChannel
    );
  }

  getHumanMemberCount() {
    const channel = this.getVoiceChannel();
    if (!channel) return 0;
    const botId = this.guild.client?.user?.id;
    const channelId = channel.id;

    // 1. Kiểm tra qua guild.voiceStates.cache (luôn chính xác ngay cả khi không có Privileged Intent)
    const voiceStates = this.guild.voiceStates?.cache;
    if (voiceStates && voiceStates.size > 0) {
      let count = 0;
      for (const state of voiceStates.values()) {
        if (state.channelId === channelId) {
          if (state.id === botId) continue;
          if (state.member?.user?.bot) continue;
          const user = this.guild.client.users?.cache?.get(state.id);
          if (user?.bot) continue;

          // Chủ động nạp member vào cache nếu chưa có
          if (!state.member) {
            this.guild.members.fetch(state.id).catch(() => {});
          }
          count++;
        }
      }
      return count;
    }

    // 2. Fallback qua channel.members
    if (channel.members) {
      return channel.members.filter(m => !m.user.bot).size;
    }

    return 0;
  }

  async connect() {
    if (this._connectPromise) {
      return this._connectPromise;
    }
    this._connectPromise = this._doConnect();
    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async _doConnect() {
    const currentGuild = this.voiceChannel?.guild || this.guild;

    if (this.connection) {
      if (this.connection.state.status === VoiceConnectionStatus.Destroyed) {
        this.connection = null;
      } else if (this.connection.state.status === VoiceConnectionStatus.Disconnected) {
        console.log(`[VoiceConnection] Connection đang Disconnected, thực hiện rejoin phòng ${this.voiceChannel.name}...`);
        this.connection.rejoin({
          channelId: this.voiceChannel.id,
          selfDeaf: true,
          selfMute: false
        });
        try {
          await entersState(this.connection, VoiceConnectionStatus.Ready, 10000);
        } catch (e) {
          console.warn('[VoiceConnection] Rejoin không Ready sau 10s, phá bỏ để kết nối lại từ đầu:', e.message);
          try { this.connection.destroy(); } catch (err) {}
          this.connection = null;
        }
        if (this.connection) return this.connection;
      } else if (this.connection.joinConfig?.channelId !== this.voiceChannel.id) {
        console.log(`[VoiceConnection] Chuyển phòng voice sang: ${this.voiceChannel.name} (${this.voiceChannel.id})`);
        this.connection.rejoin({
          channelId: this.voiceChannel.id,
          selfDeaf: true,
          selfMute: false
        });
        return this.connection;
      } else {
        // Đã có kết nối hoặc đang trong quá trình kết nối vào đúng phòng này
        if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
          try {
            await entersState(this.connection, VoiceConnectionStatus.Ready, 10000);
          } catch (e) {
            console.warn(`[VoiceConnection] Trạng thái ${this.connection?.state?.status} không Ready sau 10s, reset connection:`, e.message);
            try { this.connection?.destroy(); } catch (err) {}
            this.connection = null;
          }
        }
        if (this.connection) return this.connection;
      }
    }

    console.log(`[VoiceConnection] Đang kết nối vào phòng Voice: ${this.voiceChannel.name} (${this.voiceChannel.id}) tại ${currentGuild.name}`);

    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: currentGuild.id,
      adapterCreator: currentGuild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      debug: false
    });

    this.connection.on('error', error => {
      console.warn(`[VoiceConnection Error] ${this.guild.name}:`, error?.message || error);
    });

    this.connection.on(VoiceConnectionStatus.Ready, () => {
      logAction('VOICE_CONNECTION_READY', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.voiceChannel?.id
      });
      console.log(`[VoiceConnection Ready] Đã kết nối thành công vào phòng: ${this.voiceChannel?.name}`);
      if (this.player && this.connection) {
        this.connection.subscribe(this.player);
      }
      this._saveSessionState();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logAction('VOICE_CONNECTION_DISCONNECTED', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.voiceChannel?.id
      });

      if (this.isDestroyed || this._manualLeave) return;
      if (this._isReconnecting) return;

      try {
        if (this.connection) {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
          ]);
          logAction('VOICE_CONNECTION_RECONNECTING', {
            guild: this.guild.name,
            guildId: this.guild.id
          });
        }
      } catch (error) {
        // Nếu kết nối đã kịp chuyển sang Ready thì không làm gì cả
        if (this.connection && this.connection.state?.status === VoiceConnectionStatus.Ready) {
          return;
        }

        console.warn(`[VoiceConnection] Mất kết nối tại ${this.guild.name}`);
        if (this.mode247 && !this.isDestroyed && !this._manualLeave) {
          this._isReconnecting = true;
          try {
            // 1. Thử gọi rejoin trước để không làm bot nhảy ra ngoài phòng voice
            if (this.connection && this.connection.state?.status !== VoiceConnectionStatus.Destroyed) {
              try {
                this.connection.rejoin({
                  channelId: this.voiceChannel.id,
                  selfDeaf: true,
                  selfMute: false
                });
                await entersState(this.connection, VoiceConnectionStatus.Ready, 5000);
                if (this.currentResource && this.player && this.connection) {
                  this.connection.subscribe(this.player);
                }
                return;
              } catch (rejoinErr) {
                // Rejoin không phản hồi kịp, chuyển sang tái tạo kết nối
              }
            }

            // 2. Tái tạo kết nối nếu rejoin không thành công
            if (this.connection) {
              try { this.connection.destroy(); } catch (e) {}
              this.connection = null;
            }
            console.log(`[VoiceConnection 24/7] Đang tự động kết nối lại vào phòng ${this.voiceChannel?.name || 'Voice'} tại ${this.guild.name}...`);
            await this.connect();
            if (this.currentResource && this.player && this.connection) {
              this.connection.subscribe(this.player);
            }
          } catch (reconnectErr) {
            console.warn(`[VoiceConnection Reconnect Failed]:`, reconnectErr.message);
          } finally {
            this._isReconnecting = false;
          }
        } else {
          this.destroy();
        }
      }
    });

    if (this.player && this.connection) {
      this.connection.subscribe(this.player);
    }

    try {
      if (this.connection) {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
      }
    } catch (connErr) {
      console.warn(`[VoiceConnection] Chờ trạng thái Ready quá 15s tại ${this.guild.name}:`, connErr.message);
    }

    return this.connection;
  }

  _setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Playing, () => {
      this._clearBufferingWatchdog();
      console.log(`[AudioPlayer] Đang phát bài: ${this.currentSong?.title} tại ${this.guild.name}`);
    });

    this.player.on(AudioPlayerStatus.Buffering, () => {
      this._startBufferingWatchdog();
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      this._clearBufferingWatchdog();
      console.log(`[AudioPlayer] Kết thúc bài hát tại ${this.guild.name}`);
      this._handleSongEnd();
    });

    this.player.on('error', (error) => {
      this._clearBufferingWatchdog();
      console.error(`[AudioPlayer Error] Guild ${this.guild.name}:`, error);
      const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);

      logAction('PLAYER_ERROR', {
        guildId: this.guild.id,
        channelId: this.textChannel?.id,
        song: this.currentSong?.title || 'Unknown',
        url: this.currentSong?.url || 'N/A',
        error: error.message || String(error),
        is247: is247Lofi
      });

      const isEpipe = Boolean(error.message?.includes('EPIPE') || error.code === 'EPIPE');

      // Dọn dẹp resource stream cũ an toàn
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }

      // Chỉ gửi vào textChannel nếu bài hát do user yêu cầu và không phải lỗi đóng luồng EPIPE/ECONNRESET
      if (this.textChannel && !is247Lofi && !isEpipe) {
        this.textChannel.send({
          embeds: [createErrorEmbed(settingsManager.get(this.guild.id)?.language === 'en' ? `Playback error: ${error.message || 'Cannot play this track.'}` : `Lỗi phát nhạc: ${error.message || 'Không thể phát bài hát này.'}`)],
          flags: 4096
        }).catch(() => {});
      }
      this._handleSongEnd();
    });
  }

  async _handleSongEnd() {
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    this.skipVotes.clear();
    if (this._isPlayingNext || this.isDestroyed || this.isStopped || this._switchingTo247) return;
    const lastSong = this.currentSong;
    const wasExplicitSkip = Boolean(this._skipRequested);
    const wasPrevious = Boolean(this._isPreviousAction);
    const wasPreemptingLofi = Boolean(this._isPreemptingLofi);
    this._skipRequested = false;
    this._isPreviousAction = false;
    this._isPreemptingLofi = false;

    // Khi người dùng order bài mới ngắt ngang Lofi 24/7: phát ngay bài mới tức khắc
    if (wasPreemptingLofi && this.songs.length > 0) {
      this.clearPlayCountTimer();
      this.currentSong = null;
      this._cleanupResource(this.currentResource);
      this.currentResource = null;
      this.isQueueOnHold = false;
      await this.playNext();
      return;
    }

    if (lastSong) {
      logAction('TRACK_END', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.voiceChannel?.id,
        title: lastSong.title || 'Unknown',
        wasSkip: wasExplicitSkip,
        is247: Boolean(lastSong.is247 || lastSong.requestedBy === 'Auto (24/7)')
      });
    }

    this.clearPlayCountTimer();

    if (!wasPrevious && lastSong && !lastSong.is247 && lastSong.requestedBy !== 'Auto (24/7)') {
      this.lastUserTrack = lastSong;
      this.history.push(lastSong.url);
      if (this.history.length > 50) this.history.shift();

      this.previousSongs.push(lastSong);
      if (this.previousSongs.length > 5) this.previousSongs.shift();
    }

    // Chỉ lặp lại bài nếu người dùng không bấm nút Skip hoặc Previous thủ công và bài đó không phải là Lofi 24/7
    if (!wasExplicitSkip && !wasPrevious && this.loopMode === 'song' && lastSong && !lastSong.is247 && lastSong.requestedBy !== 'Auto (24/7)') {
      this.songs.unshift(lastSong);
    } else if (!wasExplicitSkip && !wasPrevious && this.loopMode === 'queue' && lastSong) {
      this.songs.push(lastSong);
    }

    this.currentSong = null;
    this._cleanupResource(this.currentResource);
    this.currentResource = null;

    const activeChannel = this.getVoiceChannel();
    const humanCount = this.getHumanMemberCount();
    const guildSettings = settingsManager.get(this.guild.id);
    const wasLofiTrack = Boolean(lastSong?.requestedBy === 'Auto (24/7)' || lastSong?.is247);
    const isFailedTrack = Boolean(lastSong && (
      (this.lastPlayErrorUrl && lastSong.url === this.lastPlayErrorUrl) ||
      (this.lastPlayErrorTitle && lastSong.title === this.lastPlayErrorTitle)
    ));
    const songToRelate = (!isFailedTrack && lastSong && !wasLofiTrack)
      ? lastSong
      : (this.lastNonLofiSong || (this.previousSongs.length > 0 ? this.previousSongs[this.previousSongs.length - 1] : null));

    // 0. Nếu phòng trống không còn ai (humanCount === 0) và bật chế độ 24/7:
    if (humanCount === 0 && this.mode247) {
      this.isQueueOnHold = true;
      this.prefetchedSong = null;
      this.preloadedResource = null;
      this.currentSong = null;
      if (this.player) this.player.stop();
      setVoiceChannelStatus(activeChannel, settingsManager.get(this.guild.id)?.language === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
      console.log(`[MusicQueue 24/7] Phòng trống (${this.guild.name}) - Đưa bot về chế độ 24/7 Sleep Mode (0% CPU)`);
      return;
    }

    // 1. Nếu trong hàng chờ còn bài hát của người dùng:
    // Ưu tiên phát ngay bài tiếp theo nếu:
    // - Không bị tạm giữ hàng chờ (this.isQueueOnHold)
    // - HOẶC người dùng vừa bấm Skip / PlayNow / Thêm bài mới (wasExplicitSkip / wasPreemptingLofi)
    if (this.songs.length > 0 && (!this.isQueueOnHold || wasExplicitSkip || wasPreemptingLofi)) {
      this.isQueueOnHold = false;
      await this.playNext();
      return;
    }

    // 2. Nếu bài vừa kết thúc là nhạc Lofi 24/7 (hoặc bot đang ở chế độ 24/7 Lofi và hàng chờ trống hoặc đang tạm giữ):
    if (wasLofiTrack && this.mode247) {
      if (isFailedTrack) {
        setTimeout(() => {
          if (this.mode247 && !this.currentSong && !this.isDestroyed) {
            this._play247BackgroundLofi();
          }
        }, 5000);
        return;
      }
      await this._play247BackgroundLofi();
      return;
    }

    // Tránh phát lại bài cũ nếu prefetched trùng với bài vừa phát
    if (this.prefetchedSong && (this.prefetchedSong.url === lastSong?.url || this.prefetchedSong.title === lastSong?.title)) {
      this.prefetchedSong = null;
    }

    // 0.1 Nếu đã có sẵn bài Autoplay tải trước ngầm trong RAM -> Nối bài ngay lập tức (0.001s instant transition)
    if (this.prefetchedSong && humanCount > 0 && guildSettings.autoplay !== false && !wasLofiTrack) {
      if (historyManager.isRecentlyPlayed(this.guild.id, this.prefetchedSong, 25)) {
        this.prefetchedSong = null;
      } else {
        const nextTrack = this._sanitizeTrack(this.prefetchedSong);
        this.prefetchedSong = null;
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

    // 0.2 Kiểm tra Bộ đệm Autoplay Pool (0ms instant transition nếu pool còn bài đạt chuẩn)
    if (this.autoplayPool && this.autoplayPool.length > 0 && humanCount > 0 && guildSettings.autoplay !== false && !wasLofiTrack) {
      while (this.autoplayPool.length > 0) {
        const candidate = this.autoplayPool.shift();
        if (candidate && candidate.url && !this.history.includes(candidate.url) && candidate.url !== songToRelate?.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
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

    // 1. KHI CÒN NGƯỜI TRONG PHÒNG VOICE (humanCount > 0):
    if (humanCount > 0) {
      // A. Nếu bài vừa phát là bài do User order hoặc Autoplay gợi ý -> Tiếp tục dùng Autoplay gợi ý bài tương tự!
      if (guildSettings.autoplay !== false && songToRelate && !wasLofiTrack) {
        const useAi = guildSettings.useAiAssistant !== false;
        const seedMeta = analyzeTrackOriginAndMeta(songToRelate);
        const targetRegion = seedMeta.region;

        let relatedTrack = null;
        try {
          const { getRelatedTracksPool } = require('../utils/musicExtractor');
          const pool = await getRelatedTracksPool(songToRelate, this.guild.id, useAi, targetRegion);
          if (pool && pool.length > 0) {
            relatedTrack = pool[0];
            this.autoplayPool = pool.slice(1).map(t => {
              const isEnPool = settingsManager.get(this.guild.id)?.language === 'en';
              t.requestedBy = isEnPool ? 'Autoplay' : 'Tự động phát';
              return t;
            });
            console.log(`[Autoplay Pool] Nạp bài "${relatedTrack.title}" và lưu ${this.autoplayPool.length} bài vào bộ đệm`);
          }
        } catch (getRelErr) {
          console.warn('[getRelatedTracksPool Error]:', getRelErr.message);
        }

        // Fallback tự động nếu không tìm được: Tìm bài cùng thể loại / cùng vùng theo seedMeta bằng searchMultipleTracks (10 ứng viên)
        if (!relatedTrack && songToRelate) {
          try {
            const fallbackQueries = [];
            const artist = seedMeta.realArtist;
            const songName = seedMeta.realTitle;

            if (targetRegion === 'INTL') {
              if (artist && artist !== 'YouTube') {
                fallbackQueries.push(`${artist} greatest hits official audio`);
                fallbackQueries.push(`${artist} official music video`);
              }
              fallbackQueries.push(`${songName} official audio`);
              fallbackQueries.push(`billboard hot hits official audio`);
            } else if (targetRegion === 'KR') {
              if (artist && artist !== 'YouTube') {
                fallbackQueries.push(`${artist} official audio MV`);
              }
              fallbackQueries.push(`${songName} kpop official`);
              fallbackQueries.push(`kpop hot hits official audio`);
            } else if (targetRegion === 'JP') {
              if (artist && artist !== 'YouTube') {
                fallbackQueries.push(`${artist} official audio`);
              }
              fallbackQueries.push(`${songName} official audio`);
              fallbackQueries.push(`jpop hot hits official audio`);
            } else {
              // Nhạc Việt:
              if (artist && artist.length > 2 && !artist.includes('Bài Hát Hay Nhất') && artist !== 'YouTube') {
                fallbackQueries.push(`${artist} bài hát hay nhất tuyển chọn`);
                fallbackQueries.push(`${artist} official audio`);
              }
              fallbackQueries.push(`${songName} official audio`);
              fallbackQueries.push(`nhac tre hot vpop official audio`);
            }

            for (const fallbackQuery of fallbackQueries) {
              if (relatedTrack) break;
              console.log(`[Autoplay Fallback Query (${targetRegion})] Thử tìm bài thay thế: "${fallbackQuery}"`);
              const fallbackResults = await searchMultipleTracks(fallbackQuery, 10, 'official');
              if (fallbackResults && fallbackResults.length > 0) {
                relatedTrack = fallbackResults.find(t => 
                  t && t.url &&
                  t.url !== songToRelate.url && 
                  t.url !== this.lastPlayErrorUrl && 
                  t.title !== this.lastPlayErrorTitle &&
                  !historyManager.isRecentlyPlayed(this.guild.id, t, 25) &&
                  isCandidateMatchingRegion(t, targetRegion, seedMeta)
                ) || null;

                if (!relatedTrack) {
                  relatedTrack = fallbackResults.find(t => 
                    t && t.url &&
                    t.url !== songToRelate.url && 
                    t.url !== this.lastPlayErrorUrl && 
                    t.title !== this.lastPlayErrorTitle &&
                    !historyManager.isRecentlyPlayed(this.guild.id, t, 15)
                  ) || null;
                }
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

        // TUYỆT ĐỐI KHÔNG nhảy sang Lofi nếu đang có người nghe và Autoplay đang bật!
        console.warn(`[Autoplay] Không tìm thấy bài kế tiếp cho "${songToRelate.title}", giữ bot ở trạng thái chờ người nghe.`);
        clearVoiceChannelStatus(activeChannel);
        return;
      }

      // B. Nếu bài vừa phát là Lofi 24/7 (người vừa vào phòng chưa order bài mới) -> Tiếp tục phát bài Lofi tiếp theo
      if (this.mode247 && wasLofiTrack) {
        await this._play247BackgroundLofi();
        return;
      }

      // C. Nếu hết bài và Autoplay đã bị tắt (guildSettings.autoplay === false):
      if (!this.mode247) {
        clearVoiceChannelStatus(activeChannel);
        const timeoutSeconds = guildSettings.emptyChannelTimeout || 60;
        this.startDisconnectTimer(timeoutSeconds * 1000);
        return;
      } else {
        await this._play247BackgroundLofi();
        return;
      }
    }

    // 2. KHI PHÒNG TRỐNG (humanCount === 0):
    if (this.mode247) {
      this.prefetchedSong = null;
      this.preloadedResource = null;
      setVoiceChannelStatus(activeChannel, '♾️ 24/7 Mode');
      await this._play247BackgroundLofi();
    } else {
      clearVoiceChannelStatus(activeChannel);
      const timeoutSeconds = guildSettings.emptyChannelTimeout || 60;
      this.startDisconnectTimer(timeoutSeconds * 1000);
    }
  }

  async _play247BackgroundLofi() {
    this.clearLiveLyrics();
    if (!this.mode247 || this.currentSong) return;
    try {
      this._is247Loading = true;
      setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');

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
        // Hỗ trợ cả bản beat ngắn và Long Lofi Mixes từ 45s đến 14400s (4 tiếng)
        return sec >= 45 && sec <= 14400;
      };

      let cleanTrack = null;

      // Vòng lặp tối đa 3 lần thử tìm kiếm Lofi động thông minh
      for (let attempt = 1; attempt <= 3; attempt++) {
        const recentHistory = lofiHistoryManager.getHistory(this.guild.id);
        if (this.songs.length > 0 || this.currentSong || !this.mode247) {
          this._is247Loading = false;
          return;
        }

        let query = '';
        let dynInfo = null;

        if (attempt < 3) {
          // Tầng 1 & 2: Dynamic Lofi Discovery Engine (Theo giờ & Nghệ sĩ Lofi hàng đầu, 100% miễn phí)
          const recentTitles = recentHistory.slice(-15).map(h => h.title);
          dynInfo = lofiDiscovery.getDynamicLofiSearchQuery(recentTitles);
          query = dynInfo.query;
          console.log(`[24/7 Lofi Discovery] Thử lần ${attempt}: Vibe [${dynInfo.vibeSlot}] Nghệ sĩ [${dynInfo.artist}] Query: "${query}" cho guild ${this.guild.name}`);
        } else {
          // Tầng 3 (Failover): Dự phòng với Dynamic Lofi Discovery Engine
          dynInfo = lofiDiscovery.getDynamicLofiSearchQuery([]);
          query = dynInfo?.query || 'chillhop music beats to study relax to lofi instrumental';
          console.log(`[24/7 Lofi Discovery] Thử lần 3 (Failover Dynamic Lofi): Query: "${query}" cho guild ${this.guild.name}`);
        }

        const results = await searchTrack(query);

        if (this.songs.length > 0 || this.currentSong || !this.mode247) {
          this._is247Loading = false;
          return;
        }

        if (results && results.length > 0) {
          const validList = results.filter(t => !isBlacklisted(t) && isValidDuration(t));
          // Sắp xếp ưu tiên các bản mix dài (>= 10 phút / 600s) để người nghe không bị ngắt quãng liên tục
          const sortedList = [...validList].sort((a, b) => {
            const secA = a.seconds || parseDurationToSeconds(a.duration) || 0;
            const secB = b.seconds || parseDurationToSeconds(b.duration) || 0;
            const isLongA = secA >= 600 ? 1 : 0;
            const isLongB = secB >= 600 ? 1 : 0;
            if (isLongB !== isLongA) return isLongB - isLongA;
            return secB - secA;
          });

          // Kiểm tra chống lặp nghiêm ngặt với 100 bài gần nhất
          cleanTrack = sortedList.find(t => !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 100));
          if (!cleanTrack) {
            // Nếu danh sách 100 bài đã kín, hạ ngưỡng xuống 50 bài gần nhất
            cleanTrack = sortedList.find(t => !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 50));
          }
          if (!cleanTrack) {
            // Nếu vẫn không có, chọn bản mix chất lượng tốt nhất trong danh sách tìm được
            cleanTrack = sortedList[0] || results.find(t => !isBlacklisted(t) && !isLiveOrRadio(t)) || results.find(t => !isLiveOrRadio(t)) || null;
          }
        }

        if (cleanTrack) break;

        // Nếu qua 2 lần thử mà vẫn chưa có bài khả dụng, giải phóng lịch sử Lofi của guild
        if (attempt === 2) {
          lofiHistoryManager.clearGuildHistory(this.guild.id);
        }
      }

      // Nếu sau 3 lần thử mà vẫn chưa có cleanTrack, sử dụng Fallback Track chuẩn
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

      // Kiểm tra Null-Check nghiêm ngặt trước khi gán
      if (cleanTrack && typeof cleanTrack === 'object') {
        const sanitized = this._sanitizeTrack(cleanTrack) || cleanTrack;
        sanitized.is247 = true;
        sanitized.requestedBy = 'Auto (24/7)';
        lofiHistoryManager.addTrack(this.guild.id, sanitized);

        this._lofiRetryCount = 0;
        this.songs.unshift(sanitized);
        logAction('SWITCH_TO_247_LOFI', {
          guild: this.guild.name,
          guildId: this.guild.id,
          channelId: this.voiceChannel?.id,
          track: sanitized.title
        });
        await this.playNext();
        return;
      }

      // Nếu không tìm thấy bài phù hợp: tự động thử lại sau 4s để không bao giờ bị im lặng
      console.warn(`[24/7 Lofi Background] Chưa tìm được bài Lofi phù hợp cho máy chủ ${this.guild.name}, thử lại sau 4 giây...`);
      setTimeout(() => {
        if (this.mode247 && !this.currentSong && !this.isDestroyed && this.songs.length === 0) {
          this._play247BackgroundLofi();
        }
      }, 4000);
    } catch (e) {
      console.warn('[24/7 Lofi Background Error]:', e.message);
      // Chống Deadlock im lặng: backoff retry
      if (!this.isDestroyed && this.mode247 && !this.currentSong && this.songs.length === 0) {
        this._lofiRetryCount = (this._lofiRetryCount || 0) + 1;
        const delay = Math.min(3000 + (this._lofiRetryCount * 1000), 10000);
        setTimeout(() => {
          if (this.mode247 && !this.currentSong && !this.isDestroyed && this.songs.length === 0) {
            this._play247BackgroundLofi();
          }
        }, delay);
      }
    } finally {
      this._is247Loading = false;
    }
  }

  async _play247LofiBackground() {
    return this._play247BackgroundLofi();
  }

  startDisconnectTimer(timeoutMs = 60000) {
    if (this.mode247) return; // Không bao giờ rời phòng khi bật 24/7
    this.clearDisconnectTimer();

    this.disconnectTimeout = setTimeout(() => {
      if (!this.currentSong && this.songs.length === 0 && !this.mode247) {
        if (this.textChannel) {
          logAction('MESSAGE_SEND', {
            type: 'DISCONNECT_NOTICE',
            channelId: this.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: 'Het nhac trong hang cho, bot da tu dong roi phong Voice.'
          });
          this.textChannel.send({
            embeds: [createEmbed(settingsManager.get(this.guild.id)?.language === 'en' ? '👋 Disconnected' : '👋 Rời phòng', settingsManager.get(this.guild.id)?.language === 'en' ? 'Queue has ended, bot automatically left the Voice channel.' : 'Hết nhạc trong hàng chờ, bot đã tự động rời phòng Voice.')],
            flags: 4096
          }).catch(() => {});
        }
        this.destroy();
      }
    }, timeoutMs);
  }

  clearDisconnectTimer() {
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
  }

  startEmptyRoomTimer(timeoutSeconds = 60) {
    if (this.mode247) {
      this.clear247IdleTimer();
      console.log(`[MusicQueue 24/7] Phòng trống tại máy chủ ${this.guild.name}. Đếm 1 phút (60s) trước khi chuyển sang trạng thái Treo Lofi 24/7...`);
      this.idle247Timeout = setTimeout(async () => {
        this.idle247Timeout = null; // HỦY BỘ ĐẾM HOÀN TOÀN NGAY KHI HẾT 1 PHÚT ĐỂ TIẾT KIỆM TÀI NGUYÊN!
        if (this.mode247) {
          const humanCount = this.getHumanMemberCount();
          if (humanCount === 0) {
            console.log(`[MusicQueue 24/7] Đã qua 1 phút phòng trống, đưa bot về chế độ 24/7 Sleep Mode (0% CPU)...`);
            this.songs = [];
            this.prefetchedSong = null;
            this.preloadedResource = null;
            this.currentSong = null;
            this.currentResource = null;
            this.loopMode = 'off';
            this.player.stop(true);
            setVoiceChannelStatus(this.voiceChannel, settingsManager.get(this.guild.id)?.language === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
            await sessionManager.saveSession(this.guild.id, {
              voiceChannelId: this.voiceChannel.id,
              textChannelId: this.textChannel?.id,
              mode247: true,
              status: 'idle_247'
            });
          }
        }
      }, 60000); // 1 phút = 60,000 ms
      return;
    }

    this.clearEmptyRoomTimer();
    console.log(`[MusicQueue] Phòng Voice trống tại máy chủ ${this.guild.name}. Bộ đếm ${timeoutSeconds}s bắt đầu...`);
    this.emptyRoomTimeout = setTimeout(() => {
      if (!this.mode247) {
        if (this.textChannel) {
          logAction('MESSAGE_SEND', {
            type: 'EMPTY_ROOM_NOTICE',
            channelId: this.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: `Phong Voice khong con ai trong ${timeoutSeconds}s`
          });
          this.textChannel.send({
            embeds: [createEmbed(settingsManager.get(this.guild.id)?.language === 'en' ? '👋 Disconnected' : '👋 Rời phòng', settingsManager.get(this.guild.id)?.language === 'en' ? `No listeners in Voice channel for ${timeoutSeconds} seconds, bot automatically left.` : `Phòng Voice không còn ai trong ${timeoutSeconds} giây, bot đã tự động rời phòng.`)],
            flags: 4096
          }).catch(() => {});
        }
        this.destroy();
      }
    }, timeoutSeconds * 1000);
  }

  clearEmptyRoomTimer() {
    let wasCounting = false;
    if (this.emptyRoomTimeout) {
      clearTimeout(this.emptyRoomTimeout);
      this.emptyRoomTimeout = null;
      wasCounting = true;
    }
    if (this.idle247Timeout) {
      clearTimeout(this.idle247Timeout);
      this.idle247Timeout = null;
      wasCounting = true;
    }
    if (wasCounting) {
      console.log(`[MusicQueue] Đã có người vào phòng Voice tại máy chủ ${this.guild.name}. Hủy bộ đếm tự động.`);
    }
  }

  clear247IdleTimer() {
    if (this.idle247Timeout) {
      clearTimeout(this.idle247Timeout);
      this.idle247Timeout = null;
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
    this.clear247IdleTimer();
    this.autoplayPool = []; // Làm mới bộ đệm Autoplay khi người dùng chủ động order bài mới
    song = this._sanitizeTrack(song);
    if (!song) return null;
    this._attachRequester(song, requestUser);
    song.is247 = false;
    song.isUserRequest = true;

    const isCurrentLofi = this.isCurrentSongLofi() || this._is247Loading;
    this.isQueueOnHold = false;

    if (isCurrentLofi) {
      // Khi đang phát hoặc đang nạp bài Lofi 24/7 và có người dùng order nhạc mới:
      // Chèn bài mới lên đầu hàng chờ và ngắt ngay bài Lofi để phát ngay tức khắc (0s chờ)
      this._skipRequested = true;
      this._isPreemptingLofi = true;
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
      this.prefetchedSong = null;

      this.songs.unshift(song);
      this._saveSessionState();
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();

      if (this.player.state.status === AudioPlayerStatus.Idle) {
        await this.playNext();
      } else {
        this.player.stop(true);
      }
      return { song, position: 1, isPlayingNow: true };
    }

    // Nếu bot đang rảnh rỗi (Idle) và chưa có bài đang phát: phát ngay lập tức
    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      if (this.preloadedResource) {
        this._cleanupResource(this.preloadedResource);
        this.preloadedResource = null;
        this.preloadedSongUrl = null;
      }
      this.songs.push(song);
      this._saveSessionState();
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();
      await this.playNext();
      return { song, position: 1, isPlayingNow: true };
    }

    // Chuẩn FIFO: Chèn bài mới sau bài user cuối cùng, nhưng luôn đứng TRƯỚC các bài Auto Prefetch
    const isUserTrack = (s) => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)';
    const firstAutoIdx = this.songs.findIndex(s => !isUserTrack(s));

    if (firstAutoIdx !== -1) {
      this.songs.splice(firstAutoIdx, 0, song);
    } else {
      this.songs.push(song);
    }

    if (this.songs[0] === song && this.preloadedResource) {
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
    }

    this._saveSessionState();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.schedulePreload();
    this.schedulePrefetchLyrics(1000);
    if (!this.hasSyncedLyrics) {
      this.refreshNowPlayingCard();
    }
    this.scheduleRepostNowPlayingCard(1500);

    const userSongs = this.getUserSongs();
    const position = userSongs.findIndex(s => s === song) + 1;
    return { song, position: position > 0 ? position : 1, isPlayingNow: false };
  }

  async addSongs(songArray, requestUser) {
    this.clear247IdleTimer();
    this.autoplayPool = []; // Làm mới bộ đệm Autoplay khi thêm danh sách bài mới
    const existingUrls = new Set((this.songs || []).map(s => s.url).filter(Boolean));
    if (this.currentSong?.url) existingUrls.add(this.currentSong.url);

    const sanitized = [];
    for (let i = 0; i < songArray.length; i++) {
      const s = this._sanitizeTrack(songArray[i], i);
      if (s) {
        if (s.url && existingUrls.has(s.url)) {
          continue;
        }
        if (s.url) existingUrls.add(s.url);
        this._attachRequester(s, requestUser);
        s.is247 = false;
        s.isUserRequest = true;
        sanitized.push(s);
      }
    }
    if (sanitized.length === 0) return null;

    // Giới hạn trần cứng tối đa 200 bài trong hàng chờ
    const MAX_QUEUE_SIZE = 200;
    const remainingSlots = Math.max(0, MAX_QUEUE_SIZE - this.songs.length);
    if (remainingSlots <= 0) {
      console.warn(`[Queue Overflow] Hàng chờ guild ${this.guild?.id} đã đạt giới hạn tối đa ${MAX_QUEUE_SIZE} bài.`);
      return null;
    }
    const finalTracks = sanitized.slice(0, remainingSlots);

    const isCurrentLofi = this.isCurrentSongLofi() || this._is247Loading;
    this.isQueueOnHold = false;

    if (isCurrentLofi) {
      this._skipRequested = true;
      this._isPreemptingLofi = true;
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
      this.prefetchedSong = null;

      this.songs.unshift(...finalTracks);
      this._saveSessionState();
      this.enrichMissingThumbnails().catch(() => {});
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();

      if (this.player.state.status === AudioPlayerStatus.Idle) {
        await this.playNext();
      } else {
        this.player.stop(true);
      }
      return { count: finalTracks.length, firstPosition: 1, isPlayingNow: true };
    }

    // Nếu bot đang rảnh rỗi và chưa có bài đang phát: phát ngay bài đầu tiên
    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      if (this.preloadedResource) {
        this._cleanupResource(this.preloadedResource);
        this.preloadedResource = null;
        this.preloadedSongUrl = null;
      }
      this.songs.push(...finalTracks);
      this._saveSessionState();
      this.enrichMissingThumbnails().catch(() => {});
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();
      await this.playNext();
      return { count: finalTracks.length, firstPosition: 1, isPlayingNow: true };
    }

    // Chuẩn FIFO: Chèn cụm playlist vào sau các bài user trước đó, nhưng đứng TRƯỚC các bài Auto Prefetch
    const isUserTrack = (s) => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)';
    const firstAutoIdx = this.songs.findIndex(s => !isUserTrack(s));

    if (firstAutoIdx !== -1) {
      this.songs.splice(firstAutoIdx, 0, ...finalTracks);
    } else {
      this.songs.push(...finalTracks);
    }

    if (this.songs[0] === finalTracks[0] && this.preloadedResource) {
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
    }

    this._saveSessionState();
    this.enrichMissingThumbnails().catch(() => {});
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.schedulePreload();
    this.schedulePrefetchLyrics(2000);
    if (!this.hasSyncedLyrics) {
      this.refreshNowPlayingCard();
    }
    this.scheduleRepostNowPlayingCard(1500);

    const userSongs = this.getUserSongs();
    const firstPosition = userSongs.findIndex(s => s === finalTracks[0]) + 1;
    return { count: finalTracks.length, firstPosition: firstPosition > 0 ? firstPosition : 1, isPlayingNow: false };
  }


  get currentTrack() {
    return this.currentSong;
  }

  get queue() {
    return this.songs;
  }

  get autoplay() {
    const settings = settingsManager.get(this.guild.id);
    return settings.autoplay !== false;
  }

  /**
   * Lập lịch nạp sẵn luồng âm thanh (Audio Preload) và Lời bài hát (Lyric Pre-fetch)
   * ở mốc 18 giây trước khi bài hiện tại kết thúc.
   * Giúp chuyển bài mới ngay lập tức (< 0.05s) và nạp sẵn Lyric vào RAM Cache.
   */
  schedulePreload() {
    this.clearPreloadTimer();
    if (!this.currentSong || this.isDestroyed || this.isStopped) return;

    const is247 = Boolean(this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)' || this.currentSong.isLive);
    const totalSec = parseDurationToSeconds(this.currentSong.duration);

    if (is247 || totalSec <= 0) {
      return;
    }

    const currentPlayedMs = (this.currentSong.seekPosition || 0) * 1000 + (this.currentResource?.playbackDuration || 0);
    const remainingMs = (totalSec * 1000) - currentPlayedMs;
    const triggerAfterMs = Math.max(500, remainingMs - 18000);

    this.preloadTimer = setTimeout(async () => {
      this.preloadTimer = null;
      await this._executePreloadFlow();
    }, triggerAfterMs);
  }

  async _executePreloadFlow() {
    if (!this.currentSong || this.isDestroyed || this.isStopped) return;

    // 1. Xác định bài hát tiếp theo: từ hàng chờ (Queue) hoặc từ Autoplay Pool / Prefetch
    let nextTrack = (this.songs && this.songs.length > 0) ? this.songs[0] : null;

    if (!nextTrack) {
      const guildSettings = settingsManager.get(this.guild.id);
      if (guildSettings.autoplay !== false && this.getHumanMemberCount() > 0 && this.currentSong.requestedBy !== 'Auto (24/7)') {
        // A. Kiểm tra Autoplay Pool trước (0ms)
        if (this.autoplayPool && this.autoplayPool.length > 0) {
          while (this.autoplayPool.length > 0) {
            const candidate = this.autoplayPool.shift();
            if (candidate && candidate.url && !this.history.includes(candidate.url) && candidate.url !== this.currentSong.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
              const isEnCandidate = settingsManager.get(this.guild.id)?.language === 'en';
            candidate.requestedBy = isEnCandidate ? 'Autoplay' : 'Tự động phát';
              this.prefetchedSong = candidate;
              nextTrack = candidate;
              console.log(`[Autoplay Preload Pool Hit (0ms)] Nạp sẵn bài từ bộ đệm: "${candidate.title}"`);
              break;
            }
          }
        }

        // B. Nếu pool trống, kích hoạt quét gợi ý mới
        if (!nextTrack && !this.prefetchedSong) {
          await this._prefetchAutoplayTrack();
          nextTrack = this.prefetchedSong;
        } else if (!nextTrack && this.prefetchedSong) {
          nextTrack = this.prefetchedSong;
        }
      }
    }

    if (!nextTrack) return;

    // 2. Kích hoạt Preload luồng âm thanh Audio Stream vào RAM (preloadedResource)
    await this._triggerNextTrackPreload();

    // 3. Tải trước Lời bài hát vào RAM Cache (Lyrics Pre-fetch)
    try {
      const { prefetchLyrics } = require('../utils/lyricsHelper');
      const settingsManager = require('./SettingsManager');
      const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
      const durMs = parseDurationToMs(nextTrack.duration);
      prefetchLyrics(nextTrack.title, nextTrack.artist, durMs, nextTrack.url, guildSettings?.lyricsLayers);
    } catch (lyricPrefetchErr) {}
  }

  async playNext() {
    if (this._isPlayingNext) return;
    this._isPlayingNext = true;
    this.skipVotes.clear();

    try {
      if (this.songs.length === 0) return;

      this.isStopped = false;
      this.isDestroyed = false;
      this._pendingButtonAction = null;
      this.clearLiveLyrics();
      this.clearPreloadTimer();
      this._clearCrossfadeTimer();
      this._clearSessionSaveInterval();
      const conn = await this.connect();

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
      this.currentSong.seekPosition = initialSeekSeconds;
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.paused = false;
      try { this.player.unpause(); } catch (e) {}
      this._saveSessionState();

      const guildSettings = settingsManager.get(this.guild.id);
      this.crossfadeDuration = typeof guildSettings.crossfadeDuration === 'number' ? guildSettings.crossfadeDuration : 0;
      const crossfade = this.crossfadeDuration;

      // LAZY EVALUATION: Kiểm tra phân đoạn kịch MV YouTube qua SponsorBlock hoặc SSD Cache (ngay trước khi phát)
      if (this.currentSong && !this.currentSong.trimStart && !this.currentSong._sbChecked && guildSettings.autoSkipOfftopic !== false && !this.currentSong.is247 && !this.currentSong.isLive) {
        this.currentSong._sbChecked = true;
        try {
          const audioCacheManager = require('./AudioCacheManager');
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
            const { resolveSponsorBlockTrim } = require('../utils/sponsorBlockHelper');
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
              console.log(`[SponsorBlock Auto-Trim] "${this.currentSong.title}": Tự động cắt ${trimInfo.skippedIntroSec}s mở đầu, ${trimInfo.skippedOutroSec}s kết thúc (Nhạc thực tế: ${this.currentSong.duration})`);
            }
          }
        } catch (sbErr) {}
      }

      const targetKey = this.currentSong.url || this.currentSong.searchQuery;
      let resource = null;

      // Sử dụng ngay tài nguyên âm thanh đã tải sẵn ngầm trong RAM (0.001s instant transition) nếu không tua vị trí cũ
      if (!initialSeekSeconds && this.preloadedResource && this.preloadedSongUrl === targetKey) {
        resource = this.preloadedResource;
        this.preloadedResource = null;
        this.preloadedSongUrl = null;
      } else {
        if (this.preloadedResource) {
          this._cleanupResource(this.preloadedResource);
          this.preloadedResource = null;
          this.preloadedSongUrl = null;
        }
        resource = await createResource(this.currentSong, 0, initialSeekSeconds, { priority: 'high' });
      }

      if (this.currentResource && this.currentResource !== resource) {
        this._cleanupResource(this.currentResource);
      }
      this.currentResource = resource;

      // Hủy bỏ triệt để mọi timer/interval điều chỉnh âm lượng cũ
      if (this._fadeInInterval) {
        clearInterval(this._fadeInInterval);
        this._fadeInInterval = null;
      }
      if (this._crossfadeInterval) {
        clearInterval(this._crossfadeInterval);
        this._crossfadeInterval = null;
      }

      // Logic Fade-In: Chỉ chạy khi người dùng chủ động BẬT crossfade (crossfadeDuration > 0)
      const cfSec = this.crossfadeDuration;
      if (cfSec > 0 && resource.volume && !initialSeekSeconds) {
        const targetVol = this.volume / 100;
        const startVol = 0.05 * targetVol;
        resource.volume.setVolume(startVol);
        const fadeInSteps = Math.max(1, Math.round(Math.min(cfSec, 4) * 5));
        let currentStep = 0;
        this._fadeInInterval = setInterval(() => {
          if (!this.currentResource || !this.currentResource.volume || this._isCrossfading) {
            if (this._fadeInInterval) clearInterval(this._fadeInInterval);
            this._fadeInInterval = null;
            return;
          }
          currentStep++;
          const fraction = currentStep / fadeInSteps;
          const newVol = startVol + (targetVol - startVol) * fraction;
          try {
            this.currentResource.volume.setVolume(Math.min(targetVol, newVol));
          } catch (e) {}
          if (currentStep >= fadeInSteps) {
            if (this._fadeInInterval) clearInterval(this._fadeInInterval);
            this._fadeInInterval = null;
            if (this.currentResource?.volume) {
              try { this.currentResource.volume.setVolume(targetVol); } catch (e) {}
            }
          }
        }, 200);
      } else if (resource.volume) {
        // Mặc định (crossfade = 0): Giữ âm lượng phẳng cố định 100% từ frame đầu tiên đến hết bài
        resource.volume.setVolume(this.volume / 100);
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

        // Ghi nhận ngay vào danh sách "Nghe gần đây" khi bắt đầu phát!
        if (!this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
          this.lastNonLofiSong = this.currentSong;
          if (!this.history.includes(this.currentSong.url)) {
            this.history.unshift(this.currentSong.url);
            if (this.history.length > 50) this.history.pop();
          }
          historyManager.addRecentHistory(this.guild.id, this.currentSong).catch(() => {});

          // Nạp sẵn Lời bài hát (Lyric Pre-fetch) vào RAM Cache trễ 2s để tránh tranh chấp 1 Core CPU với ffmpeg
          const songForLyric = this.currentSong;
          setTimeout(() => {
            if (this.currentSong === songForLyric && !this.isDestroyed && !this.isStopped) {
              try {
                const { prefetchLyrics } = require('../utils/lyricsHelper');
                const settingsManager = require('./SettingsManager');
                const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
                const durMs = songForLyric.durationMs || parseDurationToMs(songForLyric.duration);
                prefetchLyrics(songForLyric.title, songForLyric.artist, durMs, songForLyric.url, guildSettings?.lyricsLayers);
              } catch (e) {}
            }
          }, 2000);

          // Đặt bộ hẹn giờ xác nhận lượt nghe (10s hoặc 1/3 bài nếu < 30s) để tính vào "Phổ biến trong máy chủ"
          this.clearPlayCountTimer();
          const durSec = parseDurationToSeconds(this.currentSong.duration);
          const waitMs = (durSec > 0 && durSec < 30) ? Math.max(3000, Math.floor((durSec / 3) * 1000)) : 10000;
          const songToRecord = this.currentSong;

          this._playCountTimer = setTimeout(() => {
            if (this.currentSong === songToRecord && !this.isDestroyed && !this.isStopped && !songToRecord._playCountRecorded) {
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
          channelId: this.voiceChannel?.id,
          title: this.currentSong.title || 'Unknown',
          url: this.currentSong.url || 'N/A',
          duration: this.currentSong.duration || 'N/A',
          requestedBy: requesterName,
          is247: Boolean(this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)')
        });
      }

      // Cập nhật trạng thái kênh Voice (Voice Channel Status)
      if (this.currentSong?.requestedBy === 'Auto (24/7)') {
        setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      } else {
        const voiceTitle = (this.currentSong?.title || this.currentSong?.name || 'Đang phát nhạc').trim();
        setVoiceChannelStatus(this.voiceChannel, `🎶 ${voiceTitle}`);
      }

      // Lập lịch tải trước (Preload) ở 20s cuối bài để bảo vệ RAM VPS
      this.schedulePreload();
      this.scheduleCrossfade();
      this._startSessionSaveInterval();

      // Gửi hoặc Cập nhật Card Now Playing bài đang phát (Công khai cho cả phòng xem và điều khiển)
      this._pendingButtonAction = null;
      const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);
      if (this.textChannel && guildSettings.announceSongs !== false && !is247Lofi) {
        try {
          const cardPayload = createNowPlayingCard(this.currentSong, this);

          let edited = false;
          if (this.nowPlayingMessage) {
            try {
              const lastMessages = await this.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
              const isLastMessage = lastMessages && lastMessages.first()?.id === this.nowPlayingMessage.id;

              if (isLastMessage) {
                logAction('MESSAGE_EDIT', {
                  type: 'NOW_PLAYING_CARD_V2',
                  channelId: this.textChannel.id,
                  messageId: this.nowPlayingMessage.id,
                  song: (this.currentSong?.title || '').slice(0, 60)
                });
                await this.nowPlayingMessage.edit(cardPayload);
                edited = true;
              } else {
                logAction('MESSAGE_DELETE', {
                  type: 'NOW_PLAYING_CARD_OLD',
                  channelId: this.textChannel.id,
                  messageId: this.nowPlayingMessage.id
                });
                await this.nowPlayingMessage.delete().catch(() => {});
                this.nowPlayingMessage = null;
              }
            } catch (e) {
              this.nowPlayingMessage = null;
            }
          }

          if (!edited) {
            logAction('MESSAGE_SEND', {
              type: 'NOW_PLAYING_CARD_V2',
              channelId: this.textChannel.id,
              guildId: this.guild.id,
              song: (this.currentSong?.title || '').slice(0, 60)
            });
            const msg = await this.textChannel.send(cardPayload);
            this.nowPlayingMessage = msg;
          }

          if (!is247Lofi) {
            this.startLiveLyrics();
          }
        } catch (cardError) {
          console.warn(`[Card Send Warning] Không thể gửi card Now Playing tới kênh ${this.textChannel.id}:`, cardError.message);
        }
      } else if (is247Lofi && this.nowPlayingMessage) {
        // Cập nhật lại giao diện 24/7 khi bài Lofi mới bắt đầu (sau khi người dùng bấm Skip / chuyển bài)
        try {
          this.clearLiveLyrics();
          this._is247Skipping = false;
          await this.nowPlayingMessage.edit(createNowPlayingCard(this.currentSong, this)).catch(() => {});
        } catch (npErr) {
          console.warn('[24/7 NowPlaying Sync Warning]:', npErr.message);
        }
      }
    } catch (error) {
      console.error(`[Play Error] ${this.currentSong?.title || 'Unknown'}:`, error);
      const failedSong = this.currentSong;
      const is247Lofi = Boolean(failedSong?.requestedBy === 'Auto (24/7)' || failedSong?.is247);

      this.lastPlayErrorUrl = failedSong?.url || null;
      this.lastPlayErrorTitle = failedSong?.title || null;

      // Chỉ gửi log báo cáo lỗi vào Discord nếu là bài do user yêu cầu (nhạc Lofi 24/7 nền thì âm thầm đổi bài)
      if (!is247Lofi) {
        logAction('PLAY_ERROR', {
          guildId: this.guild.id,
          channelId: this.textChannel?.id,
          song: failedSong?.title || 'Unknown',
          url: failedSong?.url || 'N/A',
          error: error.message || String(error),
          is247: false
        });
      } else {
        console.warn(`[24/7 Lofi Stream Warning]: Bỏ qua bài lỗi "${failedSong?.title || 'Unknown'}", tự động chuyển bài Lofi kế tiếp.`);
      }

      // Chỉ gửi thông báo lỗi ra textChannel nếu là bài do user yêu cầu (không spam bài 24/7 nền)
      if (this.textChannel && !is247Lofi) {
        this.textChannel.send({
          embeds: [createErrorEmbed(settingsManager.get(this.guild.id)?.language === 'en' ? `Could not play **${failedSong?.title || 'selected'}**: ${error.message}` : `Không thể phát bài **${failedSong?.title || 'đã chọn'}**: ${error.message}`)],
          flags: 4096
        }).catch(() => {});
      }

      // Dọn dẹp resource và timer của bài lỗi
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();

      // Giải phóng khóa _isPlayingNext TRƯỚC KHI chuyển tiếp để _handleSongEnd không bị chặn bởi guard clause!
      this._isPlayingNext = false;
      await this._handleSongEnd();
    } finally {
      this._isPlayingNext = false;
    }
  }

  setVolume(vol) {
    this._clearCrossfadeTimer();
    this.volume = Math.max(0, Math.min(100, vol));
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume / 100);
    }
    settingsManager.update(this.guild.id, { defaultVolume: this.volume });
    this.scheduleCrossfade();
  }

  pause() {
    if (!this.paused) {
      this._clearCrossfadeTimer();
      if (this.liveLyricsTimer) {
        clearTimeout(this.liveLyricsTimer);
        this.liveLyricsTimer = null;
      }
      this.player.pause();
      this.paused = true;
      this.refreshNowPlayingCard();
    }
  }

  resume() {
    if (this.paused) {
      this.player.unpause();
      this.paused = false;
      this.scheduleCrossfade();
      if (this.hasSyncedLyrics) {
        this.scheduleNextLyricUpdate(this.currentSong);
      } else {
        this.refreshNowPlayingCard();
        this.scheduleProgressBarUpdate(this.currentSong);
      }
    }
  }

  async seek(seconds) {
    if (!this.currentSong || this.isDestroyed || this.isStopped) {
      throw new Error('Không có bài hát nào đang phát để tua');
    }

    const seekSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    console.log(`[MusicQueue Seek] Tua bài "${this.currentSong.title}" đến ${seekSeconds}s tại máy chủ ${this.guild.name}`);

    // Hủy các timer chuyển bài / preload cũ và dọn dẹp tiến trình con
    this._clearCrossfadeTimer();
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;

    const resource = await createResource(this.currentSong, 0, seekSeconds, { priority: 'high' });

    this._cleanupResource(this.currentResource);
    this.currentResource = resource;
    if (resource.volume) {
      resource.volume.setVolume(this.volume / 100);
    }

    this.currentSong.startTime = Date.now() - (seekSeconds * 1000);
    this.currentSong.seekPosition = seekSeconds;
    this.paused = false;
    if (this.hasSyncedLyrics) {
      this.currentLyricIndex = -1;
      this.scheduleNextLyricUpdate(this.currentSong);
    }

    if (this.connection) {
      this.connection.subscribe(this.player);
    }

    this.player.play(resource);
    this.schedulePreload();
    if (!this.hasSyncedLyrics) {
      this.refreshNowPlayingCard();
      this.scheduleProgressBarUpdate(this.currentSong);
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
    this.refreshNowPlayingCard();
  }

  async addTrack(track) {
    return this.addSong(track, track.requestedBy || 'Web User');
  }

  togglePause() {
    if (this.paused) {
      this.resume();
      return false;
    } else {
      this.pause();
      return true;
    }
  }


  /**
   * Kiểm tra điều kiện bỏ qua bài hát hoặc ghi nhận phiếu Vote Skip
   * @param {Object} member
   * @returns {{ status: string, reason?: string, title?: string, current?: number, required?: number, needed?: number, user?: string }}
   */
  checkOrCastSkipVote(member) {
    if (!this.currentSong) {
      return { status: 'no_song' };
    }
    if (this.isCurrentSongLofi()) {
      return { status: 'is_247' };
    }

    const settings = settingsManager.get(this.guild.id);
    const voteSkipEnabled = settings.voteSkipEnabled === true;
    const requesterCanForceSkip = settings.requesterCanForceSkip !== false;

    // 1. Quản trị viên (Admin) luôn được quyền force skip ngay lập tức
    const isAdmin = isStrictAdmin(member) || member?.guild?.ownerId === member?.id;
    if (isAdmin) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_admin', title };
    }

    // 2. Vai trò DJ được cấu hình riêng trong máy chủ
    const isDJ = settings.djRoleId && member?.roles?.cache?.has(settings.djRoleId);
    if (isDJ) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_dj', title };
    }

    // 3. Người đã order (Requester) bài hát này
    const isRequester = this.currentSong.requestedById && member?.id && (this.currentSong.requestedById === member.id);
    if (requesterCanForceSkip && isRequester) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_requester', title };
    }

    // 4. Nếu chế độ Vote Skip đang TẮT -> Bất kỳ ai trong phòng đều được skip trực tiếp
    if (!voteSkipEnabled) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_single', title };
    }

    // 5. Nếu phòng Voice có <= 2 người nghe thực tế (không tính bot và người đang tắt loa/deaf) -> Skip luôn
    const activeVoiceChannel = this.getVoiceChannel();
    const voiceMembers = activeVoiceChannel?.members?.filter(m =>
      !m.user?.bot && !m.voice?.selfDeaf && !m.voice?.serverDeaf
    ) || new Map();
    const listenerCount = voiceMembers.size;
    if (listenerCount <= 2) {
      const title = this.currentSong.title;
      this.skip();
      return { status: 'skipped', reason: 'force_single', title };
    }

    // 6. Tính số phiếu yêu cầu (50% người nghe trong phòng, làm tròn lên)
    const requiredVotes = Math.ceil(listenerCount * 0.5);
    const userName = member?.displayName || member?.user?.username || 'User';

    if (this.skipVotes.has(member.id)) {
      this.skipVotes.delete(member.id);
      return {
        status: 'vote_retracted',
        user: userName,
        current: this.skipVotes.size,
        required: requiredVotes
      };
    }

    this.skipVotes.add(member.id);
    if (this.skipVotes.size >= requiredVotes) {
      const title = this.currentSong.title;
      const current = this.skipVotes.size;
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
      current: this.skipVotes.size,
      required: requiredVotes,
      needed: requiredVotes - this.skipVotes.size
    };
  }

  skip() {
    const now = Date.now();
    if (this._lastSkipTime && (now - this._lastSkipTime < 800)) {
      return false;
    }
    this._lastSkipTime = now;

    // Tự động hủy trạng thái tạm dừng để bài hát tiếp theo luôn phát ngay lập tức
    this.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this.isQueueOnHold = false;
    this._skipRequested = true;
    this.skipVotes.clear();
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.prefetchedSong = null;
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
    if (this._lastPrevTime && (now - this._lastPrevTime < 1500)) {
      return false;
    }
    this._lastPrevTime = now;

    if (!this.previousSongs || this.previousSongs.length === 0) return false;
    const prevSong = this.previousSongs.pop();
    if (!prevSong) return false;

    // Tự động hủy trạng thái tạm dừng để bài hát trước đó luôn phát ngay lập tức
    this.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this.clearPreloadTimer();
    this.clearCrossfadeTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.prefetchedSong = null;

    if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
      this.songs.unshift(this.currentSong);
    }

    this.songs.unshift(prevSong);
    this._skipRequested = true;
    this._isPreviousAction = true;
    this._pendingButtonAction = null;
    this.player.stop();
    return true;
  }

  async playNow(indexOrTrack, requestUser = null) {
    // 1. Nếu truyền vào index số hợp lệ trong hàng chờ hiện tại
    const idx = typeof indexOrTrack === 'number' ? indexOrTrack : (typeof indexOrTrack === 'string' && /^\d+$/.test(indexOrTrack) ? parseInt(indexOrTrack, 10) : NaN);
    if (!isNaN(idx) && idx >= 0 && idx < this.songs.length) {
      const targetTrack = this.songs.splice(idx, 1)[0];
      if (!targetTrack) return false;
      this.paused = false;
      try { this.player.unpause(); } catch (e) {}
      this.autoplayPool = [];
      this.clearPreloadTimer();
      this.clearCrossfadeTimer();
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
      this.prefetchedSong = null;
      this.songs.unshift(targetTrack);
      this.skip();
      return true;
    }
    // 2. Nếu truyền vào object bài hát (từ Context Menu)
    if (indexOrTrack && typeof indexOrTrack === 'object') {
      // Nếu bài hát đã có sẵn index trong hàng chờ và khớp URL/Title
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
    this.clear247IdleTimer();
    this.autoplayPool = [];
    let sanitized = this._sanitizeTrack(song);
    if (!sanitized) return false;
    if (requestUser) {
      this._attachRequester(sanitized, requestUser);
    }
    sanitized.is247 = false;
    sanitized.isUserRequest = true;
    this.isQueueOnHold = false;
    this.paused = false;
    try { this.player.unpause(); } catch (e) {}
    this.clearPreloadTimer();
    this.clearCrossfadeTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.prefetchedSong = null;
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();

    // Đưa bài hát lên đầu hàng chờ và ngắt bài hiện tại để phát ngay lập tức
    this.songs.unshift(sanitized);
    this._saveSessionState();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this._skipRequested = true;
      this._isPreemptingLofi = true;
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
    this.refreshNowPlayingCard();
    return true;
  }

  moveSong(fromIndex, toIndex) {
    return this.moveTrack(fromIndex, toIndex);
  }

  removeSong(index) {
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= this.songs.length) return null;
    if (idx === 0 && this.preloadedResource) {
      this._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
    }
    const [removed] = this.songs.splice(idx, 1);
    this._saveSessionState();
    this.refreshNowPlayingCard();
    return removed || null;
  }

  stop() {
    this.isStopped = true;
    this._pendingButtonAction = null;
    this._isProcessingAction = false;
    this.clearLiveLyrics();
    if (this._repostCardTimer) {
      clearTimeout(this._repostCardTimer);
      this._repostCardTimer = null;
    }
    this.clearPlayCountTimer();
    this._clearCrossfadeTimer();
    this._clearSessionSaveInterval();
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.autoplayPool = [];
    this.songs = [];
    this.currentSong = null;
    this._cleanupResource(this.currentResource);
    this.currentResource = null;
    this.player.stop(true);
    this._saveSessionState();
    clearVoiceChannelStatus(this.voiceChannel);
    if (!this.mode247) {
      this.destroy();
    }
  }

  setLoop(mode) {
    this.loopMode = mode;
    settingsManager.update(this.guild.id, { loopMode: mode });
  }

  toggleLoop() {
    if (this.loopMode === 'off') {
      this.loopMode = 'song';
    } else if (this.loopMode === 'song') {
      this.loopMode = 'queue';
    } else {
      this.loopMode = 'off';
    }
    settingsManager.update(this.guild.id, { loopMode: this.loopMode });
    return this.loopMode;
  }

  set247(enable) {
    this.mode247 = enable;
    settingsManager.update(this.guild.id, { mode247: enable });
    if (enable) {
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();
      if (this.voiceChannel) {
        this._saveSessionState();
      }
    } else {
      this.clear247IdleTimer();
      sessionManager.clearSession(this.guild.id);
      const humanCount = typeof this.getHumanMemberCount === 'function' ? this.getHumanMemberCount() : 1;
      const guildSettings = settingsManager.get(this.guild.id);
      if (humanCount === 0) {
        this.startEmptyRoomTimer(guildSettings?.emptyChannelTimeout || 60);
      } else if (!this.currentSong && (!this.songs || this.songs.length === 0)) {
        this.startDisconnectTimer((guildSettings?.emptyChannelTimeout || 60) * 1000);
      }
    }
  }

  toggle247() {
    this.mode247 = !this.mode247;
    this.set247(this.mode247);
    return this.mode247;
  }

  async switchTo247Lofi() {
    // 1. Kiểm tra nếu bot đang phát Lofi 24/7 rồi và hàng chờ đang trống
    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)'));
    if (isCurrentLofi && this.isPlaying && !this.isPaused && (!this.songs || this.songs.length === 0)) {
      return {
        success: true,
        alreadyActive: true,
        message: 'Bot hiện đang phát nhạc nền Lofi 24/7 thư giãn rồi nhé ☕'
      };
    }

    // 2. Chống spam / double-click tại Backend: Khóa 3.5 giây
    const now = Date.now();
    if (this._switchingTo247Lock && (now - this._switchingTo247Lock < 3500)) {
      return {
        success: true,
        alreadyActive: true,
        message: 'Đang chuyển sang Lofi 24/7, vui lòng chờ một chút nhé ⏳'
      };
    }
    this._switchingTo247Lock = now;

    this._switchingTo247 = true;
    this.mode247 = true;
    settingsManager.update(this.guild.id, { mode247: true });

    // Hủy các bộ đếm tự rời phòng
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.clear247IdleTimer();
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();

    // Dọn sạch tài nguyên preloaded
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.prefetchedSong = null;
    this.autoplayPool = [];

    // Giữ nguyên hàng chờ (this.songs), chỉ đặt lại chế độ lặp
    this.loopMode = 'off';
    if (this.songs && this.songs.length > 0) {
      this.isQueueOnHold = true;
    }

    // Lưu lại bài hát người dùng đang nghe trước khi dọn dẹp
    if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
      this.lastUserTrack = this.currentSong;
    }

    // Dọn bài hát hiện tại
    this.clearPlayCountTimer();
    this.currentSong = null;
    this._cleanupResource(this.currentResource);
    this.currentResource = null;

    // Dừng phát bài hiện tại
    if (this.player) {
      this.player.stop(true);
    }
    this.isStopped = false;
    this._switchingTo247 = false;

    // Cập nhật trạng thái kênh Voice Discord
    const activeChannel = this.getVoiceChannel();
    if (activeChannel) {
      setVoiceChannelStatus(activeChannel, '♾️ 24/7 Mode');
    }

    // Phát ngay bài Lofi 24/7
    await this._play247BackgroundLofi();

    // Lưu session phục hồi khi bot khởi động lại
    await sessionManager.saveSession(this.guild.id, {
      voiceChannelId: this.voiceChannel?.id,
      textChannelId: this.textChannel?.id,
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
    if (this._toggleLofiLock && (now - this._toggleLofiLock < 1500)) {
      return {
        success: true,
        message: 'Thao tác quá nhanh, vui lòng đợi một lát nhé ⏳'
      };
    }
    this._toggleLofiLock = now;

    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)'));

    if (isCurrentLofi) {
      // Đang ở Lofi -> Muốn quay về phát nhạc người dùng
      this.paused = false;
      try { this.player?.unpause(); } catch (e) {}
      this.isQueueOnHold = false;
      this._skipRequested = true;

      // 1. Trường hợp trong hàng chờ CÒN bài hát của người dùng
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

      // 2. Trường hợp hàng chờ KHÔNG CÒN bài -> Phát lại bài gần nhất người dùng đã nghe
      const trackToReplay = this.lastUserTrack || (this.previousSongs && this.previousSongs.length > 0 ? this.previousSongs[this.previousSongs.length - 1] : null);
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
      // Đang phát nhạc người dùng -> Muốn chuyển về Lofi 24/7
      if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
        this.lastUserTrack = this.currentSong;
      }
      return await this.switchTo247Lofi();
    }
  }

  
  _sanitizeDiscordLyricLine(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_~|]/g, '')
      .replace(/@(everyone|here)/gi, '')
      .replace(/<@&?\d+>/g, '')
      .trim();
  }

  clearLiveLyrics() {
    if (this.liveLyricsTimer) {
      clearTimeout(this.liveLyricsTimer);
      this.liveLyricsTimer = null;
    }
    if (this._prefetchLyricsTimer) {
      clearTimeout(this._prefetchLyricsTimer);
      this._prefetchLyricsTimer = null;
    }
    this.currentLyricText = '';
    this.currentLyricIndex = -1;
    this.cachedSyncedLyrics = null;
    this.hasSyncedLyrics = false;
    this.currentLyricOffsetMs = 0;
    this._lastLyricsEditTime = 0;
    this._lastProgressEditTime = 0;
    this._lastRenderedLyricIdx = -1;
    this._lastRenderedChunkIdx = -1;
  }

  /**
   * Trì hoãn và gộp nhiều yêu cầu prefetch lyrics thành 1 lần gọi (Debounce)
   */
  schedulePrefetchLyrics(delayMs = 2000) {
    if (this._prefetchLyricsTimer) {
      clearTimeout(this._prefetchLyricsTimer);
    }
    this._prefetchLyricsTimer = setTimeout(() => {
      this._prefetchLyricsTimer = null;
      this._prefetchQueueLyrics();
    }, delayMs);
  }

  /**
   * Tự động tìm và lưu sẵn lời bài hát vào RAM Cache cho bài hiện tại
   * và tối đa 3 bài tiếp theo trong hàng chờ (Background Prefetching)
   */
  _prefetchQueueLyrics() {
    if (this.isDestroyed || this.isStopped) return;
    try {
      const { prefetchLyrics } = require('../utils/lyricsHelper');
      const settingsManager = require('./SettingsManager');
      const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
      const layers = guildSettings?.lyricsLayers;

      const candidates = [];
      if (this.currentSong && !this.isCurrentSongLofi()) {
        candidates.push(this.currentSong);
      }
      const userQueue = (this.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto (24/7)');
      candidates.push(...userQueue.slice(0, 3));
      if (this.prefetchedSong && !candidates.some(c => c.url === this.prefetchedSong.url)) {
        candidates.push(this.prefetchedSong);
      }

      candidates.forEach((track, idx) => {
        setTimeout(() => {
          if (this.isDestroyed || this.isStopped) return;
          const durMs = track.durationMs || (track.duration ? parseDurationToMs(track.duration) : 0);
          prefetchLyrics(track.title, track.artist, durMs, track.url, layers);
        }, idx * 250);
      });
    } catch (e) {}
  }

  _applySyncedLyrics(song, lyricsData) {
    if (!song || !lyricsData || !Array.isArray(lyricsData.syncedLyrics) || lyricsData.syncedLyrics.length < 3) {
      return false;
    }

    let activeSyncedLyrics = lyricsData.syncedLyrics;
    let activeAutoOffsetMs = lyricsData.autoOffsetMs || 0;

    // Chuẩn hóa hệ quy chiếu Lyrics khi bài hát có SponsorBlock Trim (Clone an toàn, chống Double-Offset Mutation)
    if (song.trimStart > 0 || song.trimEnd > 0) {
      const trimStartMs = (song.trimStart || 0) * 1000;
      const realDurMs = song.durationMs || 0;

      if (lyricsData.source === 'youtube_cc' && Array.isArray(lyricsData.syncedLyrics)) {
        activeSyncedLyrics = lyricsData.syncedLyrics
          .map(line => ({
            ...line,
            time: line.time - trimStartMs,
            time_ms: (line.time_ms ?? line.time) - trimStartMs
          }))
          .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
          .map(line => ({
            ...line,
            time: Math.max(0, line.time),
            time_ms: Math.max(0, line.time_ms)
          }));
        activeAutoOffsetMs = 0;
      } else {
        activeAutoOffsetMs = 0;
      }
    }

    this.cachedSyncedLyrics = activeSyncedLyrics;
    this.hasSyncedLyrics = true;
    this.currentLyricOffsetMs = (lyricsData.userSavedOffsetMs || 0) + activeAutoOffsetMs;
    this._lastLyricsEditTime = 0;
    this._lastRenderedLyricIdx = -1;
    this._lastRenderedChunkIdx = -1;
    return true;
  }

  /**
   * Cơ chế Nạp Nóng Lời Bài Hát (Hot-Attach / Late-Arriving Lyrics)
   * Kích hoạt khi phụ đề YouTube CC hoặc nguồn ngoài hoàn tất sau khi card đã phát
   */
  async attachLateLyrics(song, lyricsData) {
    if (this.isDestroyed || this.isStopped || this.currentSong !== song) return;
    if (this.hasSyncedLyrics) return;

    const applied = this._applySyncedLyrics(song, lyricsData);
    if (!applied) return;

    console.log(`[Live Lyrics Hot-Attach] Đã nạp nóng thành công ${lyricsData.syncedLyrics?.length} câu lời (nguồn: ${lyricsData.source}) cho "${song.title}"`);
    this.scheduleNextLyricUpdate(song);

    if (this.nowPlayingMessage) {
      try {
        const { createNowPlayingCard } = require('../utils/embed');
        const cardPayload = createNowPlayingCard(song, this);
        await this.nowPlayingMessage.edit(cardPayload).catch(() => {});
      } catch (e) {}
    }
  }

  async startLiveLyrics() {
    this.clearLiveLyrics();
    const song = this.currentSong;
    if (!song || song.is247 || song.requestedBy === 'Auto (24/7)' || (this.mode247 && !song)) {
      return;
    }

    // Kích hoạt nạp trước lời cho cả các bài tiếp theo trong hàng chờ
    this._prefetchQueueLyrics();

    try {
      if (this.isDestroyed || this.isStopped || this.currentSong !== song) return;

      const { fetchLyrics } = require('../utils/lyricsHelper');
      const settingsManager = require('./SettingsManager');
      const guildSettings = this.guild?.id ? settingsManager.get(this.guild.id) : null;
      const durationMs = song.durationMs || (song.duration ? parseDurationToMs(song.duration) : 0);
      const lyricsData = await fetchLyrics(song.title, song.artist, durationMs, song.url, guildSettings?.lyricsLayers);

      if (this.isDestroyed || this.isStopped || this.currentSong !== song) return;

      if (lyricsData && Array.isArray(lyricsData.syncedLyrics) && lyricsData.syncedLyrics.length >= 3) {
        this._applySyncedLyrics(song, lyricsData);
        console.log(`[Live Lyrics] Hiển thị tức thì (${lyricsData.syncedLyrics.length} câu, offset: ${this.currentLyricOffsetMs}ms, nguồn: ${lyricsData.source}) cho "${song.title}"`);
        this.scheduleNextLyricUpdate(song);
      } else {
        this.hasSyncedLyrics = false;
        this.cachedSyncedLyrics = null;
        this.currentLyricText = '';
        this.scheduleProgressBarUpdate(song);
      }
    } catch (err) {
      this.hasSyncedLyrics = false;
      this.cachedSyncedLyrics = null;
      this.currentLyricText = '';
      this.scheduleProgressBarUpdate(song);
    }
  }

  async scheduleProgressBarUpdate(song) {
    if (this.liveLyricsTimer) {
      clearTimeout(this.liveLyricsTimer);
      this.liveLyricsTimer = null;
    }

    const is247Mode = Boolean(
      song?.is247 ||
      song?.requestedBy === 'Auto (24/7)' ||
      song?.requestedBy === 'Auto (24/7 Lofi)' ||
      (typeof song?.requestedBy === 'string' && song.requestedBy.includes('24/7')) ||
      (this.mode247 && (!song || song.is247))
    );

    if (this.isDestroyed || this.isStopped || this.currentSong !== song || !this.nowPlayingMessage || this.hasSyncedLyrics || is247Mode) {
      return;
    }

    if (this.paused) {
      return;
    }

    // Nếu đang xử lý thao tác người dùng (bấm nút), hoãn lại để nhường băng thông REST API
    if (this._pendingButtonAction && this._pendingButtonActionTime && (Date.now() - this._pendingButtonActionTime > 2500)) {
      this._pendingButtonAction = null;
    }
    if (this._isProcessingAction || this._pendingButtonAction) {
      this.liveLyricsTimer = setTimeout(() => this.scheduleProgressBarUpdate(song), 1500);
      return;
    }

    try {
      const { createNowPlayingCard } = require('../utils/embed');
      const now = Date.now();
      const timeSinceLastEdit = now - (this._lastProgressEditTime || 0);

      // Đảm bảo khoảng cách giữa 2 lần edit tối thiểu 3500ms để không dính rate limit Discord
      if (timeSinceLastEdit >= 3500) {
        this._lastProgressEditTime = now;
        const cardPayload = createNowPlayingCard(this.currentSong, this);
        await this.nowPlayingMessage.edit(cardPayload).catch(editErr => {
          if (editErr?.code === 10008) {
            this.clearLiveLyrics();
            this.nowPlayingMessage = null;
          }
        });
      }

      // Kiểm tra nếu bài hát vẫn chưa kết thúc, lên lịch cập nhật thanh tiến trình sau 4000ms
      const seekMs = (song.seekPosition || 0) * 1000;
      const playbackMs = seekMs + (this.currentResource?.playbackDuration || 0);
      const totalMs = song.durationMs || (song.duration ? parseDurationToMs(song.duration) : 0);

      if (totalMs > 0 && playbackMs >= totalMs) {
        return;
      }

      this.liveLyricsTimer = setTimeout(() => this.scheduleProgressBarUpdate(song), 4000);
    } catch (e) {}
  }

  async scheduleNextLyricUpdate(song) {
    if (this.liveLyricsTimer) {
      clearTimeout(this.liveLyricsTimer);
      this.liveLyricsTimer = null;
    }

    if (this.isDestroyed || this.isStopped || this.currentSong !== song || !this.cachedSyncedLyrics || !this.nowPlayingMessage) {
      return;
    }

    if (this.paused) {
      return;
    }

    // Nếu đang xử lý thao tác người dùng (bấm nút), hoãn lại để nhường băng thông REST API
    if (this._pendingButtonAction && this._pendingButtonActionTime && (Date.now() - this._pendingButtonActionTime > 2500)) {
      this._pendingButtonAction = null;
    }
    if (this._isProcessingAction || this._pendingButtonAction) {
      this.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), 1500);
      return;
    }

    try {
      const { createNowPlayingCard, EMOJI_TAG } = require('../utils/embed');
      const seekMs = (song.seekPosition || 0) * 1000;
      const offsetMs = this.currentLyricOffsetMs || 0;
      const rawCurrentMs = seekMs + (this.currentResource?.playbackDuration || 0);
      const effectiveCurrentMs = rawCurrentMs + offsetMs;

      // 1. Thuật toán Đón Đầu (LOOKAHEAD_MS = 1500) canh hiện Cụm 4 câu sớm trước 1.5 giây
      const LOOKAHEAD_MS = 1500;
      const embedEffectiveMs = effectiveCurrentMs + LOOKAHEAD_MS;

      const lyrics = this.cachedSyncedLyrics;
      // Binary search tìm vị trí câu hát tương ứng với mốc embedEffectiveMs
      let low = 0;
      let high = lyrics.length - 1;
      let activeIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lyrics[mid].time <= embedEffectiveMs) {
          activeIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      // Trường hợp bài hát chưa vào câu đầu tiên (phần Intro nhạc dạo)
      if (activeIdx < 0) {
        const firstLineTime = lyrics[0]?.time || 5000;
        const msUntilFirst = Math.max(1000, (firstLineTime - LOOKAHEAD_MS) - effectiveCurrentMs);
        this.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), Math.min(msUntilFirst, 4000));
        return;
      }

      // 2. Cơ chế phân trang theo CỤM 4 CÂU CỐ ĐỊNH (Paged 4-Line Blocks):
      // - Cụm 0: các câu 0, 1, 2, 3 (câu 1 đến 4)
      // - Cụm 1: các câu 4, 5, 6, 7 (câu 5 đến 8)
      // - Cụm 2: các câu 8, 9, 10, 11 (câu 9 đến 12)...
      const chunkIndex = Math.max(0, Math.floor(activeIdx / 4));
      const startIdx = chunkIndex * 4;
      const visibleLines = lyrics.slice(startIdx, startIdx + 4);

      // 3. Định dạng 4 dòng đồng nhất: Dùng 4 dấu chấm tròn "•", in nghiêng nhẹ nhàng, KHÔNG in đậm, KHÔNG mũi tên
      const lines = [];
      for (const line of visibleLines) {
        const text = this._sanitizeDiscordLyricLine(line?.text || '');
        if (text) {
          lines.push(`> • *${text}*`);
        }
      }

      const newLyricText = lines.join('\n');
      const now = Date.now();
      const timeSinceLastEdit = now - (this._lastLyricsEditTime || 0);

      // 4. Chỉ sửa tin nhắn Discord khi CHUYỂN SANG CỤM 4 CÂU MỚI (Hết 4 câu mới đổi 1 lần!)
      if (chunkIndex !== this._lastRenderedChunkIdx || !this.currentLyricText) {
        if (timeSinceLastEdit >= 3500) {
          if (newLyricText !== this.currentLyricText) {
            this.currentLyricText = newLyricText;
            this.currentLyricIndex = startIdx;
            this._lastRenderedLyricIdx = activeIdx;
            this._lastRenderedChunkIdx = chunkIndex;
            this._lastLyricsEditTime = now;

            // Re-render card: Tự động lồng cụm 4 dòng vào Section sát dưới URL bài hát
            const cardPayload = createNowPlayingCard(this.currentSong, this);
            await this.nowPlayingMessage.edit(cardPayload).catch(editErr => {
              if (editErr?.code === 10008) {
                this.clearLiveLyrics();
                this.nowPlayingMessage = null;
              }
            });
          } else {
            this.currentLyricIndex = startIdx;
            this._lastRenderedLyricIdx = activeIdx;
            this._lastRenderedChunkIdx = chunkIndex;
          }
        } else {
          // Chưa đủ 3500ms cooldown, hẹn giờ cập nhật ngay khi hết cooldown
          const waitCooldown = 3500 - timeSinceLastEdit;
          this.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), Math.max(300, waitCooldown));
          return;
        }
      }

      // 5. Tính toán thời điểm lật sang Cụm 4 câu tiếp theo:
      // Cụm tiếp theo bắt đầu tại index: (chunkIndex + 1) * 4
      const nextChunkIdx = (chunkIndex + 1) * 4;
      if (nextChunkIdx >= lyrics.length) {
        // Đã ở cụm 4 câu cuối cùng của bài hát -> Không cần hẹn giờ đổi cụm nữa
        return;
      }

      const nextChunkStartLine = lyrics[nextChunkIdx];
      // Cụm tiếp theo sẽ được lật khi effectiveCurrentMs chạm mốc: (nextChunkStartLine.time - LOOKAHEAD_MS)
      const msUntilNextChunk = Math.max(1000, (nextChunkStartLine.time - LOOKAHEAD_MS) - effectiveCurrentMs);
      const minCooldownRemaining = Math.max(0, 3500 - (Date.now() - (this._lastLyricsEditTime || 0)));
      const dynamicDelay = Math.max(msUntilNextChunk, minCooldownRemaining);

      this.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), dynamicDelay);
    } catch (schedErr) {
      // Bỏ qua lỗi ngầm
    }
  }

  refreshNowPlayingCard() {
    if (this.hasSyncedLyrics) return;
    if (this._refreshCardTimer) clearTimeout(this._refreshCardTimer);
    this._refreshCardTimer = setTimeout(async () => {
      try {
        if (!this.nowPlayingMessage || !this.currentSong || this.isStopped) return;
        const isV2 = this.nowPlayingMessage.components?.[0]?.type === 17 || this.nowPlayingMessage.flags?.has?.(32768);
        if (isV2) {
          const { createNowPlayingCard } = require('../utils/embed');
          const cardPayload = createNowPlayingCard(this.currentSong, this);
          await this.nowPlayingMessage.edit(cardPayload).catch(() => {});
        } else {
          const { createNowPlayingEmbed, createMusicControls } = require('../utils/embed');
          const embed = createNowPlayingEmbed(this.currentSong, this);
          const controls = createMusicControls(this);
          await this.nowPlayingMessage.edit({ embeds: [embed], components: controls }).catch(() => {});
        }
      } catch (e) {}
    }, 600);
  }

  scheduleRepostNowPlayingCard(delayMs = 1200) {
    if (this._repostCardTimer) {
      clearTimeout(this._repostCardTimer);
    }
    this._repostCardTimer = setTimeout(async () => {
      this._repostCardTimer = null;
      await this.repostNowPlayingCardToBottom();
    }, delayMs);
  }

  async repostNowPlayingCardToBottom() {
    if (this.isDestroyed || this.isStopped || !this.currentSong || !this.textChannel) return;
    const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);
    if (is247Lofi) return;

    try {
      // 1. Kiểm tra xem nowPlayingMessage có phải là tin nhắn cuối cùng trong textChannel không
      let isAlreadyLast = false;
      try {
        const lastMessages = await this.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastMsg = lastMessages?.first();
        isAlreadyLast = Boolean(this.nowPlayingMessage && lastMsg && lastMsg.id === this.nowPlayingMessage.id);
      } catch (fetchErr) {}

      // Nếu thẻ đang phát ĐÃ là tin nhắn cuối cùng rồi thì không cần repost (tránh nhấp nháy / tốn request)
      if (isAlreadyLast) return;

      const { createNowPlayingCard } = require('../utils/embed');
      const cardPayload = createNowPlayingCard(this.currentSong, this);

      // 2. Xóa thẻ cũ (nếu có)
      if (this.nowPlayingMessage) {
        const oldMsg = this.nowPlayingMessage;
        this.nowPlayingMessage = null; // Ngắt gắn kết ngay để Live Lyrics không edit vào tin cũ
        await oldMsg.delete().catch(() => {});
      }

      // 3. Gửi thẻ mới xuống dưới cùng
      const newMsg = await this.textChannel.send(cardPayload);
      this.nowPlayingMessage = newMsg;

      // 4. Reset mốc render để Live Lyrics lập tức vẽ câu tiếp theo trên thẻ mới
      this._lastRenderedChunkIdx = -1;
      this._lastLyricsEditTime = 0;

      if (this.hasSyncedLyrics) {
        this.scheduleNextLyricUpdate(this.currentSong);
      } else {
        this.scheduleProgressBarUpdate(this.currentSong);
      }
    } catch (err) {
      console.warn('[RepostNowPlayingCard] Lỗi khi đưa thẻ Now Playing xuống đáy:', err.message);
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.isStopped = true;
    this._pendingButtonAction = null;
    this._isProcessingAction = false;
    if (this._onLyricsFound) {
      try {
        const { lyricsEvents } = require('../utils/lyricsHelper');
        lyricsEvents.off('lyricsFound', this._onLyricsFound);
      } catch (e) {}
      this._onLyricsFound = null;
    }
    this.clearLiveLyrics();
    if (this._repostCardTimer) {
      clearTimeout(this._repostCardTimer);
      this._repostCardTimer = null;
    }
    this._clearBufferingWatchdog();
    this.clearPlayCountTimer();
    this._clearCrossfadeTimer();
    this._clearSessionSaveInterval();
    this.clearPreloadTimer();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.clear247IdleTimer();
    sessionManager.clearSession(this.guild.id);
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.autoplayPool = [];
    this.songs = [];
    this.currentSong = null;
    this.isQueueOnHold = false;
    this._cleanupResource(this.currentResource);
    this.currentResource = null;
    this.player.stop(true);
    clearVoiceChannelStatus(this.voiceChannel);

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this.manager.remove(this.guild.id);
  }

  async _prefetchAutoplayTrack() {
    if (this._isPrefetching) return;
    const guildSettings = settingsManager.get(this.guild.id);
    if (!guildSettings.autoplay || !this.currentSong) return;

    // Không prefetch nếu bài hiện tại là Lofi 24/7 HOẶC phòng không có ai nghe
    if (this.currentSong.requestedBy === 'Auto (24/7)') return;
    if (this.getHumanMemberCount() === 0) return;

    if (this.songs.length === 0 && !this.prefetchedSong) {
      // 1. Kiểm tra bộ đệm Autoplay Pool có sẵn bài hợp lệ không (0ms tức thì)
      if (this.autoplayPool && this.autoplayPool.length > 0) {
        while (this.autoplayPool.length > 0) {
          const candidate = this.autoplayPool.shift();
          if (candidate && candidate.url && !this.history.includes(candidate.url) && candidate.url !== this.currentSong.url && !historyManager.isRecentlyPlayed(this.guild.id, candidate, 25)) {
            candidate.requestedBy = 'Tự động phát';
            this.prefetchedSong = candidate;
            console.log(`[Autoplay Pre-fetch Pool Hit (0ms)] Nạp sẵn từ bộ đệm: "${candidate.title}"`);
            this._prefetchQueueLyrics();
            return;
          }
        }
      }

      this._isPrefetching = true;
      try {
        const useAi = guildSettings.useAiAssistant !== false;
        const seedMeta = analyzeTrackOriginAndMeta(this.currentSong);
        const targetRegion = seedMeta.region;
        const pool = await getRelatedTracksPool(this.currentSong, this.guild.id, useAi, targetRegion);
        if (pool && pool.length > 0) {
          const nextTrack = pool[0];
          nextTrack.requestedBy = 'Tự động phát';
          this.prefetchedSong = nextTrack;
          this.autoplayPool = pool.slice(1).map(t => {
            t.requestedBy = 'Tự động phát';
            return t;
          });
          console.log(`[Autoplay Metadata Pre-fetch (${targetRegion})] Đã tìm sẵn bài kế tiếp: "${nextTrack.title}" (${nextTrack.artist || 'YouTube'}) và lưu ${this.autoplayPool.length} bài vào pool`);
          this.schedulePrefetchLyrics(2000);
        }
      } catch (err) {
        console.warn('[Autoplay Pre-fetch Error]:', err.message);
      } finally {
        this._isPrefetching = false;
      }
    }
  }

  async enrichMissingThumbnails() {
    if (this._isEnrichingThumbs) return;
    this._isEnrichingThumbs = true;
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
          if (item.uri && item.uri.startsWith('spotify:track:')) {
            const trackId = item.uri.replace('spotify:track:', '').split('?')[0];
            try {
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
      this._isEnrichingThumbs = false;
    }
  }

  /**
   * Lưu thông tin phiên phát nhạc bao gồm vị trí giây đang phát (position)
   */
  _saveSessionState() {
    if (!this.guild || !this.voiceChannel) return Promise.resolve();
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
        voiceChannelId: this.voiceChannel.id,
        textChannelId: this.textChannel?.id,
        mode247: this.mode247,
        status: (this.isPlaying && !isLofiCurrent) ? 'active' : 'idle_247',
        currentSong: (!isLofiCurrent && this.currentSong) ? this.currentSong : null,
        songs: userSongs,
        position: position
      });
    } catch (e) {
      return Promise.resolve();
    }
  }
}

module.exports = MusicQueue;
