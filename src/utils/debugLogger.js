/**
 * debugLogger.js
 *
 * Helper log debug để truy vết mọi hành động Discord API & hoạt động của bot.
 * Tự động gửi thông báo trực quan vào Kênh Log (nếu máy chủ đã cấu hình logChannelId)
 * với cờ im lặng flags: 4096 để không tạo tiếng chuông tít tít phiền toái.
 */

const { EmbedBuilder } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');

let discordClient = null;

/**
 * Khởi tạo logger với Discord Client
 * @param {import('discord.js').Client} client 
 */
function initLogger(client) {
  discordClient = client;
}

/**
 * Helper dịch tên hành động sang tiếng Việt dễ đọc
 */
function getActionInfo(action, details = {}) {
  const type = details.type || details.event || '';
  
  if (action === 'MESSAGE_EDIT') {
    return {
      title: '✏️ Sửa Tin Nhắn (Message Edit)',
      color: 0xFEE75C,
      desc: details.type ? `Loại: \`${details.type}\`` : 'Đã chỉnh sửa tin nhắn trên kênh'
    };
  }
  if (action === 'MESSAGE_DELETE') {
    return {
      title: '🗑️ Xóa Tin Nhắn (Message Delete)',
      color: 0xED4245,
      desc: details.type ? `Loại: \`${details.type}\`` : 'Đã xóa tin nhắn trên kênh'
    };
  }
  if (action === 'MESSAGE_SEND' || action === 'MESSAGE_REPLY') {
    return {
      title: '📤 Gửi Tin Nhắn (Message Send)',
      color: 0x57F287,
      desc: details.type ? `Loại: \`${details.type}\`` : 'Bot gửi phản hồi / thông báo'
    };
  }
  if (action === 'COMMAND_EXECUTE') {
    return {
      title: '⚡ Thực Thi Lệnh (Command Execute)',
      color: 0x5865F2,
      desc: `Lệnh: \`${details.command || details.name || 'unknown'}\``
    };
  }
  if (action === 'VOICE_STATE_UPDATE') {
    return {
      title: '🔊 Thay Đổi Voice (Voice State Update)',
      color: 0x9B59B6,
      desc: details.event ? `Sự kiện: \`${details.event}\`` : 'Thay đổi trạng thái phòng Voice'
    };
  }
  if (action === 'VOICE_STATUS_UPDATE' || action === 'VOICE_STATUS_CLEAR') {
    return {
      title: '📡 Trạng Thái Voice (Voice Channel Status)',
      color: 0x3498DB,
      desc: details.status ? `Trạng thái: **${details.status}**` : 'Cập nhật trạng thái kênh Voice'
    };
  }
  if (action.startsWith('INTERACTION_') || action === 'MODAL_ADD_SONG') {
    return {
      title: '🖱️ Tương Tác Nút / Menu (Interaction)',
      color: 0x3BA55D,
      desc: details.customId ? `Nút/Menu ID: \`${details.customId}\`` : (details.type || 'Tương tác người dùng')
    };
  }
  if (action === 'WEB_PLAYER_ACTION' || action === 'WEB_ACTION') {
    return {
      title: '🌐 Thao Tác Từ Web Player',
      color: 0x00B0F4,
      desc: details.action ? `Thao tác: \`${details.action}\`` : 'Người dùng điều khiển từ giao diện Web'
    };
  }

  return {
    title: `📋 Hoạt Động: ${action}`,
    color: 0x95A5A6,
    desc: type ? `Chi tiết: \`${type}\`` : ''
  };
}

// Hàng đợi gửi log để tránh nghẽn Discord API Rate Limit
const logQueue = [];
let isProcessingLogQueue = false;

