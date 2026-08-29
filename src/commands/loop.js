const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'loop',
  aliases: ['l', 'repeat'],
  description: 'Bật/tắt lặp lại bài hát hoặc hàng chờ',
  async execute(message) {
    const queue = musicManager.get(message.guild.id);
    if (!queue) {
      return message.reply({ embeds: [createErrorEmbed('Bot hiện không ở trong kênh Voice!')] });
    }

    const mode = queue.toggleLoop();
    const modeText = mode === 'song' ? '🔂 Bài hát hiện tại' : mode === 'queue' ? '🔁 Toàn bộ hàng chờ' : '➡️ Tắt';
    return message.reply({ embeds: [createSuccessEmbed(`Đã thay đổi chế độ lặp: **${modeText}**`)] });
  }
};
