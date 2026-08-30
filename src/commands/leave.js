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

    // 🔒 BẢO VỆ CHẾ ĐỘ 24/7: Nếu 24/7 đang BẬT, chỉ Quản trị viên (Admin / ManageGuild / Owner) mới có quyền cho bot out!
    const is247 = queue ? queue.mode247 : Boolean(guildSettings.mode247);
    if (is247) {
      const isAdmin = message.member.permissions.has('Administrator') || 
                      message.member.permissions.has('ManageGuild') || 
                      message.guild.ownerId === message.author.id;
      if (!isAdmin) {
        return message.reply('🔒 **Chế độ Treo Lofi 24/7 đang được BẬT!**\nChỉ Quản trị viên máy chủ mới có quyền cho bot rời khỏi phòng Voice.');
      }
    }

    if (!hasMusicPermission(message.member)) {
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để cho bot rời phòng.`);
    }

    if (!queue) {
      return message.reply('Bot hiện không có mặt trong kênh Voice nào của máy chủ này!');
    }

    const memberVoice = message.member?.voice?.channel;
    if (!memberVoice) {
      return message.reply('Bạn cần ở trong phòng Voice để ngắt kết nối bot!');
    }

    // Nếu Admin đồng ý rời phòng, tắt 24/7 để bot không tự động nối lại
    if (queue.mode247) {
      queue.mode247 = false;
      settingsManager.update(message.guild.id, { mode247: false });
    }

    queue.destroy();
    return message.reply('👋 Đã ngắt kết nối và rời khỏi kênh Voice (Đã tắt chế độ 24/7).');
  }
};
