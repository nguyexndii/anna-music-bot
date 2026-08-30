const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Routes
} = require('discord.js');
const config = require('../config');
const { logAction } = require('./debugLogger');

/**
 * Định dạng mili-giây sang chuỗi Phút:Giây (MM:SS)
 */
function formatDurationMs(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Chuyển chuỗi thời lượng (vd: "4:18" hoặc "1:02:30") sang mili-giây
 */
function parseDurationToMs(durationStr) {
  if (!durationStr || durationStr === 'Live Stream' || durationStr.includes('Live')) {
    return 0;
  }
  const parts = durationStr.split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  } else if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  } else if (parts.length === 1) {
    return parts[0] * 1000;
  }
  return 0;
}

/**
 * Tạo thanh tiến trình âm nhạc mượt mà: `0:45 ━━━━🔘───────── 4:18`
 */
function createProgressBar(currentMs, totalMs, size = 12) {
  const currentFormatted = formatDurationMs(currentMs || 0);
  if (!totalMs || totalMs <= 0) {
    return `\`${currentFormatted}\` 🔘${'─'.repeat(size)} \`0:00\``;
  }

  const totalFormatted = formatDurationMs(totalMs);
  const progress = Math.min(1, Math.max(0, currentMs / totalMs));
  const progressIndex = Math.round(progress * size);

  const before = '━'.repeat(progressIndex);
  const after = '─'.repeat(Math.max(0, size - progressIndex));
  const bar = `${before}🔘${after}`;

  return `\`${currentFormatted}\` ${bar} \`${totalFormatted}\``;
}

function createEmbed(title, description, color = config.embedColor) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: 'Anna Music 24/7' })
    .setTimestamp();
}

function createSuccessEmbed(description) {
  return new EmbedBuilder()
    .setDescription(`${EMOJI_TAG.correct} ${description}`)
    .setColor(config.successColor || '#2ecc71');
}

function createErrorEmbed(description) {
  return new EmbedBuilder()
    .setDescription(`${EMOJI_TAG.warning} ${description}`)
    .setColor(config.errorColor || '#e74c3c');
}

function createWarningEmbed(description) {
  return new EmbedBuilder()
    .setDescription(`${EMOJI_TAG.warning} ${description}`)
    .setColor(config.warningColor || '#f1c40f');
}

const CUSTOM_EMOJIS = {
  heart: { id: '1542933944729735268', name: 'heart' },
  pause: { id: '1542933948768854136', name: 'videopausebutton' },
  play: { id: '1542933942729187388', name: 'playbuttonarrowhead' },
  skip: { id: '1542933937062551572', name: 'next' },
  loop: { id: '1542933954795937833', name: 'loop' },
  close: { id: '1542933956637233255', name: 'close' },
  list: { id: '1542933934701158513', name: 'list' },
  settings: { id: '1542933960638734396', name: 'settings' },
  add: { id: '1542933930565443624', name: 'add' },
  infinity: { id: '1542933933023432744', name: 'infinity' },
  trash: { id: '1542933946570903634', name: 'trash' },
  volume: { id: '1542933950874259586', name: 'volumehigh' },
  ai: { id: '1542933952841515048', name: 'ai' },
  padlock: { id: '1542933958667280424', name: 'padlock' },
  correct: { id: '1543130996319330324', name: 'correct' },
  warning: { id: '1543131000912089190', name: 'warning' },
  arrow: { id: '1543130999053881395', name: 'arrow' },
  signal: { id: '1543131003248185374', name: 'signal' }
};

