const musicManager = require('../structures/MusicManager');
const { createSuccessEmbed, createErrorEmbed, EMOJI_TAG } = require('../utils/embed');

module.exports = {
  name: '247',
  aliases: ['24/7', 'alwaysonline'],
  description: 'Bật hoặc tắt chế độ duy trì bot ở phòng Voice 24/7 và phát nhạc Lofi',
  async execute(message) {
    const voiceChannel = message.member?.voice?.channel;
    let queue = musicManager.get(message.guild.id);

    if (!queue) {
      if (!voiceChannel) {
        return message.reply({ embeds: [createErrorEmbed('Bạn cần vào một phòng Voice trước để bật chế độ 24/7!')] });
      }
      queue = musicManager.getOrCreate(message.guild, message.channel, voiceChannel);
      await queue.connect();
      queue.set247(true);
      await queue._play247BackgroundLofi();
      return message.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã kết nối vào Voice và BẬT chế độ 24/7 (Đang phát nhạc Lofi thư giãn)!`)] });
    }

    const is247 = queue.toggle247();
    if (is247) {
      if (!queue.currentSong) {
        await queue._play247BackgroundLofi();
      }
      return message.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã **BẬT** chế độ 24/7 (Bot sẽ duy trì trong phòng và phát Lofi khi trống)!`)] });
    } else {
      return message.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã **TẮT** chế độ 24/7 (Bot sẽ tự rời phòng khi hết nhạc hoặc phòng trống sau 1 phút)!`)] });
    }
  }
};
