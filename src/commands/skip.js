const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'skip',
  aliases: ['s', 'sk', 'next', 'fs', 'forceskip'],
  description: 'Skip current song',
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song')
    .setDescriptionLocalizations({
      vi: 'Bỏ qua bài hát hiện tại (hỗ trợ lệnh tắt /s, /fs)'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để bỏ qua bài hát.`);
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!');
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Không có bài hát nào để bỏ qua!');
    }

    if (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)' || (queue.mode247 && !queue.currentSong)) {
      return ctx.reply('♾️ Bot đang phát Đài Radio Lofi 24/7 tự động. Bạn không thể dừng/tua/bỏ qua đài Radio, hãy dùng lệnh /play <tên bài> để phát nhạc của bạn nhé!');
    }

    const currentTitle = queue.currentSong.title;
    queue.skip();
    return ctx.reply(`⏭️ Đã bỏ qua bài hát: **${currentTitle}**`);
  }
};
