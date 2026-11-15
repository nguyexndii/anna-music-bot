const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'setchannel',
  aliases: ['channel', 'lockchannel', 'kenhnhac'],
  description: 'Set dedicated text channel for bot music commands (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set dedicated text channel for bot music commands (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Cài đặt kênh văn bản nhận lệnh âm nhạc (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Text channel for music commands')
        .setDescriptionLocalizations({
          vi: 'Chọn kênh văn bản muốn cố định làm kênh nhận lệnh nhạc duy nhất'
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Reset channel restriction (allow all channels)')
        .setDescriptionLocalizations({
          vi: 'Chọn True nếu muốn hủy khóa kênh, cho phép dùng ở mọi kênh'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;
    const guildId = ctx.guild.id;

    if (!isStrictAdmin(ctx.member)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_permission'))] });
    }

    const resetOpt = ctx.options.getBoolean('reset');
    const firstArg = args?.[0]?.toLowerCase();
    if (resetOpt || ['reset', 'off', 'clear', 'tat'].includes(firstArg)) {
      settingsManager.update(guildId, { musicChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setchannel_unlocked'))] });
    }

    const channel = ctx.options.getChannel('channel') || ctx.channel;
    settingsManager.update(guildId, { musicChannelId: channel.id });
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.setchannel_locked', { channelId: channel.id }))] });
  }
};
