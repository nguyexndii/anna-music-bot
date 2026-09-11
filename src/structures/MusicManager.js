const MusicQueue = require('./MusicQueue');

class MusicManager {
  constructor() {
    this.queues = new Map();
  }

  get(guildId) {
    return this.queues.get(guildId);
  }

  getOrCreate(guild, textChannel, voiceChannel) {
    let queue = this.queues.get(guild.id);
    if (!queue) {
      queue = new MusicQueue(guild, textChannel, voiceChannel, this);
      this.queues.set(guild.id, queue);
    } else {
      if (guild) queue.guild = guild;
      if (textChannel) queue.textChannel = textChannel;
      if (voiceChannel) queue.voiceChannel = voiceChannel;
    }
    return queue;
  }

  remove(guildId) {
    this.queues.delete(guildId);
  }
}

module.exports = new MusicManager();
