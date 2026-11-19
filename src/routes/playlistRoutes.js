const express = require('express');
const { searchTrack, validateAndSanitizeMusicUrl } = require('../utils/musicExtractor');
const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const userPlaylistManager = require('../structures/UserPlaylistManager');

module.exports = function createPlaylistRoutes(client, auth, routeState) {
  const router = express.Router();

  // 1. Lấy thông tin chi tiết Playlist (Khóa theo từng Guild, chống DoS Logic)
  router.get('/guilds/:guildId/playlist-info', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
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
    if (routeState.extractingGuilds.has(guildId)) {
      return res.status(429).json({ success: false, error: 'Máy chủ đang phân tích một danh sách phát khác, vui lòng chờ trong giây lát!' });
    }
    if (routeState.extractingGuilds.size >= 3) {
      return res.status(429).json({ success: false, error: 'Hệ thống đang bận xử lý nhiều danh sách phát cùng lúc, vui lòng thử lại sau ít giây!' });
    }

    routeState.extractingGuilds.add(guildId);
    try {
      let rawResults = await searchTrack(url);
      if (!rawResults || rawResults.length === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát trong danh sách phát này' });
      }

      rawResults = rawResults.slice(0, 100);
      const playlistData = {
        url,
        title: auth.sanitizeDiscordText(rawResults[0]?.playlistTitle || (rawResults.length > 1 ? `Danh sách phát (${rawResults.length} bài)` : (rawResults[0]?.title || 'Playlist')), 200),
        trackCount: rawResults.length,
        thumbnail: auth.sanitizeThumbnailUrl(rawResults[0]?.playlistThumbnail || rawResults[0]?.thumbnail) || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
        addedBy: req.user?.displayName || req.user?.username || 'Web User',
        addedByAvatar: req.user?.avatar || null,
        tracks: rawResults
      };

      playlistHistoryManager.addPlaylist(guildId, playlistData);
      routeState.guildStatsCache.delete(guildId);

      return res.json({
        success: true,
        playlist: playlistData
      });
    } catch (err) {
      console.error('[API Playlist Info Error]:', err);
      return res.status(500).json({ success: false, error: 'Không thể phân tích danh sách phát' });
    } finally {
      routeState.extractingGuilds.delete(guildId);
    }
  });

  // ── USER PLAYLISTS APIS (Quản lý Playlist cá nhân của người dùng) ──
  // 1. Lấy danh sách playlist của người dùng hiện tại
  router.get('/playlists/me', auth.requireAuth, async (req, res) => {
    try {
      const playlists = await userPlaylistManager.getUserPlaylists(req.user.userId);
      res.json({ success: true, playlists });
    } catch (err) {
      console.error('[API Get Playlists Error]:', err);
      res.status(500).json({ success: false, error: 'Không thể nạp danh sách phát của bạn' });
    }
  });

  // 2. Tạo playlist mới
  router.post('/playlists/me', auth.requireAuth, async (req, res) => {
    try {
      const { name, description } = req.body;
      const newPlaylist = await userPlaylistManager.createPlaylist(req.user.userId, { name, description });
      res.json({ success: true, playlist: newPlaylist, message: `Đã tạo playlist "${newPlaylist.name}" thành công` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 3. Cập nhật playlist (đổi tên / sửa mô tả / đổi ảnh bìa)
  router.put('/playlists/me/:playlistId', express.json({ limit: '600kb' }), auth.requireAuth, async (req, res) => {
    try {
      const { playlistId } = req.params;
      const { name, description, thumbnail } = req.body;

      // Sanitize thumbnail: loại bỏ data:image/svg+xml, chỉ cho phép data:image safe base64 (<= 500KB) hoặc https whitelist
      let cleanThumb = undefined;
      if (typeof thumbnail === 'string') {
        const trimmed = thumbnail.trim();
        if (trimmed === '') {
          cleanThumb = null;
        } else if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
          cleanThumb = trimmed.length <= 500000 ? trimmed : null;
        } else if (trimmed.startsWith('https://')) {
          cleanThumb = auth.sanitizeThumbnailUrl(trimmed);
        } else {
          cleanThumb = null;
        }
      } else if (thumbnail === null) {
        cleanThumb = null;
      }

      const updated = await userPlaylistManager.updatePlaylist(req.user.userId, playlistId, { name, description, thumbnail: cleanThumb });
      res.json({ success: true, playlist: updated, message: 'Đã cập nhật playlist thành công' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 4. Xóa playlist
  router.delete('/playlists/me/:playlistId', auth.requireAuth, async (req, res) => {
    try {
      const { playlistId } = req.params;
      await userPlaylistManager.deletePlaylist(req.user.userId, playlistId);
      res.json({ success: true, message: 'Đã xóa playlist thành công' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 5. Thêm bài hát vào playlist
  router.post('/playlists/me/:playlistId/tracks', auth.requireAuth, async (req, res) => {
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
  router.delete('/playlists/me/:playlistId/tracks/:trackIndex', auth.requireAuth, async (req, res) => {
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
