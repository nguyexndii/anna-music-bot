const mongoose = require('mongoose');

const lyricCacheSchema = new mongoose.Schema({
  // Fingerprint đa nhân tố độc lập nền tảng: fp_{title}__{artist}__{variant}__{bucket}
  songFingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Mảng khóa tra cứu phụ định danh trực tiếp: ['yt:Mmw-PpWhKFg', 'sp:4cOd...', 'trackKey:...']
  lookupKeys: [{
    type: String,
    index: true
  }],

  title: {
    type: String,
    required: true,
    trim: true
  },
  artist: {
    type: String,
    default: '',
    trim: true
  },
  variantTag: {
    type: String,
    enum: ['original', 'remix', 'acoustic', 'live', 'speedup', 'slowed', 'instrumental', 'cover', 'lofi', 'mashup', 'nonstop', 'bootleg'],
    default: 'original',
    index: true
  },
  durationSec: {
    type: Number,
    default: 0
  },

  type: {
    type: String,
    enum: ['synced', 'plain', 'instrumental'],
    required: true
  },
  lyrics: {
    type: String,
    required: true
  },
  syncedLyrics: [{
    time: { type: Number, required: true },
    text: { type: String, required: true }
  }],

  source: {
    type: String,
    enum: ['youtube_cc', 'lrclib', 'zingmp3', 'syncedlyrics', 'youtube_description', 'manual', 'lrclib_original_fallback', 'musixmatch', 'netease', 'genius'],
    default: 'lrclib'
  },
  autoOffsetMs: {
    type: Number,
    default: 0
  },
  isRemixOrDurationMismatch: {
    type: Boolean,
    default: false
  },
  language: {
    type: String,
    default: 'unknown'
  },
  qualityScore: {
    type: Number,
    default: 50,
    min: 0,
    max: 100
  },

  // Chống DoS Xóa Cache: Lưu mảng userId Discord báo lỗi thay vì bộ đếm đơn giản
  reportedBy: [{
    type: String,
    index: true
  }],

  // Cooldown 24h Smart Upgrade: Timestamp lần cuối cùng chạy tác vụ quét ngầm nâng cấp
  lastUpgradeAttemptAt: {
    type: Date,
    default: null,
    index: true
  },

  // TTL Index tự động dọn dẹp các bài hát không còn ai nghe sau 30 ngày
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '30d'
  }
}, {
  timestamps: true
});

// Chỉ mục kết hợp tối ưu tốc độ tra cứu < 2ms
lyricCacheSchema.index({ lookupKeys: 1, qualityScore: -1 });
lyricCacheSchema.index({ songFingerprint: 1, variantTag: 1 });

module.exports = mongoose.models.LyricCache || mongoose.model('LyricCache', lyricCacheSchema);
