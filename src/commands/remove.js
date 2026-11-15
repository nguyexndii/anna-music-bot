const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'remove',
  aliases: ['xoa', 'rm', 'delete'],
  description: 'Remove a song from the queue by its position number',
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue by its position number')
    .setDescriptionLocalizations({
      vi: 'Xóa một bài hát ra khỏi hàng chờ theo số thứ tự'
    })
    .addIntegerOption(opt =>
      opt
        .setName('position')
        .setDescription('Track position number to remove (starting from 1)')
        .setDescriptionLocalizations({
          vi: 'Số thứ tự bài hát trong hàng chờ cần xóa (ví dụ: 1, 2, 3...)'
        })
        .setMinValue(1)
        .setRequired(true)
    ),
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
    if (!queue) {
      return ctx.reply(t(guildId, 'player.queue_empty'));
    }
    const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
    if (userSongs.length === 0) {
      return ctx.reply(t(guildId, 'player.queue_empty'));
    }

    const pos = ctx.options.getInteger('position');
    const index = pos !== null ? pos : parseInt(args[0], 10);
    if (isNaN(index) || index < 1 || index > userSongs.length) {
      return ctx.reply(t(guildId, 'commands.remove_invalid'));
    }

    const targetSong = userSongs[index - 1];
    const actualIndex = queue.songs.indexOf(targetSong);
    if (actualIndex === -1) {
      return ctx.reply(t(guildId, 'commands.remove_invalid'));
    }

    const removed = queue.removeSong(actualIndex);
    if (!removed) {
      return ctx.reply(t(guildId, 'commands.remove_invalid'));
    }

    return ctx.reply({
      embeds: [createSuccessEmbed(t(guildId, 'commands.remove_success', { title: removed.title }))]
    });
  }
};
