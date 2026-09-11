const fs = require('fs');
const path = require('path');
const FavoriteSong = require('../database/models/FavoriteSong');

class FavoriteManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/favorites.json');
    this.fallbackData = new Map();
    this.memoryCache = new Map();
    this._ensureFile();
    this._loadFromFile();
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
      for (const [userId, songs] of Object.entries(data)) {
        this.fallbackData.set(userId, songs);
      }
    } catch (e) {
      console.warn('[FavoriteManager] Không thể nạp favorites.json:', e.message);
    }
  }

  _saveToFile() {
    try {
      const obj = {};
      for (const [userId, songs] of this.fallbackData.entries()) {
        obj[userId] = songs;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[FavoriteManager] Không thể lưu favorites.json:', e.message);
    }
  }

  /**
   * Lấy danh sách bài hát yêu thích của người dùng (Có RAM Cache siêu tốc)
   */
  async getFavorites(userId) {
    if (!userId) return [];
    if (this.memoryCache.has(userId)) {
      return this.memoryCache.get(userId);
    }
    try {
      const doc = await FavoriteSong.findOne({ userId });
      if (doc && doc.songs) {
        this.memoryCache.set(userId, doc.songs);
        return doc.songs;
      }
    } catch (e) {
      // Fallback
    }
    const fallback = this.fallbackData.get(userId) || [];
    this.memoryCache.set(userId, fallback);
    return fallback;
  }

  /**
   * Thêm hoặc xóa bài hát yêu thích (Toggle)
   * Trả về { isAdded: boolean, song: Object, total: number }
   */
  async toggleFavorite(userId, song) {
    if (!song || !song.title) {
      throw new Error('Dữ liệu bài hát không hợp lệ');
    }

    const title = String(song.title).trim();
    const url = song.url || (song.uri?.startsWith('http') ? song.uri : null) || (song.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(song.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`);
    const duration = song.duration || '0:00';
    const thumbnail = song.thumbnail || null;

    let isAdded = false;
    let songs = [];

    try {
      let doc = await FavoriteSong.findOne({ userId });
      if (!doc) {
        doc = new FavoriteSong({ userId, songs: [] });
      }

      const existingIndex = doc.songs.findIndex(s =>
        (s.url && url && s.url === url) ||
        (s.title && title && s.title.toLowerCase() === title.toLowerCase())
      );
      if (existingIndex !== -1) {
        doc.songs.splice(existingIndex, 1);
        isAdded = false;
      } else {
        doc.songs.push({
          title: title,
          url: url,
          duration: duration,
          thumbnail: thumbnail,
          addedAt: new Date()
        });
        isAdded = true;
      }

      await doc.save();
      songs = doc.songs;
    } catch (e) {
      // JSON Fallback
      let list = this.fallbackData.get(userId) || [];
      const idx = list.findIndex(s =>
        (s.url && url && s.url === url) ||
        (s.title && title && s.title.toLowerCase() === title.toLowerCase())
      );
      if (idx !== -1) {
        list.splice(idx, 1);
        isAdded = false;
      } else {
        list.push({
          title: title,
          url: url,
          duration: duration,
          thumbnail: thumbnail,
          addedAt: new Date()
        });
        isAdded = true;
      }
      this.fallbackData.set(userId, list);
      this._saveToFile();
      songs = list;
    }

    this.memoryCache.set(userId, songs);
    return { isAdded, song: { ...song, url, title }, total: songs.length };
  }

  /**
   * Xóa một bài hát theo index hoặc URL
   */
  async removeFavorite(userId, indexOrUrl) {
    let removedSong = null;
    let songs = [];

    try {
      const doc = await FavoriteSong.findOne({ userId });
      if (doc && doc.songs.length > 0) {
        if (typeof indexOrUrl === 'number' && indexOrUrl >= 0 && indexOrUrl < doc.songs.length) {
          removedSong = doc.songs.splice(indexOrUrl, 1)[0];
        } else {
          const idx = doc.songs.findIndex(s => s.url === indexOrUrl);
          if (idx !== -1) removedSong = doc.songs.splice(idx, 1)[0];
        }
        await doc.save();
        songs = doc.songs;
      }
    } catch (e) {
      const list = this.fallbackData.get(userId) || [];
      if (typeof indexOrUrl === 'number' && indexOrUrl >= 0 && indexOrUrl < list.length) {
        removedSong = list.splice(indexOrUrl, 1)[0];
      } else {
        const idx = list.findIndex(s => s.url === indexOrUrl);
        if (idx !== -1) removedSong = list.splice(idx, 1)[0];
      }
      this.fallbackData.set(userId, list);
      this._saveToFile();
      songs = list;
    }

    this.memoryCache.set(userId, songs);
    return { removedSong, total: songs.length };
  }

  /**
   * Xóa sạch danh sách yêu thích của người dùng
   */
  async clearFavorites(userId) {
    try {
      await FavoriteSong.deleteOne({ userId });
    } catch (e) {
      // Fallback
    }
    this.fallbackData.delete(userId);
    this.memoryCache.delete(userId);
    this._saveToFile();
    return true;
  }
}

module.exports = new FavoriteManager();
