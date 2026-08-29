const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createEmbed } = require('../utils/embed');

module.exports = {
  name: 'setchannel',
  aliases: ['channel', 'lockchannel', 'kenhnhac'],
  description: 'Cài đặt kênh văn bản duy nhất được phép dùng lệnh phát nhạc',
  async execute(message, args) {
    if (!message.guild) return;

    if (args[0] && (args[0].toLowerCase() === 'reset' || args[0].toLowerCase() === 'off' || args[0].toLowerCase() === 'clear')) {
      settingsManager.update(message.guild.id, { musicChannelId: null });
      return message.reply({ embeds: [createSuccessEmbed('Đã bỏ khóa kênh! Bây giờ bạn có thể dùng lệnh bot ở mọi kênh chat.')] });
    }

    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]) || message.channel;

    if (!channel || !channel.isTextBased()) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng tag hoặc chọn một kênh văn bản hợp lệ (ví dụ: `.setchannel #kenh-nhac`)!')] });
    }

    settingsManager.update(message.guild.id, { musicChannelId: channel.id });
    return message.reply({
      embeds: [createSuccessEmbed(`Đã khóa kênh âm nhạc thành công! Kể từ bây giờ bot chỉ nhận lệnh tại: <#${channel.id}>.\n*(Nếu gõ ở kênh khác, bot sẽ tự xóa tin nhắn và gửi cảnh báo tự hủy)*`)]
    });
  }
};
