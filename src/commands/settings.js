const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSettingsEmbed, createSettingsSelectMenu, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'settings',
  aliases: ['caidat', 'set', 'config', 'setup'],
  description: 'Open bot configuration control panel (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Open bot configuration control panel (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Mở bảng điều khiển cài đặt bot (Chỉ Quản trị viên máy chủ)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member.permissions.has('Administrator') || ctx.member.permissions.has('ManageGuild');

    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed('Bạn không có quyền sử dụng lệnh này! Lệnh `/settings` chỉ dành cho **Chủ sở hữu máy chủ (Server Owner)** hoặc thành viên có quyền **Quản trị viên (Administrator) / Quản lý máy chủ**.')]
      });
    }

    const guildSettings = settingsManager.get(ctx.guild.id);
    const embed = createSettingsEmbed(ctx.guild, guildSettings);
    const row = createSettingsSelectMenu(guildSettings);

    return ctx.reply({ embeds: [embed], components: [row] });
  }
};
