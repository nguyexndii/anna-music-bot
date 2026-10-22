/**
 * debugLogger.js
 *
 * Helper log debug để truy vết mọi hành động Discord API & hoạt động của bot.
 * Tự động gửi thông báo trực quan vào Kênh Log (nếu máy chủ đã cấu hình logChannelId)
 * với cờ im lặng flags: 4096 để không tạo tiếng chuông tít tít phiền toái.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const settingsManager = require('../structures/SettingsManager');
const config = require('../config');

const LOGS_DIR = path.join(__dirname, '../../logs');
const EVENT_LOG_FILE = path.join(LOGS_DIR, 'events.log');
const OLD_LOG_FILE = path.join(LOGS_DIR, 'events.old.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function formatVietnamTime(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  } catch (e) {
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
}

function writeToEventLogFile(action, details = {}) {
  // Bỏ qua các sự kiện message edit/send phụ không quan trọng để giữ file log sạch sẽ
  if (['MESSAGE_EDIT', 'MESSAGE_SEND', 'MESSAGE_REPLY', 'MESSAGE_DELETE'].includes(action)) {
    if (!details.type || (!details.type.includes('DISCONNECT') && !details.type.includes('BANNER'))) {
      return;
    }
  }

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    if (fs.existsSync(EVENT_LOG_FILE)) {
      const stat = fs.statSync(EVENT_LOG_FILE);
      if (stat.size >= MAX_LOG_SIZE) {
        if (fs.existsSync(OLD_LOG_FILE)) {
          try { fs.unlinkSync(OLD_LOG_FILE); } catch (e) {}
        }
        try { fs.renameSync(EVENT_LOG_FILE, OLD_LOG_FILE); } catch (e) {}
      }
    }

    const timeStr = formatVietnamTime();
    let summary = '';

    if (details.error) {
      summary = `❌ Lỗi: ${details.error}`;
    } else if (action === 'TRACK_START') {
      summary = `🎵 Phát bài: "${details.title || 'Unknown'}" | Order: ${details.requestedBy || 'Auto'}${details.is247 ? ' (24/7 Lofi)' : ''}`;
    } else if (action === 'TRACK_END') {
      summary = `⏹️ Kết thúc bài: "${details.title || 'Unknown'}"${details.wasSkip ? ' [Bị Skip]' : ''}`;
    } else if (action === 'VOICE_CONNECTION_READY') {
      summary = `🟢 Kết nối Voice sẵn sàng tại ${details.guild || 'Server'} (kênh: ${details.channelId || 'N/A'})`;
    } else if (action === 'VOICE_CONNECTION_DISCONNECTED') {
      summary = `🔌 Mất kết nối Voice tại ${details.guild || 'Server'} (Đang tự động khôi phục...)`;
    } else if (action === 'VOICE_CONNECTION_RECONNECTING') {
      summary = `🔄 Đang thử kết nối lại Voice tại ${details.guild || 'Server'}...`;
    } else if (action === 'VOICE_USER_JOIN') {
      summary = `👤 ${details.user || 'User'} vào phòng Voice (kênh: ${details.channelId || 'N/A'})`;
    } else if (action === 'VOICE_USER_LEAVE') {
      summary = `🚪 ${details.user || 'User'} rời phòng Voice (kênh: ${details.channelId || 'N/A'})`;
    } else if (action === 'VOICE_USER_MOVE') {
      summary = `🔀 ${details.user || 'User'} chuyển phòng: ${details.oldChannelId} ➔ ${details.newChannelId}`;
    } else if (action === 'SLASH_COMMAND') {
      summary = `⚡ ${details.user || 'User'} dùng lệnh: ${details.command || 'unknown'}`;
    } else if (action === 'SWITCH_TO_247_LOFI') {
      summary = `♾️ Chuyển sang chế độ Treo Lofi 24/7 nền: "${details.track || 'Lofi Instrumental'}"`;
    } else if (action === 'KEEPER_JOIN') {
      summary = `🛡️ [Keeper] Bot phụ vào giữ phòng (humans: ${details.humanCount || 0}, musicBot: ${details.hasMusicBot ? 'Có' : 'Không'})`;
    } else if (action === 'KEEPER_LEAVE') {
      summary = `👋 [Keeper] Bot phụ rời phòng (Đủ ${details.humanCount || 0} người + bot nhạc)`;
    } else if (action === 'DISCONNECT_NOTICE') {
      summary = `👋 Hết nhạc, bot rời phòng Voice`;
    } else {
      const cleanDetails = Object.entries(details)
        .filter(([k]) => !['guildId', 'channelId', 'guild', 'isLogMessage', 'avatar'].includes(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      summary = cleanDetails || action;
    }

    const line = `[${timeStr}] [${action}] ${summary}\n`;
    fs.promises.appendFile(EVENT_LOG_FILE, line, 'utf8').catch(() => {});
  } catch (err) {
    // Tránh gián đoạn bot
  }
}

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
function getActionInfo(action, details = {}, isEn = false) {
  const type = details.type || details.event || '';

  if (action === 'PLAY_ERROR' || action === 'PLAYER_ERROR' || action === 'STREAM_ERROR') {
    return {
      title: isEn ? '❌ Playback Error' : '❌ Lỗi Phát Nhạc (Playback Error)',
      color: 0xED4245,
      desc: details.error ? (isEn ? 'Error: **' + details.error + '**' : 'Lỗi: **' + details.error + '**') : (isEn ? 'Cannot play track' : 'Không thể phát bài hát')
    };
  }
  if (action === 'SYSTEM_ERROR' || action === 'CLIENT_ERROR') {
    return {
      title: isEn ? '🚨 System Error' : '🚨 Lỗi Hệ Thống (System Error)',
      color: 0xED4245,
      desc: details.error ? (isEn ? 'Error: **' + details.error + '**' : 'Lỗi: **' + details.error + '**') : (isEn ? 'System error' : 'Lỗi hệ thống')
    };
  }
  if (action === 'VOICE_CONNECTION_READY') {
    return {
      title: isEn ? '🔊 Voice Connected' : '🔊 Kết Nối Voice Sẵn Sàng (Voice Ready)',
      color: 0x57F287,
      desc: details.channelId ? (isEn ? 'Connected to <#' + details.channelId + '>' : 'Đã kết nối vào <#' + details.channelId + '>') : (isEn ? 'Voice connection ready' : 'Kết nối Voice đã sẵn sàng')
    };
  }
  if (action === 'VOICE_CONNECTION_DISCONNECTED') {
    return {
      title: isEn ? '🔌 Voice Disconnected' : '🔌 Mất Kết Nối Voice (Voice Disconnected)',
      color: 0xED4245,
      desc: isEn ? 'Bot disconnected from voice channel' : 'Bot bị mất kết nối với phòng Voice'
    };
  }
  if (action === 'VOICE_CONNECTION_RECONNECTING') {
    return {
      title: isEn ? '🔄 Voice Reconnecting' : '🔄 Đang Kết Nối Lại Voice (Voice Reconnecting)',
      color: 0xFEE75C,
      desc: isEn ? 'Bot is reconnecting to voice channel' : 'Bot đang tự động kết nối lại phòng Voice'
    };
  }
  
  if (action === 'VOICE_USER_JOIN') {
    return {
      title: isEn ? '🟢 Voice Join' : '🟢 Tham Gia Phòng Voice (Voice Join)',
      color: 0x57F287,
      desc: details.user ? (isEn ? '**' + details.user + '** joined voice' : '**' + details.user + '** đã vào phòng Voice') : (isEn ? 'User joined voice' : 'Người dùng vào phòng Voice')
    };
  }
  if (action === 'VOICE_USER_LEAVE') {
    return {
      title: isEn ? '🔴 Voice Leave' : '🔴 Rời Khỏi Phòng Voice (Voice Leave)',
      color: 0xED4245,
      desc: details.user ? (isEn ? '**' + details.user + '** left voice' : '**' + details.user + '** đã rời phòng Voice') : (isEn ? 'User left voice' : 'Người dùng rời phòng Voice')
    };
  }
  if (action === 'VOICE_USER_MOVE') {
    return {
      title: isEn ? '🔀 Voice Move' : '🔀 Chuyển Phòng Voice (Voice Move)',
      color: 0xFEE75C,
      desc: details.user ? (isEn ? '**' + details.user + '** moved voice channels' : '**' + details.user + '** đã chuyển phòng Voice') : (isEn ? 'User changed voice channel' : 'Người dùng đổi phòng Voice')
    };
  }
  if (action === 'VOICE_USER_STREAM') {
    return {
      title: isEn ? '📺 Screen Share' : '📺 Chia Sẻ Màn Hình / Stream (Screen Share)',
      color: 0x9B59B6,
      desc: details.status || (isEn ? 'Started screen share' : 'Bắt đầu chia sẻ màn hình')
    };
  }
  if (action === 'VOICE_USER_VIDEO') {
    return {
      title: isEn ? '📷 Webcam Video' : '📷 Camera Video (Webcam)',
      color: 0x3498DB,
      desc: details.status || (isEn ? 'Toggled camera video' : 'Bật/tắt camera video')
    };
  }
  if (action === 'VOICE_USER_MUTE_DEAF') {
    return {
      title: isEn ? '🎙️ Mic / Deafen Status' : '🎙️ Trạng Thái Mic / Tai Nghe',
      color: 0x7289DA,
      desc: details.status || (isEn ? 'Changed Mic / Deafen status' : 'Thay đổi trạng thái Mic / Tai nghe')
    };
  }
  if (action === 'MESSAGE_USER_SEND') {
    return {
      title: isEn ? '💬 Channel Message' : '💬 Tin Nhắn Trên Kênh (Channel Message)',
      color: 0x5865F2,
      desc: details.user ? (isEn ? 'Sender: **' + details.user + '**' : 'Người gửi: **' + details.user + '**') : (isEn ? 'New message' : 'Tin nhắn mới')
    };
  }
  if (action === 'MESSAGE_EDIT') {
    return {
      title: isEn ? '✏️ Message Edit' : '✏️ Sửa Tin Nhắn (Message Edit)',
      color: 0xFEE75C,
      desc: details.type ? (isEn ? 'Type: `' + details.type + '`' : 'Loại: `' + details.type + '`') : (isEn ? 'Edited channel message' : 'Đã chỉnh sửa tin nhắn trên kênh')
    };
  }
  if (action === 'MESSAGE_DELETE') {
    return {
      title: isEn ? '🗑️ Message Delete' : '🗑️ Xóa Tin Nhắn (Message Delete)',
      color: 0xED4245,
      desc: details.type ? (isEn ? 'Type: `' + details.type + '`' : 'Loại: `' + details.type + '`') : (isEn ? 'Deleted channel message' : 'Đã xóa tin nhắn trên kênh')
    };
  }
  if (action === 'MESSAGE_SEND' || action === 'MESSAGE_REPLY') {
    return {
      title: isEn ? '📤 Message Send' : '📤 Gửi Tin Nhắn (Message Send)',
      color: 0x57F287,
      desc: details.type ? (isEn ? 'Type: `' + details.type + '`' : 'Loại: `' + details.type + '`') : (isEn ? 'Bot sent notification' : 'Bot gửi phản hồi / thông báo')
    };
  }
  if (action === 'COMMAND_EXECUTE' || action === 'SLASH_COMMAND') {
    return {
      title: isEn ? '⚡ Command Executed' : '⚡ Thực Thi Lệnh (Command Execute)',
      color: 0x5865F2,
      desc: isEn ? 'Command: `' + (details.command || details.name || 'unknown') + '`' : 'Lệnh: `' + (details.command || details.name || 'unknown') + '`'
    };
  }
  if (action === 'VOICE_STATE_UPDATE') {
    return {
      title: isEn ? '🔊 Voice State Update' : '🔊 Thay Đổi Trạng Thái Voice (Voice State Update)',
      color: 0x9B59B6,
      desc: details.event ? (isEn ? 'Status: `' + details.event + '`' : 'Trạng thái: `' + details.event + '`') : (isEn ? 'Voice room state updated' : 'Thay đổi trạng thái phòng Voice')
    };
  }
  if (action === 'VOICE_STATUS_UPDATE' || action === 'VOICE_STATUS_CLEAR') {
    return {
      title: isEn ? '📡 Voice Channel Status' : '📡 Trạng Thái Kênh Voice (Channel Status)',
      color: 0x3498DB,
      desc: details.status ? (isEn ? 'Status: **' + details.status + '**' : 'Trạng thái: **' + details.status + '**') : (isEn ? 'Voice status updated' : 'Cập nhật trạng thái kênh Voice')
    };
  }
  if (action.startsWith('INTERACTION_') || action === 'MODAL_ADD_SONG') {
    return {
      title: isEn ? '🖱️ Button / Menu Interaction' : '🖱️ Tương Tác Nút / Menu (Interaction)',
      color: 0x3BA55D,
      desc: details.customId ? (isEn ? 'Button/Menu ID: `' + details.customId + '`' : 'Nút/Menu ID: `' + details.customId + '`') : (details.type || (isEn ? 'User interaction' : 'Tương tác người dùng'))
    };
  }
  if (action === 'WEB_PLAYER_ACTION' || action === 'WEB_ACTION') {
    return {
      title: isEn ? '🌐 Web Player Action' : '🌐 Thao Tác Từ Web Player',
      color: 0x00B0F4,
      desc: details.action ? (isEn ? 'Action: `' + details.action + '`' : 'Thao tác: `' + details.action + '`') : (isEn ? 'User controlled from Web Player' : 'Người dùng điều khiển từ giao diện Web')
    };
  }

  if (action === 'TRACK_START') {
    return {
      title: isEn ? '▶️ Track Started' : '▶️ Bắt Đầu Phát Nhạc (Track Start)',
      color: 0x57F287,
      desc: details.title ? (isEn ? 'Now playing: **' + details.title + '**' : 'Đang phát: **' + details.title + '**') : (isEn ? 'Track playback started' : 'Bắt đầu phát bài hát')
    };
  }
  if (action === 'TRACK_END') {
    return {
      title: isEn ? '⏹️ Track Ended' : '⏹️ Kết Thúc Bài Hát (Track End)',
      color: 0x95A5A6,
      desc: details.title ? (isEn ? 'Finished: **' + details.title + '**' + (details.wasSkip ? ' (Skipped)' : '') : 'Đã phát xong: **' + details.title + '**' + (details.wasSkip ? ' (Bị Skip)' : '')) : (isEn ? 'Track ended' : 'Kết thúc bài hát')
    };
  }
  if (action === 'SWITCH_TO_247_LOFI') {
    return {
      title: isEn ? '♾️ Switched to 24/7 Lofi Radio' : '♾️ Chuyển Sang Lofi 24/7 Nền',
      color: 0x3498DB,
      desc: details.track ? (isEn ? 'Background Lofi: **' + details.track + '**' : 'Treo Lofi nền: **' + details.track + '**') : (isEn ? 'Switched to background 24/7 Lofi' : 'Chuyển sang chế độ Treo Lofi nền')
    };
  }
  if (action === 'KEEPER_JOIN') {
    return {
      title: isEn ? '🛡️ [Voice Keeper] Keeper Bot Joined' : '🛡️ [Voice Keeper] Bot Phụ Vào Giữ Phòng',
      color: 0x57F287,
      desc: details.desc || (isEn ? 'Keeper bot joined voice to prevent timer reset' : 'Bot phụ đã vào giữ phòng để tránh reset thời gian')
    };
  }
  if (action === 'KEEPER_LEAVE') {
    return {
      title: isEn ? '👋 [Voice Keeper] Keeper Bot Left' : '👋 [Voice Keeper] Bot Phụ Rời Phòng (Nhường Chỗ)',
      color: 0xFEE75C,
      desc: details.desc || (isEn ? 'Voice channel safe (Music Bot + 2 or more listeners)' : 'Phòng đã an toàn (có Bot Nhạc + từ 2 người thật trở lên)')
    };
  }

  return {
    title: isEn ? '📋 Activity: ' + action : '📋 Hoạt Động: ' + action,
    color: 0x95A5A6,
    desc: type ? (isEn ? 'Details: `' + type + '`' : 'Chi tiết: `' + type + '`') : ''
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
        const adminId = config?.adminId || '875358286487097395';
        const messagePayload = {
          embeds: [item.embed]
        };

        if (item.isErrorAction) {
          messagePayload.content = `<@${adminId}>`;
          messagePayload.allowedMentions = { users: [adminId] };
          // Bỏ flags 4096 để Admin nhận ping thông báo khi có lỗi
        } else {
          messagePayload.flags = 4096;
          messagePayload.allowedMentions = { parse: [] };
        }

        await targetChannel.send(messagePayload).catch((sendErr) => {
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
 * Ghi 1 dòng log debug voi timestamp ISO hien tai, luu file log su kien sieu toc va ban vao Kenh Log Discord
 * @param {string} action  Tên hành động viết HOA (e.g. VOICE_USER_JOIN, MESSAGE_USER_SEND)
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
  
  // 1. Ghi vào file log sự kiện siêu tốc (logs/events.log)
  writeToEventLogFile(action, details);

  // 2. In ra console terminal
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

    // Phân loại sự kiện để định tuyến đến đúng kênh Log mong muốn
    const isErrorAction = action.includes('ERROR') || details.isError === true;
    const isRoomAction = action.startsWith('VOICE_');

    let targetChannelId = null;

    if (isErrorAction) {
      targetChannelId = guildSettings?.errorLogChannelId
        || config.errorLogChannelId
        || (guildId === '1389834422773219338' ? '1547449482835394640' : null)
        || guildSettings?.logChannelId;
    } else if (isRoomAction) {
      targetChannelId = guildSettings?.roomLogChannelId
        || (guildId === '1389834422773219338' ? '1543841691541180546' : null)
        || guildSettings?.logChannelId;
    } else {
      targetChannelId = guildSettings?.logChannelId;
    }

    if (!targetChannelId) return;

    // Không log lại tin nhắn được gửi trong chính kênh Log
    if (details.channelId === targetChannelId) return;

    const logChannel = discordClient.channels.cache.get(targetChannelId);

    const isEn = guildSettings?.language === 'en';
    const info = getActionInfo(action, details, isEn);
    const nowUnix = Math.floor(Date.now() / 1000);
    const timeFull = '<t:' + nowUnix + ':F> (<t:' + nowUnix + ':R>)';

    const embed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(info.title)
      .setTimestamp();

    if (details.avatar) {
      embed.setThumbnail(details.avatar);
    }

    let desc = '⏰ **' + (isEn ? 'Time' : 'Thời gian') + ':** ' + timeFull + '\n';
    desc += '📌 **' + (isEn ? 'Event' : 'Sự kiện') + ':** ' + info.desc + '\n\n';

    if (details.userId) {
      desc += '👤 **' + (isEn ? 'User' : 'Người dùng') + ':** <@' + details.userId + '> (`' + details.userId + '`)\n';
    } else if (details.user) {
      desc += '👤 **' + (isEn ? 'User' : 'Người dùng') + ':** ' + details.user + '\n';
    }

    if (details.oldChannelId && details.newChannelId) {
      desc += '🚪 **' + (isEn ? 'From channel' : 'Từ phòng') + ':** <#' + details.oldChannelId + '> ➔ **' + (isEn ? 'To channel' : 'Sang phòng') + ':** <#' + details.newChannelId + '>\n';
    } else if (details.channelId) {
      desc += '📁 **' + (isEn ? 'Channel' : 'Kênh / Phòng') + ':** <#' + details.channelId + '>\n';
    }

    if (details.command) {
      desc += '⚡ **' + (isEn ? 'Command' : 'Lệnh') + ':** `' + details.command + '`\n';
    }
    if (details.song) {
      desc += '🎵 **' + (isEn ? 'Song' : 'Bài hát') + ':** ' + details.song + '\n';
    }
    if (details.url && details.url !== 'N/A') {
      desc += '🔗 **' + (isEn ? 'Link' : 'Liên kết') + ':** ' + details.url + '\n';
    }
    if (details.error) {
      const cleanErr = String(details.error).slice(0, 500);
      desc += '⚠️ **' + (isEn ? 'Error details' : 'Chi tiết lỗi') + ':** ```' + cleanErr + '```\n';
    }
    if (details.is247 !== undefined) {
      const is247Text = details.is247
        ? (isEn ? 'Yes (Automatic background lofi)' : 'Có (Phát lofi nền tự động)')
        : (isEn ? 'No (Requested by user)' : 'Không (Người dùng yêu cầu)');
      desc += '♾️ **' + (isEn ? '24/7 Mode' : 'Chế độ 24/7') + ':** ' + is247Text + '\n';
    }
    if (details.content) {
      const cleanContent = String(details.content).slice(0, 500);
      desc += '📝 **' + (isEn ? 'Content' : 'Nội dung') + ':** ```' + cleanContent + '```\n';
    }
    if (details.attachments && details.attachments.length > 0) {
      desc += '📎 **' + (isEn ? 'Attachments' : 'Đính kèm') + ':** ' + details.attachments.join(', ') + '\n';
    }
    if (details.oldContent && details.newContent) {
      desc += '📝 **' + (isEn ? 'Old' : 'Cũ') + ':** `' + String(details.oldContent).slice(0, 150) + '`\n';
      desc += '📝 **' + (isEn ? 'New' : 'Mới') + ':** `' + String(details.newContent).slice(0, 150) + '`\n';
    }

    embed.setDescription(desc.trim());

    // Thêm vào hàng đợi gửi log an toàn
    if (logQueue.length >= 100) logQueue.shift();
    logQueue.push({
      logChannelId: targetChannelId,
      targetChannel: logChannel || null,
      embed,
      isErrorAction: Boolean(isErrorAction)
    });
    processLogQueue();

  } catch (err) {
    // Không crash bot nếu có lỗi gửi log
  }
}

module.exports = {
  initLogger,
  logAction,
  writeToEventLogFile,
  formatVietnamTime
};
