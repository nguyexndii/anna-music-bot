const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_GUILD_SETTINGS = {
  mode247: true,               // Chế độ 24/7 (Luôn trực tuyến trong voice)
  autoplay: true,              // Tự động phát bài tương tự khi hết hàng chờ
  musicChannelId: null,        // Kênh văn bản chỉ định (Khóa kênh lệnh)
  lockedVoiceChannelId: null,  // Kênh đàm thoại cố định (Khóa phòng voice)
  logChannelId: null,          // Kênh văn bản ghi nhật ký hoạt động chung (Log Channel)
  roomLogChannelId: null,      // Kênh ghi log room / voice activity (mặc định 1543841691541180546)
  errorLogChannelId: null,     // Kênh ghi log lỗi hệ thống & phát nhạc (mặc định 1547449482835394640)
  djOnly: false,               // Bật/Tắt chế độ chỉ người có Role DJ mới được dùng lệnh
  djRoleId: null,              // ID của vai trò (Role) DJ được chỉ định
  emptyChannelTimeout: 60,     // Số giây chờ trước khi tự rời phòng nếu không có người
  crossfadeDuration: 3,        // Số giây hòa âm / Fade-in mượt mà khi chuyển bài (0 = tắt)
  defaultVolume: 80,           // Âm lượng mặc định (%)
  announceSongs: true,         // Bật/Tắt thông báo Embed bài đang phát
  updateVoiceStatus: true,     // Bật/Tắt tự động đổi trạng thái dòng chữ trên kênh Voice
  loopMode: 'off',             // Chế độ lặp: 'off' (Tắt) | 'song' (Lặp bài) | 'queue' (Lặp hàng chờ)
  useAiAssistant: true,        // Bật/Tắt Trợ lý DJ Gemini AI để gợi ý và tìm nhạc thông minh
  autoplayLayers: ['ytmix', 'ai', 'lastfm', 'heuristic'], // Thứ tự và danh sách tầng Autoplay được kích hoạt
  language: 'en'               // Ngôn ngữ hệ thống: 'en' (English) | 'vi' (Tiếng Việt)
};

const VALID_AUTOPLAY_LAYERS = ['ytmix', 'ai', 'lastfm', 'heuristic'];

function cleanAutoplayLayers(layers) {
  if (!Array.isArray(layers)) return ['ytmix', 'ai', 'lastfm', 'heuristic'];
  const cleaned = [];
  for (const l of layers) {
    if (typeof l === 'string' && VALID_AUTOPLAY_LAYERS.includes(l) && !cleaned.includes(l)) {
      cleaned.push(l);
    }
  }
  return cleaned.length > 0 ? cleaned : ['ytmix', 'ai', 'lastfm', 'heuristic'];
}

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
          const merged = { ...DEFAULT_GUILD_SETTINGS, ...guildSettings };
          merged.autoplayLayers = cleanAutoplayLayers(merged.autoplayLayers);
          this.settings.set(guildId, merged);
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
    if (!newSettings || typeof newSettings !== 'object') return current;

    const toApply = {};
    // Whitelist: Chỉ cho phép các trường cấu hình hợp lệ đã định nghĩa trong DEFAULT_GUILD_SETTINGS
    for (const key of Object.keys(DEFAULT_GUILD_SETTINGS)) {
      if (newSettings[key] !== undefined) {
        toApply[key] = newSettings[key];
      }
    }

    if (toApply.autoplayLayers !== undefined) {
      toApply.autoplayLayers = cleanAutoplayLayers(toApply.autoplayLayers);
    }
    if (toApply.defaultVolume !== undefined) {
      const vol = parseInt(toApply.defaultVolume, 10);
      toApply.defaultVolume = (!isNaN(vol) && vol >= 1 && vol <= 150) ? vol : current.defaultVolume;
    }

    const updated = { ...current, ...toApply };
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

const settingsInstance = new SettingsManager();
settingsInstance.cleanAutoplayLayers = cleanAutoplayLayers;
settingsInstance.VALID_AUTOPLAY_LAYERS = VALID_AUTOPLAY_LAYERS;

module.exports = settingsInstance;
