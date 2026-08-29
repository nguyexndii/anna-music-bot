// Anna Music Web Player & Dashboard Engine
let currentToken = localStorage.getItem('anna_web_token') || null;
let currentGuildId = localStorage.getItem('anna_guild_id') || null;
let currentUser = null;
let currentTrackData = null;
let isPlayingLocal = false;
let currentProgressMs = 0;
let totalDurationMs = 0;
let progressInterval = null;
let searchDebounceTimer = null;
let lyricsSyncedLines = [];

// 1. Khởi tạo & Đọc URL Token
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  const guildFromUrl = urlParams.get('guild');

  if (tokenFromUrl) {
    currentToken = tokenFromUrl;
    localStorage.setItem('anna_web_token', tokenFromUrl);
  }
  if (guildFromUrl) {
    currentGuildId = guildFromUrl;
    localStorage.setItem('anna_guild_id', guildFromUrl);
  }

  // Xóa token khỏi thanh địa chỉ để bảo mật
  if (tokenFromUrl || guildFromUrl) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Khởi tạo icons
  lucide.createIcons();

  // Xác thực token
  await authenticateUser();

  // Đăng ký sự kiện giao diện
  setupEventListeners();

  // Bắt đầu vòng lặp lấy dữ liệu nhạc thời gian thực
  startStatePolling();
});

// 2. Xác thực Token Người Dùng
async function authenticateUser() {
  if (!currentToken) {
    showAuthPrompt(true);
    return;
  }

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken })
    });

    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      currentGuildId = data.user.guildId;
      localStorage.setItem('anna_guild_id', currentGuildId);

      // Cập nhật Header
      document.getElementById('headerGuildName').innerHTML = `
        <span class="w-2 h-2 rounded-full bg-anna-green animate-pulse"></span>
        ${data.user.guildName || 'Server Discord'}
      `;
      document.getElementById('userName').textContent = data.user.displayName || data.user.username;
      if (data.user.avatar) {
        document.getElementById('userAvatar').src = data.user.avatar;
      }
      document.getElementById('userProfileBadge').classList.remove('hidden');
      document.getElementById('userProfileBadge').classList.add('flex');
      document.getElementById('btnOpenAuthModal').classList.add('hidden');

      showToast(`Đã kết nối thành công: @${data.user.displayName || data.user.username}!`);
      showAuthPrompt(false);
    } else {
      showAuthPrompt(true);
    }
  } catch (err) {
    console.error('[Auth Error]:', err);
    showAuthPrompt(true);
  }
}

