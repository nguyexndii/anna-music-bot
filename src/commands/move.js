const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'move',
  aliases: ['mv', 'jump'],
  description: 'Move a song to a different position in the queue',
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a song to a different position in the queue')
    .setDescriptionLocalizations({
      vi: 'Di chuyển vị trí bài hát trong hàng chờ'
    })
    .addIntegerOption(opt =>
      opt
        .setName('from')
        .setDescription('Current position of the song (e.g. 5)')
        .setDescriptionLocalizations({
          vi: 'Vị trí hiện tại của bài hát trong hàng chờ (ví dụ: 5)'
        })
        .setMinValue(1)
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('to')
        .setDescription('New position to move the song to (default: 1)')
        .setDescriptionLocalizations({
          vi: 'Vị trí mới muốn chuyển đến (mặc định: 1 - phát kế tiếp)'
        })
        .setMinValue(1)
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'common.dj_only', { role: roleText }))],
        flags: 64
      });
    }

    const queue = musicManager.get(guildId);

    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.queue_empty'))] });
    }
    const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
    if (userSongs.length === 0) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'player.queue_empty'))] });
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.different_voice', { channel: botVoice.name }))] });
    }

    let fromPos = ctx.options.getInteger('from');
    let toPos = ctx.options.getInteger('to');

    if (fromPos === null && args && args.length > 0) {
      fromPos = parseInt(args[0], 10);
      toPos = args[1] ? parseInt(args[1], 10) : 1;
    }

    if (isNaN(fromPos) || fromPos < 1 || fromPos > userSongs.length) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'commands.move_invalid'))],
        flags: 64
      });
    }

    toPos = toPos === null || isNaN(toPos) ? 1 : toPos;
    if (toPos < 1) toPos = 1;
    if (toPos > userSongs.length) toPos = userSongs.length;

    if (fromPos === toPos) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'commands.move_invalid'))],
        flags: 64
      });
    }

    const fromTarget = userSongs[fromPos - 1];
    const actualFrom = queue.songs.indexOf(fromTarget);
    if (actualFrom === -1) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'commands.move_invalid'))],
        flags: 64
      });
    }

    const toTarget = userSongs[toPos - 1];
    let actualTo = queue.songs.indexOf(toTarget);
    if (actualTo === -1) {
      actualTo = toPos > fromPos ? queue.songs.length - 1 : 0;
    }

    const moved = queue.moveSong(actualFrom, actualTo);
    if (!moved) {
      return ctx.reply({
        embeds: [createErrorEmbed(t(guildId, 'commands.move_invalid'))],
        flags: 64
      });
    }

    return ctx.reply({
      embeds: [createSuccessEmbed(t(guildId, 'commands.move_success', {
        title: fromTarget.title,
        from: fromPos,
        to: toPos
      }))]
    });
  }
};
