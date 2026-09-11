const fs = require('fs');
const path = require('path');
const GuildHistory = require('../database/models/GuildHistory');

const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function getKeywords(str) {
  if (!str) return [];
  const clean = str
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v|remix|bản gốc|full|topic/gi, '')
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\s]/g, ' ')
    .trim();
  return clean.split(/\s+/).filter(w => w.length > 1);
}

class HistoryManager {
  constructor() {
    this.cache = new Map();
    this._loadLocal();
  }

  _loadLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, history] of Object.entries(data)) {
          this.cache.set(guildId, history);
        }
      }
    } catch (e) {
      console.warn('[HistoryManager] Không thể nạp file local:', e.message);
    }
  }

  _saveLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Object.fromEntries(this.cache.entries());
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[HistoryManager] Không thể lưu file local:', e.message);
    }
  }

  async addSong(guildId, song) {
    if (!guildId || !song || !song.title) return;

    // Bỏ qua nhạc 24/7 Lofi nền do bot tự phát (Không lưu vào lịch sử và bảng xếp hạng)
    if (
      song.is247 ||
      song.requestedBy === 'Auto (24/7)' ||
      /lofi hip hop radio|beats to relax|chillhop|lofi radio/i.test(song.title) ||
      /lofi girl/i.test(song.artist || '')
    ) {
      return;
    }

    if (!this.cache.has(guildId)) {
      this.cache.set(guildId, []);
    }

    const list = this.cache.get(guildId);
    let thumbnail = song.thumbnail;
    if (!thumbnail && song.url) {
      const match = song.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
      if (match && match[1]) {
        thumbnail = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
      }
    }

    const item = {
      title: song.title,
      url: song.url || null,
      thumbnail: thumbnail || null,
      artist: song.artist && song.artist !== 'Unknown' 
        ? song.artist 
        : (song.title.includes(' - ') ? song.title.split(' - ')[0].trim() : 'YouTube Music'),
      duration: song.duration || '0:00',
      playedAt: new Date()
    };

    // Kiểm tra không lặp liên tiếp
    if (list.length > 0 && list[0].title === item.title) {
      list[0] = item;
    } else {
      list.unshift(item);
    }

    // Giữ tối đa 50 bài hát gần nhất
    if (list.length > 50) {
      list.length = 50;
    }

    this._saveLocal();

    // Lưu vào MongoDB Atlas ngầm
    try {
      await GuildHistory.findOneAndUpdate(
        { guildId },
        { guildId, history: list, updatedAt: new Date() },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (dbErr) {
      // Bỏ qua lỗi DB nếu offline
    }
  }

  getHistory(guildId) {
    const rawList = this.cache.get(guildId) || [];
    // Lọc bỏ nhạc Lofi 24/7 nếu trước đây từng bị lưu nhầm
    return rawList.filter(item => 
      item && 
      item.title && 
      !/lofi hip hop radio|beats to relax|chillhop|lofi radio/i.test(item.title)
    );
  }

  getRecent(guildId, limit = 10) {
    const list = this.getHistory(guildId);
    return list.slice(0, limit).map(item => {
      let thumb = item.thumbnail;
      if (!thumb && item.url) {
        const match = item.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        if (match && match[1]) {
          thumb = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
        }
      }
      return {
        ...item,
        thumbnail: thumb || null,
        artist: item.artist && item.artist !== 'Unknown'
          ? item.artist
          : (item.title && item.title.includes(' - ') ? item.title.split(' - ')[0].trim() : 'YouTube Music')
      };
    });
  }

  /**
   * Thống kê Top bài hát được nghe nhiều nhất của Server (Loại trừ 100% nhạc Lofi 24/7)
   */
  getTopTracks(guildId, limit = 6) {
    const list = this.getHistory(guildId);
    if (!list || list.length === 0) return [];

    const counts = new Map();
    for (const item of list) {
      if (!item || !item.title) continue;
      // Bỏ qua lofi nền
      if (/lofi hip hop radio|beats to relax|chillhop|lofi radio/i.test(item.title)) continue;

      const key = item.title.toLowerCase().trim();
      if (!counts.has(key)) {
        counts.set(key, { ...item, count: 1 });
      } else {
        counts.get(key).count += 1;
      }
    }

    const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count);
    return sorted.slice(0, limit).map(item => {
      let thumb = item.thumbnail;
      if (!thumb && item.url) {
        const match = item.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        if (match && match[1]) {
          thumb = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
        }
      }
      return {
        ...item,
        thumbnail: thumb || null,
        artist: item.artist && item.artist !== 'Unknown'
          ? item.artist
          : (item.title && item.title.includes(' - ') ? item.title.split(' - ')[0].trim() : 'YouTube Music')
      };
    });
  }

  /**
   * Kiểm tra xem bài hát này có nằm trong 20 bài gần nhất không
   */
  isRecentlyPlayed(guildId, trackOrTitle, limit = 20) {
    if (!guildId || !trackOrTitle) return false;

    const list = this.cache.get(guildId) || [];
    const recent = list.slice(0, limit);

    const checkTitle = typeof trackOrTitle === 'string' ? trackOrTitle : (trackOrTitle.title || '');
    const checkUrl = typeof trackOrTitle === 'object' ? trackOrTitle.url : null;
    const checkTokens = getKeywords(checkTitle);

    for (const item of recent) {
      // 1. Kiểm tra trùng URL
      if (checkUrl && item.url && item.url === checkUrl) {
        return true;
      }

      // 2. Kiểm tra từ khóa tiêu đề bài hát (chống lặp bài tải lên từ nhiều kênh khác nhau)
      const itemTokens = getKeywords(item.title);
      if (checkTokens.length > 0 && itemTokens.length > 0) {
        const matches = checkTokens.filter(t => itemTokens.includes(t));
        const matchRatio = matches.length / Math.min(checkTokens.length, itemTokens.length);
        if (matchRatio >= 0.7) {
          return true;
        }
      }
    }

    return false;
  }
}

module.exports = new HistoryManager();
