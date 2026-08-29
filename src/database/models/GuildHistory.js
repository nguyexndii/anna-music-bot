const mongoose = require('mongoose');

const guildHistorySchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  history: [
    {
      title: { type: String, required: true },
      url: { type: String },
      playedAt: { type: Date, default: Date.now }
    }
  ],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GuildHistory', guildHistorySchema);
