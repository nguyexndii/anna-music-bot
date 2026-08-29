const {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState
} = require('@discordjs/voice');
const { createResource, getRelatedTrack, searchTrack } = require('../utils/musicExtractor');
const { getGemini247LofiTrack } = require('../utils/geminiHelper');
const {
  createNowPlayingBanner,
  createNowPlayingEmbed,
  createMusicControls,
  createErrorEmbed,
  createEmbed,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
} = require('../utils/embed');
const settingsManager = require('./SettingsManager');
const historyManager = require('./HistoryManager');
const sessionManager = require('./SessionManager');

class MusicQueue {
  constructor(guild, textChannel, voiceChannel, manager) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.manager = manager;

    this.songs = [];
    this.history = [];
    this.currentSong = null;
    this.prefetchedSong = null;
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this._isPreloading = false;
    this.currentResource = null;
    this.connection = null;

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    this.volume = 80;
    this.loopMode = 'off';
    this.mode247 = true;
    this.paused = false;

    this.disconnectTimeout = null;
    this.emptyRoomTimeout = null;
    this.idle247Timeout = null;
    this.crossfadeTimer = null;
    this.nowPlayingMessage = null;
    this._isPrefetching = false;

    this._initSettings();
    this._setupPlayerEvents();
  }

  clearCrossfadeTimer() {
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
  }

  _initSettings() {
    const guildSettings = settingsManager.get(this.guild.id);
    this.mode247 = Boolean(guildSettings.mode247);
    this.volume = guildSettings.defaultVolume || 80;
    this.loopMode = guildSettings.loopMode || 'off';
  }

  async connect() {
    const currentGuild = this.voiceChannel?.guild || this.guild;

    if (this.connection) {
      if (this.connection.state.status === VoiceConnectionStatus.Destroyed) {
        this.connection = null;
      } else if (this.connection.joinConfig?.channelId !== this.voiceChannel.id) {
        console.log(`[VoiceConnection] Chuyển phòng voice sang: ${this.voiceChannel.name} (${this.voiceChannel.id})`);
        this.connection.rejoin({
          channelId: this.voiceChannel.id,
          selfDeaf: true,
          selfMute: false
        });
        return this.connection;
      } else {
        return this.connection;
      }
    }

    console.log(`[VoiceConnection] Đang kết nối vào phòng Voice: ${this.voiceChannel.name} (${this.voiceChannel.id}) tại ${currentGuild.name}`);

    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: currentGuild.id,
      adapterCreator: currentGuild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    if (this.player) {
      this.connection.subscribe(this.player);
    }

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 15000);
    } catch (connErr) {
      console.warn(`[VoiceConnection] Chờ trạng thái Ready quá 15s tại ${this.guild.name}:`, connErr.message);
    }

    this.connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`[VoiceConnection Ready] Đã kết nối thành công vào phòng: ${this.voiceChannel.name}`);
      sessionManager.saveSession(this.guild.id, {
        voiceChannelId: this.voiceChannel.id,
        textChannelId: this.textChannel?.id,
        mode247: this.mode247,
        status: 'active'
      });
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (error) {
        console.warn(`[VoiceConnection] Mất kết nối tại ${this.guild.name}, tự động kết nối lại...`);
        this.destroy();
      }
    });

    return this.connection;
  }

  _setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Playing, () => {
      console.log(`[AudioPlayer] Đang phát bài: ${this.currentSong?.title} tại ${this.guild.name}`);
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      console.log(`[AudioPlayer] Kết thúc bài hát tại ${this.guild.name}`);
      this._handleSongEnd();
    });

    this.player.on('error', (error) => {
      console.error(`[AudioPlayer Error] Guild ${this.guild.name}:`, error);
      if (this.textChannel) {
        this.textChannel.send({
          embeds: [createErrorEmbed(`Lỗi phát nhạc: ${error.message || 'Không thể phát bài hát này.'}`)]
        }).catch(() => {});
      }
      this._handleSongEnd();
    });
  }

  async _handleSongEnd() {
    this.clearCrossfadeTimer();
    if (this.isDestroyed || this.isStopped) return;
    const lastSong = this.currentSong;

    if (lastSong) {
      this.history.push(lastSong.url);
      if (this.history.length > 50) this.history.shift();
      await historyManager.addSong(this.guild.id, lastSong);
    }

    if (this.loopMode === 'song' && lastSong) {
      this.songs.unshift(lastSong);
    } else if (this.loopMode === 'queue' && lastSong) {
      this.songs.push(lastSong);
    }

    this.currentSong = null;
    this.currentResource = null;

    if (this.songs.length > 0) {
      await this.playNext();
    } else if (this.prefetchedSong && !this.mode247) {
      const nextTrack = this.prefetchedSong;
      this.prefetchedSong = null;
      this.songs.push(nextTrack);
      await this.playNext();
    } else if (this.mode247) {
      // ♾️ Chế độ 24/7: Khi hết bài của người dùng hoặc phòng trống, LUÔN LUÔN phát nhạc Lofi Không Lời thư giãn!
      this.prefetchedSong = null;
      this.preloadedResource = null;
      setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      await this._play247BackgroundLofi();
    } else {
      // Nếu không bật 24/7: Kiểm tra Autoplay khi còn người nghe trong phòng
      const humanMembers = this.voiceChannel ? this.voiceChannel.members.filter(m => !m.user.bot) : new Map();
      const guildSettings = settingsManager.get(this.guild.id);
      if (guildSettings.autoplay && lastSong && humanMembers.size > 0) {
        const useAi = guildSettings.useAiAssistant !== false;
        const relatedTrack = await getRelatedTrack(lastSong, this.guild.id, useAi);
        if (relatedTrack) {
          this.songs.push(relatedTrack);
          return await this.playNext();
        }
      }

      // Hết nhạc và không bật 24/7
      clearVoiceChannelStatus(this.voiceChannel);
      const timeoutSeconds = guildSettings.emptyChannelTimeout || 60;
      this.startDisconnectTimer(timeoutSeconds * 1000);
    }
  }

  async _play247BackgroundLofi() {
    if (!this.mode247 || this.currentSong) return;
    try {
      setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      const lofiInfo = await getGemini247LofiTrack();
      const query = lofiInfo?.searchQuery || 'lofi hip hop radio beats to relax study to';
      const results = await searchTrack(query);
      if (results && results.length > 0 && this.mode247 && !this.currentSong) {
        const lofiTrack = results[0];
        lofiTrack.requestedBy = 'Auto (24/7)';
        this.songs.push(lofiTrack);
        await this.playNext();
      }
    } catch (e) {
      console.warn('[24/7 Lofi Background Error]:', e.message);
    }
  }

  startDisconnectTimer(timeoutMs = 60000) {
    if (this.mode247) return; // Không bao giờ rời phòng khi bật 24/7
    this.clearDisconnectTimer();

    this.disconnectTimeout = setTimeout(() => {
      if (!this.currentSong && this.songs.length === 0 && !this.mode247) {
        if (this.textChannel) {
          this.textChannel.send({
            embeds: [createEmbed('👋 Rời phòng', 'Hết nhạc trong hàng chờ, bot đã tự động rời phòng Voice.')]
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
        if (this.mode247 && this.voiceChannel) {
          const humanMembers = this.voiceChannel.members.filter(m => !m.user.bot);
          if (humanMembers.size === 0) {
            console.log(`[MusicQueue 24/7] Đã qua 1 phút phòng trống, hủy bộ đếm và chuyển sang phát nhạc Lofi 24/7...`);
            this.songs = [];
            this.prefetchedSong = null;
            this.preloadedResource = null;
            this.currentSong = null;
            this.currentResource = null;
            this.loopMode = 'off';
            this.player.stop(true);
            setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
            await this._play247BackgroundLofi();
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
          this.textChannel.send({
            embeds: [createEmbed('👋 Rời phòng', `Phòng Voice không còn ai trong ${timeoutSeconds} giây, bot đã tự động rời phòng.`)]
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

  async addSong(song, requestUser) {
    this.clear247IdleTimer();
    song.requestedBy = requestUser;

    // Nếu đang phát nhạc Lofi nền 24/7, ngắt ngay để ưu tiên bài hát của người dùng
    if (this.currentSong && this.currentSong.requestedBy === 'Auto (24/7)') {
      this.currentSong = null;
      this.player.stop();
    }

    this.songs.push(song);

    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this._preloadNextTrackResource();
    }
  }

  async addSongs(songArray, requestUser) {
    this.clear247IdleTimer();

    // Nếu đang phát nhạc Lofi nền 24/7, ngắt ngay để ưu tiên bài hát của người dùng
    if (this.currentSong && this.currentSong.requestedBy === 'Auto (24/7)') {
      this.currentSong = null;
      this.player.stop();
    }

    for (const song of songArray) {
      song.requestedBy = requestUser;
      this.songs.push(song);
    }

    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this._preloadNextTrackResource();
    }
  }

  async playNext() {
    if (this.songs.length === 0) return;

    this.isStopped = false;
    this.isDestroyed = false;
    const conn = await this.connect();

    this.currentSong = this.songs.shift();
    this.paused = false;

    try {
      const guildSettings = settingsManager.get(this.guild.id);
      const crossfade = guildSettings.crossfadeDuration || 0;

      const targetKey = this.currentSong.url || this.currentSong.searchQuery;
      let resource = null;

      // Sử dụng ngay tài nguyên âm thanh đã tải sẵn ngầm trong RAM (0.001s instant transition)
      if (this.preloadedResource && this.preloadedSongUrl === targetKey) {
        resource = this.preloadedResource;
        this.preloadedResource = null;
        this.preloadedSongUrl = null;
      } else {
        resource = await createResource(this.currentSong, crossfade);
      }

      this.currentResource = resource;

      if (resource.volume) {
        resource.volume.setVolume(this.volume / 100);
      }

      if (conn) {
        conn.subscribe(this.player);
      }

      this.player.play(resource);

      // Cập nhật trạng thái kênh Voice (Voice Channel Status)
      if (this.currentSong.requestedBy === 'Auto (24/7)') {
        setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      } else {
        setVoiceChannelStatus(this.voiceChannel, `🎶 ${this.currentSong.title}`);
      }

      // Kích hoạt Tải trước (Pre-fetch & Pre-buffer) bài tiếp theo ngầm để khi hết bài là nối liền lập tức
      this._prefetchAutoplayTrack();
      this._preloadNextTrackResource();

      // Gửi hoặc Cập nhật Banner bài đang phát (Siêu tinh gọn & hiện đại)
      if (this.textChannel && guildSettings.announceSongs !== false) {
        const banner = createNowPlayingBanner(this.currentSong, this);

        let edited = false;
        if (this.nowPlayingMessage) {
          try {
            const lastMessages = await this.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
            const isLastMessage = lastMessages && lastMessages.first()?.id === this.nowPlayingMessage.id;

            if (isLastMessage) {
              await this.nowPlayingMessage.edit({
                content: banner.content,
                embeds: [],
                components: banner.components
              });
              edited = true;
            } else {
              await this.nowPlayingMessage.delete().catch(() => {});
              this.nowPlayingMessage = null;
            }
          } catch (e) {
            this.nowPlayingMessage = null;
          }
        }

        if (!edited) {
          const msg = await this.textChannel.send({
            content: banner.content,
            components: banner.components
          });
          this.nowPlayingMessage = msg;
        }
      }
    } catch (error) {
      console.error(`[Play Error] ${this.currentSong.title}:`, error);
      if (this.textChannel) {
        this.textChannel.send({
          embeds: [createErrorEmbed(`Không thể phát bài **${this.currentSong.title}**: ${error.message}`)]
        }).catch(() => {});
      }
      this._handleSongEnd();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(1, Math.min(100, vol));
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume / 100);
    }
    settingsManager.update(this.guild.id, { defaultVolume: this.volume });
  }

  togglePause() {
    if (this.paused) {
      this.player.unpause();
      this.paused = false;
      return false;
    } else {
      this.player.pause();
      this.paused = true;
      return true;
    }
  }

  skip() {
    this.clearCrossfadeTimer();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.player.stop(true);
  }

  stop() {
    this.isStopped = true;
    this.clearCrossfadeTimer();
    this.songs = [];
    this.currentSong = null;
    this.currentResource = null;
    this.player.stop(true);
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
        sessionManager.saveSession(this.guild.id, {
          voiceChannelId: this.voiceChannel.id,
          textChannelId: this.textChannel?.id,
          mode247: true,
          status: 'active'
        });
      }
    } else {
      this.clear247IdleTimer();
      sessionManager.clearSession(this.guild.id);
    }
  }

  toggle247() {
    this.mode247 = !this.mode247;
    this.set247(this.mode247);
    return this.mode247;
  }

  destroy() {
    this.isDestroyed = true;
    this.isStopped = true;
    this.clearCrossfadeTimer();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.clear247IdleTimer();
    sessionManager.clearSession(this.guild.id);
    this.songs = [];
    this.currentSong = null;
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

    // Nếu bật 24/7 hoặc bài hiện tại là bài 24/7 Lofi nền: TUYỆT ĐỐI không prefetch nhạc pop autoplay
    if (this.mode247 || this.currentSong.requestedBy === 'Auto (24/7)') return;
    if (this.voiceChannel && this.voiceChannel.members.filter(m => !m.user.bot).size === 0) return;

    if (this.songs.length === 0 && !this.prefetchedSong) {
      this._isPrefetching = true;
      try {
        const useAi = guildSettings.useAiAssistant !== false;
        const nextTrack = await getRelatedTrack(this.currentSong, this.guild.id, useAi);
        if (nextTrack) {
          nextTrack.requestedBy = 'Auto';
          this.prefetchedSong = nextTrack;
          // Tải trước ngầm luồng âm thanh vào RAM
          this._preloadNextTrackResource();
        }
      } catch (err) {
        console.warn('[Autoplay Pre-fetch Error]:', err.message);
      } finally {
        this._isPrefetching = false;
      }
    }
  }

  /**
   * Tải trước tài nguyên âm thanh (AudioResource) của bài tiếp theo vào RAM
   * Giúp chuyển bài tức thì (0.001 giây) không có khoảng nghỉ / dead air
   */
  async _preloadNextTrackResource() {
    if (this._isPreloading || this.isDestroyed || this.isStopped) return;
    const nextTrack = this.songs.length > 0 ? this.songs[0] : this.prefetchedSong;
    if (!nextTrack) return;

    const nextKey = nextTrack.url || nextTrack.searchQuery;
    if (this.preloadedResource && this.preloadedSongUrl === nextKey) return;

    this._isPreloading = true;
    try {
      const guildSettings = settingsManager.get(this.guild.id);
      const crossfade = guildSettings.crossfadeDuration || 0;
      const resource = await createResource(nextTrack, crossfade);
      if (resource) {
        this.preloadedResource = resource;
        this.preloadedSongUrl = nextKey;
      }
    } catch (e) {
      // Bỏ qua lỗi preload, playNext sẽ tự tạo lại
    } finally {
      this._isPreloading = false;
    }
  }
}

module.exports = MusicQueue;
