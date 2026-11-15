const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'skip',
  aliases: ['s', 'sk', 'next', 'fs', 'forceskip'],
  description: 'Skip current song',
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song')
    .setDescriptionLocalizations({
      vi: 'Bỏ qua bài hát hiện tại (hỗ trợ lệnh tắt /s, /fs)'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(t(guildId, 'common.dj_only', { role: roleText }));
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply(t(guildId, 'common.different_voice', { channel: botVoice.name }));
    }

    const queue = musicManager.get(guildId);
    if (!queue || !queue.currentSong) {
      return ctx.reply(t(guildId, 'common.no_song_playing'));
    }

    if (queue.isCurrentSongLofi()) {
      return ctx.reply(t(guildId, 'player.radio_cannot_control'));
    }

    const result = queue.checkOrCastSkipVote(ctx.member);
    if (result.status === 'skipped') {
      const skipDict = require('../utils/i18n').dictionaries.vi.skip || {};
      const key = (result.reason in skipDict) ? `skip.${result.reason}` : 'skip.force_single';
      return ctx.reply(t(guildId, key, {
        title: result.title,
        current: result.current,
        required: result.required
      }));
    }

    if (result.status === 'vote_progress') {
      return ctx.reply(t(guildId, 'skip.vote_progress', {
        user: result.user,
        current: result.current,
        required: result.required,
        needed: result.needed
      }));
    }

    if (result.status === 'vote_retracted') {
      return ctx.reply(t(guildId, 'skip.vote_retracted', {
        user: result.user,
        current: result.current,
        required: result.required
      }));
    }

    return ctx.reply(t(guildId, 'skip.force_single', { title: queue.currentSong?.title || '' }));
  }
};
