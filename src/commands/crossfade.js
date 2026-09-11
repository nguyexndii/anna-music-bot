const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'crossfade',
  aliases: ['fade', 'hoam'],
  description: 'Configure smooth crossfade track transition (0 - 10 seconds, Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('crossfade')
    .setDescription('Configure smooth crossfade track transition (0 - 10 seconds, Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Cài đặt thời gian hòa âm chuyển bài mượt mà (0 - 10 giây, Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt
        .setName('seconds')
        .setDescription('Fade duration in seconds (0 to disable, up to 10)')
        .setDescriptionLocalizations({
          vi: 'Số giây hòa âm (0 để tắt, tối đa 10)'
        })
        .setMinValue(0)
        .setMaxValue(10)
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member?.permissions.has('Administrator') || ctx.member?.permissions.has('ManageGuild');
    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed('Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên (Administrator / Manage Server)** mới có quyền thay đổi Cài đặt Hòa âm (Crossfade)!')]
      });
    }

    const secondsOption = ctx.options.getInteger('seconds');
    if (secondsOption === null && (!args || args.length === 0)) {
      const current = settingsManager.get(ctx.guild.id);
      return ctx.reply({
        embeds: [createSuccessEmbed(`Thời gian hòa âm chuyển bài (Crossfade) hiện tại: **${current.crossfadeDuration || 0} giây**\n\n*Cách đổi:* \`/crossfade seconds:<0-10>\` (0 = tắt hòa âm)`)]
      });
    }

    const seconds = secondsOption !== null ? secondsOption : parseInt(args[0], 10);
    if (isNaN(seconds) || seconds < 0 || seconds > 10) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng nhập số giây hợp lệ từ 0 đến 10 giây (ví dụ: `/crossfade seconds:3` hoặc `/crossfade seconds:0` để tắt)!')] });
    }

    settingsManager.update(ctx.guild.id, { crossfadeDuration: seconds });
    const text = seconds > 0
      ? `Đã cài đặt thời gian hòa âm chuyển bài: **${seconds} giây** (Các bài hát sẽ vào êm dịu, không bị giật/ngắt quãng)`
      : 'Đã **TẮT** hiệu ứng hòa âm chuyển bài.';

    return ctx.reply({ embeds: [createSuccessEmbed(text)] });
  }
};
