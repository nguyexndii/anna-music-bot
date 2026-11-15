const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createAutoplayLayersEmbed, createAutoplayLayersComponents } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

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
          vi: 'Chọn: on (Bật), off (Tắt) hoặc layers (Cấu hình các tầng thuật toán gợi ý)'
        })
        .setRequired(false)
        .addChoices(
          { name: 'On', name_localizations: { vi: 'Bật (ON)' }, value: 'on' },
          { name: 'Off', name_localizations: { vi: 'Tắt (OFF)' }, value: 'off' },
          { name: 'Layers', name_localizations: { vi: 'Cấu hình các tầng (Layers)' }, value: 'layers' }
        )
    ),
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

    const current = settingsManager.get(guildId);
    const statusOption = ctx.options.getString('status');

    if (statusOption === 'layers' || (args && (args[0]?.toLowerCase() === 'layers' || args[0]?.toLowerCase() === 'layer'))) {
      const layersEmbed = createAutoplayLayersEmbed(ctx.guild, current);
      const layersComponents = createAutoplayLayersComponents(current);
      return ctx.reply({ embeds: [layersEmbed], components: layersComponents, flags: 64 });
    }

    let newVal;
    if (statusOption === 'on') {
      newVal = true;
    } else if (statusOption === 'off') {
      newVal = false;
    } else {
      newVal = !current.autoplay;
    }

    settingsManager.update(guildId, { autoplay: newVal });

    const msgKey = newVal ? 'commands.autoplay_enabled' : 'commands.autoplay_disabled';
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, msgKey))] });
  }
};
