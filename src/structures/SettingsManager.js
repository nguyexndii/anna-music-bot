const fs = require('fs');
const path = require('path');
const GuildSettings = require('../database/models/GuildSettings');

const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_GUILD_SETTINGS = {
  mode247: false,              // Chế độ 24/7 (Mặc định TẮT để tối ưu CPU trên VPS đa máy chủ)
  autoplay: true,              // Tự động phát bài tương tự khi hết hàng chờ
  musicChannelId: null,        // Kênh văn bản chỉ định (Khóa kênh lệnh)
  lockedVoiceChannelId: null,  // Kênh đàm thoại cố định (Khóa phòng voice)
  logChannelId: null,          // Kênh văn bản ghi nhật ký hoạt động chung (Log Channel)
  roomLogChannelId: null,      // Kênh ghi log room / voice activity (mặc định 1543841691541180546)
  errorLogChannelId: null,     // Kênh ghi log lỗi hệ thống & phát nhạc (mặc định 1547449482835394640)
  djOnly: false,               // Bật/Tắt chế độ chỉ người có Role DJ mới được dùng lệnh
  djRoleId: null,              // ID của vai trò (Role) DJ được chỉ định
  emptyChannelTimeout: 60,     // Số giây chờ trước khi tự rời phòng nếu không có người
  crossfadeDuration: 0,        // Số giây hòa âm / Fade-in mượt mà khi chuyển bài (Mặc định 0 = TẮT hoàn toàn để chống tụt/phập phù âm lượng)
  defaultVolume: 80,           // Âm lượng mặc định (%)
  announceSongs: true,         // Bật/Tắt thông báo Embed bài đang phát
  updateVoiceStatus: true,     // Bật/Tắt tự động đổi trạng thái dòng chữ trên kênh Voice
  loopMode: 'off',             // Chế độ lặp: 'off' (Tắt) | 'song' (Lặp bài) | 'queue' (Lặp hàng chờ)
  autoplayLayers: ['ytmix', 'lastfm', 'heuristic'], // Thứ tự và danh sách tầng Autoplay được kích hoạt
  lyricsLayers: ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'], // Thứ tự và danh sách tầng Lời bài hát (Lyrics) được kích hoạt
  autoSkipOfftopic: true,      // Tự động bỏ qua đoạn kịch mở đầu/credit kết thúc MV YouTube qua SponsorBlock
  language: 'en'               // Ngôn ngữ hệ thống: 'en' (English) | 'vi' (Tiếng Việt)
};

const VALID_AUTOPLAY_LAYERS = ['ytmix', 'lastfm', 'heuristic'];
const VALID_LYRICS_LAYERS = ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'];

function cleanAutoplayLayers(layers) {
  if (!Array.isArray(layers)) return ['ytmix', 'lastfm', 'heuristic'];
  const cleaned = [];
  for (const l of layers) {
    if (typeof l === 'string' && VALID_AUTOPLAY_LAYERS.includes(l) && !cleaned.includes(l)) {
      cleaned.push(l);
    }
  }
  return cleaned.length > 0 ? cleaned : ['ytmix', 'lastfm', 'heuristic'];
}

