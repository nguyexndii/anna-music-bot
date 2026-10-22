const settingsManager = require('../structures/SettingsManager');

const dictionaries = {
  vi: {
    common: {
      no_permission: '❌ Bạn không có quyền sử dụng lệnh này! Lệnh chỉ dành cho **Quản trị viên máy chủ**.',
      dj_only: '🎧 Chế độ DJ đang bật! Bạn cần có vai trò {role} để thực hiện thao tác này.',
      no_voice: '🔇 Bạn cần ở trong một kênh Voice để nghe nhạc!',
      different_voice: '⚠️ Bạn phải ở cùng kênh Voice [**{channel}**] với bot để thực hiện lệnh!',
      voice_locked: '🔒 Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#{channelId}> để nghe nhạc.',
      text_locked: '💬 Vui lòng sử dụng các lệnh âm nhạc trong kênh <#{channelId}>!',
      admin_only_247: '⚠️ Bot đang phát nhạc chế độ Lofi 24/7! Chỉ Quản trị viên (Admin) mới có quyền dừng hoặc mời bot rời phòng.',
      no_queue: 'Bot hiện không phát nhạc trong máy chủ này!',
      no_song_playing: 'Không có bài hát nào đang phát!',
      track_not_found: 'Không tìm thấy bài hát hoặc Playlist phù hợp với từ khóa này!',
      invalid_url: 'Đường dẫn liên kết không được hỗ trợ hoặc không an toàn!',
      command_error: 'Đã xảy ra lỗi khi thực thi lệnh này!'
    },
    player: {
      now_playing: 'Đang Phát Nhạc',
      duration: 'Thời lượng',
      requested_by: 'Yêu cầu bởi',
      queue_status: 'Hàng chờ',
      queue_empty_247: '🎵 Hàng chờ trống! Bot đang phát nhạc nền Lofi 24/7.\nDùng `/play <tên_bài>` hoặc **Web Player** để thêm nhạc.',
      queue_empty: '🎵 Hàng chờ hiện đang trống! Dùng lệnh `/play <tên_bài>` để thêm bài hát yêu thích.',
      next_track: 'Tiếp theo: {title} (+{count} bài trong hàng chờ)',
      no_next_track: 'Không còn bài hát nào trong hàng chờ',
      radio_card_title: 'Đài Phát Thanh Lofi 24/7',
      radio_card_desc: 'Nhạc nền Lofi thư giãn đang phát liên tục 24/7',
      added_single: '➕ Đã thêm vào hàng chờ: **[{title}]({url})** — `{duration}` (Vị trí: #{position})',
      added_playlist: '📁 Đã thêm thành công **{count} bài hát** từ Playlist **{title}** vào hàng chờ!',
      paused: '⏸️ Đã tạm dừng phát nhạc: **{title}**',
      resumed: '▶️ Tiếp tục phát nhạc: **{title}**',
      already_paused: '⏸️ Bài hát đã được tạm dừng từ trước!',
      already_playing: '▶️ Bài hát đang phát bình thường!',
      stopped: '⏹️ Đã dừng phát nhạc và dọn dẹp hàng chờ!',
      loop_off: '🔁 Chế độ lặp: **Đã tắt**',
      loop_song: '🔂 Chế độ lặp: **Lặp bài hát hiện tại**',
      loop_queue: '🔁 Chế độ lặp: **Lặp toàn bộ hàng chờ**',
      shuffled: '🔀 Đã trộn ngẫu nhiên **{count} bài hát** trong hàng chờ!',
      shuffle_not_enough: '⚠️ Cần ít nhất 2 bài hát trong hàng chờ để trộn!',
      volume_set: '🔊 Âm lượng đã được đặt thành: **{volume}%**',
      volume_invalid: '⚠️ Vui lòng nhập mức âm lượng từ 1 đến 100%!',
      seek_success: '⏩ Đã tua đến: **{time}**',
      seek_invalid: '⚠️ Thời gian tua không hợp lệ! Vui lòng nhập số giây hoặc định dạng mm:ss.',
      radio_247_playing: '♾️ Bot đang phát Đài Radio Lofi 24/7 tự động.',
      radio_cannot_control: '♾️ Bot đang phát Đài Radio Lofi 24/7 tự động. Bạn không thể dừng/tua/bỏ qua đài Radio, hãy dùng lệnh `/play <tên bài>` để phát nhạc của bạn nhé!',
      empty_room_pause: '⏸️ Không có người nghe trong phòng, bot tạm dừng phát để tiết kiệm tài nguyên.',
      empty_room_resume: '▶️ Đã có người vào phòng, bot tiếp tục phát nhạc!'
    },
    btn: {
      favorite: 'Thích',
      back: 'Trước',
      loading: 'Đang tải...',
      pause: 'Tạm dừng',
      resume: 'Tiếp tục',
      skip: 'Bỏ qua',
      skipping: 'Đang chuyển...',
      stop: 'Dừng',
      stopping: 'Đang dừng...',
      queue: 'Hàng chờ',
      loop_off: 'Lặp: Tắt',
      loop_track: 'Lặp: Bài',
      loop_queue: 'Lặp: Danh sách',
      autoplay_on: 'Tự phát: Bật',
      autoplay_off: 'Tự phát: Tắt',
      add_song: 'Thêm bài',
      playlist: 'Playlist',
      web_player: 'Web Player',
      open_controls: 'Mở bảng điều khiển'
    },
    modal: {
      add_song_title: '➕ Thêm bài hát hoặc Playlist',
      add_song_query_label: 'Tên bài hát, Link bài hoặc Link Playlist',
      add_song_placeholder: 'Dán link YouTube/Spotify Playlist (tối đa 20 bài) hoặc tên bài...'
    },
    skip: {
      force_admin: '⏭️ Quản trị viên đã bỏ qua bài hát: **{title}**',
      force_dj: '⏭️ DJ đã bỏ qua bài hát: **{title}**',
      force_requester: '⏭️ Người yêu cầu đã bỏ qua bài hát của mình: **{title}**',
      force_single: '⏭️ Đã bỏ qua bài hát: **{title}**',
      vote_progress: '🗳️ {user} đã bỏ phiếu bỏ qua ({current}/{required} phiếu). Cần thêm {needed} phiếu nữa!',
      vote_retracted: '🗳️ {user} đã hủy bỏ phiếu ({current}/{required} phiếu).',
      vote_passed: '⏭️ Đã đủ phiếu bầu ({current}/{required})! Đang bỏ qua bài hát: **{title}**'
    },
    sponsorblock: {
      skipped_intro: '-# ✂️ Đã tự động bỏ qua {seconds}s kịch mở đầu',
      skipped_outro: '-# ✂️ Đã tự động bỏ qua {seconds}s credit kết thúc'
    },
    web_notify: {
      added_tracks: '🎵 **{user}** đã nạp **{count} bài hát** từ Web Player vào hàng chờ!',
      added_favorites: '❤️ **{user}** đã nạp **{count} bài hát yêu thích** vào hàng chờ!',
      added_playlist: '📂 **{user}** đã nạp playlist **{name}** (`{count} bài`) từ Web Player vào hàng chờ!'
    },
    commands: {
      autoplay_enabled: '📻 Tự động phát tiếp (Autoplay): **Đã bật**',
      autoplay_disabled: '📻 Tự động phát tiếp (Autoplay): **Đã tắt**',
      mode247_enabled: '♾️ Chế độ 24/7: **Đã bật** (Bot sẽ duy trì kết nối và phát nhạc nền khi rảnh)',
      mode247_disabled: '♾️ Chế độ 24/7: **Đã tắt**',
      join_success: '👋 Đã tham gia kênh Voice: <#{channelId}>',
      leave_success: '👋 Đã ngắt kết nối khỏi phòng Voice!',
      favorite_added: '❤️ Đã thêm **{title}** vào danh sách yêu thích!',
      favorite_removed: '💔 Đã xóa **{title}** khỏi danh sách yêu thích!',
      favorite_none: '⚠️ Bạn chưa có bài hát yêu thích nào!',
      lockvoice_locked: '🔒 Đã khóa bot cố định vào kênh Voice: <#{channelId}>',
      lockvoice_unlocked: '🔓 Đã mở khóa kênh Voice! Bot có thể vào mọi kênh.',
      setchannel_locked: '💬 Đã đặt kênh nhận lệnh âm nhạc: <#{channelId}>',
      setchannel_unlocked: '💬 Đã mở khóa kênh chat! Cho phép dùng lệnh ở mọi kênh.',
      setlog_set: '📝 Đã đặt kênh ghi log: <#{channelId}>',
      setlog_unset: '📝 Đã tắt ghi log hoạt động.',
      setdj_enabled: '🎧 Đã bật chế độ DJ Only cho vai trò: <@&{roleId}>',
      setdj_disabled: '🎧 Đã tắt chế độ DJ Only.',
      setdj_require_role: '⚠️ Máy chủ chưa gán vai trò DJ! Vui lòng chỉ định một Role trước (ví dụ: `/setdj role:@DJ`).',
      ping_response: '🏓 Độ trễ WebSocket: `{ws}ms` | Thời gian phản hồi: `{api}ms`',
      remove_invalid: '⚠️ Số thứ tự bài hát không hợp lệ trong hàng chờ!',
      remove_success: '🗑️ Đã xóa bài hát **{title}** khỏi hàng chờ!',
      move_invalid: '⚠️ Vị trí bài hát không hợp lệ!',
      move_success: '↔️ Đã chuyển **{title}** từ vị trí #{from} sang #{to}!',
      lyrics_searching: '🔍 Đang tìm kiếm lời bài hát cho **{title}**...',
      lyrics_not_found: '❌ Không tìm thấy lời bài hát cho **{title}**!'
    }
  },
  en: {
    common: {
      no_permission: '❌ You do not have permission to use this command! Administrators only.',
      dj_only: '🎧 DJ Mode is active! You need the {role} role to perform this action.',
      no_voice: '🔇 You must be in a Voice channel to listen to music!',
      different_voice: '⚠️ You must be in the same Voice channel [**{channel}**] as the bot!',
      voice_locked: '🔒 Server voice channel is locked! Please join <#{channelId}> to play music.',
      text_locked: '💬 Please use music commands in <#{channelId}>!',
      admin_only_247: '⚠️ Bot is running in 24/7 Lofi Mode! Only Administrators have permission to stop or disconnect it.',
      no_queue: 'Bot is currently not playing music in this server!',
      no_song_playing: 'No song is currently playing!',
      track_not_found: 'No songs or playlists found matching your search!',
      invalid_url: 'Music link is unsupported or insecure!',
      command_error: 'An error occurred while executing this command!'
    },
    player: {
      now_playing: 'Now Playing',
      duration: 'Duration',
      requested_by: 'Requested by',
      queue_status: 'Queue',
      queue_empty_247: '🎵 Queue is empty! Playing 24/7 Lofi background radio.\nUse `/play <song_name>` or **Web Player** to add songs.',
      queue_empty: '🎵 Queue is currently empty! Use `/play <song_name>` to add your favorite tracks.',
      next_track: 'Next: {title} (+{count} tracks in queue)',
      no_next_track: 'No more songs in the queue',
      radio_card_title: '24/7 Lofi Radio Station',
      radio_card_desc: 'Relaxing 24/7 Lofi background music playing continuously',
      added_single: '➕ Added to queue: **[{title}]({url})** — `{duration}` (Position: #{position})',
      added_playlist: '📁 Successfully added **{count} songs** from Playlist **{title}** to queue!',
      paused: '⏸️ Paused track: **{title}**',
      resumed: '▶️ Resumed playback: **{title}**',
      already_paused: '⏸️ The track is already paused!',
      already_playing: '▶️ The track is already playing!',
      stopped: '⏹️ Stopped music playback and cleared queue!',
      loop_off: '🔁 Loop mode: **Disabled**',
      loop_song: '🔂 Loop mode: **Current song**',
      loop_queue: '🔁 Loop mode: **Entire queue**',
      shuffled: '🔀 Shuffled **{count} songs** in the queue!',
      shuffle_not_enough: '⚠️ Need at least 2 songs in the queue to shuffle!',
      volume_set: '🔊 Volume set to: **{volume}%**',
      volume_invalid: '⚠️ Please enter a volume level between 1 and 100%!',
      seek_success: '⏩ Seeked to: **{time}**',
      seek_invalid: '⚠️ Invalid seek time! Please provide seconds or mm:ss format.',
      radio_247_playing: '♾️ Bot is playing automatic 24/7 Lofi Radio.',
      radio_cannot_control: '♾️ Bot is playing automatic 24/7 Lofi Radio. You cannot pause/seek/skip the radio. Use `/play <song_name>` to play your own songs!',
      empty_room_pause: '⏸️ No listeners left in voice channel, paused playback to save resources.',
      empty_room_resume: '▶️ Listener rejoined voice channel, resuming music playback!'
    },
    btn: {
      favorite: 'Favorite',
      back: 'Back',
      loading: 'Loading...',
      pause: 'Pause',
      resume: 'Resume',
      skip: 'Skip',
      skipping: 'Skipping...',
      stop: 'Stop',
      stopping: 'Stopping...',
      queue: 'Queue',
      loop_off: 'Loop: Off',
      loop_track: 'Loop: Track',
      loop_queue: 'Loop: Queue',
      autoplay_on: 'Autoplay: On',
      autoplay_off: 'Autoplay: Off',
      add_song: 'Add Song',
      playlist: 'Playlist',
      web_player: 'Web Player',
      open_controls: 'Open Controls'
    },
    modal: {
      add_song_title: '➕ Add Song or Playlist',
      add_song_query_label: 'Song Name, Song Link or Playlist URL',
      add_song_placeholder: 'Paste YouTube/Spotify link (max 20 songs) or enter song name...'
    },
    skip: {
      force_admin: '⏭️ Administrator skipped track: **{title}**',
      force_dj: '⏭️ DJ skipped track: **{title}**',
      force_requester: '⏭️ Requester skipped their song: **{title}**',
      force_single: '⏭️ Skipped track: **{title}**',
      vote_progress: '🗳️ {user} voted to skip ({current}/{required} votes). Need {needed} more!',
      vote_retracted: '🗳️ {user} removed their vote ({current}/{required} votes).',
      vote_passed: '⏭️ Vote passed ({current}/{required})! Skipping track: **{title}**'
    },
    sponsorblock: {
      skipped_intro: '-# ✂️ Automatically skipped {seconds}s of intro',
      skipped_outro: '-# ✂️ Automatically skipped {seconds}s of outro'
    },
    web_notify: {
      added_tracks: '🎵 **{user}** added **{count} songs** from Web Player to queue!',
      added_favorites: '❤️ **{user}** added **{count} favorite songs** to queue!',
      added_playlist: '📂 **{user}** added playlist **{name}** (`{count} songs`) from Web Player to queue!'
    },
    commands: {
      autoplay_enabled: '📻 Autoplay: **Enabled**',
      autoplay_disabled: '📻 Autoplay: **Disabled**',
      mode247_enabled: '♾️ 24/7 Mode: **Enabled** (Bot will maintain connection and play Lofi when idle)',
      mode247_disabled: '♾️ 24/7 Mode: **Disabled**',
      join_success: '👋 Joined Voice channel: <#{channelId}>',
      leave_success: '👋 Disconnected from Voice channel!',
      favorite_added: '❤️ Added **{title}** to favorites!',
      favorite_removed: '💔 Removed **{title}** from favorites!',
      favorite_none: '⚠️ You have no favorite songs yet!',
      lockvoice_locked: '🔒 Locked bot to Voice channel: <#{channelId}>',
      lockvoice_unlocked: '🔓 Voice channel unlocked! Bot can join any channel.',
      setchannel_locked: '💬 Set music commands channel: <#{channelId}>',
      setchannel_unlocked: '💬 Commands channel unlocked! Commands allowed in all channels.',
      setlog_set: '📝 Set log channel: <#{channelId}>',
      setlog_unset: '📝 Activity logging disabled.',
      setdj_enabled: '🎧 DJ Only mode enabled for role: <@&{roleId}>',
      setdj_disabled: '🎧 DJ Only mode disabled.',
      setdj_require_role: '⚠️ No DJ role configured yet! Please specify a role first (e.g., `/setdj role:@DJ`).',
      ping_response: '🏓 WebSocket Latency: `{ws}ms` | API Response: `{api}ms`',
      remove_invalid: '⚠️ Invalid track index in the queue!',
      remove_success: '🗑️ Removed **{title}** from the queue!',
      move_invalid: '⚠️ Invalid track positions!',
      move_success: '↔️ Moved **{title}** from #{from} to #{to}!',
      lyrics_searching: '🔍 Searching lyrics for **{title}**...',
      lyrics_not_found: '❌ No lyrics found for **{title}**!'
    }
  }
};

