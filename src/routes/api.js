const express = require('express');
const { verifyWebToken } = require('../utils/tokenHelper');
const { searchMultipleTracks, searchTrack } = require('../utils/musicExtractor');
const { getLyrics } = require('../utils/lyricsHelper');

module.exports = function createApiRouter(client) {
  const router = express.Router();
  router.use(express.json());

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

  // 1. Xác thực Token & Lấy thông tin User
  router.post('/auth/verify', (req, res) => {
    const { token } = req.body;
    const user = verifyWebToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
    }

    const guild = client.guilds.cache.get(user.guildId);
    return res.json({
      success: true,
      user: {
        ...user,
        guildName: guild?.name || user.guildName,
        guildIcon: guild?.iconURL({ dynamic: true }) || null
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

  // 3. Lấy trạng thái phát nhạc của Server (Queue, NowPlaying, Settings)
  router.get('/guilds/:guildId/state', (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({ success: false, error: 'Bot chưa tham gia máy chủ này' });
    }

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;

    let voiceMembers = [];
    if (queue?.voiceChannel) {
      voiceMembers = queue.voiceChannel.members.map(m => ({
        id: m.id,
        name: m.displayName || m.user.username,
        avatar: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
        isBot: m.user.bot
      }));
    }

    return res.json({
      success: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true })
      },
      player: {
        isPlaying: queue?.isPlaying || false,
        isPaused: queue?.isPaused || false,
        volume: queue?.volume || 100,
        loop: queue?.loopMode || 'off',
        mode247: queue?.mode247 || false,
        autoplay: queue?.autoplay !== false,
        current: queue?.currentTrack ? {
          title: queue.currentTrack.title,
          url: queue.currentTrack.url,
          thumbnail: queue.currentTrack.thumbnail,
          duration: queue.currentTrack.duration,
          artist: queue.currentTrack.artist || 'Unknown',
          requestedBy: queue.currentTrack.requestedBy,
          requestedByAvatar: queue.currentTrack.requestedByAvatar,
          isLive: queue.currentTrack.isLive || false,
          is247: queue.currentTrack.is247 || false,
          startTime: queue.currentTrack.startTime || null
        } : null,
        queue: (queue?.queue || []).map((t, idx) => ({
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

    // Tìm kênh voice của User hoặc kênh bot đang đứng
    const member = guild.members.cache.get(user.userId);
    let voiceChannel = member?.voice?.channel;
    let textChannel = guild.channels.cache.find(c => c.isTextBased && c.isTextBased()) || guild.systemChannel;

    let queue = client.musicManager.get(guildId);
    if (queue && queue.voiceChannel) {
      voiceChannel = queue.voiceChannel;
    }

    if (!voiceChannel) {
      return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào 1 kênh Voice trong Discord trước!' });
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
      const isFirst = !queue.currentTrack && queue.queue.length === 0;

      await queue.addTrack(targetTrack);

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

  // 5. Thao tác điều khiển Player (Pause, Resume, Skip, Volume, 24/7...)
  router.post('/guilds/:guildId/action', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const { action, value } = req.body;
    const user = req.user;

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    if (!queue) {
      return res.status(400).json({ success: false, error: 'Hiện không có bài hát nào đang phát trong máy chủ này' });
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
        case 'loop':
          // toggle loop: off -> track -> queue -> off
          const modes = ['off', 'track', 'queue'];
          const currentIdx = modes.indexOf(queue.loopMode || 'off');
          const nextMode = value || modes[(currentIdx + 1) % modes.length];
          queue.loopMode = nextMode;
          resultMessage = `Chế độ lặp lại: ${nextMode.toUpperCase()}`;
          break;
        case 'volume':
          const vol = Math.max(0, Math.min(150, parseInt(value, 10) || 100));
          queue.setVolume(vol);
          resultMessage = `Âm lượng: ${vol}%`;
          break;
        case 'toggle247':
          queue.mode247 = !queue.mode247;
          resultMessage = queue.mode247 ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          break;
        case 'remove':
          const idx = parseInt(value, 10);
          if (!isNaN(idx) && idx >= 0 && idx < queue.queue.length) {
            const removed = queue.queue.splice(idx, 1)[0];
            resultMessage = `Đã xóa "${removed.title}" khỏi hàng chờ`;
          }
          break;
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

    if (!queue || !queue.currentTrack) {
      return res.json({ success: true, lyrics: 'Không có bài hát nào đang phát', synced: false });
    }

    try {
      const lyricsData = await getLyrics(queue.currentTrack.title, queue.currentTrack.artist);
      return res.json({
        success: true,
        title: queue.currentTrack.title,
        artist: queue.currentTrack.artist,
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
