const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');

function sendTemp(message, payload, delayMs = 5000) {
  message.reply(payload).then(msg => {
    setTimeout(() => {
      msg.delete().catch(() => {});
      message.delete().catch(() => {});
    }, delayMs);
  }).catch(() => {});
}

module.exports = {
  name: 'remove',
  aliases: ['xoa', 'rm', 'delete'],
  description: 'Xóa một bài hát ra khỏi hàng chờ theo số thứ tự (ví dụ: .remove 2)',
  async execute(message, args) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để xóa bài hát.`);
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue || queue.songs.length === 0) {
      return message.reply('Hàng chờ hiện đang trống, không có bài hát nào để xóa!');
    }

    if (!args[0]) {
      return message.reply('Vui lòng nhập số thứ tự bài hát muốn xóa (ví dụ: `.remove 1` hoặc `.xoa 2`)!');
    }

    const index = parseInt(args[0], 10);
    if (isNaN(index) || index < 1 || index > queue.songs.length) {
      return message.reply(`Số thứ tự không hợp lệ! Vui lòng chọn từ 1 đến ${queue.songs.length}.`);
    }

    const removed = queue.songs.splice(index - 1, 1)[0];
    return message.reply(`Đã xóa thành công bài hát số ${index}: **${removed.title}** khỏi hàng chờ.`);
  }
};