// Alias backwards compatibility: Cho phép gọi errors.* tương đương common.*
dictionaries.vi.errors = dictionaries.vi.common;
dictionaries.en.errors = dictionaries.en.common;

/**
 * Lấy chuỗi ngôn ngữ theo Guild ID hoặc đối tượng Guild/Channel/Interaction
 * @param {string|Object|null} guildOrContext
 * @param {string} keyPath (ví dụ: 'player.now_playing' hoặc 'common.no_permission')
 * @param {Object} params (ví dụ: { title: 'Bài hát', count: 5 })
 * @returns {string}
 */
function t(guildOrContext, keyPath, params = {}) {
  let guildId = null;
  if (typeof guildOrContext === 'string') {
    guildId = guildOrContext;
  } else if (guildOrContext && typeof guildOrContext === 'object') {
    guildId = guildOrContext.guildId || guildOrContext.guild?.id || guildOrContext.id || null;
  }

  const settings = guildId ? settingsManager.get(guildId) : null;
  const lang = (settings && settings.language) ? settings.language : 'vi';
  const dict = dictionaries[lang] || dictionaries.vi;

  const keys = keyPath.split('.');
  let val = dict;
  for (const k of keys) {
    val = val?.[k];
    if (val === undefined) break;
  }

  if (typeof val !== 'string') {
    // Fallback sang tiếng Việt nếu thiếu khóa
    let fallback = dictionaries.vi;
    for (const k of keys) {
      fallback = fallback?.[k];
      if (fallback === undefined) break;
    }
    val = typeof fallback === 'string' ? fallback : keyPath;
  }

  let result = val;
  for (const [pk, pv] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${pk}\\}`, 'g'), String(pv !== undefined && pv !== null ? pv : ''));
  }

  return result;
}

module.exports = {
  t,
  dictionaries
};
