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
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để dừng nhạc.`);
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue) {
      return ctx.reply('Bot hiện không phát nhạc trong máy chủ này!');
    }

    const memberVoice = ctx.member?.voice?.channel;
    if (!memberVoice) {
      return ctx.reply('Bạn cần tham gia vào phòng Voice để dừng nhạc!');
    }

    queue.stop();
    const modeText = queue.mode247 ? ' (Bot vẫn duy trì trong voice vì đang bật chế độ 24/7)' : '';
    return ctx.reply(`⏹️ Đã dừng phát nhạc và xóa toàn bộ hàng chờ.${modeText}`);
  }
};
