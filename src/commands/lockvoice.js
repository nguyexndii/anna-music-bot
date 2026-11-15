const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'lockvoice',
  aliases: ['lockvc', 'setvoice', 'khoavoice'],
  description: 'Lock bot playback to a fixed voice channel (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('lockvoice')
    .setDescription('Lock bot playback to a fixed voice channel (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Khóa kênh Voice cố định cho bot phát nhạc (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Voice channel to lock to')
        .setDescriptionLocalizations({
          vi: 'Chọn kênh Voice muốn khóa cố định bot vào đó'
        })
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Unlock voice channel restriction')
        .setDescriptionLocalizations({
          vi: 'Chọn True nếu muốn hủy khóa kênh Voice'
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
    if (resetOpt || ['reset', 'off', 'tat', 'clear'].includes(firstArg)) {
      settingsManager.update(guildId, { lockedVoiceChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.lockvoice_unlocked'))] });
    }

    const channelOpt = ctx.options.getChannel('channel');
    let targetChannel = channelOpt;
    if (!targetChannel && ctx.member.voice?.channel) {
      targetChannel = ctx.member.voice.channel;
    }

    if (!targetChannel) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_voice'))] });
    }

    settingsManager.update(guildId, { lockedVoiceChannelId: targetChannel.id });
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.lockvoice_locked', { channelId: targetChannel.id }))] });
  }
};
