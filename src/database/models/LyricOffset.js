const mongoose = require('mongoose');

const LyricOffsetSchema = new mongoose.Schema({
  trackKey: { type: String, required: true, unique: true, index: true },
  offsetMs: { type: Number, required: true, default: 0 },
  title: { type: String, default: '' },
  artist: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

LyricOffsetSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('LyricOffset', LyricOffsetSchema);
