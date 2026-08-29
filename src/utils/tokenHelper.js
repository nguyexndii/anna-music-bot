const crypto = require('crypto');
const config = require('../config');

// Use bot token as secret for HMAC
const SECRET_KEY = crypto.createHash('sha256').update(config.token || 'anna-music-secret-key-2026').digest();

/**
 * Tạo Magic Token mã hóa cho User khi gõ lệnh .web
 * @param {Object} userData - { userId, username, displayName, avatar, guildId, guildName }
 * @param {number} expiresInHours - Thời hạn token (mặc định 48h)
 * @returns {string} token
 */
function generateWebToken(userData, expiresInHours = 48) {
  const payload = {
    userId: userData.userId,
    username: userData.username,
    displayName: userData.displayName || userData.username,
    avatar: userData.avatar,
    guildId: userData.guildId,
    guildName: userData.guildName || 'Server',
    exp: Date.now() + expiresInHours * 60 * 60 * 1000
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('base64url');

  return `${base64Payload}.${signature}`;
}

/**
 * Xác thực Magic Token từ Web
 * @param {string} token
 * @returns {Object|null} Payload nếu hợp lệ, null nếu không hợp lệ
 */
function verifyWebToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  const [base64Payload, signature] = token.split('.');
  if (!base64Payload || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('base64url');
  if (signature !== expectedSignature) {
    return null; // Token bị giả mạo
  }

  try {
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      return null; // Token đã hết hạn
    }
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  generateWebToken,
  verifyWebToken
};
