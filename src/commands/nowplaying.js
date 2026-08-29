const musicManager = require('../structures/MusicManager');
const { createNowPlayingEmbed, createMusicControls, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'control',
  aliases: ['np', 'nowplaying', 'c', 'panel', 'dieukhien'],
  description: 'Gọi lại bảng điều khiển âm nhạc tương tác',
  async execute(message) {
    const queue = musicManager.get(message.guild.id);
    if (!queue || !queue.currentSong) {
      return message.reply('Hiện không có bài hát nào đang phát!');
    }

    // Xóa tin nhắn cũ nếu có để tránh trôi và trùng lặp
    if (queue.nowPlayingMessage) {
      queue.nowPlayingMessage.delete().catch(() => {});
      queue.nowPlayingMessage = null;
    }

    const embed = createNowPlayingEmbed(queue.currentSong, queue);
    const controls = createMusicControls(queue);

    const msg = await message.channel.send({ embeds: [embed], components: controls });
    queue.nowPlayingMessage = msg;
    message.delete().catch(() => {});
  }
};
