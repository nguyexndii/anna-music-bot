const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { createContext } = require('../utils/commandHelper');
const config = require('../config');

function createHelpMenu(activeTab = 'music', isAdmin = false) {
  const tabs = {
    music: {
      title: '🎵 Hướng Dẫn Lệnh Âm Nhạc • Music Commands',
      desc: [
        `**/play** (hoặc **/p**) \`[tên/link]\` — Phát bài hát hoặc Playlist (YouTube, Spotify, SoundCloud)`,
        `**/web** — Mở Web UI điều khiển âm nhạc trực quan, tìm kiếm & quản lý hàng chờ`,
        `**/seek** \`<thời_gian>\` — Tua bài hát đến thời điểm (vd: \`/seek 1:30\` hoặc \`/seek 90\`)`,
        `**/pause** — Tạm dừng bài hát đang phát`,
        `**/resume** — Tiếp tục phát bài hát đang tạm dừng`,
        `**/skip** (hoặc **/s**) — Bỏ qua bài hát hiện tại`,
        `**/stop** — Dừng phát nhạc và dọn dẹp hàng chờ`,
        `**/lyrics** (hoặc **/ly**) \`[tên_bài]\` — Xem lời bài hát đồng bộ (để trống để tự lấy bài đang phát)`,
        `**/favorite** (hoặc **/fav**) — Quản lý & phát danh sách bài hát yêu thích cá nhân`,
        `**/join** — Mời bot tham gia kênh thoại của bạn`,
        `**/leave** — Cho bot rời khỏi kênh thoại`
      ].join('\n'),
      footer: '💡 Mẹo: Bạn có thể dùng lệnh tắt nhanh như /p, /s, /q, /np, /vol, /fav, /ly, /mv, /h'
    },
    queue: {
      title: '📋 Hướng Dẫn Hàng Chờ • Queue Commands',
      desc: [
        `**/queue** (hoặc **/q**) \`[trang]\` — Xem danh sách bài chờ (hỗ trợ nút chuyển trang & menu xóa bài)`,
        `**/move** (hoặc **/mv**) \`<từ_vị_trí> [đến_vị_trí]\` — Đổi vị trí bài hát (mặc định đưa lên vị trí 1 để phát kế tiếp)`,
        `**/remove** \`<vị_trí>\` — Xóa bài hát ra khỏi hàng chờ theo số thứ tự`,
        `**/shuffle** — Xáo trộn ngẫu nhiên thứ tự các bài trong hàng chờ`
      ].join('\n'),
      footer: 'Quản lý, sắp xếp và xóa bài hát trong hàng chờ'
    },
    controls: {
      title: '🎛️ Hướng Dẫn Điều Khiển • Audio Controls',
      desc: [
        `**/nowplaying** (hoặc **/np**) — Xem bài đang phát & bảng nút điều khiển tương tác`,
        `**/volume** (hoặc **/vol**) \`[1-100]\` — Điều chỉnh âm lượng phát nhạc của bot (1-100%)`,
        `**/loop** \`[chế_độ]\` — Đổi chế độ lặp: Tắt ➔ Lặp bài hiện tại ➔ Lặp hàng chờ`,
        `**/crossfade** \`[giây: 0-10]\` — Bật hiệu ứng hòa âm fade in mượt mà khi chuyển bài`,
        `**/autoplay** \`[on/off]\` — Tự động tìm và phát bài tương tự khi hết nhạc`
      ].join('\n'),
      footer: 'Điều chỉnh âm lượng, chế độ lặp và hiệu ứng chuyển bài'
    },
    utility: {
      title: '⚙️ Tiện Ích • Utility Commands',
      desc: [
        `**/ping** — Kiểm tra độ trễ (latency) và trạng thái hoạt động của bot`,
        `**/feedback** \`<nội_dung>\` — Gửi góp ý / báo lỗi trực tiếp tới nhà phát triển`,
        `**/help** (hoặc **/h**) — Mở bảng hướng dẫn sử dụng toàn diện này`
      ].join('\n'),
      footer: 'Tiện ích hệ thống và trợ giúp'
    }
  };

  if (isAdmin) {
    tabs.admin = {
      title: '👑 Bảng Lệnh Quản Trị Viên (Admin Controls)',
      desc: [
        `**/settings** — Mở Menu Cài Đặt toàn diện bằng tương tác Dropdown`,
        `**/247** \`[status:On/Off]\` — Bật/tắt duy trì Voice và phát Lofi thư giãn 24/7`,
        `**/lockvoice** \`[channel] [reset]\` — Khóa phòng Voice cố định cho bot`,
        `**/setchannel** \`[channel] [reset]\` — Khóa kênh văn bản nhận lệnh bot`,
        `**/setlog** \`[channel] [reset]\` — Cài đặt kênh ghi toàn bộ nhật ký hoạt động`,
        `**/setdj** \`[role] [mode]\` — Cài đặt vai trò DJ cho máy chủ`
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

  const row1 = new ActionRowBuilder().addComponents(
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
  );

  const row2Buttons = [];
  if (isAdmin) {
    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId('help_tab_admin')
        .setLabel('⚙️ Quản Trị')
        .setStyle(activeTab === 'admin' ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }

  row2Buttons.push(
    new ButtonBuilder()
      .setCustomId('help_tab_close')
      .setEmoji({ id: '1542933956637233255', name: '007close' })
      .setStyle(ButtonStyle.Secondary)
  );

  const components = [row1, new ActionRowBuilder().addComponents(row2Buttons)];
  return { embeds: [embed], components };
}

module.exports = {
  name: 'help',
  aliases: ['h', 'trogiup', 'commands', 'lenh'],
  description: 'Display bot command list and usage guide',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display bot command list and usage guide')
    .setDescriptionLocalizations({
      vi: 'Xem danh sách và hướng dẫn sử dụng các lệnh của bot'
    }),
  createHelpMenu,
  async execute(source, args) {
    const ctx = createContext(source, args);
    const isOwner = ctx.guild?.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member?.permissions?.has('Administrator') || ctx.member?.permissions?.has('ManageGuild');
    const isAdmin = Boolean(isOwner || hasAdminPerm);
    const payload = createHelpMenu('music', isAdmin);
    return ctx.reply(payload);
  }
};
