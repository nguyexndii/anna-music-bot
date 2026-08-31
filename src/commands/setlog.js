const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'setlog',
  aliases: ['logchannel', 'kenhlog', 'setlogchannel', 'log'],
  description: 'Cài đặt kênh văn bản ghi toàn bộ nhật ký (log) hoạt động của bot',
  async execute(message, args) {
    if (!message.guild) return;

    // Kiểm tra quyền Quản trị viên
    const isOwner = message.guild.ownerId === message.author.id;
    const hasAdminPerm = message.member?.permissions.has('Administrator') || message.member?.permissions.has('ManageGuild');

    if (!isOwner && !hasAdminPerm) {
      return message.reply({
        embeds: [createErrorEmbed('Bạn cần quyền `Quản Trị Viên (Administrator)` hoặc `Quản Lý Máy Chủ` để cấu hình kênh nhật ký!')]
      });
    }

    if (!args[0]) {
      const current = settingsManager.get(message.guild.id);
      const logText = current.logChannelId ? `<#${current.logChannelId}> (🟢 Đang BẬT)` : '🔴 Đang TẮT';
      return message.reply({
        embeds: [createSuccessEmbed(`📋 **Kênh Nhật Ký Hoạt Động (Log Channel)**:\n• Trạng thái hiện tại: ${logText}\n\n*Cách sử dụng:*\n• \`.setlog #tên-kênh\` — Chọn kênh gửi nhật ký (ví dụ: \`.setlog #bot-logs\`)\n• \`.setlog off\` — Tắt kênh nhật ký`)]
      });
    }

    if (args[0].toLowerCase() === 'reset' || args[0].toLowerCase() === 'off' || args[0].toLowerCase() === 'clear' || args[0].toLowerCase() === 'tat') {
      settingsManager.update(message.guild.id, { logChannelId: null });
      return message.reply({ embeds: [createSuccessEmbed('🔴 Đã TẮT kênh ghi nhật ký hoạt động của bot.')] });
    }

    const rawInput = args[0].replace(/^[<#]+|>+$/g, '').trim();
    let channel = message.mentions.channels.first()
      || message.guild.channels.cache.get(rawInput)
      || message.guild.channels.cache.find(c => c.name.toLowerCase() === rawInput.toLowerCase());

    if (!channel && /^\d+$/.test(rawInput)) {
      channel = await message.guild.channels.fetch(rawInput).catch(() => null);
    }

    if (!channel || !channel.isTextBased()) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng cung cấp ID kênh, tag kênh hoặc tên kênh văn bản hợp lệ (ví dụ: `.setlog 123456789...` hoặc `.setlog #kenh-log` hoặc `.setlog off`)!')] });
    }

    // Kiểm tra quyền bot gửi tin nhắn vào kênh log
    const botMember = message.guild.members.me;
    if (botMember && !channel.permissionsFor(botMember)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      return message.reply({ embeds: [createErrorEmbed(`Bot không có đủ quyền (Xem kênh, Gửi tin nhắn, Chèn liên kết) trong kênh <#${channel.id}>!`)] });
    }

    settingsManager.update(message.guild.id, { logChannelId: channel.id });
    return message.reply({
      embeds: [createSuccessEmbed(`✅ Đã thiết lập kênh ghi nhật ký thành công: <#${channel.id}>!\nKể từ bây giờ, mọi hoạt động của bot (sửa/xóa tin nhắn, lệnh nhạc, web player, voice...) sẽ được ghi nhận vào kênh này.`)]
    });
  }
};
