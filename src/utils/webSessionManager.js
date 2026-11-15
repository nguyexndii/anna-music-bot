/**
 * webSessionManager.js
 *
 * Quản lý vòng đời phiên mã PIN và link Web Player trên Discord:
 * - Tự động vô hiệu hóa và cập nhật tin nhắn cũ khi người dùng yêu cầu mã mới.
 * - Tự động cập nhật tin nhắn khi đăng nhập thành công vào Web Player.
 * - Tự động hết hạn và cập nhật tin nhắn sau đúng 2 phút (120 giây).
 */

const { t } = require('./i18n');
const { EMOJI_TAG } = require('./embed');

// Map lưu trữ: key = `${guildId}_${userId}` => { interaction, replyMsg, timer, pin, token, guildId, userId, isEn }
global._userActiveWebMessages = global._userActiveWebMessages || new Map();
const activeWebMessages = global._userActiveWebMessages;

/**
 * Đăng ký một phiên Web Player mới cho User
 * @param {Object} session
 * @param {string} session.guildId
 * @param {string} session.userId
 * @param {Object} [session.interaction]
 * @param {Object} [session.replyMsg]
 * @param {string} session.pin
 * @param {string} session.token
 * @param {boolean} [session.isEn]
 * @param {Object} [session.client]
 */
function registerWebSession({ guildId, userId, interaction, replyMsg, pin, token, isEn = false, client = null }) {
  if (!guildId || !userId) return;
  const sessionKey = `${guildId}_${userId}`;

  // 1. Nếu đã có phiên cũ của User trên máy chủ này -> Vô hiệu hóa ngay lập tức
  const prevSession = activeWebMessages.get(sessionKey);
  if (prevSession) {
    if (prevSession.timer) {
      clearTimeout(prevSession.timer);
    }
    // Xóa mã cũ khỏi tokenStore
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
                content: prevSession.isEn
                  ? `### ${EMOJI_TAG.warning} Web Player PIN Invalidated\n${EMOJI_TAG.warning} **This PIN and link have been invalidated** because you requested a new one.\n\nPlease use the latest PIN and link message!`
                  : `### ${EMOJI_TAG.warning} Mã PIN Web Player Đã Bị Vô Hiệu Hóa\n${EMOJI_TAG.warning} **Mã PIN này đã bị vô hiệu hóa** do bạn vừa yêu cầu cấp mã mới.\n\nVui lòng sử dụng mã PIN và liên kết trong tin nhắn mới nhất!`
              }
            ],
            accessory: client ? {
              type: 11,
              media: { url: client.user.displayAvatarURL() }
            } : undefined
          }
        ]
      };

      if (prevSession.interaction && typeof prevSession.interaction.editReply === 'function') {
        prevSession.interaction.editReply({ components: [supersededContainer] }).catch(() => {});
      } else if (prevSession.replyMsg && typeof prevSession.replyMsg.edit === 'function') {
        prevSession.replyMsg.edit({ components: [supersededContainer] }).catch(() => {});
      }
    } catch (_) {}

    activeWebMessages.delete(sessionKey);
  }

  // 2. Thiết lập Timer tự động hết hạn đúng 2 phút (120 giây)
  const timer = setTimeout(async () => {
    try {
      const current = activeWebMessages.get(sessionKey);
      if (current && current.pin === pin) {
        activeWebMessages.delete(sessionKey);
        if (global._tokenStore) {
          global._tokenStore.delete(pin);
          global._tokenStore.delete(token);
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
                  content: isEn
                    ? `### ${EMOJI_TAG.warning} Web Player PIN Expired\n${EMOJI_TAG.warning} **This PIN and link have expired (2 minutes).** Please type \`/web\` or click the button to generate a new one.`
                    : `### ${EMOJI_TAG.warning} Mã PIN Web Player Đã Hết Hạn\n${EMOJI_TAG.warning} **Mã PIN và liên kết này đã hết hạn hiệu lực (2 phút).** Vui lòng gõ \`/web\` hoặc bấm nút để lấy mã mới.`
                }
              ],
              accessory: client ? {
                type: 11,
                media: { url: client.user.displayAvatarURL() }
              } : undefined
            }
          ]
        };

        if (interaction && typeof interaction.editReply === 'function') {
          await interaction.editReply({ components: [expiredContainer] }).catch(() => {});
        } else if (replyMsg && typeof replyMsg.edit === 'function') {
          await replyMsg.edit({ components: [expiredContainer] }).catch(() => {});
        }
      }
    } catch (_) {}
  }, 120 * 1000);

  // 3. Lưu phiên mới vào Map
  activeWebMessages.set(sessionKey, {
    guildId,
    userId,
    interaction,
    replyMsg,
    timer,
    pin,
    token,
    isEn,
    client
  });
}

/**
 * Cập nhật tin nhắn Discord khi User đăng nhập thành công vào Web Player
 * @param {string} userId
 * @param {string} guildId
 * @param {string} [pin]
 */
function notifyWebSessionSuccess(userId, guildId, pin = null) {
  if (!userId) return;

  // Tìm phiên theo sessionKey hoặc duyệt qua map nếu guildId không khớp
  let session = null;
  let foundKey = null;

  if (guildId) {
    const key = `${guildId}_${userId}`;
    if (activeWebMessages.has(key)) {
      session = activeWebMessages.get(key);
      foundKey = key;
    }
  }

  if (!session) {
    for (const [k, s] of activeWebMessages.entries()) {
      if (s.userId === String(userId) && (!pin || s.pin === String(pin))) {
        session = s;
        foundKey = k;
        break;
      }
    }
  }

  if (!session) return;

  // Hủy timer hết hạn vì đã kết nối thành công
  if (session.timer) {
    clearTimeout(session.timer);
  }
  activeWebMessages.delete(foundKey);

  try {
    const isEn = session.isEn;
    const client = session.client;

    const successContainer = {
      type: 17,
      accent_color: 0x57F287,
      components: [
        {
          type: 9,
          components: [
            {
              type: 10,
              content: isEn
                ? `### ${EMOJI_TAG.correct} Web Player Connected\n${EMOJI_TAG.correct} **Successfully connected to Web Player!** Session is active.`
                : `### ${EMOJI_TAG.correct} Đã Kết Nối Web Player\n${EMOJI_TAG.correct} **Đã kết nối Web Player thành công!** Phiên đăng nhập đang hoạt động.`
            }
          ],
          accessory: client ? {
            type: 11,
            media: { url: client.user.displayAvatarURL() }
          } : undefined
        }
      ]
    };

    if (session.interaction && typeof session.interaction.editReply === 'function') {
      session.interaction.editReply({ components: [successContainer] }).catch(() => {});
    } else if (session.replyMsg && typeof session.replyMsg.edit === 'function') {
      session.replyMsg.edit({ components: [successContainer] }).catch(() => {});
    }
  } catch (_) {}
}

module.exports = {
  registerWebSession,
  notifyWebSessionSuccess,
  activeWebMessages
};
