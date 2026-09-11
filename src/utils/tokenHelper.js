const crypto = require('crypto');
const config = require('../config');

// In-memory global token/PIN store with auto cleanup
global._tokenStore = global._tokenStore || new Map();
const tokenStore = global._tokenStore;

// Periodic cleanup of expired tokens every 1 minute
if (!global._tokenStoreCleaner) {
  global._tokenStoreCleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of tokenStore.entries()) {
      if (data.exp < now) {
        tokenStore.delete(key);
      }
    }
  }, 60 * 1000);
}

let secretKeySource = config.webJwtSecret || process.env.WEB_JWT_SECRET;
if (!secretKeySource) {
  if (!global._warnedWebJwtSecret) {
    console.warn('[TokenHelper] Cảnh báo: Chưa cấu hình WEB_JWT_SECRET trong biến môi trường, đang fallback về token bot.');
    global._warnedWebJwtSecret = true;
  }
  secretKeySource = config.token || 'anna-music-secret-key-2026';
}

const SECRET_KEY = crypto.createHash('sha256').update(secretKeySource).digest();

/**
 * Tạo Mã PIN 6 số và Token dùng 1 lần (One-Time Token) cho User khi gõ lệnh /web
 * @param {Object} userData - { userId, username, displayName, avatar, guildId, guildName }
 * @param {number} pinExpiryMinutes - Thời hạn mã PIN (mặc định 3 phút)
 * @param {number} sessionExpiryHours - Thời hạn phiên đăng nhập khi đổi mã (mặc định 24 tiếng)
 * @returns {{ token: string, pin: string }}
 */
function generateWebToken(userData, pinExpiryMinutes = 3, sessionExpiryHours = 24) {
  const userIdStr = String(userData.userId);

  // 0. Dọn dẹp các mã một lần cũ của user này
  const now = Date.now();
  for (const [key, val] of tokenStore.entries()) {
    if (val && String(val.userId) === userIdStr) {
      if (val.exp < now || val.isOneTime) {
        tokenStore.delete(key);
      }
    }
  }

  const pinExp = now + pinExpiryMinutes * 60 * 1000;
  const linkExp = now + 5 * 60 * 1000; // Link mở web có hiệu lực 5 phút

  // 1. Tạo mã PIN 6 số ngẫu nhiên mới (hiệu lực 3 phút, dùng 1 lần)
  const pin = Math.floor(100000 + Math.random() * 900000).toString();

  // 2. Tạo Mã Dùng 1 Lần cho đường Link Web (One-Time Access Token)
  const oneTimeCode = `otc_${crypto.randomBytes(24).toString('base64url')}`;

  const baseData = {
    userId: String(userData.userId),
    username: userData.username,
    displayName: userData.displayName || userData.username,
    avatar: userData.avatar,
    guildId: String(userData.guildId),
    guildName: userData.guildName || 'Server',
    sessionExpiryHours
  };

  // Lưu PIN và OTC vào store, đánh dấu isOneTime = true
  tokenStore.set(pin, { ...baseData, pin, isOneTime: true, exp: pinExp });
  tokenStore.set(oneTimeCode, { ...baseData, isOneTime: true, exp: linkExp });

  return { token: oneTimeCode, pin };
}

/**
 * Tạo/Gia hạn một Session Token HMAC mới (lưu vào thiết bị của user sau khi đổi mã 1 lần)
 * @param {Object} userData
 * @param {number} sessionExpiryHours (mặc định 24 tiếng)
 * @returns {string} HMAC Token
 */
function createSessionToken(userData, sessionExpiryHours = 24) {
  const sessionExp = Date.now() + sessionExpiryHours * 60 * 60 * 1000;
  const sessionPayload = {
    userId: String(userData.userId),
    username: userData.username,
    displayName: userData.displayName || userData.username,
    avatar: userData.avatar,
    guildId: String(userData.guildId),
    guildName: userData.guildName || 'Server',
    exp: sessionExp
  };
  const base64Payload = Buffer.from(JSON.stringify(sessionPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('base64url');
  const token = `${base64Payload}.${signature}`;
  tokenStore.set(token, sessionPayload);
  return token;
}

/**
 * Xác thực PIN 6 số hoặc Token từ Web.
 * Nếu là mã dùng 1 lần (OTC hoặc PIN) và consume = true, mã sẽ bị XÓA HỦY ngay lập tức và trả về sessionToken mới.
 * @param {string|number} tokenOrPin
 * @param {boolean} consume - Có tiêu hủy mã dùng 1 lần hay không
 * @returns {Object|null} Payload nếu hợp lệ, null nếu không hợp lệ
 */
function verifyWebToken(tokenOrPin, consume = false) {
  if (!tokenOrPin) {
    return null;
  }

  const cleanInput = String(tokenOrPin).trim().replace(/\s+/g, '');
  if (!cleanInput) return null;

  // 1. Kiểm tra trong memory store (PIN 6 số hoặc One-Time Token)
  const stored = tokenStore.get(cleanInput);
  if (stored) {
    if (Date.now() > stored.exp) {
      tokenStore.delete(cleanInput);
      return null;
    }

    if (stored.isOneTime) {
      if (consume) {
        // Tiêu hủy mã 1 lần ngay lập tức để không ai dùng lại được
        tokenStore.delete(cleanInput);
        const sessionToken = createSessionToken(stored, stored.sessionExpiryHours || 24);
        return { ...stored, sessionToken };
      }
      return stored;
    }

    return stored;
  }

  // 2. Fallback kiểm tra HMAC signature nếu là token dài (Session Token đã cấp cho thiết bị)
  if (cleanInput.includes('.')) {
    const [base64Payload, signature] = cleanInput.split('.');
    if (!base64Payload || !signature) return null;

    const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('base64url');
    if (signature !== expectedSignature) return null;

    try {
      const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
      if (Date.now() > payload.exp) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  return null;
}

module.exports = {
  generateWebToken,
  createSessionToken,
  verifyWebToken
};
