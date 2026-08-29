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
  name: 'stop',
  aliases: ['st', 'off'],
  description: 'Dừng nhạc và xóa hàng chờ',
  async execute(message) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để dừng nhạc.`);
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue) {
      return message.reply('Bot hiện không phát nhạc trong máy chủ này!');
    }

    const memberVoice = message.member?.voice?.channel;
    if (!memberVoice) {
      return message.reply('Bạn cần tham gia vào phòng Voice để dừng nhạc!');
    }

    queue.stop();
    const modeText = queue.mode247 ? ' (Bot vẫn duy trì trong voice vì đang bật chế độ 24/7)' : '';
    return message.reply(`Đã dừng phát nhạc và xóa toàn bộ hàng chờ.${modeText}`);
  }
};
