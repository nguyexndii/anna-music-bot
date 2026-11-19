const express = require('express');
const { getLyrics, saveLyricOffset, reportLyricCacheIssue } = require('../utils/lyricsHelper');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission, isStrictAdmin } = require('../utils/permissionHelper');

module.exports = function createLyricsRoutes(client, auth, routeState) {
  const router = express.Router();

  // 1. Lấy Lời bài hát (Karaoke Lyrics) cho Guild cụ thể
  router.get('/guilds/:guildId/lyrics', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const currentTrack = queue?.currentSong || queue?.currentTrack;

    if (!queue || !currentTrack) {
      return res.json({ success: true, lyrics: 'Không có bài hát nào đang phát', synced: false });
    }

    try {
      let rawArtist = currentTrack.artist || '';
      if (rawArtist === 'YouTube Music' || rawArtist === 'YouTube' || rawArtist === 'Unknown') {
        rawArtist = '';
      }
      const rawTitle = currentTrack.title || '';
      const safeTitle = typeof rawTitle === 'string' ? rawTitle.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
      const queryArtist = typeof rawArtist === 'string' ? rawArtist.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';

      let durMs = currentTrack.durationMs;
      if (!durMs && currentTrack.duration && currentTrack.duration !== 'LIVE') {
        const p = currentTrack.duration.split(':').map(Number);
        if (!p.some(isNaN)) {
          durMs = p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 : (p.length === 2 ? (p[0] * 60 + p[1]) * 1000 : p[0] * 1000);
        }
      }
      const guildSettings = settingsManager.get(guildId);
      const songDurMs = currentTrack.rawDurationSec ? currentTrack.rawDurationSec * 1000 : (durMs || 0);
      const lyricsData = await getLyrics(safeTitle, queryArtist, songDurMs, currentTrack.url, guildSettings?.lyricsLayers);

      // Nếu bài hát đang phát chưa có Live Lyrics trên Discord mà API vừa tìm thấy lời -> Tự động nạp nóng (Hot-Attach)
      if (queue && queue.currentSong && !queue.hasSyncedLyrics && lyricsData?.syncedLyrics?.length >= 3) {
        queue.attachLateLyrics(queue.currentSong, lyricsData);
      }

      let activeSyncedLyrics = lyricsData?.syncedLyrics || null;
      let activeAutoOffsetMs = lyricsData?.autoOffsetMs || 0;

      // Chuẩn hóa hệ quy chiếu Lyrics khi bài hát có SponsorBlock Trim (Clone an toàn, không mutate cache)
      if (lyricsData && (currentTrack.trimStart > 0 || currentTrack.trimEnd > 0)) {
        const trimStartMs = (currentTrack.trimStart || 0) * 1000;
        const realDurMs = currentTrack.durationMs || 0;
        activeAutoOffsetMs = 0;

        const lastLineMs = Array.isArray(lyricsData.syncedLyrics) && lyricsData.syncedLyrics.length > 0
          ? (lyricsData.syncedLyrics[lyricsData.syncedLyrics.length - 1].time || 0)
          : 0;
        const lyricDurSec = Number(lyricsData.duration) || Math.round(lastLineMs / 1000);
        const rawSec = currentTrack.rawDurationSec || 0;
        const realSec = currentTrack.realDurationSec || Math.round(realDurMs / 1000);

        // Chỉ dịch lùi mốc thời gian nếu là phụ đề gốc của video YouTube (youtube_cc) có intro > 500ms,
        // HOẶC trường hợp đặc biệt lời ngoài khớp với thời lượng raw video (diffRaw <= 3 && diffReal >= 8)
        let shouldShiftTimestamps = false;
        if (lyricsData.source === 'youtube_cc') {
          shouldShiftTimestamps = trimStartMs > 500;
        } else if (rawSec > realSec && lyricDurSec > 0) {
          const diffRaw = Math.abs(lyricDurSec - rawSec);
          const diffReal = Math.abs(lyricDurSec - realSec);
          shouldShiftTimestamps = diffRaw <= 3 && diffReal >= 8;
        }

        if (shouldShiftTimestamps && trimStartMs > 0 && Array.isArray(lyricsData.syncedLyrics)) {
          activeSyncedLyrics = lyricsData.syncedLyrics
            .map(line => ({
              ...line,
              time: line.time - trimStartMs,
              time_ms: (line.time_ms ?? line.time) - trimStartMs
            }))
            .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
            .map(line => ({
              ...line,
              time: Math.max(0, line.time),
              time_ms: Math.max(0, line.time_ms)
            }));
        }
      }

      // Nếu queue đã có cachedSyncedLyrics chuẩn hóa theo SponsorBlock trimStart cho bài hiện tại -> Đồng bộ ưu tiên
      if (queue && queue.currentSong === currentTrack && queue.hasSyncedLyrics) {
        if (Array.isArray(queue.cachedSyncedLyrics)) {
          activeSyncedLyrics = queue.cachedSyncedLyrics;
        }
        activeAutoOffsetMs = (queue.autoLyricOffsetMs !== undefined) ? queue.autoLyricOffsetMs : activeAutoOffsetMs;
      }

      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || currentTrack.title,
        artist: lyricsData?.artist || (currentTrack.artist && currentTrack.artist !== 'YouTube Music' ? currentTrack.artist : (lyricsData?.artist || '')),
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: activeAutoOffsetMs,
        userSavedOffsetMs: (queue && queue.currentSong === currentTrack && typeof queue.userLyricOffsetMs === 'number') ? queue.userLyricOffsetMs : (lyricsData?.userSavedOffsetMs || 0),
        trackKey: lyricsData?.trackKey || null,
        songFingerprint: lyricsData?.songFingerprint || null,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: activeSyncedLyrics,
        synced: !!activeSyncedLyrics,
        source: lyricsData?.source || 'lrclib',
        isRemixOrDurationMismatch: Boolean(lyricsData?.isRemixOrDurationMismatch),
        isExternalSource: Boolean(lyricsData?.source && lyricsData.source !== 'youtube_cc')
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  // 2. Tra cứu lời bài hát trực tiếp theo title/artist/duration/url
  router.get('/lyrics', auth.requireAuth, auth.lyricsLimiter, async (req, res) => {
    const rawTitle = req.query.title || req.query.q;
    const rawArtist = req.query.artist || '';
    const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
    const artist = typeof rawArtist === 'string' ? rawArtist.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, 150) : '';
    const durationMs = parseInt(req.query.duration, 10) || 0;
    const targetUrl = req.query.url || null;
    if (!title) {
      return res.json({ success: false, error: 'Thiếu tham số title' });
    }
    try {
      let queryArtist = artist || '';
      if (queryArtist === 'YouTube Music' || queryArtist === 'YouTube' || queryArtist === 'Unknown') {
        queryArtist = '';
      }
      const lyricsData = await getLyrics(title, queryArtist, durationMs, targetUrl);

      const callerQueue = req.user?.guildId && client.musicManager ? client.musicManager.get(req.user.guildId) : null;
      if (callerQueue && callerQueue.currentSong && !callerQueue.hasSyncedLyrics && lyricsData?.syncedLyrics?.length >= 3) {
        callerQueue.attachLateLyrics(callerQueue.currentSong, lyricsData);
      }

      let activeSyncedLyrics = lyricsData?.syncedLyrics || null;
      let activeAutoOffsetMs = lyricsData?.autoOffsetMs || 0;
      const currentTrack = callerQueue?.currentSong;
      if (currentTrack && lyricsData && (currentTrack.trimStart > 0 || currentTrack.trimEnd > 0) && (!targetUrl || targetUrl === currentTrack.url)) {
        const trimStartMs = (currentTrack.trimStart || 0) * 1000;
        const realDurMs = currentTrack.durationMs || 0;
        activeAutoOffsetMs = 0;

        const lastLineMs = Array.isArray(lyricsData.syncedLyrics) && lyricsData.syncedLyrics.length > 0
          ? (lyricsData.syncedLyrics[lyricsData.syncedLyrics.length - 1].time || 0)
          : 0;
        const lyricDurSec = Number(lyricsData.duration) || Math.round(lastLineMs / 1000);
        const rawSec = currentTrack.rawDurationSec || 0;
        const realSec = currentTrack.realDurationSec || Math.round(realDurMs / 1000);

        let shouldShiftTimestamps = false;
        if (lyricsData.source === 'youtube_cc') {
          shouldShiftTimestamps = trimStartMs > 500;
        } else if (rawSec > realSec && lyricDurSec > 0) {
          const diffRaw = Math.abs(lyricDurSec - rawSec);
          const diffReal = Math.abs(lyricDurSec - realSec);
          shouldShiftTimestamps = diffRaw <= 3 && diffReal >= 8;
        }

        if (shouldShiftTimestamps && trimStartMs > 0 && Array.isArray(lyricsData.syncedLyrics)) {
          activeSyncedLyrics = lyricsData.syncedLyrics
            .map(line => ({
              ...line,
              time: line.time - trimStartMs,
              time_ms: (line.time_ms ?? line.time) - trimStartMs
            }))
            .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
            .map(line => ({
              ...line,
              time: Math.max(0, line.time),
              time_ms: Math.max(0, line.time_ms)
            }));
        }
      }

      // Nếu callerQueue đã có cachedSyncedLyrics chuẩn hóa theo SponsorBlock trimStart cho bài hiện tại -> Đồng bộ ưu tiên
      if (callerQueue && callerQueue.currentSong === currentTrack && (!targetUrl || targetUrl === currentTrack?.url) && callerQueue.hasSyncedLyrics) {
        if (Array.isArray(callerQueue.cachedSyncedLyrics)) {
          activeSyncedLyrics = callerQueue.cachedSyncedLyrics;
        }
        activeAutoOffsetMs = (callerQueue.autoLyricOffsetMs !== undefined) ? callerQueue.autoLyricOffsetMs : activeAutoOffsetMs;
      }

      const hasLyrics = Boolean(lyricsData && lyricsData.lyrics && lyricsData.lyrics.trim().length > 0);
      return res.json({
        success: hasLyrics,
        title: lyricsData?.title || title,
        artist: lyricsData?.artist || artist,
        isLofi: !!lyricsData?.isLofi,
        isAiGenerated: !!lyricsData?.isAiGenerated,
        autoOffsetMs: activeAutoOffsetMs,
        userSavedOffsetMs: (callerQueue && callerQueue.currentSong === currentTrack && typeof callerQueue.userLyricOffsetMs === 'number') ? callerQueue.userLyricOffsetMs : (lyricsData?.userSavedOffsetMs || 0),
        trackKey: lyricsData?.trackKey || null,
        songFingerprint: lyricsData?.songFingerprint || null,
        lyrics: hasLyrics ? lyricsData.lyrics : null,
        syncedLyrics: activeSyncedLyrics,
        synced: !!activeSyncedLyrics,
        source: lyricsData?.source || 'lrclib',
        isRemixOrDurationMismatch: Boolean(lyricsData?.isRemixOrDurationMismatch),
        isExternalSource: Boolean(lyricsData?.source && lyricsData.source !== 'youtube_cc')
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi lấy lời bài hát' });
    }
  });

  // 3. Lưu nhớ mốc bù trừ lời bài hát (Offset) cho Guild
  router.post('/guilds/:guildId/lyrics/offset', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { trackKey, offsetMs, title, artist } = req.body;
    const numOffset = Number(offsetMs);
    if (!trackKey || !Number.isFinite(numOffset)) {
      return res.status(400).json({ success: false, error: 'Thiếu tham số trackKey hoặc offsetMs hợp lệ' });
    }

    const { guildId } = req.params;
    const user = req.user;
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const botVoice = queue?.voiceChannel || req.guild?.members?.me?.voice?.channel;
    const userVoice = req.member?.voice?.channel;
    const isAdmin = await auth.checkIsAdmin(guildId, user.userId);

    if (!isAdmin && (!userVoice || !botVoice || userVoice.id !== botVoice.id)) {
      return res.status(403).json({
        success: false,
        error: 'Bạn phải ở cùng kênh thoại với bot để điều chỉnh bù trễ lời bài hát!'
      });
    }

    const clampedOffset = Math.max(-60000, Math.min(60000, Math.round(numOffset)));

    // Kiểm tra quyền lưu mốc toàn server: Admin / DJ hoặc là người gọi bài hát đang phát
    const canSaveGlobal = isAdmin || hasMusicPermission(req.member) || (queue?.currentSong?.requestedById === user.userId);
    if (!canSaveGlobal) {
      return res.json({ success: true, localOnly: true, trackKey, offsetMs: clampedOffset });
    }

    try {
      await saveLyricOffset(trackKey, clampedOffset, title, artist);

      // Đồng bộ ngay lập tức sang hàng đợi MusicQueue đang phát nếu có
      if (queue && queue.currentSong) {
        queue.userLyricOffsetMs = clampedOffset;
        queue.currentLyricOffsetMs = clampedOffset + (queue.autoLyricOffsetMs || 0);
        if (queue.hasSyncedLyrics) {
          queue._lastLyricsEditTime = 0; // Bỏ qua cooldown để cập nhật Card ngay
          queue.scheduleNextLyricUpdate(queue.currentSong);
        }
      }

      return res.json({ success: true, trackKey, offsetMs: clampedOffset });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 4. Lưu nhớ mốc bù trừ lời bài hát (Offset) theo User Guild session
  router.post('/lyrics/offset', auth.requireAuth, async (req, res) => {
    const { trackKey, offsetMs, title, artist } = req.body;
    const numOffset = Number(offsetMs);
    if (!trackKey || !Number.isFinite(numOffset)) {
      return res.status(400).json({ success: false, error: 'Thiếu tham số trackKey hoặc offsetMs hợp lệ' });
    }

    const guildId = req.user.guildId;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin máy chủ trong phiên đăng nhập' });
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }
    const member = guild.members.cache.get(req.user.userId) || await guild.members.fetch(req.user.userId).catch(() => null);
    if (!member) {
      return res.status(403).json({ success: false, error: 'Bạn không phải thành viên máy chủ này' });
    }

    const isAdmin = isStrictAdmin(member);
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const botVoice = queue?.voiceChannel || guild.members.me?.voice?.channel;
    const userVoice = member.voice?.channel;

    if (!isAdmin && (!userVoice || !botVoice || userVoice.id !== botVoice.id)) {
      return res.status(403).json({
        success: false,
        error: 'Bạn phải ở cùng kênh thoại với bot để điều chỉnh bù trễ lời bài hát!'
      });
    }

    const clampedOffset = Math.max(-60000, Math.min(60000, Math.round(numOffset)));

    // Kiểm tra quyền lưu mốc toàn server: Admin / DJ hoặc là người gọi bài hát đang phát
    const canSaveGlobal = isAdmin || hasMusicPermission(member) || (queue?.currentSong?.requestedById === req.user.userId);
    if (!canSaveGlobal) {
      return res.json({ success: true, localOnly: true, trackKey, offsetMs: clampedOffset });
    }

    try {
      await saveLyricOffset(trackKey, clampedOffset, title, artist);

      // Đồng bộ ngay lập tức sang hàng đợi MusicQueue đang phát nếu có
      if (queue && queue.currentSong) {
        queue.userLyricOffsetMs = clampedOffset;
        queue.currentLyricOffsetMs = clampedOffset + (queue.autoLyricOffsetMs || 0);
        if (queue.hasSyncedLyrics) {
          queue._lastLyricsEditTime = 0; // Bỏ qua cooldown để cập nhật Card ngay
          queue.scheduleNextLyricUpdate(queue.currentSong);
        }
      }

      return res.json({ success: true, trackKey, offsetMs: clampedOffset });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 5. Kiểm tra trạng thái hoạt động của các tầng Lyric (Diagnostics / Health Check)
  router.get('/lyrics/status', auth.requireAuth, auth.lyricsLimiter, async (req, res) => {
    // 1. Kiểm tra Tầng 1: LRCLIB (Spotify/Apple Music Open DB)
    let tier1 = {
      tier: 1,
      name: 'LRCLIB (Direct Open API)',
      sources: 'Spotify / Apple Music Community Database',
      speed: 'Siêu tốc (50ms - 150ms)',
      status: 'CHECKING',
      pingMs: 0
    };
    const t0 = Date.now();
    try {
      const r1 = await fetch('https://lrclib.net/api/get?track_name=test&artist_name=test', {
        headers: { 'User-Agent': 'AnnaMusicBot/2.0' },
        signal: AbortSignal.timeout(3500)
      });
      tier1.pingMs = Date.now() - t0;
      tier1.status = (r1.status === 200 || r1.status === 404) ? 'ONLINE (Hoạt động tốt)' : `HTTP_${r1.status}`;
    } catch (e) {
      tier1.status = 'OFFLINE (' + e.message + ')';
    }

    // 2. Kiểm tra Tầng 2: Python Microservice (syncedlyrics)
    const fallbackBaseUrl = process.env.LYRICS_FALLBACK_URL || 'http://127.0.0.1:8787/lyrics';
    const healthUrl = fallbackBaseUrl.replace(/\/lyrics\/?$/, '/health');
    let tier2 = {
      tier: 2,
      name: 'Python Fallback Microservice',
      sources: 'Musixmatch, NetEase Music, Genius',
      speed: 'Toàn diện (1s - 2.5s)',
      url: healthUrl,
      status: 'CHECKING',
      pingMs: 0
    };
    const t1 = Date.now();
    try {
      const r2 = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000)
      });
      tier2.pingMs = Date.now() - t1;
      if (r2.ok) {
        const d2 = await r2.json().catch(() => ({}));
        tier2.status = d2.status === 'ok' ? 'ONLINE (Hoạt động tốt)' : 'ONLINE';
      } else {
        tier2.status = `HTTP_${r2.status}`;
      }
    } catch (e) {
      tier2.status = 'OFFLINE (Chưa bật service trên VPS hoặc port 8787 chưa lắng nghe)';
    }

    // 3. Kiểm tra Tầng 3: Zing MP3 Lyrics Engine (Karaoke V-Pop)
    let tier3 = {
      tier: 3,
      name: 'Zing MP3 Lyrics Engine',
      sources: 'Zing MP3 Karaoke Database (V-Pop chính xác từng câu/từ)',
      speed: 'Cực nhanh (100ms - 250ms)',
      status: 'CHECKING',
      pingMs: 0
    };
    const t2 = Date.now();
    try {
      const r3 = await fetch('https://ac.zingmp3.vn/complete?type=artist,song,key,hub&num=1&query=test', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000)
      });
      tier3.pingMs = Date.now() - t2;
      tier3.status = r3.ok ? 'ONLINE (Hoạt động tốt)' : `HTTP_${r3.status}`;
    } catch (e) {
      tier3.status = 'OFFLINE (' + e.message + ')';
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      architecture: 'Mô hình 4 Tầng Lời Bài Hát Đa Nguồn: YouTube CC -> Zing MP3 (V-Pop Karaoke) -> LRCLIB (Spotify/Apple Music) -> Python Microservice (Musixmatch)',
      providers: [tier1, tier2, tier3],
      summary: {
        tier1Online: tier1.status.startsWith('ONLINE'),
        tier2Online: tier2.status.startsWith('ONLINE'),
        tier3Online: tier3.status.startsWith('ONLINE'),
        message: 'Hệ thống lời bài hát đa nguồn đang hoạt động sẵn sàng (hỗ trợ cả karaoke đồng bộ và lyric đọc toàn diện)!'
      }
    });
  });

  // 6. Báo lỗi lời bài hát (Anti-DoS Invalidation với Rate Limiter: tối đa 3 report / 10 phút / user)
  const reportLimiter = new Map();

  const handleReport = async (req, res) => {
    const { songFingerprint } = req.body;
    const userId = req.user?.userId;
    if (!songFingerprint || !userId) {
      return res.status(400).json({ success: false, error: 'Thiếu songFingerprint hoặc userId' });
    }

    const now = Date.now();
    const userReports = (reportLimiter.get(userId) || []).filter(ts => now - ts < 10 * 60 * 1000);
    if (userReports.length >= 3) {
      return res.status(429).json({ success: false, error: 'Bạn đã báo lỗi quá nhiều lần, vui lòng thử lại sau 10 phút' });
    }
    userReports.push(now);
    reportLimiter.set(userId, userReports);

    const result = await reportLyricCacheIssue(songFingerprint, userId);
    return res.json(result);
  };

  router.post('/lyrics/report', auth.requireAuth, handleReport);
  router.post('/guilds/:guildId/lyrics/report', auth.requireAuth, auth.requireSameGuild, handleReport);

  return router;
};
