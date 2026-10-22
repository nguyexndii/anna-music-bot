const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { createContext } = require('../utils/commandHelper');
const { CUSTOM_EMOJIS, EMOJI_TAG } = require('../utils/embed');
const settingsManager = require('../structures/SettingsManager');
const config = require('../config');

function createHelpMenu(activeTab = 'music', isAdmin = false, isEn = false) {
  const tabs = {
    music: {
      title: isEn
        ? `${EMOJI_TAG.musicNotesDouble} Music Commands Guide`
        : `${EMOJI_TAG.musicNotesDouble} Hướng Dẫn Lệnh Âm Nhạc • Music Commands`,
      desc: isEn ? [
        `**/play** (or **/p**) \`[title/link]\` — Play track or playlist (YouTube, Spotify, SoundCloud)`,
        `**/web** — Open Web UI to control playback, search & manage queue`,
        `**/pause** — Pause currently playing song`,
        `**/resume** — Resume paused song`,
        `**/skip** (or **/s**, **/fs**) — Skip current song (supports Vote Skip & Force Skip)`,
        `**/stop** — Stop music playback and clear queue`,
        `**/lyrics** (or **/ly**) \`[song]\` — Display synchronized lyrics`,
        `**/like** (or **/fav**) — Manage and play personal liked songs`,
        `**/join** — Invite bot to your current voice channel`,
        `**/leave** — Disconnect bot from voice channel`
      ].join('\n') : [
        `**/play** (hoặc **/p**) \`[tên/link]\` — Phát bài hát hoặc Playlist (YouTube, Spotify, SoundCloud)`,
        `**/web** — Mở Web UI điều khiển âm nhạc trực quan, tìm kiếm & quản lý hàng chờ`,
        `**/pause** — Tạm dừng bài hát đang phát`,
        `**/resume** — Tiếp tục phát bài hát đang tạm dừng`,
        `**/skip** (hoặc **/s**, **/fs**) — Bỏ qua bài hát hiện tại (hỗ trợ Force Skip nhanh)`,
        `**/stop** — Dừng phát nhạc và dọn dẹp hàng chờ`,
        `**/lyrics** (hoặc **/ly**) \`[tên_bài]\` — Xem lời bài hát đồng bộ (để trống để tự lấy bài đang phát)`,
        `**/like** (hoặc **/fav**) — Quản lý & phát danh sách bài hát yêu thích cá nhân`,
        `**/join** — Mời bot tham gia kênh thoại của bạn`,
        `**/leave** — Cho bot rời khỏi kênh thoại`
      ].join('\n'),
      footer: isEn
        ? '💡 Tip: Short aliases like /p, /s, /fs, /q, /np, /vol, /fav, /ly, /mv, /h are supported!'
        : '💡 Mẹo: Bạn có thể dùng lệnh tắt nhanh như /p, /s, /fs, /q, /np, /vol, /fav, /ly, /mv, /h'
    },
    queue: {
      title: isEn
        ? `${EMOJI_TAG.queue} Queue Commands Guide`
        : `${EMOJI_TAG.queue} Hướng Dẫn Hàng Chờ • Queue Commands`,
      desc: isEn ? [
        `**/queue** (or **/q**) \`[page]\` — View queue list with interactive page buttons & remove menu`,
        `**/move** (or **/mv**) \`<from> [to]\` — Move track to a new position (default: 1 - play next)`,
        `**/remove** \`<position>\` — Remove a song from the queue by its index number`,
        `**/shuffle** — Randomly shuffle the tracks in queue`
      ].join('\n') : [
        `**/queue** (hoặc **/q**) \`[trang]\` — Xem danh sách bài chờ (hỗ trợ nút chuyển trang & menu xóa bài)`,
        `**/move** (hoặc **/mv**) \`<từ_vị_trí> [đến_vị_trí]\` — Đổi vị trí bài hát (mặc định đưa lên vị trí 1 để phát kế tiếp)`,
        `**/remove** \`<vị_trí>\` — Xóa bài hát ra khỏi hàng chờ theo số thứ tự`,
        `**/shuffle** — Xáo trộn ngẫu nhiên thứ tự các bài trong hàng chờ`
      ].join('\n'),
      footer: isEn ? 'Manage, reorder and remove songs from the queue' : 'Quản lý, sắp xếp và xóa bài hát trong hàng chờ'
    },
    controls: {
      title: isEn
        ? `${EMOJI_TAG.equalizer} Audio Controls Guide`
        : `${EMOJI_TAG.equalizer} Hướng Dẫn Điều Khiển • Audio Controls`,
      desc: isEn ? [
        `**/nowplaying** (or **/np**) — View current song info & interactive control buttons`,
        `**/volume** (or **/vol**) \`[1-100]\` — Adjust playback volume (1-100%)`,
        `**/loop** \`[mode]\` — Loop mode: Off ➔ Current Song ➔ Entire Queue`,
        `**/autoplay** \`[on/off]\` — Autoplay similar tracks when queue ends`
      ].join('\n') : [
        `**/nowplaying** (hoặc **/np**) — Xem bài đang phát & bảng nút điều khiển tương tác`,
        `**/volume** (hoặc **/vol**) \`[1-100]\` — Điều chỉnh âm lượng phát nhạc của bot (1-100%)`,
        `**/loop** \`[chế_độ]\` — Đổi chế độ lặp: Tắt ➔ Lặp bài hiện tại ➔ Lặp hàng chờ`,
        `**/autoplay** \`[on/off]\` — Tự động tìm và phát bài tương tự khi hết nhạc`
      ].join('\n'),
      footer: isEn ? 'Control volume, loop modes and autoplay' : 'Điều chỉnh âm lượng, chế độ lặp và tự động phát'
    },
    utility: {
      title: isEn
        ? `${EMOJI_TAG.settings} Utility Commands`
        : `${EMOJI_TAG.settings} Tiện Ích • Utility Commands`,
      desc: isEn ? [
        `**/ping** — Check bot network latency and status`,
        `**/feedback** \`<message>\` — Send feedback or bug reports to developers`,
        `**/help** (or **/h**) — Open this comprehensive guide`
      ].join('\n') : [
        `**/ping** — Kiểm tra độ trễ (latency) và trạng thái hoạt động của bot`,
        `**/feedback** \`<nội_dung>\` — Gửi góp ý / báo lỗi trực tiếp tới nhà phát triển`,
        `**/help** (hoặc **/h**) — Mở bảng hướng dẫn sử dụng toàn diện này`
      ].join('\n'),
      footer: isEn ? 'Bot utilities and help' : 'Tiện ích hệ thống và trợ giúp'
    }
  };

  if (isAdmin) {
    tabs.admin = {
      title: isEn
        ? `${EMOJI_TAG.padlock} Administrator Controls Guide`
        : `${EMOJI_TAG.padlock} Bảng Lệnh Quản Trị Viên (Admin Controls)`,
      desc: isEn ? [
        `**/settings** — Open interactive Server Settings panel via Dropdown`,
        `**/247** \`[status:On/Off]\` — Toggle 24/7 voice stay & relaxing Lofi radio`,
        `**/lockvoice** \`[channel] [reset]\` — Lock bot to a fixed voice channel`,
        `**/setchannel** \`[channel] [reset]\` — Restrict bot commands to a specific text channel`,
        `**/setlog** \`[channel] [reset]\` — Configure dedicated activity & voice log channel`,
        `**/setdj** \`[role] [mode]\` — Configure DJ role and DJ-only mode`
      ].join('\n') : [
        `**/settings** — Mở Menu Cài Đặt toàn diện bằng tương tác Dropdown`,
        `**/247** \`[status:On/Off]\` — Bật/tắt duy trì Voice và phát Lofi thư giãn 24/7`,
        `**/lockvoice** \`[channel] [reset]\` — Khóa phòng Voice cố định cho bot`,
        `**/setchannel** \`[channel] [reset]\` — Khóa kênh văn bản nhận lệnh bot`,
        `**/setlog** \`[channel] [reset]\` — Cài đặt kênh ghi toàn bộ nhật ký hoạt động`,
        `**/setdj** \`[role] [mode]\` — Cài đặt vai trò DJ cho máy chủ`
      ].join('\n'),
      footer: isEn
        ? 'Server Administrators only • Full administrative control'
        : 'Dành riêng cho Quản trị viên máy chủ • Bạn có toàn quyền quản trị'
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
      .setLabel(isEn ? 'Music' : 'Âm Nhạc')
      .setStyle(activeTab === 'music' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_queue')
      .setLabel(isEn ? 'Queue' : 'Hàng Chờ')
      .setStyle(activeTab === 'queue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_controls')
      .setLabel(isEn ? 'Controls' : 'Điều Khiển')
      .setStyle(activeTab === 'controls' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_tab_utility')
      .setLabel(isEn ? 'Utility' : 'Tiện Ích')
      .setStyle(activeTab === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  if (isAdmin) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId('help_tab_admin')
        .setLabel(isEn ? '⚙️ Admin' : '⚙️ Quản Trị')
        .setStyle(activeTab === 'admin' ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }

  const components = [row1];
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
    const isEn = ctx.guild?.id && settingsManager.get(ctx.guild.id)?.language === 'en';
    const payload = createHelpMenu('music', isAdmin, isEn);
    if (ctx.isInteraction) {
      payload.flags = 64;
    }
    return ctx.reply(payload);
  }
};
