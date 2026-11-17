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
      if (queue._manualLeave || !queue.mode247) {
        queue.destroy();
      } else if (queue.mode247 && !queue.isDestroyed && !queue._manualLeave) {
        // Watchdog: Nếu đang ở chế độ 24/7 mà bot bị ngắt ra khỏi phòng, tự vào lại sau 1.5s
        setTimeout(async () => {
          if (queue.mode247 && !queue.isDestroyed && !queue._manualLeave) {
            const me = guild.members.me;
            if (!me?.voice?.channelId && queue.voiceChannel) {
              console.log(`[24/7 Voice Watchdog] Bot không có trong phòng tại ${guild.name}, tự động kết nối lại...`);
              try {
                await queue.connect();
              } catch (e) {
                console.warn('[24/7 Voice Watchdog Reconnect Failed]:', e.message);
              }
            }
          }
        }, 1500);
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
