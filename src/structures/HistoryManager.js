const fs = require('fs');
const path = require('path');
const GuildHistory = require('../database/models/GuildHistory');

const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const INVISIBLE_REGEX = /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g;

function cleanInvisibleChars(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(INVISIBLE_REGEX, '').trim();
}

function getKeywords(str) {
  if (!str) return [];
  const clean = cleanInvisibleChars(str)
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v|remix|bản gốc|full|topic/gi, '')
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9\s]/g, ' ')
    .trim();
  return clean.split(/\s+/).filter(w => w.length > 1);
}

function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/v\/)([\w-]{11})/);
  return match ? match[1] : null;
}

/**
 * Tạo khóa định danh chuẩn xác cho bài hát (YouTube Video ID hoặc Normalized Title)
 */
function getTrackKey(song) {
  if (!song) return '';
  const url = typeof song === 'object' ? song.url : (typeof song === 'string' && song.startsWith('http') ? song : '');
  const vid = extractVideoId(url);
  if (vid) {
    return `yt_${vid}`;
  }

  const rawTitle = typeof song === 'object' ? (song.title || song.name || '') : song;
  const clean = cleanInvisibleChars(rawTitle)
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v|remix|bản gốc|full|topic/gi, '')
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '')
    .trim();

  return `title_${clean || 'unknown'}`;
}

/**
 * Kiểm tra xem bài hát có phải nhạc Lofi 24/7 nền hay không
 */
function isLofiTrack(song) {
  if (!song) return false;
  if (song.is247 || song.requestedBy === 'Auto (24/7)') return true;
  if (typeof song.requestedBy === 'string' && song.requestedBy.includes('24/7')) return true;
  const title = (song.title || '').toLowerCase();
  return /lofi hip hop radio|beats to relax|chillhop|lofi radio|lofi girl/i.test(title);
}

class HistoryManager {
  constructor() {
    this.cache = new Map();
    this._mongoTimers = new Map();
    this._loadLocal();
  }

  /**
   * Tự động tổng hợp bảng trackStats từ mảng history cũ
   */
  _migrateStatsFromHistory(historyList) {
    if (!Array.isArray(historyList) || historyList.length === 0) return [];
    const statsMap = new Map();

    for (const item of historyList) {
      if (!item || !item.title || isLofiTrack(item)) continue;
      const key = getTrackKey(item);
      if (!key) continue;

      const playedAt = item.playedAt ? new Date(item.playedAt) : new Date();
      if (statsMap.has(key)) {
        const entry = statsMap.get(key);
        entry.playCount = (entry.playCount || 1) + 1;
        if (!entry.thumbnail && item.thumbnail) entry.thumbnail = item.thumbnail;
        if (playedAt > entry.lastPlayedAt) entry.lastPlayedAt = playedAt;
        if (playedAt < entry.firstPlayedAt) entry.firstPlayedAt = playedAt;
      } else {
        statsMap.set(key, {
          trackKey: key,
          title: cleanInvisibleChars(item.title) || 'Bài hát không tên',
          url: item.url || '',
          artist: item.artist && item.artist !== 'Unknown' ? item.artist : 'YouTube Music',
          thumbnail: item.thumbnail || null,
          duration: item.duration || '0:00',
          playCount: 1,
          firstPlayedAt: playedAt,
          lastPlayedAt: playedAt
        });
      }
    }

    const arr = Array.from(statsMap.values());
    arr.sort((a, b) => (b.playCount || 1) - (a.playCount || 1));
    return arr.slice(0, 200);
  }

  /**
   * Lấy cấu trúc dữ liệu của Guild (Đảm bảo có đủ 2 mảng history và trackStats)
   */
  _getGuildData(guildId) {
    if (!this.cache.has(guildId)) {
      this.cache.set(guildId, { history: [], trackStats: [] });
    }
    const val = this.cache.get(guildId);

    // Xử lý tương thích ngược nếu cache đang là mảng phẳng kiểu cũ
    if (Array.isArray(val)) {
      const migrated = {
        history: val,
        trackStats: this._migrateStatsFromHistory(val)
      };
      this.cache.set(guildId, migrated);
      return migrated;
    }

    if (!Array.isArray(val.history)) val.history = [];
    if (!Array.isArray(val.trackStats)) val.trackStats = [];

    return val;
  }

  _loadLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const data = JSON.parse(raw);
        let needsResave = false;

        for (const [guildId, val] of Object.entries(data)) {
          if (Array.isArray(val)) {
            // Định dạng cũ: Array history
            const migrated = {
              history: val,
              trackStats: this._migrateStatsFromHistory(val)
            };
            this.cache.set(guildId, migrated);
            needsResave = true;
          } else if (typeof val === 'object' && val !== null) {
            // Định dạng mới: { history, trackStats }
            const history = Array.isArray(val.history) ? val.history : [];
            let trackStats = Array.isArray(val.trackStats) ? val.trackStats : [];
            if (trackStats.length === 0 && history.length > 0) {
              trackStats = this._migrateStatsFromHistory(history);
              needsResave = true;
            }
            this.cache.set(guildId, { history, trackStats });
          }
        }

