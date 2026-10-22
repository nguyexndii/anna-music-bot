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
 * ============================================================================
 * 1. BỘ 40 CUSTOM EMOJI PHONG CÁCH FROSTED GLASS (NEUMORPHIC TRANSLUCENT WHITE)
 * ============================================================================
 */
const CUSTOM_EMOJIS = {
  // --- Nhóm Hệ thống & Tiện ích ---
  add: { id: '1562002814358781952', name: 'anna_add' },
  settings: { id: '1562002811477168188', name: 'anna_settings' },
  web: { id: '1562002809468092487', name: 'anna_web' },
  padlock: { id: '1562002807715008512', name: 'anna_padlock' },
  correct: { id: '1562002805571584041', name: 'anna_correct' },
  warning: { id: '1562002803097083964', name: 'anna_warning' },
  signal: { id: '1562002800773177464', name: 'anna_signal' },
  ai: { id: '1562002798495801376', name: 'anna_ai' },

  // --- Nhóm Điều khiển Phát nhạc (Playback Controls) ---
  pauseCircle: { id: '1562002796138725426', name: 'anna_pause_circle' },
  stopCircle: { id: '1562002793416630312', name: 'anna_stop_circle' },
  playCircle: { id: '1562002730220781589', name: 'anna_play_circle' },
  play: { id: '1562002791247908904', name: 'anna_play' },
  pause: { id: '1562002789100691486', name: 'anna_pause' },
  stop: { id: '1562002786919391283', name: 'anna_stop' },
  skip: { id: '1562002785107583007', name: 'anna_skip' },
  back: { id: '1562002783232860160', name: 'anna_back' },
  previous: { id: '1562002783232860160', name: 'anna_back' },
  forward10s: { id: '1562002781190103110', name: 'anna_forward_10s' },
  rewind10s: { id: '1562002779193479198', name: 'anna_rewind_10s' },

  // --- Nhóm Chế độ Phát & Âm lượng (Modes & Volume) ---
  loop: { id: '1562002777373151293', name: 'anna_loop' },
  loopOne: { id: '1562002775490170931', name: 'anna_loop_one' },
  shuffle: { id: '1562002773669838878', name: 'anna_shuffle' },
  autoplay: { id: '1562002771610308699', name: 'anna_autoplay' },
  volumeHigh: { id: '1562002769324413048', name: 'anna_volume_high' },
  volumeLow: { id: '1562002766757503086', name: 'anna_volume_low' },
  volumeMute: { id: '1562002764781977620', name: 'anna_volume_mute' },

  // --- Nhóm Danh sách, Lời bài hát & Tương tác ---
  queue: { id: '1562002762827300955', name: 'anna_queue' },
  playlist: { id: '1562002760436809828', name: 'anna_playlist' },
  lyrics: { id: '1562002758037409842', name: 'anna_lyrics' },
  searchLyrics: { id: '1562002755734741093', name: 'anna_search_lyrics' },
  musicNote: { id: '1562002753537052723', name: 'anna_music_note' },
  musicNotesDouble: { id: '1562002751074861086', name: 'anna_music_notes_double' },
  heart: { id: '1562002749099479090', name: 'anna_heart' },
  like: { id: '1562002746939412493', name: 'anna_like' },
  dislike: { id: '1562002745030869042', name: 'anna_dislike' },
  star: { id: '1562002742917075014', name: 'anna_star' },
  trash: { id: '1562002740903673927', name: 'anna_trash' },
  disconnect: { id: '1562002738475307008', name: 'anna_disconnect' },
  equalizer: { id: '1562002736256516157', name: 'anna_equalizer' },
  radio: { id: '1562002734214029332', name: 'anna_radio' },
  search: { id: '1562002732284645498', name: 'anna_search' },

  // --- Nhóm Live Synced Lyrics (Frosted Glass mới) ---
  micActive: { id: '1562334273497997432', name: 'anna_mic_active' },
  lyricNext: { id: '1562334338593325147', name: 'anna_lyric_next' },
  dotNext: { id: '1562334476644646923', name: 'anna_dot_next' },
  radioButton: { id: '1562668699217952798', name: 'anna_radio_btn' },

  // --- Bí danh (Aliases) tương thích ngược ---
  close: { id: '1562002793416630312', name: 'anna_stop_circle' },
  list: { id: '1562002762827300955', name: 'anna_queue' },
  infinity: { id: '1562002771610308699', name: 'anna_autoplay' },
  volume: { id: '1562002769324413048', name: 'anna_volume_high' },
  arrow: { id: '1562002773669838878', name: 'anna_shuffle' }
};

const EMOJI_TAG = {
  add: '<:anna_add:1562002814358781952>',
  settings: '<:anna_settings:1562002811477168188>',
  web: '<:anna_web:1562002809468092487>',
  padlock: '<:anna_padlock:1562002807715008512>',
  correct: '<:anna_correct:1562002805571584041>',
  warning: '<:anna_warning:1562002803097083964>',
  signal: '<:anna_signal:1562002800773177464>',
  ai: '<:anna_ai:1562002798495801376>',
  pauseCircle: '<:anna_pause_circle:1562002796138725426>',
  stopCircle: '<:anna_stop_circle:1562002793416630312>',
  playCircle: '<:anna_play_circle:1562002730220781589>',
  play: '<:anna_play:1562002791247908904>',
  pause: '<:anna_pause:1562002789100691486>',
  stop: '<:anna_stop:1562002786919391283>',
  skip: '<:anna_skip:1562002785107583007>',
  back: '<:anna_back:1562002783232860160>',
  previous: '<:anna_back:1562002783232860160>',
  forward10s: '<:anna_forward_10s:1562002781190103110>',
  rewind10s: '<:anna_rewind_10s:1562002779193479198>',
  loop: '<:anna_loop:1562002777373151293>',
  loopOne: '<:anna_loop_one:1562002775490170931>',
  shuffle: '<:anna_shuffle:1562002773669838878>',
  autoplay: '<:anna_autoplay:1562002771610308699>',
  volumeHigh: '<:anna_volume_high:1562002769324413048>',
  volumeLow: '<:anna_volume_low:1562002766757503086>',
  volumeMute: '<:anna_volume_mute:1562002764781977620>',
  queue: '<:anna_queue:1562002762827300955>',
  playlist: '<:anna_playlist:1562002760436809828>',
  lyrics: '<:anna_lyrics:1562002758037409842>',
  searchLyrics: '<:anna_search_lyrics:1562002755734741093>',
  musicNote: '<:anna_music_note:1562002753537052723>',
  musicNotesDouble: '<:anna_music_notes_double:1562002751074861086>',
  heart: '<:anna_heart:1562002749099479090>',
  like: '<:anna_like:1562002746939412493>',
  dislike: '<:anna_dislike:1562002745030869042>',
  star: '<:anna_star:1562002742917075014>',
  trash: '<:anna_trash:1562002740903673927>',
  disconnect: '<:anna_disconnect:1562002738475307008>',
  equalizer: '<:anna_equalizer:1562002736256516157>',
  radio: '<:anna_radio:1562002734214029332>',
  search: '<:anna_search:1562002732284645498>',

  micActive: '<:anna_mic_active:1562334273497997432>',
  lyricNext: '<:anna_lyric_next:1562334338593325147>',
  dotNext: '<:anna_dot_next:1562334476644646923>',
  radioButton: '<:anna_radio_btn:1562668699217952798>',

  close: '<:anna_stop_circle:1562002793416630312>',
  list: '<:anna_queue:1562002762827300955>',
  infinity: '<:anna_autoplay:1562002771610308699>',
  volume: '<:anna_volume_high:1562002769324413048>',
  arrow: '<:anna_shuffle:1562002773669838878>'
};

/**
 * Định dạng mili-giây sang chuỗi Phút:Giây (MM:SS)
 */
