const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');
const settingsManager = require('../SettingsManager');
const sessionManager = require('../SessionManager');
const { logAction } = require('../../utils/debugLogger');
const { setVoiceChannelStatus, createEmbed } = require('../../utils/embed');

class VoiceConnectionManager {
  constructor(queue) {
    this.queue = queue;
  }

  get guild() {
    return this.queue.guild;
  }

  get voiceChannel() {
    return this.queue.voiceChannel;
  }

  set voiceChannel(vc) {
    this.queue.voiceChannel = vc;
  }

  get connection() {
    return this.queue.connection;
  }

  set connection(conn) {
    this.queue.connection = conn;
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

    // 1. Kiểm tra qua guild.voiceStates.cache
    const voiceStates = this.guild.voiceStates?.cache;
    if (voiceStates && voiceStates.size > 0) {
      let count = 0;
      for (const state of voiceStates.values()) {
        if (state.channelId === channelId) {
          if (state.id === botId) continue;
          if (state.member?.user?.bot) continue;
          const user = this.guild.client.users?.cache?.get(state.id);
          if (user?.bot) continue;

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
      if (!this.queue.voiceSessionStartTime) {
        this.queue.voiceSessionStartTime = Date.now();
      }
      logAction('VOICE_CONNECTION_READY', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.voiceChannel?.id
      });
      console.log(`[VoiceConnection Ready] Đã kết nối thành công vào phòng: ${this.voiceChannel?.name}`);
      if (this.queue.player && this.connection) {
        this.connection.subscribe(this.queue.player);
      }
      this.queue._saveSessionState();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logAction('VOICE_CONNECTION_DISCONNECTED', {
        guild: this.guild.name,
        guildId: this.guild.id,
        channelId: this.voiceChannel?.id
      });

      if (this.queue.isDestroyed || this.queue._manualLeave) return;
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
        if (this.connection && this.connection.state?.status === VoiceConnectionStatus.Ready) {
          return;
        }

        console.warn(`[VoiceConnection] Mất kết nối tại ${this.guild.name}`);
        if (this.queue.mode247 && !this.queue.isDestroyed && !this.queue._manualLeave) {
          this._isReconnecting = true;
          try {
            if (this.connection && this.connection.state?.status !== VoiceConnectionStatus.Destroyed) {
              try {
                this.connection.rejoin({
                  channelId: this.voiceChannel.id,
                  selfDeaf: true,
                  selfMute: false
                });
                await entersState(this.connection, VoiceConnectionStatus.Ready, 5000);
                if (this.queue.currentResource && this.queue.player && this.connection) {
                  this.connection.subscribe(this.queue.player);
                }
                return;
              } catch (rejoinErr) {}
            }

            if (this.connection) {
              try { this.connection.destroy(); } catch (e) {}
              this.connection = null;
            }
            console.log(`[VoiceConnection 24/7] Đang tự động kết nối lại vào phòng ${this.voiceChannel?.name || 'Voice'} tại ${this.guild.name}...`);
            await this.connect();
            if (this.queue.currentResource && this.queue.player && this.connection) {
              this.connection.subscribe(this.queue.player);
            }
          } catch (reconnectErr) {
            console.warn(`[VoiceConnection Reconnect Failed]:`, reconnectErr.message);
          } finally {
            this._isReconnecting = false;
          }
        } else {
          this.queue.destroy();
        }
      }
    });

