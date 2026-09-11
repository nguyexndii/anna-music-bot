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
const lofiHistoryManager = require('./LofiHistoryManager');
const { logAction } = require('../utils/debugLogger');
const { hasEnoughMemoryToPreload, logMemoryUsage } = require('../utils/systemMonitor');

function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

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
    this.nowPlayingMessage = null;
    this._isPrefetching = false;
    this._isPlayingNext = false;
    this._isPreviousAction = false;

    this._initSettings();
    this._setupPlayerEvents();
  }

  get isPlaying() {
    return this.player?.state?.status === AudioPlayerStatus.Playing || (!this.paused && Boolean(this.currentSong));
  }

  get isPaused() {
    return this.paused || this.player?.state?.status === AudioPlayerStatus.Paused;
  }

  clearPreloadTimer() {
    if (this.preloadTimer) {
      clearTimeout(this.preloadTimer);
      this.preloadTimer = null;
    }
  }

  clearCrossfadeTimer() {
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
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
      debug: true
    });

    this.connection.on('debug', msg => {
      if (!msg.includes('ping') && !msg.includes('pong')) {
        console.log(`[VoiceDebug] ${this.guild.name}:`, msg);
      }
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
      console.log(`[AudioPlayer] Đang phát bài: ${this.currentSong?.title} tại ${this.guild.name}`);
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      console.log(`[AudioPlayer] Kết thúc bài hát tại ${this.guild.name}`);
      this._handleSongEnd();
    });

    this.player.on('error', (error) => {
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

      // Chỉ gửi vào textChannel nếu bài hát do user yêu cầu và không phải lỗi đóng luồng EPIPE/ECONNRESET
      if (this.textChannel && !is247Lofi && !isEpipe) {
        this.textChannel.send({
          embeds: [createErrorEmbed(`Lỗi phát nhạc: ${error.message || 'Không thể phát bài hát này.'}`)],
          flags: 4096
        }).catch(() => {});
      }
      this._handleSongEnd();
    });
  }

  async _handleSongEnd() {
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    if (this.isDestroyed || this.isStopped || this._switchingTo247) return;
    const lastSong = this.currentSong;
    const wasExplicitSkip = Boolean(this._skipRequested);
    const wasPrevious = Boolean(this._isPreviousAction);
    this._skipRequested = false;
    this._isPreviousAction = false;

    if (!wasPrevious && lastSong && !lastSong.is247 && lastSong.requestedBy !== 'Auto (24/7)') {
      this.lastUserTrack = lastSong;
      this.history.push(lastSong.url);
      if (this.history.length > 50) this.history.shift();
      await historyManager.addSong(this.guild.id, lastSong);
      
      this.previousSongs.push(lastSong);
      if (this.previousSongs.length > 5) this.previousSongs.shift();
    }

    // Chỉ lặp lại bài nếu người dùng không bấm nút Skip hoặc Previous thủ công
    if (!wasExplicitSkip && !wasPrevious && this.loopMode === 'song' && lastSong) {
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
    const isLofiTrack = lastSong?.requestedBy === 'Auto (24/7)' || lastSong?.is247;
    const songToRelate = lastSong || (this.previousSongs.length > 0 ? this.previousSongs[this.previousSongs.length - 1] : null);

    // 0. Nếu trong hàng chờ vẫn còn bài của người dùng -> Luôn ưu tiên phát bài tiếp theo ngay lập tức!
    if (this.songs.length > 0) {
      await this.playNext();
      return;
    }

    // 1. Nếu bài vừa kết thúc là nhạc Lofi 24/7 và hàng chờ trống -> Tiếp tục phát bài Lofi nền tiếp theo
    if (isLofiTrack && this.mode247) {
      await this._play247BackgroundLofi();
      return;
    }

    // Tránh phát lại bài cũ nếu prefetched trùng với bài vừa phát
    if (this.prefetchedSong && (this.prefetchedSong.url === lastSong?.url || this.prefetchedSong.title === lastSong?.title)) {
      this.prefetchedSong = null;
    }

    // 0.1 Nếu đã có sẵn bài Autoplay tải trước ngầm trong RAM -> Nối bài ngay lập tức (0.001s instant transition)
    if (this.prefetchedSong && humanCount > 0 && guildSettings.autoplay !== false && !isLofiTrack) {
      const nextTrack = this.prefetchedSong;
      this.prefetchedSong = null;
      this.songs.push(nextTrack);
      await this.playNext();
      return;
    }

    // 1. KHI CÒN NGƯỜI TRONG PHÒNG VOICE (humanCount > 0):
    if (humanCount > 0) {
      // A. Nếu bài vừa phát là bài do User order hoặc Autoplay gợi ý -> Tiếp tục dùng Autoplay (DJ AI) gợi ý bài tương tự!
      if (guildSettings.autoplay !== false && songToRelate && !isLofiTrack) {
        const useAi = guildSettings.useAiAssistant !== false;
        let relatedTrack = null;
        try {
          relatedTrack = await getRelatedTrack(songToRelate, this.guild.id, useAi);
        } catch (getRelErr) {
          console.warn('[getRelatedTrack Error]:', getRelErr.message);
        }

        // Fallback tự động nếu không tìm được: Tìm bài hát hay nhất cùng ca sĩ hoặc cùng thể loại
        if (!relatedTrack) {
          try {
            const cleanTitle = (songToRelate.title || '').replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ').trim();
            const artist = (songToRelate.artist && songToRelate.artist !== 'Unknown') ? songToRelate.artist : cleanTitle.split(/[-–|]/)[0]?.trim();
            const query = artist ? `${artist} bài hát hay nhất tuyển chọn` : `${cleanTitle} official audio`;
            console.log(`[Autoplay Fallback Query] Thử tìm bài thay thế: "${query}"`);
            const fallbackResults = await searchTrack(query);
            if (fallbackResults && fallbackResults.length > 0) {
              relatedTrack = fallbackResults.find(t => t.url !== songToRelate.url) || fallbackResults[0];
            }
          } catch (fbErr) {
            console.warn('[Autoplay Fallback Error]:', fbErr.message);
          }
        }

        if (relatedTrack) {
          relatedTrack.requestedBy = 'Tự động phát 🎵';
          this.songs.push(relatedTrack);
          await this.playNext();
          return;
        }
      }

      // B. Nếu bài vừa phát là Lofi 24/7 (người vừa vào phòng chưa order bài mới) -> Tiếp tục phát bài Lofi tiếp theo
      if (this.mode247 && isLofiTrack) {
        await this._play247BackgroundLofi();
        return;
      }

      // C. Nếu hết bài và không có bài gợi ý nào
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
    if (!this.mode247 || this.currentSong) return;
    try {
      setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      const recentHistory = lofiHistoryManager.getHistory(this.guild.id);
      const lofiInfo = await getGemini247LofiTrack(recentHistory);
      const query = lofiInfo?.searchQuery || 'nhac viet khong loi acoustic guitar chill instrumental';
      const results = await searchTrack(query);
      if (results && results.length > 0 && this.mode247 && !this.currentSong) {
        // Lọc bài: loại bỏ bài meme/troll/vocal và tránh trùng lặp ít nhất 20-25 bài gần nhất
        const isMemeOrVocal = (t) => {
          const title = (t.title || '').toLowerCase();
          return /\b(khá\s*bảnh|kha\s*banh|mặt\s*lồn|troll|meme|chế|hài|bựa|vinahouse|nhạc\s*chế)\b/i.test(title);
        };

        let cleanTrack = results.find(t => !isMemeOrVocal(t) && !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 25));
        if (!cleanTrack) {
          // Nếu tất cả đều dính trong 25 bài, thử lọc không dính 10 bài gần nhất
          cleanTrack = results.find(t => !isMemeOrVocal(t) && !lofiHistoryManager.isRecentlyPlayed(this.guild.id, t, 10));
        }
        if (!cleanTrack) {
          cleanTrack = results.find(t => !isMemeOrVocal(t)) || results[0];
        }

        cleanTrack.requestedBy = 'Auto (24/7)';
        cleanTrack.is247 = true;
        lofiHistoryManager.addTrack(this.guild.id, cleanTrack);

        this.songs.unshift(cleanTrack);
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
          logAction('MESSAGE_SEND', {
            type: 'DISCONNECT_NOTICE',
            channelId: this.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: 'Het nhac trong hang cho, bot da tu dong roi phong Voice.'
          });
          this.textChannel.send({
            embeds: [createEmbed('👋 Rời phòng', 'Hết nhạc trong hàng chờ, bot đã tự động rời phòng Voice.')],
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
          logAction('MESSAGE_SEND', {
            type: 'EMPTY_ROOM_NOTICE',
            channelId: this.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: `Phong Voice khong con ai trong ${timeoutSeconds}s`
          });
          this.textChannel.send({
            embeds: [createEmbed('👋 Rời phòng', `Phòng Voice không còn ai trong ${timeoutSeconds} giây, bot đã tự động rời phòng.`)],
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

  async addSong(song, requestUser) {
    this.clear247IdleTimer();
    this._attachRequester(song, requestUser);

    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.requestedBy === 'Auto (24/7)' || this.currentSong.is247));

    if (isCurrentLofi) {
      // Khi đang phát nhạc nền Lofi 24/7 và có người dùng order nhạc mới:
      // Dừng bài Lofi ngay lập tức, chuyển bài mới vào hàng chờ và phát ngay!
      this.currentSong = null;
      this._skipRequested = true;
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.player.stop(true);
      this.songs.push(song);
      this._saveSessionState();
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();
      await this.playNext();
      return;
    }

    this.songs.push(song);
    this._saveSessionState();

    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this.schedulePreload();
    }
  }

  async addSongs(songArray, requestUser) {
    this.clear247IdleTimer();
    for (const song of songArray) {
      this._attachRequester(song, requestUser);
    }

    const isCurrentLofi = Boolean(this.currentSong && (this.currentSong.requestedBy === 'Auto (24/7)' || this.currentSong.is247));

    if (isCurrentLofi) {
      this.currentSong = null;
      this._skipRequested = true;
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.player.stop(true);
      this.songs.push(...songArray);
      this._saveSessionState();
      this.enrichMissingThumbnails().catch(() => {});
      this.clearDisconnectTimer();
      this.clearEmptyRoomTimer();
      await this.playNext();
      return;
    }

    this.songs.push(...songArray);
    this._saveSessionState();
    this.enrichMissingThumbnails().catch(() => {});

    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();

    if (!this.currentSong && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      this.schedulePreload();
    }
  }

  get isPlaying() {
    return this.player?.state?.status === AudioPlayerStatus.Playing;
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

  /**
   * Lập lịch tìm trước bài tiếp theo (Metadata Pre-fetch) khi bài hiện tại còn 20 giây cuối.
   * LƯU Ý: Chỉ tìm kiếm metadata (URL/Title) nhẹ nhàng, TUYỆT ĐỐI KHÔNG spawn tiến trình
   * stream yt-dlp & ffmpeg song song để tránh làm quá tải CPU 100% gây mất tiếng ở 20s cuối bài!
   */
  schedulePreload() {
    this.clearPreloadTimer();
    if (!this.currentSong || this.isDestroyed || this.isStopped) return;

    const is247 = Boolean(this.currentSong.is247 || this.currentSong.requestedBy === 'Auto (24/7)' || this.currentSong.isLive);
    const totalSec = parseDurationToSeconds(this.currentSong.duration);

    if (is247 || totalSec <= 0) {
      return;
    }

    // Với bài hát có thời lượng: Kích hoạt tìm trước metadata bài tiếp theo ở 20s cuối
    const triggerAfterMs = Math.max(1000, (totalSec - 20) * 1000);
    this.preloadTimer = setTimeout(() => {
      this.preloadTimer = null;
      this._prefetchAutoplayTrack();
    }, triggerAfterMs);
  }

  async playNext() {
    if (this._isPlayingNext) return;
    this._isPlayingNext = true;

    try {
      if (this.songs.length === 0) return;

      this.isStopped = false;
      this.isDestroyed = false;
      this.clearPreloadTimer();
      const conn = await this.connect();

      const nextSong = this.songs.shift();
      if (!nextSong) return;
      this.currentSong = nextSong;
      this.currentSong.seekPosition = 0;
      if (this.currentResource) {
        this._cleanupResource(this.currentResource);
        this.currentResource = null;
      }
      this.paused = false;
      try { this.player.unpause(); } catch (e) {}
      this._saveSessionState();

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

      if (this.currentResource && this.currentResource !== resource) {
        this._cleanupResource(this.currentResource);
      }
      this.currentResource = resource;

      if (resource.volume) {
        resource.volume.setVolume(this.volume / 100);
      }

      if (conn) {
        conn.subscribe(this.player);
      }

      this.player.play(resource);
      if (this.currentSong) {
        this.currentSong.startTime = Date.now();
        this.currentSong.seekPosition = 0;
        logMemoryUsage(`Track Start: ${(this.currentSong.title || '').slice(0, 25)}`);

        // Ghi nhận ngay vào lịch sử bài hát khi bắt đầu phát!
        if (!this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
          if (!this.history.includes(this.currentSong.url)) {
            this.history.unshift(this.currentSong.url);
            if (this.history.length > 50) this.history.pop();
          }
          historyManager.addSong(this.guild.id, this.currentSong).catch(() => {});
        }
      }

      // Cập nhật trạng thái kênh Voice (Voice Channel Status)
      if (this.currentSong?.requestedBy === 'Auto (24/7)') {
        setVoiceChannelStatus(this.voiceChannel, '♾️ 24/7 Mode');
      } else {
        setVoiceChannelStatus(this.voiceChannel, `🎶 ${this.currentSong?.title || 'Unknown'}`);
      }

      // Lập lịch tải trước (Preload) ở 20s cuối bài để bảo vệ RAM VPS
      this.schedulePreload();

      // Gửi hoặc Cập nhật Banner bài đang phát (Chỉ gửi khi có người nghe order/DJ AI, KHÔNG spam khi phát Lofi 24/7 nền)
      const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);
      if (this.textChannel && guildSettings.announceSongs !== false && !is247Lofi) {
        try {
          const banner = createNowPlayingBanner(this.currentSong, this);

          let edited = false;
          if (this.nowPlayingMessage) {
            try {
              const lastMessages = await this.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
              const isLastMessage = lastMessages && lastMessages.first()?.id === this.nowPlayingMessage.id;

              if (isLastMessage) {
                logAction('MESSAGE_EDIT', {
                  type: 'NOW_PLAYING_BANNER',
                  channelId: this.textChannel.id,
                  messageId: this.nowPlayingMessage.id,
                  content: (banner.content || '').slice(0, 80)
                });
                await this.nowPlayingMessage.edit({
                  content: banner.content,
                  embeds: [],
                  components: banner.components
                });
                edited = true;
              } else {
                logAction('MESSAGE_DELETE', {
                  type: 'NOW_PLAYING_BANNER_OLD',
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
              type: 'NOW_PLAYING_BANNER',
              channelId: this.textChannel.id,
              guildId: this.guild.id,
              flags: 4096,
              content: (banner.content || '').slice(0, 80)
            });
            const msg = await this.textChannel.send({
              content: banner.content,
              components: banner.components,
              flags: 4096
            });
            this.nowPlayingMessage = msg;
          }
        } catch (bannerError) {
          console.warn(`[Banner Send Warning] Không thể gửi banner tới kênh ${this.textChannel.id}:`, bannerError.message);
        }
      }
    } catch (error) {
      console.error(`[Play Error] ${this.currentSong?.title || 'Unknown'}:`, error);
      const is247Lofi = Boolean(this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247);

      logAction('PLAY_ERROR', {
        guildId: this.guild.id,
        channelId: this.textChannel?.id,
        song: this.currentSong?.title || 'Unknown',
        url: this.currentSong?.url || 'N/A',
        error: error.message || String(error),
        is247: is247Lofi
      });

      // Chỉ gửi thông báo lỗi ra textChannel nếu là bài do user yêu cầu (không spam bài 24/7 nền)
      if (this.textChannel && !is247Lofi) {
        this.textChannel.send({
          embeds: [createErrorEmbed(`Không thể phát bài **${this.currentSong?.title || 'đã chọn'}**: ${error.message}`)],
          flags: 4096
        }).catch(() => {});
      }
      this._handleSongEnd();
    } finally {
      this._isPlayingNext = false;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(100, vol));
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume / 100);
    }
    settingsManager.update(this.guild.id, { defaultVolume: this.volume });
  }

  pause() {
    if (!this.paused) {
      this.player.pause();
      this.paused = true;
    }
  }

  resume() {
    if (this.paused) {
      this.player.unpause();
      this.paused = false;
    }
  }

  async seek(seconds) {
    if (!this.currentSong || this.isDestroyed || this.isStopped) {
      throw new Error('Không có bài hát nào đang phát để tua');
    }

    const seekSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    console.log(`[MusicQueue Seek] Tua bài "${this.currentSong.title}" đến ${seekSeconds}s tại máy chủ ${this.guild.name}`);

    // Hủy các timer chuyển bài / preload cũ và dọn dẹp tiến trình con
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;

    const resource = await createResource(this.currentSong, 0, seekSeconds);

    this._cleanupResource(this.currentResource);
    this.currentResource = resource;
    if (resource.volume) {
      resource.volume.setVolume(this.volume / 100);
    }

    this.currentSong.startTime = Date.now() - (seekSeconds * 1000);
    this.currentSong.seekPosition = seekSeconds;
    this.paused = false;

    if (this.connection) {
      this.connection.subscribe(this.player);
    }

    this.player.play(resource);
    this.schedulePreload();
    return seekSeconds;
  }

  shuffle() {
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    this._saveSessionState();
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

  skip() {
    const now = Date.now();
    if (this._lastSkipTime && (now - this._lastSkipTime < 1500)) {
      return false;
    }
    this._lastSkipTime = now;

    // Tự động hủy trạng thái tạm dừng để bài hát tiếp theo luôn phát ngay lập tức
    this.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this._skipRequested = true;
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.prefetchedSong = null;
    this.clearCrossfadeTimer();
    this.player.stop();
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
    this.player.stop();
    return true;
  }

  async playNow(index) {
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= this.songs.length) return false;
    const targetTrack = this.songs.splice(idx, 1)[0];
    if (!targetTrack) return false;

    this.paused = false;
    try { this.player.unpause(); } catch (e) {}

    this.clearPreloadTimer();
    this.songs.unshift(targetTrack);
    this.skip();
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
    return true;
  }

  stop() {
    this.isStopped = true;
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
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

    // Giữ nguyên hàng chờ (this.songs), chỉ đặt lại chế độ lặp
    this.loopMode = 'off';

    // Lưu lại bài hát người dùng đang nghe trước khi dọn dẹp
    if (this.currentSong && !this.currentSong.is247 && this.currentSong.requestedBy !== 'Auto (24/7)') {
      this.lastUserTrack = this.currentSong;
    }

    // Dọn bài hát hiện tại
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

  destroy() {
    this.isDestroyed = true;
    this.isStopped = true;
    this.clearCrossfadeTimer();
    this.clearPreloadTimer();
    this.clearDisconnectTimer();
    this.clearEmptyRoomTimer();
    this.clear247IdleTimer();
    sessionManager.clearSession(this.guild.id);
    this._cleanupResource(this.preloadedResource);
    this.preloadedResource = null;
    this.preloadedSongUrl = null;
    this.songs = [];
    this.currentSong = null;
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
      this._isPrefetching = true;
      try {
        const useAi = guildSettings.useAiAssistant !== false;
        const nextTrack = await getRelatedTrack(this.currentSong, this.guild.id, useAi);
        if (nextTrack) {
          nextTrack.requestedBy = 'Tự động phát 🎵';
          this.prefetchedSong = nextTrack;
          console.log(`[Autoplay Metadata Pre-fetch] Đã tìm sẵn bài kế tiếp: "${nextTrack.title}" (${nextTrack.artist || 'YouTube'})`);
        }
      } catch (err) {
        console.warn('[Autoplay Pre-fetch Error]:', err.message);
      } finally {
        this._isPrefetching = false;
      }
    }
  }

  async enrichMissingThumbnails() {
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
    const batchSize = 15;
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
  }

  /**
   * Giữ lại để tương thích ngược nhưng không spawn tiến trình song song gây mất tiếng
   */
  _saveSessionState() {
    if (!this.guild || !this.voiceChannel) return;
    try {
      const isLofiCurrent = this.currentSong?.requestedBy === 'Auto (24/7)' || this.currentSong?.is247;
      const userSongs = (this.songs || []).filter(s => s && s.requestedBy !== 'Auto (24/7)' && !s.is247);
      sessionManager.saveSession(this.guild.id, {
        voiceChannelId: this.voiceChannel.id,
        textChannelId: this.textChannel?.id,
        mode247: this.mode247,
        status: (this.isPlaying && !isLofiCurrent) ? 'active' : 'idle_247',
        currentSong: (!isLofiCurrent && this.currentSong) ? this.currentSong : null,
        songs: userSongs
      });
    } catch (e) {}
  }
}

module.exports = MusicQueue;