function formatDurationMs(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Chuyển chuỗi thời lượng (vd: "4:18" hoặc "1:02:30") sang mili-giây
 */
function parseDurationToMs(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 0;
  if (durationStr.toLowerCase().includes('live')) return 0;
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
 * Chuẩn hóa tên bài hát an toàn cho Markdown
 */
function formatMarkdownTitle(title, maxLength = 58) {
  if (!title) return 'Bài hát không tên';
  let clean = String(title)
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/`/g, "'")
    .trim();
  if (!clean) return 'Bài hát không tên';
  if (maxLength && clean.length > maxLength) {
    clean = clean.slice(0, maxLength).trim() + '...';
  }
  return clean;
}

/**
 * Tạo thanh tiến trình âm nhạc liền mạch chuẩn Bản 2: `2:48 ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬🔘 2:48`
 * Đối với chế độ Lofi 24/7 hoặc luồng Live vô hạn: hiển thị `LIVE` 🔘▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ `∞`
 */
/**
 * Kiểm tra nhất quán xem bài hát hoặc queue có đang ở chế độ Đài Radio Lofi 24/7 hay không
 */
function is247Track(song, queue) {
  if (song?.is247) return true;
  if (song?.requestedBy === 'Auto (24/7)' || song?.requestedBy === 'Auto (24/7 Lofi)') return true;
  if (typeof song?.requestedBy === 'string' && song.requestedBy.includes('24/7')) return true;
  if (typeof queue?.isCurrentSongLofi === 'function' && queue.isCurrentSongLofi()) return true;
  if (queue?.mode247) {
    if (!song) return true;
    if (song.is247) return true;
    if (!song.requestedById && (!song.requestedBy || song.requestedBy === 'Auto' || song.requestedBy === 'Auto (24/7)')) {
      return true;
    }
  }
  return false;
}

function createProgressBar(currentMs, totalMs, size = 15, is247Mode = false) {
  if (is247Mode) {
    return `\`LIVE\` ${EMOJI_TAG.radioButton || '<:anna_radio_btn:1562668699217952798>'}▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ \`∞\``;
  }

  const currentFormatted = formatDurationMs(currentMs || 0);
  if (!totalMs || totalMs <= 0) {
    return `\`LIVE\` ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬${EMOJI_TAG.radioButton || '<:anna_radio_btn:1562668699217952798>'} \`∞\``;
  }

  const clampedCurrent = Math.min(totalMs, Math.max(0, currentMs || 0));
  const totalFormatted = formatDurationMs(totalMs);
  const progressRatio = totalMs > 0 ? clampedCurrent / totalMs : 0;
  const progressIndex = Math.min(size, Math.max(0, Math.round(progressRatio * size)));

  const before = '▬'.repeat(progressIndex);
  const after = '▬'.repeat(Math.max(0, size - progressIndex));
  const bar = `${before}${EMOJI_TAG.radioButton || '<:anna_radio_btn:1562668699217952798>'}${after}`;

  return `\`${currentFormatted}\` ${bar} \`${totalFormatted}\``;
}

function getVolumeEmojiTag(volume = 80) {
  const vol = Number(volume) || 0;
  if (vol <= 0) return EMOJI_TAG.volumeMute;
  if (vol < 50) return EMOJI_TAG.volumeLow;
  return EMOJI_TAG.volumeHigh;
}

function getVolumeCustomEmoji(volume = 80) {
  const vol = Number(volume) || 0;
  if (vol <= 0) return CUSTOM_EMOJIS.volumeMute;
  if (vol < 50) return CUSTOM_EMOJIS.volumeLow;
  return CUSTOM_EMOJIS.volumeHigh;
}

function createEmbed(title, description, color = '#2B2D31') {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: 'Anna Music 24/7' })
    .setTimestamp();
}

function createSuccessEmbed(description) {
  const text = (description || '').trim();
  const hasLeadingEmoji = /^<a?:\w+:\d+>|^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(text);
  const prefix = hasLeadingEmoji ? '' : `${EMOJI_TAG.correct} `;
  return new EmbedBuilder()
    .setDescription(`${prefix}${text}`.trim())
    .setColor('#2B2D31');
}

function createErrorEmbed(description) {
  const text = (description || '').trim();
  const hasLeadingEmoji = /^<a?:\w+:\d+>|^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(text);
  const prefix = hasLeadingEmoji ? '' : `${EMOJI_TAG.warning} `;
  return new EmbedBuilder()
    .setDescription(`${prefix}${text}`.trim())
    .setColor(config.errorColor || '#ED4245');
}

function createWarningEmbed(description) {
  const text = (description || '').trim();
  const hasLeadingEmoji = /^<a?:\w+:\d+>|^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(text);
  const prefix = hasLeadingEmoji ? '' : `${EMOJI_TAG.warning} `;
  return new EmbedBuilder()
    .setDescription(`${prefix}${text}`.trim())
    .setColor(config.warningColor || '#FEE75C');
}

function createNowPlayingBanner(song, queue) {
  const is247Mode = is247Track(song, queue);
  const rawTitle = String(song?.title || '')
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2800\u00AD\u034F\u17B4\u17B5\u180E\u2000-\u200A\u202F\u205F\u3000]/g, '')
    .trim();
  const curTitle = is247Mode ? 'Đài Phát Thanh Lofi 24/7' : (rawTitle || 'Bài hát không tên');
  const songTitle = is247Mode ? `${EMOJI_TAG.radio} ${curTitle}` : `${EMOJI_TAG.musicNotesDouble} ${curTitle}`;

  const content = `Now playing: **${songTitle}**`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_open_controls')
      .setLabel('Mở bảng điều khiển')
      .setEmoji(CUSTOM_EMOJIS.equalizer)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_add_song')
      .setEmoji(CUSTOM_EMOJIS.add)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_web_player')
      .setEmoji(CUSTOM_EMOJIS.web)
      .setStyle(ButtonStyle.Secondary)
  );

  return { content, components: [row] };
}

function createQueueAddedEmbed(song, position = 1, guildId = null) {
  const safeTitle = formatMarkdownTitle(song?.title || 'Bài hát mới', 60);
  const songLink = song?.url ? `[**${safeTitle}**](${song.url})` : `**${safeTitle}**`;
  let isEn = false;
  if (guildId) {
    try {
      const settingsManager = require('../structures/SettingsManager');
      isEn = settingsManager.get(guildId)?.language === 'en';
    } catch (e) {}
  }
  const prefix = isEn ? 'Added to queue' : 'Đã thêm vào hàng chờ';
  const durLabel = isEn ? 'Duration' : 'Thời lượng';
  const posLabel = isEn ? 'Position' : 'Vị trí';
  return new EmbedBuilder()
    .setDescription(
      `${EMOJI_TAG.playlist} **${prefix}:** ${songLink}\n` +
      `${EMOJI_TAG.musicNote} ${durLabel}: \`${song?.duration || '3:30'}\`  •  ${EMOJI_TAG.queue} ${posLabel}: \`#${position}\``
    )
    .setColor('#2B2D31');
}

/**
 * ============================================================================
 * 2. CHÍNH: DISCORD COMPONENTS V2 PLAYER CARD (CONTAINER TYPE 17 VIỀN XANH CHUẨN BẢN 2)
 * ============================================================================
 */
