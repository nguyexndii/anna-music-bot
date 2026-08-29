const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createMusicControls, createEmbed } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');

module.exports = {
  name: 'join',
  aliases: ['j', 'thamgia', 'vao', 'connect'],
  description: 'Mời bot tham gia vào kênh Voice của bạn và hiển thị bảng điều khiển',
  async execute(message) {
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return message.reply({ embeds: [createErrorEmbed(`Bạn cần có vai trò ${roleText} để mời bot vào phòng.`)] });
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply({ embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice trước!')] });
    }

    if (!isAllowedVoiceChannel(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      return message.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}>.`)] });
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return message.reply({ embeds: [createErrorEmbed('Bot không có quyền kết nối hoặc phát âm thanh trong kênh Voice này!')] });
    }

    const queue = musicManager.getOrCreate(message.guild, message.channel, voiceChannel);
    await queue.connect();

    const embed = createEmbed(
      '🎙️ Đã Tham Gia Kênh Voice',
      `Bot đã kết nối vào phòng <#${voiceChannel.id}> thành công!\n\n💡 **Cách phát nhạc:**\n• Bấm nút **\`➕ Thêm bài\`** bên dưới\n• Hoặc gõ lệnh \`.p <tên bài hoặc link>\``
    );
    const controls = createMusicControls(queue);

    const msg = await message.reply({ embeds: [embed], components: controls });
    if (!queue.currentSong) {
      queue.nowPlayingMessage = msg;
    }
    return msg;
  }
};