function showAuthPrompt(show) {
  const modal = document.getElementById('authModal');
  if (show) {
    modal.classList.remove('hidden');
    document.getElementById('btnOpenAuthModal').classList.remove('hidden');
    document.getElementById('userProfileBadge').classList.add('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

// 3. Vòng Lặp Cập Nhật Trạng Thái Nhạc (Polling 1.5s)
function startStatePolling() {
  fetchPlayerState();
  setInterval(fetchPlayerState, 1500);

  // Bộ đếm thời gian mượt mà mỗi giây cho thanh trượt
  if (progressInterval) clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (isPlayingLocal && totalDurationMs > 0 && currentProgressMs < totalDurationMs) {
      currentProgressMs += 1000;
      updateProgressBarUI(currentProgressMs, totalDurationMs);
      updateSyncedLyricsHighlight(currentProgressMs);
    }
  }, 1000);
}

async function fetchPlayerState() {
  if (!currentGuildId) return;

  try {
    const res = await fetch(`/api/guilds/${currentGuildId}/state`);
    if (!res.ok) return;

    const data = await res.json();
    if (data.success && data.player) {
      renderPlayerState(data.player, data.guild);
    }
  } catch (err) {
    // Silently continue polling
  }
}

// 4. Render Giao Diện Trình Phát Nhạc
function renderPlayerState(player, guild) {
  const isPlaying = player.isPlaying && !player.isPaused;
  isPlayingLocal = isPlaying;

  // Header Guild Info
  if (guild?.name) {
    document.getElementById('headerGuildName').innerHTML = `
      <span class="w-2 h-2 rounded-full bg-anna-green"></span>
      ${guild.name}
    `;
  }

  // Voice Channel Info
  if (player.voiceChannel) {
    document.getElementById('voiceChannelName').textContent = player.voiceChannel.name;
    document.getElementById('voiceMembersCount').textContent = `${player.voiceChannel.memberCount || 0} thành viên đang nghe`;
    
    // Render member avatars
    const avatarsContainer = document.getElementById('voiceMembersAvatars');
    if (player.voiceChannel.members && player.voiceChannel.members.length > 0) {
      avatarsContainer.innerHTML = player.voiceChannel.members.slice(0, 4).map(m => `
        <img src="${m.avatar}" title="${m.name}" class="w-6 h-6 rounded-full border-2 border-anna-surface object-cover">
      `).join('');
    } else {
      avatarsContainer.innerHTML = '';
    }
  } else {
    document.getElementById('voiceChannelName').textContent = 'Chưa vào kênh Voice';
    document.getElementById('voiceMembersCount').textContent = '0 thành viên';
    document.getElementById('voiceMembersAvatars').innerHTML = '';
  }

  // Play/Pause Button & Visualizer Animation
  const iconPlayPause = document.getElementById('iconPlayPause');
  const vinylDisc = document.getElementById('vinylDisc');
  const visualizer = document.getElementById('audioVisualizer');

  if (isPlaying) {
    iconPlayPause.setAttribute('data-lucide', 'pause');
    vinylDisc.classList.add('vinyl-spinning');
    vinylDisc.classList.remove('vinyl-paused');
    visualizer.classList.add('animating');
    document.getElementById('badgePlayingStatus').innerHTML = `
      <span class="w-2 h-2 rounded-full bg-anna-green animate-ping"></span>
      <span>Đang phát</span>
    `;
  } else {
    iconPlayPause.setAttribute('data-lucide', 'play');
    vinylDisc.classList.add('vinyl-paused');
    visualizer.classList.remove('animating');
    document.getElementById('badgePlayingStatus').innerHTML = `
      <span class="w-2 h-2 rounded-full bg-anna-yellow"></span>
      <span>Tạm dừng</span>
    `;
  }
  lucide.createIcons();

  // 24/7 Badge
  if (player.mode247) {
    document.getElementById('badge247').classList.remove('hidden');
    document.getElementById('toggleSetting247').classList.add('bg-anna-pink');
    document.getElementById('toggleSetting247').classList.remove('bg-anna-border');
    document.getElementById('toggleSetting247').firstElementChild.classList.add('translate-x-5');
    document.getElementById('toggleSetting247').firstElementChild.classList.remove('translate-x-0.5');
  } else {
    document.getElementById('badge247').classList.add('hidden');
    document.getElementById('toggleSetting247').classList.remove('bg-anna-pink');
    document.getElementById('toggleSetting247').classList.add('bg-anna-border');
    document.getElementById('toggleSetting247').firstElementChild.classList.remove('translate-x-5');
    document.getElementById('toggleSetting247').firstElementChild.classList.add('translate-x-0.5');
  }

  // Volume Slider
  document.getElementById('volumeSlider').value = player.volume;
  document.getElementById('volumeValue').textContent = `${player.volume}%`;

  // Loop Badge
  const loopBadge = document.getElementById('loopBadge');
  if (player.loop === 'track') {
    loopBadge.textContent = '1';
    loopBadge.classList.remove('hidden');
  } else if (player.loop === 'queue') {
    loopBadge.textContent = '∞';
    loopBadge.classList.remove('hidden');
  } else {
    loopBadge.classList.add('hidden');
  }

  // Current Track Data
  if (player.current) {
    currentTrackData = player.current;
    document.getElementById('trackTitle').textContent = player.current.title;
    document.getElementById('artistName').textContent = player.current.artist || 'Anna Music DJ';
    
    if (player.current.thumbnail) {
      document.getElementById('trackThumbnail').src = player.current.thumbnail;
    }

    // Requester Badge
    const requesterName = player.current.requestedBy || 'Hệ thống (24/7)';
    document.getElementById('requesterName').textContent = requesterName;
    const reqAvatar = document.getElementById('requesterAvatar');
    if (player.current.requestedByAvatar) {
      reqAvatar.src = player.current.requestedByAvatar;
      reqAvatar.classList.remove('hidden');
    } else {
      reqAvatar.classList.add('hidden');
    }

    // Progress
    totalDurationMs = parseDurationStringToMs(player.current.duration);
    if (player.current.startTime) {
      currentProgressMs = Math.max(0, Date.now() - player.current.startTime);
    }
    updateProgressBarUI(currentProgressMs, totalDurationMs);
  } else {
    document.getElementById('trackTitle').textContent = 'Chưa có bài hát đang phát';
    document.getElementById('artistName').textContent = 'Anna Music DJ AI';
    document.getElementById('requesterName').textContent = 'Sẵn sàng';
    document.getElementById('requesterAvatar').classList.add('hidden');
    updateProgressBarUI(0, 0);
  }

  // Render Queue List
  renderQueueList(player.queue || []);
}

function updateProgressBarUI(currentMs, totalMs) {
  const timeElapsed = document.getElementById('timeElapsed');
  const timeDuration = document.getElementById('timeDuration');
  const progressBar = document.getElementById('trackProgressBar');

  if (!totalMs || totalMs <= 0) {
    timeElapsed.textContent = '0:00';
    timeDuration.textContent = 'Live';
    progressBar.style.width = '100%';
    return;
  }

  const percent = Math.min(100, Math.max(0, (currentMs / totalMs) * 100));
  progressBar.style.width = `${percent}%`;

  timeElapsed.textContent = formatMsToTime(currentMs);
  timeDuration.textContent = formatMsToTime(totalMs);
}

// 5. Render Danh Sách Hàng Chờ
function renderQueueList(queue) {
  const badgeCount = document.getElementById('queueBadgeCount');
  const emptyState = document.getElementById('queueEmptyState');
  const listContainer = document.getElementById('queueSongsList');

  badgeCount.textContent = queue.length;

  if (queue.length === 0) {
    emptyState.classList.remove('hidden');
    listContainer.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  listContainer.innerHTML = queue.map((song, idx) => `
    <div class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border/60 transition group">
      <div class="flex items-center gap-3 min-w-0">
        <span class="w-5 text-center text-xs font-mono font-bold text-anna-muted">${idx + 1}</span>
        <img src="${song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0">
        <div class="min-w-0">
          <p class="text-xs font-bold text-white truncate">${song.title}</p>
          <p class="text-[11px] text-anna-muted flex items-center gap-1.5 mt-0.5">
            <span>${song.artist || 'YouTube'}</span>
            <span>•</span>
            <span class="font-mono">${song.duration}</span>
            <span>•</span>
            <span class="text-[10px] text-anna-accent">👤 ${song.requestedBy || 'User'}</span>
          </p>
        </div>
      </div>

      <button onclick="removeQueueSong(${idx})" class="p-1.5 rounded-lg text-anna-muted hover:text-anna-red hover:bg-anna-red/10 transition opacity-0 group-hover:opacity-100" title="Xóa khỏi hàng chờ">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `).join('');

  lucide.createIcons();
}

// 6. Live Search Logic (Debounced Instant Search)
function handleSearchInput(e) {
  const query = e.target.value.trim();
  const btnClear = document.getElementById('btnClearSearch');
  const searchResultsList = document.getElementById('searchResultsList');
  const emptyState = document.getElementById('searchEmptyState');
  const loading = document.getElementById('searchLoading');

  if (query.length > 0) {
    btnClear.classList.remove('hidden');
  } else {
    btnClear.classList.add('hidden');
    searchResultsList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  loading.classList.remove('hidden');

  searchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=6`);
      const data = await res.json();
      loading.classList.add('hidden');

      if (data.success && data.results && data.results.length > 0) {
        emptyState.classList.add('hidden');
        renderSearchResults(data.results);
      } else {
        searchResultsList.innerHTML = `
          <div class="p-6 text-center text-xs text-anna-muted">
            Không tìm thấy bài hát phù hợp. Vui lòng thử từ khóa khác hoặc dán link trực tiếp!
          </div>
        `;
      }
    } catch (err) {
      loading.classList.add('hidden');
      console.error('[Live Search Error]:', err);
    }
  }, 300); // 300ms Debounce
}

function renderSearchResults(results) {
  const container = document.getElementById('searchResultsList');
  container.innerHTML = results.map(track => `
    <div class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border/70 transition">
      <div class="flex items-center gap-3 min-w-0">
        <img src="${track.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" class="w-12 h-12 rounded-xl object-cover flex-shrink-0">
        <div class="min-w-0">
          <p class="text-xs font-bold text-white line-clamp-1">${track.title}</p>
          <p class="text-[11px] text-anna-muted flex items-center gap-1.5 mt-0.5">
            <span>${track.artist}</span>
            <span>•</span>
            <span class="font-mono text-anna-text">${track.duration}</span>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1.5 flex-shrink-0">
        <button onclick='orderSong(${JSON.stringify(track).replace(/'/g, "&#39;")})' class="px-3 py-1.5 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition flex items-center gap-1 shadow-sm shadow-anna-accent/20 active:scale-95">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
          <span>Thêm</span>
        </button>
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

// 7. Thao Tác Gọi Bài (Order Song)
async function orderSong(track) {
  if (!currentGuildId) {
    showToast('Vui lòng kết nối server trước khi thêm bài!', 'error');
    return;
  }

  if (!currentToken) {
    showAuthPrompt(true);
    return;
  }

  try {
    showToast(`Đang thêm "${track.title}"...`);
    const res = await fetch(`/api/guilds/${currentGuildId}/play`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ track, token: currentToken })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`✅ ${data.message}`);
      fetchPlayerState();
    } else {
      showToast(`❌ ${data.error || 'Lỗi thêm bài hát'}`, 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ!', 'error');
  }
}