function createNowPlayingCard(song, queue) {
  const is247Mode = is247Track(song, queue);
  const guildId = queue?.guild?.id;
  let isEn = false;
  let guildSettings = null;
  try {
    const settingsManager = require('../structures/SettingsManager');
    guildSettings = guildId ? settingsManager.get(guildId) : null;
    isEn = guildSettings?.language === 'en';
  } catch (e) {}

  const defaultTitle = is247Mode
    ? (isEn ? '24/7 Lofi Radio Station' : 'Đài Phát Thanh Lofi 24/7')
    : (isEn ? 'Now Playing' : 'Bài hát đang phát');

  const safeTitle = formatMarkdownTitle(song?.title || defaultTitle, 58);
  const songUrl = (song?.url && song.url.startsWith('http')) ? song.url : 'https://discord.com';

  let requesterName = 'User';
  if (is247Mode) {
    requesterName = 'Auto (24/7)';
  } else if (song?.requestedBy) {
    if (typeof song.requestedBy === 'object') {
      requesterName = song.requestedBy.displayName || song.requestedBy.globalName || song.requestedBy.username || 'User';
    } else {
      requesterName = String(song.requestedBy).replace(/<@!?\d+>/g, '').replace(/🌐/g, '').trim() || 'User';
    }
  } else if (song?.requestedById) {
    const member = queue?.guild?.members?.cache?.get(song.requestedById);
    requesterName = member?.displayName || member?.user?.globalName || member?.user?.username || 'User';
  }

  // Nếu bài do Autoplay phát tự động, hiển thị custom emoji Autoplay của bot
  let requesterDisplay = requesterName;
  if (/tự động phát|autoplay/i.test(requesterName)) {
    requesterDisplay = `${EMOJI_TAG.autoplay} ${isEn ? 'Autoplay' : 'Tự động phát'}`;
  }

  // Thumbnail
  const botAvatar = queue?.guild?.client?.user?.displayAvatarURL({ dynamic: true }) || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';
  const thumbnailUrl = (song?.thumbnail && song.thumbnail.startsWith('http')) ? song.thumbnail : botAvatar;

  // Thanh tiến trình
  const currentMs = ((song?.seekPosition || 0) * 1000) + (queue?.currentResource?.playbackDuration || 0);
  const totalMs = song?.durationMs || parseDurationToMs(song?.duration);
  const progressStr = createProgressBar(currentMs, totalMs, 15, is247Mode);

  // Trạng thái các nút & Optimistic Action
  const pendingAction = queue?._pendingButtonAction;
  const isPendingSkip = pendingAction === 'skip';
  const isPendingPrevious = pendingAction === 'previous';
  const isPendingStop = pendingAction === 'stop';
  const hasPendingAction = Boolean(pendingAction);

  const skipLabel = isPendingSkip ? (isEn ? 'Skipping...' : 'Đang chuyển...') : (isEn ? 'Skip' : 'Bỏ qua');
  const prevLabel = isPendingPrevious ? (isEn ? 'Loading...' : 'Đang tải...') : (isEn ? 'Back' : 'Trước');
  const stopLabel = isPendingStop ? (isEn ? 'Stopping...' : 'Đang dừng...') : (isEn ? 'Stop' : 'Dừng');
  const favLabel = isEn ? 'Favorite' : 'Thích';
  const pauseLabel = isEn ? 'Pause' : 'Tạm dừng';
  const resumeLabel = isEn ? 'Resume' : 'Tiếp tục';

  const isPlayable = Boolean(queue?.currentSong && !queue?.isPreparing && !queue?.isStopped);
  const isPausedOrStopped = Boolean(queue?.paused || queue?.isStopped);
  const hasPrevious = Boolean(queue?.previousSongs && queue.previousSongs.length > 0);
  const userSongs = (queue?.songs || []).filter(
    s => s && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)' && !s.is247
  );
  const userSongsCount = userSongs.length;

  const loopMode = !is247Mode ? (queue?.loopMode || 'off') : 'off';
  const loopLabel = loopMode === 'song'
    ? (isEn ? 'Loop: Track' : 'Lặp: Bài')
    : loopMode === 'queue'
      ? (isEn ? 'Loop: Queue' : 'Lặp: Hàng chờ')
      : (isEn ? 'Loop: Off' : 'Lặp: Tắt');
  const loopEmoji = loopMode === 'song' ? CUSTOM_EMOJIS.loopOne : CUSTOM_EMOJIS.loop;

  const autoplayActive = queue?.autoplay !== undefined ? queue.autoplay : (guildSettings?.autoplay !== false);
  const autoplayLabel = autoplayActive ? (isEn ? 'Autoplay: On' : 'Tự phát: Bật') : (isEn ? 'Autoplay: Off' : 'Tự phát: Tắt');

  const nextSongText = userSongsCount > 0
    ? (isEn ? `Next: ${formatMarkdownTitle(userSongs[0].title, 40)} (+${userSongsCount} tracks in queue)` : `Tiếp theo: ${formatMarkdownTitle(userSongs[0].title, 40)} (+${userSongsCount} bài trong hàng chờ)`)
    : (isEn ? 'No more songs in the queue' : 'Hàng chờ hiện đang trống');

  // 1. Header: Chế độ 24/7 không có ảnh và không có link clickable; Bài thường có Section + Thumbnail
  const trimBadge = (song?.skippedIntroSec > 0)
    ? (isEn ? `\n-# ✂️ Automatically skipped ${song.skippedIntroSec}s of intro` : `\n-# ✂️ Đã tự động bỏ qua ${song.skippedIntroSec}s kịch mở đầu`)
    : '';

  const headerComponent = is247Mode
    ? {
        type: 10,
        content: isEn
          ? `### ${EMOJI_TAG.radio || '📻'} **24/7 Lofi Radio Station**\n*Relaxing 24/7 Lofi background music playing continuously*`
          : `### ${EMOJI_TAG.radio || '📻'} **Đài Phát Thanh Lofi 24/7**\n*Nhạc nền Lofi thư giãn đang phát liên tục 24/7*`
      }
    : {
        type: 9, // Section
        components: [
          {
            type: 10, // TextDisplay
            content: `### ${isEn ? 'Now Playing — Requested by:' : 'Đang phát — Yêu cầu bởi:'} ${requesterDisplay}\n**[${safeTitle}](${songUrl})**${trimBadge}`
          }
        ],
        accessory: {
          type: 11, // Thumbnail
          media: { url: thumbnailUrl }
        }
      };

  // 2. Nội dung lời bài hát + thanh tiến trình thời gian
  const progressContent = (queue?.currentLyricText && !is247Mode)
    ? `${queue.currentLyricText}\n\n${progressStr}`
    : progressStr;

  const container = {
    type: 17, // ComponentType.Container
    accent_color: 0x2b7fff, // Màu xanh dương (#2b7fff)
    components: [
      headerComponent,
      // 2. Thanh tiến trình thời gian liền mạch (kèm lời bài hát nếu có)
      {
        type: 10,
        content: progressContent
      },
      // Kẻ phân cách mảnh
      {
        type: 14,
        divider: true,
        spacing: 1
      },
      // 3. Hàng 1 (5 nút): Favorite | Back | Pause/Resume | Skip | Stop
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: 'btn_favorite', label: favLabel, emoji: CUSTOM_EMOJIS.heart, disabled: !isPlayable || is247Mode || hasPendingAction },
          { type: 2, style: 2, custom_id: 'btn_previous', label: prevLabel, emoji: CUSTOM_EMOJIS.back, disabled: !isPlayable || is247Mode || !hasPrevious || hasPendingAction },
          { type: 2, style: 2, custom_id: 'btn_pause', label: isPausedOrStopped ? resumeLabel : pauseLabel, emoji: isPausedOrStopped ? CUSTOM_EMOJIS.playCircle : CUSTOM_EMOJIS.pauseCircle, disabled: !isPlayable || is247Mode || hasPendingAction },
          { type: 2, style: 2, custom_id: 'btn_skip', label: skipLabel, emoji: CUSTOM_EMOJIS.skip, disabled: !isPlayable || is247Mode || hasPendingAction },
          { type: 2, style: 2, custom_id: 'btn_stop', label: stopLabel, emoji: CUSTOM_EMOJIS.stopCircle, disabled: (!isPlayable && !is247Mode) || hasPendingAction }
        ]
      },
      // 4. Hàng 2 (3 nút cân đối): Queue | Loop | Autoplay (Đã bỏ btn_lyrics)
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: 'btn_queue', label: userSongsCount > 0 ? `${isEn ? 'Queue' : 'Hàng chờ'} (${userSongsCount})` : (isEn ? 'Queue' : 'Hàng chờ'), emoji: CUSTOM_EMOJIS.queue },
          { type: 2, style: 2, custom_id: 'btn_loop', label: loopLabel, emoji: loopEmoji, disabled: !isPlayable || is247Mode || hasPendingAction },
          { type: 2, style: 2, custom_id: 'btn_autoplay', label: autoplayLabel, emoji: CUSTOM_EMOJIS.autoplay, disabled: is247Mode || hasPendingAction }
        ]
      },
      // 5. Hàng 3 (3 nút): Add Song | Playlist | Web Player
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: 'btn_add_song', label: isEn ? 'Add Song' : 'Thêm bài', emoji: CUSTOM_EMOJIS.add },
          { type: 2, style: 2, custom_id: 'btn_playlist', label: 'Playlist', emoji: CUSTOM_EMOJIS.playlist },
          { type: 2, style: 2, custom_id: 'btn_web_player', label: 'Web Player', emoji: CUSTOM_EMOJIS.web }
        ]
      },
      // Kẻ phân cách mảnh
      {
        type: 14,
        divider: true,
        spacing: 1
      },
      // 6. Footer text
      {
        type: 10,
        content: isEn
          ? `-# Manage your music more professionally at Web Player: [Click here!](https://anna-music-bot-ui.pages.dev)\n-# ${nextSongText}`
          : `-# Quản lý âm nhạc chuyên nghiệp hơn tại Web Player: [Nhấn vào đây!](https://anna-music-bot-ui.pages.dev)\n-# ${nextSongText}`
      }
    ]
  };

  return {
    flags: 32768, // MessageFlags.IsComponentsV2
    components: [container]
  };
}

