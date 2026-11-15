const crypto = require('crypto');
const { SlashCommandBuilder } = require('discord.js');
const { generateWebToken } = require('../utils/tokenHelper');
const { registerWebSession } = require('../utils/webSessionManager');
const { getActiveTunnelUrl } = require('../utils/statusNotifier');
const { createErrorEmbed, CUSTOM_EMOJIS } = require('../utils/embed');
const { isAllowedVoiceChannel } = require('../utils/permissionHelper');
const settingsManager = require('../structures/SettingsManager');
const { createContext } = require('../utils/commandHelper');
const config = require('../config');

function signTunnelUrl(url, secret) {
  if (!url || !secret) return '';
  return crypto.createHmac('sha256', secret).update(url.trim().replace(/\/$/, '')).digest('hex');
}

module.exports = {
  name: 'web',
  description: 'Open Web Player music controller interface and get PIN',
  data: new SlashCommandBuilder()
    .setName('web')
    .setDescription('Open Web Player music controller interface and get PIN')
    .setDescriptionLocalizations({
      vi: 'Mở giao diện Web Player điều khiển âm nhạc và lấy mã PIN kết nối'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const client = ctx.client;
    const guild = ctx.guild;
    const member = ctx.member;
    const author = ctx.user;

    const guildSettings = settingsManager.get(guild.id);
    const isEn = guildSettings?.language === 'en';

    // 1. Kiểm tra User có trong kênh Voice hay không
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed(isEn ? 'You must be in a Voice channel to use Web Player!' : 'Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')]
      }, 7000);
    }

    // 2. Kiểm tra kênh Voice bị khóa
    if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(member)) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed(isEn ? `Server voice channel is locked! Please join <#${guildSettings.lockedVoiceChannelId}> to use Web Player.` : `Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)]
      }, 7000);
    }

    // 3. Tạo User data và Magic Token (kèm PIN 6 số hiệu lực 2 phút, session 24 giờ)
    const isAdmin = member?.permissions?.has('Administrator') || member?.permissions?.has('ManageGuild') || guild.ownerId === author.id;
    const avatarUrl = author.displayAvatarURL({ dynamic: true, size: 256 });
    const userData = {
      userId: author.id,
      username: author.username,
      displayName: member?.displayName || author.globalName || author.username,
      avatar: avatarUrl,
      guildId: guild.id,
      guildName: guild.name,
      isAdmin: Boolean(isAdmin)
    };

    const { token, pin } = generateWebToken(userData, 2, 24);
    const tunnelUrl = getActiveTunnelUrl();
    const baseUrl = (config.webUrl || 'https://anna-music-bot-ui.pages.dev');
    const tunnelSig = tunnelUrl && config.webJwtSecret ? signTunnelUrl(tunnelUrl, config.webJwtSecret) : '';
    const tunnelParam = tunnelUrl ? `&tunnel=${encodeURIComponent(tunnelUrl)}${tunnelSig ? `&tsig=${tunnelSig}` : ''}` : '';
    const webUrl = `${baseUrl}/?token=${token}&guild=${guild.id}${tunnelParam}`;

    // 4. Tạo Components V2 Container
    const webContainer = {
      type: 17,
      accent_color: 0x2B7FFF,
      components: [
        {
          type: 9,
          components: [
            {
              type: 10,
              content: isEn ? `### Web Player Controller — Anna Music\nClick the button below to open music controller interface for **${guild.name}**.` : `### Bảng Điều Khiển Web Player — Anna Music\nNhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${guild.name}**.`
            }
          ],
          accessory: {
            type: 11,
            media: { url: client.user.displayAvatarURL() }
          }
        },
        {
          type: 10,
          content: isEn ? `🔊 **Voice Channel:** <#${userVoice.id}>\n🔑 **Connection PIN:** \`${pin}\` *(valid for 2 minutes)*` : `🔊 **Kênh Voice:** <#${userVoice.id}>\n🔑 **Mã PIN Kết Nối:** \`${pin}\` *(hiệu lực 2 phút)*`
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5, // ButtonStyle.Link
              label: isEn ? 'Open Web Player' : 'Mở Trình Phát Web Player',
              url: webUrl,
              emoji: CUSTOM_EMOJIS.web || { name: '🌐' }
            }
          ]
        },
        {
          type: 10,
          content: isEn ? '-# One-time PIN self-destructs after opening • Automatically expires in 2 minutes' : '-# Mã PIN dùng 1 lần sẽ tự hủy sau khi mở • Hết hạn tự động sau 2 phút'
        }
      ]
    };

    try {
      const replyFlags = 32768 | (ctx.isInteraction ? 64 : 0);
      const replyMsg = await ctx.reply({ components: [webContainer], flags: replyFlags });

      // Đăng ký phiên vào webSessionManager
      registerWebSession({
        guildId: guild.id,
        userId: author.id,
        interaction: ctx.isInteraction ? ctx.interaction : null,
        replyMsg,
        pin,
        token,
        isEn,
        client
      });
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
