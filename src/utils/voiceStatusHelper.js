const { Routes } = require('discord.js');
const { logAction } = require('./debugLogger');

const settingsManager = require('../structures/SettingsManager');

/**
 * Cập nhật trạng thái phòng Voice (Voice Channel Status) hiển thị bài hát đang phát
 */
async function setVoiceChannelStatus(channel, statusText = '') {
  if (!channel || !channel.client || !channel.id) return;
  const guildId = channel.guild?.id || channel.guildId;
  if (guildId) {
    const settings = settingsManager.get(guildId);
    if (settings && settings.updateVoiceStatus === false) {
      return; // Đã tắt cập nhật trạng thái kênh voice theo cài đặt của Admin
    }
  }

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
