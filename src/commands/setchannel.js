const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
          vi: 'Kênh văn bản nhận lệnh'
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Reset channel restriction (allow all channels)')
        .setDescriptionLocalizations({
          vi: 'Hủy khóa kênh (cho phép dùng mọi kênh)'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    if (!ctx.member.permissions.has('ManageGuild') && !ctx.member.permissions.has('Administrator')) {
      return ctx.reply({ embeds: [createErrorEmbed('Bạn cần có quyền `Quản Lý Máy Chủ` hoặc `Quản Trị Viên` để cài đặt kênh lệnh!')] });
    }

    const resetOpt = ctx.options.getBoolean('reset');
    const firstArg = args?.[0]?.toLowerCase();
    if (resetOpt || ['reset', 'off', 'clear', 'tat'].includes(firstArg)) {
      settingsManager.update(ctx.guild.id, { musicChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed('Đã bỏ khóa kênh! Bây giờ bạn có thể dùng lệnh bot ở mọi kênh chat.')] });
    }

    const channel = ctx.options.getChannel('channel')
      || (ctx.isInteraction ? null : (ctx.message.mentions.channels.first() || ctx.guild.channels.cache.get(args[0]) || ctx.channel));

    if (!channel || !channel.isTextBased()) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng tag hoặc chọn một kênh văn bản hợp lệ (ví dụ: `/setchannel #kenh-nhac`)!')] });
    }

    settingsManager.update(ctx.guild.id, { musicChannelId: channel.id });
    return ctx.reply({
      embeds: [createSuccessEmbed(`Đã khóa kênh âm nhạc thành công! Kể từ bây giờ bot chỉ nhận lệnh tại: <#${channel.id}>.`)]
    });
  }
};
