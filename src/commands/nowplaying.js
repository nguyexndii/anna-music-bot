const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createNowPlayingEmbed, createMusicControls, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'nowplaying',
  aliases: ['np', 'control', 'c', 'panel', 'dieukhien'],
  description: 'View now playing song details and interactive controls',
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('View now playing song details and interactive controls')
    .setDescriptionLocalizations({
      vi: 'Xem thông tin chi tiết bài hát đang phát và bảng điều khiển'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Hiện không có bài hát nào đang phát!');
    }

    // Xóa tin nhắn cũ nếu có để tránh trôi và trùng lặp
    if (queue.nowPlayingMessage) {
      queue.nowPlayingMessage.delete().catch(() => {});
      queue.nowPlayingMessage = null;
    }

    const embed = createNowPlayingEmbed(queue.currentSong, queue);
    const controls = createMusicControls(queue);

    if (ctx.isInteraction) {
      return ctx.reply({ embeds: [embed], components: controls });
    } else {
      const msg = await ctx.channel.send({ embeds: [embed], components: controls });
      queue.nowPlayingMessage = msg;
      ctx.message?.delete().catch(() => {});
    }
  }
};
