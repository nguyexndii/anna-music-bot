const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'volume',
  aliases: ['vol', 'v'],
  description: 'Chỉnh âm lượng phát nhạc (1 - 100)',
  async execute(message, args) {
    const queue = musicManager.get(message.guild.id);
    if (!queue) {
      return message.reply({ embeds: [createErrorEmbed('Bot hiện không ở trong kênh Voice!')] });
    }

    if (!args[0]) {
      return message.reply({ embeds: [createSuccessEmbed(`🔊 Âm lượng hiện tại: **${queue.volume}%**`)] });
    }

    const vol = parseInt(args[0], 10);
    if (isNaN(vol) || vol < 1 || vol > 100) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng nhập âm lượng hợp lệ từ 1 đến 100!')] });
    }

    queue.setVolume(vol);
    return message.reply({ embeds: [createSuccessEmbed(`🔊 Đã chỉnh âm lượng thành **${vol}%**`)] });
  }
};
