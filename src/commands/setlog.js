const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
          vi: 'Kênh văn bản muốn gửi nhật ký'
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('reset')
        .setDescription('Turn off log channel')
        .setDescriptionLocalizations({
          vi: 'Tắt kênh ghi nhật ký'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member?.permissions.has('Administrator') || ctx.member?.permissions.has('ManageGuild');

    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed('Bạn cần quyền `Quản Trị Viên (Administrator)` hoặc `Quản Lý Máy Chủ` để cấu hình kênh nhật ký!')]
      });
    }

    const resetOpt = ctx.options.getBoolean('reset');
    const firstArg = args?.[0]?.toLowerCase();

    if (resetOpt || ['reset', 'off', 'clear', 'tat'].includes(firstArg)) {
      settingsManager.update(ctx.guild.id, { logChannelId: null });
      return ctx.reply({ embeds: [createSuccessEmbed('🔴 Đã TẮT kênh ghi nhật ký hoạt động của bot.')] });
    }

    const channelOpt = ctx.options.getChannel('channel');
    let channel = channelOpt;

    if (!channel && args && args.length > 0) {
      const rawInput = args[0].replace(/^[<#]+|>+$/g, '').trim();
      channel = ctx.message?.mentions.channels.first()
        || ctx.guild.channels.cache.get(rawInput)
        || ctx.guild.channels.cache.find(c => c.name.toLowerCase() === rawInput.toLowerCase());
    }

    if (!channel) {
      const current = settingsManager.get(ctx.guild.id);
      const logText = current.logChannelId ? `<#${current.logChannelId}> (🟢 Đang BẬT)` : '🔴 Đang TẮT';
      return ctx.reply({
        embeds: [createSuccessEmbed(`📋 **Kênh Nhật Ký Hoạt Động (Log Channel)**:\n• Trạng thái hiện tại: ${logText}\n\n*Cách sử dụng:*\n• \`/setlog channel:#tên-kênh\` — Chọn kênh gửi nhật ký\n• \`/setlog reset:True\` — Tắt kênh nhật ký`)]
      });
    }

    if (!channel.isTextBased()) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng chọn một kênh văn bản hợp lệ!')] });
    }

    const botMember = ctx.guild.members.me;
    if (botMember && !channel.permissionsFor(botMember)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      return ctx.reply({ embeds: [createErrorEmbed(`Bot không có đủ quyền (Xem kênh, Gửi tin nhắn, Chèn liên kết) trong kênh <#${channel.id}>!`)] });
    }

    settingsManager.update(ctx.guild.id, { logChannelId: channel.id });
    return ctx.reply({
      embeds: [createSuccessEmbed(`✅ Đã thiết lập kênh ghi nhật ký thành công: <#${channel.id}>!\nKể từ bây giờ, mọi hoạt động của bot (sửa/xóa tin nhắn, người vào/ra/stream/cam phòng voice, lệnh nhạc, web player...) sẽ được ghi nhận vào kênh này.`)]
    });
  }
};
