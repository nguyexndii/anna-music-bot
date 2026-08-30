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
    const guildSettings = settingsManager.get(message.guild.id);
    const queue = musicManager.get(message.guild.id);

    // BẢO VỆ CHẾ ĐỘ 24/7
    const is247 = queue ? queue.mode247 : Boolean(guildSettings.mode247);
    if (is247) {
      const isAdmin = message.member.permissions.has('Administrator') || 
                      message.member.permissions.has('ManageGuild') || 
                      message.guild.ownerId === message.author.id;
      if (!isAdmin) {
        return sendTemp(message, 'Đang bật chế độ 24/7.', 3000);
      }
    }

    if (!hasMusicPermission(message.member)) {
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return sendTemp(message, `Cần vai trò ${roleText} để out bot.`, 3000);
    }

    if (!queue) {
      return sendTemp(message, 'Bot không ở trong phòng Voice nào!', 3000);
    }

    const memberVoice = message.member?.voice?.channel;
    if (!memberVoice) {
      return sendTemp(message, 'Bạn cần vào phòng Voice trước!', 3000);
    }

    // Nếu Admin đồng ý rời phòng, tắt 24/7
    if (queue.mode247) {
      queue.mode247 = false;
      settingsManager.update(message.guild.id, { mode247: false });
    }

    queue.destroy();
    return sendTemp(message, 'Đã ngắt kết nối và rời Voice.', 3000);
  }
};
