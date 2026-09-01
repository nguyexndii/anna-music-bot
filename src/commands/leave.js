const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'leave',
  aliases: ['dc', 'dis', 'disconnect', 'out', 'roi'],
  description: 'Disconnect bot from current voice channel',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect bot from current voice channel')
    .setDescriptionLocalizations({
      vi: 'Yêu cầu bot rời khỏi kênh Voice'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildSettings = settingsManager.get(ctx.guild.id);
    const queue = musicManager.get(ctx.guild.id);

    // BẢO VỆ CHẾ ĐỘ 24/7
    const is247 = queue ? queue.mode247 : Boolean(guildSettings.mode247);
    if (is247) {
      const isAdmin = ctx.member.permissions.has('Administrator') || 
                      ctx.member.permissions.has('ManageGuild') || 
                      ctx.guild.ownerId === ctx.user.id;
      if (!isAdmin) {
        return ctx.reply('⚠️ Máy chủ đang bật chế độ 24/7. Chỉ Quản trị viên mới có thể yêu cầu bot rời phòng!');
      }
    }

    if (!hasMusicPermission(ctx.member)) {
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Cần vai trò ${roleText} để mời bot rời phòng.`);
    }

    if (!queue) {
      return ctx.reply('Bot hiện không ở trong phòng Voice nào!');
    }

    const memberVoice = ctx.member?.voice?.channel;
    if (!memberVoice) {
      return ctx.reply('Bạn cần vào phòng Voice trước!');
    }

    // Nếu Admin đồng ý rời phòng, tắt 24/7
    if (queue.mode247) {
      queue.mode247 = false;
      settingsManager.update(ctx.guild.id, { mode247: false });
    }

    queue.destroy();
    return ctx.reply('👋 Đã ngắt kết nối và rời phòng Voice.');
  }
};
