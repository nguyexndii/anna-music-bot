const mongoose = require('mongoose');

const GuildSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  mode247: { type: Boolean, default: false },
  autoplay: { type: Boolean, default: true },
  musicChannelId: { type: String, default: null },
  lockedVoiceChannelId: { type: String, default: null },
  logChannelId: { type: String, default: null },
  roomLogChannelId: { type: String, default: null },
  errorLogChannelId: { type: String, default: null },
  djOnly: { type: Boolean, default: false },
  djRoleId: { type: String, default: null },
  emptyChannelTimeout: { type: Number, default: 60 },
  crossfadeDuration: { type: Number, default: 0 },
  defaultVolume: { type: Number, default: 80 },
  announceSongs: { type: Boolean, default: true },
  updateVoiceStatus: { type: Boolean, default: true },
  loopMode: { type: String, default: 'off' },
  autoplayLayers: { type: [String], default: ['ytmix', 'lastfm', 'heuristic'] },
  lyricsLayers: { type: [String], default: ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics'] },
  autoSkipOfftopic: { type: Boolean, default: true },
  useAiAssistant: { type: Boolean, default: true },
  voteSkipEnabled: { type: Boolean, default: false },
  requesterCanForceSkip: { type: Boolean, default: true },
  language: { type: String, default: 'vi' }
}, { timestamps: true });

module.exports = mongoose.model('GuildSettings', GuildSettingsSchema);
