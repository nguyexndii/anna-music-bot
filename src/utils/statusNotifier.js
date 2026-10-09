const { EmbedBuilder, Events } = require('discord.js');

/**
 * Lấy thời gian định dạng chuẩn Việt Nam (Asia/Ho_Chi_Minh)
 */
function getVietnamTime() {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

/**
 * Định dạng số giây sang dạng ngày, giờ, phút, giây
 */
function formatDuration(seconds) {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor((seconds / 3600) % 24);
  const d = Math.floor(seconds / 86400);
  const parts = [];
  if (d > 0) parts.push(`${d} ngày`);
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  parts.push(`${s} giây`);
  return parts.length > 0 ? parts.join(' ') : '0 giây';
}

/**
 * Gửi tin nhắn Embed DM an toàn tới User ID của Admin
 */
async function sendAdminDM(client, adminId, { title, description, color, fields }) {
  if (!client || !adminId) return;
  try {
    const user = await client.users.fetch(adminId).catch(() => null);
    if (!user) {
      console.warn(`[StatusNotifier] Không thể tìm thấy Discord User ID ${adminId}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || null)
      .setColor(color)
      .setTimestamp(new Date());

    if (fields && Array.isArray(fields) && fields.length > 0) {
      embed.addFields(fields);
    }

    await user.send({ embeds: [embed] }).catch((dmErr) => {
      console.warn(`[StatusNotifier] Không thể gửi DM tới ${adminId} (Có thể người dùng chặn DM từ server):`, dmErr.message);
    });
    console.log(`[StatusNotifier] Đã gửi thành công tin nhắn DM ("${title}") tới Admin ID ${adminId}`);
  } catch (err) {
    console.warn('[StatusNotifier Alert Error]:', err.message);
  }
}

const ytdlp = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');

let lastCookieAlertTime = 0;
const COOKIE_ALERT_COOLDOWN = 6 * 60 * 60 * 1000; // 6 tiếng chống spam DM

/**
 * Gửi cảnh báo DM khi phát hiện Cookie YouTube bị hết hạn hoặc không khả dụng
 */
async function notifyCookieExpired(client, adminId, reason = 'Cookie không hợp lệ hoặc đã bị Google thu hồi') {
  const now = Date.now();
  if (now - lastCookieAlertTime < COOKIE_ALERT_COOLDOWN) {
    return;
  }
  lastCookieAlertTime = now;

  const vnTime = getVietnamTime();
  const cleanReason = String(reason || 'Phiên đăng nhập đã hết hạn').slice(0, 300);

  await sendAdminDM(client, adminId, {
    title: '🍪 [Anna Music Bot] Cảnh Báo: Cookie YouTube Đã Hết Hạn!',
    color: 0xe67e22, // Cam cảnh báo
    description: 'Hệ thống kiểm tra phát hiện file **Cookie YouTube** trên VPS đã hết hạn hoặc bị Google chặn đăng nhập.',
    fields: [
      { name: '⏰ Thời gian phát hiện', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
      { name: '⚠️ Chi tiết lỗi', value: `\`\`\`${cleanReason}\`\`\``, inline: false },
      { name: '💡 Ảnh hưởng', value: 'Tính năng YouTube Mix, gợi ý bài hát cá nhân hóa và một số bài YouTube có thể bị chậm hoặc không phát được.', inline: false },
      { name: '🛠️ Hướng dẫn cập nhật', value: '1. Mở trình duyệt chứa tài khoản clone.\n2. Dùng tiện ích xuất file cookie mới (đuôi `.txt`).\n3. Upload đè file cookie mới lên VPS (`/root/anna-music-bot/youtube.cookies`) và restart bot.', inline: false }
    ]
  });
}

/**
 * Kiểm tra thực tế xem cookie YouTube trên VPS có còn hợp lệ hay không
 */
