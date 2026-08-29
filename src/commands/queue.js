const musicManager = require('../structures/MusicManager');
const { createQueueEmbed, createQueueDeleteSelectMenu, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'queue',
  aliases: ['q', 'list', 'hangcho'],
  description: 'Xem danh sách bài hát trong hàng chờ và chọn bài để xóa',
  async execute(message) {
    const queue = musicManager.get(message.guild.id);
    if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
      return message.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')] });
    }

    const embed = createQueueEmbed(queue);
    const deleteMenu = createQueueDeleteSelectMenu(queue);

    const components = deleteMenu ? [deleteMenu] : [];
    return message.reply({ embeds: [embed], components });
  }
};