/**
 * Fallback Embed truyền thống nếu có chỗ cần dùng
 */
function createNowPlayingEmbed(song, queue) {
  const is247Mode = is247Track(song, queue);
  const guildSettings = queue?.guild?.id ? require('../structures/SettingsManager').get(queue.guild.id) : null;
  const isEn = guildSettings?.language === 'en';

  const defaultTitle = is247Mode
    ? (isEn ? '24/7 Lofi Radio Station' : 'Đài Phát Thanh Lofi 24/7')
    : (isEn ? 'Now Playing Track' : 'Bài hát đang phát');
  const safeTitle = formatMarkdownTitle(song?.title || defaultTitle, 58);
  const songUrl = (song?.url && song.url.startsWith('http')) ? song.url : 'https://discord.com';
  const currentMs = ((song?.seekPosition || 0) * 1000) + (queue?.currentResource?.playbackDuration || 0);
  const totalMs = song?.durationMs || parseDurationToMs(song?.duration);
  const progressBar = createProgressBar(currentMs, totalMs, 15, is247Mode);

  const embed = new EmbedBuilder()
    .setAuthor({ name: isEn ? 'Now Playing' : 'Đang Phát Nhạc', iconURL: queue?.guild?.client?.user?.displayAvatarURL() })
    .setTitle(safeTitle)
    .setURL(songUrl)
    .setColor('#2B7FFF')
    .setDescription(`${progressBar}`);

  if (song?.thumbnail && song.thumbnail.startsWith('http')) {
    embed.setThumbnail(song.thumbnail);
  }
  return embed;
}

