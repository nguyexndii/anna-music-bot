const mongoose = require('mongoose');

const guildSessionSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  voiceChannelId: { type: String, default: null },
  textChannelId: { type: String, default: null },
  mode247: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'idle_247', 'off'], default: 'off' },
  currentSong: { type: Object, default: null },
  songs: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GuildSession', guildSessionSchema);
