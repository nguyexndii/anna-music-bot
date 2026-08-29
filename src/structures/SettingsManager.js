const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_GUILD_SETTINGS = {
  mode247: true,               // Chế độ 24/7 (Luôn trực tuyến trong voice)
  autoplay: true,              // Tự động phát bài tương tự khi hết hàng chờ
  musicChannelId: null,        // Kênh văn bản chỉ định (Khóa kênh lệnh)
  lockedVoiceChannelId: null,  // Kênh đàm thoại cố định (Khóa phòng voice)
  djOnly: false,               // Bật/Tắt chế độ chỉ người có Role DJ mới được dùng lệnh
  djRoleId: null,              // ID của vai trò (Role) DJ được chỉ định
  emptyChannelTimeout: 60,     // Số giây chờ trước khi tự rời phòng nếu không có người
  crossfadeDuration: 3,        // Số giây hòa âm / Fade-in mượt mà khi chuyển bài (0 = tắt)
  defaultVolume: 80,           // Âm lượng mặc định (%)
  announceSongs: true,         // Bật/Tắt thông báo Embed bài đang phát
  loopMode: 'off',             // Chế độ lặp: 'off' (Tắt) | 'song' (Lặp bài) | 'queue' (Lặp hàng chờ)
  useAiAssistant: true         // Bật/Tắt Trợ lý DJ Gemini AI để gợi ý và tìm nhạc thông minh
};

class SettingsManager {
  constructor() {
    this.settings = new Map();
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, guildSettings] of Object.entries(data)) {
          this.settings.set(guildId, { ...DEFAULT_GUILD_SETTINGS, ...guildSettings });
        }
      }
    } catch (e) {
      console.error('[SettingsManager] Lỗi khi nạp cài đặt:', e);
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Object.fromEntries(this.settings.entries());
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[SettingsManager] Lỗi khi lưu cài đặt:', e);
    }
  }

  get(guildId) {
    if (!this.settings.has(guildId)) {
      this.settings.set(guildId, { ...DEFAULT_GUILD_SETTINGS });
      this._save();
    }
    return this.settings.get(guildId);
  }

  update(guildId, newSettings) {
    const current = this.get(guildId);
    const updated = { ...current, ...newSettings };
    this.settings.set(guildId, updated);
    this._save();
    return updated;
  }

  reset(guildId) {
    this.settings.set(guildId, { ...DEFAULT_GUILD_SETTINGS });
    this._save();
    return this.get(guildId);
  }
}

module.exports = new SettingsManager();
