const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'setdj',
  aliases: ['djrole', 'djonly', 'vaitrodj'],
  description: 'Cài đặt vai trò DJ và bật/tắt chế độ chỉ DJ mới được điều khiển nhạc',
  async execute(message, args) {
    if (!message.guild) return;

    // Check manage guild or admin permission
    if (!message.member.permissions.has('ManageGuild') && !message.member.permissions.has('Administrator')) {
      return message.reply({ embeds: [createErrorEmbed('Bạn cần có quyền `Quản Lý Máy Chủ` hoặc `Quản Trị Viên` để cài đặt vai trò DJ!')] });
    }

    if (!args[0]) {
      const current = settingsManager.get(message.guild.id);
      const roleText = current.djRoleId ? `<@&${current.djRoleId}>` : 'Chưa thiết lập';
      const statusText = current.djOnly ? '🟢 Đang BẬT' : '🔴 Đang TẮT';
      return message.reply({
        embeds: [createSuccessEmbed(`Trạng thái chế độ DJ:\n• Vai trò DJ: ${roleText}\n• Chế độ chỉ DJ: ${statusText}\n\n*Cách dùng:* \`.setdj @role\` hoặc \`.setdj on/off\``)]
      });
    }

    const firstArg = args[0].toLowerCase();

    // Toggle on/off
    if (firstArg === 'on' || firstArg === 'enable' || firstArg === 'bat') {
      settingsManager.update(message.guild.id, { djOnly: true });
      return message.reply({ embeds: [createSuccessEmbed('🟢 Đã BẬT chế độ chỉ người có vai trò DJ mới được dùng lệnh nhạc!')] });
    }

    if (firstArg === 'off' || firstArg === 'disable' || firstArg === 'tat' || firstArg === 'reset') {
      settingsManager.update(message.guild.id, { djOnly: false, djRoleId: null });
      return message.reply({ embeds: [createSuccessEmbed('🔴 Đã TẮT chế độ DJ! Bây giờ tất cả mọi người đều có thể phát nhạc.')] });
    }

    // Set specific role
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]) || message.guild.roles.cache.find(r => r.name.toLowerCase().includes(args.join(' ').toLowerCase()));

    if (!role) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng tag hoặc cung cấp tên vai trò hợp lệ (ví dụ: `!setdj @DJ`)!')] });
    }

    settingsManager.update(message.guild.id, { djRoleId: role.id, djOnly: true });
    return message.reply({
      embeds: [createSuccessEmbed(`Đã gán vai trò DJ thành công cho **${role.name}** (<@&${role.id}>) và tự động **BẬT** chế độ chỉ DJ mới được phát nhạc!`)]
    });
  }
};
