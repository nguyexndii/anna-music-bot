const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyWebToken } = require('../utils/tokenHelper');
const { searchMultipleTracks, searchTrack } = require('../utils/musicExtractor');
const { getLyrics } = require('../utils/lyricsHelper');
const settingsManager = require('../structures/SettingsManager');
const { logAction } = require('../utils/debugLogger');

module.exports = function createApiRouter(client) {
  const router = express.Router();
  router.use(express.json());

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

  // Helper kiểm tra quyền Admin của User trong máy chủ
  async function checkIsAdmin(guildId, userId) {
    if (!guildId || !userId) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    if (guild.ownerId === userId) return true;
    try {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      return Boolean(member.permissions.has('Administrator') || member.permissions.has('ManageGuild'));
    } catch (e) {
      return false;
    }
  }

  // Middleware xác thực Magic Token
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token || req.body.token;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Thiếu Token xác thực' });
    }
    const user = verifyWebToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    req.user = user;
    next();
  };

  // 1. Xác thực Token & Lấy thông tin User (Áp dụng rate-limit & tôn trọng lockedVoiceChannelId)
  router.post('/auth/verify', authVerifyLimiter, async (req, res) => {
    const { token } = req.body;
    const user = verifyWebToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Mã PIN hoặc phiên đăng nhập không hợp lệ. Gõ lại .web trong Discord để lấy mã mới.' });
    }

    const guild = client.guilds.cache.get(user.guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Bot không tìm thấy máy chủ Discord này.' });
    }

    const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const userVoice = member?.voice?.channel;
    const queue = client.musicManager ? client.musicManager.get(user.guildId) : null;
    const botVoice = queue?.voiceChannel || guild.members.me?.voice?.channel;
    const guildSettings = settingsManager.get(user.guildId);
    const isAdmin = await checkIsAdmin(user.guildId, user.userId);

    // Nếu máy chủ đã khóa kênh Voice cố định: người có PIN hợp lệ được coi là đủ điều kiện vào web
    const isLocked = Boolean(guildSettings.lockedVoiceChannelId);
    const isInVoice = isLocked ? true : Boolean(userVoice);
    const isSameVoice = isLocked ? (userVoice ? userVoice.id === guildSettings.lockedVoiceChannelId : true) : Boolean(userVoice && (!botVoice || userVoice.id === botVoice.id));

    return res.json({
      success: true,
      user: {
        ...user,
        isAdmin,
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

  // 2. Live Search YouTube / Spotify
  router.get('/search', async (req, res) => {
    const query = req.query.q;
    const limit = parseInt(req.query.limit, 10) || 6;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.json({ success: true, results: [] });
    }

    try {
      const results = await searchMultipleTracks(query, limit);
      return res.json({ success: true, results });
    } catch (err) {
      console.error('[API Search Error]:', err);
      return res.status(500).json({ success: false, error: 'Lỗi tìm kiếm bài hát' });
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
    if (now - u.lastSeen < 25000) {
      active.push(u);
    } else {
      guildUsers.delete(uid);
    }
  }
  return active;
}

  // 3. Lấy trạng thái phát nhạc của Server (Queue, NowPlaying, Settings)
  router.get('/guilds/:guildId/state', (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ success: false, error: 'Bot chưa tham gia máy chủ này' });
    }

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
    if (token) {
      const caller = verifyWebToken(token);
      if (caller) recordActiveUser(guildId, caller);
    }

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const guildSettings = settingsManager.get(guildId);

    let voiceMembers = [];
    if (queue?.voiceChannel) {
      voiceMembers = queue.voiceChannel.members.map(m => ({
        id: m.id,
        name: m.displayName || m.user.username,
        avatar: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
        isBot: m.user.bot
      }));
    }

    const currentTrack = queue?.currentSong || queue?.currentTrack;
    const queueList = queue?.songs || queue?.queue || [];

    return res.json({
      success: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true })
      },
      activeWebUsers: getActiveWebUsers(guildId),
      player: {
        isPlaying: queue?.isPlaying || false,
        isPaused: queue?.isPaused || false,
        volume: queue?.volume || guildSettings.defaultVolume || 80,
        loop: queue?.loopMode || guildSettings.loopMode || 'off',
        mode247: queue?.mode247 ?? Boolean(guildSettings.mode247),
        autoplay: guildSettings.autoplay !== false,
        current: currentTrack ? {
          title: currentTrack.title,
          url: currentTrack.url,
          thumbnail: currentTrack.thumbnail,
          duration: currentTrack.duration,
          artist: currentTrack.artist || 'Unknown',
          requestedBy: currentTrack.requestedBy,
          requestedByAvatar: currentTrack.requestedByAvatar,
          isLive: currentTrack.isLive || false,
          is247: currentTrack.is247 || false,
          startTime: currentTrack.startTime || null
        } : null,
        queue: queueList.map((t, idx) => ({
          index: idx,
          title: t.title,
          url: t.url,
          thumbnail: t.thumbnail,
          duration: t.duration,
          artist: t.artist || 'Unknown',
          requestedBy: t.requestedBy,
          requestedByAvatar: t.requestedByAvatar
        })),
        voiceChannel: queue?.voiceChannel ? {
          id: queue.voiceChannel.id,
          name: queue.voiceChannel.name,
          memberCount: voiceMembers.length,
          members: voiceMembers
        } : null
      }
    });
  });

  // 4. Order / Thêm bài hát từ Web
  router.post('/guilds/:guildId/play', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const { query, track } = req.body;
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

    // Nếu máy chủ đã khóa kênh Voice cố định (lockedVoiceChannelId)
    if (guildSettings.lockedVoiceChannelId) {
      const targetChannel = guild.channels.cache.get(guildSettings.lockedVoiceChannelId) || await guild.channels.fetch(guildSettings.lockedVoiceChannelId).catch(() => null);
      if (!targetChannel || !targetChannel.isVoiceBased || !targetChannel.isVoiceBased()) {
        return res.status(400).json({
          success: false,
          error: 'Kênh voice đã khóa không còn tồn tại, vui lòng dùng .lockvoice để đặt lại.'
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
      // Nếu không khóa: lấy kênh voice của User hoặc kênh bot đang đứng
      const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
      voiceChannel = member?.voice?.channel;

      if (existingQueue && existingQueue.voiceChannel) {
        voiceChannel = existingQueue.voiceChannel;
      }

      if (!voiceChannel) {
        return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào 1 kênh Voice trong Discord trước!' });
      }
    }

    try {
      let targetTrack = null;
      if (track && track.url && track.title) {
        targetTrack = track;
      } else if (query) {
        const searchResults = await searchTrack(query);
        if (searchResults && searchResults.length > 0) {
          targetTrack = searchResults[0];
        }
      }

      if (!targetTrack) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát yêu cầu' });
      }

      // Ghi nhận đầy đủ danh tính và Avatar người gọi bài qua Web
      targetTrack.requestedBy = `${user.displayName || user.username} 🌐`;
      targetTrack.requestedByAvatar = user.avatar;
      targetTrack.requestedById = user.userId;

      queue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
      const isFirst = !queue.currentSong && queue.songs.length === 0;

      await queue.addTrack(targetTrack);

      // Gửi thông báo vào kênh nhạc đã cấu hình
      try {
        const musicChannelId = guildSettings.musicChannelId;
        const notifyChannel = musicChannelId
          ? guild.channels.cache.get(musicChannelId)
          : (queue.textChannel || guild.systemChannel);

        if (notifyChannel?.isTextBased?.()) {
          const { EmbedBuilder } = require('discord.js');
          const notifEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({
              name: `${user.displayName || user.username} vừa chọn bài từ Web Player 🎧`,
              iconURL: user.avatar || undefined
            })
            .setDescription(
              isFirst
                ? `▶️ Đang phát: **[${targetTrack.title}](${targetTrack.url})**`
                : `📥 Đã thêm vào hàng chờ: **[${targetTrack.title}](${targetTrack.url})**`
            )
            .setThumbnail(targetTrack.thumbnail || null)
            .setFooter({ text: 'Anna Music Web Player' });
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
    }
  });

  // 5. Thao tác điều khiển Player (Pause, Resume, Skip, Seek, Volume, 24/7...)
  router.post('/guilds/:guildId/action', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const { action, value } = req.body;
    const user = req.user;

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    if (!queue && action !== 'toggle247' && action !== 'toggleAutoplay') {
      return res.status(400).json({ success: false, error: 'Hiện không có bài hát nào đang phát trong máy chủ này' });
    }

    // 🔒 KIỂM TRA PHÂN QUYỀN ADMIN CHO CÁC THAO TÁC CÀI ĐẶT SERVER
    const serverSettingActions = ['toggle247', 'set247', 'toggleAutoplay', 'setAutoplay', 'settings', 'updateSettings'];
    if (serverSettingActions.includes(action)) {
      const isAdmin = await checkIsAdmin(guildId, user.userId);
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên (Admin / Quản lý máy chủ) mới có quyền thay đổi Cài đặt Máy chủ!'
        });
      }
    }

    try {
      let resultMessage = '';
      switch (action) {
        case 'pause':
          queue.pause();
          resultMessage = 'Đã tạm dừng bài hát';
          break;
        case 'resume':
          queue.resume();
          resultMessage = 'Đã tiếp tục phát nhạc';
          break;
        case 'seek': {
          const seekSec = Math.max(0, Math.floor(Number(value) || 0));
          await queue.seek(seekSec);
          const mins = Math.floor(seekSec / 60);
          const secs = seekSec % 60;
          const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          resultMessage = `Đã tua đến ${formatted}`;
          break;
        }
        case 'skip':
          queue.skip();
          resultMessage = `Đã chuyển bài hát tiếp theo bởi @${user.displayName || user.username}`;
          break;
        case 'stop':
          queue.stop();
          resultMessage = 'Đã dừng phát và xóa toàn bộ hàng chờ';
          break;
        case 'shuffle':
          queue.shuffle();
          resultMessage = 'Đã xáo trộn hàng chờ';
          break;
        case 'loop': {
          // toggle loop: off -> song -> queue -> off
          const modes = ['off', 'song', 'queue'];
          const currentIdx = modes.indexOf(queue.loopMode || 'off');
          const nextMode = value || modes[(currentIdx + 1) % modes.length];
          queue.setLoop(nextMode);
          resultMessage = `Chế độ lặp lại: ${nextMode.toUpperCase()}`;
          break;
        }
        case 'volume': {
          const vol = Math.max(0, Math.min(150, parseInt(value, 10) || 100));
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
        case 'toggleAutoplay': {
          const current = settingsManager.get(guildId);
          const newVal = !current.autoplay;
          settingsManager.update(guildId, { autoplay: newVal });
          resultMessage = newVal ? 'Đã BẬT DJ AI Tự Động Gợi Ý (Autoplay)' : 'Đã TẮT DJ AI Autoplay';
          break;
        }
        case 'remove':
        case 'removeBatch': {
          if (Array.isArray(value)) {
            const sortedIndices = value
              .map(Number)
              .filter(n => !isNaN(n) && n >= 0 && n < queue.songs.length)
              .sort((a, b) => b - a);
            for (const idx of sortedIndices) {
              queue.songs.splice(idx, 1);
            }
            resultMessage = `Đã xóa ${sortedIndices.length} bài hát khỏi hàng chờ`;
          } else {
            const idx = parseInt(value, 10);
            if (!isNaN(idx) && idx >= 0 && idx < queue.songs.length) {
              const removed = queue.songs.splice(idx, 1)[0];
              resultMessage = `Đã xóa "${removed.title}" khỏi hàng chờ`;
            }
          }
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

  // 6. Lấy Lời bài hát (Karaoke Lyrics)
  router.get('/guilds/:guildId/lyrics', async (req, res) => {
    const { guildId } = req.params;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const currentTrack = queue?.currentSong || queue?.currentTrack;

    if (!queue || !currentTrack) {
      return res.json({ success: true, lyrics: 'Không có bài hát nào đang phát', synced: false });
    }

    try {
      const lyricsData = await getLyrics(currentTrack.title, currentTrack.artist);
      return res.json({
        success: true,
        title: currentTrack.title,
        artist: currentTrack.artist,
        lyrics: lyricsData?.lyrics || 'Chưa tìm thấy lời cho bài hát này',
        syncedLyrics: lyricsData?.syncedLyrics || null,
        synced: !!lyricsData?.syncedLyrics
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  return router;
};