    if (this.queue.player && this.connection) {
      this.connection.subscribe(this.queue.player);
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

  startDisconnectTimer(timeoutMs = 60000) {
    if (this.queue.mode247) return;
    this.clearDisconnectTimer();

    this.queue.disconnectTimeout = setTimeout(() => {
      if (!this.queue.currentSong && this.queue.songs.length === 0 && !this.queue.mode247) {
        if (this.queue.textChannel) {
          logAction('MESSAGE_SEND', {
            type: 'DISCONNECT_NOTICE',
            channelId: this.queue.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: 'Het nhac trong hang cho, bot da tu dong roi phong Voice.'
          });
          const lang = settingsManager.get(this.guild.id)?.language;
          this.queue.textChannel.send({
            embeds: [createEmbed(lang === 'en' ? '👋 Disconnected' : '👋 Rời phòng', lang === 'en' ? 'Queue has ended, bot automatically left the Voice channel.' : 'Hết nhạc trong hàng chờ, bot đã tự động rời phòng Voice.')],
            flags: 4096
          }).catch(() => {});
        }
        this.queue.destroy();
      }
    }, timeoutMs);
  }

  clearDisconnectTimer() {
    if (this.queue.disconnectTimeout) {
      clearTimeout(this.queue.disconnectTimeout);
      this.queue.disconnectTimeout = null;
    }
  }

  startEmptyRoomTimer(timeoutSeconds = 60) {
    if (this.queue.mode247) {
      this.clear247IdleTimer();
      console.log(`[MusicQueue 24/7] Phòng trống tại máy chủ ${this.guild.name}. Đếm 1 phút (60s) trước khi chuyển sang trạng thái Treo Lofi 24/7...`);
      this.queue.idle247Timeout = setTimeout(async () => {
        this.queue.idle247Timeout = null;
        if (this.queue.mode247) {
          const humanCount = this.getHumanMemberCount();
          if (humanCount === 0) {
            console.log(`[MusicQueue 24/7] Đã qua 1 phút phòng trống, duy trì phát nhạc nền Lofi 24/7 nhẹ nhàng...`);
            this.queue.songs = this.queue.getUserSongs();
            this.queue.isQueueOnHold = true;
            this.queue.prefetchedSong = null;
            if (this.queue.preloadedResource) {
              this.queue._cleanupResource(this.queue.preloadedResource);
              this.queue.preloadedResource = null;
              this.queue.preloadedSongUrl = null;
            }
            this.queue.loopMode = 'off';
            const lang = settingsManager.get(this.guild.id)?.language;
            setVoiceChannelStatus(this.voiceChannel, lang === 'en' ? '♾️ 24/7 Lofi Mode' : '♾️ 24/7 Lofi Radio');
            await sessionManager.saveSession(this.guild.id, {
              voiceChannelId: this.voiceChannel.id,
              textChannelId: this.queue.textChannel?.id,
              mode247: true,
              status: 'idle_247'
            });

            // Duy trì luồng âm thanh Lofi 24/7, gọi stop(true) trước khi cleanupResource để chống ERR_STREAM_PREMATURE_CLOSE
            if (!this.queue.isCurrentSongLofi()) {
              this.queue._switchingTo247 = true;
              try {
                if (this.queue.player) {
                  this.queue.player.stop(true);
                }
                if (this.queue.currentResource) {
                  this.queue._cleanupResource(this.queue.currentResource);
                  this.queue.currentResource = null;
                }
                this.queue.currentSong = null;
                await this.queue._play247BackgroundLofi();
              } finally {
                this.queue._switchingTo247 = false;
              }
            }
          }
        }
      }, 60000);
      return;
    }

    this.clearEmptyRoomTimer();
    console.log(`[MusicQueue] Phòng Voice trống tại máy chủ ${this.guild.name}. Bộ đếm ${timeoutSeconds}s bắt đầu...`);
    this.queue.emptyRoomTimeout = setTimeout(() => {
      if (!this.queue.mode247) {
        if (this.queue.textChannel) {
          logAction('MESSAGE_SEND', {
            type: 'EMPTY_ROOM_NOTICE',
            channelId: this.queue.textChannel.id,
            guildId: this.guild.id,
            flags: 4096,
            content: `Phong Voice khong con ai trong ${timeoutSeconds}s`
          });
          const lang = settingsManager.get(this.guild.id)?.language;
          this.queue.textChannel.send({
            embeds: [createEmbed(lang === 'en' ? '👋 Disconnected' : '👋 Rời phòng', lang === 'en' ? `No listeners in Voice channel for ${timeoutSeconds} seconds, bot automatically left.` : `Phòng Voice không còn ai trong ${timeoutSeconds} giây, bot đã tự động rời phòng.`)],
            flags: 4096
          }).catch(() => {});
        }
        this.queue.destroy();
      }
    }, timeoutSeconds * 1000);
  }

  clearEmptyRoomTimer() {
    let wasCounting = false;
    if (this.queue.emptyRoomTimeout) {
      clearTimeout(this.queue.emptyRoomTimeout);
      this.queue.emptyRoomTimeout = null;
      wasCounting = true;
    }
    if (this.queue.idle247Timeout) {
      clearTimeout(this.queue.idle247Timeout);
      this.queue.idle247Timeout = null;
      wasCounting = true;
    }
    if (wasCounting) {
      console.log(`[MusicQueue] Đã có người vào phòng Voice tại máy chủ ${this.guild.name}. Hủy bộ đếm tự động.`);
    }
  }

  clear247IdleTimer() {
    if (this.queue.idle247Timeout) {
      clearTimeout(this.queue.idle247Timeout);
      this.queue.idle247Timeout = null;
    }
  }
}

module.exports = VoiceConnectionManager;
