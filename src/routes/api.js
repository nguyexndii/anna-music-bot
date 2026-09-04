const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyWebToken, createSessionToken } = require('../utils/tokenHelper');
const { searchMultipleTracks, searchTrack } = require('../utils/musicExtractor');
const { getLyrics } = require('../utils/lyricsHelper');
const settingsManager = require('../structures/SettingsManager');
const favoriteManager = require('../structures/FavoriteManager');
const historyManager = require('../structures/HistoryManager');
const { logAction } = require('../utils/debugLogger');

const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const ytdlp = require('yt-dlp-exec');

module.exports = function createApiRouter(client) {
  const router = express.Router();
  router.use(express.json());

  // Search in-memory cache & In-flight request deduplication
  const searchCache = new Map();
  const inFlightSearches = new Map();
  setInterval(() => {
    if (searchCache.size > 300) searchCache.clear();
  }, 10 * 60 * 1000);

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
      return res.status(401).json({ success: false, error: 'Thiếu Magic Token hoặc phiên đã hết hạn' });
    }
    const user = verifyWebToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    req.user = user;
    next();
  };

  // 1. Xác thực Token & PIN từ Discord
  router.post('/auth/verify', authVerifyLimiter, async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã PIN hoặc Token' });
    }

    const user = verifyWebToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Mã PIN không hợp lệ hoặc đã hết hạn' });
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

    // Kiểm tra thực tế xem User có đang ngồi trong kênh Voice trên Discord hay không
    const isInVoice = Boolean(userVoice);
    const isLocked = Boolean(guildSettings.lockedVoiceChannelId);
    const isSameVoice = isLocked 
      ? Boolean(userVoice && userVoice.id === guildSettings.lockedVoiceChannelId)
      : Boolean(userVoice && (!botVoice || userVoice.id === botVoice.id));

    // Cấp Session Token 2 tiếng (2h)
    const sessionToken = createSessionToken(user, 2);

    return res.json({
      success: true,
      token: sessionToken,
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

  // 2. Live Search YouTube / Spotify (Siêu tốc độ với RAM Cache & Chống chồng lặp)
  router.get('/search', async (req, res) => {
    const query = req.query.q?.trim();
    const limit = parseInt(req.query.limit, 10) || 20;
    const mode = req.query.mode || 'official';

    if (!query || query.length < 2) {
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

  // 3. Trạng thái phòng nhạc (Real-time State)
  router.get('/guilds/:guildId/state', async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
    let caller = null;
    if (token) {
      caller = verifyWebToken(token);
      if (caller) {
        recordActiveUser(guildId, caller);
      }
    }

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const guildSettings = settingsManager.get(guildId);

    const voiceChannel = queue?.voiceChannel || guild.members.me?.voice?.channel;
    const voiceMembers = voiceChannel ? voiceChannel.members.map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ dynamic: true }) || null,
      isBot: m.user.bot,
      isSelf: caller?.userId ? m.id === caller.userId : false
    })) : [];

    const currentTrack = queue?.currentSong;
    const activeWebUsers = getActiveWebUsers(guildId);

    return res.json({
      success: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true }) || null
      },
      settings: guildSettings,
      activeWebUsers,
      player: {
        isPlaying: queue ? queue.isPlaying : false,
        isPaused: queue ? queue.isPaused : false,
        volume: queue ? queue.volume : (guildSettings.defaultVolume || 80),
        loopMode: queue ? queue.loopMode : (guildSettings.loopMode || 'off'),
        mode247: queue ? queue.mode247 : Boolean(guildSettings.mode247),
        autoplay: queue ? (guildSettings.autoplay !== false) : (guildSettings.autoplay !== false),
        lyricsSync: queue ? (guildSettings.lyricsSync !== false) : true,
        enableCinemaMode: guildSettings.enableCinemaMode !== false,
        settings: guildSettings,
        current: currentTrack ? {
          title: currentTrack.title,
          artist: (() => {
            if (currentTrack.artist && currentTrack.artist !== 'Unknown' && !currentTrack.artist.startsWith('[') && !currentTrack.artist.includes('Topic')) {
              return currentTrack.artist;
            }
            const clean = (currentTrack.title || '').replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
            const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
            if (segs.length >= 2) {
              return segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim() || segs[0];
            }
            return currentTrack.artist || 'YouTube Music';
          })(),
          url: currentTrack.url,
          thumbnail: currentTrack.thumbnail,
          duration: currentTrack.duration,
          durationMs: currentTrack.durationMs || 0,
          playbackDurationMs: (queue?.currentResource && typeof queue.currentResource.playbackDuration === 'number')
            ? queue.currentResource.playbackDuration
            : (currentTrack.startTime ? Math.max(0, Date.now() - currentTrack.startTime) : 0),
          serverTime: Date.now(),
          is247: currentTrack.is247 || currentTrack.requestedBy === 'Auto (24/7)',
          isLive: currentTrack.isLive || currentTrack.duration === 'LIVE',
          requestedBy: currentTrack.requestedBy === 'Auto' || currentTrack.requestedBy === 'DJ AI (Gợi ý)' || currentTrack.requestedBy === 'Auto (24/7)'
            ? 'Tự động phát 🎵'
            : (currentTrack.requestedBy ? `${currentTrack.requestedBy}` : 'Tự động'),
          requestedByAvatar: currentTrack.requestedByAvatar || null,
          startTime: currentTrack.startTime || null
        } : null,
        queue: (queue?.songs || []).map((t, idx) => ({
          index: idx,
          title: t.title,
          artist: (() => {
            if (t.artist && t.artist !== 'Unknown' && !t.artist.startsWith('[') && !t.artist.includes('Topic')) {
              return t.artist;
            }
            const clean = (t.title || '').replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
            const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
            if (segs.length >= 2) {
              return segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim() || segs[0];
            }
            return t.artist || 'YouTube Music';
          })(),
          url: t.url,
          thumbnail: t.thumbnail,
          duration: t.duration,
          requestedBy: t.requestedBy === 'Auto' || t.requestedBy === 'DJ AI (Gợi ý)' || t.requestedBy === 'Auto (24/7)'
            ? 'Tự động phát 🎵'
            : (t.requestedBy ? `${t.requestedBy}` : 'Tự động'),
          requestedByAvatar: t.requestedByAvatar || null
        })),
        voiceChannel: voiceChannel ? {
          id: voiceChannel.id,
          name: voiceChannel.name,
          memberCount: voiceMembers.length,
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
        history: (historyManager.getRecent ? historyManager.getRecent(guildId, 30) : (historyManager.getHistory(guildId) || []).slice(0, 30)) || [],
        topTracks: (historyManager.getTopTracks ? historyManager.getTopTracks(guildId, 8) : []) || [],
        recentPlaylists: (playlistHistoryManager.getPlaylists ? playlistHistoryManager.getPlaylists(guildId, 6) : []) || [],
        favorites: caller?.userId ? ((await favoriteManager.getFavorites(caller.userId)) || []) : []
      }
    });
  });

  // 4. Order / Thêm bài hát hoặc Playlist từ Web
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

    // Kiểm tra User có thực sự đang ở trong kênh Voice trên Discord hay không
    const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi thêm bài hát!' });
    }

    // Nếu Bot ĐÃ Ở TRONG một kênh Voice (ví dụ phòng treo Lofi 24/7):
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
      // Nếu không khóa: sử dụng kênh Voice mà User đang ngồi
      voiceChannel = userVoice;
    }

    try {
      let rawResults = null;
      let requestedUrl = query || track?.url;

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
      const isFirst = !queue.currentSong && queue.songs.length === 0;
      const isPlaylist = Array.isArray(rawResults) && rawResults.length > 1;

      // XỬ LÝ NẠP TOÀN BỘ PLAYLIST
      if (isPlaylist) {
        for (const t of rawResults) {
          t.requestedBy = `${user.displayName || user.username} 🌐`;
          t.requestedByAvatar = user.avatar;
          t.requestedById = user.userId;
        }

        await queue.addSongs(rawResults, `${user.displayName || user.username} 🌐`);

        // Lưu vào PlaylistHistoryManager
        playlistHistoryManager.addPlaylist(guildId, {
          url: requestedUrl,
          title: `Danh sách phát (${rawResults.length} bài)`,
          trackCount: rawResults.length,
          thumbnail: rawResults[0]?.thumbnail || null,
          addedBy: user.displayName || user.username,
          tracks: rawResults
        });

        // Gửi thông báo Discord
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
                name: `${user.displayName || user.username} vừa thêm Playlist từ Web 📂`,
                iconURL: user.avatar || undefined
              })
              .setDescription(`📥 Đã thêm toàn bộ **${rawResults.length} bài hát** từ Playlist vào hàng chờ!`)
              .setThumbnail(rawResults[0]?.thumbnail || null)
              .setFooter({ text: 'Anna Music Web Player' });
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
      targetTrack.requestedBy = `${user.displayName || user.username} 🌐`;
      targetTrack.requestedByAvatar = user.avatar;
      targetTrack.requestedById = user.userId;

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

  // 4.1 Lấy thông tin chi tiết Playlist (cho phép xem trước và thêm từng bài lẻ)
  let isExtractingPlaylist = false;
  router.get('/guilds/:guildId/playlist-info', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const url = req.query.url?.trim();
    if (!url) {
      return res.status(400).json({ success: false, error: 'Thiếu đường dẫn playlist' });
    }

    // 1. Kiểm tra cache trong PlaylistHistoryManager
    const cached = playlistHistoryManager.getPlaylistByUrl(guildId, url);
    if (cached && Array.isArray(cached.tracks) && cached.tracks.length > 0) {
      return res.json({
        success: true,
        playlist: cached
      });
    }

    // 2. Khóa an toàn: Tránh chạy đồng thời nhiều tác vụ nặng
    if (isExtractingPlaylist) {
      return res.status(429).json({ success: false, error: 'Hệ thống đang phân tích một danh sách phát khác, vui lòng chờ trong giây lát!' });
    }

    isExtractingPlaylist = true;
    try {
      const rawResults = await searchTrack(url);
      if (!rawResults || rawResults.length === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát trong danh sách phát này' });
      }

      const playlistData = {
        url,
        title: rawResults.length > 1 ? `Danh sách phát (${rawResults.length} bài)` : (rawResults[0]?.title || 'Playlist'),
        trackCount: rawResults.length,
        thumbnail: rawResults[0]?.thumbnail || null,
        addedBy: req.user?.displayName || req.user?.username || 'Web User',
        tracks: rawResults
      };

      playlistHistoryManager.addPlaylist(guildId, playlistData);

      return res.json({
        success: true,
        playlist: playlistData
      });
    } catch (err) {
      console.error('[API Playlist Info Error]:', err);
      return res.status(500).json({ success: false, error: 'Không thể phân tích danh sách phát' });
    } finally {
      isExtractingPlaylist = false;
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
      const guild = client.guilds.cache.get(guildId);
      const member = guild?.members?.cache.get(user.userId) || await guild?.members?.fetch(user.userId).catch(() => null);
      const userVoice = member?.voice?.channel;
      const isAdmin = await checkIsAdmin(guildId, user.userId);
      const botVoice = queue?.voiceChannel || guild?.members?.me?.voice?.channel;

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
        case 'previous': {
          const ok = await queue.playPrevious();
          resultMessage = ok ? 'Đã quay lại bài hát trước đó ⏮️' : 'Không có bài hát trước đó để quay lại';
          break;
        }
        case 'playNow': {
          const ok = await queue.playNow(value);
          resultMessage = ok ? 'Đã phát ngay bài hát được chọn ▶️' : 'Không thể phát bài hát này';
          break;
        }
        case 'move': {
          const { from, to } = value || {};
          const ok = queue.moveTrack(from, to);
          resultMessage = ok ? 'Đã thay đổi thứ tự hàng chờ' : 'Không thể di chuyển bài hát';
          break;
        }
        case 'toggleFavorite': {
          const trackToFav = value || queue?.currentSong;
          if (trackToFav && trackToFav.title) {
            const favRes = await favoriteManager.toggleFavorite(user.userId, trackToFav);
            resultMessage = favRes.isAdded ? `Đã thêm "${trackToFav.title}" vào Yêu thích ❤️` : `Đã xóa "${trackToFav.title}" khỏi Yêu thích`;
          } else {
            resultMessage = 'Không có bài hát để yêu thích';
          }
          break;
        }
        case 'clear':
          if (queue) {
            queue.songs = [];
            queue.preloadedResource = null;
            queue.preloadedSongUrl = null;
            queue.prefetchedSong = null;
            if (queue.loopMode === 'song' || queue.loopMode === 'queue') {
              queue.loopMode = 'off';
            }
          }
          resultMessage = 'Đã xóa toàn bộ bài hát trong hàng chờ';
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
        case 'toggleAutoplay': {
          const current = settingsManager.get(guildId);
          const newVal = !current.autoplay;
          settingsManager.update(guildId, { autoplay: newVal });
          resultMessage = newVal ? 'Đã BẬT Tự Động Phát Bài Tương Tự (Autoplay)' : 'Đã TẮT Tự Động Phát';
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
            resultMessage = 'Đã lưu cài đặt máy chủ thành công!';
          }
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

  // 6. Lấy Cài đặt & Danh sách Kênh của Máy chủ
  router.get('/guilds/:guildId/settings', requireAuth, async (req, res) => {
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
  router.post('/guilds/:guildId/settings', requireAuth, async (req, res) => {
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
  router.get('/guilds/:guildId/lyrics', async (req, res) => {
    const { guildId } = req.params;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const currentTrack = queue?.currentSong || queue?.currentTrack;

    if (!queue || !currentTrack) {
      return res.json({ success: true, lyrics: 'Không có bài hát nào đang phát', synced: false });
    }

    try {
      const lyricsData = await getLyrics(currentTrack.title, currentTrack.artist, currentTrack.durationMs || 0);
      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || currentTrack.title,
        artist: lyricsData?.artist || currentTrack.artist,
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: lyricsData?.autoOffsetMs || 0,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: lyricsData?.syncedLyrics || null,
        synced: !!lyricsData?.syncedLyrics
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  router.get('/lyrics', async (req, res) => {
    const title = req.query.title || req.query.q;
    const artist = req.query.artist || '';
    const durationMs = parseInt(req.query.duration, 10) || 0;
    if (!title) {
      return res.json({ success: false, error: 'Thiếu tham số title' });
    }
    try {
      const lyricsData = await getLyrics(title, artist, durationMs);
      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || title,
        artist: lyricsData?.artist || artist,
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: lyricsData?.autoOffsetMs || 0,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: lyricsData?.syncedLyrics || null,
        synced: !!lyricsData?.syncedLyrics
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  // 6.1 Kiểm tra trạng thái hoạt động của 3 tầng Lyric (Diagnostics / Health Check)
  router.get('/lyrics/status', async (req, res) => {
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

    // 3. Kiểm tra Tầng 3: Gemini AI Engine (Lời Đọc Toàn Diện)
    const { getApiKeys } = require('../utils/geminiHelper');
    const geminiKeys = getApiKeys();
    let tier3 = {
      tier: 3,
      name: 'Gemini AI Engine (Plain Lyrics Fallback)',
      sources: 'Google Gemini 2.5 Flash / Knowledge Base',
      speed: 'Thông minh (800ms - 1.5s)',
      status: geminiKeys.length > 0 ? `ONLINE (${geminiKeys.length} API Keys sẵn sàng)` : 'OFFLINE (Chưa cấu hình GEMINI_API_KEY)',
      configured: geminiKeys.length > 0
    };

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      architecture: 'Mô hình Failover Tự Động 3 Tầng: Tầng 1 (LRCLIB Siêu Tốc) -> Tầng 2 (Python Microservice Đa Nguồn) -> Tầng 3 (Gemini AI Lời Đọc Toàn Diện)',
      providers: [tier1, tier2, tier3],
      summary: {
        tier1Online: tier1.status.startsWith('ONLINE'),
        tier2Online: tier2.status.startsWith('ONLINE'),
        tier3Online: tier3.status.startsWith('ONLINE'),
        message: 'Hệ thống lời bài hát 3 tầng đang hoạt động sẵn sàng (hỗ trợ cả karaoke đồng bộ và lyric đọc toàn diện)!'
      }
    });
  });


  return router;
};
