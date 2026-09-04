const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
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
    const queue = musicManager.get(ctx.guild.id);

    if (!queue || queue.songs.length === 0) {
      return ctx.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')] });
    }

    const fromPos = ctx.options.getInteger('from');
    const toPos = ctx.options.getInteger('to') || 1;

    if (!fromPos || fromPos < 1 || fromPos > queue.songs.length) {
      return ctx.reply({
        embeds: [createErrorEmbed(`Vị trí bài hát không hợp lệ! Hàng chờ hiện có từ 1 đến ${queue.songs.length} bài.`)],
        flags: 64
      });
    }

    if (toPos < 1 || toPos > queue.songs.length) {
      return ctx.reply({
        embeds: [createErrorEmbed(`Vị trí đích không hợp lệ! Vui lòng chọn trong khoảng từ 1 đến ${queue.songs.length}.`)],
        flags: 64
      });
    }

    if (fromPos === toPos) {
      return ctx.reply({
        embeds: [createErrorEmbed('Bài hát đã nằm ở vị trí này rồi!')],
        flags: 64
      });
    }

    const targetSong = queue.songs[fromPos - 1];
    const ok = queue.moveTrack(fromPos - 1, toPos - 1);

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
