const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, EMOJI_TAG } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'shuffle',
  aliases: ['sh', 'xaotron', 'mix'],
  description: 'Randomly shuffle songs in the queue',
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Randomly shuffle songs in the queue')
    .setDescriptionLocalizations({
      vi: 'Xáo trộn ngẫu nhiên thứ tự các bài hát trong hàng chờ'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để xáo trộn hàng chờ.`);
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!');
    }

    const queue = musicManager.get(ctx.guild.id);
    if (queue?.currentSong?.is247 || queue?.currentSong?.requestedBy === 'Auto (24/7)' || (queue?.mode247 && !queue?.currentSong)) {
      return ctx.reply({ embeds: [createErrorEmbed('♾️ Bot đang phát Đài Radio Lofi 24/7 tự động. Bạn không thể dừng/tua/bỏ qua đài Radio, hãy dùng lệnh /play <tên bài> để phát nhạc của bạn nhé!')] });
    }

    if (!queue || queue.songs.length < 2) {
      return ctx.reply({ embeds: [createErrorEmbed('Cần ít nhất 2 bài hát trong hàng chờ để xáo trộn!')] });
    }

    queue.shuffle();

    return ctx.reply({
      embeds: [createSuccessEmbed(`${EMOJI_TAG.arrow} Đã xáo trộn ngẫu nhiên **${queue.songs.length} bài hát** trong hàng chờ!`)]
    });
  }
};
