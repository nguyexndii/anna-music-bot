const fs = require('fs');
const path = require('path');
let GuildPlaylist;
try {
  GuildPlaylist = require('../database/models/GuildPlaylist');
} catch (e) {
  GuildPlaylist = null;
}

class PlaylistHistoryManager {
  constructor() {
    this.filePath = path.join(__dirname, '../../data/playlists.json');
    this.cache = new Map();
    this._ensureFile();
    this._loadFromFile();
    this._loadFromMongo();
  }

  _ensureFile() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), 'utf8');
      }
    } catch (e) {
      // ignore
    }
  }

  _loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, list] of Object.entries(data)) {
          if (Array.isArray(list)) {
            this.cache.set(guildId, list);
          }
        }
      }
    } catch (e) {
      console.warn('[PlaylistHistoryManager] Không thể nạp playlists.json cục bộ:', e.message);
    }
  }

  async _loadFromMongo() {
    try {
      if (!GuildPlaylist) return;
      const all = await GuildPlaylist.find({}).sort({ updatedAt: -1 }).lean();
      for (const item of all) {
        const gid = String(item.guildId);
        if (!this.cache.has(gid)) {
          this.cache.set(gid, []);
        }
        const list = this.cache.get(gid);
        if (!list.some(p => p.url === item.url)) {
          list.push({
            url: item.url,
            title: item.title,
            trackCount: item.trackCount,
            thumbnail: item.thumbnail,
            addedBy: item.addedBy,
            addedByAvatar: item.addedByAvatar || null,
            addedAt: item.addedAt ? item.addedAt.toISOString() : new Date().toISOString(),
            tracks: Array.isArray(item.tracks) ? item.tracks : []
          });
        }
      }
      // Trim each guild cache to 100
      for (const [gid, list] of this.cache.entries()) {
        if (list.length > 100) list.length = 100;
      }
    } catch (e) {
      // Mongo might not be connected yet at constructor time, it will load on demand
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

  async addPlaylist(guildId, playlistData) {
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
      addedBy: playlistData.addedBy || 'Người dùng',
      addedByAvatar: playlistData.addedByAvatar || null,
      addedAt: new Date().toISOString(),
      tracks: Array.isArray(playlistData.tracks)
        ? playlistData.tracks.slice(0, 100).map(t => ({
            title: t.title || '',
            url: t.url || '',
            duration: t.duration || '',
            thumbnail: t.thumbnail || null,
            author: t.author || ''
          }))
        : []
    };

    filtered.unshift(entry);

    if (filtered.length > 100) {
      filtered.length = 100;
    }

    this.cache.set(guildId, filtered);
    this._saveToFile();

    // Async lưu vào MongoDB Atlas
    if (GuildPlaylist) {
      try {
        await GuildPlaylist.findOneAndUpdate(
          { guildId: String(guildId), url: entry.url },
          {
            $set: {
              title: entry.title,
              trackCount: entry.trackCount,
              thumbnail: entry.thumbnail,
              addedBy: entry.addedBy,
              addedByAvatar: entry.addedByAvatar,
              addedAt: new Date(),
              tracks: entry.tracks
            }
          },
          { upsert: true, returnDocument: 'after' }
        );

        // Giới hạn 100 playlist gần nhất cho mỗi guild trong Mongo
        const excess = await GuildPlaylist.find({ guildId: String(guildId) })
          .sort({ updatedAt: -1 })
          .skip(100)
          .select('_id')
          .lean();

        if (excess && excess.length > 0) {
          const ids = excess.map(x => x._id);
          await GuildPlaylist.deleteMany({ _id: { $in: ids } });
        }
      } catch (err) {
        console.error('[PlaylistHistoryManager] Lỗi lưu vào MongoDB:', err.message);
      }
    }
  }

  getPlaylists(guildId, limit = 50) {
    // Tự động load ngầm từ Mongo nếu cache đang rỗng
    if ((!this.cache.has(guildId) || this.cache.get(guildId).length === 0) && GuildPlaylist) {
      GuildPlaylist.find({ guildId: String(guildId) })
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean()
        .then(items => {
          if (items && items.length > 0) {
            const formatted = items.map(item => ({
              url: item.url,
              title: item.title,
              trackCount: item.trackCount,
              thumbnail: item.thumbnail,
              addedBy: item.addedBy,
              addedByAvatar: item.addedByAvatar || null,
              addedAt: item.addedAt ? item.addedAt.toISOString() : new Date().toISOString(),
              tracks: Array.isArray(item.tracks) ? item.tracks : []
            }));
            this.cache.set(String(guildId), formatted);
          }
        })
        .catch(() => {});
    }

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
