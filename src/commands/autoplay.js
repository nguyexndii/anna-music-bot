const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'autoplay',
  aliases: ['ap', 'auto'],
  description: 'Toggle autoplaying similar tracks when queue ends (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplaying similar tracks when queue ends (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Bật/Tắt tự động phát bài hát tương tự khi hết nhạc (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt
        .setName('status')
        .setDescription('Turn autoplay on or off')
        .setDescriptionLocalizations({
          vi: 'Bật hoặc tắt chế độ tự động phát'
        })
        .setRequired(false)
        .addChoices(
          { name: 'On', name_localizations: { vi: 'Bật (ON)' }, value: 'on' },
          { name: 'Off', name_localizations: { vi: 'Tắt (OFF)' }, value: 'off' }
        )
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member?.permissions.has('Administrator') || ctx.member?.permissions.has('ManageGuild');
    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed('Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên (Administrator / Manage Server)** mới có quyền thay đổi Cài đặt Autoplay!')]
      });
    }

    const current = settingsManager.get(ctx.guild.id);
    const statusOption = ctx.options.getString('status');
    let newVal;
    if (statusOption === 'on') {
      newVal = true;
    } else if (statusOption === 'off') {
      newVal = false;
    } else {
      newVal = !current.autoplay;
    }

    settingsManager.update(ctx.guild.id, { autoplay: newVal });

    const statusText = newVal ? '🟢 BẬT (Tự động phát bài tương tự khi hết hàng chờ)' : '🔴 TẮT (Dừng lại khi phát hết nhạc)';
    return ctx.reply({ embeds: [createSuccessEmbed(`Chế độ Tự động phát (Autoplay): **${statusText}**`)] });
  }
};
