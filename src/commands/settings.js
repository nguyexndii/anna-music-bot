const settingsManager = require('../structures/SettingsManager');
const { createSettingsEmbed, createSettingsSelectMenu, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'caidat',
  aliases: ['settings', 'set', 'config', 'setup'],
  description: 'Mở bảng điều khiển cài đặt bot (Chỉ Quản trị viên máy chủ mới được sử dụng)',
  async execute(message) {
    if (!message.guild) return;

    // Chỉ Admin máy chủ (Owner, Administrator, ManageGuild) mới được phép sử dụng
    const isOwner = message.guild.ownerId === message.author.id;
    const hasAdminPerm = message.member.permissions.has('Administrator') || message.member.permissions.has('ManageGuild');

    if (!isOwner && !hasAdminPerm) {
      return message.reply({
        embeds: [createErrorEmbed('Bạn không có quyền sử dụng lệnh này! Lệnh `.caidat` chỉ dành cho **Chủ sở hữu máy chủ (Server Owner)** hoặc thành viên có quyền **Quản trị viên (Administrator) / Quản lý máy chủ**.')]
      });
    }

    const guildSettings = settingsManager.get(message.guild.id);
    const embed = createSettingsEmbed(message.guild, guildSettings);
    const row = createSettingsSelectMenu(guildSettings);

    return message.reply({ embeds: [embed], components: [row] });
  }
};
