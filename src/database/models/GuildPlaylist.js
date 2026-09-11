const mongoose = require('mongoose');

const GuildPlaylistSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  url: { type: String, required: true },
  title: { type: String, default: 'Playlist' },
  trackCount: { type: Number, default: 0 },
  thumbnail: { type: String, default: null },
  addedBy: { type: String, default: 'Web User' },
  addedAt: { type: Date, default: Date.now },
  tracks: [{
    title: { type: String },
    url: { type: String },
    duration: { type: String },
    thumbnail: { type: String },
    author: { type: String }
  }]
}, { timestamps: true });

GuildPlaylistSchema.index({ guildId: 1, url: 1 }, { unique: true });
GuildPlaylistSchema.index({ guildId: 1, updatedAt: -1 });

module.exports = mongoose.model('GuildPlaylist', GuildPlaylistSchema);
