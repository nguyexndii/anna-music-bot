const mongoose = require('mongoose');

const LyricOffsetSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  trackKey: { type: String, required: true, index: true },
  offsetMs: { type: Number, required: true, default: 0 },
  title: { type: String, default: '' },
  artist: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

LyricOffsetSchema.index({ guildId: 1, trackKey: 1 }, { unique: true });
LyricOffsetSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('LyricOffset', LyricOffsetSchema);
