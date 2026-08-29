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
      title: '🎵 Hướng Dẫn Lệnh Âm Nhạc',
      desc: [
        `**${p}play** (p) - Phát bài hát hoặc danh sách phát (YouTube, Spotify, SoundCloud)`,
        `**${p}web** - Mở giao diện Web Player điều khiển âm nhạc`,
        `**${p}seek** (tua) - Tua bài hát tới vị trí thời gian (vd: ${p}seek 1:30 hoặc ${p}seek +30)`,
        `**${p}pause** - Tạm dừng bài hát đang phát`,
        `**${p}resume** - Tiếp tục phát bài hát`,
        `**${p}skip** (s, next) - Bỏ qua bài hát hiện tại`,
        `**${p}stop** (st) - Dừng phát và xóa hàng chờ`,
        `**${p}join** (j) - Mời bot vào kênh Voice`,
        `**${p}leave** (dis) - Rời khỏi kênh Voice`,
        `**${p}lyrics** (ly) - Xem lời bài hát`,
        `**${p}fav** (like) - Xem và phát danh sách bài hát yêu thích`
      ].join('\n'),
      footer: 'Lệnh phát nhạc, tìm kiếm và điều khiển cơ bản'
    },
    queue: {
      title: '📋 Hướng Dẫn Hàng Chờ (Queue)',
      desc: [
        `**${p}queue** (q) - Xem danh sách bài hát trong hàng chờ`,
        `**${p}remove** (rm) - Xóa bài hát khỏi hàng chờ (vd: ${p}remove 2)`,
        `**${p}shuffle** (sh) - Xáo trộn thứ tự bài hát trong hàng chờ`
      ].join('\n'),
      footer: 'Quản lý, sắp xếp và xóa bài hát trong hàng chờ'
    },
    controls: {
      title: '🎛️ Hướng Dẫn Điều Khiển (Controls)',
      desc: [
        `**${p}nowplaying** (np) - Xem thông tin và bảng điều khiển bài hát đang phát`,
        `**${p}loop** (l) - Bật/tắt chế độ lặp bài hát hoặc toàn bộ hàng chờ`,
        `**${p}volume** (vol, v) - Điều chỉnh âm lượng phát nhạc (1 - 100)`,
        `**${p}crossfade** (cf) - Bật/tắt hiệu ứng chuyển mượt giữa các bài`
      ].join('\n'),
      footer: 'Điều chỉnh âm lượng, chế độ lặp và hiệu ứng âm thanh'
    },
    utility: {
      title: '⚙️ Tiện Ích & Cài Đặt (Utility)',
      desc: [
        `**${p}settings** (caidat) - Mở bảng cài đặt máy chủ`,
        `**${p}247** - Bật/tắt chế độ trực tuyến trong Voice 24/7 (Admin)`,
        `**${p}autoplay** (ap) - Bật/tắt tự động phát bài tiếp theo (Admin)`,
        `**${p}lockvoice** - Khóa kênh Voice cố định (Admin)`,
        `**${p}setchannel** - Khóa kênh văn bản nhận lệnh (Admin)`,
        `**${p}setdj** - Cài đặt vai trò DJ cho máy chủ (Admin)`,
        `**${p}ping** - Kiểm tra độ trễ của bot`,
        `**${p}feedback** (fb) - Gửi góp ý tới nhà phát triển`,
        `**${p}help** (h) - Hiển thị bảng hướng dẫn này`
      ].join('\n'),
      footer: 'Cấu hình cài đặt máy chủ và tiện ích hệ thống'
    }
  };

  const current = tabs[activeTab] || tabs.music;

  const embed = new EmbedBuilder()
    .setTitle(current.title)
    .setDescription(current.desc)
    .setColor(config.embedColor || '#5865F2')
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
  description: 'Hiển thị danh sách lệnh của bot',
  createHelpMenu,
  async execute(message) {
    const payload = createHelpMenu('music');
    await message.reply(payload).catch(() => {});
  }
};
