const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'setlog',
  aliases: ['logchannel', 'kenhlog', 'setlogchannel', 'log'],
  description: 'Configure text channel for bot activity & voice logs (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Configure text channel for bot activity & voice logs (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Cài đặt kênh văn bản ghi toàn bộ nhật ký hoạt động bot (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Text channel to send logs to')
        .setDescriptionLocalizations({
          vi: 'Chọn kênh văn bản để ghi toàn bộ nhật ký voice & âm nhạc'
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Turn off log channel')
        .setDescriptionLocalizations({
          vi: 'Chọn True nếu muốn tắt kênh ghi nhật ký'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;
    const guildId = ctx.guild.id;

    if (!isStrictAdmin(ctx.member)) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'common.no_permission'))]
      });
    }

    const resetOpt = ctx.options.getBoolean('reset');
    const firstArg = args?.[0]?.toLowerCase();

    if (resetOpt || ['off', 'tat', 'reset', 'clear'].includes(firstArg)) {
      settingsManager.update(guildId, { logChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setlog_unset'))] });
    }

    const channel = ctx.options.getChannel('channel') || ctx.channel;
    settingsManager.update(guildId, { logChannelId: channel.id });
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setlog_set', { channelId: channel.id }))] });
  }
};