const EMOJI_TAG = {
  heart: '<:heart:1542933944729735268>',
  pause: '<:videopausebutton:1542933948768854136>',
  play: '<:playbuttonarrowhead:1542933942729187388>',
  skip: '<:next:1542933937062551572>',
  loop: '<:loop:1542933954795937833>',
  close: '<:close:1542933956637233255>',
  list: '<:list:1542933934701158513>',
  settings: '<:settings:1542933960638734396>',
  add: '<:add:1542933930565443624>',
  infinity: '<:infinity:1542933933023432744>',
  trash: '<:trash:1542933946570903634>',
  volume: '<:volumehigh:1542933950874259586>',
  ai: '<:ai:1542933952841515048>',
  padlock: '<:padlock:1542933958667280424>',
  correct: '<:correct:1543130996319330324>',
  warning: '<:warning:1543131000912089190>',
  arrow: '<:arrow:1543130999053881395>',
  signal: '<:signal:1543131003248185374>'
};

/**
 * Giao diện Banner bài đang phát siêu tinh gọn (Dùng đúng Custom Emoji của bạn)
 */
function createNowPlayingBanner(song, queue) {
  const is247Mode = song?.requestedBy === 'Auto (24/7)';
  const songTitle = is247Mode ? `${EMOJI_TAG.infinity} Nhạc nền Lofi 24/7` : (song?.title || 'Đang phát nhạc');

  const content = `Now playing: **${songTitle}**`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_open_controls')
      .setLabel('Mở bảng điều khiển')
      .setEmoji(CUSTOM_EMOJIS.settings)
      .setStyle(ButtonStyle.Secondary)
  );

  return { content, components: [row] };
}

/**
 * Thông báo thêm bài hát vào hàng chờ tinh gọn (Dùng Custom Emoji)
 */
function createQueueAddedEmbed(song, position = 1) {
  return new EmbedBuilder()
    .setDescription(`${EMOJI_TAG.list} **Queued** \`${song.title}\` \`(${song.duration})\`\n| **Position ${position}**`)
    .setColor('#5865F2');
}

/**
 * Giao diện Embed bài đang phát tinh gọn & hiện đại
 */
function createNowPlayingEmbed(song, queue) {
  const botAvatar = queue.guild?.client?.user?.displayAvatarURL({ dynamic: true });
  const is247Mode = song.requestedBy === 'Auto (24/7)';
  const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');

  // ♾️ GIAO DIỆN RIÊNG KHI Ở CHẾ ĐỘ 24/7
  if (is247Mode) {
    const statusLabel = queue.paused ? 'Tạm dừng' : 'Phát nhạc nền';

    return new EmbedBuilder()
      .setAuthor({ name: 'Anna Music • 24/7 Mode', iconURL: botAvatar })
      .setTitle(`${EMOJI_TAG.infinity} Chế độ 24/7 đang hoạt động`)
      .setDescription(`Nhấn nút ${EMOJI_TAG.add} bên dưới hoặc dùng lệnh \`.p <tên bài>\` để yêu cầu bài hát bạn muốn nghe!`)
      .setColor('#5865F2')
      .addFields(
        {
          name: 'Âm lượng',
          value: `\`${queue.volume}%\``,
          inline: true
        },
        {
          name: 'Chế độ 24/7',
          value: '`Bật`',
          inline: true
        },
        {
          name: 'Trạng thái',
          value: `\`${statusLabel}\``,
          inline: true
        }
      )
      .setFooter({ text: `Dùng ${config.prefix}caidat để mở cài đặt • ${config.prefix}h để xem lệnh` })
      .setTimestamp();
  }

  // 🎵 GIAO DIỆN KHI PHÁT BÀI HÁT CỦA NGƯỜI DÙNG / AUTOPLAY BÌNH THƯỜNG
  const currentMs = queue.currentResource?.playbackDuration || 0;
  const totalMs = parseDurationToMs(song.duration);
  const currentTime = formatDurationMs(currentMs);
  const totalTime = song.duration || '0:00';
  const progressBar = createProgressBar(currentMs, totalMs, 18);

  const requester = song.requestedBy ? (typeof song.requestedBy === 'object' ? `<@${song.requestedBy.id}>` : `${song.requestedBy}`) : 'Tự động';
  const voiceChannelText = queue.voiceChannel ? `<#${queue.voiceChannel.id}>` : '';
  const loopStatusText = queue.loopMode === 'song' ? ` • ${EMOJI_TAG.loop} Lặp bài` : queue.loopMode === 'queue' ? ` • ${EMOJI_TAG.loop} Lặp danh sách` : '';

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Now playing', iconURL: botAvatar })
    .setTitle(song.title)
    .setURL(song.url || 'https://discord.com')
    .setColor('#2B2D31')
    .setDescription(
      `${EMOJI_TAG.add} ${requester} • ${voiceChannelText}${loopStatusText}\n\n` +
      `\`${currentTime} / ${totalTime}\`\n` +
      `${progressBar}`
    );

  if (song.thumbnail) {
    embed.setThumbnail(song.thumbnail);
  }

  return embed;
}

