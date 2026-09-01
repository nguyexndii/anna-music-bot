const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
          vi: 'Kênh Voice muốn khóa cố định'
        })
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Unlock voice channel restriction')
        .setDescriptionLocalizations({
          vi: 'Hủy khóa kênh Voice'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    if (!ctx.member.permissions.has('ManageGuild') && !ctx.member.permissions.has('Administrator')) {
      return ctx.reply({ embeds: [createErrorEmbed('Bạn cần có quyền `Quản Lý Máy Chủ` hoặc `Quản Trị Viên` để khóa phòng Voice!')] });
    }

    const resetOpt = ctx.options.getBoolean('reset');
    const firstArg = args?.[0]?.toLowerCase();
    if (resetOpt || ['reset', 'off', 'tat', 'clear'].includes(firstArg)) {
      settingsManager.update(ctx.guild.id, { lockedVoiceChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed('Đã mở khóa phòng Voice! Bây giờ bot có thể tham gia bất kỳ phòng Voice nào theo yêu cầu.')] });
    }

    const channel = ctx.options.getChannel('channel')
      || ctx.member?.voice?.channel
      || (args?.[0] ? ctx.guild.channels.cache.get(args[0].replace(/[<#>]/g, '')) : null);

    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice && channel.type !== 2 && channel.type !== 13)) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng tham gia vào một phòng Voice hoặc chọn phòng Voice hợp lệ (ví dụ: `/lockvoice #Chung-voice`)!')] });
    }

    settingsManager.update(ctx.guild.id, { lockedVoiceChannelId: channel.id });
    return ctx.reply({
      embeds: [createSuccessEmbed(`Đã khóa phòng Voice thành công! Kể từ bây giờ bot chỉ hoạt động cố định tại: **${channel.name}** (<#${channel.id}>).`)]
    });
  }
};
