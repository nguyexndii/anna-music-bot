const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSettingsEmbed, createSettingsSelectMenu, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

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
    const guildId = ctx.guild.id;

    if (!isStrictAdmin(ctx.member)) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'common.no_permission'))],
        flags: 64
      });
    }

    const guildSettings = settingsManager.get(guildId);
    const embed = createSettingsEmbed(ctx.guild, guildSettings);
    const row = createSettingsSelectMenu(guildSettings);

    return ctx.reply({ embeds: [embed], components: [row], flags: 64 });
  }
};
