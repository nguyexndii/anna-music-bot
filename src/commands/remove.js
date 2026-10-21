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
          vi: 'Số thứ tự bài hát trong hàng chờ cần xóa (ví dụ: 1, 2, 3...)'
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

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!');
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue) {
      return ctx.reply('Hàng chờ hiện đang trống, không có bài hát nào để xóa!');
    }
    const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
    if (userSongs.length === 0) {
      return ctx.reply('Hàng chờ hiện đang trống, không có bài hát nào của người dùng để xóa!');
    }

    const pos = ctx.options.getInteger('position');
    const index = pos !== null ? pos : parseInt(args[0], 10);
    if (isNaN(index) || index < 1 || index > userSongs.length) {
      return ctx.reply(`Số thứ tự không hợp lệ! Vui lòng chọn từ 1 đến ${userSongs.length}.`);
    }

    const targetSong = userSongs[index - 1];
    const actualIndex = queue.songs.indexOf(targetSong);
    if (actualIndex === -1) {
      return ctx.reply('Không tìm thấy bài hát tương ứng trong hàng chờ!');
    }
    const removed = queue.songs.splice(actualIndex, 1)[0];
    queue._saveSessionState?.();
    queue.refreshNowPlayingCard?.();
    return ctx.reply(`Đã xóa thành công bài hát số ${index}: **${removed.title}** khỏi hàng chờ.`);
  }
};
