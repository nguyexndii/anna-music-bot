const rateLimit = require('express-rate-limit');
const { EmbedBuilder } = require('discord.js');
const config = require('../../config');
const { verifyWebToken } = require('../../utils/tokenHelper');
const { isStrictAdmin, hasDJPermission, hasManagerPermission } = require('../../utils/permissionHelper');

// Helper bảo mật: Lấy IP client thực tế (chỉ tin cậy proxy headers khi request đến từ IP Loopback nội bộ do Cloudflare Tunnel chuyển tiếp)
function getClientIp(req) {
  const remote = (req.socket?.remoteAddress || '').replace(/^.*:/, '');
  const isLocal = remote === '127.0.0.1' || remote === 'localhost' || remote === '1';

  if (isLocal) {
    const proxySecretOk = Boolean(process.env.PROXY_SHARED_SECRET) && req.headers['x-proxy-secret'] === process.env.PROXY_SHARED_SECRET;
    const rawIp = (proxySecretOk && req.headers['x-real-client-ip']) || req.headers['cf-connecting-ip'] || req.ip || 'unknown-ip';
    return String(rawIp).split(',')[0].trim();
  }
  return (req.ip || req.socket?.remoteAddress || 'unknown-ip').trim();
}

// Helper làm sạch chuỗi văn bản Discord, loại bỏ ký tự vô hình/zero-width và tránh mention lạm dụng
function sanitizeDiscordText(str, maxLength = 200) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '')
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/<@!?(\d+)>/g, '')
    .replace(/<@&(\d+)>/g, '')
    .replace(/<#(\d+)>/g, '')
    .slice(0, maxLength)
    .trim();
}

// Helper lọc domain ảnh thumbnail an toàn (tránh SSRF và injection)
function sanitizeThumbnailUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const allowedHosts = [
      'i.ytimg.com',
      'img.youtube.com',
      'i.scdn.co',
      'mosaic.scdn.co',
      'i1.sndcdn.com',
      'cdn.discordapp.com',
      'anna-music-bot-ui.pages.dev'
    ];
    if (parsed.protocol === 'https:' && allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      return url;
    }
  } catch (e) {}
  return null;
}

// Helper kiểm tra quyền máy chủ thuộc Whitelist (Private / Whitelist Multi-Guild)
function isGuildAllowed(guildId, userId) {
  if (!config.allowedGuildIds || config.allowedGuildIds.length === 0) return true;
  if (config.allowedGuildIds.includes(guildId)) return true;
  if (userId && String(userId) === String(config.adminId)) return true;
  return false;
}

// Helper kiểm tra Channel ID và Role ID có thực sự thuộc máy chủ hiện tại
function validateGuildChannelsAndRoles(guild, payload) {
  if (!guild || !payload || typeof payload !== 'object') return null;
  const channelFields = ['musicChannelId', 'lockedVoiceChannelId', 'logChannelId', 'roomLogChannelId', 'errorLogChannelId'];
  for (const field of channelFields) {
    const val = payload[field];
    if (val && typeof val === 'string' && val.trim() !== '') {
      if (!guild.channels?.cache?.has(val)) {
        return `Kênh chỉ định cho "${field}" (${val}) không tồn tại trong máy chủ này!`;
      }
    }
  }
  if (payload.djRoleId && typeof payload.djRoleId === 'string' && payload.djRoleId.trim() !== '') {
    if (!guild.roles?.cache?.has(payload.djRoleId)) {
      return `Vai trò DJ (djRoleId: ${payload.djRoleId}) không tồn tại trong máy chủ này!`;
    }
  }
  return null;
}

// Rate-limit cho /api/auth/verify: tối đa 60 request/phút/IP
const authVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  statusCode: 429,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Thử lại quá nhiều lần, vui lòng chờ.' });
  }
});

// Rate-limit cho /api/search: tối đa 30 request/phút/IP (chống DoS scraper & YouTube IP ban)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  statusCode: 429,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Bạn đang tìm kiếm quá nhanh, vui lòng chờ trong giây lát!' });
  }
});

// Rate-limit cho /api/lyrics & /api/lyrics/status: tối đa 30 request/phút/IP
const lyricsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  statusCode: 429,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Bạn đang tra cứu lời bài hát quá nhanh, vui lòng chờ giây lát!' });
  }
});

// Rate-limit cho /guilds/:guildId/action: tối đa 120 request/phút/IP (tương thích Cloudflare Tunnel)
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => getClientIp(req),
  statusCode: 429,
  handler: (req, res) => {
    res.status(429).json({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Bạn đang thao tác quá nhanh, vui lòng chờ trong giây lát!' });
  }
});

// Middleware xác thực Magic Token
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Thiếu Magic Token hoặc phiên đã hết hạn' });
  }
  const user = verifyWebToken(token);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
  req.user = user;
  next();
};

