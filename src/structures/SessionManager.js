const fs = require('fs');
const path = require('path');
const GuildSession = require('../database/models/GuildSession');

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

class SessionManager {
  constructor() {
    this.cache = new Map();
    this._loadLocal();
  }

  _loadLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [guildId, session] of Object.entries(data)) {
          this.cache.set(guildId, session);
        }
      }
    } catch (e) {
      console.warn('[SessionManager] Không thể nạp file local sessions:', e.message);
    }
  }

  _saveLocal() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Object.fromEntries(this.cache.entries());
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[SessionManager] Không thể lưu file local sessions:', e.message);
    }
  }

  async saveSession(guildId, data) {
    if (!guildId) return;

    const session = {
      guildId,
      voiceChannelId: data.voiceChannelId || null,
      textChannelId: data.textChannelId || null,
      mode247: Boolean(data.mode247),
      status: data.status || 'active',
      updatedAt: new Date()
    };

    this.cache.set(guildId, session);
    this._saveLocal();

    try {
      await GuildSession.findOneAndUpdate(
        { guildId },
        session,
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      // Bỏ qua lỗi DB
    }
  }

  async clearSession(guildId) {
    if (!guildId) return;
    const session = {
      guildId,
      voiceChannelId: null,
      textChannelId: null,
      mode247: false,
      status: 'off',
      updatedAt: new Date()
    };
    this.cache.set(guildId, session);
    this._saveLocal();

    try {
      await GuildSession.findOneAndUpdate(
        { guildId },
        session,
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      // Bỏ qua lỗi DB
    }
  }

  getSession(guildId) {
    return this.cache.get(guildId) || null;
  }

  getAllActive247Sessions() {
    const list = [];
    for (const session of this.cache.values()) {
      if (session.mode247 && session.voiceChannelId && session.status !== 'off') {
        list.push(session);
      }
    }
    return list;
  }

  async syncFromDatabase() {
    try {
      const docs = await GuildSession.find({ mode247: true, status: { $ne: 'off' } });
      if (docs && docs.length > 0) {
        for (const doc of docs) {
          this.cache.set(doc.guildId, {
            guildId: doc.guildId,
            voiceChannelId: doc.voiceChannelId,
            textChannelId: doc.textChannelId,
            mode247: doc.mode247,
            status: doc.status,
            updatedAt: doc.updatedAt
          });
        }
        this._saveLocal();
      }
    } catch (e) {
      console.warn('[SessionManager Sync DB Warning]:', e.message);
    }
  }
}

module.exports = new SessionManager();
