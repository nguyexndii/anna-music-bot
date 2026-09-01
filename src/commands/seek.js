const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

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
  description: 'Seek to a specific timestamp in currently playing song',
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a specific timestamp in currently playing song')
    .setDescriptionLocalizations({
      vi: 'Tua bài hát đang phát đến thời điểm chỉ định'
    })
    .addStringOption(opt =>
      opt
        .setName('time')
        .setDescription('Target timestamp (e.g. 1:30 or 90)')
        .setDescriptionLocalizations({
          vi: 'Thời gian cần tua đến (VD: 1:30 hoặc 90)'
        })
        .setRequired(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return ctx.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để tua nhạc.`)] });
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply({ embeds: [createErrorEmbed('Hiện không có bài hát nào đang phát để tua!')] });
    }

    const timeInput = ctx.options.getString('time') || (args ? args[0] : null);
    if (!timeInput) {
      return ctx.reply({ embeds: [createErrorEmbed('Vui lòng nhập thời gian muốn tua tới! Ví dụ: `/seek 1:30` hoặc `/seek 90`')] });
    }

    const targetSeconds = parseTimeToSeconds(timeInput);
    if (targetSeconds === null || targetSeconds < 0) {
      return ctx.reply({ embeds: [createErrorEmbed('Thời gian không hợp lệ! Vui lòng nhập định dạng `mm:ss` hoặc số giây (VD: `1:30`).')] });
    }

    try {
      await queue.seek(targetSeconds);
      return ctx.reply({
        embeds: [createSuccessEmbed(`⏩ Đã tua bài hát [**${queue.currentSong.title}**](${queue.currentSong.url}) đến **${formatSeconds(targetSeconds)}**`)]
      });
    } catch (err) {
      console.error('[Seek Command Error]:', err);
      return ctx.reply({ embeds: [createErrorEmbed(`Lỗi khi tua bài hát: ${err.message}`)] });
    }
  }
};
