const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed } = require('../utils/embed');

module.exports = {
  name: 'autoplay',
  aliases: ['ap', 'auto'],
  description: 'Bật/Tắt chế độ tự động tìm và phát bài hát tương tự khi hết nhạc',
  async execute(message) {
    if (!message.guild) return;

    const current = settingsManager.get(message.guild.id);
    const newVal = !current.autoplay;
    settingsManager.update(message.guild.id, { autoplay: newVal });

    const statusText = newVal ? '🟢 BẬT (Tự động phát bài tương tự khi hết hàng chờ)' : '🔴 TẮT (Dừng lại khi phát hết nhạc)';
    return message.reply({ embeds: [createSuccessEmbed(`Chế độ Tự động phát (Autoplay): **${statusText}**`)] });
  }
};
