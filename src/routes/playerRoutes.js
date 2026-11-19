const express = require('express');
const { searchTrack, validateAndSanitizeMusicUrl } = require('../utils/musicExtractor');
const searchService = require('../utils/searchService');
const searchMultipleTracks = searchService.searchMultipleTracks || searchService.executeSearch;
const { hasMusicPermission } = require('../utils/permissionHelper');
const settingsManager = require('../structures/SettingsManager');
const favoriteManager = require('../structures/FavoriteManager');
const userPlaylistManager = require('../structures/UserPlaylistManager');
const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const { logAction } = require('../utils/debugLogger');
const { EMOJI_TAG } = require('../utils/embed');
const { t } = require('../utils/i18n');
const { enforceMapLimit } = require('../utils/tokenHelper');

module.exports = function createPlayerRoutes(client, auth, routeState) {
  const router = express.Router();

  // 1. Live Search YouTube / Spotify (Rate-limited 30 req/phút, ủy quyền trực tiếp cho searchService điều phối worker & cache)
  router.get('/search', auth.requireAuth, auth.searchLimiter, async (req, res) => {
    let query = (req.query.q || '').slice(0, 150).trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 50));
    const mode = req.query.mode || 'official';

    // Chặn Argument Injection và kiểm tra độ dài tối thiểu
    if (!query || query.length < 2 || query.startsWith('-')) {
      return res.json({ success: true, results: [] });
    }

    try {
      const results = await searchMultipleTracks(query, limit, mode);
      return res.json({ success: true, results: results || [] });
    } catch (err) {
      console.error('[API Search Error]:', err);
      return res.status(500).json({ success: false, error: 'Lỗi tìm kiếm bài hát' });
    }
  });

  // Helper kiểm tra và xác thực kênh Voice đã khóa (lockedVoiceChannelId)
  async function checkLockedVoice(guildSettings, userVoice, guild, botMember, isAdmin = false) {
    if (guildSettings?.lockedVoiceChannelId && !isAdmin) {
      // Nếu bot đã ở trong một kênh voice và user đang ở cùng kênh voice đó thì luôn cho phép
      const queue = client.musicManager ? client.musicManager.get(guild.id) : null;
      const botVoiceId = queue?.voiceChannel?.id || queue?.voiceChannelId || guild.members.me?.voice?.channelId;
      if (botVoiceId && userVoice.id === botVoiceId) {
        return { allowed: true, targetChannel: userVoice };
      }

      if (userVoice.id !== guildSettings.lockedVoiceChannelId) {
        return {
          allowed: false,
          status: 400,
          error: `Máy chủ đã khóa kênh Voice! Vui lòng tham gia kênh <#${guildSettings.lockedVoiceChannelId}> để phát nhạc.`
        };
      }
      const targetChannel = guild.channels.cache.get(guildSettings.lockedVoiceChannelId) || await guild.channels.fetch(guildSettings.lockedVoiceChannelId).catch(() => null);
      if (!targetChannel || !targetChannel.isVoiceBased || !targetChannel.isVoiceBased()) {
        return {
          allowed: false,
          status: 400,
          error: 'Kênh voice đã khóa không còn tồn tại, vui lòng dùng /lockvoice để đặt lại.'
        };
      }
      const permissions = targetChannel.permissionsFor(botMember || client.user);
      if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
        return {
          allowed: false,
          status: 403,
          error: 'Bot không có quyền vào kênh voice đã khóa, vui lòng liên hệ admin.'
        };
      }
      return { allowed: true, targetChannel };
    }
    return { allowed: true, targetChannel: userVoice };
  }

  // 2. Helper format/serialize trạng thái player và endpoint /api/player (Telemetry & Uptime)
  function formatQueueState(queue, guild) {
    const sessionUptimeSec = queue?.voiceSessionStartTime
      ? Math.max(0, Math.floor((Date.now() - queue.voiceSessionStartTime) / 1000))
      : Math.floor(process.uptime());
    const botUptimeSec = Math.floor(process.uptime());
    return {
      sessionUptimeSec,
      botUptimeSec,
      isPlaying: queue ? queue.isPlaying : false,
      isPaused: queue ? queue.isPaused : false,
      volume: queue ? queue.volume : 80,
      loopMode: queue ? queue.loopMode : 'off',
      mode247: queue ? queue.mode247 : true,
      voiceSessionStartTime: queue?.voiceSessionStartTime || null,
      currentSong: queue?.currentSong || null,
      songs: queue?.songs || []
    };
  }

  router.get('/player', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const guildId = req.query.guildId || req.user?.guildId;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'Thiếu guildId' });
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }
    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const sessionUptimeSec = queue?.voiceSessionStartTime
      ? Math.max(0, Math.floor((Date.now() - queue.voiceSessionStartTime) / 1000))
      : Math.floor(process.uptime());
    const botUptimeSec = Math.floor(process.uptime());

    return res.json({
      success: true,
      guildId,
      sessionUptimeSec,
      botUptimeSec,
      player: {
        ...formatQueueState(queue, guild),
        sessionUptimeSec,
        botUptimeSec
      }
    });
  });

  // 3. Order / Thêm bài hát hoặc Playlist từ Web
  router.post('/guilds/:guildId/play', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    let { query, track } = req.body;
    if (typeof track === 'string') {
      track = { url: track.startsWith('http') ? track : undefined, searchQuery: track, title: track };
    }
    const user = req.user;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const guildSettings = settingsManager.get(guildId);
    const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
    let voiceChannel = null;

    // Tìm kênh text có quyền gửi tin nhắn
    let textChannel = null;
    if (guildSettings.musicChannelId) {
      const ch = guild.channels.cache.get(guildSettings.musicChannelId) || await guild.channels.fetch(guildSettings.musicChannelId).catch(() => null);
      if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
        textChannel = ch;
      }
    }
    const existingQueue = client.musicManager?.get(guildId);
    if (!textChannel && existingQueue?.textChannel?.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
      textChannel = existingQueue.textChannel;
    }
    if (!textChannel) {
      textChannel = guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
    }

    // Kiểm tra quyền DJ nếu máy chủ bật chế độ djOnly
    if (guildSettings.djOnly && !hasMusicPermission(req.member)) {
      return res.status(403).json({
        success: false,
        code: 'DJ_ONLY_REQUIRED',
        error: 'Máy chủ đang bật chế độ DJ Only. Bạn cần có vai trò DJ để phát nhạc!'
      });
    }

    // Kiểm tra User có thực sự đang ở trong kênh Voice trên Discord hay không
    const member = req.member || guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi thêm bài hát!' });
    }

    // Nếu Bot ĐÃ Ở TRONG một kênh Voice:
    // Bắt buộc User phải Ở CÙNG PHÒNG VOICE VỚI BOT!
    const botVoice = existingQueue?.voiceChannel || guild.members.me?.voice?.channel;
    if (botVoice && userVoice.id !== botVoice.id) {
      return res.status(400).json({
        success: false,
        error: `Bot đang ở trong kênh Voice "${botVoice.name}"! Bạn cần vào cùng phòng Voice với Bot để order nhạc.`
      });
    }

    // Nếu máy chủ đã khóa kênh Voice cố định (lockedVoiceChannelId)
    const lockCheck = await checkLockedVoice(guildSettings, userVoice, guild, botMember);
    if (!lockCheck.allowed) {
      return res.status(lockCheck.status).json({
        success: false,
        error: lockCheck.error
      });
    }
    voiceChannel = lockCheck.targetChannel || userVoice;

    let isLockHeld = false;
    try {
      // Bổ sung xử lý khi req.body.tracks là một mảng bài hát (ví dụ: Phát tất cả bài yêu thích):
      if (Array.isArray(req.body.tracks) && req.body.tracks.length > 0) {
        if (req.body.tracks.length > 1 && routeState.activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        if (req.body.tracks.length > 1) {
          routeState.activePlaylistLoads.add(guildId);
          isLockHeld = true;
        }
        try {
          const queue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
          const rawTracks = req.body.tracks.slice(0, 100);
          const validTracks = [];
          const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const requesterObj = {
            id: member.id,
            displayName: member.displayName || user.username,
            username: member.user?.username || user.username,
            avatar: memberAvatar
          };
          const userMention = `<@${member.id}>`;
          for (const t of rawTracks) {
            if (!t || typeof t !== 'object') continue;
            const safeTrackUrl = t.url ? validateAndSanitizeMusicUrl(t.url) : null;
            if (!safeTrackUrl) continue;
            t.url = safeTrackUrl;
            t.title = auth.sanitizeDiscordText(t.title, 200) || 'Unknown Track';
            t.artist = auth.sanitizeDiscordText(t.artist, 100) || 'Unknown Artist';
            t.thumbnail = auth.sanitizeThumbnailUrl(t.thumbnail);
            t.is247 = false;
            t.requestedBy = userMention;
            t.requestedByName = member.displayName || user.username;
            t.requestedByAvatar = memberAvatar;
            t.requestedById = member.id;
            validTracks.push(t);
          }
          if (validTracks.length === 0) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy bài hát hợp lệ để nạp vào hàng chờ!' });
          }
          await queue.addSongs(validTracks, requesterObj);
          auth.sendWebQueueNotification(req.guild, queue, guildSettings, t(guildId, 'web_notify.added_tracks', {
            user: member.displayName || user.username,
            count: validTracks.length
          }));
          return res.json({
            success: true,
            isPlaylist: true,
            addedCount: validTracks.length,
            track: validTracks[0],
            message: `Đã thêm ${validTracks.length} bài hát vào hàng chờ!`
          });
        } finally {
          if (isLockHeld) {
            routeState.activePlaylistLoads.delete(guildId);
            isLockHeld = false;
          }
        }
      }

      let rawResults = null;
      let requestedUrl = (query || track?.url || '').trim();

      // Kiểm tra URL an toàn chống SSRF
      if (requestedUrl.startsWith('http://') || requestedUrl.startsWith('https://')) {
        const safeUrl = validateAndSanitizeMusicUrl(requestedUrl);
        if (!safeUrl) {
          return res.status(400).json({ success: false, error: 'Đường dẫn liên kết không được hỗ trợ hoặc không an toàn' });
        }
        requestedUrl = safeUrl;
      }

      // Khóa trước khi searchTrack nếu là link Playlist
      const isPlaylistCandidate = /(?:list=|playlist|\/album\/|\/sets\/)/i.test(requestedUrl) || Boolean(track?.isPlaylist);
      if (isPlaylistCandidate) {
        if (routeState.activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        routeState.activePlaylistLoads.add(guildId);
        isLockHeld = true;
      }

      if (track && track.url && track.title && !track.isPlaylist) {
        rawResults = [track];
      } else if (track && (track.searchQuery || track.title) && !track.isPlaylist) {
        const q = track.searchQuery || `${track.title} ${track.artist || ''}`.trim();
        rawResults = await searchTrack(q);
      } else if (query || track?.url) {
        const targetQuery = query || track?.url;
        rawResults = await searchTrack(targetQuery);
      }

      if (!rawResults || rawResults.length === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy bài hát yêu cầu' });
      }

      const queue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
      let isFirst = !queue.currentSong || Boolean(queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)') || queue.songs.length === 0;
      const isPlaylist = Array.isArray(rawResults) && rawResults.length > 1;

      if (isPlaylist && !isLockHeld) {
        if (routeState.activePlaylistLoads.has(guildId)) {
          return res.status(429).json({
            success: false,
            error: 'Máy chủ đang nạp một danh sách phát khác, vui lòng chờ trong giây lát!'
          });
        }
        routeState.activePlaylistLoads.add(guildId);
        isLockHeld = true;
      }

      // XỬ LÝ NẠP TOÀN BỘ PLAYLIST
      if (isPlaylist) {
        rawResults = rawResults.slice(0, 100);
        const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
        const userMention = `<@${member.id}>`;
        for (const t of rawResults) {
          t.title = auth.sanitizeDiscordText(t.title, 200) || 'Unknown Track';
          t.artist = auth.sanitizeDiscordText(t.artist, 100) || 'Unknown Artist';
          t.thumbnail = auth.sanitizeThumbnailUrl(t.thumbnail);
          t.is247 = false;
          t.requestedBy = userMention;
          t.requestedByName = member.displayName || user.username;
          t.requestedByAvatar = memberAvatar;
          t.requestedById = member.id;
        }

        await queue.addSongs(rawResults, {
          id: member.id,
          displayName: member.displayName || user.username,
          username: member.user?.username || user.username,
          avatar: memberAvatar
        });

        // Lưu vào PlaylistHistoryManager
        playlistHistoryManager.addPlaylist(guildId, {
          url: requestedUrl,
          title: auth.sanitizeDiscordText(rawResults[0]?.playlistTitle || `Danh sách phát (${rawResults.length} bài)`, 200),
          trackCount: rawResults.length,
          thumbnail: auth.sanitizeThumbnailUrl(rawResults[0]?.playlistThumbnail || rawResults[0]?.thumbnail) || 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg',
          addedBy: member.displayName || user.username,
          addedByAvatar: memberAvatar,
          tracks: rawResults
        });
        routeState.guildStatsCache.delete(guildId);

        // Gửi thông báo Discord (Mẫu 5B Mini Embed)
        try {
          const musicChannelId = guildSettings.musicChannelId;
          const notifyChannel = musicChannelId
            ? guild.channels.cache.get(musicChannelId)
            : (queue.textChannel || guild.systemChannel);

          if (notifyChannel?.isTextBased?.()) {
            const { EmbedBuilder } = require('discord.js');
            const isEn = guildSettings?.language === 'en';
            const playlistTitle = auth.sanitizeDiscordText(rawResults[0]?.playlistTitle || (isEn ? `Playlist (${rawResults.length} tracks)` : `Danh sách phát (${rawResults.length} bài)`), 100);
            const userDisplayName = member.displayName || user.username;
            const notifDesc = isEn
              ? `${EMOJI_TAG.playlist || '📂'} **${userDisplayName}** added: [**${playlistTitle}**](${requestedUrl}) • \`${rawResults.length} songs\``
              : `${EMOJI_TAG.playlist || '📂'} **${userDisplayName}** đã thêm: [**${playlistTitle}**](${requestedUrl}) • \`${rawResults.length} bài\``;
            const notifEmbed = new EmbedBuilder()
              .setColor('#2B7FFF')
              .setDescription(notifDesc);
            notifyChannel.send({ embeds: [notifEmbed], flags: 4096 }).then(() => {
              if (queue && !isFirst) queue.scheduleRepostNowPlayingCard(600);
            }).catch(() => {});
          }
        } catch (e) {}

        return res.json({
          success: true,
          isPlaylist: true,
          trackCount: rawResults.length,
          message: `Đã thêm toàn bộ ${rawResults.length} bài hát từ Playlist vào hàng chờ!`,
          track: rawResults[0],
          tracks: rawResults,
          isFirst
        });
      }

      // XỬ LÝ 1 BÀI HÁT ĐƠN LẺ
      const targetTrack = rawResults[0];
      const memberAvatar = member.displayAvatarURL ? member.displayAvatarURL({ dynamic: true }) : user.avatar;
      const userMention = `<@${member.id}>`;

      // Làm sạch ký tự vô hình/zero-width và chuẩn hóa tiêu đề
      const cleanTitle = auth.sanitizeDiscordText(targetTrack.title, 200);
      const cleanArtist = auth.sanitizeDiscordText(targetTrack.artist, 100);
      const videoIdMatch = (targetTrack.url || '').match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const fallbackId = videoIdMatch ? videoIdMatch[1] : null;

      targetTrack.title = cleanTitle || (cleanArtist && cleanArtist !== 'YouTube' ? `${cleanArtist} - Audio` : (fallbackId ? `Bài hát không tên (${fallbackId})` : 'Bài hát không tên'));
      targetTrack.artist = cleanArtist || 'YouTube';
      targetTrack.thumbnail = auth.sanitizeThumbnailUrl(targetTrack.thumbnail);
      targetTrack.is247 = false;
      targetTrack.requestedBy = userMention;
      targetTrack.requestedByName = member.displayName || user.username;
      targetTrack.requestedByAvatar = memberAvatar;
      targetTrack.requestedById = member.id;

      const addRes = await queue.addSong(targetTrack, {
        id: member.id,
        displayName: member.displayName || user.username,
        username: member.user?.username || user.username,
        avatar: memberAvatar
      });
      if (addRes && typeof addRes.isPlayingNow === 'boolean') {
        isFirst = addRes.isPlayingNow;
      }

      // Gửi thông báo vào kênh nhạc đã cấu hình (Mẫu 5B Mini Embed)
      try {
        const musicChannelId = guildSettings.musicChannelId;
        const notifyChannel = musicChannelId
          ? guild.channels.cache.get(musicChannelId)
          : (queue.textChannel || guild.systemChannel);

        if (notifyChannel?.isTextBased?.()) {
          const { EmbedBuilder } = require('discord.js');
          const isEn = guildSettings?.language === 'en';
          const safeMarkdownTitle = targetTrack.title.replace(/\[/g, '(').replace(/\]/g, ')');
          const userDisplayName = user.displayName || user.username || member.displayName;
          const posText = typeof addRes?.position === 'number' ? ` • \`#${addRes.position}\`` : '';
          const notifDesc = isEn
            ? (isFirst
                ? `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** is playing: [**${safeMarkdownTitle}**](${targetTrack.url})`
                : `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** added to queue: [**${safeMarkdownTitle}**](${targetTrack.url})${posText}`)
            : (isFirst
                ? `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** đang phát: [**${safeMarkdownTitle}**](${targetTrack.url})`
                : `${EMOJI_TAG.web || '🌐'} **${userDisplayName}** đã thêm: [**${safeMarkdownTitle}**](${targetTrack.url})${posText}`);
          const notifEmbed = new EmbedBuilder()
            .setColor('#2B7FFF')
            .setDescription(notifDesc);
          logAction('MESSAGE_SEND', {
            type: 'WEB_PLAYER_NOTIFY',
            channelId: notifyChannel.id,
            guildId: guild.id,
            flags: 4096,
            content: `${isFirst ? 'playing' : 'queued'}: ${(targetTrack.title || '').slice(0, 60)}`
          });
          notifyChannel.send({ embeds: [notifEmbed], flags: 4096 }).then(() => {
            if (queue && !isFirst) queue.scheduleRepostNowPlayingCard(600);
          }).catch(() => {});
        }
      } catch (notifErr) {
        // Không crash nếu gửi thông báo lỗi
      }

      return res.json({
        success: true,
        message: isFirst ? `Đang phát "${targetTrack.title}"` : `Đã thêm "${targetTrack.title}" vào hàng chờ`,
        track: targetTrack,
        isFirst
      });
    } catch (err) {
      console.error('[API Play Error]:', err);
      return res.status(500).json({ success: false, error: err.message || 'Lỗi khi phát bài hát' });
    } finally {
      if (isLockHeld) {
        routeState.activePlaylistLoads.delete(guildId);
      }
    }
  });

  // 4. Thao tác điều khiển Player (Pause, Resume, Skip, Seek, Volume, 24/7...)
  router.post('/guilds/:guildId/action', auth.actionLimiter, auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const { action, value } = req.body;
    const user = req.user;

    // --- BẮT ĐẦU CƠ CHẾ DEBOUNCE THÔNG MINH ---
    const now = Date.now();
    const isLightAction = routeState.LIGHT_DEBOUNCE_ACTIONS.has(action);
    const cooldownMs = isLightAction ? 150 : 800;
    const debounceKey = isLightAction
      ? `${guildId}:${user?.userId || 'unknown'}:${action}`
      : `${guildId}:${action}`;

    const lastActionTime = routeState.actionDebounceMap.get(debounceKey) || 0;
    if (now - lastActionTime < cooldownMs) {
      return res.status(429).json({
        success: false,
        code: 'ACTION_DEBOUNCED',
        error: isLightAction ? 'Thao tác quá nhanh, vui lòng chờ 0.15s!' : 'Thao tác điều hướng quá nhanh, vui lòng chờ 0.8s!'
      });
    }

    enforceMapLimit(routeState.actionDebounceMap, routeState.MAX_ACTION_DEBOUNCE_SIZE);
    routeState.actionDebounceMap.set(debounceKey, now);
    // --- KẾT THÚC CƠ CHẾ DEBOUNCE ---

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    if (!queue && action !== 'toggle247' && action !== 'set247' && action !== 'toggleAutoplay' && action !== 'setAutoplay' && action !== 'switchTo247' && action !== 'resetTo247' && action !== 'toggleLofiMode' && action !== 'playFavorites' && action !== 'playUserPlaylist' && action !== 'playNow') {
      return res.status(400).json({ success: false, error: 'Hiện không có bài hát nào đang phát trong máy chủ này' });
    }

    const guildSettings = settingsManager.get(guildId);

    // 🔒 KIỂM TRA PHÂN QUYỀN ADMIN CHO CÁC THAO TÁC CÀI ĐẶT SERVER (24/7, Autoplay, LogChannel, Settings)
    const serverSettingActions = ['toggle247', 'set247', 'toggleAutoplay', 'setAutoplay', 'setLogChannel', 'settings', 'updateSettings'];
    if (serverSettingActions.includes(action)) {
      const isAdmin = await auth.checkIsAdmin(guildId, user.userId);
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên (Admin / Quản lý máy chủ) mới có quyền thay đổi Cài đặt Máy chủ!'
        });
      }
    } else if (action !== 'toggleFavorite') {
      // Kiểm tra quyền DJ nếu server đang bật chế độ DJ Only
      const musicControlActions = ['skip', 'previous', 'pause', 'resume', 'stop', 'seek', 'shuffle', 'loop', 'volume', 'clear', 'remove', 'removeBatch', 'move', 'playNow', 'playFavorites', 'playUserPlaylist'];
      if (guildSettings.djOnly && musicControlActions.includes(action) && !hasMusicPermission(req.member)) {
        return res.status(403).json({
          success: false,
          code: 'DJ_ONLY_REQUIRED',
          error: 'Máy chủ đang bật chế độ DJ Only. Bạn cần có vai trò DJ để điều khiển âm nhạc!'
        });
      }

      const userVoice = req.member?.voice?.channel;
      const isAdmin = await auth.checkIsAdmin(guildId, user.userId);
      const botVoice = queue?.voiceChannel || req.guild?.members?.me?.voice?.channel;

      if (!userVoice && !isAdmin) {
        return res.status(400).json({
          success: false,
          error: 'Bạn phải tham gia vào kênh Voice trên Discord để điều khiển âm nhạc!'
        });
      }

      if (botVoice && userVoice && userVoice.id !== botVoice.id && !isAdmin) {
        return res.status(400).json({
          success: false,
          error: `Bạn cần ở cùng phòng Voice "${botVoice.name}" với Bot để điều khiển nhạc!`
        });
      }
    }

    try {
      logAction('WEB_PLAYER_ACTION', {
        guildId,
        userId: user.userId,
        user: `${user.displayName || user.username} 🌐`,
        action,
        value: typeof value === 'object' ? JSON.stringify(value) : value
      });

      // Vô hiệu hóa các nút điều khiển luồng phát khi không có bài hát và bot không phát âm thanh
      // Chống phá hoại (Anti-Sabotage): Đếm số lượng người nghe thật trong phòng Voice
      const voiceChannelForCheck = queue?.getVoiceChannel ? queue.getVoiceChannel() : (queue?.voiceChannel || req.guild?.members?.me?.voice?.channel);
      const humanListeners = voiceChannelForCheck?.members ? voiceChannelForCheck.members.filter(m => !m.user?.bot && m.id !== client.user?.id) : [];
      const humanCount = humanListeners.size !== undefined ? humanListeners.size : (Array.isArray(humanListeners) ? humanListeners.length : 0);
      const isActionAdmin = await auth.checkIsAdmin(guildId, user.userId);
      const isActionDJ = await auth.checkIsManager(guildId, user.userId);
      const canManageQueue = isActionAdmin || isActionDJ;

      // 1. Chặn thành viên thường Xóa Toàn Bộ Hàng Chờ (Clear) khi phòng có từ 2 người nghe trở lên
      if (action === 'clear' && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền xóa toàn bộ hàng chờ khi phòng có từ 2 người nghe trở lên!'
        });
      }

      // 2. Chặn thành viên thường Nhảy Cóc (PlayNow) khi phòng có từ 2 người nghe trở lên
      if (action === 'playNow' && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền nhảy cóc bài hát khi phòng có từ 2 người nghe trở lên!'
        });
      }

      // 3. Chặn thành viên thường Chuyển đổi Lofi 24/7 khi hàng chờ đang có bài và phòng có từ 2 người nghe
      if ((action === 'switchTo247' || action === 'resetTo247' || action === 'toggleLofiMode') && queue?.songs?.length > 0 && humanCount >= 2 && !canManageQueue) {
        return res.status(403).json({
          success: false,
          code: 'PERMISSION_DENIED',
          error: 'Chỉ Quản trị viên hoặc DJ mới có quyền chuyển đổi sang chế độ Lofi 24/7 khi đang có người nghe!'
        });
      }

      const playbackActions = ['pause', 'resume', 'stop', 'seek', 'skip', 'previous'];
      if (playbackActions.includes(action)) {
        if ((!queue?.currentSong && !queue?.isPlaying) || queue?.isStopped) {
          return res.status(400).json({
            success: false,
            code: 'NOT_PLAYING',
            error: 'Hiện không có bài hát nào đang phát trong phòng!'
          });
        }
      }

      // 🔒 Chặn toàn bộ thao tác điều khiển tương tác khi đang ở chế độ Đài Radio Lofi 24/7
      const isLofiActionBlocked = Boolean(
        queue?.currentSong?.is247 ||
        queue?.currentSong?.requestedBy === 'Auto (24/7)' ||
        queue?.currentSong?.requestedBy === 'Auto (24/7 Lofi)' ||
        queue?.currentSong?.requestedBy?.includes?.('24/7') ||
        (queue?.mode247 && (!queue?.currentSong || queue?.currentSong?.requestedBy?.includes?.('Auto')))
      );

      const blocked247Actions = ['pause', 'resume', 'skip', 'previous', 'seek', 'shuffle', 'loop', 'toggleFavorite'];
      if (isLofiActionBlocked && blocked247Actions.includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Đang phát Radio Lofi 24/7 tự động. Hãy order bài hát mới để tương tác!'
        });
      }

      let resultMessage = '';
      switch (action) {
        case 'pause':
        case 'resume':
        case 'stop': {
          const isLofiCurrent = Boolean(queue?.currentSong && (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)')) || Boolean(queue?.mode247 && !queue?.currentSong);
          if (isLofiCurrent) {
            const isManager = await auth.checkIsManager(guildId, user.userId);
            if (!isManager) {
              return res.status(403).json({
                success: false,
                error: 'Chỉ Quản lý máy chủ hoặc có vai trò Quản lý / DJ mới có quyền tạm dừng hoặc dừng nhạc nền 24/7!'
              });
            }
          }
          if (action === 'pause') {
            queue.pause();
            resultMessage = 'Đã tạm dừng bài hát';
          } else if (action === 'resume') {
            queue.resume();
            resultMessage = 'Đã tiếp tục phát nhạc';
          } else {
            queue.stop();
            resultMessage = 'Đã dừng phát và xóa toàn bộ hàng chờ';
          }
          break;
        }
        case 'seek': {
          const seekSec = Math.max(0, Math.floor(Number(value) || 0));
          await queue.seek(seekSec);
          const mins = Math.floor(seekSec / 60);
          const secs = seekSec % 60;
          const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          resultMessage = `Đã tua đến ${formatted}`;
          break;
        }
        case 'skip': {
          const member = req.member || (req.guild ? await req.guild.members.fetch(user.userId).catch(() => null) : null);
          if (member) {
            const skipResult = queue.checkOrCastSkipVote(member);
            if (skipResult.status === 'skipped') {
              resultMessage = `Đã chuyển bài hát tiếp theo bởi @${user.displayName || user.username}`;
              if (skipResult.reason === 'vote_passed') {
                queue.textChannel?.send(t(guildId, 'skip.vote_passed', {
                  title: skipResult.title,
                  current: skipResult.current,
                  required: skipResult.required
                })).catch(() => {});
              }
            } else if (skipResult.status === 'vote_progress') {
              resultMessage = `Đã bỏ phiếu qua bài (${skipResult.current}/${skipResult.required}) — Cần thêm ${skipResult.needed} phiếu!`;
              queue.textChannel?.send(t(guildId, 'skip.vote_progress', {
                user: skipResult.user,
                current: skipResult.current,
                required: skipResult.required,
                needed: skipResult.needed
              })).catch(() => {});
            } else if (skipResult.status === 'vote_retracted') {
              resultMessage = `Đã rút phiếu bỏ qua (${skipResult.current}/${skipResult.required})`;
              queue.textChannel?.send(t(guildId, 'skip.vote_retracted', {
                user: skipResult.user,
                current: skipResult.current,
                required: skipResult.required
              })).catch(() => {});
            }
          } else {
            queue.skip();
            resultMessage = `Đã chuyển bài hát tiếp theo bởi @${user.displayName || user.username}`;
          }
          break;
        }
        case 'previous': {
          const ok = await queue.playPrevious();
          resultMessage = ok ? 'Đã quay lại bài hát trước đó ⏮️' : 'Không có bài hát trước đó để quay lại';
          break;
        }
        case 'move': {
          const humanListeners = queue?.voiceChannel?.members ? queue.voiceChannel.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await auth.checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền thay đổi vị trí bài hát khi phòng có từ 2 người nghe trở lên!'
            });
          }
          const { from, to } = value || {};
          const ok = queue.moveTrack(from, to);
          resultMessage = ok ? 'Đã thay đổi thứ tự hàng chờ' : 'Không thể di chuyển bài hát';
          break;
        }
        case 'toggleFavorite': {
          const trackToFav = value || queue?.currentSong;
          if (trackToFav && trackToFav.title) {
            if (trackToFav.is247 || trackToFav.requestedBy === 'Auto (24/7)' || trackToFav.requestedBy === 'Auto (24/7 Lofi)') {
              return res.status(400).json({ success: false, error: 'Không thể thêm nhạc nền chế độ 24/7 Lofi vào danh sách yêu thích' });
            }
            if (!trackToFav.url) {
              trackToFav.url = queue?.currentSong?.url || (trackToFav.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(trackToFav.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(trackToFav.title)}`);
            }
            try {
              const favRes = await favoriteManager.toggleFavorite(user.userId, trackToFav);
              resultMessage = favRes.isAdded ? `Đã thêm "${trackToFav.title}" vào Yêu thích ❤️` : `Đã xóa "${trackToFav.title}" khỏi Yêu thích`;
            } catch (favErr) {
              return res.status(400).json({ success: false, error: favErr.message });
            }
          } else {
            resultMessage = 'Không có bài hát để yêu thích';
          }
          break;
        }
        case 'playNow': {
          const targetVoice = queue?.voiceChannel || req.member?.voice?.channel;
          const humanListeners = targetVoice?.members ? targetVoice.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await auth.checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền phát ngay bài hát (nhảy cóc hàng chờ) khi phòng có từ 2 người nghe trở lên!'
            });
          }
          let targetQueue = queue;
          if (!targetQueue) {
            const userVoice = req.member?.voice?.channel;
            if (!userVoice) {
              return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
            }
            const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
            const lockCheck = await checkLockedVoice(guildSettings, userVoice, req.guild, botMember);
            if (!lockCheck.allowed) {
              return res.status(lockCheck.status).json({ success: false, error: lockCheck.error });
            }
            const voiceChannel = lockCheck.targetChannel || userVoice;
            let textChannel = null;
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
            targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, voiceChannel);
          }

          let ok = false;
          if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
            ok = await targetQueue.playNow(Number(value));
          } else if (value && typeof value === 'object') {
            // Nếu bài nằm trong hàng chờ và khớp vị trí index
            if (typeof value.index === 'number' && targetQueue.songs[value.index] && (targetQueue.songs[value.index].url === value.url || targetQueue.songs[value.index].title === value.title)) {
              ok = await targetQueue.playNow(value.index);
            } else {
              let resolvedTrack = value;
              if (value.url) {
                const validatedUrl = validateAndSanitizeMusicUrl(value.url);
                if (!validatedUrl) {
                  return res.status(400).json({ success: false, error: 'URL bài hát không hợp lệ hoặc không thuộc danh sách domain âm nhạc được hỗ trợ!' });
                }
                resolvedTrack.url = validatedUrl;
              }
              if (!resolvedTrack.url || resolvedTrack.url.includes('youtube.com/results?search_query=')) {
                const q = resolvedTrack.searchQuery || `${resolvedTrack.title || ''} ${resolvedTrack.artist || ''}`.trim();
                const found = await searchTrack(q);
                if (found && found.length > 0) {
                  resolvedTrack = { ...found[0], ...resolvedTrack, url: found[0].url, duration: found[0].duration || resolvedTrack.duration, thumbnail: resolvedTrack.thumbnail || found[0].thumbnail };
                }
              }
              const memberAvatar = req.member?.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
              resolvedTrack.title = auth.sanitizeDiscordText(resolvedTrack.title, 200) || 'Unknown Track';
              resolvedTrack.artist = auth.sanitizeDiscordText(resolvedTrack.artist, 100) || 'YouTube';
              resolvedTrack.thumbnail = auth.sanitizeThumbnailUrl(resolvedTrack.thumbnail);
              resolvedTrack.is247 = false;
              resolvedTrack.requestedBy = `<@${req.member?.id || user.userId}>`;
              resolvedTrack.requestedByName = req.member?.displayName || user.displayName || user.username;
              resolvedTrack.requestedByAvatar = memberAvatar;
              resolvedTrack.requestedById = req.member?.id || user.userId;

              ok = await targetQueue.playTrackNow(resolvedTrack, {
                id: req.member?.id || user.userId,
                displayName: req.member?.displayName || user.displayName || user.username,
                username: req.member?.user?.username || user.username,
                avatar: memberAvatar
              });
            }
          }
          if (!ok) {
            return res.status(400).json({ success: false, error: 'Không thể phát ngay bài hát được chọn!' });
          }
          resultMessage = 'Đang phát ngay bài hát được chọn ▶️';
          break;
        }
        case 'playFavorites': {
          const userVoice = req.member?.voice?.channel;
          if (!userVoice) {
            return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
          }
          const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
          if (!queue) {
            const lockCheck = await checkLockedVoice(guildSettings, userVoice, req.guild, botMember);
            if (!lockCheck.allowed) {
              return res.status(lockCheck.status).json({ success: false, error: lockCheck.error });
            }
          }
          const favorites = await favoriteManager.getFavorites(user.userId);
          if (!favorites || favorites.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'Bạn chưa có bài hát nào trong danh sách Yêu thích ❤️'
            });
          }
          let textChannel = queue?.textChannel;
          if (!textChannel) {
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
          }
          const voiceChannel = queue?.voiceChannel || userVoice;
          const targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, voiceChannel);
          const memberAvatar = req.member.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const validTracks = favorites.slice(0, 100).map(fav => ({
            title: auth.sanitizeDiscordText(fav.title, 200) || 'Unknown Track',
            artist: auth.sanitizeDiscordText(fav.artist, 100) || 'Unknown Artist',
            url: fav.url,
            thumbnail: auth.sanitizeThumbnailUrl(fav.thumbnail),
            duration: fav.duration || '3:30',
            is247: false,
            requestedBy: `<@${req.member.id}>`,
            requestedByName: req.member.displayName || user.username,
            requestedByAvatar: memberAvatar,
            requestedById: req.member.id
          }));
          const requesterObj = {
            id: req.member.id,
            displayName: req.member.displayName || user.username,
            username: req.member.user?.username || user.username,
            avatar: memberAvatar
          };
          await targetQueue.addSongs(validTracks, requesterObj);
          auth.sendWebQueueNotification(req.guild, targetQueue, guildSettings, t(guildId, 'web_notify.added_favorites', {
            user: req.member.displayName || user.username,
            count: validTracks.length
          }));
          resultMessage = `Đã nạp toàn bộ ${validTracks.length} bài hát yêu thích vào hàng chờ ❤️`;
          break;
        }
        case 'playUserPlaylist': {
          const userVoice = req.member?.voice?.channel;
          if (!userVoice) {
            return res.status(400).json({ success: false, error: 'Bạn phải tham gia vào một kênh Voice trong Discord trước khi phát bài hát!' });
          }
          const botMember = req.guild.members.me || await req.guild.members.fetch(client.user.id).catch(() => null);
          if (!queue) {
            const lockCheck = await checkLockedVoice(guildSettings, userVoice, req.guild, botMember);
            if (!lockCheck.allowed) {
              return res.status(lockCheck.status).json({ success: false, error: lockCheck.error });
            }
          }
          const playlistId = value?.playlistId || value;
          if (!playlistId) {
            return res.status(400).json({ success: false, error: 'Thiếu playlistId cần phát' });
          }
          const playlists = await userPlaylistManager.getUserPlaylists(user.userId);
          const targetPlaylist = playlists.find(p => p.id === playlistId);
          if (!targetPlaylist) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy playlist của bạn' });
          }
          if (!targetPlaylist.songs || targetPlaylist.songs.length === 0) {
            return res.status(400).json({
              success: false,
              error: `Playlist "${targetPlaylist.name}" chưa có bài hát nào!`
            });
          }

          let textChannel = queue?.textChannel;
          if (!textChannel) {
            if (guildSettings.musicChannelId) {
              const ch = req.guild.channels.cache.get(guildSettings.musicChannelId);
              if (ch?.isTextBased?.() && ch.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) {
                textChannel = ch;
              }
            }
            if (!textChannel) {
              textChannel = req.guild.channels.cache.find(c => c.isTextBased?.() && c.permissionsFor(botMember || client.user)?.has(['ViewChannel', 'SendMessages'])) || null;
            }
          }
          const voiceChannel = queue?.voiceChannel || userVoice;
          const targetQueue = client.musicManager.getOrCreate(req.guild, textChannel, voiceChannel);
          const memberAvatar = req.member.displayAvatarURL ? req.member.displayAvatarURL({ dynamic: true }) : user.avatar;
          const validTracks = targetPlaylist.songs.slice(0, 100).map(item => ({
            title: auth.sanitizeDiscordText(item.title, 200) || 'Unknown Track',
            artist: auth.sanitizeDiscordText(item.artist, 100) || 'Unknown Artist',
            url: item.url,
            thumbnail: auth.sanitizeThumbnailUrl(item.thumbnail),
            duration: item.duration || '3:30',
            is247: false,
            requestedBy: `<@${req.member.id}>`,
            requestedByName: req.member.displayName || user.username,
            requestedByAvatar: memberAvatar,
            requestedById: req.member.id
          }));
          const requesterObj = {
            id: req.member.id,
            displayName: req.member.displayName || user.username,
            username: req.member.user?.username || user.username,
            avatar: memberAvatar
          };
          await targetQueue.addSongs(validTracks, requesterObj);
          auth.sendWebQueueNotification(req.guild, targetQueue, guildSettings, t(guildId, 'web_notify.added_playlist', {
            user: req.member.displayName || user.username,
            name: targetPlaylist.name,
            count: validTracks.length
          }));
          resultMessage = `Đã nạp toàn bộ ${validTracks.length} bài hát từ playlist "${targetPlaylist.name}" vào hàng chờ 🎵`;
          break;
        }
        case 'clear': {
          const humanListeners = queue?.voiceChannel?.members ? queue.voiceChannel.members.filter(m => !m.user.bot) : [];
          const humanCount = humanListeners.size !== undefined ? humanListeners.size : (humanListeners.length || 0);
          const isManager = await auth.checkIsManager(guildId, user.userId);
          if (humanCount >= 2 && !isManager) {
            return res.status(403).json({
              success: false,
              error: 'Chỉ Quản trị viên hoặc DJ mới có quyền xóa toàn bộ hàng chờ khi phòng có từ 2 người nghe trở lên!'
            });
          }
          if (queue) {
            queue.songs = [];
            if (typeof queue._cleanupResource === 'function') {
              queue._cleanupResource(queue.preloadedResource);
            }
            queue.preloadedResource = null;
            queue.preloadedSongUrl = null;
            queue.prefetchedSong = null;
            if (queue.loopMode === 'song' || queue.loopMode === 'queue') {
              queue.loopMode = 'off';
            }
            queue.refreshNowPlayingCard?.();
          }
          resultMessage = 'Đã xóa toàn bộ bài hát trong hàng chờ';
          break;
        }
        case 'shuffle':
          queue.shuffle();
          resultMessage = 'Đã xáo trộn hàng chờ';
          break;
        case 'loop': {
          const isLofiCurrent = Boolean(queue?.currentSong && (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)')) || Boolean(queue?.mode247 && !queue?.currentSong);
          if (isLofiCurrent) {
            return res.status(400).json({
              success: false,
              error: 'Chế độ phát Lofi 24/7 tự động chuyển bài radio, không áp dụng chế độ lặp!'
            });
          }
          // toggle loop: off -> song -> queue -> off
          const modes = ['off', 'song', 'queue'];
          const currentIdx = modes.indexOf(queue.loopMode || 'off');
          const nextMode = value || modes[(currentIdx + 1) % modes.length];
          queue.setLoop(nextMode);
          resultMessage = `Chế độ lặp lại: ${nextMode.toUpperCase()}`;
          break;
        }
        case 'volume': {
          const parsed = parseInt(value, 10);
          const vol = isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
          queue.setVolume(vol);
          resultMessage = `Âm lượng: ${vol}%`;
          break;
        }
        case 'toggle247': {
          if (queue) {
            const is247 = queue.toggle247();
            if (is247 && !queue.currentSong) {
              queue._play247BackgroundLofi().catch(() => {});
            }
            resultMessage = is247 ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          } else {
            const current = settingsManager.get(guildId);
            const newVal = !current.mode247;
            settingsManager.update(guildId, { mode247: newVal });
            resultMessage = newVal ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          }
          break;
        }
        case 'set247': {
          const targetVal = Boolean(value);
          if (queue) {
            queue.set247(targetVal);
            if (targetVal && !queue.currentSong) {
              queue._play247BackgroundLofi().catch(() => {});
            }
          }
          settingsManager.update(guildId, { mode247: targetVal });
          resultMessage = targetVal ? 'Đã BẬT chế độ Treo Lofi 24/7' : 'Đã TẮT chế độ 24/7';
          break;
        }
        case 'switchTo247':
        case 'resetTo247': {
          let targetQueue = queue;
          if (!targetQueue) {
            const guild = client.guilds.cache.get(guildId);
            const member = guild?.members?.cache.get(user.userId) || await guild?.members?.fetch(user.userId).catch(() => null);
            const userVoice = member?.voice?.channel;
            const guildSettings = settingsManager.get(guildId);
            const voiceChannel = userVoice || (guildSettings.voiceChannelId ? guild.channels.cache.get(guildSettings.voiceChannelId) : null);
            const textChannel = guildSettings.musicChannelId ? guild.channels.cache.get(guildSettings.musicChannelId) : (guild.systemChannel || member?.voice?.channel);
            if (guild && voiceChannel) {
              targetQueue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
            }
          }
          if (targetQueue) {
            const switchResult = await targetQueue.switchTo247Lofi();
            resultMessage = switchResult?.message || (targetQueue.songs.length > 0
              ? `Đã chuyển sang Lofi 24/7 (Đang giữ ${targetQueue.songs.length} bài trong hàng chờ)`
              : 'Đã chuyển sang chế độ phát Lofi 24/7 thư giãn');
          } else {
            settingsManager.update(guildId, { mode247: true });
            resultMessage = 'Đã bật chế độ 24/7 (Bot chưa kết nối phòng Voice)';
          }
          break;
        }
        case 'toggleLofiMode': {
          let targetQueue = queue;
          if (!targetQueue) {
            const guild = client.guilds.cache.get(guildId);
            const member = guild?.members?.cache.get(user.userId) || await guild?.members?.fetch(user.userId).catch(() => null);
            const userVoice = member?.voice?.channel;
            const guildSettings = settingsManager.get(guildId);
            const voiceChannel = userVoice || (guildSettings.voiceChannelId ? guild.channels.cache.get(guildSettings.voiceChannelId) : null);
            const textChannel = guildSettings.musicChannelId ? guild.channels.cache.get(guildSettings.musicChannelId) : (guild.systemChannel || member?.voice?.channel);
            if (guild && voiceChannel) {
              targetQueue = client.musicManager.getOrCreate(guild, textChannel, voiceChannel);
            }
          }
          if (targetQueue) {
            const toggleRes = await targetQueue.toggleLofiMode();
            resultMessage = toggleRes?.message || 'Đã chuyển đổi chế độ phát nhạc';
          } else {
            resultMessage = 'Bot chưa kết nối phòng Voice';
          }
          break;
        }
        case 'toggleAutoplay': {
          const current = settingsManager.get(guildId);
          const newVal = !current.autoplay;
          settingsManager.update(guildId, { autoplay: newVal });
          resultMessage = newVal ? 'Đã BẬT Tự Động Phát Bài Tương Tự (Autoplay)' : 'Đã TẮT Tự Động Phát';
          break;
        }
        case 'setAutoplay': {
          const targetVal = Boolean(value);
          settingsManager.update(guildId, { autoplay: targetVal });
          resultMessage = targetVal ? 'Đã BẬT Tự Động Phát Bài Tương Tự (Autoplay)' : 'Đã TẮT Tự Động Phát';
          break;
        }
        case 'setLogChannel': {
          const newLogChannel = value || null;
          if (newLogChannel && !(req.guild?.channels?.cache?.has(newLogChannel))) {
            return res.status(400).json({
              success: false,
              error: `Kênh Nhật Ký (${newLogChannel}) không tồn tại trong máy chủ này!`
            });
          }
          settingsManager.update(guildId, { logChannelId: newLogChannel });
          resultMessage = newLogChannel ? `Đã cấu hình Kênh Nhật Ký (Log Channel): <#${newLogChannel}>` : 'Đã TẮT Kênh Nhật Ký hoạt động';
          break;
        }
        case 'updateSettings': {
          if (typeof value === 'object' && value !== null) {
            const validationErr = auth.validateGuildChannelsAndRoles(req.guild, value);
            if (validationErr) {
              return res.status(400).json({ success: false, error: validationErr });
            }
            settingsManager.update(guildId, value);
            if (value.language !== undefined && queue && typeof queue.refreshNowPlayingCard === 'function') {
              queue.refreshNowPlayingCard();
            }
            resultMessage = 'Đã lưu cài đặt máy chủ thành công!';
          }
          break;
        }
        case 'remove':
        case 'removeBatch': {
          const isSongOwned = (song) => {
            if (canManageQueue) return true;
            if (humanCount < 2) return true;
            if (!song) return false;
            // Nếu là bài phát tự động hoặc 24/7 -> cho phép xóa
            if (song.is247 || song.requestedBy === 'Auto' || song.requestedBy === 'DJ AI (Gợi ý)' || song.requestedBy === 'Auto (24/7)' || song.requestedBy === 'Tự động phát') return true;
            if (song.requestedById && String(song.requestedById) === String(user.userId)) return true;
            if (typeof song.requestedBy === 'string' && song.requestedBy.includes(String(user.userId))) return true;
            return false;
          };

          if (Array.isArray(value)) {
            if (humanCount >= 2 && !canManageQueue) {
              const anyNotMine = value.some(idx => {
                const s = queue?.songs?.[Number(idx)];
                return s && !isSongOwned(s);
              });
              if (anyNotMine) {
                return res.status(403).json({
                  success: false,
                  code: 'PERMISSION_DENIED',
                  error: 'Bạn chỉ có quyền xóa các bài hát do chính mình yêu cầu khi phòng có từ 2 người trở lên!'
                });
              }
            }
            const sortedIndices = value
              .map(Number)
              .filter(n => !isNaN(n) && n >= 0 && n < (queue?.songs?.length || 0))
              .sort((a, b) => b - a);
            for (const idx of sortedIndices) {
              queue.removeSong(idx);
            }
            resultMessage = `Đã xóa ${sortedIndices.length} bài hát khỏi hàng chờ`;
          } else {
            const idx = parseInt(value, 10);
            if (!isNaN(idx) && idx >= 0 && idx < (queue?.songs?.length || 0)) {
              const targetSong = queue.songs[idx];
              if (humanCount >= 2 && !canManageQueue && !isSongOwned(targetSong)) {
                return res.status(403).json({
                  success: false,
                  code: 'PERMISSION_DENIED',
                  error: 'Bạn chỉ có quyền xóa các bài hát do chính mình yêu cầu khi phòng có từ 2 người trở lên!'
                });
              }
              const removed = queue.removeSong(idx);
              resultMessage = `Đã xóa "${removed?.title || 'bài hát'}" khỏi hàng chờ`;
            }
          }
          queue?._saveSessionState?.();
          queue?.refreshNowPlayingCard?.();
          break;
        }
        default:
          return res.status(400).json({ success: false, error: 'Hành động không hợp lệ' });
      }

      return res.json({ success: true, message: resultMessage, action, value });
    } catch (err) {
      console.error('[API Action Error]:', err);
      return res.status(500).json({ success: false, error: err.message || 'Lỗi thao tác' });
    }
  });

  return router;
};
