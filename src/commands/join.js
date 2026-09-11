const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createMusicControls, createEmbed } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'join',
  aliases: ['j', 'thamgia', 'vao', 'connect'],
  description: 'Invite bot to join your current voice channel',
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Invite bot to join your current voice channel')
    .setDescriptionLocalizations({
      vi: 'Mời bot tham gia vào kênh Voice của bạn'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return ctx.reply({ embeds: [createErrorEmbed(`Bạn cần có vai trò ${roleText} để mời bot vào phòng.`)] });
    }

    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) {
      return ctx.reply({ embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice trước!')] });
    }

    if (!isAllowedVoiceChannel(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      return ctx.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}>.`)] });
    }

    const permissions = voiceChannel.permissionsFor(ctx.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return ctx.reply({ embeds: [createErrorEmbed('Bot không có quyền kết nối hoặc phát âm thanh trong kênh Voice này!')] });
    }

    const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
    await queue.connect();

    const embed = createEmbed(
      '🎙️ Đã Tham Gia Kênh Voice',
      `Bot đã kết nối vào phòng <#${voiceChannel.id}> thành công!\n\n💡 **Cách phát nhạc:**\n• Bấm nút **\`➕ Thêm bài\`** bên dưới\n• Hoặc gõ lệnh \`/play <tên bài hoặc link>\``
    );
    const controls = createMusicControls(queue);

    const msg = await ctx.reply({ embeds: [embed], components: controls });
    if (!queue.currentSong && !ctx.isInteraction) {
      queue.nowPlayingMessage = msg;
    }
    return msg;
  }
};
