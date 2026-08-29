const mongoose = require('mongoose');

const favoriteSongSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  songs: [
    {
      title: { type: String, required: true },
      url: { type: String, required: true },
      duration: { type: String, default: '0:00' },
      thumbnail: { type: String, default: null },
      addedAt: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

module.exports = mongoose.models.FavoriteSong || mongoose.model('FavoriteSong', favoriteSongSchema);
