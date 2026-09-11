const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { createContext } = require('../utils/commandHelper');

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
    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Hiện không có bài hát nào đang phát!');
    }

    if (queue.paused) {
      return ctx.reply('Nhạc hiện tại đã bị tạm dừng trước đó!');
    }

    queue.togglePause();
    return ctx.reply('⏸️ Đã tạm dừng phát nhạc.');
  }
};