async function checkYouTubeCookieHealth(client, adminId) {
  const cookiePath = process.env.YTDLP_COOKIES_FILE || '/root/anna-music-bot/youtube.cookies';
  if (!fs.existsSync(cookiePath)) {
    console.warn(`[Cookie Checker] Không tìm thấy file cookie tại: ${cookiePath}`);
    await notifyCookieExpired(client, adminId, `Không tìm thấy file cookie tại đường dẫn: ${cookiePath}`);
    return false;
  }

  try {
    const res = await ytdlp('https://www.youtube.com/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk', {
      dumpSingleJson: true,
      flatPlaylist: true,
      playlistEnd: 2,
      cookies: cookiePath,
      extractorArgs: 'youtube:player_client=android,mweb',
      noWarnings: true
    });

    if (res && res.entries && res.entries.length > 0) {
      console.log(`[Cookie Checker] Cookie YouTube đang hoạt động tốt (${res.entries.length} items verified)`);
      return true;
    } else {
      throw new Error('YouTube Mix không trả về danh sách bài hát (Có thể cookie bị chặn)');
    }
  } catch (err) {
    const errMsg = err.message || String(err);
    console.warn('[Cookie Checker Warning]: Cookie YouTube kiểm tra thất bại:', errMsg);

    // Kiểm tra các dấu hiệu cookie bị chết / hết hạn
    const isCookieIssue = /sign in to confirm|confirm you're not a bot|this content isn't available|login|cookies|expired|private video|429/i.test(errMsg);
    if (isCookieIssue) {
      await notifyCookieExpired(client, adminId, errMsg);
    }
    return false;
  }
}

/**
 * Khởi tạo bộ giám sát trạng thái và tự động thông báo qua DM
 * @param {import('discord.js').Client} client 
 * @param {Object} options 
 * @param {string} options.adminId ID tài khoản nhận DM
 * @param {string} options.botName Tên định danh của bot
 * @param {string} options.platform Nền tảng hosting (vd: VPS Ubuntu, Discloud)
 */
