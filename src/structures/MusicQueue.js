const {
  createAudioPlayer,
  NoSubscriberBehavior,
  AudioPlayerStatus
} = require('@discordjs/voice');
const settingsManager = require('./SettingsManager');
const sessionManager = require('./SessionManager');
const { clearVoiceChannelStatus, createErrorEmbed } = require('../utils/embed');
const { logAction } = require('../utils/debugLogger');

const VoiceConnectionManager = require('./queue/VoiceConnectionManager');
const DiscordCardRenderer = require('./queue/DiscordCardRenderer');
const QueuePlaybackEngine = require('./queue/QueuePlaybackEngine');

class MusicQueue {
  constructor(guild, textChannel, voiceChannel, manager) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.manager = manager;

    this.songs = [];
    this.history = [];
    this.autoplayPool = [];
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
        maxMissedFrames: 200
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
    this.voiceSessionStartTime = sessionManager.getSession(this.guild.id)?.voiceSessionStartTime || Date.now();

    this.previousSongs = [];
    this.lastUserTrack = null;
    this.lofiHistory = [];
    this.disconnectTimeout = null;
    this.emptyRoomTimeout = null;
    this.idle247Timeout = null;
    this.crossfadeTimer = null;
    this._playCountTimer = null;
    this.nowPlayingMessage = null;
    this._repostCardTimer = null;
    this._isPrefetching = false;
    this._isPlayingNext = false;
    this.lastNonLofiSong = null;
    this._isPreemptingLofi = false;
    this._is247Loading = false;
    this.isQueueOnHold = false;
    this._bufferingTimeout = null;
    this._lofiRetryCount = 0;
    this.sessionRegion = null;

    this.liveLyricsTimer = null;
    this.currentLyricText = '';
    this.currentLyricIndex = -1;
    this.cachedSyncedLyrics = null;
    this.hasSyncedLyrics = false;
    this.autoLyricOffsetMs = 0;
    this.userLyricOffsetMs = 0;
    this.currentLyricOffsetMs = 0;
    this._lastLyricsEditTime = 0;
    this._lastProgressEditTime = 0;
    this._lastRenderedLyricIdx = -1;
    this._lastRenderedChunkIdx = -1;

    this._isProcessingAction = false;
    this._pendingButtonAction = null;
    this.skipVotes = new Set();
    this._playbackEpoch = 0;
    this._seekAbortController = null;

    // Khởi tạo 3 Sub-Managers chuyên trách
    this.voiceManager = new VoiceConnectionManager(this);
    this.cardRenderer = new DiscordCardRenderer(this);
    this.playbackEngine = new QueuePlaybackEngine(this);

    this._initSettings();
    this._setupPlayerEvents();

