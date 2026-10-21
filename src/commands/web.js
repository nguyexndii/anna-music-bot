const { SlashCommandBuilder } = require('discord.js');
const { generateWebToken, invalidateUserTokens } = require('../utils/tokenHelper');
const { getActiveTunnelUrl } = require('../utils/statusNotifier');
const { createErrorEmbed, CUSTOM_EMOJIS } = require('../utils/embed');
const { isAllowedVoiceChannel } = require('../utils/permissionHelper');
const settingsManager = require('../structures/SettingsManager');
const { createContext } = require('../utils/commandHelper');
const config = require('../config');

// Lưu trữ các phiên web đang active theo User ID để vô hiệu hóa và sửa tin nhắn cũ
const userActiveWebMessages = new Map();

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

    // 1. Kiểm tra User có trong kênh Voice hay không
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')]
      }, 7000);
    }

    // 2. Kiểm tra kênh Voice bị khóa
    const guildSettings = settingsManager.get(guild.id);
    if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(member)) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)]
      }, 7000);
    }

    // 0. Nếu người dùng đã có tin nhắn /web cũ đang hoạt động -> vô hiệu hóa mã PIN/OTC cũ và sửa tin nhắn cũ
    const prevSession = userActiveWebMessages.get(author.id);
    if (prevSession) {
      if (prevSession.timer) {
        clearTimeout(prevSession.timer);
      }
      if (global._tokenStore) {
        if (prevSession.pin) global._tokenStore.delete(prevSession.pin);
        if (prevSession.token) global._tokenStore.delete(prevSession.token);
      }
      try {
        const supersededContainer = {
          type: 17,
          accent_color: 0x95a5a6,
          components: [
            {
              type: 9,
              components: [
                {
                  type: 10,
                  content: '### ⚠️ Mã PIN Web Player Đã Hết Hiệu Lực\nMã PIN và liên kết đăng nhập này **đã hết hiệu lực** vì bạn vừa yêu cầu một mã mới qua lệnh `/web`.\n\nVui lòng sử dụng mã PIN và liên kết trong tin nhắn mới nhất!'
                }
              ],
              accessory: {
                type: 11,
                media: { url: client.user.displayAvatarURL() }
              }
            }
          ]
        };

        if (prevSession.interaction) {
          prevSession.interaction.editReply({ components: [supersededContainer] }).catch(() => {});
        } else if (prevSession.replyMsg && typeof prevSession.replyMsg.edit === 'function') {
          prevSession.replyMsg.edit({ components: [supersededContainer] }).catch(() => {});
        }
      } catch (e) {}
      userActiveWebMessages.delete(author.id);
    }

    // 3. Tạo User data và Magic Token (kèm PIN 6 số hiệu lực 3 phút, session 2 giờ)
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

    const { token, pin } = generateWebToken(userData, 3, 24);
    const tunnelUrl = getActiveTunnelUrl();
    const baseUrl = (config.webUrl || 'https://anna-music-bot-ui.pages.dev');
    const tunnelParam = tunnelUrl ? `&tunnel=${encodeURIComponent(tunnelUrl)}` : '';
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
              content: `### Bảng Điều Khiển Web Player — Anna Music\nNhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${guild.name}**.`
            }
          ],
          accessory: {
            type: 11,
            media: { url: client.user.displayAvatarURL() }
          }
        },
        {
          type: 10,
          content: `🔊 **Kênh Voice:** <#${userVoice.id}>\n🔑 **Mã PIN Kết Nối:** \`${pin}\` *(hiệu lực 3 phút)*`
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5, // ButtonStyle.Link
              label: 'Mở Trình Phát Web Player',
              url: webUrl,
              emoji: CUSTOM_EMOJIS.web || { name: '🌐' }
            }
          ]
        },
        {
          type: 10,
          content: '-# Mã PIN dùng 1 lần sẽ tự hủy sau khi mở • Hết hạn tự động sau 3 phút'
        }
      ]
    };

    try {
      const replyFlags = 32768 | (ctx.isInteraction ? 64 : 0);
      const replyMsg = await ctx.reply({ components: [webContainer], flags: replyFlags });

      // Tự động vô hiệu hóa mã PIN sau 3 phút
      const timer = setTimeout(async () => {
        try {
          const currentActive = userActiveWebMessages.get(author.id);
          if (currentActive && currentActive.pin === pin) {
            userActiveWebMessages.delete(author.id);
            if (global._tokenStore) {
              global._tokenStore.delete(pin);
              global._tokenStore.delete(token);
            }
          }

          const expiredContainer = {
            type: 17,
            accent_color: 0xef7864,
            components: [
              {
                type: 9,
                components: [
                  {
                    type: 10,
                    content: '### ⚠️ Mã PIN Web Player Đã Hết Hạn\nMã PIN và liên kết đăng nhập đã tự hủy sau **3 phút** vì lý do bảo mật.\n\nNếu bạn muốn mở lại Web Player, vui lòng gõ lại lệnh `/web` để nhận mã mới nhé!'
                  }
                ],
                accessory: {
                  type: 11,
                  media: { url: client.user.displayAvatarURL() }
                }
              }
            ]
          };

          if (ctx.isInteraction && ctx.interaction) {
            await ctx.interaction.editReply({ components: [expiredContainer] }).catch(() => {});
          } else if (replyMsg && typeof replyMsg.edit === 'function') {
            await replyMsg.edit({ components: [expiredContainer] }).catch(() => {});
          }
        } catch (e) {}
      }, 180 * 1000);

      userActiveWebMessages.set(author.id, {
        interaction: ctx.isInteraction ? ctx.interaction : null,
        replyMsg,
        timer,
        pin,
        token
      });
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