function initStatusNotifier(client, options = {}) {
  const {
    adminId = '875358286487097395',
    botName = 'Anna Music Bot',
    platform = 'VPS Ubuntu (PM2)'
  } = options;

  let isShuttingDown = false;
  let lastDisconnectAlert = 0;
  let disconnectTime = 0; // Biến lưu thời gian bắt đầu rớt mạng

  // 1. Khi Bot đã sẵn sàng và Online
  client.once(Events.ClientReady, async () => {
    // Đợi 2 giây để các kết nối ổn định và ping sẵn sàng
    setTimeout(async () => {
      try {
        const vnTime = getVietnamTime();
        const ping = client.ws?.ping != null ? `${client.ws.ping}ms` : 'Đang đo...';
        const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const guildCount = client.guilds?.cache?.size || 0;

        await sendAdminDM(client, adminId, {
          title: `🟢 [${botName}] Đã Online Trở Lại`,
          color: 0x2ecc71, // Green
          fields: [
            { name: '⏰ Thời gian', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
            { name: '⚡ Ping Gateway', value: `\`${ping}\``, inline: true },
            { name: '🖥️ Nền tảng', value: `\`${platform}\``, inline: true },
            { name: '💾 RAM', value: `\`${memMB} MB\``, inline: true },
            { name: '🌐 Máy chủ', value: `\`${guildCount} servers\``, inline: true },
            { name: '📋 Trạng thái', value: 'Sẵn sàng phục vụ 24/7!', inline: false }
          ]
        });
      } catch (e) {
        console.warn('[StatusNotifier Ready Alert Error]:', e.message);
      }
    }, 2000);
  });

  // 2. Ghi nhận khi mất kết nối Gateway
  client.on(Events.ShardDisconnect, async (event, shardId) => {
    disconnectTime = Date.now();
    // Ẩn việc gửi DM ngay lúc này để tránh spam rớt mạng lặt vặt.
    // Nếu rớt thật thì hàm bên dưới (ShardResume) sẽ báo kèm tổng thời gian sập.
  });

  // 3. Thông báo khi phục hồi phiên kết nối thành công (Shard Resume)
  client.on(Events.ShardResume, async (shardId, replayedEvents) => {
    const now = Date.now();
    const downtimeMs = disconnectTime > 0 ? (now - disconnectTime) : 0;
    
    // BỘ LỌC CHỐNG SPAM: Nếu rớt mạng dưới 15 giây (mạng chớp nháy/bảo trì siêu tốc), bỏ qua.
    if (downtimeMs < 15000) {
      console.log(`[StatusNotifier] Đã bỏ qua 1 tin nhắn spam rớt mạng (${Math.round(downtimeMs/1000)}s)`);
      return; 
    }

    const vnTime = getVietnamTime();
    const downtimeStr = formatDuration(downtimeMs / 1000);
    
    await sendAdminDM(client, adminId, {
      title: `🔄 [${botName}] Đã Khôi Phục Kết Nối Gateway`,
      color: 0x3498db, // Blue
      description: `Hệ thống vừa bị gián đoạn mạng và đã tự động kết nối lại.`,
      fields: [
        { name: '⏰ Khôi phục lúc', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
        { name: '⏳ Tổng thời gian sập', value: `\`${downtimeStr}\``, inline: true }
      ]
    });
    disconnectTime = 0; // Reset
  });

  // 4. Xử lý Shutdown / Tắt Bot / Restart (SIGINT, SIGTERM)
  const handleShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[StatusNotifier] Nhận tín hiệu ${signal}, đang gửi thông báo DM ngắt kết nối...`);

    const vnTime = getVietnamTime();
    const uptimeStr = formatDuration(process.uptime());

    const sendPromise = sendAdminDM(client, adminId, {
      title: `🔴 [${botName}] Đang Tắt / Ngoại Tuyến (Shutdown)`,
      color: 0xe74c3c, // Red
      fields: [
        { name: '⏰ Thời gian out', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
        { name: '⏱️ Thời gian đã chạy (Uptime)', value: `\`${uptimeStr}\``, inline: true },
        { name: '🛑 Lý do', value: `Tín hiệu dừng hệ điều hành (\`${signal}\`)`, inline: false },
        { name: '🖥️ Nền tảng', value: `\`${platform}\``, inline: true }
      ]
    });

    // Chờ tối đa 2.5s để gửi DM xong trước khi tiến trình tắt hoàn toàn
    await Promise.race([
      sendPromise,
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]).catch(() => {});

    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // 5. Cảnh báo khi gặp ngoại lệ nghiêm trọng (Crash)
  process.on('uncaughtException', async (err) => {
    if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
    console.error('[Uncaught Exception]', err);

    const vnTime = getVietnamTime();
    const errMsg = (err.message || String(err)).slice(0, 500);

    const sendPromise = sendAdminDM(client, adminId, {
      title: `💥 [${botName}] Gặp Lỗi Nghiêm Trọng (Crash)`,
      color: 0xe74c3c,
      fields: [
        { name: '⏰ Thời gian xảy ra', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
        { name: '❌ Chi tiết lỗi', value: `\`\`\`${errMsg}\`\`\``, inline: false },
        { name: '🖥️ Nền tảng', value: `\`${platform}\``, inline: true }
      ]
    });

    await Promise.race([
      sendPromise,
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]).catch(() => {});
  });

  // 6. Lập lịch tự động kiểm tra sức khỏe Cookie YouTube
  // Kiểm tra lần đầu sau 15 giây khi bot đã ổn định
  setTimeout(() => {
    checkYouTubeCookieHealth(client, adminId).catch(() => {});
  }, 15000);

  // Kiểm tra định kỳ mỗi 6 giờ
  setInterval(() => {
    checkYouTubeCookieHealth(client, adminId).catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

module.exports = {
  initStatusNotifier,
  sendAdminDM,
  getVietnamTime,
  checkYouTubeCookieHealth,
  notifyCookieExpired
};
