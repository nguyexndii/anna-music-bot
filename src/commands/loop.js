const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'loop',
  aliases: ['l', 'repeat'],
  description: 'Toggle loop mode for current song or entire queue',
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode for current song or entire queue')
    .setDescriptionLocalizations({
      vi: 'Bật/tắt chế độ lặp lại bài hát hoặc hàng chờ'
    })
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Loop mode (Off, Song, Queue)')
        .setDescriptionLocalizations({
          vi: 'Chọn chế độ lặp: Tắt (Off), Lặp 1 bài (Song), Lặp toàn bộ hàng chờ (Queue)'
        })
        .setRequired(false)
        .addChoices(
          { name: 'Off', name_localizations: { vi: 'Tắt lặp (Off)' }, value: 'off' },
          { name: 'Current Song', name_localizations: { vi: 'Lặp bài hiện tại (Song)' }, value: 'song' },
          { name: 'Entire Queue', name_localizations: { vi: 'Lặp toàn bộ hàng chờ (Queue)' }, value: 'queue' }
        )
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

    if (queue.isCurrentSongLofi()) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.radio_cannot_control'))] });
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.different_voice', { channel: botVoice.name }))] });
    }

    const modeOpt = ctx.options.getString('mode');
    let mode;
    if (modeOpt) {
      queue.setLoop(modeOpt);
      mode = modeOpt;
    } else {
      mode = queue.toggleLoop();
    }

    const msgKey = mode === 'song' ? 'player.loop_song' : mode === 'queue' ? 'player.loop_queue' : 'player.loop_off';
    return ctx.reply({ embeds: [createSuccessEmbed(t(guildId, msgKey))] });
  }
};
