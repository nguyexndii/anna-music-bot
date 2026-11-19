const { Events, ActivityType } = require('discord.js');
const config = require('../config');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const sessionManager = require('../structures/SessionManager');
const { connectDatabase } = require('../database/mongoose');
const { setVoiceChannelStatus } = require('../utils/embed');
const { logAction } = require('../utils/debugLogger');

function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Xử lý sự kiện khi Bot sẵn sàng
 * @param {import('discord.js').Client} client
 */
async function handleReady(client) {
  console.log(`🚀 [Discord Bot Ready] Đăng nhập thành công: ${client.user.tag}`);
  logAction('SET_ACTIVITY', {
    type: 'Listening',
    text: 'o_O 🫵 | /help'
  });
  client.user.setActivity('ò_Ó 🫵 | /help', { type: ActivityType.Listening });
  await connectDatabase();

  // Quét và tự động rời khỏi các máy chủ không còn nằm trong danh sách Whitelist
  if (config.allowedGuildIds && config.allowedGuildIds.length > 0) {
    for (const [gId, g] of client.guilds.cache) {
      if (!config.allowedGuildIds.includes(gId)) {
        console.warn(`[Startup Whitelist Scan] Rời khỏi máy chủ không được phép: ${g.name} (${gId})`);
        g.leave().catch(() => {});
      }
    }
  }

  // Đăng ký Slash Commands tự động lên Discord REST API (Chạy ngầm không chặn luồng khởi động bot)
  try {
    const { deploySlashCommands } = require('../deploy-commands');
    deploySlashCommands(client).catch(deployErr => {
      console.warn('[Auto-Deploy Slash Commands Error]:', deployErr.message);
    });
  } catch (deployErr) {
    console.warn('[Auto-Deploy Slash Commands Error]:', deployErr.message);
  }

  // 🔄 Đồng bộ cấu hình cài đặt từ MongoDB và khôi phục kết nối các phòng Voice
  try {
    await settingsManager.syncFromDatabase().catch(() => {});
    await sessionManager.syncFromDatabase();
    const activeSessions = sessionManager.getAllActiveSessions();
    for (const session of activeSessions) {
      // Bỏ qua khôi phục phiên nếu máy chủ không nằm trong Whitelist
      if (config.allowedGuildIds && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(session.guildId)) {
        continue;
      }
      // Giãn cách 2.5s giữa mỗi máy chủ để chống nghẽn CPU và quá tải Voice Gateway
      await new Promise(r => setTimeout(r, 2500));
      try {
        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) continue;
        const guildSettings = settingsManager.get(guild.id);
        const targetVoiceId = guildSettings?.lockedVoiceChannelId || session.voiceChannelId;
        const voiceChannel = guild.channels.cache.get(targetVoiceId);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) continue;
        const textChannel = session.textChannelId ? guild.channels.cache.get(session.textChannelId) : null;

        console.log(`[Auto-Recovery] Đang tự động kết nối lại phòng: ${voiceChannel.name} tại máy chủ ${guild.name}...`);
        const q = musicManager.getOrCreate(guild, textChannel, voiceChannel);
        await q.connect();

        if (session.mode247) {
          const lang = settingsManager.get(guild.id)?.language;
          const statusText = lang === 'en' ? '♾️ 24/7 Lofi Mode' : '♾️ 24/7 Lofi Radio';
          logAction('VOICE_STATUS_UPDATE', {
            source: 'ready.js/24x7-recovery',
            channelId: voiceChannel.id,
            status: statusText
          });
          setVoiceChannelStatus(voiceChannel, statusText);
        }

        // Khôi phục bài hát đang nghe dở và danh sách hàng chờ nếu có
        const savedSongs = Array.isArray(session.songs) ? session.songs.filter(Boolean) : [];
        const savedCurrent = session.currentSong || null;
        if (savedCurrent || savedSongs.length > 0) {
          console.log(`[Auto-Recovery] Khôi phục hàng chờ (${savedSongs.length} bài) cho máy chủ ${guild.name}`);
          q.songs = [...savedSongs];
          if (savedCurrent) {
            const isLofi = Boolean(savedCurrent.is247 || savedCurrent.requestedBy === 'Auto (24/7)');
            const positionSec = Number(session.position) || 0;
            const durSec = savedCurrent.duration ? parseDurationToSeconds(savedCurrent.duration) : 0;
            if (!isLofi && positionSec > 5 && (!durSec || positionSec < durSec - 5)) {
              console.log(`[Auto-Recovery] Phục hồi vị trí phát tiếp ở giây thứ ${positionSec}s cho bài "${savedCurrent.title}"`);
              savedCurrent.initialSeekSeconds = positionSec;
            }
            q.songs.unshift(savedCurrent);
          }
          await q.playNext();
          q.enrichMissingThumbnails?.().catch(() => {});
        } else if (session.mode247) {
          await q._play247BackgroundLofi();
        }
      } catch (recErr) {
        console.warn(`[Auto-Recovery Error for Guild ${session.guildId}]:`, recErr.message);
      }
    }
  } catch (syncErr) {
    console.warn('[Session Sync Error]:', syncErr.message);
  }

  // 🧹 Định kỳ dọn dẹp bộ nhớ RAM và giám sát tiến trình mỗi 5 phút
  setInterval(() => {
    try {
      if (global.gc) {
        let anyPlaying = false;
        if (musicManager && musicManager.queues) {
          for (const q of musicManager.queues.values()) {
            if (q && q.isPlaying) {
              anyPlaying = true;
              break;
            }
          }
        }
        if (!anyPlaying) {
          global.gc();
        }
      }
      const mem = process.memoryUsage();
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      console.log(`[Memory Monitor] RAM Sử dụng: RSS=${rssMB}MB | HeapUsed=${heapMB}MB`);
    } catch (e) {}
  }, 5 * 60 * 1000);

  console.log('✨ Anna Music Bot đã sẵn sàng nhận lệnh 24/7!');
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute: handleReady
};