function cleanLyricsLayers(layers) {
  if (!Array.isArray(layers)) return ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'];
  const cleaned = [];
  for (const l of layers) {
    if (typeof l === 'string' && VALID_LYRICS_LAYERS.includes(l) && !cleaned.includes(l)) {
      cleaned.push(l);
    }
  }
  return cleaned.length > 0 ? cleaned : ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'];
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
        let hasMigrated = false;
        for (const [guildId, guildSettings] of Object.entries(data)) {
          const merged = { ...DEFAULT_GUILD_SETTINGS, ...guildSettings };
          merged.autoplayLayers = cleanAutoplayLayers(merged.autoplayLayers);
          merged.lyricsLayers = cleanLyricsLayers(merged.lyricsLayers);
          // Tắt triệt để Crossfade giả lập cũ (3s hoặc 10s) đã lưu trước đây để không gây phập phù âm lượng
          if (merged.crossfadeDuration > 0) {
            merged.crossfadeDuration = 0;
            hasMigrated = true;
          }
          this.settings.set(guildId, merged);
        }
        if (hasMigrated) {
          this._save();
        }
      }
    } catch (e) {
      console.error('[SettingsManager] Lỗi khi nạp cài đặt:', e);
    }
  }

  _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      try {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        const data = Object.fromEntries(this.settings.entries());
        await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        console.error('[SettingsManager] Lỗi khi lưu cài đặt:', e);
      }
    }, 300);
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
    if (toApply.lyricsLayers !== undefined) {
      toApply.lyricsLayers = cleanLyricsLayers(toApply.lyricsLayers);
    }
    if (toApply.defaultVolume !== undefined) {
      const vol = parseInt(toApply.defaultVolume, 10);
      toApply.defaultVolume = (!isNaN(vol) && vol >= 1 && vol <= 150) ? vol : current.defaultVolume;
    }
    if (toApply.crossfadeDuration !== undefined) {
      const cf = parseInt(toApply.crossfadeDuration, 10);
      toApply.crossfadeDuration = (!isNaN(cf) && cf >= 0 && cf <= 10) ? cf : current.crossfadeDuration;
    }
    if (toApply.emptyChannelTimeout !== undefined) {
      const ect = parseInt(toApply.emptyChannelTimeout, 10);
      toApply.emptyChannelTimeout = (!isNaN(ect) && ect >= 15 && ect <= 3600) ? ect : current.emptyChannelTimeout;
    }
    if (toApply.loopMode !== undefined) {
      toApply.loopMode = ['off', 'song', 'queue'].includes(toApply.loopMode) ? toApply.loopMode : current.loopMode;
    }
    if (toApply.language !== undefined) {
      toApply.language = ['en', 'vi'].includes(toApply.language) ? toApply.language : current.language;
    }

    // Validate Discord Snowflake ID hoặc null
    const snowflakeFields = ['musicChannelId', 'lockedVoiceChannelId', 'logChannelId', 'roomLogChannelId', 'errorLogChannelId', 'djRoleId'];
    for (const f of snowflakeFields) {
      if (toApply[f] !== undefined) {
        if (toApply[f] === null || toApply[f] === '' || toApply[f] === 'none') {
          toApply[f] = null;
        } else if (typeof toApply[f] === 'string' && /^\d{17,20}$/.test(toApply[f].trim())) {
          toApply[f] = toApply[f].trim();
        } else {
          toApply[f] = current[f];
        }
      }
    }

    // Validate kiểu Boolean
    const booleanFields = ['mode247', 'autoplay', 'djOnly', 'announceSongs', 'updateVoiceStatus'];
    for (const b of booleanFields) {
      if (toApply[b] !== undefined) {
        toApply[b] = Boolean(toApply[b]);
      }
    }

    const updated = { ...current, ...toApply };
    this.settings.set(guildId, updated);
    this._save();

    // Đồng bộ lên MongoDB Atlas (non-blocking)
    GuildSettings.findOneAndUpdate(
      { guildId },
      { $set: { guildId, ...updated } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(err => {
      console.warn(`[SettingsManager] Lỗi lưu MongoDB Guild ${guildId}:`, err.message);
    });

    return updated;
  }

  reset(guildId) {
    this.settings.set(guildId, { ...DEFAULT_GUILD_SETTINGS });
    this._save();

    GuildSettings.findOneAndReplace(
      { guildId },
      { guildId, ...DEFAULT_GUILD_SETTINGS },
      { upsert: true }
    ).catch(err => {
      console.warn(`[SettingsManager] Lỗi reset MongoDB Guild ${guildId}:`, err.message);
    });

    return this.get(guildId);
  }

  async syncFromDatabase() {
    try {
      const records = await GuildSettings.find({}).lean();
      if (Array.isArray(records) && records.length > 0) {
        let count = 0;
        for (const doc of records) {
          if (!doc.guildId) continue;
          const merged = { ...DEFAULT_GUILD_SETTINGS, ...doc };
          delete merged._id;
          delete merged.__v;
          delete merged.createdAt;
          delete merged.updatedAt;
          merged.autoplayLayers = cleanAutoplayLayers(merged.autoplayLayers);
          merged.lyricsLayers = cleanLyricsLayers(merged.lyricsLayers);
          if (merged.crossfadeDuration > 0) merged.crossfadeDuration = 0;
          this.settings.set(doc.guildId, merged);
          count++;
        }
        console.log(`[SettingsManager] Đã đồng bộ cài đặt của ${count} máy chủ từ MongoDB Atlas.`);
      }
    } catch (e) {
      console.warn('[SettingsManager] Không thể đồng bộ từ MongoDB Atlas:', e.message);
    }
  }
}

const settingsInstance = new SettingsManager();
settingsInstance.cleanAutoplayLayers = cleanAutoplayLayers;
settingsInstance.VALID_AUTOPLAY_LAYERS = VALID_AUTOPLAY_LAYERS;
settingsInstance.cleanLyricsLayers = cleanLyricsLayers;
settingsInstance.VALID_LYRICS_LAYERS = VALID_LYRICS_LAYERS;

module.exports = settingsInstance;
