const { Routes } = require('discord.js');
const { logAction } = require('./debugLogger');

/**
 * Cập nhật trạng thái phòng Voice (Voice Channel Status) hiển thị bài hát đang phát
 */
async function setVoiceChannelStatus(channel, statusText = '') {
  if (!channel || !channel.client || !channel.id) return;
  const trimmed = (statusText || '').slice(0, 100);
  logAction('VOICE_STATUS_UPDATE', {
    source: 'voiceStatusHelper',
    channelId: channel.id,
    status: trimmed || '(empty)'
  });
  try {
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
  if (channel?.id) {
    logAction('VOICE_STATUS_CLEAR', {
      source: 'voiceStatusHelper',
      channelId: channel.id
    });
  }
  await setVoiceChannelStatus(channel, '');
}

module.exports = {
  setVoiceChannelStatus,
  clearVoiceChannelStatus
};