    // Đăng ký lắng nghe sự kiện Lời bài hát về muộn (Hot-Attach)
    const { lyricsEvents } = require('../utils/lyricsHelper');
    this._onLyricsFound = (event) => {
      if (!this.currentSong || this.isDestroyed || this.isStopped) return;
      if (this.hasSyncedLyrics) return;
      const currentUrl = this.currentSong.url;
      if (event && event.url && currentUrl && event.url === currentUrl && event.lyricsData) {
        this.cardRenderer.attachLateLyrics(this.currentSong, event.lyricsData);
      }
    };
    lyricsEvents.on('lyricsFound', this._onLyricsFound);
  }

  _initSettings() {
    const guildSettings = settingsManager.get(this.guild.id);
    this.mode247 = Boolean(guildSettings.mode247);
    this.volume = guildSettings.defaultVolume || 80;
    this.loopMode = guildSettings.loopMode || 'off';
    this.crossfadeDuration = typeof guildSettings.crossfadeDuration === 'number' ? guildSettings.crossfadeDuration : 0;
  }

  _setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Playing, () => {
      this.playbackEngine._clearBufferingWatchdog();
      console.log(`[AudioPlayer] Đang phát bài: ${this.currentSong?.title} tại ${this.guild.name}`);
    });

    this.player.on(AudioPlayerStatus.Buffering, () => {
      this.playbackEngine._startBufferingWatchdog();
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playbackEngine._clearBufferingWatchdog();
      console.log(`[AudioPlayer] Kết thúc bài hát tại ${this.guild.name}`);
      this.playbackEngine._handleSongEnd();
    });

    this.player.on('error', (error) => {
      this.playbackEngine._clearBufferingWatchdog();
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

      if (this.currentResource) {
        this.playbackEngine._cleanupResource(this.currentResource);
        this.currentResource = null;
      }

      if (this.textChannel && !is247Lofi && !isEpipe) {
        this.textChannel.send({
          embeds: [createErrorEmbed(settingsManager.get(this.guild.id)?.language === 'en' ? `Playback error: ${error.message || 'Cannot play this track.'}` : `Lỗi phát nhạc: ${error.message || 'Không thể phát bài hát này.'}`)],
          flags: 4096
        }).catch(() => {});
      }
      this.playbackEngine._handleSongEnd();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS & SETTERS CÔNG KHAI
  // ═══════════════════════════════════════════════════════════════════════════
  get isPlaying() {
    return this.player?.state?.status === AudioPlayerStatus.Playing || (!this.paused && Boolean(this.currentSong));
  }

  get isPaused() {
    return this.paused || this.player?.state?.status === AudioPlayerStatus.Paused;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ỦY QUYỀN VOICE CONNECTION MANAGER
  // ═══════════════════════════════════════════════════════════════════════════
  getVoiceChannel() {
    return this.voiceManager.getVoiceChannel();
  }

  getHumanMemberCount() {
    return this.voiceManager.getHumanMemberCount();
  }

  async connect() {
    return await this.voiceManager.connect();
  }

  startDisconnectTimer(timeoutMs) {
    return this.voiceManager.startDisconnectTimer(timeoutMs);
  }

  clearDisconnectTimer() {
    return this.voiceManager.clearDisconnectTimer();
  }

  startEmptyRoomTimer(timeoutSeconds) {
    return this.voiceManager.startEmptyRoomTimer(timeoutSeconds);
  }

  clearEmptyRoomTimer() {
    return this.voiceManager.clearEmptyRoomTimer();
  }

  clear247IdleTimer() {
    return this.voiceManager.clear247IdleTimer();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ỦY QUYỀN DISCORD CARD RENDERER & LIVE LYRICS
  // ═══════════════════════════════════════════════════════════════════════════
  refreshNowPlayingCard() {
    return this.cardRenderer.refreshNowPlayingCard();
  }

  scheduleRepostNowPlayingCard(delayMs) {
    return this.cardRenderer.scheduleRepostNowPlayingCard(delayMs);
  }

  async repostNowPlayingCardToBottom() {
    return await this.cardRenderer.repostNowPlayingCardToBottom();
  }

  clearLiveLyrics() {
    return this.cardRenderer.clearLiveLyrics();
  }

  async startLiveLyrics() {
    return await this.cardRenderer.startLiveLyrics();
  }

  async attachLateLyrics(song, lyricsData) {
    return await this.cardRenderer.attachLateLyrics(song, lyricsData);
  }

  scheduleProgressBarUpdate(song) {
    return this.cardRenderer.scheduleProgressBarUpdate(song);
  }

  scheduleNextLyricUpdate(song) {
    return this.cardRenderer.scheduleNextLyricUpdate(song);
  }

  schedulePrefetchLyrics(delayMs) {
    return this.cardRenderer.schedulePrefetchLyrics(delayMs);
  }

  _prefetchQueueLyrics() {
    return this.cardRenderer._prefetchQueueLyrics();
  }

  _applySyncedLyrics(song, lyricsData) {
    return this.cardRenderer._applySyncedLyrics(song, lyricsData);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ỦY QUYỀN QUEUE PLAYBACK ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  isCurrentSongLofi() {
    return this.playbackEngine.isCurrentSongLofi();
  }

  getUserSongs() {
    return this.playbackEngine.getUserSongs();
  }

  _sanitizeTrack(song, idx) {
    return this.playbackEngine._sanitizeTrack(song, idx);
  }

  _attachRequester(song, requestUser) {
    return this.playbackEngine._attachRequester(song, requestUser);
  }

  async addSong(song, requestUser) {
    return await this.playbackEngine.addSong(song, requestUser);
  }

  async addSongs(songArray, requestUser) {
    return await this.playbackEngine.addSongs(songArray, requestUser);
  }

  async addTrack(track) {
    return await this.playbackEngine.addTrack(track);
  }

  async playNext() {
    return await this.playbackEngine.playNext();
  }

  _handleSongEnd() {
    return this.playbackEngine._handleSongEnd();
  }

  async playPrevious() {
    return await this.playbackEngine.playPrevious();
  }

  async playNow(indexOrTrack, requestUser) {
    return await this.playbackEngine.playNow(indexOrTrack, requestUser);
  }

  async playTrackNow(song, requestUser) {
    return await this.playbackEngine.playTrackNow(song, requestUser);
  }

  async seek(seconds) {
    return await this.playbackEngine.seek(seconds);
  }

  shuffle() {
    return this.playbackEngine.shuffle();
  }

  moveTrack(fromIndex, toIndex) {
    return this.playbackEngine.moveTrack(fromIndex, toIndex);
  }

  moveSong(fromIndex, toIndex) {
    return this.playbackEngine.moveSong(fromIndex, toIndex);
  }

  removeSong(index) {
    return this.playbackEngine.removeSong(index);
  }

  clearQueue() {
    return this.playbackEngine.clearQueue();
  }

  stop() {
    return this.playbackEngine.stop();
  }

  checkOrCastSkipVote(member) {
    return this.playbackEngine.checkOrCastSkipVote(member);
  }

  skip() {
    return this.playbackEngine.skip();
  }

  setVolume(vol) {
    return this.playbackEngine.setVolume(vol);
  }

  pause() {
    return this.playbackEngine.pause();
  }

  resume() {
    return this.playbackEngine.resume();
  }

  togglePause() {
    return this.playbackEngine.togglePause();
  }

  setLoop(mode) {
    return this.playbackEngine.setLoop(mode);
  }

  toggleLoop() {
    return this.playbackEngine.toggleLoop();
  }

  set247(enable) {
    return this.playbackEngine.set247(enable);
  }

  toggle247() {
    return this.playbackEngine.toggle247();
  }

  async switchTo247Lofi() {
    return await this.playbackEngine.switchTo247Lofi();
  }

  async toggleLofiMode() {
    return await this.playbackEngine.toggleLofiMode();
  }

  schedulePreload() {
    return this.playbackEngine.schedulePreload();
  }

  scheduleCrossfade() {
    return this.playbackEngine.scheduleCrossfade();
  }

  clearCrossfadeTimer() {
    return this.playbackEngine.clearCrossfadeTimer();
  }

  clearPreloadTimer() {
    return this.playbackEngine.clearPreloadTimer();
  }

  clearPlayCountTimer() {
    return this.playbackEngine.clearPlayCountTimer();
  }

  async enrichMissingThumbnails() {
    return await this.playbackEngine.enrichMissingThumbnails();
  }

  async _play247BackgroundLofi() {
    return await this.playbackEngine._play247BackgroundLofi();
  }

  async _play247LofiBackground() {
    return await this.playbackEngine._play247LofiBackground();
  }

  async _prefetchAutoplayTrack() {
    return await this.playbackEngine._prefetchAutoplayTrack();
  }

  _cleanupResource(resource) {
    return this.playbackEngine._cleanupResource(resource);
  }

  _saveSessionState() {
    return this.playbackEngine._saveSessionState();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESTROY WORKFLOW
  // ═══════════════════════════════════════════════════════════════════════════
  destroy() {
    this._playbackEpoch = (this._playbackEpoch || 0) + 1;
    if (this._seekAbortController) {
      try { this._seekAbortController.abort(); } catch (e) {}
      this._seekAbortController = null;
    }
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

    this.cardRenderer.clearLiveLyrics();
    if (this._repostCardTimer) {
      clearTimeout(this._repostCardTimer);
      this._repostCardTimer = null;
    }
    this.playbackEngine._clearBufferingWatchdog();
    this.clearPlayCountTimer();
    this.clearCrossfadeTimer();
    this.playbackEngine._clearSessionSaveInterval();
    this.clearPreloadTimer();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.clear247IdleTimer();
    sessionManager.clearSession(this.guild.id);

    if (this.preloadedResource) {
      this.playbackEngine._cleanupResource(this.preloadedResource);
      this.preloadedResource = null;
      this.preloadedSongUrl = null;
    }
    this.autoplayPool = [];
    this.songs = [];
    this.currentSong = null;
    this.voiceSessionStartTime = null;
    this.isQueueOnHold = false;

    if (this.currentResource) {
      this.playbackEngine._cleanupResource(this.currentResource);
      this.currentResource = null;
    }
    this.player.stop(true);
    clearVoiceChannelStatus(this.voiceChannel);

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this.manager.remove(this.guild.id);
  }
}

module.exports = MusicQueue;
