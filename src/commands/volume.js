const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'volume',
  aliases: ['vol', 'v'],
  description: 'Adjust playback volume (1 - 100)',
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Adjust playback volume (1 - 100)')
    .setDescriptionLocalizations({
      vi: 'Điều chỉnh âm lượng phát nhạc (1 - 100)'
    })
    .addIntegerOption(opt =>
      opt
        .setName('level')
        .setDescription('Volume level from 1 to 100%')
        .setDescriptionLocalizations({
          vi: 'Mức âm lượng mong muốn từ 1 đến 100% (ví dụ: 50 hoặc 80)'
        })
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.dj_only', { role: roleText }))] });
    }

    const queue = musicManager.get(guildId);
    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_queue'))] });
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.different_voice', { channel: botVoice.name }))] });
    }

    const level = ctx.options.getInteger('level');
    if (level === null && (!args || args.length === 0)) {
      return ctx.reply({ embeds: [createSuccessEmbed(`🔊 ${t(guildId, 'player.volume_set', { volume: queue.volume })}`)] });
    }

    const vol = level !== null ? level : parseInt(args[0], 10);
    if (isNaN(vol) || vol < 1 || vol > 100) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.volume_invalid'))] });
    }

    queue.setVolume(vol);
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, 'player.volume_set', { volume: vol }))] });
  }
};
