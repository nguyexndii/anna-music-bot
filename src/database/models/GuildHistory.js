const mongoose = require('mongoose');

const trackStatItemSchema = new mongoose.Schema({
  trackKey: { type: String, required: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
  artist: { type: String, default: 'YouTube Music' },
  thumbnail: { type: String, default: null },
  duration: { type: String, default: '0:00' },
  playCount: { type: Number, default: 1 },
  firstPlayedAt: { type: Date, default: Date.now },
  lastPlayedAt: { type: Date, default: Date.now }
}, { _id: false });

const historyItemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  url: { type: String, default: null },
  artist: { type: String, default: 'YouTube Music' },
  thumbnail: { type: String, default: null },
  duration: { type: String, default: '0:00' },
  playedAt: { type: Date, default: Date.now }
}, { _id: false });

const guildHistorySchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  history: [historyItemSchema],
  trackStats: [trackStatItemSchema],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GuildHistory', guildHistorySchema);

