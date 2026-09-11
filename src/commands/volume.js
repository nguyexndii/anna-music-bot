const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
        .setDescription('Volume level from 1 to 100')
        .setDescriptionLocalizations({
          vi: 'Mức âm lượng từ 1 đến 100'
        })
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed('Bot hiện không ở trong kênh Voice!')] });
    }

    const level = ctx.options.getInteger('level');
    if (level === null && (!args || args.length === 0)) {
      return ctx.reply({ embeds: [createSuccessEmbed(`🔊 Âm lượng hiện tại: **${queue.volume}%**`)] });
    }

    const vol = level !== null ? level : parseInt(args[0], 10);
    if (isNaN(vol) || vol < 1 || vol > 100) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng nhập âm lượng hợp lệ từ 1 đến 100!')] });
    }

    queue.setVolume(vol);
    return ctx.reply({ embeds: [createSuccessEmbed(`🔊 Đã chỉnh âm lượng thành **${vol}%**`)] });
  }
};
