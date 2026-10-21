const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'move',
  aliases: ['mv', 'jump'],
  description: 'Move a song to a different position in the queue',
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a song to a different position in the queue')
    .setDescriptionLocalizations({
      vi: 'Di chuyển vị trí bài hát trong hàng chờ'
    })
    .addIntegerOption(opt =>
      opt
        .setName('from')
        .setDescription('Current position of the song (e.g. 5)')
        .setDescriptionLocalizations({
          vi: 'Vị trí hiện tại của bài hát trong hàng chờ (ví dụ: 5)'
        })
        .setMinValue(1)
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('to')
        .setDescription('New position to move the song to (default: 1)')
        .setDescriptionLocalizations({
          vi: 'Vị trí mới muốn chuyển đến (mặc định: 1 - phát kế tiếp)'
        })
        .setMinValue(1)
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply({
        embeds: [createErrorEmbed(`Bạn cần có vai trò ${roleText} để di chuyển thứ tự bài hát.`)],
        flags: 64
      });
    }

    const queue = musicManager.get(ctx.guild.id);

    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')] });
    }
    const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
    if (userSongs.length === 0) {
      return ctx.reply({ embeds: [createErrorEmbed('Hàng chờ hiện đang trống, không có bài hát nào của người dùng để di chuyển!')] });
    }

    if (!ctx.member?.voice?.channel || (queue.voiceChannel && ctx.member.voice.channel.id !== queue.voiceChannel.id)) {
      return ctx.reply({
        embeds: [createErrorEmbed('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!')],
        flags: 64
      });
    }

    const fromPos = ctx.options.getInteger('from');
    const toPos = ctx.options.getInteger('to') || 1;

    if (!fromPos || fromPos < 1 || fromPos > userSongs.length) {
      return ctx.reply({
        embeds: [createErrorEmbed(`Vị trí bài hát không hợp lệ! Hàng chờ hiện có từ 1 đến ${userSongs.length} bài.`)],
        flags: 64
      });
    }

    if (toPos < 1 || toPos > userSongs.length) {
      return ctx.reply({
        embeds: [createErrorEmbed(`Vị trí đích không hợp lệ! Vui lòng chọn trong khoảng từ 1 đến ${userSongs.length}.`)],
        flags: 64
      });
    }

    if (fromPos === toPos) {
      return ctx.reply({
        embeds: [createErrorEmbed('Bài hát đã nằm ở vị trí này rồi!')],
        flags: 64
      });
    }

    const targetSong = userSongs[fromPos - 1];
    const destSong = userSongs[toPos - 1];
    const actualFrom = queue.songs.indexOf(targetSong);
    const actualTo = queue.songs.indexOf(destSong);
    if (actualFrom === -1 || actualTo === -1) {
      return ctx.reply({ embeds: [createErrorEmbed('Không tìm thấy bài hát tương ứng trong hàng chờ!')], flags: 64 });
    }
    const ok = queue.moveTrack(actualFrom, actualTo);

    if (ok) {
      return ctx.reply({
        embeds: [createSuccessEmbed(`Đã chuyển bài **${targetSong.title}** từ vị trí **#${fromPos}** sang vị trí **#${toPos}**!`)]
      });
    } else {
      return ctx.reply({
        embeds: [createErrorEmbed('Không thể di chuyển bài hát. Vui lòng thử lại!')],
        flags: 64
      });
    }
  }
};
