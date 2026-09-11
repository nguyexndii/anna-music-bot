const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
          vi: 'Vai trò DJ cho máy chủ'
        })
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Enable, disable, or reset DJ mode')
        .setDescriptionLocalizations({
          vi: 'Bật, tắt hoặc hủy vai trò DJ'
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

    if (!ctx.member.permissions.has('ManageGuild') && !ctx.member.permissions.has('Administrator')) {
      return ctx.reply({ embeds: [createErrorEmbed('Bạn cần có quyền `Quản Lý Máy Chủ` hoặc `Quản Trị Viên` để cài đặt vai trò DJ!')] });
    }

    const roleOption = ctx.options.getRole('role');
    const modeOption = ctx.options.getString('mode');

    if (!roleOption && !modeOption && (!args || args.length === 0)) {
      const current = settingsManager.get(ctx.guild.id);
      const roleText = current.djRoleId ? `<@&${current.djRoleId}>` : 'Chưa thiết lập';
      const statusText = current.djOnly ? '🟢 Đang BẬT' : '🔴 Đang TẮT';
      return ctx.reply({
        embeds: [createSuccessEmbed(`Trạng thái chế độ DJ:\n• Vai trò DJ: ${roleText}\n• Chế độ chỉ DJ: ${statusText}\n\n*Cách dùng:* \`/setdj role:@Role\` hoặc \`/setdj mode:On/Off\``)]
      });
    }

    const firstArg = modeOption || args?.[0]?.toLowerCase();

    if (firstArg === 'on' || firstArg === 'enable' || firstArg === 'bat') {
      settingsManager.update(ctx.guild.id, { djOnly: true });
      return ctx.reply({ embeds: [createSuccessEmbed('🟢 Đã BẬT chế độ chỉ người có vai trò DJ mới được dùng lệnh nhạc!')] });
    }

    if (firstArg === 'off' || firstArg === 'disable' || firstArg === 'tat' || firstArg === 'reset') {
      settingsManager.update(ctx.guild.id, { djOnly: false, djRoleId: null });
      return ctx.reply({ embeds: [createSuccessEmbed('🔴 Đã TẮT chế độ DJ! Bây giờ tất cả mọi người đều có thể phát nhạc.')] });
    }

    const role = roleOption
      || (ctx.message?.mentions.roles.first() || ctx.guild.roles.cache.get(args[0]) || ctx.guild.roles.cache.find(r => r.name.toLowerCase().includes(args.join(' ').toLowerCase())));

    if (!role) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng chọn hoặc tag một vai trò hợp lệ (ví dụ: `/setdj role:@DJ`)!')] });
    }

    settingsManager.update(ctx.guild.id, { djRoleId: role.id, djOnly: true });
    return ctx.reply({
      embeds: [createSuccessEmbed(`Đã gán vai trò DJ thành công cho **${role.name}** (<@&${role.id}>) và tự động **BẬT** chế độ chỉ DJ mới được phát nhạc!`)]
    });
  }
};
