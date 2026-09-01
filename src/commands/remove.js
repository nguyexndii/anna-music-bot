const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'remove',
  aliases: ['xoa', 'rm', 'delete'],
  description: 'Remove a song from the queue by its position number',
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue by its position number')
    .setDescriptionLocalizations({
      vi: 'Xóa một bài hát ra khỏi hàng chờ theo số thứ tự'
    })
    .addIntegerOption(opt =>
      opt
        .setName('position')
        .setDescription('Track position number to remove (starting from 1)')
        .setDescriptionLocalizations({
          vi: 'Vị trí bài hát cần xóa (từ 1 đến tổng số bài)'
        })
        .setMinValue(1)
        .setRequired(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để xóa bài hát.`);
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue || queue.songs.length === 0) {
      return ctx.reply('Hàng chờ hiện đang trống, không có bài hát nào để xóa!');
    }

    const pos = ctx.options.getInteger('position');
    const index = pos !== null ? pos : parseInt(args[0], 10);
    if (isNaN(index) || index < 1 || index > queue.songs.length) {
      return ctx.reply(`Số thứ tự không hợp lệ! Vui lòng chọn từ 1 đến ${queue.songs.length}.`);
    }

    const removed = queue.songs.splice(index - 1, 1)[0];
    return ctx.reply(`Đã xóa thành công bài hát số ${index}: **${removed.title}** khỏi hàng chờ.`);
  }
};
