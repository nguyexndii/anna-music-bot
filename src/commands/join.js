const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createMusicControls, createEmbed } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

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
    const guildId = ctx.guild.id;

    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.dj_only', { role: roleText }))] });
    }

    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.no_voice'))] });
    }

    if (!isAllowedVoiceChannel(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.voice_locked', { channelId: guildSettings.lockedVoiceChannelId }))] });
    }

    const permissions = voiceChannel.permissionsFor(ctx.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return ctx.reply({ embeds: [createErrorEmbed(t(guildId, 'common.command_error'))] });
    }

    const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
    await queue.connect();

    const isEn = settingsManager.get(guildId)?.language === 'en';
    const title = isEn ? '🎙️ Joined Voice Channel' : '🎙️ Đã Tham Gia Kênh Voice';
    const desc = isEn
      ? `Bot successfully joined <#${voiceChannel.id}>!\n\n💡 **How to play music:**\n• Click **\`➕ Add Song\`** button below\n• Or type \`/play <song name or link>\``
      : `Bot đã kết nối vào phòng <#${voiceChannel.id}> thành công!\n\n💡 **Cách phát nhạc:**\n• Bấm nút **\`➕ Thêm bài\`** bên dưới\n• Hoặc gõ lệnh \`/play <tên bài hoặc link>\``;

    const embed = createEmbed(title, desc);
    const controls = createMusicControls(queue);

    return ctx.reply({ embeds: [embed], components: controls });
  }
};
