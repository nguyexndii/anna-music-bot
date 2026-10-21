const mongoose = require('mongoose');

const userPlaylistSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  playlists: [
    {
      id: { type: String, required: true },
      name: { type: String, required: true, trim: true },
      description: { type: String, default: '' },
      thumbnail: { type: String, default: null },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
      songs: [
        {
          title: { type: String, required: true },
          artist: { type: String, default: 'Unknown Artist' },
          url: { type: String, required: true },
          duration: { type: String, default: '0:00' },
          thumbnail: { type: String, default: null },
          addedAt: { type: Date, default: Date.now }
        }
      ]
    }
  ]
}, { timestamps: true });

module.exports = mongoose.models.UserPlaylist || mongoose.model('UserPlaylist', userPlaylistSchema);
