const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'pause',
  aliases: [],
  description: 'Pause currently playing song',
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause currently playing song')
    .setDescriptionLocalizations({
      vi: 'Tạm dừng bài hát đang phát'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(`Bạn cần có vai trò ${roleText} để tạm dừng bài hát.`);
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue || !queue.currentSong) {
      return ctx.reply('Hiện không có bài hát nào đang phát!');
    }

    if (!ctx.member?.voice?.channel || (queue.voiceChannel && ctx.member.voice.channel.id !== queue.voiceChannel.id)) {
      return ctx.reply('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!');
    }

    if (queue.paused) {
      return ctx.reply('Nhạc hiện tại đã bị tạm dừng trước đó!');
    }

    queue.togglePause();
    return ctx.reply('⏸️ Đã tạm dừng phát nhạc.');
  }
};