function createMusicControls(queue) {
  const is247Mode = is247Track(queue?.currentSong, queue);
  const guildId = queue?.guild?.id;
  let isEn = false;
  try {
    const settingsManager = require('../structures/SettingsManager');
    isEn = settingsManager.get(guildId)?.language === 'en';
  } catch (e) {}

  const pendingAction = queue?._pendingButtonAction;
  const isPendingSkip = pendingAction === 'skip';
  const isPendingPrevious = pendingAction === 'previous';
  const isPendingStop = pendingAction === 'stop';
  const hasPendingAction = Boolean(pendingAction);

  const skipLabel = isPendingSkip ? (isEn ? 'Skipping...' : 'Đang chuyển...') : (isEn ? 'Skip' : 'Bỏ qua');
  const stopLabel = isPendingStop ? (isEn ? 'Stopping...' : 'Đang dừng...') : (isEn ? 'Stop' : 'Dừng');
  const favLabel = isEn ? 'Favorite' : 'Thích';
  const pauseLabel = isEn ? 'Pause' : 'Tạm dừng';
  const resumeLabel = isEn ? 'Resume' : 'Tiếp tục';

  const isPlayable = Boolean(queue?.currentSong && !queue?.isPreparing && !queue?.isStopped);
  const isPausedOrStopped = Boolean(queue?.paused || queue?.isStopped);
  const loopMode = !is247Mode ? (queue?.loopMode || 'off') : 'off';
  const loopEmoji = loopMode === 'song' ? CUSTOM_EMOJIS.loopOne : CUSTOM_EMOJIS.loop;
  const loopLabel = loopMode === 'song'
    ? (isEn ? 'Loop: Track' : 'Lặp: Bài')
    : loopMode === 'queue'
      ? (isEn ? 'Loop: Queue' : 'Lặp: Hàng chờ')
      : (isEn ? 'Loop: Off' : 'Lặp: Tắt');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_favorite')
      .setLabel(favLabel)
      .setEmoji(CUSTOM_EMOJIS.heart)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPlayable || is247Mode || hasPendingAction),
    new ButtonBuilder()
      .setCustomId('btn_pause')
      .setLabel(isPausedOrStopped ? resumeLabel : pauseLabel)
      .setEmoji(isPausedOrStopped ? CUSTOM_EMOJIS.playCircle : CUSTOM_EMOJIS.pauseCircle)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPlayable || is247Mode || hasPendingAction),
    new ButtonBuilder()
      .setCustomId('btn_skip')
      .setLabel(skipLabel)
      .setEmoji(CUSTOM_EMOJIS.skip)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPlayable || is247Mode || hasPendingAction),
    new ButtonBuilder()
      .setCustomId('btn_loop')
      .setLabel(loopLabel)
      .setEmoji(loopEmoji)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPlayable || is247Mode || hasPendingAction),
    new ButtonBuilder()
      .setCustomId('btn_stop')
      .setLabel(stopLabel)
      .setEmoji(CUSTOM_EMOJIS.stopCircle)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled((!isPlayable && !is247Mode) || hasPendingAction)
  );

  const userSongsCount = (queue?.songs || []).filter(
    s => s && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)' && !s.is247
  ).length;

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_add_song')
      .setEmoji(CUSTOM_EMOJIS.add)
      .setLabel(isEn ? 'Add Song' : 'Thêm bài')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_queue')
      .setEmoji(CUSTOM_EMOJIS.queue)
      .setLabel(userSongsCount > 0 ? `${isEn ? 'Queue' : 'Hàng chờ'} (${userSongsCount})` : (isEn ? 'Queue' : 'Hàng chờ'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_web_player')
      .setEmoji(CUSTOM_EMOJIS.web)
      .setLabel('Web Player')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function createNowPlayingV2Payload(song, queue) {
  return createNowPlayingCard(song, queue);
}

function createQueueEmbed(queue, page = 1) {
  const guildSettings = queue?.guild?.id ? require('../structures/SettingsManager').get(queue.guild.id) : null;
  const isEn = guildSettings?.language === 'en';
  const embed = new EmbedBuilder()
    .setTitle(isEn ? `${EMOJI_TAG.queue} Music Queue — ${queue.guild.name}` : `${EMOJI_TAG.queue} Hàng Chờ Âm Nhạc — ${queue.guild.name}`)
    .setColor('#2B7FFF')
    .setTimestamp();

  const is247 = Boolean(
    queue.currentSong && (queue.currentSong.requestedBy === 'Auto (24/7)' || queue.currentSong.is247)
  ) || Boolean(queue.mode247 && !queue.currentSong);
  const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');

  if (is247) {
    embed.addFields({
      name: `${EMOJI_TAG.radio} Đang phát hiện tại:`,
      value: `${EMOJI_TAG.autoplay} **Đài Phát Thanh Lofi 24/7** | \`LIVE 24/7\``,
      inline: false
    });
  } else if (queue.currentSong) {
    const curTitle = formatMarkdownTitle(queue.currentSong.title || 'Unknown', 60);
    const curLink = (queue.currentSong.url && queue.currentSong.url !== 'null')
      ? `[**${curTitle}**](${queue.currentSong.url})`
      : `**${curTitle}**`;
    embed.addFields({
      name: `${EMOJI_TAG.equalizer} Đang phát hiện tại:`,
      value: `${curLink} | \`${queue.currentSong.duration || '??:??'}\``,
      inline: false
    });
  }

  if (userSongs.length === 0) {
    embed.setDescription(is247
      ? (isEn
          ? `${EMOJI_TAG.musicNote} Queue is empty! Bot is playing 24/7 Lofi radio.\nUse \`/play <song_name>\` or **Web Player** to add songs.`
          : `${EMOJI_TAG.musicNote} Hàng chờ trống! Bot đang phát nhạc nền Lofi 24/7.\nDùng \`/play <tên_bài>\` hoặc **Web Player** để thêm nhạc.`)
      : (isEn
          ? `${EMOJI_TAG.musicNote} Queue is currently empty! Use \`/play <song_name>\` to add your favorite tracks.`
          : `${EMOJI_TAG.musicNote} Hàng chờ hiện đang trống! Dùng lệnh \`/play <tên_bài>\` để thêm bài hát yêu thích.`));
    embed.setFooter({ text: isEn ? 'Anna Music Queue • 0 tracks in queue' : 'Anna Music Queue • 0 bài trong hàng chờ' });
  } else {
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(userSongs.length / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const listSlice = userSongs.slice(startIndex, startIndex + pageSize);

    let desc = isEn
      ? `${EMOJI_TAG.playlist} **Upcoming tracks (${userSongs.length} songs):**\n\n`
      : `${EMOJI_TAG.playlist} **Danh sách bài hát sắp phát (${userSongs.length} bài):**\n\n`;
    listSlice.forEach((s, idx) => {
      const realIndex = startIndex + idx + 1;
      let req = '';
      if (s.requestedBy && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)') {
        const cleanReq = typeof s.requestedBy === 'object'
          ? (s.requestedBy.displayName || s.requestedBy.globalName || s.requestedBy.username || '')
          : String(s.requestedBy).replace(/<@!?\d+>/g, '').replace(/🌐/g, '').trim();
        if (cleanReq) req = `• ${cleanReq}`;
      } else if (s.requestedById) {
        const member = queue?.guild?.members?.cache?.get(s.requestedById);
        const name = member?.displayName || member?.user?.globalName || member?.user?.username;
        if (name) req = `• ${name}`;
      }

      const songTitle = formatMarkdownTitle(s.title || 'Unknown', 52);
      const titleMarkdown = (s.url && s.url !== 'null') ? `[${songTitle}](${s.url})` : `**${songTitle}**`;
      desc += `\`${realIndex}.\` ${titleMarkdown} | \`${s.duration || '??:??'}\` ${req}\n`;
    });

    embed.setDescription(desc);
    embed.setFooter({
      text: isEn ? `Page ${currentPage}/${totalPages} • Total ${userSongs.length} tracks • Use /move to reorder` : `Trang ${currentPage}/${totalPages} • Tổng cộng ${userSongs.length} bài • Dùng /move để đổi vị trí`
    });
  }

  return embed;
}


function createQueueContainer(queue, page = 1) {
  if (!queue) return null;
  const guildName = queue.guild?.name || 'Server';
  const guildId = queue.guild?.id;
  let isEn = false;
  try {
    const settingsManager = require('../structures/SettingsManager');
    isEn = settingsManager.get(guildId)?.language === 'en';
  } catch (e) {}

  const is247 = Boolean(
    queue.currentSong && (queue.currentSong.requestedBy === 'Auto (24/7)' || queue.currentSong.is247)
  ) || Boolean(queue.mode247 && !queue.currentSong);
  const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(userSongs.length / pageSize));
  const currentPage = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const listSlice = userSongs.slice(startIndex, startIndex + pageSize);

  const containerComponents = [];

  let thumbUrl = queue.currentSong?.thumbnail || queue.guild?.iconURL?.({ dynamic: true, size: 256 }) || global._discordClient?.user?.displayAvatarURL?.() || null;

  const headerContent = userSongs.length > 0
    ? (isEn
        ? `### ${EMOJI_TAG.queue || '📑'} Music Queue — ${guildName}\n**${EMOJI_TAG.playlist || '🎵'} Upcoming tracks (${userSongs.length} songs):**`
        : `### ${EMOJI_TAG.queue || '📑'} Hàng Chờ Âm Nhạc — ${guildName}\n**${EMOJI_TAG.playlist || '🎵'} Danh sách bài hát sắp phát (${userSongs.length} bài):**`)
    : (isEn
        ? `### ${EMOJI_TAG.queue || '📑'} Music Queue — ${guildName}`
        : `### ${EMOJI_TAG.queue || '📑'} Hàng Chờ Âm Nhạc — ${guildName}`);

  if (is247) {
    containerComponents.push({
      type: 10,
      content: headerContent
    });
  } else {
    const headerSection = {
      type: 9,
      components: [
        {
          type: 10,
          content: headerContent
        }
      ]
    };
    if (thumbUrl) {
      headerSection.accessory = {
        type: 11,
        media: { url: thumbUrl }
      };
    }
    containerComponents.push(headerSection);
  }

  let desc = '';
  if (userSongs.length === 0) {
    desc += is247
      ? (isEn
          ? `${EMOJI_TAG.musicNote || '🎵'} Queue is empty! Bot is playing 24/7 Lofi radio.\nUse \`/play <song_name>\` or **Web Player** to add songs.`
          : `${EMOJI_TAG.musicNote || '🎵'} Hàng chờ trống! Bot đang phát nhạc nền Lofi 24/7.\nDùng \`/play <tên_bài>\` hoặc **Web Player** để thêm nhạc.`)
      : (isEn
          ? `${EMOJI_TAG.musicNote || '🎵'} Queue is currently empty! Use \`/play <song_name>\` to add your favorite tracks.`
          : `${EMOJI_TAG.musicNote || '🎵'} Hàng chờ hiện đang trống! Dùng lệnh \`/play <tên_bài>\` để thêm bài hát yêu thích.`);
  } else {
    listSlice.forEach((s, idx) => {
      const realIndex = startIndex + idx + 1;
      let req = '';
      if (s.requestedBy && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)') {
        const cleanReq = typeof s.requestedBy === 'object'
          ? (s.requestedBy.displayName || s.requestedBy.globalName || s.requestedBy.username || '')
          : String(s.requestedBy).replace(/<@!?\d+>/g, '').replace(/🌐/g, '').trim();
        if (cleanReq) req = `• ${cleanReq}`;
      } else if (s.requestedById) {
        const member = queue?.guild?.members?.cache?.get(s.requestedById);
        const name = member?.displayName || member?.user?.globalName || member?.user?.username;
        if (name) req = `• ${name}`;
      }

      const songTitle = formatMarkdownTitle(s.title || 'Unknown', 48);
      const titleMarkdown = (s.url && s.url !== 'null') ? `[${songTitle}](${s.url})` : `**${songTitle}**`;
      desc += `\`${realIndex}.\` ${titleMarkdown} | \`${s.duration || '??:??'}\` ${req}\n`;
    });
  }

  if (is247) {
    desc += isEn
      ? `\n**${EMOJI_TAG.radio || '📻'} Currently Playing:**\n${EMOJI_TAG.autoplay || '♾️'} **24/7 Lofi Radio Station** | \`LIVE 24/7\`\n`
      : `\n**${EMOJI_TAG.radio || '📻'} Đang phát hiện tại:**\n${EMOJI_TAG.autoplay || '♾️'} **Đài Phát Thanh Lofi 24/7** | \`LIVE 24/7\`\n`;
  } else if (queue.currentSong) {
    const curTitle = formatMarkdownTitle(queue.currentSong.title || 'Unknown', 48);
    const curLink = (queue.currentSong.url && queue.currentSong.url !== 'null')
      ? `[${curTitle}](${queue.currentSong.url})`
      : `**${curTitle}**`;
    desc += isEn
      ? `\n**${EMOJI_TAG.equalizer || '🎚️'} Currently Playing:**\n${curLink} | \`${queue.currentSong.duration || '??:??'}\`\n`
      : `\n**${EMOJI_TAG.equalizer || '🎚️'} Đang phát hiện tại:**\n${curLink} | \`${queue.currentSong.duration || '??:??'}\`\n`;
  }

  desc += isEn
    ? `\n-# Page ${currentPage}/${totalPages} • Total ${userSongs.length} songs • Use /move to reorder`
    : `\n-# Trang ${currentPage}/${totalPages} • Tổng cộng ${userSongs.length} bài • Dùng /move để đổi vị trí`;

  containerComponents.push({
    type: 10,
    content: desc
  });

  const btnRow = createQueuePaginationButtons(currentPage, totalPages, isEn);
  containerComponents.push(btnRow.toJSON());

  const deleteMenu = createQueueDeleteSelectMenu(queue, currentPage, pageSize, isEn);
  if (deleteMenu) {
    containerComponents.push(deleteMenu.toJSON());
  }

  return {
    type: 17,
    accent_color: 0x2B7FFF,
    components: containerComponents
  };
}

