const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, EMOJI_TAG } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');

module.exports = {
  name: 'shuffle',
  aliases: ['sh', 'xaotron', 'mix'],
  description: 'Xáo trộn ngẫu nhiên thứ tự các bài hát trong hàng chờ',
  async execute(message) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để xáo trộn hàng chờ.`);
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue || queue.songs.length < 2) {
      return message.reply({ embeds: [createErrorEmbed('Cần ít nhất 2 bài hát trong hàng chờ để xáo trộn!')] });
    }

    // Fisher-Yates Shuffle Algorithm
    for (let i = queue.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }

    return message.reply({
      embeds: [createSuccessEmbed(`${EMOJI_TAG.arrow} Đã xáo trộn ngẫu nhiên **${queue.songs.length} bài hát** trong hàng chờ!`)]
    });
  }
};