/**
 * Dàn nút bấm điều khiển nhạc (1 hàng 5 nút nguyên khối liền mạch phong cách Rythm / Loa Phường)
 */
function createMusicControls(queue) {
  const isLooping = queue.loopMode && queue.loopMode !== 'off';

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_favorite')
      .setEmoji(CUSTOM_EMOJIS.heart)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_pause')
      .setEmoji(queue.paused ? CUSTOM_EMOJIS.play : CUSTOM_EMOJIS.pause)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_skip')
      .setEmoji(CUSTOM_EMOJIS.skip)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_loop')
      .setEmoji(CUSTOM_EMOJIS.loop)
      .setStyle(isLooping ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_stop')
      .setEmoji(CUSTOM_EMOJIS.close)
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_add_song')
      .setEmoji(CUSTOM_EMOJIS.add)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_queue')
      .setEmoji(CUSTOM_EMOJIS.list)
      .setStyle(ButtonStyle.Secondary)
  );

  return [row, row2];
}

/**
 * Giao diện Xem hàng chờ chi tiết (Đã lọc bỏ bài hát ngầm / tự động)
 */
function createQueueEmbed(queue) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI_TAG.list} Hàng Chờ Âm Nhạc — ${queue.guild.name}`)
    .setColor('#5865F2')
    .setTimestamp();

  const is247 = queue.currentSong?.requestedBy === 'Auto (24/7)';
  const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');

  if (is247) {
    embed.addFields({
      name: `${EMOJI_TAG.play} Đang phát hiện tại:`,
      value: `\`${EMOJI_TAG.infinity} Nhạc nền Lofi 24/7 (Thư giãn)\``,
      inline: false
    });
  } else if (queue.currentSong) {
    embed.addFields({
      name: `${EMOJI_TAG.play} Đang phát hiện tại:`,
      value: `[**${queue.currentSong.title}**](${queue.currentSong.url}) | \`${queue.currentSong.duration}\``,
      inline: false
    });
  }

  if (userSongs.length === 0) {
    if (is247) {
      embed.setDescription(`Hàng chờ trống! Đang phát nhạc nền 24/7. Nhấn nút **${EMOJI_TAG.add}** hoặc dùng \`.p <tên_bài>\` để thêm nhạc.`);
    } else {
      embed.setDescription(`Hàng chờ hiện đang trống! Nhấn nút **${EMOJI_TAG.add}** hoặc gõ \`.p <tên_bài>\` để thêm bài hát yêu thích.`);
    }
    embed.setFooter({ text: 'Anna Music Queue • 0 bài trong hàng chờ' });
  } else {
    const listSlice = userSongs.slice(0, 15);
    let desc = `**Danh sách bài hát sắp phát (${userSongs.length} bài):**\n`;
    listSlice.forEach((s, idx) => {
      const req = s.requestedBy ? `• ${s.requestedBy}` : '';
      desc += `\`${idx + 1}.\` [${s.title.slice(0, 55)}](${s.url}) | \`${s.duration}\` ${req}\n`;
    });

    if (userSongs.length > 15) {
      desc += `\n*...và còn **${userSongs.length - 15} bài hát** khác nữa.*`;
    }

    embed.setDescription(desc);
    embed.setFooter({ text: `Chọn bài trong Menu Dropdown bên dưới để XÓA KHỎI HÀNG CHỜ • Hoặc gõ .remove <số>` });
  }

  return embed;
}