function createQueuePaginationButtons(page = 1, totalPages = 1, isEn = false) {
  const row = new ActionRowBuilder();
  const p = Math.max(1, parseInt(page, 10) || 1);
  const total = Math.max(1, parseInt(totalPages, 10) || 1);

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_page_${p - 1}`)
      .setEmoji(CUSTOM_EMOJIS.back)
      .setLabel(isEn ? 'Back' : 'Trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p <= 1),
    new ButtonBuilder()
      .setCustomId('queue_indicator')
      .setLabel(`${p}/${total}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`queue_page_${p + 1}`)
      .setEmoji(CUSTOM_EMOJIS.skip)
      .setLabel(isEn ? 'Next' : 'Sau')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= total),
    new ButtonBuilder()
      .setCustomId('queue_delete_modal')
      .setEmoji(CUSTOM_EMOJIS.trash)
      .setLabel(isEn ? 'Remove by #...' : 'Xóa theo số...')
      .setStyle(ButtonStyle.Danger)
  );

  return row;
}

function createQueueDeleteSelectMenu(queue, page = 1, pageSize = 10, isEn = false) {
  if (!queue) return null;
  const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
  if (userSongs.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(userSongs.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const optionsSlice = userSongs.slice(startIndex, startIndex + pageSize);

  const placeholder = isEn
    ? `🗑️ Remove track on Page ${currentPage}/${totalPages} (or Clear all)...`
    : `🗑️ Xóa bài ở Trang ${currentPage}/${totalPages} (hoặc Xóa tất cả)...`;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`menu_queue_remove_${currentPage}`)
    .setPlaceholder(placeholder);

  selectMenu.addOptions(
    new StringSelectMenuOptionBuilder()
      .setLabel(isEn ? 'Clear Entire Queue' : 'Xóa toàn bộ hàng chờ')
      .setDescription(isEn ? `Remove all ${userSongs.length} songs from queue` : `Xóa sạch toàn bộ ${userSongs.length} bài hát trong danh sách chờ`)
      .setValue('remove_all')
      .setEmoji(CUSTOM_EMOJIS.trash)
  );

  optionsSlice.forEach((song, idx) => {
    if (!song) return;
    const realIndex = startIndex + idx + 1;
    const songTitle = (song.title || 'Unknown').slice(0, 80);
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${realIndex}. ${songTitle}`)
        .setDescription(isEn ? `Duration: ${song.duration || '??:??'} • Click to remove` : `Thời lượng: ${song.duration || '??:??'} • Nhấn để xóa bài này`)
        .setValue(`remove_${realIndex - 1}`)
        .setEmoji(CUSTOM_EMOJIS.trash)
    );
  });

  return new ActionRowBuilder().addComponents(selectMenu);
}

function createSettingsEmbed(guild, settings) {
  const isEn = settings.language === 'en';
  const onText = isEn ? '`On`' : '`Bật`';
  const offText = isEn ? '`Off`' : '`Tắt`';

  const mode247Text = settings.mode247 ? onText : offText;
  const autoplayText = settings.autoplay ? onText : offText;
  const voteSkipText = settings.voteSkipEnabled ? onText : offText;
  const voiceLockText = settings.lockedVoiceChannelId ? `<#${settings.lockedVoiceChannelId}>` : (isEn ? '`Any Channel`' : '`Mọi phòng`');
  const textLockText = settings.musicChannelId ? `<#${settings.musicChannelId}>` : (isEn ? '`Any Channel`' : '`Mọi kênh`');
  const logChannelText = settings.logChannelId ? `<#${settings.logChannelId}>` : offText;
  const voiceStatusText = settings.updateVoiceStatus !== false ? onText : offText;
  const djText = settings.djOnly
    ? (settings.djRoleId ? `<@&${settings.djRoleId}> (${onText})` : (isEn ? '`On (DJ Role Required)`' : '`Bật (Cần Role DJ)`'))
    : (isEn ? '`Off (Everyone)`' : '`Tắt (Mọi người)`');
  const crossfadeText = settings.crossfadeDuration > 0 ? `\`${settings.crossfadeDuration} ${isEn ? 'sec' : 'giây'}\`` : (isEn ? '`Off (0s)`' : '`Tắt (0s)`');
  const timeoutText = settings.mode247 ? (isEn ? '`Disabled (24/7 On)`' : '`Vô hiệu hóa (24/7 Bật)`') : `\`${settings.emptyChannelTimeout || 60} ${isEn ? 'sec' : 'giây'}\``;
  const volumeText = `\`${settings.defaultVolume}%\``;
  const loopText = settings.loopMode === 'song' ? (isEn ? '`Loop Track`' : '`Lặp bài hát`') : settings.loopMode === 'queue' ? (isEn ? '`Loop Queue`' : '`Lặp hàng chờ`') : offText;
  const announceText = settings.announceSongs ? onText : offText;
  const skipOfftopicText = settings.autoSkipOfftopic !== false ? onText : offText;
  const languageText = settings.language === 'vi' ? '`Tiếng Việt (VI)`' : '`English (EN)`';

  const title = isEn
    ? `${EMOJI_TAG.settings} Music Settings Panel — ${guild.name}`
    : `${EMOJI_TAG.settings} Bảng Cài Đặt Âm Nhạc — ${guild.name}`;

  const description = isEn
    ? 'Select an option from the **Dropdown Menu** below to quickly modify server settings:'
    : 'Chọn một mục từ danh sách **Dropdown** bên dưới để thay đổi cài đặt nhanh chóng:';

  const currentPrefix = isEn ? 'Current:' : 'Cài đặt hiện tại:';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor('#2B7FFF')
    .addFields(
      { name: isEn ? 'Display Language' : 'Ngôn ngữ hiển thị (Language)', value: `${currentPrefix} ${languageText}`, inline: true },
      { name: isEn ? '24/7 Mode (Always Online)' : 'Chế độ 24/7 (Luôn trực tuyến)', value: `${currentPrefix} ${mode247Text}`, inline: true },
      { name: isEn ? 'Autoplay' : 'Tự động phát tương tự (Autoplay)', value: `${currentPrefix} ${autoplayText}`, inline: true },
      { name: isEn ? 'Vote Skip' : 'Bỏ phiếu qua bài (Vote Skip)', value: `${currentPrefix} ${voteSkipText}`, inline: true },
      {
        name: isEn ? 'Active Autoplay Layers' : 'Tầng Autoplay kích hoạt',
        value: `\`${(Array.isArray(settings.autoplayLayers) && settings.autoplayLayers.length > 0 ? settings.autoplayLayers : ['ytmix', 'lastfm', 'heuristic']).map(k => ({ ytmix: 'YouTube Mix', lastfm: 'Last.fm', heuristic: 'Heuristic' }[k] || k)).join(' ➔ ')}\``,
        inline: true
      },
      {
        name: isEn ? 'Active Lyrics Layers' : 'Tầng Lời bài hát (Lyrics)',
        value: `\`${(Array.isArray(settings.lyricsLayers) && settings.lyricsLayers.length > 0 ? settings.lyricsLayers : ['youtube_cc', 'zingmp3', 'lrclib', 'syncedlyrics']).map(k => ({ youtube_cc: 'YouTube CC', zingmp3: 'Zing MP3', lrclib: 'LRCLIB', syncedlyrics: 'Microservice' }[k] || k)).join(' ➔ ')}\``,
        inline: true
      },
      { name: isEn ? 'SponsorBlock Auto-Trim' : 'Tự cắt kịch MV YouTube (SponsorBlock)', value: `${currentPrefix} ${skipOfftopicText}`, inline: true },
      { name: isEn ? 'Locked Voice Channel' : 'Khóa phòng Voice cố định', value: `${currentPrefix} ${voiceLockText}`, inline: true },
      { name: isEn ? 'Dedicated Commands Channel' : 'Khóa kênh lệnh chat', value: `${currentPrefix} ${textLockText}`, inline: true },
      { name: isEn ? 'Activity Log Channel' : 'Kênh nhật ký hoạt động (Log)', value: `${currentPrefix} ${logChannelText}`, inline: true },
      { name: isEn ? 'Voice Channel Status' : 'Trạng thái kênh Voice (Voice Status)', value: `${currentPrefix} ${voiceStatusText}`, inline: true },
      { name: isEn ? 'DJ Only Mode' : 'Chế độ DJ (Cần Role mới phát được)', value: `${currentPrefix} ${djText}`, inline: true },
      { name: isEn ? 'Crossfade Duration' : 'Hòa âm chuyển bài (Crossfade)', value: `${currentPrefix} ${crossfadeText}`, inline: true },
      { name: isEn ? 'Empty Channel Timeout' : 'Tự rời khi phòng trống', value: `${currentPrefix} ${timeoutText}`, inline: true },
      { name: isEn ? 'Default Volume' : 'Âm lượng mặc định', value: `${currentPrefix} ${volumeText}`, inline: true },
      { name: isEn ? 'Loop Mode' : 'Chế độ lặp lại', value: `${currentPrefix} ${loopText}`, inline: true },
      { name: isEn ? 'Song Announcements' : 'Thông báo bài hát', value: `${currentPrefix} ${announceText}`, inline: true }
    )
    .setFooter({ text: isEn ? 'Anna Music Settings • Changes apply instantly' : 'Anna Music Settings • Thay đổi áp dụng ngay lập tức' })
    .setTimestamp();

  return embed;
}

function createSettingsSelectMenu(settings) {
  const isEn = settings.language === 'en';
  const onText = isEn ? 'ON' : 'BẬT';
  const offText = isEn ? 'OFF' : 'TẮT';
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_settings')
    .setPlaceholder(isEn ? 'Select a setting below to modify...' : 'Chọn một cài đặt bên dưới để thay đổi...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Display Language' : 'Ngôn ngữ hiển thị (Language)')
        .setDescription(isEn ? `Toggle Vietnamese / English (Current: ${settings.language === 'vi' ? 'Tiếng Việt' : 'English'})` : `Chuyển đổi Tiếng Việt / English (Hiện tại: ${settings.language === 'vi' ? 'Tiếng Việt' : 'English'})`)
        .setValue('set_language')
        .setEmoji(CUSTOM_EMOJIS.web),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? '24/7 Mode (Always Online)' : 'Chế độ 24/7 (Luôn trực tuyến)')
        .setDescription(isEn ? `Keep bot in voice channel (Current: ${settings.mode247 ? onText : offText})` : `Bật/Tắt giữ bot ở phòng Voice (Hiện tại: ${settings.mode247 ? onText : offText})`)
        .setValue('set_247')
        .setEmoji(CUSTOM_EMOJIS.radio),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Autoplay' : 'Tự động phát tương tự (Autoplay)')
        .setDescription(isEn ? `Find similar tracks automatically (Current: ${settings.autoplay ? onText : offText})` : `Tự động tìm bài tương tự khi hết nhạc (Hiện tại: ${settings.autoplay ? onText : offText})`)
        .setValue('set_autoplay')
        .setEmoji(CUSTOM_EMOJIS.autoplay),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Autoplay Layers Configuration' : 'Cấu hình tầng Autoplay (Autoplay Layers)')
        .setDescription(isEn ? 'Select & customize recommendation layers' : 'Tích chọn & tùy chỉnh thứ tự các tầng: YouTube Mix, Gemini AI...')
        .setValue('set_autoplay_layers')
        .setEmoji(CUSTOM_EMOJIS.equalizer),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'SponsorBlock Auto-Trim' : 'Tự cắt kịch MV YouTube (SponsorBlock)')
        .setDescription(isEn ? `Auto-skip video intro/outro sketches (Current: ${settings.autoSkipOfftopic !== false ? onText : offText})` : `Bỏ qua phân đoạn kịch mở đầu/kết thúc MV (Hiện tại: ${settings.autoSkipOfftopic !== false ? onText : offText})`)
        .setValue('set_skip_offtopic')
        .setEmoji(CUSTOM_EMOJIS.equalizer),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Lock Voice Channel' : 'Khóa phòng Voice cố định')
        .setDescription(isEn ? `Bind bot to specific voice room (Current: ${settings.lockedVoiceChannelId ? 'LOCKED' : 'ANY'})` : `Chỉ phát nhạc tại phòng voice chỉ định (Hiện tại: ${settings.lockedVoiceChannelId ? 'ĐÃ KHÓA' : 'MỌI PHÒNG'})`)
        .setValue('set_voice_lock')
        .setEmoji(CUSTOM_EMOJIS.padlock),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Lock Commands Channel' : 'Khóa kênh văn bản dùng lệnh')
        .setDescription(isEn ? `Accept commands in dedicated channel only (Current: ${settings.musicChannelId ? 'LOCKED' : 'ANY'})` : `Chỉ nhận lệnh tại kênh chat chỉ định (Hiện tại: ${settings.musicChannelId ? 'ĐÃ KHÓA' : 'MỌI KÊNH'})`)
        .setValue('set_channel_lock')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Activity Log Channel' : 'Kênh ghi nhật ký hoạt động (Log)')
        .setDescription(isEn ? `Log playback events to Discord channel (Current: ${settings.logChannelId ? onText : offText})` : `Ghi toàn bộ nhật ký bot vào kênh Discord (Hiện tại: ${settings.logChannelId ? onText : offText})`)
        .setValue('set_log_channel')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Voice Channel Status' : 'Trạng thái kênh Voice (Voice Status)')
        .setDescription(isEn ? `Update song title in voice channel status (Current: ${settings.updateVoiceStatus !== false ? onText : offText})` : `Bật/Tắt đổi tên bài hát trên kênh Voice (Hiện tại: ${settings.updateVoiceStatus !== false ? onText : offText})`)
        .setValue('set_voice_status')
        .setEmoji(CUSTOM_EMOJIS.signal),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'DJ Only Mode' : 'Chế độ DJ (Cần Role mới phát được)')
        .setDescription(isEn ? `Restricted command access to DJ role (Current: ${settings.djOnly ? onText : offText})` : `Chỉ người có vai trò DJ mới dùng được lệnh (Hiện tại: ${settings.djOnly ? onText : offText})`)
        .setValue('set_dj_only')
        .setEmoji(CUSTOM_EMOJIS.settings),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Crossfade Duration' : 'Hòa âm chuyển bài (Crossfade)')
        .setDescription(isEn ? `Smooth transition effect (Current: ${settings.crossfadeDuration}s)` : `Hiệu ứng mượt mà khi đổi bài (Hiện tại: ${settings.crossfadeDuration}s)`)
        .setValue('set_crossfade')
        .setEmoji(CUSTOM_EMOJIS.equalizer),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Empty Room Disconnect Timeout' : 'Thời gian tự rời khi phòng trống')
        .setDescription(isEn ? `Seconds to wait before leaving (Current: ${settings.emptyChannelTimeout || 60}s)` : `Số giây chờ trước khi out nếu không có ai (Hiện tại: ${settings.emptyChannelTimeout || 60}s)`)
        .setValue('set_timeout')
        .setEmoji(CUSTOM_EMOJIS.disconnect),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Default Volume' : 'Âm lượng mặc định')
        .setDescription(isEn ? `Volume level 30% / 50% / 80% / 100% (Current: ${settings.defaultVolume}%)` : `Chuyển đổi âm lượng 30% / 50% / 80% / 100% (Hiện tại: ${settings.defaultVolume}%)`)
        .setValue('set_volume')
        .setEmoji(CUSTOM_EMOJIS.volumeHigh),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Loop Mode' : 'Chế độ lặp lại')
        .setDescription(isEn ? `Off / Track / Queue (Current: ${settings.loopMode})` : `Tắt / Lặp bài hát / Lặp hàng chờ (Hiện tại: ${settings.loopMode})`)
        .setValue('set_loop')
        .setEmoji(CUSTOM_EMOJIS.loop),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Song Announcements' : 'Thông báo bài hát')
        .setDescription(isEn ? `Send embed when track changes (Current: ${settings.announceSongs ? onText : offText})` : `Gửi Embed thông báo khi chuyển bài (Hiện tại: ${settings.announceSongs ? onText : offText})`)
        .setValue('set_announce')
        .setEmoji(CUSTOM_EMOJIS.musicNote),
      new StringSelectMenuOptionBuilder()
        .setLabel(isEn ? 'Reset to Defaults' : 'Khôi phục mặc định')
        .setDescription(isEn ? 'Restore all original settings' : 'Đặt lại toàn bộ cài đặt gốc')
        .setValue('set_reset')
        .setEmoji(CUSTOM_EMOJIS.trash)
    );

  return new ActionRowBuilder().addComponents(selectMenu);
}

