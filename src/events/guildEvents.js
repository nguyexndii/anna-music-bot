const { Events } = require('discord.js');
const config = require('../config');
const musicManager = require('../structures/MusicManager');
const { clearVoiceChannelStatus } = require('../utils/embed');

/**
 * Helper kiểm tra danh sách máy chủ được phép (Private / Whitelist Multi-Guild)
 * @param {string} guildId
 * @param {string} [userId]
 * @returns {boolean}
 */
function isAllowedGuild(guildId, userId) {
  if (!config.allowedGuildIds || config.allowedGuildIds.length === 0) return true;
  if (config.allowedGuildIds.includes(guildId)) return true;
  if (userId && String(userId) === String(config.adminId)) return true;
  return false;
}

/**
 * Xử lý khi Bot bị kick/rời khỏi Server
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 */
async function handleGuildDelete(client, guild) {
  const queue = musicManager.get(guild.id);
  if (queue) {
    if (queue.voiceChannel) {
      await clearVoiceChannelStatus(queue.voiceChannel).catch(() => {});
    }
    queue.destroy();
  }
}

/**
 * Tự động kiểm tra và rời máy chủ nếu không nằm trong Whitelist & Đăng ký Slash Commands cho server mới
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 */
async function handleGuildCreate(client, guild) {
  if (config.allowedGuildIds && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(guild.id)) {
    console.warn(`[Whitelist] Máy chủ "${guild.name}" (${guild.id}) không nằm trong danh sách được phép. Đang tự rời khỏi...`);
    try {
      await guild.leave();
    } catch (e) {
      console.warn(`[Whitelist] Không thể rời máy chủ ${guild.id}:`, e.message);
    }
    return;
  }

  // Tự động đồng bộ ngay lập tức toàn bộ Slash Commands cho máy chủ mới vừa tham gia
  try {
    const { deploySlashCommands } = require('../deploy-commands');
    await deploySlashCommands(client, guild.id);
    console.log(`✅ [Guild Join] Đã triển khai thành công Slash Commands cho máy chủ: ${guild.name} (${guild.id})`);
  } catch (deployErr) {
    console.warn(`[Guild Join Deploy Error]:`, deployErr.message);
  }
}

const events = [
  {
    name: 'guildDelete',
    execute: handleGuildDelete
  },
  {
    name: Events.GuildCreate,
    execute: handleGuildCreate
  }
];

events.isAllowedGuild = isAllowedGuild;
module.exports = events;