        if (needsResave) {
          this._saveLocal();
        }
      }
    } catch (e) {
      console.warn('[HistoryManager] Không thể nạp file local:', e.message);
    }
  }

  _saveLocal() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      try {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        const data = Object.fromEntries(this.cache.entries());
        await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        console.warn('[HistoryManager] Không thể lưu file local:', e.message);
      }
    }, 400);
  }

  _syncMongo(guildId) {
    if (this._mongoTimers.has(guildId)) {
      clearTimeout(this._mongoTimers.get(guildId));
    }

    const timer = setTimeout(async () => {
      this._mongoTimers.delete(guildId);
      try {
        const data = this._getGuildData(guildId);
        await GuildHistory.findOneAndUpdate(
          { guildId },
          {
            guildId,
            history: data.history,
            trackStats: data.trackStats,
            updatedAt: new Date()
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (dbErr) {
        // Bỏ qua lỗi DB nếu offline / không có mạng
      }
    }, 1500);

    this._mongoTimers.set(guildId, timer);
  }

  /**
   * 1. Ghi nhận bài hát vào danh sách "Nghe gần đây" (Gọi ngay khi bài hát bắt đầu phát)
   */
  async addRecentHistory(guildId, song) {
    if (!guildId || !song || !song.title) return;
    if (isLofiTrack(song)) return;

    const data = this._getGuildData(guildId);
    const trackKey = getTrackKey(song);
    const cleanTitle = cleanInvisibleChars(song.title);
    if (!cleanTitle) return;

    let thumbnail = song.thumbnail;
    if (!thumbnail && song.url) {
      const vid = extractVideoId(song.url);
      if (vid) {
        thumbnail = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
    }

    const item = {
      title: cleanTitle,
      url: song.url || null,
      thumbnail: thumbnail || null,
      artist: song.artist && song.artist !== 'Unknown'
        ? cleanInvisibleChars(song.artist)
        : (cleanTitle.includes(' - ') ? cleanTitle.split(' - ')[0].trim() : 'YouTube Music'),
      duration: song.duration || '0:00',
      playedAt: new Date()
    };

    // Khử trùng lặp: Nếu bài hát đã có trong history, xóa vị trí cũ để đẩy lên đầu
    const existingIndex = data.history.findIndex(h => h && (getTrackKey(h) === trackKey || (h.url && song.url && h.url === song.url)));
    if (existingIndex !== -1) {
      data.history.splice(existingIndex, 1);
    }

    data.history.unshift(item);

    // Giữ tối đa 40 bài hát gần nhất
    if (data.history.length > 40) {
      data.history.length = 40;
    }

    this._saveLocal();
    this._syncMongo(guildId);
  }

  /**
   * 2. Chỉ cộng lượt phát cho Bảng xếp hạng khi bài hát thực sự được nghe (sau 25 giây)
   */
  async incrementPlayCount(guildId, song) {
    if (!guildId || !song || !song.title) return;
    if (isLofiTrack(song)) return;

    const data = this._getGuildData(guildId);
    const trackKey = getTrackKey(song);
    if (!trackKey) return;

    const cleanTitle = cleanInvisibleChars(song.title);
    if (!cleanTitle) return;

    let thumbnail = song.thumbnail;
    if (!thumbnail && song.url) {
      const vid = extractVideoId(song.url);
      if (vid) {
        thumbnail = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
    }

    const artist = song.artist && song.artist !== 'Unknown'
      ? cleanInvisibleChars(song.artist)
      : (cleanTitle.includes(' - ') ? cleanTitle.split(' - ')[0].trim() : 'YouTube Music');

    const normTitle = cleanTitle.toLowerCase()
      .replace(/\[.*?\]|\(.*?\)/g, '')
      .replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v|remix|bản gốc|full|topic|live/gi, '')
      .replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '')
      .trim();

    const now = new Date();
    // Khớp theo trackKey HOẶC khớp theo tên bài chuẩn hóa nếu đủ dài
    const existing = data.trackStats.find(t => {
      if (!t) return false;
      if (t.trackKey === trackKey) return true;
      if (normTitle && normTitle.length >= 4) {
        const tNorm = (t.title || '').toLowerCase()
          .replace(/\[.*?\]|\(.*?\)/g, '')
          .replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v|remix|bản gốc|full|topic|live/gi, '')
          .replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '')
          .trim();
        return tNorm === normTitle;
      }
      return false;
    });

    if (existing) {
      existing.playCount = (existing.playCount || 1) + 1;
      existing.lastPlayedAt = now;
      if (!existing.thumbnail && thumbnail) existing.thumbnail = thumbnail;
      if ((!existing.artist || existing.artist === 'YouTube Music') && artist) existing.artist = artist;
      if ((!existing.duration || existing.duration === '0:00') && song.duration) existing.duration = song.duration;
      if (song.url && (!existing.url || !existing.url.startsWith('http'))) existing.url = song.url;
    } else {
      data.trackStats.push({
        trackKey,
        title: cleanTitle,
        url: song.url || '',
        artist,
        thumbnail: thumbnail || null,
        duration: song.duration || '0:00',
        playCount: 1,
        firstPlayedAt: now,
        lastPlayedAt: now
      });
    }

    // Nếu vượt quá 200 bài, chỉ cắt bỏ các bài có playCount === 1 cũ nhất
    if (data.trackStats.length > 200) {
      data.trackStats.sort((a, b) => {
        const countA = a.playCount || 1;
        const countB = b.playCount || 1;
        if (countB !== countA) {
          return countB - countA;
        }
        return new Date(b.lastPlayedAt || 0).getTime() - new Date(a.lastPlayedAt || 0).getTime();
      });
      data.trackStats.length = 200;
    }

    this._saveLocal();
    this._syncMongo(guildId);
  }

  /**
   * Giữ tương thích ngược với các caller cũ gọi addSong
   */
  async addSong(guildId, song) {
    return this.addRecentHistory(guildId, song);
  }

  /**
   * Lấy toàn bộ danh sách lịch sử gần đây của máy chủ
   */
  getHistory(guildId) {
    const data = this._getGuildData(guildId);
    return data.history.filter(item => item && item.title && !isLofiTrack(item));
  }

  /**
   * Lấy danh sách Nghe gần đây có giới hạn số lượng
   */
  getRecent(guildId, limit = 10) {
    const list = this.getHistory(guildId);
    return list.slice(0, limit).map(item => {
      let thumb = item.thumbnail;
      if (!thumb && item.url) {
        const vid = extractVideoId(item.url);
        if (vid) {
          thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
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
   * Lấy bảng xếp hạng "Phổ biến trong máy chủ" (Top bài hát nghe nhiều nhất)
   * - Ưu tiên các bài có playCount >= 2
   * - Fallback hiển thị các bài có playCount >= 1 khi danh sách còn ít
   * - Sắp xếp theo playCount giảm dần, sau đó theo lastPlayedAt mới nhất
   */
  getTopTracks(guildId, limit = 16) {
    const data = this._getGuildData(guildId);
    const stats = data.trackStats || [];
    if (!Array.isArray(stats) || stats.length === 0) return [];

    // Ưu tiên các bài hát có playCount >= 2 và không phải Lofi 24/7
    let popular = stats.filter(t => t && t.title && (t.playCount || 0) >= 2 && !isLofiTrack(t));

    // Nếu chưa có đủ ít nhất 4 bài >= 2 lượt, lấy thêm các bài có playCount >= 1
    if (popular.length < 4) {
      const singlePlays = stats.filter(t => t && t.title && (t.playCount || 0) === 1 && !isLofiTrack(t));
      popular = [...popular, ...singlePlays];
    }

    if (popular.length === 0) {
      return [];
    }

    popular.sort((a, b) => {
      const countA = a.playCount || 0;
      const countB = b.playCount || 0;
      if (countB !== countA) {
        return countB - countA;
      }
      return new Date(b.lastPlayedAt || 0).getTime() - new Date(a.lastPlayedAt || 0).getTime();
    });

    return popular.slice(0, limit).map(item => {
      let thumb = item.thumbnail;
      if (!thumb && item.url) {
        const vid = extractVideoId(item.url);
        if (vid) {
          thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
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
   * Kiểm tra xem bài hát có nằm trong các bài gần nhất không (chống lặp autoplay)
   */
  isRecentlyPlayed(guildId, trackOrTitle, limit = 25) {
    if (!guildId || !trackOrTitle) return false;

    const data = this._getGuildData(guildId);
    const recent = data.history.slice(0, limit);

    const checkTitle = typeof trackOrTitle === 'string' ? trackOrTitle : (trackOrTitle.title || '');
    const checkUrl = typeof trackOrTitle === 'object' ? trackOrTitle.url : (typeof trackOrTitle === 'string' && trackOrTitle.startsWith('http') ? trackOrTitle : null);
    const checkVideoId = extractVideoId(checkUrl);
    const checkTokens = getKeywords(checkTitle);

    for (const item of recent) {
      if (!item) continue;

      // 1. Kiểm tra trùng YouTube video ID hoặc trùng URL chính xác
      if (checkVideoId) {
        const itemVideoId = extractVideoId(item.url);
        if (itemVideoId && itemVideoId === checkVideoId) {
          return true;
        }
      }
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

const historyManagerInstance = new HistoryManager();
historyManagerInstance.getKeywords = getKeywords;
historyManagerInstance.extractVideoId = extractVideoId;
historyManagerInstance.getTrackKey = getTrackKey;

module.exports = historyManagerInstance;
