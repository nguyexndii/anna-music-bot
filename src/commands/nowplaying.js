const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createNowPlayingCard, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

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
    const is247Active = Boolean(queue?.mode247 || (queue?.currentSong && (queue.currentSong.requestedBy === 'Auto (24/7)' || queue.currentSong.is247)));
    if (!queue || (!queue.currentSong && !is247Active)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(ctx.guild.id, 'common.no_song_playing'))], flags: 64 });
    }

    // Xóa tin nhắn cũ nếu có để tránh trôi và trùng lặp
    if (queue.nowPlayingMessage) {
      queue.nowPlayingMessage.delete().catch(() => {});
      queue.nowPlayingMessage = null;
    }

    const songForEmbed = queue.currentSong || { requestedBy: 'Auto (24/7)', title: t(ctx.guild.id, 'player.radio_card_title'), is247: true };
    const payload = createNowPlayingCard(songForEmbed, queue);

    if (ctx.isInteraction) {
      const replyMsg = await ctx.reply({ ...payload, flags: 32768, fetchReply: true });
      queue.nowPlayingMessage = replyMsg;
      return replyMsg;
    } else {
      const msg = await ctx.channel.send({ ...payload, flags: 32768 });
      queue.nowPlayingMessage = msg;
      ctx.message?.delete().catch(() => {});
      return msg;
    }
  }
};
