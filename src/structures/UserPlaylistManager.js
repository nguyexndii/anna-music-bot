const fs = require('fs');
const path = require('path');
const UserPlaylist = require('../database/models/UserPlaylist');

class UserPlaylistManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/user_playlists.json');
    this.fallbackData = new Map();
    this.memoryCache = new Map();
    this._ensureFile();
    this._loadFromFile();
  }

  _setMemoryCache(userId, data) {
    if (this.memoryCache.size >= 300) {
      const oldest = this.memoryCache.keys().next().value;
      if (oldest !== undefined) this.memoryCache.delete(oldest);
    }
    Map.prototype.set.call(this.memoryCache, userId, data);
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  _loadFromFile() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      for (const [userId, playlists] of Object.entries(data)) {
        this.fallbackData.set(userId, playlists);
      }
    } catch (e) {
      console.warn('[UserPlaylistManager] Không thể nạp user_playlists.json:', e.message);
    }
  }

  _saveToFile() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      try {
        const dir = path.dirname(this.filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        const obj = {};
        for (const [userId, playlists] of this.fallbackData.entries()) {
          obj[userId] = playlists;
        }
        await fs.promises.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
      } catch (e) {
        console.error('[UserPlaylistManager] Không thể lưu user_playlists.json:', e.message);
      }
    }, 300);
  }

  /**
   * Lấy danh sách playlist của người dùng (RAM cache siêu tốc 0ms)
   */
  async getUserPlaylists(userId) {
    if (!userId) return [];
    if (this.memoryCache.has(userId)) {
      return this.memoryCache.get(userId);
    }
    try {
      const doc = await UserPlaylist.findOne({ userId });
      if (doc && doc.playlists) {
        const list = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
        this._setMemoryCache(userId, list);
        return list;
      }
    } catch (e) {
      // Fallback
    }
    const fallback = this.fallbackData.get(userId) || [];
    this._setMemoryCache(userId, fallback);
    return fallback;
  }

  /**
   * Tạo Playlist mới
   */
  async createPlaylist(userId, { name, description = '' }) {
    if (!userId) throw new Error('Yêu cầu userId');
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Tên playlist không được để trống');
    if (cleanName.length > 80) throw new Error('Tên playlist không được vượt quá 80 ký tự');

    const newPlaylist = {
      id: 'pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
      name: cleanName,
      description: String(description || '').trim().slice(0, 300),
      thumbnail: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      songs: []
    };

    let playlists = [];
    try {
      let doc = await UserPlaylist.findOne({ userId });
      if (!doc) {
        doc = new UserPlaylist({ userId, playlists: [] });
      }
      doc.playlists.unshift(newPlaylist);
      await doc.save();
      playlists = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
    } catch (e) {
      let list = this.fallbackData.get(userId) || [];
      list.unshift(newPlaylist);
      this.fallbackData.set(userId, list);
      this._saveToFile();
      playlists = list;
    }

    this._setMemoryCache(userId, playlists);
    return newPlaylist;
  }

  /**
   * Cập nhật thông tin Playlist (Tên, mô tả)
   */
  async updatePlaylist(userId, playlistId, { name, description }) {
    if (!userId || !playlistId) throw new Error('Thiếu thông tin người dùng hoặc playlistId');
    const cleanName = name ? String(name).trim() : null;
    if (cleanName !== null && !cleanName) throw new Error('Tên playlist không được để trống');

    let updatedPlaylist = null;
    let playlists = [];

    try {
      let doc = await UserPlaylist.findOne({ userId });
      if (!doc) throw new Error('Không tìm thấy playlist');
      const pl = doc.playlists.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      if (cleanName) pl.name = cleanName.slice(0, 80);
      if (typeof description === 'string') pl.description = description.trim().slice(0, 300);
      pl.updatedAt = new Date();

      await doc.save();
      playlists = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
      updatedPlaylist = playlists.find(p => p.id === playlistId);
    } catch (e) {
      let list = this.fallbackData.get(userId) || [];
      const pl = list.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      if (cleanName) pl.name = cleanName.slice(0, 80);
      if (typeof description === 'string') pl.description = description.trim().slice(0, 300);
      pl.updatedAt = new Date();

      this.fallbackData.set(userId, list);
      this._saveToFile();
      playlists = list;
      updatedPlaylist = pl;
    }

    this._setMemoryCache(userId, playlists);
    return updatedPlaylist;
  }

  /**
   * Xóa Playlist
   */
  async deletePlaylist(userId, playlistId) {
    if (!userId || !playlistId) throw new Error('Thiếu thông tin người dùng hoặc playlistId');

    let playlists = [];
    try {
      let doc = await UserPlaylist.findOne({ userId });
      if (doc) {
        doc.playlists = doc.playlists.filter(p => p.id !== playlistId);
        await doc.save();
        playlists = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
      }
    } catch (e) {
      let list = this.fallbackData.get(userId) || [];
      list = list.filter(p => p.id !== playlistId);
      this.fallbackData.set(userId, list);
      this._saveToFile();
      playlists = list;
    }

    this._setMemoryCache(userId, playlists);
    return { success: true, total: playlists.length };
  }

  /**
   * Thêm bài hát vào Playlist
   */
  async addTrackToPlaylist(userId, playlistId, track) {
    if (!userId || !playlistId || !track || !track.title) {
      throw new Error('Dữ liệu bài hát không hợp lệ');
    }

    if (track.is247 || track.requestedBy === 'Auto (24/7)' || track.requestedBy === 'Auto (24/7 Lofi)') {
      throw new Error('Không thể thêm nhạc nền chế độ 24/7 Lofi vào playlist');
    }

    const title = String(track.title).trim();
    const artist = String(track.artist || 'Unknown Artist').trim();
    const url = track.url || (track.uri?.startsWith('http') ? track.uri : null) || (track.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(track.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`);
    const duration = track.duration || '0:00';
    const thumbnail = track.thumbnail || null;

    const newSong = {
      title,
      artist,
      url,
      duration,
      thumbnail,
      addedAt: new Date()
    };

    let targetPlaylist = null;
    let playlists = [];

    try {
      let doc = await UserPlaylist.findOne({ userId });
      if (!doc) throw new Error('Không tìm thấy playlist của người dùng');
      const pl = doc.playlists.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      // Kiểm tra trùng lặp URL
      const exists = pl.songs.some(s => s.url && s.url === url);
      if (exists) {
        throw new Error('Bài hát này đã có trong playlist');
      }

      pl.songs.push(newSong);
      if (!pl.thumbnail && thumbnail) {
        pl.thumbnail = thumbnail;
      }
      pl.updatedAt = new Date();

      await doc.save();
      playlists = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
      targetPlaylist = playlists.find(p => p.id === playlistId);
    } catch (e) {
      if (e.message === 'Bài hát này đã có trong playlist') throw e;

      let list = this.fallbackData.get(userId) || [];
      const pl = list.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      const exists = pl.songs.some(s => s.url && s.url === url);
      if (exists) throw new Error('Bài hát này đã có trong playlist');

      pl.songs.push(newSong);
      if (!pl.thumbnail && thumbnail) {
        pl.thumbnail = thumbnail;
      }
      pl.updatedAt = new Date();

      this.fallbackData.set(userId, list);
      this._saveToFile();
      playlists = list;
      targetPlaylist = pl;
    }

    this._setMemoryCache(userId, playlists);
    return { playlist: targetPlaylist, track: newSong };
  }

  /**
   * Xóa bài hát khỏi Playlist theo index hoặc URL
   */
  async removeTrackFromPlaylist(userId, playlistId, identifier) {
    if (!userId || !playlistId || identifier === undefined) {
      throw new Error('Thiếu tham số xóa bài hát');
    }

    let targetPlaylist = null;
    let playlists = [];

    try {
      let doc = await UserPlaylist.findOne({ userId });
      if (!doc) throw new Error('Không tìm thấy playlist');
      const pl = doc.playlists.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      if (typeof identifier === 'number') {
        if (identifier >= 0 && identifier < pl.songs.length) {
          pl.songs.splice(identifier, 1);
        }
      } else {
        const idStr = String(identifier);
        pl.songs = pl.songs.filter(s => s.url !== idStr && s.title !== idStr);
      }

      // Cập nhật lại thumbnail nếu bài đầu tiên bị xóa
      if (pl.songs.length > 0) {
        pl.thumbnail = pl.songs[0].thumbnail || null;
      } else {
        pl.thumbnail = null;
      }
      pl.updatedAt = new Date();

      await doc.save();
      playlists = doc.playlists.map(p => (typeof p.toObject === 'function' ? p.toObject() : p));
      targetPlaylist = playlists.find(p => p.id === playlistId);
    } catch (e) {
      let list = this.fallbackData.get(userId) || [];
      const pl = list.find(p => p.id === playlistId);
      if (!pl) throw new Error('Playlist không tồn tại');

      if (typeof identifier === 'number') {
        if (identifier >= 0 && identifier < pl.songs.length) {
          pl.songs.splice(identifier, 1);
        }
      } else {
        const idStr = String(identifier);
        pl.songs = pl.songs.filter(s => s.url !== idStr && s.title !== idStr);
      }

      if (pl.songs.length > 0) {
        pl.thumbnail = pl.songs[0].thumbnail || null;
      } else {
        pl.thumbnail = null;
      }
      pl.updatedAt = new Date();

      this.fallbackData.set(userId, list);
      this._saveToFile();
      playlists = list;
      targetPlaylist = pl;
    }

    this._setMemoryCache(userId, playlists);
    return targetPlaylist;
  }
}

module.exports = new UserPlaylistManager();
