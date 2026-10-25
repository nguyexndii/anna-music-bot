const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { verifyWebToken, createSessionToken, getPinAttemptStatus, recordPinFailure, clearPinFailures } = require('../utils/tokenHelper');
const { searchMultipleTracks, searchTrack, validateAndSanitizeMusicUrl } = require('../utils/musicExtractor');
const { hasMusicPermission, hasManagerPermission, isAllowedVoiceChannel, isStrictAdmin } = require('../utils/permissionHelper');
const { getLyrics } = require('../utils/lyricsHelper');
const settingsManager = require('../structures/SettingsManager');
const favoriteManager = require('../structures/FavoriteManager');
const userPlaylistManager = require('../structures/UserPlaylistManager');
const historyManager = require('../structures/HistoryManager');
const { logAction } = require('../utils/debugLogger');
const { EMOJI_TAG } = require('../utils/embed');
const { t } = require('../utils/i18n');

const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const ytdlp = require('yt-dlp-exec');

module.exports = function createApiRouter(client) {
  const router = express.Router();
  router.use(express.json());

  // Cấu hình CORS siết chặt: Whitelist các domain được chỉ định hoặc Pages.dev
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, ''))
    : [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
        'https://anna-music-bot-ui.pages.dev'
      ];

  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isAllowed = allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.anna-music-bot-ui\.pages\.dev$/i.test(origin);
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Helper bảo mật: Lấy IP client thực tế (chỉ tin cậy cf-connecting-ip của Cloudflare hoặc req.ip đã qua trust proxy)
  function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string') return cfIp.trim();
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

  // Search in-memory cache & In-flight request deduplication
  const searchCache = new Map();
  const inFlightSearches = new Map();
  const activePlaylistLoads = new Set();
  setInterval(() => {
    if (searchCache.size > 300) searchCache.clear();
  }, 10 * 60 * 1000);

  // Cache RAM 2.5s cho dữ liệu thống kê máy chủ (Top bài hát, lịch sử, playlist gần đây)
  const guildStatsCache = new Map();
  function getCachedGuildStats(guildId, forceFresh = false) {
    const now = Date.now();
    const cached = guildStatsCache.get(guildId);
    if (!forceFresh && cached && (now - cached.time < 2500)) {
      return cached.data;
    }
    const data = {
      history: (historyManager.getRecent ? historyManager.getRecent(guildId, 50) : (historyManager.getHistory(guildId) || []).slice(0, 50)) || [],
      topTracks: (historyManager.getTopTracks ? historyManager.getTopTracks(guildId, 16) : []) || [],
      recentPlaylists: (playlistHistoryManager.getPlaylists ? playlistHistoryManager.getPlaylists(guildId, 50) : []) || []
    };
    guildStatsCache.set(guildId, { time: now, data });
    return data;
  }

  // Rate-limit cho /api/auth/verify: tối đa 60 request/phút/IP
  const authVerifyLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 60, // tối đa 60 lần
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

  // Rate-limit cho /api/lyrics & /api/lyrics/status: tối đa 30 request/phút/IP (chống DoS Python service & Zing/Musixmatch IP ban)
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

  // Helper kiểm tra quyền máy chủ thuộc Whitelist (Private / Whitelist Multi-Guild)
  function isGuildAllowed(guildId, userId) {
    if (!config.allowedGuildIds || config.allowedGuildIds.length === 0) return true;
    if (config.allowedGuildIds.includes(guildId)) return true;
    if (userId && String(userId) === String(config.adminId)) return true;
    return false;
  }

  // Helper kiểm tra quyền Admin của User trong máy chủ (Kiểm tra nghiêm ngặt quyền thực tế tại máy chủ đó)
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
      const { hasDJPermission, hasManagerPermission } = require('../utils/permissionHelper');
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
        const { EmbedBuilder } = require('discord.js');
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

    // 1. Đã có tên hiển thị sẵn và không phải mention dạng <@...>
    if (track.requestedByName && typeof track.requestedByName === 'string' && !track.requestedByName.startsWith('<@')) {
      return {
        name: track.requestedByName,
        avatar: track.requestedByAvatar || null
      };
    }

    // 2. Đối tượng Discord User hoặc GuildMember
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

    // 3. Chuỗi dạng mention hoặc Snowflake ID
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

  // Middleware xác thực Magic Token
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token || req.body.token;
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

  // Middleware ngăn chặn IDOR & Xác thực thành viên máy chủ theo thời gian thực
  const requireGuildMember = async (req, res, next) => {
    const targetGuildId = req.params.guildId;
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
  const requireSameGuild = requireGuildMember;

  // 1. Xác thực Token & PIN từ Discord (Có cơ chế chống Brute-force 5 lần sai khóa 5 phút & hủy PIN)
  router.post('/auth/verify', authVerifyLimiter, async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã PIN hoặc Token' });
    }

    const clientIp = getClientIp(req);
    const attemptStatus = getPinAttemptStatus(clientIp);

    // Kiểm tra xem IP này có đang bị tạm khóa hay không
    if (attemptStatus && attemptStatus.locked) {
      return res.status(429).json({
        success: false,
        error: `Bạn đã nhập sai mã PIN quá 5 lần. IP tạm thời bị khóa trong ${attemptStatus.remainingMinutes} phút để đảm bảo an toàn.`
      });
    }

    const user = verifyWebToken(token, true);
    if (!user) {
      const failInfo = recordPinFailure(clientIp, token);
      if (failInfo.locked) {
        return res.status(429).json({
          success: false,
          error: 'Bạn đã nhập sai mã PIN quá 5 lần liên tiếp. Tài khoản bị tạm khóa 5 phút!'
        });
      }

      return res.status(401).json({
        success: false,
        error: `Mã PIN không chính xác hoặc đã hết hạn. Bạn còn ${failInfo.remainingAttempts} lần thử.`
      });
    }

    // Đăng nhập thành công -> Xóa lịch sử nhập sai của IP
    clearPinFailures(clientIp);

    // Kiểm tra Whitelist máy chủ khi xác thực token
    if (!isGuildAllowed(user.guildId, user.userId)) {
      return res.status(403).json({
        success: false,
        code: 'GUILD_NOT_ALLOWED',
        error: 'Máy chủ này chưa được cấp phép sử dụng hệ thống!'
      });
    }

    const guild = client.guilds.cache.get(user.guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const userVoice = member?.voice?.channel;
    const queue = client.musicManager ? client.musicManager.get(user.guildId) : null;
    const botVoice = queue?.voiceChannel || guild.members.me?.voice?.channel;
    const guildSettings = settingsManager.get(user.guildId);
    const isAdmin = await checkIsAdmin(user.guildId, user.userId);
    const isDJ = await checkIsManager(user.guildId, user.userId);

    // Kiểm tra thực tế xem User có đang ngồi trong kênh Voice trên Discord hay không
    const isInVoice = Boolean(userVoice);
    const isLocked = Boolean(guildSettings.lockedVoiceChannelId);
    const isSameVoice = isLocked 
      ? Boolean(userVoice && userVoice.id === guildSettings.lockedVoiceChannelId)
      : Boolean(userVoice && (!botVoice || userVoice.id === botVoice.id));

    // Cấp Session Token 24 tiếng lưu vào thiết bị
    const sessionToken = user.sessionToken || createSessionToken(user, 24);

    return res.json({
      success: true,
      token: sessionToken,
      user: {
        ...user,
        isAdmin,
        isDJ,
        guildName: guild.name,
        guildIcon: guild.iconURL({ dynamic: true }) || null,
        userVoice: userVoice ? { id: userVoice.id, name: userVoice.name } : null,
        botVoice: botVoice ? { id: botVoice.id, name: botVoice.name } : null,
        lockedVoiceChannelId: guildSettings.lockedVoiceChannelId || null,
        isInVoice,
        isSameVoice
      }
    });
  });

  // 2. Live Search YouTube / Spotify (Siêu tốc độ với RAM Cache & Chống chồng lặp, Rate-limited 30 req/phút)
  router.get('/search', searchLimiter, async (req, res) => {
    let query = (req.query.q || '').slice(0, 150).trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 50));
    const mode = req.query.mode || 'official';

    // Chặn Argument Injection và kiểm tra độ dài tối thiểu
    if (!query || query.length < 2 || query.startsWith('-')) {
      return res.json({ success: true, results: [] });
    }

    const cacheKey = `${query.toLowerCase()}_${limit}_${mode}`;
    if (searchCache.has(cacheKey)) {
      return res.json({ success: true, results: searchCache.get(cacheKey) });
    }

    if (inFlightSearches.has(cacheKey)) {
      try {
        const results = await inFlightSearches.get(cacheKey);
        return res.json({ success: true, results });
      } catch (e) {
        return res.json({ success: true, results: [] });
      }
    }

    const searchPromise = (async () => {
      try {
        const results = await searchMultipleTracks(query, limit, mode);
        if (results && results.length > 0) {
          searchCache.set(cacheKey, results);
        }
        return results || [];
      } finally {
        inFlightSearches.delete(cacheKey);
      }
    })();

    inFlightSearches.set(cacheKey, searchPromise);

    try {
      const results = await searchPromise;
      return res.json({ success: true, results });
    } catch (err) {
      console.error('[API Search Error]:', err);
      return res.status(500).json({ success: false, error: 'Lỗi tìm kiếm bài hát' });
    }
  });

  // 2.1 Xem log sự kiện hệ thống (Bảo vệ bằng requireAuth & Phân quyền theo Server/Owner)
  router.get('/logs', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const isOwner = (user.userId === config.adminId);
      const isGuildAdmin = await checkIsAdmin(user.guildId, user.userId);
      if (!isOwner && !isGuildAdmin) {
        return res.status(403).json({ success: false, error: 'Quyền bị từ chối: Chỉ Quản trị viên mới được phép xem nhật ký.' });
      }

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '../../logs/events.log');
      if (!fs.existsSync(logPath)) {
        return res.json({ success: true, count: 0, logs: [] });
      }
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      // Chống lộ log chéo server: Nếu không phải Bot Owner, chỉ lọc các dòng log của chính máy chủ người dùng
      const filteredLines = isOwner ? lines : lines.filter(line => line.includes(user.guildId));
      const lastLines = filteredLines.slice(-limit);
      return res.json({
        success: true,
        count: lastLines.length,
        logs: lastLines
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  const activeWebUsersMap = new Map();

  function recordActiveUser(guildId, user) {
    if (!guildId || !user || !user.userId) return;
    if (!activeWebUsersMap.has(guildId)) {
      activeWebUsersMap.set(guildId, new Map());
    }
    const guildUsers = activeWebUsersMap.get(guildId);
    guildUsers.set(user.userId, {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar,
      lastSeen: Date.now()
    });
  }

  function getActiveWebUsers(guildId) {
    const guildUsers = activeWebUsersMap.get(guildId);
    if (!guildUsers) return [];
    const now = Date.now();
    const active = [];
    for (const [uid, u] of guildUsers.entries()) {
      if (now - u.lastSeen < 6000) {
        active.push({
          userId: u.userId,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar
        });
      } else {
        guildUsers.delete(uid);
      }
    }
    return active;
  }

  // 3. Trạng thái phòng nhạc (Real-time State - Yêu cầu người dùng đã xác thực token cùng máy chủ)
  router.get('/guilds/:guildId/state', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const caller = req.user;
    if (caller) {
      recordActiveUser(guildId, caller);
    }

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const guildSettings = settingsManager.get(guildId);

    const voiceChannel = queue?.getVoiceChannel ? queue.getVoiceChannel() : (queue?.voiceChannel || guild.members.me?.voice?.channel);
    let voiceMembers = [];
    if (voiceChannel && guild.voiceStates?.cache) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.channelId === voiceChannel.id) {
          const member = state.member || guild.members.cache.get(state.id);
          const userObj = member?.user || client.users?.cache?.get(state.id);
          const isBot = Boolean(userObj?.bot || state.id === client.user.id);
          voiceMembers.push({
            id: state.id,
            username: userObj?.username || 'user',
            displayName: member?.displayName || userObj?.globalName || userObj?.username || 'Thành viên',
            avatar: userObj?.displayAvatarURL ? userObj.displayAvatarURL({ dynamic: true }) : null,
            isBot,
            isSelf: caller?.userId ? state.id === caller.userId : (state.id === client.user.id)
          });
        }
      }
    } else if (voiceChannel?.members) {
      voiceMembers = voiceChannel.members.map(m => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ dynamic: true }) || null,
        isBot: m.user.bot,
        isSelf: caller?.userId ? m.id === caller.userId : false
      }));
    }

    const currentTrack = queue?.currentSong;
    const activeWebUsers = getActiveWebUsers(guildId);

    const callerVoice = req.member?.voice?.channel;
    const isCallerAdmin = await checkIsAdmin(guildId, caller?.userId);
    const isCallerDJ = await checkIsManager(guildId, caller?.userId);
    const inSameVoice = Boolean(callerVoice && voiceChannel && callerVoice.id === voiceChannel.id);

    return res.json({
      success: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true }) || null
      },
      settings: guildSettings,
      language: guildSettings.language || 'vi',
      userPermissions: {
        isAdmin: isCallerAdmin,
        isDJ: isCallerDJ,
        inSameVoice,
        userId: caller?.userId
      },
      activeWebUsers,
      voiceMembers,
      connectionDiagnostics: {
        channelId: voiceChannel?.id || null,
        channelName: voiceChannel?.name || null,
        status: queue?.connection?.state?.status || 'NoConnection',
        hasSubscription: Boolean(queue?.connection?.state?.subscription),
        playerStatus: queue?.player?.state?.status || 'NoPlayer'
      },
      player: {
        isPlaying: queue ? queue.isPlaying : false,
        isPaused: queue ? queue.isPaused : false,
        is247LofiMode: Boolean(currentTrack && (currentTrack.is247 || currentTrack.requestedBy === 'Auto (24/7)' || currentTrack.requestedBy === 'Auto (24/7 Lofi)' || (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.includes('24/7')))),
        volume: queue ? queue.volume : (guildSettings.defaultVolume || 80),
        loopMode: queue ? queue.loopMode : (guildSettings.loopMode || 'off'),
        mode247: queue ? queue.mode247 : Boolean(guildSettings.mode247),
        autoplay: queue ? (guildSettings.autoplay !== false) : (guildSettings.autoplay !== false),
        lyricsSync: queue ? (guildSettings.lyricsSync !== false) : true,
        enableCinemaMode: guildSettings.enableCinemaMode !== false,
        settings: guildSettings,
        current: currentTrack ? (() => {
          const isTrack247 = Boolean(
            currentTrack.is247 ||
            currentTrack.requestedBy === 'Auto (24/7)' ||
            currentTrack.requestedBy === 'Auto (24/7 Lofi)' ||
            (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.includes('24/7'))
          );
          if (isTrack247) {
            return {
              title: currentTrack.title || 'Đài Phát Thanh Lofi 24/7',
              artist: currentTrack.artist || 'Anna Lofi Station • Live 24/7',
              url: currentTrack.url || 'https://youtube.com',
              thumbnail: currentTrack.thumbnail || '/anna-avatar-icon.png',
              duration: currentTrack.duration || 'LIVE 24/7',
              durationMs: currentTrack.durationMs || 0,
              playbackDurationMs: (() => {
                let val = 0;
                if (queue?.currentResource && typeof queue.currentResource.playbackDuration === 'number') {
                  val = queue.currentResource.playbackDuration + ((currentTrack.seekPosition || 0) * 1000);
                } else if (currentTrack.startTime) {
                  val = Math.max(0, Date.now() - currentTrack.startTime);
                }
                return val;
              })(),
              serverTime: Date.now(),
              is247: true,
              isLive: Boolean(currentTrack.isLive || currentTrack.duration === 'LIVE'),
              requestedBy: 'Auto (24/7)',
              requestedByAvatar: '/anna-avatar-icon.png',
              startTime: currentTrack.startTime || null
            };
          }
          const reqInfo = resolveTrackRequester(currentTrack, guild);
          const safeTitle = (currentTrack.title || currentTrack.name || currentTrack.rawSongName || 'Đang phát âm thanh').trim();
          return {
            title: safeTitle,
            artist: (() => {
              if (currentTrack.artist && !['Unknown', 'YouTube', 'YouTube Music'].includes(currentTrack.artist) && !currentTrack.artist.startsWith('[') && !currentTrack.artist.includes('Topic')) {
                return currentTrack.artist;
              }
              const clean = safeTitle.replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
              const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
              if (segs.length >= 2) {
                const s0 = segs[0].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                const s1 = segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                if (s0.length > 35 && s1.length < s0.length && s1.length > 0) {
                  return s1;
                }
                return s0 || s1;
              }
              return (!['Unknown', 'YouTube', 'YouTube Music'].includes(currentTrack.artist) ? currentTrack.artist : '') || 'YouTube Music';
            })(),
            url: currentTrack.url || (currentTrack.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(currentTrack.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(safeTitle)}`),
            thumbnail: currentTrack.thumbnail || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
            duration: currentTrack.duration,
            playbackDurationMs: (() => {
              let val = 0;
              if (queue?.currentResource && typeof queue.currentResource.playbackDuration === 'number') {
                val = queue.currentResource.playbackDuration + ((currentTrack.seekPosition || 0) * 1000);
              } else if (currentTrack.startTime) {
                val = Math.max(0, Date.now() - currentTrack.startTime);
              }
              const durMs = currentTrack.durationMs || (() => {
                if (!currentTrack.duration || currentTrack.duration === 'LIVE') return 0;
                const p = currentTrack.duration.split(':').map(Number);
                if (p.some(isNaN)) return 0;
                if (p.length === 3) return (p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
                if (p.length === 2) return (p[0] * 60 + p[1]) * 1000;
                return p[0] * 1000;
              })();
              return durMs > 0 ? Math.min(val, durMs) : val;
            })(),
            serverTime: Date.now(),
            is247: currentTrack.is247 || currentTrack.requestedBy === 'Auto (24/7)',
            isLive: currentTrack.isLive || currentTrack.duration === 'LIVE',
            requestedBy: reqInfo.name,
            requestedByAvatar: reqInfo.avatar,
            requestedById: currentTrack.requestedById || (typeof currentTrack.requestedBy === 'object' ? currentTrack.requestedBy?.id : (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.startsWith('<@') ? currentTrack.requestedBy.replace(/[^0-9]/g, '') : null)) || null,
            startTime: currentTrack.startTime || null
          };
        })() : null,
        queue: (queue?.songs || []).map((t, idx) => {
          const reqInfo = resolveTrackRequester(t, guild);
          return {
            index: idx,
            title: t.title,
            artist: (() => {
              if (t.artist && !['Unknown', 'YouTube', 'YouTube Music'].includes(t.artist) && !t.artist.startsWith('[') && !t.artist.includes('Topic')) {
                return t.artist;
              }
              const clean = (t.title || '').replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
              const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
              if (segs.length >= 2) {
                const s0 = segs[0].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                const s1 = segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                if (s0.length > 35 && s1.length < s0.length && s1.length > 0) {
                  return s1;
                }
                return s0 || s1;
              }
              return (!['Unknown', 'YouTube', 'YouTube Music'].includes(t.artist) ? t.artist : '') || 'YouTube Music';
            })(),
            url: t.url || (t.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(t.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(t.title)}`),
            thumbnail: t.thumbnail,
            duration: t.duration,
            requestedBy: reqInfo.name,
            requestedByAvatar: reqInfo.avatar,
            requestedById: t.requestedById || (typeof t.requestedBy === 'object' ? t.requestedBy?.id : (typeof t.requestedBy === 'string' && t.requestedBy.startsWith('<@') ? t.requestedBy.replace(/[^0-9]/g, '') : null)) || null
          };
        }),
        voiceChannel: voiceChannel ? {
          id: voiceChannel.id,
          name: voiceChannel.name,
          memberCount: voiceMembers.length,
          humanMemberCount: voiceMembers.filter(m => !m.isBot).length,
          members: voiceMembers
        } : null,
        previousSongs: (queue?.previousSongs || []).map(t => ({
          title: t.title,
          url: t.url,
          thumbnail: t.thumbnail,
          duration: t.duration,
          artist: t.artist || (t.title.includes(' - ') ? t.title.split(' - ')[0].trim() : 'YouTube Music')
        })),
        hasPrevious: Boolean(queue?.previousSongs && queue.previousSongs.length > 0),
        ...((req.query.full === '1' || req.query.init === '1') ? {
          ...getCachedGuildStats(guildId, req.query.fresh === '1'),
          favorites: caller?.userId ? ((await favoriteManager.getFavorites(caller.userId)) || []) : [],
          userPlaylists: caller?.userId ? ((await userPlaylistManager.getUserPlaylists(caller.userId)) || []) : []
        } : {})
      }
    });
  });

  // 4. Order / Thêm bài hát hoặc Playlist từ Web
  router.post('/guilds/:guildId/play', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    let { query, track } = req.body;
    if (typeof track === 'string') {
      track = { url: track.startsWith('http') ? track : undefined, searchQuery: track, title: track };
    }
    const user = req.user;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const guildSettings = settingsManager.get(guildId);
    const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
    let voiceChannel = null;

    // Tìm kênh text có quyền gửi tin nhắn
    let textChannel = null;
    if (guildSettings.musicChannelId) {
      const ch = guild.channels.cache.get(guildSettings.musicChannelId) || await guild.channels.fetch(guildSettings.musicChannelId).catch(() => null);
      if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
        textChannel = ch;
      }
    }
    const existingQueue = client.musicManager?.get(guildId);
    if (!textChannel && existingQueue?.textChannel?.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
      textChannel = existingQueue.textChannel;
    }
    if (!textChannel) {
      textChannel = guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
    }

    // Kiểm tra quyền DJ nếu máy chủ bật chế độ djOnly
    if (guildSettings.djOnly && !hasMusicPermission(req.member)) {
      return res.status(403).json({
        success: false,
        code: 'DJ_ONLY_REQUIRED',
        error: 'Máy chủ đang bật chế độ DJ Only. Bạn cần có vai trò DJ để phát nhạc!'
      });
    }

    // Kiểm tra User có thực sự đang ở trong kênh Voice trên Discord hay không
    const member = req.member || guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi thêm bài hát!' });
    }

    // Nếu Bot ĐÃ Ở TRONG một kênh Voice:
    // Bắt buộc User phải Ở CÙNG PHÒNG VOICE VỚI BOT!
    const botVoice = existingQueue?.voiceChannel || guild.members.me?.voice?.channel;
    if (botVoice && userVoice.id !== botVoice.id) {
      return res.status(400).json({
        success: false,
        error: `Bot đang ở trong kênh Voice "${botVoice.name}"! Bạn cần vào cùng phòng Voice với Bot để order nhạc.`
      });
    }

    // Nếu máy chủ đã khóa kênh Voice cố định (lockedVoiceChannelId)
    if (guildSettings.lockedVoiceChannelId) {
      if (userVoice.id !== guildSettings.lockedVoiceChannelId) {
        return res.status(400).json({
          success: false,
          error: `Máy chủ đã khóa kênh Voice! Vui lòng tham gia kênh <#${guildSettings.lockedVoiceChannelId}> để phát nhạc.`
        });
      }

      const targetChannel = guild.channels.cache.get(guildSettings.lockedVoiceChannelId) || await guild.channels.fetch(guildSettings.lockedVoiceChannelId).catch(() => null);
      if (!targetChannel || !targetChannel.isVoiceBased || !targetChannel.isVoiceBased()) {
        return res.status(400).json({
          success: false,
          error: 'Kênh voice đã khóa không còn tồn tại, vui lòng dùng /lockvoice để đặt lại.'
        });
      }

      const permissions = targetChannel.permissionsFor(botMember || client.user);
      if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
        return res.status(403).json({
          success: false,
          error: 'Bot không có quyền vào kênh voice đã khóa, vui lòng liên hệ admin.'
        });
      }

      voiceChannel = targetChannel;
    } else {
      // Nếu không khóa: sử dụng kênh Voice mà User đang ngồi
      voiceChannel = userVoice;
    }

    let isLockHeld = false;
    try {
      // Bổ sung xử lý khi req.body.tracks là một mảng bài hát (ví dụ: Phát tất cả bài yêu thích):
      if (Array.isArray(req.body.tracks) && req.body.tracks.length > 0) {
        if (req.body.tracks.length > 1 && activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        if (req.body.tracks.length > 1) {
          activePlaylistLoads.add(guildId);
          isLockHeld = true;
        }
        try {
          const queue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
          const validTracks = req.body.tracks.slice(0, 100);
          const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const requesterObj = {
            id: member.id,
            displayName: member.displayName || user.username,
            username: member.user?.username || user.username,
            avatar: memberAvatar
          };
          const userMention = `<@${member.id}>`;
          for (const t of validTracks) {
            t.title = sanitizeDiscordText(t.title, 200) || 'Unknown Track';
            t.artist = sanitizeDiscordText(t.artist, 100) || 'Unknown Artist';
            t.thumbnail = sanitizeThumbnailUrl(t.thumbnail);
            t.is247 = false;
            t.requestedBy = userMention;
            t.requestedByName = member.displayName || user.username;
            t.requestedByAvatar = memberAvatar;
            t.requestedById = member.id;
          }
          await queue.addSongs(validTracks, requesterObj);
          sendWebQueueNotification(req.guild, queue, guildSettings, t(guildId, 'web_notify.added_tracks', {
            user: member.displayName || user.username,
            count: validTracks.length
          }));
          return res.json({
            success: true,
            isPlaylist: true,
            addedCount: validTracks.length,
            track: validTracks[0],
            message: `Đã thêm ${validTracks.length} bài hát vào hàng chờ!`
          });
        } finally {
          if (isLockHeld) {
            activePlaylistLoads.delete(guildId);
            isLockHeld = false;
          }
        }
      }

      let rawResults = null;
      let requestedUrl = (query || track?.url || '').trim();

      // Kiểm tra URL an toàn chống SSRF
      if (requestedUrl.startsWith('http://') || requestedUrl.startsWith('https://')) {
        const safeUrl = validateAndSanitizeMusicUrl(requestedUrl);
        if (!safeUrl) {
          return res.status(400).json({ success: false, error: 'Đường dẫn liên kết không được hỗ trợ hoặc không an toàn' });
        }
        requestedUrl = safeUrl;
      }

      // Khóa trước khi searchTrack nếu là link Playlist
      const isPlaylistCandidate = /(?:list=|playlist|\/album\/|\/sets\/)/i.test(requestedUrl) || Boolean(track?.isPlaylist);
      if (isPlaylistCandidate) {
        if (activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        activePlaylistLoads.add(guildId);
        isLockHeld = true;
      }

      if (track && track.url && track.title && !track.isPlaylist) {
        rawResults = [track];
      } else if (track && (track.searchQuery || track.title) && !track.isPlaylist) {
        const q = track.searchQuery || `${track.title} ${track.artist || ''}`.trim();
        rawResults = await searchTrack(q);
      } else if (query || track?.url) {
        const targetQuery = query || track?.url;
        rawResults = await searchTrack(targetQuery);
      }

      if (!rawResults || rawResults.length === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát yêu cầu' });
      }

      const queue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
      let isFirst = !queue.currentSong || Boolean(queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)') || queue.songs.length === 0;
      const isPlaylist = Array.isArray(rawResults) && rawResults.length > 1;

      if (isPlaylist && !isLockHeld) {
        if (activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        activePlaylistLoads.add(guildId);
        isLockHeld = true;
      }

      // XỬ LÝ NẠP TOÀN BỘ PLAYLIST
      if (isPlaylist) {
        rawResults = rawResults.slice(0, 100);
        const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
        const userMention = `<@${member.id}>`;
        for (const t of rawResults) {
          t.title = sanitizeDiscordText(t.title, 200) || 'Unknown Track';
          t.artist = sanitizeDiscordText(t.artist, 100) || 'Unknown Artist';
          t.thumbnail = sanitizeThumbnailUrl(t.thumbnail);
          t.is247 = false;
          t.requestedBy = userMention;
          t.requestedByName = member.displayName || user.username;
          t.requestedByAvatar = memberAvatar;
          t.requestedById = member.id;
        }

        await queue.addSongs(rawResults, {
          id: member.id,
          displayName: member.displayName || user.username,
          username: member.user?.username || user.username,
          avatar: memberAvatar
        });

        // Lưu vào PlaylistHistoryManager
        playlistHistoryManager.addPlaylist(guildId, {
          url: requestedUrl,
          title: sanitizeDiscordText(rawResults[0]?.playlistTitle || `Danh sách phát (${rawResults.length} bài)`, 200),
          trackCount: rawResults.length,
          thumbnail: sanitizeThumbnailUrl(rawResults[0]?.playlistThumbnail || rawResults[0]?.thumbnail) || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
          addedBy: member.displayName || user.username,
          addedByAvatar: memberAvatar,
          tracks: rawResults
        });
        guildStatsCache.delete(guildId);

        // Gửi thông báo Discord (Mẫu 5B Mini Embed)
        try {
          const musicChannelId = guildSettings.musicChannelId;
          const notifyChannel = musicChannelId
            ? guild.channels.cache.get(musicChannelId)
            : (queue.textChannel || guild.systemChannel);

          if (notifyChannel?.isTextBased?.()) {
            const { EmbedBuilder } = require('discord.js');
            const isEn = guildSettings?.language === 'en';
            const playlistTitle = sanitizeDiscordText(rawResults[0]?.playlistTitle || (isEn ? `Playlist (${rawResults.length} tracks)` : `Danh sách phát (${rawResults.length} bài)`), 100);
            const userDisplayName = member.displayName || user.username;
            const notifDesc = isEn
              ? `${EMOJI_TAG.playlist || '📂'} **${userDisplayName}** added: [**${playlistTitle}**](${requestedUrl}) • \`${rawResults.length} songs\``
              : `${EMOJI_TAG.playlist || '📂'} **${userDisplayName}** đã thêm: [**${playlistTitle}**](${requestedUrl}) • \`${rawResults.length} bài\``;
            const notifEmbed = new EmbedBuilder()
              .setColor('#2B7FFF')
              .setDescription(notifDesc);
            notifyChannel.send({ embeds: [notifEmbed], flags: 4096 }).catch(() => {});
          }
        } catch (e) {}

        return res.json({
          success: true,
          isPlaylist: true,
          trackCount: rawResults.length,
          message: `Đã thêm toàn bộ ${rawResults.length} bài hát từ Playlist vào hàng chờ!`,
          track: rawResults[0],
          tracks: rawResults,
          isFirst
        });
      }

      // XỬ LÝ 1 BÀI HÁT ĐƠN LẺ
      const targetTrack = rawResults[0];
      const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
      const userMention = `<@${member.id}>`;

      // Làm sạch ký tự vô hình/zero-width và chuẩn hóa tiêu đề
      const cleanTitle = sanitizeDiscordText(targetTrack.title, 200);
      const cleanArtist = sanitizeDiscordText(targetTrack.artist, 100);
      const videoIdMatch = (targetTrack.url || '').match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const fallbackId = videoIdMatch ? videoIdMatch[1] : null;

      targetTrack.title = cleanTitle || (cleanArtist && cleanArtist !== 'YouTube' ? `${cleanArtist} - Audio` : (fallbackId ? `Bài hát không tên (${fallbackId})` : 'Bài hát không tên'));
      targetTrack.artist = cleanArtist || 'YouTube';
      targetTrack.thumbnail = sanitizeThumbnailUrl(targetTrack.thumbnail);
      targetTrack.is247 = false;
      targetTrack.requestedBy = userMention;
      targetTrack.requestedByName = member.displayName || user.username;
      targetTrack.requestedByAvatar = memberAvatar;
      targetTrack.requestedById = member.id;

      const addRes = await queue.addSong(targetTrack, {
        id: member.id,
        displayName: member.displayName || user.username,
        username: member.user?.username || user.username,
        avatar: memberAvatar
      });
      if (addRes && typeof addRes.isPlayingNow === 'boolean') {
        isFirst = addRes.isPlayingNow;
      }

      // Gửi thông báo vào kênh nhạc đã cấu hình (Mẫu 5B Mini Embed)
      try {
        const musicChannelId = guildSettings.musicChannelId;
        const notifyChannel = musicChannelId
          ? guild.channels.cache.get(musicChannelId)
          : (queue.textChannel || guild.systemChannel);

        if (notifyChannel?.isTextBased?.()) {
          const { EmbedBuilder } = require('discord.js');
          const isEn = guildSettings?.language === 'en';
          const safeMarkdownTitle = targetTrack.title.replace(/\[/g, '(').replace(/\]/g, ')');
          const userDisplayName = user.displayName || user.username || member.displayName;
          const posText = typeof addRes?.position === 'number' ? ` • \`#${addRes.position}\`` : '';
          const notifDesc = isEn
            ? (isFirst
                ? `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** is playing: [**${safeMarkdownTitle}**](${targetTrack.url})`
                : `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** added to queue: [**${safeMarkdownTitle}**](${targetTrack.url})${posText}`)
            : (isFirst
                ? `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** đang phát: [**${safeMarkdownTitle}**](${targetTrack.url})`
                : `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** đã thêm: [**${safeMarkdownTitle}**](${targetTrack.url})${posText}`);
          const notifEmbed = new EmbedBuilder()
            .setColor('#2B7FFF')
            .setDescription(notifDesc);
          logAction('MESSAGE_SEND', {
            type: 'WEB_PLAYER_NOTIFY',
            channelId: notifyChannel.id,
            guildId: guild.id,
            flags: 4096,
            content: `${isFirst ? 'playing' : 'queued'}: ${(targetTrack.title || '').slice(0, 60)}`
          });
          notifyChannel.send({ embeds: [notifEmbed], flags: 4096 }).catch(() => {});
        }
      } catch (notifErr) {
        // Không crash nếu gửi thông báo lỗi
      }

      return res.json({
        success: true,
        message: isFirst ? `Đang phát "${targetTrack.title}"` : `Đã thêm "${targetTrack.title}" vào hàng chờ`,
        track: targetTrack,
        isFirst
      });
    } catch (err) {
      console.error('[API Play Error]:', err);
      return res.status(500).json({ success: false, error: err.message || 'Lỗi khi phát bài hát' });
    } finally {
      if (isLockHeld) {
        activePlaylistLoads.delete(guildId);
      }
    }
  });

  // 4.1 Lấy thông tin chi tiết Playlist (Khóa theo từng Guild, chống DoS Logic)
  const extractingGuilds = new Set();
  router.get('/guilds/:guildId/playlist-info', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    let url = req.query.url?.trim();
    if (!url || url.startsWith('-')) {
      return res.status(400).json({ success: false, error: 'Thiếu đường dẫn playlist hoặc đường dẫn không hợp lệ' });
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const safeUrl = validateAndSanitizeMusicUrl(url);
      if (!safeUrl) {
        return res.status(400).json({ success: false, error: 'Đường dẫn danh sách phát không an toàn hoặc không được hỗ trợ' });
      }
      url = safeUrl;
    }

    // 1. Kiểm tra cache trong PlaylistHistoryManager
    const cached = playlistHistoryManager.getPlaylistByUrl(guildId, url);
    if (cached && Array.isArray(cached.tracks) && cached.tracks.length > 0) {
      return res.json({
        success: true,
        playlist: cached
      });
    }

    // 2. Khóa an toàn theo từng máy chủ và giới hạn tối đa 3 tác vụ đồng thời trên VPS
    if (extractingGuilds.has(guildId)) {
      return res.status(429).json({ success: false, error: 'Máy chủ đang phân tích một danh sách phát khác, vui lòng chờ trong giây lát!' });
    }
    if (extractingGuilds.size >= 3) {
      return res.status(429).json({ success: false, error: 'Hệ thống đang bận xử lý nhiều danh sách phát cùng lúc, vui lòng thử lại sau ít giây!' });
    }

    extractingGuilds.add(guildId);
    try {
      let rawResults = await searchTrack(url);
      if (!rawResults || rawResults.length === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát trong danh sách phát này' });
      }

      rawResults = rawResults.slice(0, 100);
      const playlistData = {
        url,
        title: sanitizeDiscordText(rawResults[0]?.playlistTitle || (rawResults.length > 1 ? `Danh sách phát (${rawResults.length} bài)` : (rawResults[0]?.title || 'Playlist')), 200),
        trackCount: rawResults.length,
        thumbnail: sanitizeThumbnailUrl(rawResults[0]?.playlistThumbnail || rawResults[0]?.thumbnail) || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
        addedBy: req.user?.displayName || req.user?.username || 'Web User',
        addedByAvatar: req.user?.avatar || null,
        tracks: rawResults
      };

      playlistHistoryManager.addPlaylist(guildId, playlistData);
      guildStatsCache.delete(guildId);

      return res.json({
        success: true,
        playlist: playlistData
      });
    } catch (err) {
      console.error('[API Playlist Info Error]:', err);
      return res.status(500).json({ success: false, error: 'Không thể phân tích danh sách phát' });
    } finally {
      extractingGuilds.delete(guildId);
    }
  });

  // 5. Thao tác điều khiển Player (Pause, Resume, Skip, Seek, Volume, 24/7...)
  router.post('/guilds/:guildId/action', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const { action, value } = req.body;
    const user = req.user;

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    if (!queue && action !== 'toggle247' && action !== 'set247' && action !== 'toggleAutoplay' && action !== 'setAutoplay' && action !== 'switchTo247' && action !== 'resetTo247' && action !== 'toggleLofiMode' && action !== 'playFavorites' && action !== 'playUserPlaylist' && action !== 'playNow') {
      return res.status(400).json({ success: false, error: 'Hiện không có bài hát nào đang phát trong máy chủ này' });
    }

    const guildSettings = settingsManager.get(guildId);

    // 🔒 KIỂM TRA PHÂN QUYỀN ADMIN CHO CÁC THAO TÁC CÀI ĐẶT SERVER (24/7, Autoplay, LogChannel, Settings)
    const serverSettingActions = ['toggle247', 'set247', 'toggleAutoplay', 'setAutoplay', 'setLogChannel', 'settings', 'updateSettings'];
    if (serverSettingActions.includes(action)) {
      const isAdmin = await checkIsAdmin(guildId, user.userId);
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên (Admin / Quản lý máy chủ) mới có quyền thay đổi Cài đặt Máy chủ!'
        });
      }
    } else if (action !== 'toggleFavorite') {
      // Kiểm tra quyền DJ nếu server đang bật chế độ DJ Only
      const musicControlActions = ['skip', 'previous', 'pause', 'resume', 'stop', 'seek', 'shuffle', 'loop', 'volume', 'clear', 'remove', 'removeBatch', 'move', 'playNow', 'playFavorites', 'playUserPlaylist'];
      if (guildSettings.djOnly && musicControlActions.includes(action) && !hasMusicPermission(req.member)) {
        return res.status(403).json({
          success: false,
          code: 'DJ_ONLY_REQUIRED',
          error: 'Máy chủ đang bật chế độ DJ Only. Bạn cần có vai trò DJ để điều khiển âm nhạc!'
        });
      }

      const userVoice = req.member?.voice?.channel;
      const isAdmin = await checkIsAdmin(guildId, user.userId);
      const botVoice = queue?.voiceChannel || req.guild?.members?.me?.voice?.channel;

      if (!userVoice && !isAdmin) {
        return res.status(400).json({
          success: false,
          error: 'Bạn phải tham gia vào kênh Voice trên Discord để điều khiển âm nhạc!'
        });
      }

      if (botVoice && userVoice && userVoice.id !== botVoice.id && !isAdmin) {
        return res.status(400).json({
          success: false,
          error: `Bạn cần ở cùng phòng Voice "${botVoice.name}" với Bot để điều khiển nhạc!`
        });
      }
    }

    try {
      logAction('WEB_PLAYER_ACTION', {
        guildId,
        userId: user.userId,
        user: `${user.displayName || user.username} 🌐`,
        action,
        value: typeof value === 'object' ? JSON.stringify(value) : value
      });

      // Vô hiệu hóa các nút điều khiển luồng phát khi không có bài hát và bot không phát âm thanh
      // Chống phá hoại (Anti-Sabotage): Đếm số lượng người nghe thật trong phòng Voice
      const voiceChannelForCheck = queue?.getVoiceChannel ? queue.getVoiceChannel() : (queue?.voiceChannel || req.guild?.members?.me?.voice?.channel);
      const humanListeners = voiceChannelForCheck?.members ? voiceChannelForCheck.members.filter(m => !m.user?.bot && m.id !== client.user?.id) : [];
      const humanCount = humanListeners.size !== undefined ? humanListeners.size : (Array.isArray(humanListeners) ? humanListeners.length : 0);
      const isActionAdmin = await checkIsAdmin(guildId, user.userId);
      const isActionDJ = await checkIsManager(guildId, user.userId);
      const canManageQueue = isActionAdmin || isActionDJ;

      // 1. Chặn thành viên thường Xóa Toàn Bộ Hàng Chờ (Clear) khi phòng có từ 2 người nghe trở lên
      if (action === 'clear' && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền xóa toàn bộ hàng chờ khi phòng có từ 2 người nghe trở lên!'
        });
      }

      // 2. Chặn thành viên thường Nhảy Cóc (PlayNow) khi phòng có từ 2 người nghe trở lên
      if (action === 'playNow' && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền nhảy cóc bài hát khi phòng có từ 2 người nghe trở lên!'
        });
      }

      // 3. Chặn thành viên thường Chuyển đổi Lofi 24/7 khi hàng chờ đang có bài và phòng có từ 2 người nghe
      if ((action === 'switchTo247' || action === 'resetTo247' || action === 'toggleLofiMode') && queue?.songs?.length > 0 && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền chuyển đổi sang chế độ Lofi 24/7 khi đang có người nghe!'
        });
      }

      const playbackActions = ['pause', 'resume', 'stop', 'seek', 'skip', 'previous'];
      if (playbackActions.includes(action)) {
        if ((!queue?.currentSong && !queue?.isPlaying) || queue?.isStopped) {
          return res.status(400).json({
            success: false,
            code: 'NOT_PLAYING',
            error: 'Hiện không có bài hát nào đang phát trong phòng!'
          });
        }
      }

      // 🔒 Chặn toàn bộ thao tác điều khiển tương tác khi đang ở chế độ Đài Radio Lofi 24/7
      const isLofiActionBlocked = Boolean(
        queue?.currentSong?.is247 ||
        queue?.currentSong?.requestedBy === 'Auto (24/7)' ||
        queue?.currentSong?.requestedBy === 'Auto (24/7 Lofi)' ||
        queue?.currentSong?.requestedBy?.includes?.('24/7') ||
        (queue?.mode247 && (!queue?.currentSong || queue?.currentSong?.requestedBy?.includes?.('Auto')))
      );

      const blocked247Actions = ['pause', 'resume', 'skip', 'previous', 'seek', 'shuffle', 'loop', 'toggleFavorite'];
      if (isLofiActionBlocked && blocked247Actions.includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Đang phát Radio Lofi 24/7 tự động. Hãy order bài hát mới để tương tác!'
        });
      }

      let resultMessage = '';
      switch (action) {
        case 'pause':
        case 'resume':
        case 'stop': {
          const isLofiCurrent = Boolean(queue?.currentSong && (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)')) || Boolean(queue?.mode247 && !queue?.currentSong);
          if (isLofiCurrent) {
            const isManager = await checkIsManager(guildId, user.userId);
            if (!isManager) {
              return res.status(403).json({
                success: false,
                error: 'Chỉ Quản lý máy chủ hoặc có vai trò Quản lý / DJ mới có quyền tạm dừng hoặc dừng nhạc nền 24/7!'
              });
            }
          }
          if (action === 'pause') {
            queue.pause();
            resultMessage = 'Đã tạm dừng bài hát';
          } else if (action === 'resume') {
            queue.resume();
            resultMessage = 'Đã tiếp tục phát nhạc';
          } else {
            queue.stop();
            resultMessage = 'Đã dừng phát và xóa toàn bộ hàng chờ';
          }
          break;
        }
        case 'seek': {
          const seekSec = Math.max(0, Math.floor(Number(value) || 0));
          await queue.seek(seekSec);
          const mins = Math.floor(seekSec / 60);
          const secs = seekSec % 60;
          const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          resultMessage = `Đã tua đến ${formatted}`;
          break;
        }
        case 'skip': {
          const member = req.member || (req.guild ? await req.guild.members.fetch(user.userId).catch(() => null) : null);
          if (member) {
            const skipResult = queue.checkOrCastSkipVote(member);
            if (skipResult.status === 'skipped') {
              resultMessage = `Đã chuyển bài hát tiếp theo bởi @${user.displayName || user.username}`;
              if (skipResult.reason === 'vote_passed') {
                queue.textChannel?.send(t(guildId, 'skip.vote_passed', {
                  title: skipResult.title,
                  current: skipResult.current,
                  required: skipResult.required
                })).catch(() => {});
              }
            } else if (skipResult.status === 'vote_progress') {
              resultMessage = `Đã bỏ phiếu qua bài (${skipResult.current}/${skipResult.required}) — Cần thêm ${skipResult.needed} phiếu!`;
              queue.textChannel?.send(t(guildId, 'skip.vote_progress', {
                user: skipResult.user,
                current: skipResult.current,
                required: skipResult.required,
                needed: skipResult.needed
              })).catch(() => {});
            } else if (skipResult.status === 'vote_retracted') {
              resultMessage = `Đã rút phiếu bỏ qua (${skipResult.current}/${skipResult.required})`;
              queue.textChannel?.send(t(guildId, 'skip.vote_retracted', {
                user: skipResult.user,
                current: skipResult.current,
                required: skipResult.required
              })).catch(() => {});
            }
          } else {
            queue.skip();
            resultMessage = `Đã chuyển bài hát tiếp theo bởi @${user.displayName || user.username}`;
          }
          break;
        }
        case 'previous': {
          const ok = await queue.playPrevious();
          resultMessage = ok ? 'Đã quay lại bài hát trước đó ⏮️' : 'Không có bài hát trước đó để quay lại';
          break;
        }
        case 'move': {
          const humanListeners = queue?.voiceChannel?.members ? queue.voiceChannel.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền thay đổi vị trí bài hát khi phòng có từ 2 người nghe trở lên!'
            });
          }
          const { from, to } = value || {};
          const ok = queue.moveTrack(from, to);
          resultMessage = ok ? 'Đã thay đổi thứ tự hàng chờ' : 'Không thể di chuyển bài hát';
          break;
        }
        case 'toggleFavorite': {
          const trackToFav = value || queue?.currentSong;
          if (trackToFav && trackToFav.title) {
            if (trackToFav.is247 || trackToFav.requestedBy === 'Auto (24/7)' || trackToFav.requestedBy === 'Auto (24/7 Lofi)') {
              return res.status(400).json({ success: false, error: 'Không thể thêm nhạc nền chế độ 24/7 Lofi vào danh sách yêu thích' });
            }
            if (!trackToFav.url) {
              trackToFav.url = queue?.currentSong?.url || (trackToFav.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(trackToFav.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(trackToFav.title)}`);
            }
            try {
              const favRes = await favoriteManager.toggleFavorite(user.userId, trackToFav);
              resultMessage = favRes.isAdded ? `Đã thêm "${trackToFav.title}" vào Yêu thích ❤️` : `Đã xóa "${trackToFav.title}" khỏi Yêu thích`;
            } catch (favErr) {
              return res.status(400).json({ success: false, error: favErr.message });
            }
          } else {
            resultMessage = 'Không có bài hát để yêu thích';
          }
          break;
        }
        case 'playNow': {
          const targetVoice = queue?.voiceChannel || req.member?.voice?.channel;
          const humanListeners = targetVoice?.members ? targetVoice.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền phát ngay bài hát (nhảy cóc hàng chờ) khi phòng có từ 2 người nghe trở lên!'
            });
          }
          let targetQueue = queue;
          if (!targetQueue) {
            const userVoice = req.member?.voice?.channel;
            if (!userVoice) {
              return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
            }
            const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
            let textChannel = null;
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
            targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, userVoice);
          }

          let ok = false;
          if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
            ok = await targetQueue.playNow(Number(value));
          } else if (value && typeof value === 'object') {
            // Nếu bài nằm trong hàng chờ và khớp vị trí index
            if (typeof value.index === 'number' && targetQueue.songs[value.index] && (targetQueue.songs[value.index].url === value.url || targetQueue.songs[value.index].title === value.title)) {
              ok = await targetQueue.playNow(value.index);
            } else {
              let resolvedTrack = value;
              if (!resolvedTrack.url || resolvedTrack.url.includes('youtube.com/results?search_query=')) {
                const q = resolvedTrack.searchQuery || `${resolvedTrack.title || ''} ${resolvedTrack.artist || ''}`.trim();
                const found = await searchTrack(q);
                if (found && found.length > 0) {
                  resolvedTrack = { ...found[0], ...resolvedTrack, url: found[0].url, duration: found[0].duration || resolvedTrack.duration, thumbnail: resolvedTrack.thumbnail || found[0].thumbnail };
                }
              }
              const memberAvatar = req.member?.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
              resolvedTrack.title = sanitizeDiscordText(resolvedTrack.title, 200) || 'Unknown Track';
              resolvedTrack.artist = sanitizeDiscordText(resolvedTrack.artist, 100) || 'YouTube';
              resolvedTrack.thumbnail = sanitizeThumbnailUrl(resolvedTrack.thumbnail);
              resolvedTrack.is247 = false;
              resolvedTrack.requestedBy = `<@${req.member?.id || user.userId}>`;
              resolvedTrack.requestedByName = req.member?.displayName || user.displayName || user.username;
              resolvedTrack.requestedByAvatar = memberAvatar;
              resolvedTrack.requestedById = req.member?.id || user.userId;

              ok = await targetQueue.playTrackNow(resolvedTrack, {
                id: req.member?.id || user.userId,
                displayName: req.member?.displayName || user.displayName || user.username,
                username: req.member?.user?.username || user.username,
                avatar: memberAvatar
              });
            }
          }
          if (!ok) {
            return res.status(400).json({ success: false, error: 'Không thể phát ngay bài hát được chọn!' });
          }
          resultMessage = 'Đang phát ngay bài hát được chọn ▶️';
          break;
        }
        case 'playFavorites': {
          const userVoice = req.member?.voice?.channel;
          if (!userVoice) {
            return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
          }
          const favorites = await favoriteManager.getFavorites(user.userId);
          if (!favorites || favorites.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'Bạn chưa có bài hát nào trong danh sách Yêu thích ❤️'
            });
          }
          const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
          let textChannel = queue?.textChannel;
          if (!textChannel) {
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
          }
          const voiceChannel = queue?.voiceChannel || userVoice;
          const targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, voiceChannel);
          const memberAvatar = req.member.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const validTracks = favorites.slice(0, 100).map(fav => ({
            title: sanitizeDiscordText(fav.title, 200) || 'Unknown Track',
            artist: sanitizeDiscordText(fav.artist, 100) || 'Unknown Artist',
            url: fav.url,
            thumbnail: sanitizeThumbnailUrl(fav.thumbnail),
            duration: fav.duration || '3:30',
            is247: false,
            requestedBy: `<@${req.member.id}>`,
            requestedByName: req.member.displayName || user.username,
            requestedByAvatar: memberAvatar,
            requestedById: req.member.id
          }));
          const requesterObj = {
            id: req.member.id,
            displayName: req.member.displayName || user.username,
            username: req.member.user?.username || user.username,
            avatar: memberAvatar
          };
          await targetQueue.addSongs(validTracks, requesterObj);
          sendWebQueueNotification(req.guild, targetQueue, guildSettings, t(guildId, 'web_notify.added_favorites', {
            user: req.member.displayName || user.username,
            count: validTracks.length
          }));
          resultMessage = `Đã nạp toàn bộ ${validTracks.length} bài hát yêu thích vào hàng chờ ❤️`;
          break;
        }
        case 'playUserPlaylist': {
          const userVoice = req.member?.voice?.channel;
          if (!userVoice) {
            return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
          }
          const playlistId = value?.playlistId || value;
          if (!playlistId) {
            return res.status(400).json({ success: false, error: 'Thiếu playlistId cần phát' });
          }
          const playlists = await userPlaylistManager.getUserPlaylists(user.userId);
          const targetPlaylist = playlists.find(p => p.id === playlistId);
          if (!targetPlaylist) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy playlist của bạn' });
          }
          if (!targetPlaylist.songs || targetPlaylist.songs.length === 0) {
            return res.status(400).json({
              success: false,
              error: `Playlist "${targetPlaylist.name}" chưa có bài hát nào!`
            });
          }

          const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
          let textChannel = queue?.textChannel;
          if (!textChannel) {
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
          }
          const voiceChannel = queue?.voiceChannel || userVoice;
          const targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, voiceChannel);
          const memberAvatar = req.member.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const validTracks = targetPlaylist.songs.slice(0, 100).map(item => ({
            title: sanitizeDiscordText(item.title, 200) || 'Unknown Track',
            artist: sanitizeDiscordText(item.artist, 100) || 'Unknown Artist',
            url: item.url,
            thumbnail: sanitizeThumbnailUrl(item.thumbnail),
            duration: item.duration || '3:30',
            is247: false,
            requestedBy: `<@${req.member.id}>`,
            requestedByName: req.member.displayName || user.username,
            requestedByAvatar: memberAvatar,
            requestedById: req.member.id
          }));
          const requesterObj = {
            id: req.member.id,
            displayName: req.member.displayName || user.username,
            username: req.member.user?.username || user.username,
            avatar: memberAvatar
          };
          await targetQueue.addSongs(validTracks, requesterObj);
          sendWebQueueNotification(req.guild, targetQueue, guildSettings, t(guildId, 'web_notify.added_playlist', {
            user: req.member.displayName || user.username,
            name: targetPlaylist.name,
            count: validTracks.length
          }));
          resultMessage = `Đã nạp toàn bộ ${validTracks.length} bài hát từ playlist "${targetPlaylist.name}" vào hàng chờ 🎵`;
          break;
        }
        case 'clear': {
          const humanListeners = queue?.voiceChannel?.members ? queue.voiceChannel.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền xóa toàn bộ hàng chờ khi phòng có từ 2 người nghe trở lên!'
            });
          }
          if (queue) {
            queue.songs = [];
            queue.preloadedResource = null;
            queue.preloadedSongUrl = null;
            queue.prefetchedSong = null;
            if (queue.loopMode === 'song' || queue.loopMode === 'queue') {
              queue.loopMode = 'off';
            }
            queue.refreshNowPlayingCard?.();
          }
          resultMessage = 'Đã xóa toàn bộ bài hát trong hàng chờ';
          break;
        }
        case 'shuffle':
          queue.shuffle();
          resultMessage = 'Đã xáo trộn hàng chờ';
          break;
        case 'loop': {
          const isLofiCurrent = Boolean(queue?.currentSong && (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)')) || Boolean(queue?.mode247 && !queue?.currentSong);
          if (isLofiCurrent) {
            return res.status(400).json({
              success: false,
              error: 'Chế độ phát Lofi 24/7 tự động chuyển bài radio, không áp dụng chế độ lặp!'
            });
          }
          // toggle loop: off -> song -> queue -> off
          const modes = ['off', 'song', 'queue'];
          const currentIdx = modes.indexOf(queue.loopMode || 'off');
          const nextMode = value || modes[(currentIdx + 1) % modes.length];
          queue.setLoop(nextMode);
          resultMessage = `Chế độ lặp lại: ${nextMode.toUpperCase()}`;
          break;
        }
        case 'volume': {
          const parsed = parseInt(value, 10);
          const vol = isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
          queue.setVolume(vol);
          resultMessage = `Âm lượng: ${vol}%`;
          break;
        }
        case 'toggle247': {
          if (queue) {
            const is247 = queue.toggle247();
            if (is247 && !queue.currentSong) {
              queue._play247BackgroundLofi().catch(() => {});
            }
            resultMessage = is247 ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          } else {
            const current = settingsManager.get(guildId);
            const newVal = !current.mode247;
            settingsManager.update(guildId, { mode247: newVal });
            resultMessage = newVal ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          }
          break;
        }
        case 'set247': {
          const targetVal = Boolean(value);
          if (queue) {
            queue.set247(targetVal);
            if (targetVal && !queue.currentSong) {
              queue._play247BackgroundLofi().catch(() => {});
            }
          }
          settingsManager.update(guildId, { mode247: targetVal });
          resultMessage = targetVal ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          break;
        }
        case 'switchTo247':
        case 'resetTo247': {
          let targetQueue = queue;
          if (!targetQueue) {
            const guild = client.guilds.cache.get(guildId);
            const member = guild?.members?.cache.get(user.userId) || await guild?.members?.fetch(user.userId).catch(() => null);
            const userVoice = member?.voice?.channel;
            const guildSettings = settingsManager.get(guildId);
            const voiceChannel = userVoice || (guildSettings.voiceChannelId ? guild.channels.cache.get(guildSettings.voiceChannelId) : null);
            const textChannel = guildSettings.musicChannelId ? guild.channels.cache.get(guildSettings.musicChannelId) : (guild.systemChannel || member?.voice?.channel);
            if (guild && voiceChannel) {
              targetQueue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
            }
          }
          if (targetQueue) {
            const switchResult = await targetQueue.switchTo247Lofi();
            resultMessage = switchResult?.message || (targetQueue.songs.length > 0
              ? `Đã chuyển sang Lofi 24/7 (Đang giữ ${targetQueue.songs.length} bài trong hàng chờ)`
              : 'Đã chuyển sang chế độ phát Lofi 24/7 thư giãn');
          } else {
            settingsManager.update(guildId, { mode247: true });
            resultMessage = 'Đã bật chế độ 24/7 (Bot chưa kết nối phòng Voice)';
          }
          break;
        }
        case 'toggleLofiMode': {
          let targetQueue = queue;
          if (!targetQueue) {
            const guild = client.guilds.cache.get(guildId);
            const member = guild?.members?.cache.get(user.userId) || await guild?.members?.fetch(user.userId).catch(() => null);
            const userVoice = member?.voice?.channel;
            const guildSettings = settingsManager.get(guildId);
            const voiceChannel = userVoice || (guildSettings.voiceChannelId ? guild.channels.cache.get(guildSettings.voiceChannelId) : null);
            const textChannel = guildSettings.musicChannelId ? guild.channels.cache.get(guildSettings.musicChannelId) : (guild.systemChannel || member?.voice?.channel);
            if (guild && voiceChannel) {
              targetQueue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
            }
          }
          if (targetQueue) {
            const toggleRes = await targetQueue.toggleLofiMode();
            resultMessage = toggleRes?.message || 'Đã chuyển đổi chế độ phát nhạc';
          } else {
            resultMessage = 'Bot chưa kết nối phòng Voice';
          }
          break;
        }
        case 'toggleAutoplay': {
          const current = settingsManager.get(guildId);
          const newVal = !current.autoplay;
          settingsManager.update(guildId, { autoplay: newVal });
          resultMessage = newVal ? 'Đã BẬT Tự Động Phát Bài Tương Tự (Autoplay)' : 'Đã TẮT Tự Động Phát';
          break;
        }
        case 'setAutoplay': {
          const targetVal = Boolean(value);
          settingsManager.update(guildId, { autoplay: targetVal });
          resultMessage = targetVal ? 'Đã BẬT Tự Động Phát Bài Tương Tự (Autoplay)' : 'Đã TẮT Tự Động Phát';
          break;
        }
        case 'setLogChannel': {
          const newLogChannel = value || null;
          settingsManager.update(guildId, { logChannelId: newLogChannel });
          resultMessage = newLogChannel ? `Đã cấu hình Kênh Nhật Ký (Log Channel): <#${newLogChannel}>` : 'Đã TẮT Kênh Nhật Ký hoạt động';
          break;
        }
        case 'updateSettings': {
          if (typeof value === 'object' && value !== null) {
            settingsManager.update(guildId, value);
            if (value.language !== undefined && queue && typeof queue.refreshNowPlayingCard === 'function') {
              queue.refreshNowPlayingCard();
            }
            resultMessage = 'Đã lưu cài đặt máy chủ thành công!';
          }
          break;
        }
        case 'remove':
        case 'removeBatch': {
          const isSongOwned = (song) => {
            if (canManageQueue) return true;
            if (humanCount < 2) return true;
            if (!song) return false;
            // Nếu là bài phát tự động hoặc 24/7 -> cho phép xóa
            if (song.is247 || song.requestedBy === 'Auto' || song.requestedBy === 'DJ AI (Gợi ý)' || song.requestedBy === 'Auto (24/7)' || song.requestedBy === 'Tự động phát') return true;
            if (song.requestedById && String(song.requestedById) === String(user.userId)) return true;
            if (typeof song.requestedBy === 'string' && song.requestedBy.includes(String(user.userId))) return true;
            return false;
          };

          if (Array.isArray(value)) {
            if (humanCount >= 2 && !canManageQueue) {
              const anyNotMine = value.some(idx => {
                const s = queue?.songs?.[Number(idx)];
                return s && !isSongOwned(s);
              });
              if (anyNotMine) {
                return res.status(403).json({
                  success: false,
                  code: 'PERMISSION_DENIED',
                  error: 'Bạn chỉ có quyền xóa các bài hát do chính mình yêu cầu khi phòng có từ 2 người trở lên!'
                });
              }
            }
            const sortedIndices = value
              .map(Number)
              .filter(n => !isNaN(n) && n >= 0 && n < (queue?.songs?.length || 0))
              .sort((a, b) => b - a);
            for (const idx of sortedIndices) {
              queue.songs.splice(idx, 1);
            }
            resultMessage = `Đã xóa ${sortedIndices.length} bài hát khỏi hàng chờ`;
          } else {
            const idx = parseInt(value, 10);
            if (!isNaN(idx) && idx >= 0 && idx < (queue?.songs?.length || 0)) {
              const targetSong = queue.songs[idx];
              if (humanCount >= 2 && !canManageQueue && !isSongOwned(targetSong)) {
                return res.status(403).json({
                  success: false,
                  code: 'PERMISSION_DENIED',
                  error: 'Bạn chỉ có quyền xóa các bài hát do chính mình yêu cầu khi phòng có từ 2 người trở lên!'
                });
              }
              const removed = queue.songs.splice(idx, 1)[0];
              resultMessage = `Đã xóa "${removed.title}" khỏi hàng chờ`;
            }
          }
          queue?._saveSessionState?.();
          queue?.refreshNowPlayingCard?.();
          break;
        }
        default:
          return res.status(400).json({ success: false, error: 'Hành động không hợp lệ' });
      }

      return res.json({ success: true, message: resultMessage, action, value });
    } catch (err) {
      console.error('[API Action Error]:', err);
      return res.status(500).json({ success: false, error: err.message || 'Lỗi thao tác' });
    }
  });

  // 6. Lấy Cài đặt & Danh sách Kênh của Máy chủ
  router.get('/guilds/:guildId/settings', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const user = req.user;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const isAdmin = await checkIsAdmin(guildId, user.userId);
    const settings = settingsManager.get(guildId);

    const textChannels = guild.channels.cache
      .filter(c => c.isTextBased && c.isTextBased())
      .map(c => ({ id: c.id, name: c.name, type: c.type }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const voiceChannels = guild.channels.cache
      .filter(c => c.isVoiceBased && c.isVoiceBased())
      .map(c => ({ id: c.id, name: c.name, type: c.type }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const roles = guild.roles.cache
      .filter(r => r.id !== guildId)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      isAdmin,
      settings,
      textChannels,
      voiceChannels,
      roles
    });
  });

  // 7. Cập nhật Cài đặt Máy chủ từ Web Dashboard
  router.post('/guilds/:guildId/settings', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const user = req.user;

    const isAdmin = await checkIsAdmin(guildId, user.userId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        error: 'Chỉ Quản trị viên mới được phép thay đổi cài đặt máy chủ!'
      });
    }

    try {
      const updated = settingsManager.update(guildId, req.body);
      const queue = client.musicManager ? client.musicManager.get(guildId) : null;
      if (queue) {
        if (req.body.language !== undefined) {
          if (typeof queue.refreshNowPlayingCard === 'function') {
            queue.refreshNowPlayingCard();
          }
          if (queue.voiceChannel && !queue.currentSong) {
            if (queue.mode247) {
              setVoiceChannelStatus(queue.voiceChannel, updated.language === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
            } else {
              clearVoiceChannelStatus(queue.voiceChannel);
            }
          }
        }
        if (updated.crossfadeDuration !== undefined) {
          queue.crossfadeDuration = updated.crossfadeDuration;
        }
        if (req.body.mode247 !== undefined) {
          queue.set247(Boolean(updated.mode247));
          if (updated.mode247 === true && !queue.currentSong) {
            queue._play247BackgroundLofi().catch(() => {});
          }
        }
      }
      logAction('WEB_PLAYER_ACTION', {
        guildId,
        userId: user.userId,
        user: `${user.displayName || user.username} 🌐`,
        action: 'UPDATE_SETTINGS_DASHBOARD',
        content: JSON.stringify(req.body)
      });
      return res.json({ success: true, settings: updated, message: 'Đã lưu cài đặt thành công!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi khi lưu cài đặt' });
    }
  });

  // 6. Lấy Lời bài hát (Karaoke Lyrics)
  router.get('/guilds/:guildId/lyrics', requireAuth, requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const currentTrack = queue?.currentSong || queue?.currentTrack;

    if (!queue || !currentTrack) {
      return res.json({ success: true, lyrics: 'Không có bài hát nào đang phát', synced: false });
    }

    try {
      let rawArtist = currentTrack.artist || '';
      if (rawArtist === 'YouTube Music' || rawArtist === 'YouTube' || rawArtist === 'Unknown') {
        rawArtist = '';
      }
      const rawTitle = currentTrack.title || '';
      const safeTitle = typeof rawTitle === 'string' ? rawTitle.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
      const queryArtist = typeof rawArtist === 'string' ? rawArtist.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';

      let durMs = currentTrack.durationMs;
      if (!durMs && currentTrack.duration && currentTrack.duration !== 'LIVE') {
        const p = currentTrack.duration.split(':').map(Number);
        if (!p.some(isNaN)) {
          durMs = p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 : (p.length === 2 ? (p[0] * 60 + p[1]) * 1000 : p[0] * 1000);
        }
      }
      const settingsManager = require('../structures/SettingsManager');
      const guildSettings = settingsManager.get(guildId);
      const lyricsData = await getLyrics(safeTitle, queryArtist, durMs || 0, currentTrack.url, guildSettings?.lyricsLayers);

      // Nếu bài hát đang phát chưa có Live Lyrics trên Discord mà API vừa tìm thấy lời -> Tự động nạp nóng (Hot-Attach)
      if (queue && queue.currentSong && !queue.hasSyncedLyrics && lyricsData?.syncedLyrics?.length >= 3) {
        queue.attachLateLyrics(queue.currentSong, lyricsData);
      }

      let activeSyncedLyrics = lyricsData?.syncedLyrics || null;
      let activeAutoOffsetMs = lyricsData?.autoOffsetMs || 0;

      // Chuẩn hóa hệ quy chiếu Lyrics khi bài hát có SponsorBlock Trim (Clone an toàn, không mutate cache)
      if (lyricsData && (currentTrack.trimStart > 0 || currentTrack.trimEnd > 0)) {
        const trimStartMs = (currentTrack.trimStart || 0) * 1000;
        const realDurMs = currentTrack.durationMs || 0;

        if (lyricsData.source === 'youtube_cc' && Array.isArray(lyricsData.syncedLyrics)) {
          activeSyncedLyrics = lyricsData.syncedLyrics
            .map(line => ({
              ...line,
              time: line.time - trimStartMs,
              time_ms: (line.time_ms ?? line.time) - trimStartMs
            }))
            .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
            .map(line => ({
              ...line,
              time: Math.max(0, line.time),
              time_ms: Math.max(0, line.time_ms)
            }));
          activeAutoOffsetMs = 0;
        } else {
          activeAutoOffsetMs = 0;
        }
      }

      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || currentTrack.title,
        artist: lyricsData?.artist || (currentTrack.artist && currentTrack.artist !== 'YouTube Music' ? currentTrack.artist : (lyricsData?.artist || '')),
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: activeAutoOffsetMs,
        userSavedOffsetMs: lyricsData?.userSavedOffsetMs || 0,
        trackKey: lyricsData?.trackKey || null,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: activeSyncedLyrics,
        synced: !!activeSyncedLyrics,
        source: lyricsData?.source || 'lrclib',
        isRemixOrDurationMismatch: Boolean(lyricsData?.isRemixOrDurationMismatch),
        isExternalSource: Boolean(lyricsData?.source && lyricsData.source !== 'youtube_cc')
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  router.get('/lyrics', requireAuth, lyricsLimiter, async (req, res) => {
    const rawTitle = req.query.title || req.query.q;
    const rawArtist = req.query.artist || '';
    const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
    const artist = typeof rawArtist === 'string' ? rawArtist.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
    const durationMs = parseInt(req.query.duration, 10) || 0;
    const targetUrl = req.query.url || null;
    if (!title) {
      return res.json({ success: false, error: 'Thiếu tham số title' });
    }
    try {
      let queryArtist = artist || '';
      if (queryArtist === 'YouTube Music' || queryArtist === 'YouTube' || queryArtist === 'Unknown') {
        queryArtist = '';
      }
      const lyricsData = await getLyrics(title, queryArtist, durationMs, targetUrl);

      if (callerQueue && callerQueue.currentSong && !callerQueue.hasSyncedLyrics && lyricsData?.syncedLyrics?.length >= 3) {
        callerQueue.attachLateLyrics(callerQueue.currentSong, lyricsData);
      }

      let activeSyncedLyrics = lyricsData?.syncedLyrics || null;
      let activeAutoOffsetMs = lyricsData?.autoOffsetMs || 0;
      const callerQueue = req.user?.guildId && client.musicManager ? client.musicManager.get(req.user.guildId) : null;
      const currentTrack = callerQueue?.currentSong;
      if (currentTrack && lyricsData && (currentTrack.trimStart > 0 || currentTrack.trimEnd > 0) && (!targetUrl || targetUrl === currentTrack.url)) {
        const trimStartMs = (currentTrack.trimStart || 0) * 1000;
        const realDurMs = currentTrack.durationMs || 0;
        if (lyricsData.source === 'youtube_cc' && Array.isArray(lyricsData.syncedLyrics)) {
          activeSyncedLyrics = lyricsData.syncedLyrics
            .map(line => ({
              ...line,
              time: line.time - trimStartMs,
              time_ms: (line.time_ms ?? line.time) - trimStartMs
            }))
            .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
            .map(line => ({
              ...line,
              time: Math.max(0, line.time),
              time_ms: Math.max(0, line.time_ms)
            }));
          activeAutoOffsetMs = 0;
        } else {
          activeAutoOffsetMs = 0;
        }
      }

      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || title,
        artist: lyricsData?.artist || artist,
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: activeAutoOffsetMs,
        userSavedOffsetMs: lyricsData?.userSavedOffsetMs || 0,
        trackKey: lyricsData?.trackKey || null,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: activeSyncedLyrics,
        synced: !!activeSyncedLyrics,
        source: lyricsData?.source || 'lrclib',
        isRemixOrDurationMismatch: Boolean(lyricsData?.isRemixOrDurationMismatch),
        isExternalSource: Boolean(lyricsData?.source && lyricsData.source !== 'youtube_cc')
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  // 6.0 Lưu nhớ mốc bù trừ lời bài hát (Offset) vào MongoDB & RAM Cache (Bảo mật: kẹp biên & kiểm tra cùng Voice)
  router.post('/guilds/:guildId/lyrics/offset', requireAuth, requireSameGuild, async (req, res) => {
    const { trackKey, offsetMs, title, artist } = req.body;
    const numOffset = Number(offsetMs);
    if (!trackKey || !Number.isFinite(numOffset)) {
      return res.status(400).json({ success: false, error: 'Thiếu tham số trackKey hoặc offsetMs hợp lệ' });
    }

    const { guildId } = req.params;
    const user = req.user;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const botVoice = queue?.voiceChannel || req.guild?.members?.me?.voice?.channel;
    const userVoice = req.member?.voice?.channel;
    const isAdmin = await checkIsAdmin(guildId, user.userId);

    if (!isAdmin && (!userVoice || !botVoice || userVoice.id !== botVoice.id)) {
      return res.status(403).json({
        success: false,
        error: 'Bạn phải ở cùng kênh thoại với bot để điều chỉnh bù trễ lời bài hát!'
      });
    }

    const clampedOffset = Math.max(-30000, Math.min(30000, Math.round(numOffset)));

    // Kiểm tra quyền lưu mốc toàn server: Admin / DJ hoặc là người gọi bài hát đang phát
    const canSaveGlobal = isAdmin || hasMusicPermission(req.member) || (queue?.currentSong?.requestedById === user.userId);
    if (!canSaveGlobal) {
      return res.json({ success: true, localOnly: true, trackKey, offsetMs: clampedOffset });
    }

    try {
      const { saveLyricOffset } = require('../utils/lyricsHelper');
      await saveLyricOffset(trackKey, clampedOffset, title, artist);

      // Đồng bộ ngay lập tức sang hàng đợi MusicQueue đang phát nếu có
      if (queue && queue.currentSong) {
        queue.currentLyricOffsetMs = clampedOffset;
        if (queue.hasSyncedLyrics) {
          queue._lastLyricsEditTime = 0; // Bỏ qua cooldown để cập nhật Card ngay
          queue.scheduleNextLyricUpdate(queue.currentSong);
        }
      }

      return res.json({ success: true, trackKey, offsetMs: clampedOffset });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/lyrics/offset', requireAuth, async (req, res) => {
    const { trackKey, offsetMs, title, artist } = req.body;
    const numOffset = Number(offsetMs);
    if (!trackKey || !Number.isFinite(numOffset)) {
      return res.status(400).json({ success: false, error: 'Thiếu tham số trackKey hoặc offsetMs hợp lệ' });
    }

    const guildId = req.user.guildId;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin máy chủ trong phiên đăng nhập' });
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }
    const member = guild.members.cache.get(req.user.userId) || await guild.members.fetch(req.user.userId).catch(() => null);
    if (!member) {
      return res.status(403).json({ success: false, error: 'Bạn không phải thành viên máy chủ này' });
    }

    const isAdmin = isStrictAdmin(member);
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const botVoice = queue?.voiceChannel || guild.members.me?.voice?.channel;
    const userVoice = member.voice?.channel;

    if (!isAdmin && (!userVoice || !botVoice || userVoice.id !== botVoice.id)) {
      return res.status(403).json({
        success: false,
        error: 'Bạn phải ở cùng kênh thoại với bot để điều chỉnh bù trễ lời bài hát!'
      });
    }

    const clampedOffset = Math.max(-30000, Math.min(30000, Math.round(numOffset)));

    // Kiểm tra quyền lưu mốc toàn server: Admin / DJ hoặc là người gọi bài hát đang phát
    const canSaveGlobal = isAdmin || hasMusicPermission(member) || (queue?.currentSong?.requestedById === req.user.userId);
    if (!canSaveGlobal) {
      return res.json({ success: true, localOnly: true, trackKey, offsetMs: clampedOffset });
    }

    try {
      const { saveLyricOffset } = require('../utils/lyricsHelper');
      await saveLyricOffset(trackKey, clampedOffset, title, artist);

      // Đồng bộ ngay lập tức sang hàng đợi MusicQueue đang phát nếu có
      if (queue && queue.currentSong) {
        queue.currentLyricOffsetMs = clampedOffset;
        if (queue.hasSyncedLyrics) {
          queue._lastLyricsEditTime = 0; // Bỏ qua cooldown để cập nhật Card ngay
          queue.scheduleNextLyricUpdate(queue.currentSong);
        }
      }

      return res.json({ success: true, trackKey, offsetMs: clampedOffset });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6.1 Kiểm tra trạng thái hoạt động của 3 tầng Lyric (Diagnostics / Health Check)
  router.get('/lyrics/status', requireAuth, lyricsLimiter, async (req, res) => {
    // 1. Kiểm tra Tầng 1: LRCLIB (Spotify/Apple Music Open DB)
    let tier1 = {
      tier: 1,
      name: 'LRCLIB (Direct Open API)',
      sources: 'Spotify / Apple Music Community Database',
      speed: 'Siêu tốc (50ms - 150ms)',
      status: 'CHECKING',
      pingMs: 0
    };
    const t0 = Date.now();
    try {
      const r1 = await fetch('https://lrclib.net/api/get?track_name=test&artist_name=test', {
        headers: { 'User-Agent': 'AnnaMusicBot/2.0' },
        signal: AbortSignal.timeout(3500)
      });
      tier1.pingMs = Date.now() - t0;
      tier1.status = (r1.status === 200 || r1.status === 404) ? 'ONLINE (Hoạt động tốt)' : `HTTP_${r1.status}`;
    } catch (e) {
      tier1.status = 'OFFLINE (' + e.message + ')';
    }

    // 2. Kiểm tra Tầng 2: Python Microservice (syncedlyrics)
    const fallbackBaseUrl = process.env.LYRICS_FALLBACK_URL || 'http://127.0.0.1:8787/lyrics';
    const healthUrl = fallbackBaseUrl.replace(/\/lyrics\/?$/, '/health');
    let tier2 = {
      tier: 2,
      name: 'Python Fallback Microservice',
      sources: 'Musixmatch, NetEase Music, Genius',
      speed: 'Toàn diện (1s - 2.5s)',
      url: healthUrl,
      status: 'CHECKING',
      pingMs: 0
    };
    const t1 = Date.now();
    try {
      const r2 = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000)
      });
      tier2.pingMs = Date.now() - t1;
      if (r2.ok) {
        const d2 = await r2.json().catch(() => ({}));
        tier2.status = d2.status === 'ok' ? 'ONLINE (Hoạt động tốt)' : 'ONLINE';
      } else {
        tier2.status = `HTTP_${r2.status}`;
      }
    } catch (e) {
      tier2.status = 'OFFLINE (Chưa bật service trên VPS hoặc port 8787 chưa lắng nghe)';
    }

    // 3. Kiểm tra Tầng 3: Zing MP3 Lyrics Engine (Karaoke V-Pop)
    let tier3 = {
      tier: 3,
      name: 'Zing MP3 Lyrics Engine',
      sources: 'Zing MP3 Karaoke Database (V-Pop chính xác từng câu/từ)',
      speed: 'Cực nhanh (100ms - 250ms)',
      status: 'CHECKING',
      pingMs: 0
    };
    const t2 = Date.now();
    try {
      const r3 = await fetch('https://ac.zingmp3.vn/complete?type=artist,song,key,hub&num=1&query=test', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000)
      });
      tier3.pingMs = Date.now() - t2;
      tier3.status = r3.ok ? 'ONLINE (Hoạt động tốt)' : `HTTP_${r3.status}`;
    } catch (e) {
      tier3.status = 'OFFLINE (' + e.message + ')';
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      architecture: 'Mô hình 4 Tầng Lời Bài Hát Đa Nguồn: YouTube CC -> Zing MP3 (V-Pop Karaoke) -> LRCLIB (Spotify/Apple Music) -> Python Microservice (Musixmatch)',
      providers: [tier1, tier2, tier3],
      summary: {
        tier1Online: tier1.status.startsWith('ONLINE'),
        tier2Online: tier2.status.startsWith('ONLINE'),
        tier3Online: tier3.status.startsWith('ONLINE'),
        message: 'Hệ thống lời bài hát đa nguồn đang hoạt động sẵn sàng (hỗ trợ cả karaoke đồng bộ và lyric đọc toàn diện)!'
      }
    });
  });

  // ── USER PLAYLISTS APIS (Quản lý Playlist cá nhân của người dùng) ──
  // 1. Lấy danh sách playlist của người dùng hiện tại
  router.get('/playlists/me', requireAuth, async (req, res) => {
    try {
      const playlists = await userPlaylistManager.getUserPlaylists(req.user.userId);
      res.json({ success: true, playlists });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Tạo playlist mới
  router.post('/playlists/me', requireAuth, async (req, res) => {
    try {
      const { name, description } = req.body;
      const newPlaylist = await userPlaylistManager.createPlaylist(req.user.userId, { name, description });
      res.json({ success: true, playlist: newPlaylist, message: `Đã tạo playlist "${newPlaylist.name}" thành công` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 3. Cập nhật playlist (đổi tên / sửa mô tả)
  router.put('/playlists/me/:playlistId', requireAuth, async (req, res) => {
    try {
      const { playlistId } = req.params;
      const { name, description } = req.body;
      const updated = await userPlaylistManager.updatePlaylist(req.user.userId, playlistId, { name, description });
      res.json({ success: true, playlist: updated, message: 'Đã cập nhật playlist thành công' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 4. Xóa playlist
  router.delete('/playlists/me/:playlistId', requireAuth, async (req, res) => {
    try {
      const { playlistId } = req.params;
      await userPlaylistManager.deletePlaylist(req.user.userId, playlistId);
      res.json({ success: true, message: 'Đã xóa playlist thành công' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 5. Thêm bài hát vào playlist
  router.post('/playlists/me/:playlistId/tracks', requireAuth, async (req, res) => {
    try {
      const { playlistId } = req.params;
      const { track } = req.body;
      const result = await userPlaylistManager.addTrackToPlaylist(req.user.userId, playlistId, track);
      res.json({
        success: true,
        playlist: result.playlist,
        track: result.track,
        message: `Đã thêm "${result.track.title}" vào playlist "${result.playlist.name}"`
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 6. Xóa bài hát khỏi playlist
  router.delete('/playlists/me/:playlistId/tracks/:trackIndex', requireAuth, async (req, res) => {
    try {
      const { playlistId, trackIndex } = req.params;
      const indexNum = parseInt(trackIndex, 10);
      const identifier = isNaN(indexNum) ? (req.query.url || trackIndex) : indexNum;
      const updated = await userPlaylistManager.removeTrackFromPlaylist(req.user.userId, playlistId, identifier);
      res.json({ success: true, playlist: updated, message: 'Đã xóa bài hát khỏi playlist' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
};
