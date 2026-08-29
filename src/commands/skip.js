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
  name: 'skip',
  aliases: ['s', 'sk', 'next'],
  description: 'Bỏ qua bài hát hiện tại',
  async execute(message) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để bỏ qua bài hát.`);
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue || !queue.currentSong) {
      return message.reply('Không có bài hát nào để bỏ qua!');
    }

    const currentTitle = queue.currentSong.title;
    queue.skip();
    return message.reply(`Đã bỏ qua bài hát: **${currentTitle}**`);
  }
};
