const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'resume',
  aliases: ['unpause'],
  description: 'Tiếp tục phát nhạc đang tạm dừng',
  async execute(message) {
    const queue = musicManager.get(message.guild.id);
    if (!queue || !queue.currentSong) {
      return message.reply('Hiện không có bài hát nào đang phát!');
    }

    if (!queue.paused) {
      return message.reply('Nhạc đang được phát bình thường!');
    }

    queue.togglePause();
    return message.reply('Đã tiếp tục phát nhạc.');
  }
};
