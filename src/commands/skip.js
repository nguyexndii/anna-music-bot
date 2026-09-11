const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'skip',
  aliases: ['s', 'sk', 'next'],
  description: 'Skip current song',
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song')
    .setDescriptionLocalizations({
      vi: 'Bỏ qua bài hát hiện tại'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để bỏ qua bài hát.`);
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Không có bài hát nào để bỏ qua!');
    }

    const currentTitle = queue.currentSong.title;
    queue.skip();
    return ctx.reply(`⏭️ Đã bỏ qua bài hát: **${currentTitle}**`);
  }
};