async function processLogQueue() {
  if (isProcessingLogQueue || logQueue.length === 0) return;
  isProcessingLogQueue = true;

  while (logQueue.length > 0) {
    const item = logQueue.shift();
    try {
      let targetChannel = item.targetChannel;
      if (!targetChannel && item.logChannelId && discordClient) {
        targetChannel = discordClient.channels.cache.get(item.logChannelId)
          || await discordClient.channels.fetch(item.logChannelId).catch(() => null);
      }

      if (targetChannel && targetChannel.isTextBased && targetChannel.isTextBased()) {
        await targetChannel.send({
          embeds: [item.embed],
          flags: 4096,
          allowedMentions: { parse: [] }
        }).catch((sendErr) => {
          console.warn('[LogChannel Send Warning]:', sendErr.message);
        });
      }
    } catch (e) {
      console.warn('[LogQueue Error]:', e.message);
    }
    // Chờ 100ms giữa các tin nhắn log để tránh rate limit
    await new Promise(res => setTimeout(res, 100));
  }

  isProcessingLogQueue = false;
}

/**
 * Ghi 1 dòng log debug voi timestamp ISO hien tai và tự động bắn vào Kênh Log Discord nếu có
 * @param {string} action  Tên hành động viết HOA (e.g. MESSAGE_SEND, MESSAGE_EDIT)
 * @param {Object} details Các cặp key-value bổ sung (tùy chọn)
 */
function logAction(action, details = {}) {
  const ts = new Date().toISOString();
  const pairs = Object.entries(details)
    .map(([k, v]) => {
      const val = (v === null || v === undefined) ? 'null' : String(v);
      return `${k}=${val.includes(' ') || val.length === 0 ? `"${val}"` : val}`;
    })
    .join(' ');
  
  // 1. Luôn in ra console terminal
  console.log(`[DEBUG ${ts}] ${action}${pairs ? ' ' + pairs : ''}`);

  // 2. Kiểm tra và gửi vào kênh Log của máy chủ Discord
  if (!discordClient || details.isLogMessage) return;

  try {
    let guildId = details.guildId;
    if (!guildId && details.channelId) {
      const ch = discordClient.channels.cache.get(details.channelId);
      if (ch && ch.guild) guildId = ch.guild.id;
    }

    if (!guildId) return;

    const guildSettings = settingsManager.get(guildId);
    const logChannelId = guildSettings?.logChannelId;
    if (!logChannelId) return;

    // Không log lại tin nhắn được gửi trong chính kênh Log
    if (details.channelId === logChannelId) return;

    const logChannel = discordClient.channels.cache.get(logChannelId);

    const info = getActionInfo(action, details);
    const timeFormatted = `<t:${Math.floor(Date.now() / 1000)}:T>`;

    const embed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(info.title)
      .setTimestamp();

    let desc = `${timeFormatted} • ${info.desc}\n`;

    if (details.channelId) {
      desc += `📁 **Kênh:** <#${details.channelId}>\n`;
    }
    if (details.userId) {
      desc += `👤 **Người thực hiện:** <@${details.userId}>\n`;
    }
    if (details.user) {
      desc += `👤 **Người thực hiện:** ${details.user}\n`;
    }
    if (details.messageId) {
      desc += `🆔 **Tin nhắn ID:** \`${details.messageId}\`\n`;
    }
    if (details.song) {
      desc += `🎵 **Bài hát:** ${details.song}\n`;
    }
    if (details.content) {
      const cleanContent = String(details.content).slice(0, 300);
      desc += `📝 **Nội dung:** \`${cleanContent}\`\n`;
    }
    if (details.oldContent && details.newContent) {
      desc += `📝 **Cũ:** \`${String(details.oldContent).slice(0, 150)}\`\n`;
      desc += `📝 **Mới:** \`${String(details.newContent).slice(0, 150)}\`\n`;
    }

    embed.setDescription(desc.trim());

    // Thêm vào hàng đợi gửi log an toàn
    logQueue.push({ logChannelId, targetChannel: logChannel || null, embed });
    processLogQueue();

  } catch (err) {
    // Không crash bot nếu có lỗi gửi log
  }
}

module.exports = {
  initLogger,
  logAction
};
