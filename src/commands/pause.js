const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');

function sendTemp(message, payload, delayMs = 5000) {
  message.reply(payload).then(msg => {
    setTimeout(() => {
      msg.delete().catch(() => {});
      message.delete().catch(() => {});
    }, delayMs);
  }).catch(() => {});
}

module.exports = {
  name: 'pause',
  aliases: [],
  description: 'Tạm dừng bài hát đang phát',
  async execute(message) {
    const queue = musicManager.get(message.guild.id);
    if (!queue || !queue.currentSong) {
      return message.reply('Hiện không có bài hát nào đang phát!');
    }

    if (queue.paused) {
      return message.reply('Nhạc hiện tại đã bị tạm dừng trước đó!');
    }

    queue.togglePause();
    return message.reply('Đã tạm dừng phát nhạc.');
  }
};
