const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'stop',
  aliases: ['st', 'off'],
  description: 'Stop music playback and clear queue',
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music playback and clear queue')
    .setDescriptionLocalizations({
      vi: 'Dừng phát nhạc và xóa toàn bộ hàng chờ'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildSettings = settingsManager.get(ctx.guild.id);
    const queue = musicManager.get(ctx.guild.id);
    const isAdmin = Boolean(
      ctx.member?.permissions?.has('Administrator') ||
      ctx.member?.permissions?.has('ManageGuild') ||
      ctx.guild.ownerId === ctx.user.id
    );
    const is247 = queue ? queue.mode247 : Boolean(guildSettings.mode247);
    if (is247 && !isAdmin) {
      return ctx.reply(`${EMOJI_TAG.warning} Máy chủ đang bật chế độ 24/7. Chỉ Quản trị viên mới có thể dừng nhạc!`);
    }
    if (!hasMusicPermission(ctx.member)) {
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để dừng nhạc.`);
    }

    if (!queue) {
      return ctx.reply('Bot hiện không phát nhạc trong máy chủ này!');
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!');
    }
    if (!memberVoice) {
      return ctx.reply('Bạn cần tham gia vào phòng Voice để dừng nhạc!');
    }

    queue.stop();
    const modeText = queue.mode247 ? ' (Bot vẫn duy trì trong voice vì đang bật chế độ 24/7)' : '';
    return ctx.reply(`⏹️ Đã dừng phát nhạc và xóa toàn bộ hàng chờ.${modeText}`);
  }
};
