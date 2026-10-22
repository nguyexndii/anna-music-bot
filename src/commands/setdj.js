const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'setdj',
  aliases: ['djrole', 'djonly', 'vaitrodj'],
  description: 'Configure DJ role and DJ-only mode (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('setdj')
    .setDescription('Configure DJ role and DJ-only mode (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Cài đặt vai trò DJ cho máy chủ (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(opt =>
      opt
        .setName('role')
        .setDescription('DJ Role to assign')
        .setDescriptionLocalizations({
          vi: 'Chọn vai trò (Role) muốn phân quyền DJ điều khiển nhạc'
        })
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Enable, disable, or reset DJ mode')
        .setDescriptionLocalizations({
          vi: 'Chọn chế độ: on (Chỉ DJ được chỉnh nhạc), off (Tắt), reset (Hủy vai trò DJ)'
        })
        .setRequired(false)
        .addChoices(
          { name: 'On', name_localizations: { vi: 'Bật (ON)' }, value: 'on' },
          { name: 'Off', name_localizations: { vi: 'Tắt (OFF)' }, value: 'off' },
          { name: 'Reset', name_localizations: { vi: 'Hủy vai trò (Reset)' }, value: 'reset' }
        )
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;
    const guildId = ctx.guild.id;

    if (!isStrictAdmin(ctx.member)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_permission'))] });
    }

    const roleOption = ctx.options.getRole('role');
    const modeOption = ctx.options.getString('mode');

    if (modeOption === 'reset' || (args && args[0]?.toLowerCase() === 'reset')) {
      settingsManager.update(guildId, { djOnly: false, djRoleId: null });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setdj_disabled'))] });
    }

    if (roleOption) {
      settingsManager.update(guildId, { djRoleId: roleOption.id, djOnly: true });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setdj_enabled', { roleId: roleOption.id }))] });
    }

    if (modeOption === 'on') {
      const current = settingsManager.get(guildId);
      if (!current.djRoleId) {
        return ctx.reply({
          embeds: [createErrorEmbed(t(guildId, 'commands.setdj_require_role'))],
          flags: 64
        });
      }
      settingsManager.update(guildId, { djOnly: true });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setdj_enabled', { roleId: current.djRoleId }))] });
    }

    if (modeOption === 'off') {
      settingsManager.update(guildId, { djOnly: false });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setdj_disabled'))] });
    }

    const current = settingsManager.get(guildId);
    const newDj = !current.djOnly;
    if (newDj && !current.djRoleId) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'commands.setdj_require_role'))],
        flags: 64
      });
    }
    settingsManager.update(guildId, { djOnly: newDj });
    const msgKey = newDj ? 'commands.setdj_enabled' : 'commands.setdj_disabled';
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, msgKey, { roleId: current.djRoleId }))] });
  }
};
