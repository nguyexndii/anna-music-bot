const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'loop',
  aliases: ['l', 'repeat'],
  description: 'Toggle loop mode for current song or entire queue',
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode for current song or entire queue')
    .setDescriptionLocalizations({
      vi: 'Bật/tắt chế độ lặp lại bài hát hoặc hàng chờ'
    })
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Loop mode (Off, Song, Queue)')
        .setDescriptionLocalizations({
          vi: 'Chọn chế độ lặp: Tắt (Off), Lặp 1 bài (Song), Lặp toàn bộ hàng chờ (Queue)'
        })
        .setRequired(false)
        .addChoices(
          { name: 'Off', name_localizations: { vi: 'Tắt lặp (Off)' }, value: 'off' },
          { name: 'Current Song', name_localizations: { vi: 'Lặp bài hiện tại (Song)' }, value: 'song' },
          { name: 'Entire Queue', name_localizations: { vi: 'Lặp toàn bộ hàng chờ (Queue)' }, value: 'queue' }
        )
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply({ embeds: [createErrorEmbed(`Bạn cần có vai trò ${roleText} để đổi chế độ lặp.`)] });
    }

    const queue = musicManager.get(ctx.guild.id);
    if (!queue) {
      return ctx.reply({ embeds: [createErrorEmbed('Bot hiện không ở trong kênh Voice!')] });
    }

    if (queue.currentSong?.is247 || queue.currentSong?.requestedBy === 'Auto (24/7)' || (queue.mode247 && !queue.currentSong)) {
      return ctx.reply({ embeds: [createErrorEmbed('♾️ Bot đang phát Đài Radio Lofi 24/7 tự động. Bạn không thể dừng/tua/bỏ qua đài Radio, hãy dùng lệnh /play <tên bài> để phát nhạc của bạn nhé!')] });
    }

    if (!ctx.member?.voice?.channel || (queue.voiceChannel && ctx.member.voice.channel.id !== queue.voiceChannel.id)) {
      return ctx.reply({ embeds: [createErrorEmbed('Bạn phải ở trong cùng kênh Voice với bot để dùng lệnh này!')] });
    }

    const modeOpt = ctx.options.getString('mode');
    let mode;
    if (modeOpt) {
      queue.setLoop(modeOpt);
      mode = modeOpt;
    } else {
      mode = queue.toggleLoop();
    }

    const modeText = mode === 'song' ? '🔂 Bài hát hiện tại' : mode === 'queue' ? '🔁 Toàn bộ hàng chờ' : '➡️ Tắt';
    return ctx.reply({ embeds: [createSuccessEmbed(`Đã thay đổi chế độ lặp: **${modeText}**`)] });
  }
};
