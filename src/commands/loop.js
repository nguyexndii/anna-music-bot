const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

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
        .setDescription('Loop mode')
        .setDescriptionLocalizations({
          vi: 'Chế độ lặp lại'
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
    const queue = musicManager.get(ctx.guild.id);
    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed('Bot hiện không ở trong kênh Voice!')] });
    }

    const modeOpt = ctx.options.getString('mode');
    let mode;
    if (modeOpt) {
      queue.setLoop(modeOpt);
      mode = modeOpt;
    } else {
      mode = queue.toggleLoop();
    }

    const modeText = mode === 'song' ? '🔂 Bài hát hiện tại' : mode === 'queue' ? '🔁 Toàn bộ hàng chờ' : '➡️ Tắt';
    return ctx.reply({ embeds: [createSuccessEmbed(`Đã thay đổi chế độ lặp: **${modeText}**`)] });
  }
};