/**
 * Menu Dropdown để xóa bài hát khỏi hàng chờ (Chỉ hiển thị bài do người dùng thêm)
 */
function createQueueDeleteSelectMenu(queue) {
  if (!queue) return null;
  const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');
  if (userSongs.length === 0) return null;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_queue_remove')
    .setPlaceholder('🗑️ Chọn một bài để xóa hoặc Xóa toàn bộ hàng chờ...');

  // 1. Tùy chọn Xóa tất cả hàng chờ
  selectMenu.addOptions(
    new StringSelectMenuOptionBuilder()
      .setLabel('Xóa toàn bộ hàng chờ')
      .setDescription(`Xóa sạch toàn bộ ${userSongs.length} bài hát trong danh sách chờ`)
      .setValue('remove_all')
      .setEmoji(CUSTOM_EMOJIS.trash)
  );

  // 2. Từng bài hát cụ thể (Tối đa 24 bài tiếp theo)
  const optionsSlice = userSongs.slice(0, 24);
  optionsSlice.forEach((song, idx) => {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${idx + 1}. ${song.title.slice(0, 80)}`)
        .setDescription(`Thời lượng: ${song.duration} • Nhấn để xóa bài này`)
        .setValue(`remove_${idx}`)
        .setEmoji(CUSTOM_EMOJIS.trash)
    );
  });

  return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Bảng điều khiển cài đặt toàn bộ bằng tiếng Việt
 */
function createSettingsEmbed(guild, settings) {
  const mode247Text = settings.mode247 ? '`Bật`' : '`Tắt`';
  const autoplayText = settings.autoplay ? '`Bật`' : '`Tắt`';
  const voiceLockText = settings.lockedVoiceChannelId ? `<#${settings.lockedVoiceChannelId}>` : '`Mọi phòng`';
  const textLockText = settings.musicChannelId ? `<#${settings.musicChannelId}>` : '`Mọi kênh`';
  const djText = settings.djOnly
    ? (settings.djRoleId ? `<@&${settings.djRoleId}> (\`Bật\`)` : '`Bật (Cần Role DJ)`')
    : '`Tắt (Mọi người)`';
  const crossfadeText = settings.crossfadeDuration > 0 ? `\`${settings.crossfadeDuration} giây\`` : '`Tắt (0s)`';
  const timeoutText = settings.mode247 ? '`Vô hiệu hóa (24/7 Bật)`' : `\`${settings.emptyChannelTimeout || 60} giây\``;
  const volumeText = `\`${settings.defaultVolume}%\``;
  const loopText = settings.loopMode === 'song' ? '`Lặp bài hát`' : settings.loopMode === 'queue' ? '`Lặp hàng chờ`' : '`Tắt`';
  const announceText = settings.announceSongs ? '`Bật`' : '`Tắt`';

  const aiText = settings.useAiAssistant !== false ? '`Bật`' : '`Tắt`';

  const embed = new EmbedBuilder()
    .setTitle(`Bảng Cài Đặt Âm Nhạc — ${guild.name}`)
    .setDescription('Chọn một mục từ danh sách **Dropdown** bên dưới để thay đổi cài đặt nhanh chóng:')
    .setColor('#5865F2')
    .addFields(
      {
        name: 'Chế độ Auto (Tự động phát nhạc)',
        value: `Cài đặt hiện tại: ${aiText}`,
        inline: true
      },
      {
        name: 'Chế độ 24/7 (Luôn trực tuyến)',
        value: `Cài đặt hiện tại: ${mode247Text}`,
        inline: true
      },
      {
        name: 'Tự động phát tương tự (Autoplay)',
        value: `Cài đặt hiện tại: ${autoplayText}`,
        inline: true
      },
      {
        name: 'Khóa phòng Voice cố định',
        value: `Cài đặt hiện tại: ${voiceLockText}`,
        inline: true
      },
      {
        name: 'Khóa kênh lệnh chat',
        value: `Cài đặt hiện tại: ${textLockText}`,
        inline: true
      },
      {
        name: 'Chế độ DJ (Cần Role mới phát được)',
        value: `Cài đặt hiện tại: ${djText}`,
        inline: true
      },
      {
        name: 'Hòa âm chuyển bài (Crossfade)',
        value: `Cài đặt hiện tại: ${crossfadeText}`,
        inline: true
      },
      {
        name: 'Tự rời khi phòng trống',
        value: `Cài đặt hiện tại: ${timeoutText}`,
        inline: true
      },
      {
        name: 'Âm lượng mặc định',
        value: `Cài đặt hiện tại: ${volumeText}`,
        inline: true
      },
      {
        name: 'Chế độ lặp lại',
        value: `Cài đặt hiện tại: ${loopText}`,
        inline: true
      },
      {
        name: 'Thông báo bài hát',
        value: `Cài đặt hiện tại: ${announceText}`,
        inline: true
      },
      {
        name: 'Khôi phục mặc định',
        value: 'Đặt lại toàn bộ cài đặt gốc',
        inline: true
      }
    )
    .setFooter({ text: 'Anna Music Settings • Thay đổi áp dụng ngay lập tức' })
    .setTimestamp();

  return embed;
}

/**
 * Menu Dropdown chọn cài đặt bằng 100% tiếng Việt
 */
function createSettingsSelectMenu(settings) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_settings')
    .setPlaceholder('Chọn một cài đặt bên dưới để thay đổi...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Chế độ Auto (Tự động phát nhạc)')
        .setDescription(`Tự động tìm và nối tiếp bài hát cùng vibe (Hiện tại: ${settings.useAiAssistant !== false ? 'BẬT' : 'TẮT'})`)
        .setValue('set_ai')
        .setEmoji(CUSTOM_EMOJIS.ai),
      new StringSelectMenuOptionBuilder()
        .setLabel('Chế độ 24/7 (Luôn trực tuyến)')
        .setDescription(`Bật/Tắt giữ bot ở phòng Voice (Hiện tại: ${settings.mode247 ? 'BẬT' : 'TẮT'})`)
        .setValue('set_247')
        .setEmoji(CUSTOM_EMOJIS.infinity),
      new StringSelectMenuOptionBuilder()
        .setLabel('Tự động phát tương tự (Autoplay)')
        .setDescription(`Tự động tìm bài tương tự khi hết nhạc (Hiện tại: ${settings.autoplay ? 'BẬT' : 'TẮT'})`)
        .setValue('set_autoplay')
        .setEmoji(CUSTOM_EMOJIS.play),
      new StringSelectMenuOptionBuilder()
        .setLabel('Khóa phòng Voice cố định')
        .setDescription(`Chỉ phát nhạc tại phòng voice chỉ định (Hiện tại: ${settings.lockedVoiceChannelId ? 'ĐÃ KHÓA' : 'MỌI PHÒNG'})`)
        .setValue('set_voice_lock')
        .setEmoji(CUSTOM_EMOJIS.padlock),
      new StringSelectMenuOptionBuilder()
        .setLabel('Khóa kênh văn bản dùng lệnh')
        .setDescription(`Chỉ nhận lệnh tại kênh chat chỉ định (Hiện tại: ${settings.musicChannelId ? 'ĐÃ KHÓA' : 'MỌI KÊNH'})`)
        .setValue('set_channel_lock')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Chế độ DJ (Cần Role mới phát được)')
        .setDescription(`Chỉ người có vai trò DJ mới dùng được lệnh (Hiện tại: ${settings.djOnly ? 'BẬT' : 'TẮT'})`)
        .setValue('set_dj_only')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hòa âm chuyển bài (Crossfade)')
        .setDescription(`Hiệu ứng mượt mà khi đổi bài (Hiện tại: ${settings.crossfadeDuration}s)`)
        .setValue('set_crossfade')
        .setEmoji(CUSTOM_EMOJIS.loop),
      new StringSelectMenuOptionBuilder()
        .setLabel('Thời gian tự rời khi phòng trống')
        .setDescription(`Số giây chờ trước khi out nếu không có ai (Hiện tại: ${settings.emptyChannelTimeout || 60}s)`)
        .setValue('set_timeout')
        .setEmoji(CUSTOM_EMOJIS.close),
      new StringSelectMenuOptionBuilder()
        .setLabel('Âm lượng mặc định')
        .setDescription(`Chuyển đổi âm lượng 30% / 50% / 80% / 100% (Hiện tại: ${settings.defaultVolume}%)`)
        .setValue('set_volume')
        .setEmoji(CUSTOM_EMOJIS.volume),
      new StringSelectMenuOptionBuilder()
        .setLabel('Chế độ lặp lại')
        .setDescription(`Tắt / Lặp bài hát / Lặp hàng chờ (Hiện tại: ${settings.loopMode})`)
        .setValue('set_loop')
        .setEmoji(CUSTOM_EMOJIS.loop),
      new StringSelectMenuOptionBuilder()
        .setLabel('Thông báo bài hát')
        .setDescription(`Gửi Embed thông báo khi chuyển bài (Hiện tại: ${settings.announceSongs ? 'BẬT' : 'TẮT'})`)
        .setValue('set_announce')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Khôi phục mặc định')
        .setDescription('Đặt lại toàn bộ cài đặt gốc')
        .setValue('set_reset')
        .setEmoji(CUSTOM_EMOJIS.trash)
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);
  return row;
}

