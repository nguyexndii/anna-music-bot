const { SlashCommandBuilder, ComponentType } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const {
  createQueueEmbed,
  createQueuePaginationButtons,
  createQueueDeleteSelectMenu,
  createErrorEmbed
} = require('../utils/embed');
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

    const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(userSongs.length / pageSize));
    let currentPage = Math.min(Math.max(1, ctx.options.getInteger('page') || 1), totalPages);

    const buildComponents = (p) => {
      const rows = [];
      if (totalPages > 1) {
        rows.push(createQueuePaginationButtons(p, totalPages));
      }
      const deleteMenu = createQueueDeleteSelectMenu(queue, p);
      if (deleteMenu) rows.push(deleteMenu);
      return rows;
    };

    const embed = createQueueEmbed(queue, currentPage);
    const replyMsg = await ctx.reply({ embeds: [embed], components: buildComponents(currentPage) });

    if (totalPages > 1 && replyMsg) {
      const collector = replyMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== ctx.user.id) {
          return i.reply({ content: 'Chỉ người gõ lệnh mới có thể chuyển trang!', flags: 64 });
        }

        if (i.customId.startsWith('queue_page_')) {
          currentPage = parseInt(i.customId.replace('queue_page_', ''), 10) || 1;
        } else if (i.customId === 'queue_prev') {
          currentPage = Math.max(1, currentPage - 1);
        } else if (i.customId === 'queue_next') {
          currentPage = Math.min(totalPages, currentPage + 1);
        }

        const newEmbed = createQueueEmbed(queue, currentPage);
        await i.update({ embeds: [newEmbed], components: buildComponents(currentPage) }).catch(() => {});
      });

      collector.on('end', async () => {
        const disabledRows = buildComponents(currentPage).map(row => {
          row.components.forEach(c => {
            if (c.data.type === ComponentType.Button) c.setDisabled(true);
          });
          return row;
        });
        await replyMsg.edit({ components: disabledRows }).catch(() => {});
      });
    }
  }
};
