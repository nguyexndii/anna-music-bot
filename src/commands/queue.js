const { SlashCommandBuilder, ComponentType } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const {
  createQueueContainer,
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
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
      return ctx.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')], flags: 64 });
    }

    const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(userSongs.length / pageSize));
    let currentPage = Math.min(Math.max(1, ctx.options.getInteger('page') || 1), totalPages);

    const queueContainer = createQueueContainer(queue, currentPage);
    const replyFlags = 32768 | (ctx.isInteraction ? 64 : 0);
    const replyMsg = await ctx.reply({ components: [queueContainer], flags: replyFlags });

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

        const newContainer = createQueueContainer(queue, currentPage);
        await i.update({ components: [newContainer] }).catch(() => {});
      });

      collector.on('end', async () => {
        const endContainer = createQueueContainer(queue, currentPage);
        if (endContainer && endContainer.components) {
          endContainer.components.forEach(comp => {
            if (comp.type === 1 && Array.isArray(comp.components)) {
              comp.components.forEach(c => {
                if (c.type === 2) c.disabled = true;
              });
            }
          });
        }
        await replyMsg.edit({ components: [endContainer] }).catch(() => {});
      });
    }
  }
};
