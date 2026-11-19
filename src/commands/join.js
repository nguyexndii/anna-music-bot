const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, createMusicControls, createEmbed, CUSTOM_EMOJIS } = require('../utils/embed');
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

    const joinContainer = {
      type: 17,
      accent_color: 0x2B2D31,
      components: [
        {
          type: 9,
          components: [
            {
              type: 10,
              content: isEn
                ? `### Connected to Voice\nBot joined <#${voiceChannel.id}> successfully.`
                : `### Đã Kết Nối Voice\nBot đã tham gia phòng <#${voiceChannel.id}> thành công.`
            }
          ],
          accessory: {
            type: 11,
            media: { url: ctx.client.user.displayAvatarURL() }
          }
        },
        {
          type: 10,
          content: isEn
            ? `Click **Add Song** below or type \`/play <name or url>\` to play music.`
            : `Bấm nút **Thêm bài** bên dưới hoặc gõ \`/play <tên bài hoặc link>\` để phát nhạc.`
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              custom_id: 'btn_add_song',
              label: isEn ? 'Add Song' : 'Thêm bài',
              emoji: CUSTOM_EMOJIS?.add || { name: '➕' }
            },
            {
              type: 2,
              style: 2,
              custom_id: 'btn_queue',
              label: isEn ? 'Queue' : 'Hàng chờ',
              emoji: CUSTOM_EMOJIS?.queue || { name: '📜' }
            },
            {
              type: 2,
              style: 2,
              custom_id: 'btn_web_player',
              label: 'Web Player',
              emoji: CUSTOM_EMOJIS?.web || { name: '🌐' }
            }
          ]
        }
      ]
    };

    return ctx.reply({ components: [joinContainer], flags: 32768 });
  }
};
