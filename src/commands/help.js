const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');

function createHelpMenu(activeTab = 'music') {
  const p = config.prefix || '.';

  const tabs = {
    music: {
      title: '🎵 Hướng Dẫn Lệnh Âm Nhạc (Music)',
      desc: [
        `**${p}play** (p) - Phát bài hát hoặc danh sách từ YouTube, Spotify, SoundCloud`,
        `**${p}pause** - Tạm dừng bài hát đang phát`,
        `**${p}resume** - Tiếp tục phát bài hát đang tạm dừng`,
        `**${p}skip** (s, next) - Bỏ qua bài hát hiện tại`,
        `**${p}stop** (st, off) - Dừng phát nhạc và xóa hàng chờ`,
        `**${p}join** (j, thamgia) - Mời bot vào phòng Voice của bạn`,
        `**${p}disconnect** (leave, dis) - Ngắt kết nối và rời phòng Voice`,
        `**${p}lyrics** (ly, loibaihat) - Xem lời bài hát chuẩn xác từ Spotify`,
        `**${p}fav** (like) - Xem và phát danh sách bài hát yêu thích`
      ].join('\n'),
      footer: 'Quản lý phát nhạc cơ bản, tìm kiếm và thư viện bài hát yêu thích'
    },
    queue: {
      title: '🎵 Hướng Dẫn Hàng Chờ (Queue)',
      desc: [
        `**${p}queue** (q) - Xem danh sách bài hát đang chờ phát`,
        `**${p}remove** (rm, xoa) - Xóa bài hát khỏi hàng chờ theo số thứ tự (vd: ${p}remove 2)`,
        `**${p}shuffle** (sh, mix) - Xáo trộn ngẫu nhiên thứ tự hàng chờ`
      ].join('\n'),
      footer: 'Quản lý, sắp xếp và xóa các bài hát trong hàng chờ'
    },
    controls: {
      title: '🎵 Hướng Dẫn Bảng Điều Khiển (Controls)',
      desc: [
        `**${p}control** (c, np, panel) - Mở bảng điều khiển tương tác đầy đủ`,
        `**${p}loop** (l) - Bật/tắt lặp bài hát hoặc toàn bộ hàng chờ`,
        `**${p}volume** (vol, v) - Xem hoặc điều chỉnh âm lượng bot (1 - 100)`
      ].join('\n'),
      footer: 'Điều khiển trình phát nhạc, chỉnh âm lượng và chế độ lặp'
    },
    utility: {
      title: '🎵 Hướng Dẫn Tiện Ích & Cài Đặt (Utility)',
      desc: [
        `**${p}settings** (caidat, set) - Mở menu cài đặt hệ thống máy chủ`,
        `**${p}ping** (latency) - Kiểm tra độ trễ mạng của Bot tới Discord`,
        `**${p}247** - Bật/tắt chế độ trực tuyến trong Voice 24/7`,
        `**${p}autoplay** (ap) - Bật/tắt DJ AI tự động chọn bài tương tự`,
        `**${p}feedback** (fb, gopy) - Gửi ý kiến phản hồi tới ban phát triển`,
        `**${p}lockvoice** - Khóa kênh Voice cố định cho Bot`,
        `**${p}setchannel** - Khóa kênh văn bản nhận lệnh`,
        `**${p}setdj** - Cài đặt vai trò DJ cho máy chủ`,
        `**${p}help** (h) - Hiển thị menu hướng dẫn này`
      ].join('\n'),
      footer: 'Cấu hình cài đặt máy chủ, hỗ trợ và tiện ích hệ thống'
    }
  };

  const current = tabs[activeTab] || tabs.music;

  const embed = new EmbedBuilder()
    .setTitle(current.title)
    .setDescription(current.desc)
    .setColor('#5865F2')
    .setFooter({ text: current.footer });

  const row = new ActionRowBuilder().addComponents(
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
      .setStyle(activeTab === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_close')
      .setEmoji({ id: '1542933956637233255', name: '007close' })
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  name: 'help',
  aliases: ['h', 'trogiup', 'commands', 'lenh'],
  description: 'Hiển thị danh sách lệnh của bot với giao diện chuyển tab tinh gọn',
  createHelpMenu,
  async execute(message) {
    const payload = createHelpMenu('music');
    await message.reply(payload).catch(() => {});
  }
};
