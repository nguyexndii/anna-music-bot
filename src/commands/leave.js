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
  name: 'leave',
  aliases: ['dc', 'dis', 'disconnect', 'out', 'roi'],
  description: 'Cho bot rời khỏi kênh Voice',
  async execute(message) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để cho bot rời phòng.`);
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue) {
      return message.reply('Bot hiện không có mặt trong kênh Voice nào của máy chủ này!');
    }

    const memberVoice = message.member?.voice?.channel;
    if (!memberVoice) {
      return message.reply('Bạn cần ở trong phòng Voice để ngắt kết nối bot!');
    }

    queue.destroy();
    return message.reply('Đã ngắt kết nối và rời khỏi kênh Voice.');
  }
};
