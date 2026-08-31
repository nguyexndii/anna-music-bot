const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'crossfade',
  aliases: ['fade', 'hoam'],
  description: 'Cài đặt thời gian hòa âm chuyển bài mượt mà (Fade-in - Chỉ Quản trị viên)',
  async execute(message, args) {
    if (!message.guild) return;

    // Chỉ Admin máy chủ mới được phép cấu hình Crossfade
    const isOwner = message.guild.ownerId === message.author.id;
    const hasAdminPerm = message.member?.permissions.has('Administrator') || message.member?.permissions.has('ManageGuild');
    if (!isOwner && !hasAdminPerm) {
      return message.reply({
        embeds: [createErrorEmbed('Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên (Administrator / Manage Server)** mới có quyền thay đổi Cài đặt Hòa âm (Crossfade)!')]
      });
    }

    if (!args[0]) {
      const current = settingsManager.get(message.guild.id);
      return message.reply({
        embeds: [createSuccessEmbed(`Thời gian hòa âm chuyển bài (Crossfade) hiện tại: **${current.crossfadeDuration} giây**\n\n*Cách đổi:* \`.crossfade <0-10>\` (0 = tắt hòa âm)`)]
      });
    }

    const seconds = parseInt(args[0], 10);
    if (isNaN(seconds) || seconds < 0 || seconds > 10) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng nhập số giây hợp lệ từ 0 đến 10 giây (ví dụ: `.crossfade 3` hoặc `.crossfade 0` để tắt)!')] });
    }

    settingsManager.update(message.guild.id, { crossfadeDuration: seconds });
    const text = seconds > 0
      ? `Đã cài đặt thời gian hòa âm chuyển bài: **${seconds} giây** (Các bài hát sẽ vào êm dịu, không bị giật/ngắt quãng)`
      : 'Đã **TẮT** hiệu ứng hòa âm chuyển bài.';

    return message.reply({ embeds: [createSuccessEmbed(text)] });
  }
};
