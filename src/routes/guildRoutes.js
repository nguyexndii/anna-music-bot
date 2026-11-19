const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createSessionToken, getPinAttemptStatus, recordPinFailure, clearPinFailures } = require('../utils/tokenHelper');
const settingsManager = require('../structures/SettingsManager');
const favoriteManager = require('../structures/FavoriteManager');
const userPlaylistManager = require('../structures/UserPlaylistManager');
const { logAction } = require('../utils/debugLogger');
const { setVoiceChannelStatus, clearVoiceChannelStatus } = require('../utils/embed');

module.exports = function createGuildRoutes(client, auth, routeState) {
  const router = express.Router();

  // 1. Xác thực Token & PIN từ Discord (Có cơ chế chống Brute-force 5 lần sai khóa 5 phút & hủy PIN)
  router.post('/auth/verify', auth.authVerifyLimiter, async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã PIN hoặc Token' });
    }

    const clientIp = auth.getClientIp(req);
    const attemptStatus = getPinAttemptStatus(clientIp);

    // Kiểm tra xem IP này có đang bị tạm khóa hay không
    if (attemptStatus && attemptStatus.locked) {
      return res.status(429).json({
        success: false,
        error: `Bạn đã nhập sai mã PIN quá 5 lần. IP tạm thời bị khóa trong ${attemptStatus.remainingMinutes} phút để đảm bảo an toàn.`
      });
    }

    const { verifyWebToken } = require('../utils/tokenHelper');
    const user = verifyWebToken(token, true);
    if (!user) {
      const failInfo = recordPinFailure(clientIp, token);
      if (failInfo.locked) {
        return res.status(429).json({
          success: false,
          error: 'Bạn đã nhập sai mã PIN quá 5 lần liên tiếp. Tài khoản bị tạm khóa 5 phút!'
        });
      }

      return res.status(401).json({
        success: false,
        error: `Mã PIN không chính xác hoặc đã hết hạn. Bạn còn ${failInfo.remainingAttempts} lần thử.`
      });
    }

    // Đăng nhập thành công -> Xóa lịch sử nhập sai của IP
    clearPinFailures(clientIp);

    // Kiểm tra Whitelist máy chủ khi xác thực token
    if (!auth.isGuildAllowed(user.guildId, user.userId)) {
      return res.status(403).json({
        success: false,
        code: 'GUILD_NOT_ALLOWED',
        error: 'Máy chủ này chưa được cấp phép sử dụng hệ thống!'
      });
    }

    const guild = client.guilds.cache.get(user.guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const member = guild.members.cache.get(user.userId) || await guild.members.fetch(user.userId).catch(() => null);
    const voiceState = guild.voiceStates?.cache?.get(user.userId);
    const userVoiceChannelId = voiceState?.channelId || member?.voice?.channelId || null;
    let userVoice = member?.voice?.channel || null;
    if (!userVoice && userVoiceChannelId) {
      userVoice = guild.channels.cache.get(userVoiceChannelId) || await guild.channels.fetch(userVoiceChannelId).catch(() => null);
    }

    const queue = client.musicManager ? client.musicManager.get(user.guildId) : null;
    const botVoice = queue?.voiceChannel || guild.members.me?.voice?.channel || null;
    const botVoiceChannelId = queue?.voiceChannel?.id || queue?.voiceChannelId || guild.members.me?.voice?.channelId || null;
    const guildSettings = settingsManager.get(user.guildId);
    const isAdmin = await auth.checkIsAdmin(user.guildId, user.userId);
    const isDJ = await auth.checkIsManager(user.guildId, user.userId);

    // Kiểm tra thực tế xem User có đang ngồi trong kênh Voice trên Discord hay không
    const isInVoice = Boolean(userVoiceChannelId);
    let isSameVoice = false;
    if (isInVoice) {
      if (botVoiceChannelId) {
        // Bot đã vào phòng thoại: Chỉ cần User và Bot ở cùng phòng là luôn ĐẠT (kể cả có lockedVoiceChannelId cũ)
        isSameVoice = (userVoiceChannelId === botVoiceChannelId);
      } else if (guildSettings.lockedVoiceChannelId) {
        // Bot chưa vào phòng thoại và máy chủ có khóa phòng: User phải ở phòng khóa (hoặc là Admin)
        isSameVoice = (userVoiceChannelId === guildSettings.lockedVoiceChannelId) || isAdmin;
      } else {
        // Bot chưa vào phòng thoại và máy chủ tự do: Bất kỳ phòng nào đều hợp lệ
        isSameVoice = true;
      }
    }

    // Cấp Session Token 24 tiếng lưu vào thiết bị
    const sessionToken = user.sessionToken || createSessionToken(user, 24);

    return res.json({
      success: true,
      token: sessionToken,
      user: {
        ...user,
        isAdmin,
        isDJ,
        guildName: guild.name,
        guildIcon: guild.iconURL({ dynamic: true }) || null,
        userVoice: userVoice ? { id: userVoice.id, name: userVoice.name } : null,
        botVoice: botVoice ? { id: botVoice.id, name: botVoice.name } : null,
        lockedVoiceChannelId: guildSettings.lockedVoiceChannelId || null,
        isInVoice,
        isSameVoice
      }
    });
  });

  // 2. Xem log sự kiện hệ thống (Bảo vệ bằng requireAuth & Phân quyền theo Server/Owner)
  router.get('/logs', auth.requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const isOwner = (user.userId === config.adminId);
      const isGuildAdmin = await auth.checkIsAdmin(user.guildId, user.userId);
      if (!isOwner && !isGuildAdmin) {
        return res.status(403).json({ success: false, error: 'Quyền bị từ chối: Chỉ Quản trị viên mới được phép xem nhật ký.' });
      }

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const logPath = path.join(__dirname, '../../logs/events.log');
      if (!fs.existsSync(logPath)) {
        return res.json({ success: true, count: 0, logs: [] });
      }
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      // Chống lộ log chéo server: Nếu không phải Bot Owner, chỉ lọc các dòng log của chính máy chủ người dùng
      const filteredLines = isOwner ? lines : lines.filter(line => line.includes(user.guildId));
      const lastLines = filteredLines.slice(-limit);
      return res.json({
        success: true,
        count: lastLines.length,
        logs: lastLines
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 3. Trạng thái phòng nhạc (Real-time State - Yêu cầu người dùng đã xác thực token cùng máy chủ)
  router.get('/guilds/:guildId/state', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const caller = req.user;
    if (caller) {
      routeState.recordActiveUser(guildId, caller);
    }

    const queue = client.musicManager ? client.musicManager.get(guildId) : null;
    const guildSettings = settingsManager.get(guildId);

    const sessionUptimeSec = queue?.voiceSessionStartTime
      ? Math.max(0, Math.floor((Date.now() - queue.voiceSessionStartTime) / 1000))
      : Math.floor(process.uptime());
    const botUptimeSec = Math.floor(process.uptime());

    const voiceChannel = queue?.getVoiceChannel ? queue.getVoiceChannel() : (queue?.voiceChannel || guild.members.me?.voice?.channel);
    let voiceMembers = [];
    if (voiceChannel && guild.voiceStates?.cache) {
      for (const state of guild.voiceStates.cache.values()) {
        if (state.channelId === voiceChannel.id) {
          const member = state.member || guild.members.cache.get(state.id);
          const userObj = member?.user || client.users?.cache?.get(state.id);
          const isBot = Boolean(userObj?.bot || state.id === client.user.id);
          voiceMembers.push({
            id: state.id,
            username: userObj?.username || 'user',
            displayName: member?.displayName || userObj?.globalName || userObj?.username || 'Thành viên',
            avatar: userObj?.displayAvatarURL ? userObj.displayAvatarURL({ dynamic: true }) : null,
            isBot,
            isSelf: caller?.userId ? state.id === caller.userId : (state.id === client.user.id)
          });
        }
      }
    } else if (voiceChannel?.members) {
      voiceMembers = voiceChannel.members.map(m => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ dynamic: true }) || null,
        isBot: m.user.bot,
        isSelf: caller?.userId ? m.id === caller.userId : false
      }));
    }

    const currentTrack = queue?.currentSong;
    const activeWebUsers = routeState.getActiveWebUsers(guildId);

    const callerVoiceState = guild.voiceStates?.cache?.get(caller?.userId);
    const callerVoiceChannelId = callerVoiceState?.channelId || req.member?.voice?.channelId || null;
    let callerVoice = req.member?.voice?.channel || null;
    if (!callerVoice && callerVoiceChannelId) {
      callerVoice = guild.channels.cache.get(callerVoiceChannelId) || await guild.channels.fetch(callerVoiceChannelId).catch(() => null);
    }
    const isCallerAdmin = await auth.checkIsAdmin(guildId, caller?.userId);
    const isCallerDJ = await auth.checkIsManager(guildId, caller?.userId);
    const botVoiceId = voiceChannel?.id || queue?.voiceChannel?.id || guild.members.me?.voice?.channelId || null;
    const inSameVoice = Boolean(callerVoiceChannelId && botVoiceId && callerVoiceChannelId === botVoiceId);

    return res.json({
      success: true,
      sessionUptimeSec,
      botUptimeSec,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ dynamic: true }) || null
      },
      settings: guildSettings,
      language: guildSettings.language || 'vi',
      userPermissions: {
        isAdmin: isCallerAdmin,
        isDJ: isCallerDJ,
        inSameVoice,
        isInVoice: Boolean(callerVoiceChannelId),
        userId: caller?.userId,
        userVoice: callerVoice ? { id: callerVoice.id, name: callerVoice.name } : null
      },
      activeWebUsers,
      voiceMembers,
      connectionDiagnostics: {
        channelId: voiceChannel?.id || null,
        channelName: voiceChannel?.name || null,
        status: queue?.connection?.state?.status || 'NoConnection',
        hasSubscription: Boolean(queue?.connection?.state?.subscription),
        playerStatus: queue?.player?.state?.status || 'NoPlayer'
      },
      player: {
        isPlaying: queue ? queue.isPlaying : false,
        isPaused: queue ? queue.isPaused : false,
        sessionUptimeSec,
        botUptimeSec,
        is247LofiMode: Boolean(currentTrack && (currentTrack.is247 || currentTrack.requestedBy === 'Auto (24/7)' || currentTrack.requestedBy === 'Auto (24/7 Lofi)' || (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.includes('24/7')))),
        volume: queue ? queue.volume : (guildSettings.defaultVolume || 80),
        loopMode: queue ? queue.loopMode : (guildSettings.loopMode || 'off'),
        mode247: queue ? queue.mode247 : Boolean(guildSettings.mode247),
        autoplay: queue ? (guildSettings.autoplay !== false) : (guildSettings.autoplay !== false),
        lyricsSync: queue ? (guildSettings.lyricsSync !== false) : true,
        enableCinemaMode: guildSettings.enableCinemaMode !== false,
        settings: guildSettings,
        current: currentTrack ? (() => {
          const isTrack247 = Boolean(
            currentTrack.is247 ||
            currentTrack.requestedBy === 'Auto (24/7)' ||
            currentTrack.requestedBy === 'Auto (24/7 Lofi)' ||
            (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.includes('24/7'))
          );
          if (isTrack247) {
            return {
              title: currentTrack.title || 'Đài Phát Thanh Lofi 24/7',
              artist: currentTrack.artist || 'Anna Lofi Station • Live 24/7',
              url: currentTrack.url || 'https://youtube.com',
              thumbnail: currentTrack.thumbnail || '/anna-avatar-icon.png',
              duration: currentTrack.duration || 'LIVE 24/7',
              durationMs: currentTrack.durationMs || 0,
              playbackDurationMs: (() => {
                let val = 0;
                if (queue?.currentResource && typeof queue.currentResource.playbackDuration === 'number') {
                  val = queue.currentResource.playbackDuration + ((currentTrack.seekPosition || 0) * 1000);
                } else if (currentTrack.startTime) {
                  val = Math.max(0, Date.now() - currentTrack.startTime);
                }
                return val;
              })(),
              serverTime: Date.now(),
              is247: true,
              isLive: Boolean(currentTrack.isLive || currentTrack.duration === 'LIVE'),
              requestedBy: 'Auto (24/7)',
              requestedByAvatar: '/anna-avatar-icon.png',
              startTime: currentTrack.startTime || null
            };
          }
          const reqInfo = auth.resolveTrackRequester(currentTrack, guild);
          const safeTitle = (currentTrack.title || currentTrack.name || currentTrack.rawSongName || 'Đang phát âm thanh').trim();
          return {
            title: safeTitle,
            artist: (() => {
              if (currentTrack.artist && !['Unknown', 'YouTube', 'YouTube Music'].includes(currentTrack.artist) && !currentTrack.artist.startsWith('[') && !currentTrack.artist.includes('Topic')) {
                return currentTrack.artist;
              }
              const clean = safeTitle.replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
              const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
              if (segs.length >= 2) {
                const s0 = segs[0].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                const s1 = segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                if (s0.length > 35 && s1.length < s0.length && s1.length > 0) {
                  return s1;
                }
                return s0 || s1;
              }
              return (!['Unknown', 'YouTube', 'YouTube Music'].includes(currentTrack.artist) ? currentTrack.artist : '') || 'YouTube Music';
            })(),
            url: currentTrack.url || (currentTrack.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(currentTrack.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(safeTitle)}`),
            thumbnail: (() => {
              if (currentTrack.thumbnail && !currentTrack.thumbnail.includes('default-playlist')) {
                return currentTrack.thumbnail;
              }
              if (currentTrack.url) {
                const ytM = currentTrack.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
                if (ytM && ytM[1]) {
                  return `https://i.ytimg.com/vi/${ytM[1]}/hqdefault.jpg`;
                }
              }
              return currentTrack.thumbnail || null;
            })(),
            duration: currentTrack.duration,
            playbackDurationMs: (() => {
              let val = 0;
              if (queue?.currentResource && typeof queue.currentResource.playbackDuration === 'number') {
                val = queue.currentResource.playbackDuration + ((currentTrack.seekPosition || 0) * 1000);
              } else if (currentTrack.startTime) {
                val = Math.max(0, Date.now() - currentTrack.startTime);
              }
              const durMs = currentTrack.durationMs || (() => {
                if (!currentTrack.duration || currentTrack.duration === 'LIVE') return 0;
                const p = currentTrack.duration.split(':').map(Number);
                if (p.some(isNaN)) return 0;
                if (p.length === 3) return (p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
                if (p.length === 2) return (p[0] * 60 + p[1]) * 1000;
                return p[0] * 1000;
              })();
              return durMs > 0 ? Math.min(val, durMs) : val;
            })(),
            serverTime: Date.now(),
            is247: currentTrack.is247 || currentTrack.requestedBy === 'Auto (24/7)',
            isLive: currentTrack.isLive || currentTrack.duration === 'LIVE',
            requestedBy: reqInfo.name,
            requestedByAvatar: reqInfo.avatar,
            requestedById: currentTrack.requestedById || (typeof currentTrack.requestedBy === 'object' ? currentTrack.requestedBy?.id : (typeof currentTrack.requestedBy === 'string' && currentTrack.requestedBy.startsWith('<@') ? currentTrack.requestedBy.replace(/[^0-9]/g, '') : null)) || null,
            userSavedOffsetMs: queue?.userLyricOffsetMs ?? 0,
            autoOffsetMs: queue?.autoLyricOffsetMs ?? 0,
            totalLyricOffsetMs: queue?.currentLyricOffsetMs ?? 0,
            startTime: currentTrack.startTime || null
          };
        })() : null,
        queue: (queue?.songs || []).map((t, idx) => {
          const reqInfo = auth.resolveTrackRequester(t, guild);
          return {
            index: idx,
            title: t.title,
            artist: (() => {
              if (t.artist && !['Unknown', 'YouTube', 'YouTube Music'].includes(t.artist) && !t.artist.startsWith('[') && !t.artist.includes('Topic')) {
                return t.artist;
              }
              const clean = (t.title || '').replace(/\[.*?\]|【.*?】/g, ' ').replace(/^(?:track\s*)?\d+[\.\/\-:]\s*/i, ' ').trim();
              const segs = clean.split(/\s+[-–—|:/]\s+|\s*[|:]\s*/).map(s => s.trim()).filter(Boolean);
              if (segs.length >= 2) {
                const s0 = segs[0].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                const s1 = segs[1].replace(/\(.*?prod.*?\)/gi, '').replace(/prod\.?\s*by.*/gi, '').trim();
                if (s0.length > 35 && s1.length < s0.length && s1.length > 0) {
                  return s1;
                }
                return s0 || s1;
              }
              return (!['Unknown', 'YouTube', 'YouTube Music'].includes(t.artist) ? t.artist : '') || 'YouTube Music';
            })(),
            url: t.url || (t.searchQuery ? `https://www.youtube.com/results?search_query=${encodeURIComponent(t.searchQuery)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(t.title)}`),
            thumbnail: t.thumbnail,
            duration: t.duration,
            requestedBy: reqInfo.name,
            requestedByAvatar: reqInfo.avatar,
            requestedById: t.requestedById || (typeof t.requestedBy === 'object' ? t.requestedBy?.id : (typeof t.requestedBy === 'string' && t.requestedBy.startsWith('<@') ? t.requestedBy.replace(/[^0-9]/g, '') : null)) || null
          };
        }),
        voiceChannel: voiceChannel ? {
          id: voiceChannel.id,
          name: voiceChannel.name,
          memberCount: voiceMembers.length,
          humanMemberCount: voiceMembers.filter(m => !m.isBot).length,
          members: voiceMembers
        } : null,
        previousSongs: (queue?.previousSongs || []).map(t => ({
          title: t.title,
          url: t.url,
          thumbnail: t.thumbnail,
          duration: t.duration,
          artist: t.artist || (t.title.includes(' - ') ? t.title.split(' - ')[0].trim() : 'YouTube Music')
        })),
        hasPrevious: Boolean(queue?.previousSongs && queue.previousSongs.length > 0),
        ...((req.query.full === '1' || req.query.init === '1') ? {
          ...routeState.getCachedGuildStats(guildId, req.query.fresh === '1'),
          favorites: caller?.userId ? ((await favoriteManager.getFavorites(caller.userId, req.query.fresh === '1')) || []) : [],
          userPlaylists: caller?.userId ? ((await userPlaylistManager.getUserPlaylists(caller.userId, req.query.fresh === '1')) || []) : []
        } : {})
      }
    });
  });

  // 4. Lấy Cài đặt & Danh sách Kênh của Máy chủ
  router.get('/guilds/:guildId/settings', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const user = req.user;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy máy chủ' });
    }

    const isAdmin = await auth.checkIsAdmin(guildId, user.userId);
    const settings = settingsManager.get(guildId);

    const textChannels = guild.channels.cache
      .filter(c => c.isTextBased && c.isTextBased())
      .map(c => ({ id: c.id, name: c.name, type: c.type }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const voiceChannels = guild.channels.cache
      .filter(c => c.isVoiceBased && c.isVoiceBased())
      .map(c => ({ id: c.id, name: c.name, type: c.type }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const roles = guild.roles.cache
      .filter(r => r.id !== guildId)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      isAdmin,
      settings,
      textChannels,
      voiceChannels,
      roles
    });
  });

  // 5. Cập nhật Cài đặt Máy chủ từ Web Dashboard
  router.post('/guilds/:guildId/settings', auth.requireAuth, auth.requireSameGuild, async (req, res) => {
    const { guildId } = req.params;
    const user = req.user;

    const isAdmin = await auth.checkIsAdmin(guildId, user.userId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'PERMISSION_DENIED',
        error: 'Chỉ Quản trị viên mới được phép thay đổi cài đặt máy chủ!'
      });
    }

    const validationErr = auth.validateGuildChannelsAndRoles(req.guild, req.body);
    if (validationErr) {
      return res.status(400).json({ success: false, error: validationErr });
    }

    try {
      const updated = settingsManager.update(guildId, req.body);
      const queue = client.musicManager ? client.musicManager.get(guildId) : null;
      if (queue) {
        if (req.body.language !== undefined) {
          if (typeof queue.refreshNowPlayingCard === 'function') {
            queue.refreshNowPlayingCard();
          }
          if (queue.voiceChannel && !queue.currentSong) {
            if (queue.mode247) {
              setVoiceChannelStatus(queue.voiceChannel, updated.language === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
            } else {
              clearVoiceChannelStatus(queue.voiceChannel);
            }
          }
        }
        if (updated.crossfadeDuration !== undefined) {
          queue.crossfadeDuration = updated.crossfadeDuration;
        }
        if (req.body.mode247 !== undefined) {
          queue.set247(Boolean(updated.mode247));
          if (updated.mode247 === true && !queue.currentSong) {
            queue._play247BackgroundLofi().catch(() => {});
          }
        }
      }
      logAction('WEB_PLAYER_ACTION', {
        guildId,
        userId: user.userId,
        user: `${user.displayName || user.username} 🌐`,
        action: 'UPDATE_SETTINGS_DASHBOARD',
        content: JSON.stringify(req.body)
      });
      return res.json({ success: true, settings: updated, message: 'Đã lưu cài đặt thành công!' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Lỗi khi lưu cài đặt' });
    }
  });

  return router;
};
