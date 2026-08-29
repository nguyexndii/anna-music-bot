const { Routes } = require('discord.js');

/**
 * Cập nhật trạng thái phòng Voice (Voice Channel Status) hiển thị bài hát đang phát
 */
async function setVoiceChannelStatus(channel, statusText = '') {
  if (!channel || !channel.client || !channel.id) return;
  try {
    const trimmed = (statusText || '').slice(0, 100);
    await channel.client.rest.put(Routes.channelVoiceStatus(channel.id), {
      body: { status: trimmed }
    });
  } catch (err) {
    // Bỏ qua lỗi an toàn nếu bot thiếu quyền ManageChannels / Set Voice Channel Status
  }
}

/**
 * Xóa trạng thái phòng Voice khi bot dừng phát hoặc rời phòng
 */
async function clearVoiceChannelStatus(channel) {
  await setVoiceChannelStatus(channel, '');
}

module.exports = {
  setVoiceChannelStatus,
  clearVoiceChannelStatus
};
