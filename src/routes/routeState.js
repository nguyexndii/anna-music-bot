const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const historyManager = require('../structures/HistoryManager');

// Danh sách các Guild đang tải playlist (chống DoS / chồng chéo tải playlist)
const activePlaylistLoads = new Set();

// Cơ chế Debounce thông minh phân cấp
const actionDebounceMap = new Map();
const MAX_ACTION_DEBOUNCE_SIZE = 1000;
const LIGHT_DEBOUNCE_ACTIONS = new Set(['volume', 'remove', 'removeBatch', 'move', 'toggleFavorite']);

// Cache RAM 2.5s cho dữ liệu thống kê máy chủ (Top bài hát, lịch sử, playlist gần đây)
const guildStatsCache = new Map();

function getCachedGuildStats(guildId, forceFresh = false) {
  const now = Date.now();
  const cached = guildStatsCache.get(guildId);
  if (!forceFresh && cached && (now - cached.time < 2500)) {
    return cached.data;
  }
  const rawPlaylists = (playlistHistoryManager.getPlaylists ? playlistHistoryManager.getPlaylists(guildId, 50) : []) || [];
  const recentPlaylists = rawPlaylists.map(pl => ({
    id: pl.id || pl.url,
    url: pl.url,
    title: pl.title || pl.name,
    name: pl.name || pl.title,
    trackCount: pl.trackCount || (Array.isArray(pl.tracks) ? pl.tracks.length : 0),
    itemCount: pl.itemCount || pl.trackCount || (Array.isArray(pl.tracks) ? pl.tracks.length : 0),
    thumbnail: pl.thumbnail,
    addedBy: pl.addedBy,
    addedByAvatar: pl.addedByAvatar,
    addedAt: pl.addedAt
  }));
  const data = {
    history: (historyManager.getRecent ? historyManager.getRecent(guildId, 50) : (historyManager.getHistory(guildId) || []).slice(0, 50)) || [],
    topTracks: (historyManager.getTopTracks ? historyManager.getTopTracks(guildId, 50) : []) || [],
    recentPlaylists
  };
  guildStatsCache.set(guildId, { time: now, data });
  return data;
}

// Trạng thái thành viên đang hoạt động trên Web Dashboard
const activeWebUsersMap = new Map();

function recordActiveUser(guildId, user) {
  if (!guildId || !user || !user.userId) return;
  if (!activeWebUsersMap.has(guildId)) {
    activeWebUsersMap.set(guildId, new Map());
  }
  const guildUsers = activeWebUsersMap.get(guildId);
  guildUsers.set(user.userId, {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName || user.username,
    avatar: user.avatar,
    lastSeen: Date.now()
  });
}

function getActiveWebUsers(guildId) {
  const guildUsers = activeWebUsersMap.get(guildId);
  if (!guildUsers) return [];
  const now = Date.now();
  const active = [];
  for (const [uid, u] of guildUsers.entries()) {
    if (now - u.lastSeen < 6000) {
      active.push({
        userId: u.userId,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar
      });
    } else {
      guildUsers.delete(uid);
    }
  }
  return active;
}

// Khóa phân tích playlist theo Guild chống DoS Logic
const extractingGuilds = new Set();

module.exports = {
  activePlaylistLoads,
  actionDebounceMap,
  MAX_ACTION_DEBOUNCE_SIZE,
  LIGHT_DEBOUNCE_ACTIONS,
  guildStatsCache,
  getCachedGuildStats,
  activeWebUsersMap,
  recordActiveUser,
  getActiveWebUsers,
  extractingGuilds
};
