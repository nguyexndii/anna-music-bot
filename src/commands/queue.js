const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createQueueEmbed, createQueueDeleteSelectMenu, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'queue',
  aliases: ['q', 'list', 'hangcho'],
  description: 'View current music queue',
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View current music queue')
    .setDescriptionLocalizations({
      vi: 'Xem danh sách bài hát trong hàng chờ'
    })
    .addIntegerOption(opt =>
      opt
        .setName('page')
        .setDescription('Page number to view')
        .setDescriptionLocalizations({
          vi: 'Số trang cần xem'
        })
        .setMinValue(1)
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
      return ctx.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')] });
    }

    const page = ctx.options.getInteger('page') || 1;
    const embed = createQueueEmbed(queue, page);
    const deleteMenu = createQueueDeleteSelectMenu(queue);

    const components = deleteMenu ? [deleteMenu] : [];
    return ctx.reply({ embeds: [embed], components });
  }
};