function createAuthMiddleware(client) {
  // Helper kiểm tra quyền Admin của User trong máy chủ
  async function checkIsAdmin(guildId, userId) {
    if (!guildId || !userId) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    try {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      return isStrictAdmin(member);
    } catch (e) {
      return false;
    }
  }

  // Helper kiểm tra quyền Quản lý / vai trò DJ trong máy chủ
  async function checkIsManager(guildId, userId) {
    if (!guildId || !userId) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    if (guild.ownerId === userId) return true;
    try {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      return (hasDJPermission && hasDJPermission(member)) || hasManagerPermission(member);
    } catch (e) {
      return false;
    }
  }

  // Helper gửi thông báo Mini Embed công khai vào kênh Discord khi người dùng nạp bài/playlist từ Web
  async function sendWebQueueNotification(guild, queue, guildSettings, descriptionText) {
    try {
      const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
      let targetChannel = queue?.textChannel;
      if (!targetChannel && guildSettings?.musicChannelId) {
        const ch = guild.channels.cache.get(guildSettings.musicChannelId);
        if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
          targetChannel = ch;
        }
      }
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages']));
      }
      if (targetChannel) {
        const embed = new EmbedBuilder()
          .setColor('#2B7FFF')
          .setDescription(descriptionText)
          .setTimestamp();
        await targetChannel.send({ embeds: [embed], flags: 4096 }).catch(() => {});
      }
    } catch (_) {}
  }

  // Helper chuẩn hóa thông tin người order bài hát cho Web UI (tránh hiện ID raw / mention <@...>)
  function resolveTrackRequester(track, guild) {
    if (!track) return { name: 'Tự động', avatar: null };

    const raw = track.requestedBy;
    if (!raw || raw === 'Auto' || raw === 'DJ AI (Gợi ý)' || raw === 'Auto (24/7)') {
      return { name: 'Tự động phát', avatar: null };
    }

    if (track.requestedByName && typeof track.requestedByName === 'string' && !track.requestedByName.startsWith('<@')) {
      return {
        name: track.requestedByName,
        avatar: track.requestedByAvatar || null
      };
    }

    if (typeof raw === 'object') {
      const name = raw.displayName || raw.globalName || raw.username || raw.user?.displayName || raw.user?.username || 'User';
      let avatar = track.requestedByAvatar || null;
      if (!avatar) {
        if (typeof raw.displayAvatarURL === 'function') {
          avatar = raw.displayAvatarURL({ dynamic: true, size: 64 });
        } else if (raw.user && typeof raw.user.displayAvatarURL === 'function') {
          avatar = raw.user.displayAvatarURL({ dynamic: true, size: 64 });
        } else if (raw.id && raw.avatar) {
          avatar = `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`;
        }
      }
      return { name, avatar };
    }

    if (typeof raw === 'string') {
      const match = raw.match(/^(?:<@!?)?(\d{17,20})>?$/);
      if (match) {
        const userId = match[1];
        const member = guild?.members?.cache?.get(userId);
        const user = member?.user || client?.users?.cache?.get(userId);
        if (member || user) {
          const name = member?.displayName || user?.globalName || user?.username || 'User';
          const avatar = track.requestedByAvatar || member?.displayAvatarURL?.({ dynamic: true, size: 64 }) || user?.displayAvatarURL?.({ dynamic: true, size: 64 }) || null;
          return { name, avatar };
        }
        return { name: 'Discord User', avatar: track.requestedByAvatar || null };
      }
      return {
        name: raw,
        avatar: track.requestedByAvatar || null
      };
    }

    return { name: `${raw}`, avatar: track.requestedByAvatar || null };
  }

  // Middleware ngăn chặn IDOR & Xác thực thành viên máy chủ theo thời gian thực
  const requireGuildMember = async (req, res, next) => {
    const targetGuildId = req.params.guildId || req.query.guildId || req.body?.guildId;
    const user = req.user;
    if (!targetGuildId || !user) {
      return res.status(401).json({ success: false, error: 'Chưa xác thực hoặc thiếu ID máy chủ' });
    }
    const guild = client.guilds.cache.get(targetGuildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    // Kiểm tra Whitelist máy chủ
    if (!isGuildAllowed(targetGuildId, user.userId)) {
      return res.status(403).json({
        success: false,
        code: 'GUILD_NOT_ALLOWED',
        error: 'Máy chủ này chưa được cấp phép sử dụng hệ thống!'
      });
    }

    // Chặn IDOR: Thành viên chỉ được thao tác trên đúng máy chủ được cấp token
    if (String(user.guildId) !== String(targetGuildId)) {
      return res.status(403).json({
        success: false,
        code: 'CROSS_GUILD_FORBIDDEN',
        error: 'Quyền bị từ chối: Phiên đăng nhập của bạn không thuộc máy chủ này! Vui lòng lấy mã PIN mới tại máy chủ này.'
      });
    }

    // Kiểm tra thực tế xem User có còn là thành viên của Discord Server hay không
    const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    if (!member && (!config.adminId || user.userId !== config.adminId)) {
      return res.status(403).json({
        success: false,
        code: 'NOT_GUILD_MEMBER',
        error: 'Quyền bị từ chối: Bạn không còn là thành viên của máy chủ này!'
      });
    }

    req.guild = guild;
    req.member = member;
    next();
  };

  return {
    getClientIp,
    sanitizeDiscordText,
    sanitizeThumbnailUrl,
    isGuildAllowed,
    checkIsAdmin,
    checkIsManager,
    sendWebQueueNotification,
    resolveTrackRequester,
    validateGuildChannelsAndRoles,
    requireAuth,
    requireGuildMember,
    requireSameGuild: requireGuildMember,
    authVerifyLimiter,
    searchLimiter,
    lyricsLimiter,
    actionLimiter
  };
}

createAuthMiddleware.getClientIp = getClientIp;
createAuthMiddleware.sanitizeDiscordText = sanitizeDiscordText;
createAuthMiddleware.sanitizeThumbnailUrl = sanitizeThumbnailUrl;
createAuthMiddleware.isGuildAllowed = isGuildAllowed;
createAuthMiddleware.validateGuildChannelsAndRoles = validateGuildChannelsAndRoles;
createAuthMiddleware.requireAuth = requireAuth;
createAuthMiddleware.authVerifyLimiter = authVerifyLimiter;
createAuthMiddleware.searchLimiter = searchLimiter;
createAuthMiddleware.lyricsLimiter = lyricsLimiter;
createAuthMiddleware.actionLimiter = actionLimiter;

module.exports = createAuthMiddleware;
