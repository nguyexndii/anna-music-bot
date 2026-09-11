const settingsManager = require('../structures/SettingsManager');

// Danh sách các kênh Voice ưu tiên (Bao gồm kênh Staff)
const STAFF_VOICE_CHANNELS = ['1447095306079698984'];

/**
 * Kiểm tra xem người dùng có quyền sử dụng lệnh âm nhạc không (Dựa trên Role DJ và quyền Admin)
 */
function hasMusicPermission(member) {
  if (!member || !member.guild) return true;

  // Chủ server, Quản trị viên, Quản lý máy chủ luôn có toàn quyền
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) return true;

  const guildSettings = settingsManager.get(member.guild.id);
  if (!guildSettings.djOnly) return true; // Chế độ yêu cầu role đang TẮT -> mọi người đều phát nhạc được

  // Nếu Admin đã gán 1 vai trò (Role) cụ thể trong server: bắt buộc thành viên phải có Role đó
  if (guildSettings.djRoleId) {
    return member.roles.cache.has(guildSettings.djRoleId);
  }

  // Nếu chưa gán role cụ thể nhưng đang bật chế độ DJ Only: cho phép role có chữ "DJ"
  return member.roles.cache.some(r => r.name.toLowerCase().includes('dj'));
}

/**
 * Kiểm tra xem phòng voice người dùng tham gia có hợp lệ không (Bao gồm kênh Staff 1447095306079698984)
 */
function isAllowedVoiceChannel(member) {
  if (!member || !member.guild) return true;

  // Admin / Quản trị viên luôn được phép phát nhạc ở MỌI phòng Voice
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) return true;

  const userVoice = member.voice?.channel;
  if (!userVoice) return false;

  // Kênh Staff 1447095306079698984 luôn được phép
  if (STAFF_VOICE_CHANNELS.includes(userVoice.id)) {
    return true;
  }

  const guildSettings = settingsManager.get(member.guild.id);
  if (guildSettings.lockedVoiceChannelId) {
    return userVoice.id === guildSettings.lockedVoiceChannelId;
  }

  return true;
}

module.exports = {
  hasMusicPermission,
  isAllowedVoiceChannel,
  STAFF_VOICE_CHANNELS
};