const _lastVoiceStatus = new Map();

/**
 * Cập nhật trạng thái Voice Channel (Voice Channel Status - hiển thị tên bài đang phát trên phòng voice)
 */
async function setVoiceChannelStatus(voiceChannel, statusText) {
  if (!voiceChannel || !voiceChannel.id || !voiceChannel.client?.rest) return;
  const cleanText = (statusText || '').slice(0, 500);
  if (_lastVoiceStatus.get(voiceChannel.id) === cleanText) return;
  _lastVoiceStatus.set(voiceChannel.id, cleanText);
  try {
    await voiceChannel.client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
      body: { status: cleanText }
    });
  } catch (err) {
    // Bỏ qua nếu bot thiếu quyền hoặc server chưa mở tính năng
  }
}

/**
 * Xóa trạng thái Voice Channel khi bot rời phòng hoặc hết nhạc
 */
async function clearVoiceChannelStatus(voiceChannel) {
  if (!voiceChannel || !voiceChannel.id || !voiceChannel.client?.rest) return;
  if (!_lastVoiceStatus.get(voiceChannel.id)) return;
  _lastVoiceStatus.delete(voiceChannel.id);
  try {
    await voiceChannel.client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
      body: { status: '' }
    });
  } catch (err) {
    // Bỏ qua
  }
}

module.exports = {
  CUSTOM_EMOJIS,
  EMOJI_TAG,
  createEmbed,
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createNowPlayingBanner,
  createQueueAddedEmbed,
  createNowPlayingEmbed,
  createMusicControls,
  createQueueEmbed,
  createQueueDeleteSelectMenu,
  createSettingsEmbed,
  createSettingsSelectMenu,
  createProgressBar,
  formatDurationMs,
  parseDurationToMs,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
};
