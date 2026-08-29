const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function formatSeconds(sec) {
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

module.exports = {
  name: 'seek',
  aliases: ['tua', 'forward', 'rewind'],
  description: 'Tua bài hát đang phát đến thời điểm chỉ định (Ví dụ: .seek 1:30 hoặc .seek 90)',
  usage: '<mm:ss | số giây>',
  async execute(message, args) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return message.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để tua nhạc.`)] });
    }

    const queue = musicManager.get(message.guild.id);
    if (!queue || !queue.currentSong) {
      return message.reply({ embeds: [createErrorEmbed('Hiện không có bài hát nào đang phát để tua!')] });
    }

    if (!args[0]) {
      return message.reply({ embeds: [createErrorEmbed('Vui lòng nhập thời gian muốn tua tới! Ví dụ: `.seek 1:30` hoặc `.seek 90`')] });
    }

    const targetSeconds = parseTimeToSeconds(args[0]);
    if (targetSeconds === null || targetSeconds < 0) {
      return message.reply({ embeds: [createErrorEmbed('Thời gian không hợp lệ! Vui lòng nhập định dạng `mm:ss` hoặc số giây (VD: `.seek 1:30`).')] });
    }

    try {
      await queue.seek(targetSeconds);
      return message.reply({
        embeds: [createSuccessEmbed(`⏩ Đã tua bài hát [**${queue.currentSong.title}**](${queue.currentSong.url}) đến **${formatSeconds(targetSeconds)}**`)]
      });
    } catch (err) {
      console.error('[Seek Command Error]:', err);
      return message.reply({ embeds: [createErrorEmbed(`Lỗi khi tua bài hát: ${err.message}`)] });
    }
  }
};
