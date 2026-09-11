const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'resume',
  aliases: ['unpause'],
  description: 'Resume paused song',
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused song')
    .setDescriptionLocalizations({
      vi: 'Tiếp tục phát bài hát đang tạm dừng'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Hiện không có bài hát nào đang phát!');
    }

    if (!queue.paused) {
      return ctx.reply('Nhạc đang được phát bình thường!');
    }

    queue.togglePause();
    return ctx.reply('▶️ Đã tiếp tục phát nhạc.');
  }
};
