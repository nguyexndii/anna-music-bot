const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { setVoiceChannelStatus, clearVoiceChannelStatus } = require('../utils/embed');
const { logAction } = require('../utils/debugLogger');

/**
 * Xử lý VoiceStateUpdate (Bot rời phòng, đổi phòng hoặc phòng trống)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
async function handleVoiceStateUpdate(client, oldState, newState) {
  const guild = oldState.guild || newState.guild;
  if (!guild) return;

  const queue = musicManager.get(guild.id);

  // 1. Khi chính BOT bị ngắt kết nối hoặc rời khỏi kênh Voice
  if (oldState.id === client.user.id && !newState.channelId) {
    logAction('VOICE_STATE_UPDATE', {
      event: 'BOT_DISCONNECTED',
      guildId: guild.id,
      oldChannelId: oldState.channelId,
      newChannelId: 'null'
    });
    if (oldState.channel) {
      await clearVoiceChannelStatus(oldState.channel).catch(() => {});
    }
    if (queue) {
      if (queue._manualLeave) {
        queue.destroy();
      } else if (queue.mode247 && !queue.isDestroyed) {
        // Watchdog: Tự động Rejoin lũy tiến vô hạn khi mất kết nối (2s, 5s, 10s...)
        if (!queue._watchdogRejoining) {
          queue._watchdogRejoining = true;
          const retryDelays = [2000, 5000, 10000, 15000, 30000];
          let attempt = 0;

          const attemptRejoin = async () => {
            if (!queue.mode247 || queue.isDestroyed || queue._manualLeave) {
              queue._watchdogRejoining = false;
              return;
            }

            // Dừng retry nếu kênh thoại không còn tồn tại hoặc thiếu quyền
            const targetChannel = queue.voiceChannel?.id ? guild.channels.cache.get(queue.voiceChannel.id) : null;
            if (!targetChannel) {
              console.warn(`[24/7 Voice Watchdog] Kênh thoại không còn tồn tại tại máy chủ ${guild.name}. Dừng Watchdog.`);
              queue._watchdogRejoining = false;
              queue.destroy();
              return;
            }

            if (targetChannel.permissionsFor && client.user) {
              const perms = targetChannel.permissionsFor(client.user);
              if (perms && (!perms.has('Connect') || !perms.has('Speak') || !perms.has('ViewChannel'))) {
                console.warn(`[24/7 Voice Watchdog] Bot thiếu quyền kết nối kênh thoại ${targetChannel.name} tại ${guild.name}. Dừng Watchdog.`);
                queue._watchdogRejoining = false;
                queue.destroy();
                return;
              }
            }

            const me = guild.members.me;
            if (me?.voice?.channelId) {
              console.log(`[24/7 Voice Watchdog] Bot đã kết nối lại phòng Voice tại ${guild.name}. Kết thúc Watchdog.`);
              queue._watchdogRejoining = false;
              if (!queue.currentSong && (queue.isQueueOnHold || !queue.songs || queue.songs.length === 0)) {
                if (typeof queue._play247BackgroundLofi === 'function') {
                  queue._play247BackgroundLofi().catch(() => {});
                }
              }
              return;
            }

            console.log(`[24/7 Voice Watchdog] Thử kết nối lại lần ${attempt + 1} vào phòng ${queue.voiceChannel?.name || 'Voice'} tại ${guild.name}...`);
            try {
              await queue.connect();
              const meAfter = guild.members.me;
              if (meAfter?.voice?.channelId) {
                console.log(`[24/7 Voice Watchdog] Kết nối lại thành công tại ${guild.name}!`);
                queue._watchdogRejoining = false;
                if (!queue.currentSong && (queue.isQueueOnHold || !queue.songs || queue.songs.length === 0)) {
                  if (typeof queue._play247BackgroundLofi === 'function') {
                    queue._play247BackgroundLofi().catch(() => {});
                  }
                }
                return;
              }
            } catch (e) {
              console.warn(`[24/7 Voice Watchdog Reconnect Failed (Lần ${attempt + 1})]:`, e.message);
              if (e.code === 50013 || e.code === 10003 || /permission|access denied|missing access/i.test(e.message)) {
                console.warn(`[24/7 Voice Watchdog] Không thể kết nối do lỗi quyền hoặc kênh bị xóa tại ${guild.name}. Dừng Watchdog.`);
                queue._watchdogRejoining = false;
                queue.destroy();
                return;
              }
            }

            const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
            attempt++;
            setTimeout(attemptRejoin, delay);
          };

          setTimeout(attemptRejoin, 2000);
        }
      } else if (!queue.mode247 && !queue.isDestroyed) {
        // H-04: Đợi 5 giây xem có phải Discord đang chuyển vùng Voice Server tạm thời hay không
        setTimeout(() => {
          if (!queue.isDestroyed && !queue._manualLeave && !guild.members.me?.voice?.channelId) {
            queue.destroy();
          }
        }, 5000);
      }
    }
    return;
  }

  // 2. Khi BOT bị chuyển sang phòng Voice khác
  if (oldState.id === client.user.id && newState.channelId && oldState.channelId !== newState.channelId) {
    logAction('VOICE_STATE_UPDATE', {
      event: 'BOT_MOVED_CHANNEL',
      guildId: guild.id,
      oldChannelId: oldState.channelId,
      newChannelId: newState.channelId
    });
    if (oldState.channel) {
      await clearVoiceChannelStatus(oldState.channel).catch(() => {});
    }
    if (queue) {
      queue.voiceChannel = newState.channel;
      if (queue.currentSong) {
        logAction('VOICE_STATUS_UPDATE', {
          source: 'voiceStateUpdate.js/voiceStateUpdate',
          channelId: newState.channelId,
          status: `🎶 ${queue.currentSong.title}`.slice(0, 80)
        });
        await setVoiceChannelStatus(newState.channel, `🎶 ${queue.currentSong.title}`).catch(() => {});
      }
    }
    return;
  }

  // 3. Xử lý phòng trống (không còn người nghe)
  if (queue) {
    const activeVoice = typeof queue.getVoiceChannel === 'function' ? queue.getVoiceChannel() : queue.voiceChannel;
    if (activeVoice) {
      const humanCount = typeof queue.getHumanMemberCount === 'function' ? queue.getHumanMemberCount() : 1;
      const guildSettings = settingsManager.get(guild.id);

      if (humanCount === 0) {
        logAction('VOICE_STATE_UPDATE', {
          event: 'ROOM_EMPTY',
          guildId: guild.id,
          channelId: activeVoice.id,
          userId: newState.id
        });
        queue.startEmptyRoomTimer(guildSettings.emptyChannelTimeout || 60);
      } else {
        logAction('VOICE_STATE_UPDATE', {
          event: 'ROOM_NOT_EMPTY',
          guildId: guild.id,
          channelId: activeVoice.id,
          humanCount: humanCount,
          userId: newState.id
        });
        queue.clearEmptyRoomTimer();
        // Đánh thức luồng phát nhạc 24/7 khi có người bước vào phòng đang Sleep Mode (xử lý cả khi còn bài dở)
        if (queue.mode247 && !queue.currentSong && !queue._isPlayingNext) {
          queue.isQueueOnHold = false;
          if (queue.songs.length > 0) {
            queue.playNext().catch(() => {});
          } else {
            queue._play247BackgroundLofi().catch(() => {});
          }
        }
      }
    }
  }

  // 4. Log chi tiết hoạt động của User trong phòng Voice (Ai vào, ra, đổi phòng, stream, cam, mic)
  const member = newState.member || oldState.member;
  if (member && !member.user.bot) {
    const userTag = member.user.tag;
    const userId = member.user.id;
    const avatar = member.user.displayAvatarURL({ dynamic: true });

    // A. User tham gia phòng Voice
    if (!oldState.channelId && newState.channelId) {
      logAction('VOICE_USER_JOIN', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }
    // B. User rời khỏi phòng Voice
    else if (oldState.channelId && !newState.channelId) {
      logAction('VOICE_USER_LEAVE', {
        guildId: guild.id,
        channelId: oldState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }
    // C. User chuyển phòng Voice
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      logAction('VOICE_USER_MOVE', {
        guildId: guild.id,
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }

    // D. User bật/tắt chia sẻ màn hình (Stream)
    if (!oldState.streaming && newState.streaming) {
      logAction('VOICE_USER_STREAM', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        status: `Bắt đầu chia sẻ màn hình trong <#${newState.channelId}>`,
        avatar: avatar
      });
    } else if (oldState.streaming && !newState.streaming) {
      logAction('VOICE_USER_STREAM', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã dừng chia sẻ màn hình`,
        avatar: avatar
      });
    }

    // E. User bật/tắt Camera
    if (!oldState.selfVideo && newState.selfVideo) {
      logAction('VOICE_USER_VIDEO', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã bật Camera trong <#${newState.channelId}>`,
        avatar: avatar
      });
    } else if (oldState.selfVideo && !newState.selfVideo) {
      logAction('VOICE_USER_VIDEO', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã tắt Camera`,
        avatar: avatar
      });
    }

    // F. User Mute / Deafen
    if ((oldState.selfMute !== newState.selfMute || oldState.selfDeaf !== newState.selfDeaf) && (newState.channelId || oldState.channelId)) {
      const muteStatus = newState.selfMute ? 'Tắt Mic (Muted)' : 'Mở Mic (Unmuted)';
      const deafStatus = newState.selfDeaf ? 'Tắt Tai nghe (Deafened)' : 'Mở Tai nghe (Undeafened)';
      logAction('VOICE_USER_MUTE_DEAF', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `${muteStatus} • ${deafStatus}`,
        avatar: avatar
      });
    }
  }
}

module.exports = {
  name: 'voiceStateUpdate',
  execute: handleVoiceStateUpdate
};
