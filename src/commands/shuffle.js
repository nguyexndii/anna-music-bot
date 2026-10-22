const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'shuffle',
  aliases: ['sh', 'xaotron', 'mix'],
  description: 'Randomly shuffle songs in the queue',
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Randomly shuffle songs in the queue')
    .setDescriptionLocalizations({
      vi: 'Xáo trộn ngẫu nhiên thứ tự các bài hát trong hàng chờ'
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
    if (queue?.isCurrentSongLofi()) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.radio_cannot_control'))] });
    }

    if (!queue || queue.songs.length < 2) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.shuffle_not_enough'))] });
    }

    queue.shuffle();

    return ctx.reply({
      embeds: [createSuccessEmbed(t(guildId, 'player.shuffled', { count: queue.songs.length }))]
    });
  }
};
