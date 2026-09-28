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
  } catch (err) {
    console.warn('[StatusNotifier Alert Error]:', err.message);
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

  // 2. Cảnh báo khi mất kết nối Gateway Discord (chống spam tối đa 1 tin / 30s)
  client.on(Events.ShardDisconnect, async (event, shardId) => {
    const now = Date.now();
    if (now - lastDisconnectAlert < 30000) return;
    lastDisconnectAlert = now;

    const vnTime = getVietnamTime();
    await sendAdminDM(client, adminId, {
      title: `⚠️ [${botName}] Mất Kết Nối Gateway Discord`,
      color: 0xf39c12, // Orange
      fields: [
        { name: '⏰ Thời gian mất kết nối', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
        { name: '🔍 Mã lỗi / Lý do', value: `Code: \`${event?.code || 'N/A'}\` | ${event?.reason || 'Không rõ'}`, inline: false },
        { name: '🔄 Trạng thái', value: 'Bot đang tự động thử kết nối lại...', inline: false }
      ]
    });
  });

  // 3. Thông báo khi phục hồi phiên kết nối thành công (Shard Resume)
  client.on(Events.ShardResume, async (shardId, replayedEvents) => {
    const vnTime = getVietnamTime();
    await sendAdminDM(client, adminId, {
      title: `🔄 [${botName}] Đã Khôi Phục Kết Nối Gateway`,
      color: 0x3498db, // Blue
      fields: [
        { name: '⏰ Thời gian', value: `\`${vnTime}\` (Giờ VN)`, inline: true },
        { name: '⚡ Sự kiện tái hiện', value: `\`${replayedEvents}\` events`, inline: true }
      ]
    });
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
}

module.exports = {
  initStatusNotifier,
  sendAdminDM,
  getVietnamTime
};