// 8. Thao Tác Điều Khiển Nhạc (Controls Action)
async function sendPlayerAction(action, value = null) {
  if (!currentGuildId) return;
  if (!currentToken) {
    showAuthPrompt(true);
    return;
  }

  try {
    const res = await fetch(`/api/guilds/${currentGuildId}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ action, value, token: currentToken })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      fetchPlayerState();
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('Lỗi gửi lệnh điều khiển!', 'error');
  }
}

async function removeQueueSong(index) {
  await sendPlayerAction('remove', index);
}

// 9. Lời Bài Hát (Synced Lyrics)
async function loadLyrics() {
  if (!currentGuildId) return;
  const content = document.getElementById('lyricsContent');
  const title = document.getElementById('lyricsTitle');
  const artist = document.getElementById('lyricsArtist');

  if (!currentTrackData) {
    content.innerHTML = '<p class="text-anna-muted">Chưa có bài hát nào đang phát để hiển thị lời.</p>';
    return;
  }

  title.textContent = currentTrackData.title;
  artist.textContent = currentTrackData.artist;
  content.innerHTML = '<div class="flex items-center justify-center py-8"><i data-lucide="loader-2" class="w-6 h-6 animate-spin text-anna-accent"></i></div>';
  lucide.createIcons();

  try {
    const res = await fetch(`/api/guilds/${currentGuildId}/lyrics`);
    const data = await res.json();

    if (data.success && data.syncedLyrics && data.syncedLyrics.length > 0) {
      lyricsSyncedLines = data.syncedLyrics;
      content.innerHTML = data.syncedLyrics.map((line, idx) => `
        <p id="lyric-${idx}" class="lyric-line text-anna-muted">${line.text}</p>
      `).join('');
    } else if (data.success && data.lyrics) {
      lyricsSyncedLines = [];
      content.innerHTML = `<div class="whitespace-pre-line text-xs leading-relaxed text-anna-text">${data.lyrics}</div>`;
    } else {
      content.innerHTML = '<p class="text-anna-muted">Không tìm thấy lời bài hát cho ca khúc này.</p>';
    }
  } catch (err) {
    content.innerHTML = '<p class="text-anna-red">Lỗi tải lời bài hát.</p>';
  }
}

function updateSyncedLyricsHighlight(currentMs) {
  if (!lyricsSyncedLines || lyricsSyncedLines.length === 0) return;

  const currentSec = currentMs / 1000;
  let activeIdx = -1;

  for (let i = 0; i < lyricsSyncedLines.length; i++) {
    if (lyricsSyncedLines[i].time <= currentSec) {
      activeIdx = i;
    } else {
      break;
    }
  }

  if (activeIdx !== -1) {
    document.querySelectorAll('.lyric-line').forEach((el, idx) => {
      if (idx === activeIdx) {
        el.classList.add('lyric-active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        el.classList.remove('lyric-active');
      }
    });
  }
}

// 10. Đăng Ký Sự Kiện Giao Diện
function setupEventListeners() {
  // Tabs Navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      // Update Tab Buttons
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('bg-anna-accent', 'text-white', 'shadow-sm', 'shadow-anna-accent/20');
        b.classList.add('text-anna-muted', 'hover:text-white', 'hover:bg-anna-card');
      });
      btn.classList.add('bg-anna-accent', 'text-white', 'shadow-sm', 'shadow-anna-accent/20');
      btn.classList.remove('text-anna-muted', 'hover:text-white', 'hover:bg-anna-card');

      // Update Tab Contents
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById(targetTab)?.classList.remove('hidden');

      if (targetTab === 'tabLyrics') {
        loadLyrics();
      }
    });
  });

  // Controls
  document.getElementById('btnPlayPause').addEventListener('click', () => {
    sendPlayerAction(isPlayingLocal ? 'pause' : 'resume');
  });

  document.getElementById('btnNext').addEventListener('click', () => {
    sendPlayerAction('skip');
  });

  document.getElementById('btnPrevious').addEventListener('click', () => {
    sendPlayerAction('resume');
  });

  document.getElementById('btnShuffle').addEventListener('click', () => {
    sendPlayerAction('shuffle');
  });

  document.getElementById('btnLoop').addEventListener('click', () => {
    sendPlayerAction('loop');
  });

  document.getElementById('btnToggle247').addEventListener('click', () => {
    sendPlayerAction('toggle247');
  });

  document.getElementById('btnClearQueue').addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ bài hát trong hàng chờ không?')) {
      sendPlayerAction('stop');
    }
  });

  // Volume Slider
  let volumeDebounce = null;
  document.getElementById('volumeSlider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('volumeValue').textContent = `${val}%`;
    if (volumeDebounce) clearTimeout(volumeDebounce);
    volumeDebounce = setTimeout(() => {
      sendPlayerAction('volume', val);
    }, 150);
  });

  // Live Search Input
  document.getElementById('searchInput').addEventListener('input', handleSearchInput);
  document.getElementById('btnClearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    handleSearchInput({ target: { value: '' } });
  });

  // Quick Tags
  document.querySelectorAll('.quick-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const input = document.getElementById('searchInput');
      input.value = tag.textContent;
      handleSearchInput({ target: { value: tag.textContent } });
    });
  });

  // Auth Modal
  document.getElementById('btnOpenAuthModal').addEventListener('click', () => showAuthPrompt(true));
  document.getElementById('btnCloseAuthModal').addEventListener('click', () => showAuthPrompt(false));
  document.getElementById('btnSubmitToken').addEventListener('click', async () => {
    const token = document.getElementById('tokenInput').value.trim();
    if (!token) return;
    currentToken = token;
    localStorage.setItem('anna_web_token', token);
    await authenticateUser();
  });
}

// 11. Toast Notifications
function showToast(message, type = 'success') {
  const toast = document.getElementById('toastNotification');
  const toastMessage = document.getElementById('toastMessage');
  const toastIcon = document.getElementById('toastIcon');

  toastMessage.textContent = message;
  if (type === 'error') {
    toastIcon.className = 'w-6 h-6 rounded-lg bg-anna-red/20 text-anna-red flex items-center justify-center';
    toastIcon.innerHTML = '<i data-lucide="alert-circle" class="w-4 h-4"></i>';
  } else {
    toastIcon.className = 'w-6 h-6 rounded-lg bg-anna-green/20 text-anna-green flex items-center justify-center';
    toastIcon.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i>';
  }
  lucide.createIcons();

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3000);
}

// Helpers
function formatMsToTime(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function parseDurationStringToMs(durationStr) {
  if (!durationStr || durationStr === 'Live Stream' || durationStr.includes('Live')) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return parts[0] * 1000;
}
