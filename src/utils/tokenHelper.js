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
 * Tạo Mã PIN 6 số và Token cho User khi gõ lệnh .web
 * @param {Object} userData - { userId, username, displayName, avatar, guildId, guildName }
 * @param {number} pinExpiryMinutes - Thời hạn mã PIN (mặc định 2 phút)
 * @param {number} sessionExpiryHours - Thời hạn phiên đăng nhập HMAC (mặc định 2 tiếng)
 * @returns {{ token: string, pin: string }}
 */
function generateWebToken(userData, pinExpiryMinutes = 2, sessionExpiryHours = 2) {
  const pinExp = Date.now() + pinExpiryMinutes * 60 * 1000;
  const sessionExp = Date.now() + sessionExpiryHours * 60 * 60 * 1000;

  // 1. Tạo mã PIN 6 số ngẫu nhiên (hiệu lực ngắn: 2 phút)
  const pin = Math.floor(100000 + Math.random() * 900000).toString();

  const pinPayload = {
    userId: String(userData.userId),
    username: userData.username,
    displayName: userData.displayName || userData.username,
    avatar: userData.avatar,
    guildId: String(userData.guildId),
    guildName: userData.guildName || 'Server',
    pin,
    exp: pinExp
  };

  // 2. Tạo HMAC session token (hiệu lực 2 tiếng)
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

  // Lưu PIN vào store (ngắn hạn), Token lưu để HMAC fallback verify không cần store
  tokenStore.set(pin, { ...pinPayload, sessionToken: token });
  tokenStore.set(token, sessionPayload);

  return { token, pin };
}

/**
 * Tạo/Gia hạn một Session Token HMAC mới có thời hạn 2 giờ
 * @param {Object} userData
 * @param {number} sessionExpiryHours (mặc định 2 tiếng)
 * @returns {string} HMAC Token
 */
function createSessionToken(userData, sessionExpiryHours = 2) {
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
 * Xác thực PIN 6 số hoặc Token từ Web
 * @param {string|number} tokenOrPin
 * @returns {Object|null} Payload nếu hợp lệ, null nếu không hợp lệ
 */
function verifyWebToken(tokenOrPin) {
  if (!tokenOrPin) {
    return null;
  }

  const cleanInput = String(tokenOrPin).trim().replace(/\s+/g, '');
  if (!cleanInput) return null;

  // 1. Kiểm tra trong memory store (PIN 6 số hoặc Token)
  const stored = tokenStore.get(cleanInput);
  if (stored) {
    if (Date.now() > stored.exp) {
      tokenStore.delete(cleanInput);
      return null;
    }
    return stored;
  }

  // 2. Fallback kiểm tra HMAC signature nếu là token dài
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
