const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const historyManager = require('../structures/HistoryManager');
const settingsManager = require('../structures/SettingsManager');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');
const config = require('../config');

module.exports = {
  name: 'top',
  aliases: ['leaderboard', 'bxh', 'ranking', 'thinhhanh'],
  description: 'View the most played songs and server leaderboard',
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('View the most played songs and server leaderboard')
    .setDescriptionLocalizations({
      vi: 'Xem bảng xếp hạng các bài hát được nghe nhiều nhất trong máy chủ'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;
    const topTracks = historyManager.getTopTracks(guildId, 10) || [];

    if (topTracks.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor('#2B2D31')
        .setTitle('Bảng Xếp Hạng - Thịnh Hành Trong Máy Chủ')
        .setDescription('Chưa có bài hát nào được ghi nhận lượt nghe trong máy chủ này. Hãy bắt đầu phát nhạc để tạo bảng xếp hạng!');
      return ctx.reply({ embeds: [emptyEmbed], flags: 64 });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = topTracks.map((track, idx) => {
      const rankBadge = idx < 3 ? medals[idx] : `\`#${idx + 1}\``;
      const playCountText = `**${track.playCount || 1}** lượt nghe`;
      const title = (track.title || 'Bài hát không tên').slice(0, 55);
      const artist = track.artist && track.artist !== 'Unknown' ? ` - *${track.artist}*` : '';
      return `${rankBadge} **${title}**${artist}\n└ 🎧 ${playCountText} | \`${track.duration || '0:00'}\``;
    });

    const webUrl = `${config.webUrl || 'https://anna-music-bot-ui.pages.dev'}?guild=${guildId}`;
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`Bảng Xếp Hạng Âm Nhạc - ${ctx.guild.name}`)
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: 'Dữ liệu được cập nhật tự động khi bài hát được nghe trên 25 giây' })
      .setTimestamp();

    if (topTracks[0]?.thumbnail) {
      embed.setThumbnail(topTracks[0].thumbnail);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Mở Bảng Xếp Hạng Trên Web')
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl)
    );

    return ctx.reply({ embeds: [embed], components: [row] });
  }
};