const AUTOPLAY_LAYER_INFO = {
  ytmix: {
    name: 'YouTube Mix (RD)',
    badge: EMOJI_TAG.playCircle,
    desc: 'Thuật toán Radio Mix chuẩn gu của YouTube'
  },
  ai: {
    name: 'Gemini DJ AI',
    badge: EMOJI_TAG.ai,
    desc: 'Trí tuệ nhân tạo gợi ý bài theo vibe & thể loại'
  },
  lastfm: {
    name: 'Last.fm Similar',
    badge: EMOJI_TAG.radio,
    desc: 'Kho dữ liệu bài hát tương tự quốc tế'
  },
  heuristic: {
    name: 'Heuristic Fallback',
    badge: EMOJI_TAG.search,
    desc: 'Tìm kiếm bài cùng ca sĩ hoặc bài nổi bật'
  }
};

function createAutoplayLayersEmbed(guild, settings) {
  const isEn = settings.language === 'en';
  const activeLayers = (Array.isArray(settings.autoplayLayers) && settings.autoplayLayers.length > 0)
    ? settings.autoplayLayers
    : ['ytmix', 'lastfm', 'heuristic'];

  const allKeys = ['ytmix', 'lastfm', 'heuristic'];
  const inactiveKeys = allKeys.filter(k => !activeLayers.includes(k));

  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣'];
  let activeListText = '';
  activeLayers.forEach((key, idx) => {
    const info = AUTOPLAY_LAYER_INFO[key] || { name: key, badge: EMOJI_TAG.musicNote, desc: '' };
    const num = numberEmojis[idx] || `${idx + 1}.`;
    const descText = isEn
      ? (key === 'ytmix' ? 'YouTube official Radio Mix algorithm' : (key === 'lastfm' ? 'Global similar tracks library' : 'Same artist or popular fallback'))
      : info.desc;
    activeListText += `${num} ${info.badge} **${info.name}**\n↳ *${descText}*\n`;
  });

  let inactiveListText = '';
  if (inactiveKeys.length > 0) {
    inactiveKeys.forEach(key => {
      const info = AUTOPLAY_LAYER_INFO[key] || { name: key, badge: EMOJI_TAG.musicNote };
      inactiveListText += `• ❌ ~~${info.name}~~\n`;
    });
  } else {
    inactiveListText = isEn ? '*None (All 3 layers are active)*\n' : '*Không có (Tất cả 3 tầng đều đang bật)*\n';
  }

  const desc = isEn
    ? ('When the queue ends, the bot automatically selects the next track using active layers in order:\n\n' +
       `${EMOJI_TAG.play} **Active Layers (By Priority):**\n` +
       activeListText + '\n' +
       `${EMOJI_TAG.stop} **Disabled Layers:**\n` +
       inactiveListText + '\n' +
       '💡 **Guide:**\n' +
       '• Open **Dropdown Menu** below to select your desired layers (1 to 3 layers).\n' +
       '• Or use the **Quick Presets** below for 1-click configuration.')
    : ('Khi hàng chờ phát hết nhạc, bot sẽ tự động tìm bài hát tiếp theo lần lượt theo các tầng được tích chọn bên dưới:\n\n' +
       `${EMOJI_TAG.play} **Các tầng đang kích hoạt (Theo thứ tự ưu tiên):**\n` +
       activeListText + '\n' +
       `${EMOJI_TAG.stop} **Các tầng đã tắt:**\n` +
       inactiveListText + '\n' +
       '💡 **Hướng dẫn:**\n' +
       '• Mở **Dropdown Menu** bên dưới để **tích chọn những tầng bạn muốn** (chọn từ 1 đến 3 tầng).\n' +
       '• Hoặc dùng các nút **Preset nhanh** bên dưới để chuyển đổi 1 chạm.');

  return new EmbedBuilder()
    .setTitle(isEn ? `${EMOJI_TAG.equalizer} Autoplay Layers Configuration — ${guild.name}` : `${EMOJI_TAG.equalizer} Cấu Hình Thứ Tự Tầng Gợi Ý Autoplay — ${guild.name}`)
    .setColor('#2B7FFF')
    .setDescription(desc)
    .setFooter({ text: isEn ? 'Server Administrators only • Instant update' : 'Chỉ Quản trị viên máy chủ mới có quyền thay đổi • Cập nhật tức thì' })
    .setTimestamp();
}

