const fs = require('fs');
const path = require('path');

class PlaylistHistoryManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/playlists.json');
    this.cache = new Map();
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
      for (const [guildId, list] of Object.entries(data)) {
        this.cache.set(guildId, list);
      }
    } catch (e) {
      console.warn('[PlaylistHistoryManager] Không thể nạp playlists.json:', e.message);
    }
  }

  _saveToFile() {
    try {
      const obj = {};
      for (const [guildId, list] of this.cache.entries()) {
        obj[guildId] = list;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[PlaylistHistoryManager] Không thể lưu playlists.json:', e.message);
    }
  }

  addPlaylist(guildId, playlistData) {
    if (!guildId || !playlistData || !playlistData.url) return;

    if (!this.cache.has(guildId)) {
      this.cache.set(guildId, []);
    }

    const list = this.cache.get(guildId);
    const filtered = list.filter(p => p.url !== playlistData.url);

    const entry = {
      url: playlistData.url,
      title: playlistData.title || `Playlist (${playlistData.trackCount || 0} bài)`,
      trackCount: playlistData.trackCount || (playlistData.tracks ? playlistData.tracks.length : 0),
      thumbnail: playlistData.thumbnail || null,
      addedBy: playlistData.addedBy || 'Web User',
      addedAt: new Date().toISOString(),
      tracks: Array.isArray(playlistData.tracks) ? playlistData.tracks.slice(0, 100) : []
    };

    filtered.unshift(entry);

    if (filtered.length > 20) {
      filtered.length = 20;
    }

    this.cache.set(guildId, filtered);
    this._saveToFile();
  }

  getPlaylists(guildId, limit = 8) {
    const list = this.cache.get(guildId) || [];
    return list.slice(0, limit);
  }

  getPlaylistByUrl(guildId, url) {
    if (!guildId || !url) return null;
    const list = this.cache.get(guildId) || [];
    return list.find(p => p.url === url) || null;
  }
}

module.exports = new PlaylistHistoryManager();
