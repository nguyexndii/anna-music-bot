const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'lockvoice',
  aliases: ['lockvc', 'setvoice', 'khoavoice'],
  description: 'Khóa kênh đàm thoại cố định cho bot phát nhạc',
  async execute(message, args) {
    if (!message.guild) return;

    // Check manage guild or admin permission
    if (!message.member.permissions.has('ManageGuild') && !message.member.permissions.has('Administrator')) {
      return message.reply({ embeds: [createErrorEmbed('Bạn cần có quyền `Quản Lý Máy Chủ` hoặc `Quản Trị Viên` để khóa phòng Voice!')] });
    }

    if (args[0] && (args[0].toLowerCase() === 'reset' || args[0].toLowerCase() === 'off' || args[0].toLowerCase() === 'tat' || args[0].toLowerCase() === 'clear')) {
      settingsManager.update(message.guild.id, { lockedVoiceChannelId: null });
      return message.reply({ embeds: [createSuccessEmbed('Đã mở khóa phòng Voice! Bây giờ bot có thể tham gia bất kỳ phòng Voice nào theo yêu cầu.')] });
    }

    const channel = message.mentions.channels.first()
      || message.guild.channels.cache.get(args[0])
      || message.member?.voice?.channel;

    if (!channel || channel.type !== 2) { // 2 is GuildVoice
      return message.reply({ embeds: [createErrorEmbed('Vui lòng tham gia vào một phòng Voice hoặc tag phòng Voice hợp lệ (ví dụ: `.lockvoice #Chung-voice`)!')] });
    }

    settingsManager.update(message.guild.id, { lockedVoiceChannelId: channel.id });
    return message.reply({
      embeds: [createSuccessEmbed(`Đã khóa phòng Voice thành công! Kể từ bây giờ bot chỉ hoạt động cố định tại: **${channel.name}** (<#${channel.id}>).`)]
    });
  }
};
