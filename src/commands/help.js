const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');

function createHelpMenu(activeTab = 'music', isAdmin = false) {
  const p = config.prefix || '.';

  const tabs = {
    music: {
      title: '🎵 Hướng Dẫn Lệnh Âm Nhạc',
      desc: [
        `**${p}play** (p) <tên/link> — Phát bài hát hoặc playlist (YouTube, Spotify, SoundCloud)`,
        `**${p}web** — Mở giao diện Web Player điều khiển âm nhạc trực quan`,
        `**${p}seek** (tua) <thời_gian> — Tua bài hát tới vị trí (vd: ${p}seek 1:30 hoặc ${p}seek +30)`,
        `**${p}pause** — Tạm dừng bài hát đang phát`,
        `**${p}resume** — Tiếp tục phát bài hát`,
        `**${p}skip** (s, next) — Bỏ qua bài hát hiện tại`,
        `**${p}stop** (st) — Dừng phát và dọn dẹp hàng chờ`,
        `**${p}join** (j) — Mời bot vào kênh đàm thoại Voice`,
        `**${p}leave** (dis) — Cho bot rời khỏi kênh Voice`,
        `**${p}lyrics** (ly) — Tìm và xem lời bài hát đồng bộ`,
        `**${p}fav** (like) — Xem và phát danh sách bài hát yêu thích cá nhân`
      ].join('\n'),
      footer: 'Lệnh phát nhạc, tìm kiếm và điều khiển cơ bản'
    },
    queue: {
      title: '📋 Hướng Dẫn Hàng Chờ (Queue)',
      desc: [
        `**${p}queue** (q) — Xem danh sách bài hát đang chờ phát`,
        `**${p}remove** (rm) <số> — Xóa bài hát khỏi hàng chờ (vd: ${p}remove 2)`,
        `**${p}shuffle** (sh) — Xáo trộn ngẫu nhiên thứ tự các bài trong hàng chờ`
      ].join('\n'),
      footer: 'Quản lý, sắp xếp và xóa bài hát trong hàng chờ'
    },
    controls: {
      title: '🎛️ Hướng Dẫn Điều Khiển (Controls)',
      desc: [
        `**${p}nowplaying** (np) — Xem thông tin bài đang phát & bảng nút điều khiển`,
        `**${p}loop** (l) — Bật/tắt chế độ lặp: Tắt ➔ Lặp bài ➔ Lặp hàng chờ`,
        `**${p}volume** (vol, v) <1-100> — Điều chỉnh âm lượng phát nhạc của bot`
      ].join('\n'),
      footer: 'Điều chỉnh âm lượng và chế độ lặp lại'
    },
    utility: {
      title: '⚙️ Tiện Ích (Utility)',
      desc: [
        `**${p}ping** — Kiểm tra độ trễ (latency) và trạng thái hoạt động của bot`,
        `**${p}feedback** (fb) — Gửi góp ý / báo lỗi trực tiếp tới nhà phát triển`,
        `**${p}help** (h) — Mở bảng hướng dẫn sử dụng lệnh này`
      ].join('\n'),
      footer: 'Tiện ích hệ thống và trợ giúp'
    }
  };

  // Tab đặc quyền chỉ dành riêng cho Quản trị viên
  if (isAdmin) {
    tabs.admin = {
      title: '👑 Bảng Lệnh Quản Trị Viên (Admin Controls)',
      desc: [
        `**${p}settings** (caidat, set) — Mở Menu Cài Đặt toàn diện bằng tương tác Dropdown`,
        `**${p}setlog** <#kênh / ID / off> — Cài đặt kênh ghi toàn bộ nhật ký bot`,
        `**${p}247** — Bật/tắt duy trì Voice và phát Lofi thư giãn 24/7`,
        `**${p}autoplay** (ap) — Bật/tắt tự động phát bài tương tự khi hết nhạc`,
        `**${p}crossfade** (cf) <0-10s> — Cài đặt thời gian hòa âm chuyển bài mượt mà`,
        `**${p}lockvoice** <#kênh / off> — Khóa phòng Voice cố định cho bot`,
        `**${p}setchannel** <#kênh / off> — Khóa kênh văn bản nhận lệnh bot`,
        `**${p}setdj** <@role / on / off> — Cài đặt vai trò DJ cho máy chủ`
      ].join('\n'),
      footer: 'Dành riêng cho Quản trị viên máy chủ • Bạn có toàn quyền quản trị'
    };
  }

  const current = tabs[activeTab] || tabs.music;

  const embed = new EmbedBuilder()
    .setTitle(current.title)
    .setDescription(current.desc)
    .setColor(activeTab === 'admin' ? '#2ecc71' : (config.embedColor || '#5865F2'))
    .setFooter({ text: current.footer });

  const buttons = [
    new ButtonBuilder()
      .setCustomId('help_tab_music')
      .setLabel('Âm Nhạc')
      .setStyle(activeTab === 'music' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_queue')
      .setLabel('Hàng Chờ')
      .setStyle(activeTab === 'queue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_controls')
      .setLabel('Điều Khiển')
      .setStyle(activeTab === 'controls' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_utility')
      .setLabel('Tiện Ích')
      .setStyle(activeTab === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ];

  // Chỉ hiển thị Nút Quản Trị nếu người dùng là Admin/Owner
  if (isAdmin) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('help_tab_admin')
        .setLabel('⚙️ Quản Trị')
        .setStyle(activeTab === 'admin' ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId('help_tab_close')
      .setEmoji({ id: '1542933956637233255', name: '007close' })
      .setStyle(ButtonStyle.Secondary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);

  return { embeds: [embed], components: [row] };
}

module.exports = {
  name: 'help',
  aliases: ['h', 'trogiup', 'commands', 'lenh'],
  description: 'Hiển thị danh sách lệnh của bot',
  createHelpMenu,
  async execute(message) {
    const isOwner = message.guild?.ownerId === message.author.id;
    const hasAdminPerm = message.member?.permissions?.has('Administrator') || message.member?.permissions?.has('ManageGuild');
    const isAdmin = Boolean(isOwner || hasAdminPerm);
    const payload = createHelpMenu('music', isAdmin);
    await message.reply(payload).catch(() => {});
  }
};
