const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const LOFI_HISTORY_FILE = path.join(DATA_DIR, 'lofi_history.json');

class LofiHistoryManager {
  constructor() {
    this.historyMap = new Map(); // guildId -> Array of song objects/titles
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(LOFI_HISTORY_FILE)) {
        const raw = fs.readFileSync(LOFI_HISTORY_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [gid, list] of Object.entries(data)) {
          if (Array.isArray(list)) {
            this.historyMap.set(gid, list);
          }
        }
      }
    } catch (e) {
      console.warn('[LofiHistoryManager] Không thể nạp file lofi_history.json:', e.message);
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Object.fromEntries(this.historyMap.entries());
      fs.writeFileSync(LOFI_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[LofiHistoryManager] Không thể lưu file lofi_history.json:', e.message);
    }
  }

  getHistory(guildId) {
    if (!guildId) return [];
    return this.historyMap.get(guildId) || [];
  }

  addTrack(guildId, track) {
    if (!guildId || !track) return;
    const list = this.historyMap.get(guildId) || [];
    const item = {
      title: track.title || '',
      url: track.url || '',
      artist: track.artist || '',
      playedAt: Date.now()
    };
    list.push(item);
    // Lưu tối đa 80 bài gần nhất (đảm bảo không lặp lại ít nhất 30 bài gần nhất)
    if (list.length > 80) {
      list.shift();
    }
    this.historyMap.set(guildId, list);
    this._save();
  }

  isRecentlyPlayed(guildId, trackOrTitle, limit = 30) {
    if (!guildId || !trackOrTitle) return false;
    const list = this.historyMap.get(guildId) || [];
    if (list.length === 0) return false;
    const recent = list.slice(-limit);

    const titleToCheck = (typeof trackOrTitle === 'string' ? trackOrTitle : (trackOrTitle.title || '')).toLowerCase().trim();
    const urlToCheck = (typeof trackOrTitle === 'object' ? trackOrTitle.url : '') || '';

    return recent.some(item => {
      if (urlToCheck && item.url && item.url === urlToCheck) return true;
      const itemTitle = (item.title || '').toLowerCase().trim();
      if (!itemTitle || !titleToCheck) return false;
      if (itemTitle === titleToCheck) return true;

      // Loại bỏ các từ khóa phụ để so sánh tên bài hát gốc
      const cleanItem = itemTitle.replace(/\[.*?\]|【.*?】|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill|cover/gi, '').trim();
      const cleanTarget = titleToCheck.replace(/\[.*?\]|【.*?】|\(.*?\)|acoustic|guitar|piano|lofi|instrumental|beats|không lời|chill|cover/gi, '').trim();
      if (cleanItem.length >= 4 && cleanTarget.length >= 4 && (cleanItem.includes(cleanTarget) || cleanTarget.includes(cleanItem))) {
        return true;
      }
      return false;
    });
  }
}

module.exports = new LofiHistoryManager();