function createAutoplayLayersComponents(settings) {
  const isEn = settings.language === 'en';
  const activeLayers = (Array.isArray(settings.autoplayLayers) && settings.autoplayLayers.length > 0)
    ? settings.autoplayLayers
    : ['ytmix', 'lastfm', 'heuristic'];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('menu_autoplay_layers')
    .setPlaceholder(isEn ? '🔽 Click here to select Autoplay layers...' : '🔽 Bấm vào đây để tích chọn các tầng Autoplay...')
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('YouTube Mix (RD)')
        .setDescription(isEn ? 'YouTube official Radio Mix algorithm' : 'Thuật toán Radio Mix chuẩn gu của YouTube')
        .setValue('ytmix')
        .setEmoji(CUSTOM_EMOJIS.playCircle)
        .setDefault(activeLayers.includes('ytmix')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Last.fm Similar')
        .setDescription(isEn ? 'Global similar tracks library' : 'Kho dữ liệu bài hát tương tự quốc tế')
        .setValue('lastfm')
        .setEmoji(CUSTOM_EMOJIS.radio)
        .setDefault(activeLayers.includes('lastfm')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Heuristic Fallback')
        .setDescription(isEn ? 'Same artist or popular tracks search' : 'Tìm kiếm bài cùng ca sĩ hoặc bài nổi bật')
        .setValue('heuristic')
        .setEmoji(CUSTOM_EMOJIS.search)
        .setDefault(activeLayers.includes('heuristic'))
    );

  const rowMenu = new ActionRowBuilder().addComponents(selectMenu);

  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_layer_yt_only')
      .setEmoji(CUSTOM_EMOJIS.playCircle)
      .setLabel(isEn ? 'YouTube Mix Only' : 'Chỉ YouTube Mix')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_layer_yt_ai')
      .setEmoji(CUSTOM_EMOJIS.ai)
      .setLabel(isEn ? 'YouTube Mix + AI' : 'YouTube Mix + AI')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_layer_default')
      .setEmoji(CUSTOM_EMOJIS.loop)
      .setLabel(isEn ? 'Default (3 Layers)' : 'Mặc định (3 tầng)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_settings_back')
      .setEmoji(CUSTOM_EMOJIS.back)
      .setLabel(isEn ? 'Back to Settings' : 'Quay lại Cài đặt')
      .setStyle(ButtonStyle.Secondary)
  );

  return [rowMenu, rowButtons];
}

const _lastVoiceStatus = new Map();

async function setVoiceChannelStatus(voiceChannel, statusText) {
  if (!voiceChannel || !voiceChannel.id || !voiceChannel.client?.rest) return;
  const guildId = voiceChannel.guild?.id || voiceChannel.guildId;
  if (guildId) {
    const settingsManager = require('../structures/SettingsManager');
    const settings = settingsManager.get(guildId);
    if (settings && settings.updateVoiceStatus === false) return;
  }
  const cleanText = (statusText || '').slice(0, 500);
  if (_lastVoiceStatus.get(voiceChannel.id) === cleanText) return;
  if (_lastVoiceStatus.size >= 300) {
    const oldest = _lastVoiceStatus.keys().next().value;
    if (oldest !== undefined) _lastVoiceStatus.delete(oldest);
  }
  _lastVoiceStatus.set(voiceChannel.id, cleanText);
  try {
    await voiceChannel.client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
      body: { status: cleanText }
    });
  } catch (err) {}
}

async function clearVoiceChannelStatus(voiceChannel) {
  if (!voiceChannel || !voiceChannel.id || !voiceChannel.client?.rest) return;
  if (!_lastVoiceStatus.get(voiceChannel.id)) return;
  _lastVoiceStatus.delete(voiceChannel.id);
  try {
    await voiceChannel.client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
      body: { status: '' }
    });
  } catch (err) {}
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
  createNowPlayingCard,
  createNowPlayingEmbed,
  createMusicControls,
  createNowPlayingV2Payload,
  createQueueEmbed,
  createQueueContainer,
  createQueuePaginationButtons,
  createQueueDeleteSelectMenu,
  createSettingsEmbed,
  createSettingsSelectMenu,
  createAutoplayLayersEmbed,
  createAutoplayLayersComponents,
  is247Track,
  createProgressBar,
  formatDurationMs,
  parseDurationToMs,
  formatMarkdownTitle,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
};
