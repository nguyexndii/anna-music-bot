const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'pause',
  aliases: [],
  description: 'Pause currently playing song',
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause currently playing song')
    .setDescriptionLocalizations({
      vi: 'Tạm dừng bài hát đang phát'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(t(guildId, 'common.dj_only', { role: roleText }));
    }

    const queue = musicManager.get(guildId);
    if (!queue || !queue.currentSong) {
      return ctx.reply(t(guildId, 'common.no_song_playing'));
    }

    if (queue.isCurrentSongLofi()) {
      return ctx.reply(t(guildId, 'player.radio_cannot_control'));
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply(t(guildId, 'common.different_voice', { channel: botVoice.name }));
    }

    if (queue.paused) {
      return ctx.reply(t(guildId, 'player.already_paused'));
    }

    queue.togglePause();
    return ctx.reply(t(guildId, 'player.paused', { title: queue.currentSong.title }));
  }
};
