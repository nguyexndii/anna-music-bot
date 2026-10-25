const settingsManager = require('../structures/SettingsManager');
const config = require('../config');

// Danh sách các kênh Voice ưu tiên (Bao gồm kênh Staff)
const STAFF_VOICE_CHANNELS = config.staffVoiceChannels || [];

/**
 * Kiểm tra Quản trị viên Thực thụ (Chỉ Server Owner, Administrator, ManageGuild, hoặc adminId trong config)
 * Dùng cho tất cả các thao tác cấu hình nhạy cảm (24/7, Log, Reset, Khóa Voice, v.v.)
 */
function isStrictAdmin(member) {
  if (!member || !member.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (config.adminId && member.id === String(config.adminId)) return true;
  if (member.permissions?.has('Administrator') || member.permissions?.has('ManageGuild')) return true;
  return false;
}

/**
 * Kiểm tra xem người dùng có quyền Quản lý máy chủ (Không bao gồm vai trò DJ đơn thuần)
 */
function hasManagerPermission(member) {
  if (!member || !member.guild) return false;
  if (isStrictAdmin(member)) return true;
  if (member.permissions?.has('ManageChannels')) return true;

  return member.roles?.cache?.some(r => /quản\s*lý|manager|admin|mod/i.test(r.name)) || false;
}

/**
 * Kiểm tra xem thành viên có vai trò DJ hoặc quyền Quản lý máy chủ không
 */
function hasDJPermission(member) {
  if (!member || !member.guild) return false;
  if (isStrictAdmin(member)) return true;
  if (hasManagerPermission(member)) return true;

  const guildSettings = settingsManager.get(member.guild.id);
  // 1. Kiểm tra theo ID vai trò DJ được gán cụ thể trong cài đặt máy chủ
  if (guildSettings?.djRoleId && member.roles?.cache?.has(guildSettings.djRoleId)) {
    return true;
  }

  // 2. Tự động nhận diện role có tên "DJ" (không phân biệt hoa thường)
  return member.roles?.cache?.some(r => r.name.toLowerCase() === 'dj' || /\bdj\b/i.test(r.name)) || false;
}

/**
 * Kiểm tra xem người dùng có quyền sử dụng lệnh âm nhạc không (Dựa trên Role DJ và quyền Admin)
 */
function hasMusicPermission(member) {
  if (!member || !member.guild) return true;
  if (isStrictAdmin(member)) return true;

  const guildSettings = settingsManager.get(member.guild.id);
  if (!guildSettings?.djOnly) return true; // Chế độ DJ Only đang TẮT -> mọi người đều phát nhạc được

  return hasDJPermission(member);
}

/**
 * Kiểm tra xem phòng voice người dùng tham gia có hợp lệ không (Bao gồm kênh Staff)
 * Hỗ trợ nhận linh hoạt cả đối tượng GuildMember lẫn VoiceChannel
 */
function isAllowedVoiceChannel(memberOrChannel) {
  if (!memberOrChannel || !memberOrChannel.guild) return true;

  // Nếu là Member và là Admin thì luôn được phép
  if (memberOrChannel.permissions && isStrictAdmin(memberOrChannel)) return true;

  const guildSettings = settingsManager.get(memberOrChannel.guild.id);
  // Nếu server KHÔNG cấu hình khóa kênh Voice nào thì mặc định mọi kênh đều hợp lệ
  if (!guildSettings?.lockedVoiceChannelId) {
    return true;
  }

  // Lấy ID kênh Voice (hỗ trợ cả Member lẫn VoiceChannel object)
  const channelId = memberOrChannel.voice?.channelId || memberOrChannel.voice?.channel?.id || memberOrChannel.id;
  if (!channelId) return false;

  // Kênh Staff luôn được phép
  if (STAFF_VOICE_CHANNELS.includes(channelId)) {
    return true;
  }

  return channelId === guildSettings.lockedVoiceChannelId;
}

module.exports = {
  isStrictAdmin,
  hasMusicPermission,
  hasManagerPermission,
  hasDJPermission,
  isAllowedVoiceChannel,
  STAFF_VOICE_CHANNELS
};
