const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { isStrictAdmin } = require('../utils/permissionHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: '247',
  aliases: ['24/7', 'alwaysonline'],
  description: 'Toggle 24/7 voice stay & relaxing Lofi background playback (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Toggle 24/7 voice stay & relaxing Lofi background playback (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Bật/tắt duy trì bot trong Voice 24/7 và phát Lofi thư giãn (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt
        .setName('status')
        .setDescription('Turn 24/7 mode on or off')
        .setDescriptionLocalizations({
          vi: 'Chọn trạng thái: on (Bật duy trì Voice 24/7 & phát Lofi thư giãn), off (Tắt)'
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
    const guildId = ctx.guild.id;

    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = isStrictAdmin(ctx.member);
    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'common.no_permission'))]
      });
    }

    await ctx.deferReply();

    const voiceChannel = ctx.member?.voice?.channel;
    let queue = musicManager.get(guildId);
    const statusOption = ctx.options.getString('status');

    if (!queue) {
      if (!voiceChannel) {
        return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_voice'))] });
      }
      queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
      await queue.connect();
      queue.set247(true);
      settingsManager.update(guildId, { mode247: true });
      await queue._play247BackgroundLofi();
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.mode247_enabled'))] });
    }

    let is247;
    if (statusOption === 'on') {
      is247 = true;
      queue.set247(true);
      settingsManager.update(guildId, { mode247: true });
    } else if (statusOption === 'off') {
      is247 = false;
      queue.set247(false);
      settingsManager.update(guildId, { mode247: false });
    } else {
      is247 = queue.toggle247();
      settingsManager.update(guildId, { mode247: is247 });
    }

    if (is247) {
      if (!queue.currentSong) {
        await queue._play247BackgroundLofi();
      }
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.mode247_enabled'))] });
    } else {
      return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'commands.mode247_disabled'))] });
    }
  }
};
