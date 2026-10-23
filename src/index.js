
const crypto = require('crypto');
function signTunnelUrl(url, secret) {
  if (!url || !secret) return '';
  return crypto.createHmac('sha256', secret).update(url.trim().replace(/\/$/, '')).digest('hex');
}
// Thiết lập độ ưu tiên CPU cao nhất cho tiến trình phát nhạc trên Linux (nice -5)
const os = require('os');
try {
  if (process.platform === 'linux') {
    os.setPriority(0, -5);
  }
} catch (e) {}

const {
  Client,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  GatewayIntentBits,
  Collection,
  ActivityType,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  Options
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const musicManager = require('./structures/MusicManager');
const settingsManager = require('./structures/SettingsManager');
const favoriteManager = require('./structures/FavoriteManager');
const userPlaylistManager = require('./structures/UserPlaylistManager');
const { connectDatabase } = require('./database/mongoose');
const { searchTrack } = require('./utils/musicExtractor');
const { t } = require('./utils/i18n');
const {
  is247Track,
  createNowPlayingCard,
  createNowPlayingEmbed,
  createMusicControls,
  CUSTOM_EMOJIS,
  EMOJI_TAG,
  createSettingsEmbed,
  createSettingsSelectMenu,
  createAutoplayLayersEmbed,
  createAutoplayLayersComponents,
  createQueueEmbed,
  createQueueContainer,
  createQueuePaginationButtons,
  createQueueDeleteSelectMenu,
  createSuccessEmbed,
  createErrorEmbed,
  createEmbed,
  formatMarkdownTitle,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
} = require('./utils/embed');
const { hasMusicPermission, hasManagerPermission, isAllowedVoiceChannel, isStrictAdmin } = require('./utils/permissionHelper');
const { initLogger, logAction } = require('./utils/debugLogger');
const { initStatusNotifier } = require('./utils/statusNotifier');

// 1. Khởi tạo Discord Client tối ưu bộ nhớ cho VPS 2GB RAM / 1 Core CPU
const client = new Client({
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    ReactionManager: 0,
    GuildMemberManager: {
      maxSize: 100,
      keepOverLimit: member => member.id === client.user?.id
    },
    UserManager: 100,
    PresenceManager: 0
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 300,
      lifetime: 60
    },
    users: {
      interval: 3600,
      filter: () => user => user.id !== client.user?.id
    }
  },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  allowedMentions: {
    parse: [],
    repliedUser: false
  }
});
global._discordClient = client;

function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

initLogger(client);
initStatusNotifier(client, {
  adminId: config.adminId || '875358286487097395',
  botName: 'Anna Music Bot',
  platform: 'VPS Ubuntu (PM2)'
});

client.commands = new Collection();
client.aliases = new Collection();
const buttonCooldownMap = new Map(); // Chống spam click nút bấm Discord (Next, Pause, v.v.)

// 2. Tải toàn bộ lệnh tiền tố
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.name) {
      client.commands.set(command.name, command);
      if (command.aliases && Array.isArray(command.aliases)) {
        command.aliases.forEach(alias => client.aliases.set(alias, command.name));
      }
    }
  }
}

// 3. Keep-Alive Web Server (Express) & API Routes
client.musicManager = musicManager;
const app = express();
const createApiRouter = require('./routes/api');

app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use('/api', createApiRouter(client));
app.use(express.static(path.join(__dirname, '../public')));

app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    botStatus: client.user ? 'ONLINE' : 'OFFLINE',
    wsPing: client.ws ? client.ws.ping : null,
    wsStatus: client.ws ? client.ws.status : null
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('🎵 Anna Music Bot (24/7) đang hoạt động ổn định!');
  }
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`[Express Web Server] Đang lắng nghe trên cổng ${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Express Web Server] Cổng ${port} đã có ứng dụng dùng, tự động chuyển sang ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[Express Web Server Error]', err);
    }
  });
}
const sessionManager = require('./structures/SessionManager');

console.log('🎵 ANNA MUSIC BOT ĐANG KHỞI ĐỘNG...');
const serverPort = process.env.PORT && process.env.PORT !== '3005' ? Number(process.env.PORT) : 3000;
startServer(serverPort);

// 4. Sự kiện khi Bot sẵn sàng
client.once(Events.ClientReady, async () => {
  console.log(`🚀 [Discord Bot Ready] Đăng nhập thành công: ${client.user.tag}`);
  logAction('SET_ACTIVITY', {
    type: 'Listening',
    text: 'o_O 🫵 | /help'
  });
  client.user.setActivity('ò_Ó 🫵 | /help', { type: ActivityType.Listening });
  await connectDatabase();

  // Quét và tự động rời khỏi các máy chủ không còn nằm trong danh sách Whitelist
  if (config.allowedGuildIds && config.allowedGuildIds.length > 0) {
    for (const [gId, g] of client.guilds.cache) {
      if (!config.allowedGuildIds.includes(gId)) {
        console.warn(`[Startup Whitelist Scan] Rời khỏi máy chủ không được phép: ${g.name} (${gId})`);
        g.leave().catch(() => {});
      }
    }
  }

  // Đăng ký Slash Commands tự động lên Discord REST API (Chạy ngầm không chặn luồng khởi động bot)
  try {
    const { deploySlashCommands } = require('./deploy-commands');
    deploySlashCommands(client).catch(deployErr => {
      console.warn('[Auto-Deploy Slash Commands Error]:', deployErr.message);
    });
  } catch (deployErr) {
    console.warn('[Auto-Deploy Slash Commands Error]:', deployErr.message);
  }

  // 🔄 Đồng bộ cấu hình cài đặt từ MongoDB và khôi phục kết nối các phòng Voice
  try {
    await settingsManager.syncFromDatabase().catch(() => {});
    await sessionManager.syncFromDatabase();
    const activeSessions = sessionManager.getAllActiveSessions();
    for (const session of activeSessions) {
      // Bỏ qua khôi phục phiên nếu máy chủ không nằm trong Whitelist
      if (config.allowedGuildIds && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(session.guildId)) {
        continue;
      }
      // Giãn cách 2.5s giữa mỗi máy chủ để chống nghẽn CPU và quá tải Voice Gateway
      await new Promise(r => setTimeout(r, 2500));
      try {
        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) continue;
        const voiceChannel = guild.channels.cache.get(session.voiceChannelId);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) continue;
        const textChannel = session.textChannelId ? guild.channels.cache.get(session.textChannelId) : null;

        console.log(`[Auto-Recovery] Đang tự động kết nối lại phòng: ${voiceChannel.name} tại máy chủ ${guild.name}...`);
        const q = musicManager.getOrCreate(guild, textChannel, voiceChannel);
        await q.connect();

        if (session.mode247) {
          logAction('VOICE_STATUS_UPDATE', {
            source: 'index.js/24x7-recovery',
            channelId: voiceChannel.id,
            status: '24/7 Mode'
          });
          setVoiceChannelStatus(voiceChannel, '♾️ 24/7 Mode');
        }

        // Khôi phục bài hát đang nghe dở và danh sách hàng chờ nếu có
        const savedSongs = Array.isArray(session.songs) ? session.songs.filter(Boolean) : [];
        const savedCurrent = session.currentSong || null;
        if (savedCurrent || savedSongs.length > 0) {
          console.log(`[Auto-Recovery] Khôi phục hàng chờ (${savedSongs.length} bài) cho máy chủ ${guild.name}`);
          q.songs = [...savedSongs];
          if (savedCurrent) {
            const isLofi = Boolean(savedCurrent.is247 || savedCurrent.requestedBy === 'Auto (24/7)');
            const positionSec = Number(session.position) || 0;
            const durSec = savedCurrent.duration ? parseDurationToSeconds(savedCurrent.duration) : 0;
            if (!isLofi && positionSec > 5 && (!durSec || positionSec < durSec - 5)) {
              console.log(`[Auto-Recovery] Phục hồi vị trí phát tiếp ở giây thứ ${positionSec}s cho bài "${savedCurrent.title}"`);
              savedCurrent.initialSeekSeconds = positionSec;
            }
            q.songs.unshift(savedCurrent);
          }
          await q.playNext();
          q.enrichMissingThumbnails?.().catch(() => {});
        } else if (session.mode247) {
          await q._play247BackgroundLofi();
        }
      } catch (recErr) {
        console.warn(`[Auto-Recovery Error for Guild ${session.guildId}]:`, recErr.message);
      }
    }
  } catch (syncErr) {
    console.warn('[Session Sync Error]:', syncErr.message);
  }

  // 🧹 Định kỳ dọn dẹp bộ nhớ RAM và giám sát tiến trình mỗi 5 phút
  setInterval(() => {
    try {
      if (global.gc) {
        global.gc();
      }
      const mem = process.memoryUsage();
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      console.log(`[Memory Monitor] RAM Sử dụng: RSS=${rssMB}MB | HeapUsed=${heapMB}MB`);
    } catch (e) {}
  }, 5 * 60 * 1000);

  console.log('✨ Anna Music Bot đã sẵn sàng nhận lệnh 24/7!');
});

// Ghi log tin nhắn của người dùng trong kênh voice / kênh âm nhạc hoặc có đính kèm
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!isAllowedGuild(message.guild.id, message.author.id)) return;

  const isVoiceText = message.channel.isVoiceBased?.() || message.channel.type === 2;
  const guildSettings = settingsManager.get(message.guild.id);
  const isMusicChan = guildSettings.musicChannelId && message.channel.id === guildSettings.musicChannelId;

  if (isVoiceText || isMusicChan || message.attachments.size > 0) {
    const attachmentUrls = message.attachments.map(a => a.url);
    logAction('MESSAGE_USER_SEND', {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      user: message.author.tag,
      content: message.content,
      attachments: attachmentUrls,
      avatar: message.author.displayAvatarURL({ dynamic: true })
    });
  }
});

// Xử lý ghi nhận khi tin nhắn bị sửa (Message Update)
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    logAction('MESSAGE_EDIT', {
      type: 'USER_MESSAGE_EDIT',
      channelId: newMessage.channelId,
      guildId: newMessage.guild.id,
      userId: newMessage.author?.id,
      user: newMessage.author?.tag,
      messageId: newMessage.id,
      oldContent: oldMessage.content || '',
      newContent: newMessage.content || ''
    });
  } catch (e) {}
});

// Xử lý ghi nhận khi tin nhắn bị xóa (Message Delete)
client.on('messageDelete', async (message) => {
  try {
    if (!message.guild || message.author?.id === client.user.id) return;
    logAction('MESSAGE_DELETE', {
      type: 'USER_MESSAGE_DELETE',
      channelId: message.channelId,
      guildId: message.guild.id,
      userId: message.author?.id,
      user: message.author?.tag,
      messageId: message.id,
      content: message.content || ''
    });
  } catch (e) {}
});

// Xử lý VoiceStateUpdate (Bot rời phòng, đổi phòng hoặc phòng trống)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = oldState.guild || newState.guild;
  if (!guild) return;

  const queue = musicManager.get(guild.id);

  // 1. Khi chính BOT bị ngắt kết nối hoặc rời khỏi kênh Voice
  if (oldState.id === client.user.id && !newState.channelId) {
    logAction('VOICE_STATE_UPDATE', {
      event: 'BOT_DISCONNECTED',
      guildId: guild.id,
      oldChannelId: oldState.channelId,
      newChannelId: 'null'
    });
    if (oldState.channel) {
      await clearVoiceChannelStatus(oldState.channel).catch(() => {});
    }
    if (queue) {
      if (queue._manualLeave || !queue.mode247) {
        queue.destroy();
      } else if (queue.mode247 && !queue.isDestroyed && !queue._manualLeave) {
        // Watchdog: Nếu đang ở chế độ 24/7 mà bot bị ngắt ra khỏi phòng, tự vào lại sau 1.5s
        setTimeout(async () => {
          if (queue.mode247 && !queue.isDestroyed && !queue._manualLeave) {
            const me = guild.members.me;
            if (!me?.voice?.channelId && queue.voiceChannel) {
              console.log(`[24/7 Voice Watchdog] Bot không có trong phòng tại ${guild.name}, tự động kết nối lại...`);
              try {
                await queue.connect();
              } catch (e) {
                console.warn('[24/7 Voice Watchdog Reconnect Failed]:', e.message);
              }
            }
          }
        }, 1500);
      }
    }
    return;
  }

  // 2. Khi BOT bị chuyển sang phòng Voice khác
  if (oldState.id === client.user.id && newState.channelId && oldState.channelId !== newState.channelId) {
    logAction('VOICE_STATE_UPDATE', {
      event: 'BOT_MOVED_CHANNEL',
      guildId: guild.id,
      oldChannelId: oldState.channelId,
      newChannelId: newState.channelId
    });
    if (oldState.channel) {
      await clearVoiceChannelStatus(oldState.channel).catch(() => {});
    }
    if (queue) {
      queue.voiceChannel = newState.channel;
      if (queue.currentSong) {
        logAction('VOICE_STATUS_UPDATE', {
          source: 'index.js/voiceStateUpdate',
          channelId: newState.channelId,
          status: `🎶 ${queue.currentSong.title}`.slice(0, 80)
        });
        await setVoiceChannelStatus(newState.channel, `🎶 ${queue.currentSong.title}`).catch(() => {});
      }
    }
    return;
  }

  // 3. Xử lý phòng trống (không còn người nghe)
  if (queue) {
    const activeVoice = typeof queue.getVoiceChannel === 'function' ? queue.getVoiceChannel() : queue.voiceChannel;
    if (activeVoice) {
      const humanCount = typeof queue.getHumanMemberCount === 'function' ? queue.getHumanMemberCount() : 1;
      const guildSettings = settingsManager.get(guild.id);

      if (humanCount === 0) {
        logAction('VOICE_STATE_UPDATE', {
          event: 'ROOM_EMPTY',
          guildId: guild.id,
          channelId: activeVoice.id,
          userId: newState.id
        });
        queue.startEmptyRoomTimer(guildSettings.emptyChannelTimeout || 60);
      } else {
        logAction('VOICE_STATE_UPDATE', {
          event: 'ROOM_NOT_EMPTY',
          guildId: guild.id,
          channelId: activeVoice.id,
          humanCount: humanCount,
          userId: newState.id
        });
        queue.clearEmptyRoomTimer();
        // Đánh thức luồng phát nhạc 24/7 khi có người bước vào phòng đang Sleep Mode (xử lý cả khi còn bài dở)
        if (queue.mode247 && !queue.currentSong && !queue._isPlayingNext) {
          queue.isQueueOnHold = false;
          if (queue.songs.length > 0) {
            queue.playNext().catch(() => {});
          } else {
            queue._play247BackgroundLofi().catch(() => {});
          }
        }
      }
    }
  }

  // 4. Log chi tiết hoạt động của User trong phòng Voice (Ai vào, ra, đổi phòng, stream, cam, mic)
  const member = newState.member || oldState.member;
  if (member && !member.user.bot) {
    const userTag = member.user.tag;
    const userId = member.user.id;
    const avatar = member.user.displayAvatarURL({ dynamic: true });

    // A. User tham gia phòng Voice
    if (!oldState.channelId && newState.channelId) {
      logAction('VOICE_USER_JOIN', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }
    // B. User rời khỏi phòng Voice
    else if (oldState.channelId && !newState.channelId) {
      logAction('VOICE_USER_LEAVE', {
        guildId: guild.id,
        channelId: oldState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }
    // C. User chuyển phòng Voice
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      logAction('VOICE_USER_MOVE', {
        guildId: guild.id,
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
        userId: userId,
        user: userTag,
        avatar: avatar
      });
    }

    // D. User bật/tắt chia sẻ màn hình (Stream)
    if (!oldState.streaming && newState.streaming) {
      logAction('VOICE_USER_STREAM', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        status: `Bắt đầu chia sẻ màn hình trong <#${newState.channelId}>`,
        avatar: avatar
      });
    } else if (oldState.streaming && !newState.streaming) {
      logAction('VOICE_USER_STREAM', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã dừng chia sẻ màn hình`,
        avatar: avatar
      });
    }

    // E. User bật/tắt Camera
    if (!oldState.selfVideo && newState.selfVideo) {
      logAction('VOICE_USER_VIDEO', {
        guildId: guild.id,
        channelId: newState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã bật Camera trong <#${newState.channelId}>`,
        avatar: avatar
      });
    } else if (oldState.selfVideo && !newState.selfVideo) {
      logAction('VOICE_USER_VIDEO', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `Đã tắt Camera`,
        avatar: avatar
      });
    }

    // F. User Mute / Deafen
    if ((oldState.selfMute !== newState.selfMute || oldState.selfDeaf !== newState.selfDeaf) && (newState.channelId || oldState.channelId)) {
      const muteStatus = newState.selfMute ? 'Tắt Mic (Muted)' : 'Mở Mic (Unmuted)';
      const deafStatus = newState.selfDeaf ? 'Tắt Tai nghe (Deafened)' : 'Mở Tai nghe (Undeafened)';
      logAction('VOICE_USER_MUTE_DEAF', {
        guildId: guild.id,
        channelId: newState.channelId || oldState.channelId,
        userId: userId,
        user: userTag,
        status: `${muteStatus} • ${deafStatus}`,
        avatar: avatar
      });
    }
  }
});

// Xử lý khi Bot bị kick/rời khỏi Server
client.on('guildDelete', async (guild) => {
  const queue = musicManager.get(guild.id);
  if (queue) {
    if (queue.voiceChannel) {
      await clearVoiceChannelStatus(queue.voiceChannel).catch(() => {});
    }
    queue.destroy();
  }
});

// Helper kiểm tra danh sách máy chủ được phép (Private / Whitelist Multi-Guild)
function isAllowedGuild(guildId, userId) {
  if (!config.allowedGuildIds || config.allowedGuildIds.length === 0) return true;
  if (config.allowedGuildIds.includes(guildId)) return true;
  if (userId && String(userId) === String(config.adminId)) return true;
  return false;
}

// Tự động kiểm tra và rời máy chủ nếu không nằm trong Whitelist & Đăng ký Slash Commands cho server mới
client.on(Events.GuildCreate, async (guild) => {
  if (config.allowedGuildIds && config.allowedGuildIds.length > 0 && !config.allowedGuildIds.includes(guild.id)) {
    console.warn(`[Whitelist] Máy chủ "${guild.name}" (${guild.id}) không nằm trong danh sách được phép. Đang tự rời khỏi...`);
    try {
      await guild.leave();
    } catch (e) {
      console.warn(`[Whitelist] Không thể rời máy chủ ${guild.id}:`, e.message);
    }
    return;
  }

  // Tự động đồng bộ ngay lập tức toàn bộ Slash Commands cho máy chủ mới vừa tham gia
  try {
    const { deploySlashCommands } = require('./deploy-commands');
    await deploySlashCommands(client, guild.id);
    console.log(`✅ [Guild Join] Đã triển khai thành công Slash Commands cho máy chủ: ${guild.name} (${guild.id})`);
  } catch (deployErr) {
    console.warn(`[Guild Join Deploy Error]:`, deployErr.message);
  }
});

// Xử lý Tương tác (Slash Commands, Nút bấm, Menu Dropdown, Modal thêm bài hát)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;

  // Kiểm tra Whitelist máy chủ
  if (!isAllowedGuild(interaction.guild.id, interaction.user.id)) {
    if (interaction.isRepliable()) {
      return interaction.reply({
        content: (settingsManager.get(interaction.guild?.id)?.language === 'en' ? '❌ This server is not whitelisted to use Anna Music Bot. Please contact an Administrator for support!' : '❌ Máy chủ này chưa được cấp phép sử dụng Anna Music Bot. Vui lòng liên hệ Quản trị viên để được hỗ trợ!'),
        ephemeral: true
      }).catch(() => {});
    }
    return;
  }

  try {

  // -1. Xử lý Autocomplete cho Slash Commands (Gợi ý bài hát siêu tốc độ qua Worker Thread)
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'play') {
      const focusedOption = interaction.options.getFocused(true);
      if (focusedOption.name === 'song') {
        const query = focusedOption.value?.trim();
        if (!query || query.length < 2 || query.startsWith('http')) {
          return interaction.respond([]).catch(() => {});
        }
        try {
          const { searchMultipleTracks } = require('./utils/musicExtractor');
          const results = await searchMultipleTracks(query, 8, 'all');
          const choices = (results || []).slice(0, 8).map(track => {
            const artistPart = track.artist ? ` - ${track.artist}` : '';
            const durPart = track.duration ? ` [${track.duration}]` : '';
            const fullLabel = `${track.title}${artistPart}${durPart}`;
            return {
              name: fullLabel.length > 100 ? fullLabel.slice(0, 97) + '...' : fullLabel,
              value: (track.url || track.title).slice(0, 100)
            };
          });
          return interaction.respond(choices).catch(() => {});
        } catch (autoErr) {
          return interaction.respond([]).catch(() => {});
        }
      }
    }
    return;
  }

  // 0. Xử lý Slash Commands (Chat Input)
  if (interaction.isChatInputCommand()) {
    const commandName = interaction.commandName;
    const command = client.commands.get(commandName) || client.commands.get(client.aliases.get(commandName));
    if (!command) return;

    // Kiểm tra kênh văn bản nhận lệnh
    const guildSettings = settingsManager.get(interaction.guild.id);
    if (guildSettings.musicChannelId && guildSettings.musicChannelId !== interaction.channelId) {
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasAdminPerm = interaction.member?.permissions?.has('Administrator') || interaction.member?.permissions?.has('ManageGuild');
      if (!isOwner && !hasAdminPerm) {
        return interaction.reply({
          content: `${EMOJI_TAG.warning} ${t(interaction.guild.id, 'common.text_locked', { channelId: guildSettings.musicChannelId })}`,
          flags: 64
        });
      }
    }

    logAction('SLASH_COMMAND', {
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      user: interaction.user.tag,
      command: `/${commandName}`,
      avatar: interaction.user.displayAvatarURL({ dynamic: true })
    });

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[Slash Command Error - /${commandName}]:`, err);
      const isEnCmd = settingsManager.get(interaction.guild?.id)?.language === 'en';
      const errMsg = (isEnCmd ? 'An error occurred while executing command: ' : 'Đã xảy ra lỗi khi thực thi lệnh: ') + err.message;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errMsg, embeds: [] }).catch(() => {});
      } else {
        await interaction.reply({ content: errMsg, flags: 64 }).catch(() => {});
      }
    }
    return;
  }

  // 1. Xử lý Popup Modal Thêm bài hát (Hỗ trợ cả Playlist tối đa 20 bài)
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_add_song') {
      if (!hasMusicPermission(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))], flags: 64 });
      }
      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        logAction('INTERACTION_REPLY', {
          type: 'MODAL_NO_VOICE',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          flags: 64
        });
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_voice'))], flags: 64 });
      }
      if (!isAllowedVoiceChannel(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.voice_locked', { channelId: guildSettings.lockedVoiceChannelId }))], flags: 64 });
      }
      const botVoice = interaction.guild?.members?.me?.voice?.channel;
      if (botVoice && memberVoice.id !== botVoice.id && !isStrictAdmin(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.different_voice', { channel: botVoice.name }))], flags: 64 });
      }

      const query = interaction.fields.getTextInputValue('song_query')?.trim();
      if (!query) {
        logAction('INTERACTION_REPLY', {
          type: 'MODAL_NO_QUERY',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          flags: 64
        });
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Please enter a valid song name or URL!' : 'Vui lòng nhập tên bài hát hoặc đường dẫn hợp lệ!')], flags: 64 });
      }

      logAction('INTERACTION_DEFER_REPLY', {
        type: 'MODAL_ADD_SONG',
        interactionId: interaction.id,
        channelId: interaction.channelId
      });
      await interaction.deferReply();

      try {
        const tracks = await searchTrack(query);
        if (!tracks || tracks.length === 0) {
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_NO_RESULT',
            interactionId: interaction.id,
            channelId: interaction.channelId
          });
          return interaction.editReply({ embeds: [createErrorEmbed(t(interaction.guildId, 'errors.track_not_found'))] });
        }

        const queue = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
        await queue.connect();

        if (tracks.length === 1) {
          const track = tracks[0];
          await queue.addSong(track, interaction.member || interaction.user);
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_ADDED_SINGLE',
            interactionId: interaction.id,
            channelId: interaction.channelId,
            content: track.title.slice(0, 60)
          });
          return interaction.editReply({
            embeds: [createSuccessEmbed(t(interaction.guildId, 'player.added_single', {
              title: track.title,
              url: track.url,
              duration: track.duration || '3:30',
              position: queue.songs.length
            }))]
          });
        } else {
          await queue.addSongs(tracks, interaction.member || interaction.user);
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_ADDED_PLAYLIST',
            interactionId: interaction.id,
            channelId: interaction.channelId,
            count: tracks.length
          });
          return interaction.editReply({
            embeds: [createSuccessEmbed(t(interaction.guildId, 'player.added_playlist', {
              count: tracks.length,
              title: tracks[0]?.playlistTitle || 'Playlist'
            }))]
          });
        }
      } catch (err) {
        console.error('[Modal Add Song Error]:', err);
        logAction('INTERACTION_EDIT_REPLY', {
          type: 'MODAL_ERROR',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          content: (err.message || '').slice(0, 60)
        });
        return interaction.editReply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `Error adding song: ${err.message}` : `Lỗi khi thêm bài hát: ${err.message}`)] });
      }
    }

    // Xóa bài theo số thứ tự (từ Modal)
    if (interaction.customId === 'modal_queue_delete_index') {
      if (!hasMusicPermission(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))], flags: 64 });
      }
      const memberVoice = interaction.member?.voice?.channel;
      const botVoice = interaction.guild?.members?.me?.voice?.channel;
      if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id) && !isStrictAdmin(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.different_voice', { channel: botVoice?.name || '' }))], flags: 64 });
      }

      const posStr = interaction.fields.getTextInputValue('queue_song_position')?.trim();
      const pos = parseInt(posStr, 10);
      const queue = musicManager.get(interaction.guild.id);
      const userSongs = queue?.getUserSongs ? queue.getUserSongs() : (queue?.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
      if (!queue || userSongs.length === 0) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'player.queue_empty'))], flags: 64 });
      }

      if (isNaN(pos) || pos < 1 || pos > userSongs.length) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `Invalid track index! Please enter a number between 1 and ${userSongs.length}.` : `Số thứ tự không hợp lệ! Vui lòng nhập từ 1 đến ${userSongs.length}.`)], flags: 64 });
      }

      const target = userSongs[pos - 1];
      const actualIdx = queue.songs.indexOf(target);
      if (actualIdx === -1) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Matching song not found in queue!' : 'Không tìm thấy bài hát tương ứng trong hàng chờ!')], flags: 64 });
      }

      const removed = queue.songs.splice(actualIdx, 1)[0];
      queue._saveSessionState?.();
      return interaction.reply({
        embeds: [createSuccessEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `🗑️ Successfully removed track **#${pos}**: **${removed.title}** from queue.` : `🗑️ Đã xóa thành công bài số **${pos}**: **${removed.title}** khỏi hàng chờ.`)],
        flags: 64
      });
    }

    // Điều chỉnh âm lượng nhanh từ Modal của nút btn_volume
    if (interaction.customId === 'modal_set_volume') {
      if (!hasMusicPermission(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))], flags: 64 });
      }
      const memberVoice = interaction.member?.voice?.channel;
      const botVoice = interaction.guild?.members?.me?.voice?.channel;
      if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id) && !isStrictAdmin(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.different_voice', { channel: botVoice?.name || '' }))], flags: 64 });
      }

      const volStr = interaction.fields.getTextInputValue('volume_level_input')?.trim();
      const vol = parseInt(volStr, 10);
      const queue = musicManager.get(interaction.guild.id);

      if (!queue) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_queue'))], flags: 64 });
      }
      if (isNaN(vol) || vol < 1 || vol > 100) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Please enter a valid volume between **1** and **100**!' : 'Vui lòng nhập mức âm lượng hợp lệ từ **1** đến **100**!')], flags: 64 });
      }

      queue.setVolume(vol);

      // Cập nhật lại Player Card nếu đang mở
      if (queue.currentSong && queue.nowPlayingMessage) {
        const isV2 = queue.nowPlayingMessage.components?.[0]?.type === 17 || queue.nowPlayingMessage.flags?.has?.(32768);
        if (isV2) {
          queue.nowPlayingMessage.edit(createNowPlayingCard(queue.currentSong, queue)).catch(() => {});
        } else {
          const embed = createNowPlayingEmbed(queue.currentSong, queue);
          const controls = createMusicControls(queue);
          queue.nowPlayingMessage.edit({ embeds: [embed], components: controls }).catch(() => {});
        }
      }

      return interaction.reply({
        embeds: [createSuccessEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `Adjusted playback volume to **${vol}%**` : `Đã điều chỉnh âm lượng phát nhạc thành **${vol}%**`)],
        flags: 64
      });
    }
  }

  // 2. Xử lý Menu Dropdown (Cài đặt & Xóa bài khỏi Hàng chờ)
  if (interaction.isStringSelectMenu()) {
    // Xóa bài hát khỏi Hàng chờ (hỗ trợ menu_queue_remove hoặc menu_queue_remove_<page>)
    if (interaction.customId.startsWith('menu_queue_remove')) {
      const queue = musicManager.get(interaction.guild.id);
      if (!queue) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_queue'))], flags: 64 });
      }

      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.dj_only', { role: roleText }))], flags: 64 });
      }

      if (interaction.values[0] === 'remove_all') {
        queue.songs = [];
        queue._saveSessionState?.();
        const newEmbed = createQueueEmbed(queue, 1);
        return interaction.update({ embeds: [newEmbed], components: [] });
      }

      const match = interaction.customId.match(/menu_queue_remove(?:_(\d+))?/);
      let page = match && match[1] ? parseInt(match[1], 10) : 1;

      const idx = parseInt(interaction.values[0].replace('remove_', ''), 10);
      const userSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
      if (!isNaN(idx) && idx >= 0 && idx < userSongs.length) {
        const target = userSongs[idx];
        const actualIdx = queue.songs.indexOf(target);
        if (actualIdx !== -1) {
          queue.songs.splice(actualIdx, 1);
          queue._saveSessionState?.();
        }

        const remainingUserSongs = queue.getUserSongs ? queue.getUserSongs() : (queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)' && s.requestedBy !== 'Auto (24/7 Lofi)');
        const totalPages = Math.max(1, Math.ceil(remainingUserSongs.length / 10));
        if (page > totalPages) page = totalPages;

        const newEmbed = createQueueEmbed(queue, page);
        const components = [];
        if (remainingUserSongs.length > 0) {
          components.push(createQueuePaginationButtons(page, totalPages));
          const newMenu = createQueueDeleteSelectMenu(queue, page);
          if (newMenu) components.push(newMenu);
        }
        return interaction.update({ embeds: [newEmbed], components });
      }
    }

    // Chọn bài hát cụ thể từ Menu Yêu thích (/favorite list)
    if (interaction.customId.startsWith('menu_play_fav_song_')) {
      const targetUserId = interaction.customId.replace('menu_play_fav_song_', '');
      if (interaction.user.id !== targetUserId) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'You can only select songs from your own favorites list!' : 'Bạn chỉ có thể chọn bài từ danh sách yêu thích của chính mình!')], flags: 64 });
      }

      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_voice'))], flags: 64 });
      }

      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.dj_only', { role: roleText }))], flags: 64 });
      }

      if (!isAllowedVoiceChannel(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        return interaction.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`)], flags: 64 });
      }

      const favorites = await favoriteManager.getFavorites(targetUserId);
      const songIdx = parseInt(interaction.values[0].replace('fav_song_', ''), 10);
      const selectedSong = favorites && favorites[songIdx];

      if (!selectedSong) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Selected song not found!' : 'Không tìm thấy bài hát đã chọn!')], flags: 64 });
      }

      logAction('INTERACTION_DEFER_REPLY', {
        type: 'MENU_PLAY_FAV_SONG',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        song: selectedSong.title,
        flags: 64
      });

      await interaction.deferReply({ flags: 64 });
      const q = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
      await q.connect();
      await q.addSong(selectedSong, interaction.member || interaction.user);

      logAction('INTERACTION_EDIT_REPLY', {
        type: 'MENU_PLAY_FAV_SONG_DONE',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        song: selectedSong.title
      });

      return interaction.editReply({
        embeds: [createSuccessEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `❤️ Added [**${formatMarkdownTitle(selectedSong.title, 60)}**](${selectedSong.url}) to queue!` : `❤️ Đã nạp bài hát [**${formatMarkdownTitle(selectedSong.title, 60)}**](${selectedSong.url}) vào hàng chờ!`)]
      });
    }

    // Bảng Cài đặt
    if (interaction.customId === 'menu_settings') {
      if (!isStrictAdmin(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))], flags: 64 });
      }

      const selectedValue = interaction.values[0];
      const guildId = interaction.guild.id;
      const currentSettings = settingsManager.get(guildId);
      const queue = musicManager.get(guildId);

      let updatedSettings = {};

      if (selectedValue === 'set_autoplay_layers') {
        const layersEmbed = createAutoplayLayersEmbed(interaction.guild, currentSettings);
        const layersComponents = createAutoplayLayersComponents(currentSettings);
        return interaction.update({ embeds: [layersEmbed], components: layersComponents });
      } else if (selectedValue === 'set_language') {
        const newLang = currentSettings.language === 'en' ? 'vi' : 'en';
        updatedSettings = settingsManager.update(guildId, { language: newLang });
        if (queue && typeof queue.refreshNowPlayingCard === 'function') {
          queue.refreshNowPlayingCard();
        }
        if (queue?.voiceChannel && !queue.currentSong) {
          if (queue.mode247) {
            setVoiceChannelStatus(queue.voiceChannel, newLang === 'en' ? '♾️ 24/7 Idle Mode' : '♾️ 24/7 Chờ phát nhạc');
          } else {
            clearVoiceChannelStatus(queue.voiceChannel);
          }
        }
      } else if (selectedValue === 'set_ai') {
        const newVal = !(currentSettings.useAiAssistant !== false);
        updatedSettings = settingsManager.update(guildId, { useAiAssistant: newVal });
      } else if (selectedValue === 'set_247') {
        const newVal = !currentSettings.mode247;
        updatedSettings = settingsManager.update(guildId, { mode247: newVal });
        if (queue) {
          queue.mode247 = newVal;
          if (newVal) {
            queue.clearEmptyRoomTimer();
            if (!queue.currentSong) {
              queue._play247BackgroundLofi().catch(() => {});
            }
          } else {
            if (queue.currentSong && queue.currentSong.requestedBy === 'Auto (24/7)') {
              queue.stop();
              clearVoiceChannelStatus(queue.voiceChannel);
            }
          }
        }
      } else if (selectedValue === 'set_autoplay') {
        const newVal = !currentSettings.autoplay;
        updatedSettings = settingsManager.update(guildId, { autoplay: newVal });
      } else if (selectedValue === 'set_skip_offtopic') {
        const newVal = !(currentSettings.autoSkipOfftopic !== false);
        updatedSettings = settingsManager.update(guildId, { autoSkipOfftopic: newVal });
      } else if (selectedValue === 'set_voice_lock') {
        const userVoice = interaction.member?.voice?.channel;
        const newVoiceLock = currentSettings.lockedVoiceChannelId ? null : (userVoice ? userVoice.id : null);
        updatedSettings = settingsManager.update(guildId, { lockedVoiceChannelId: newVoiceLock });
      } else if (selectedValue === 'set_channel_lock') {
        const newChannel = currentSettings.musicChannelId ? null : interaction.channel.id;
        updatedSettings = settingsManager.update(guildId, { musicChannelId: newChannel });
      } else if (selectedValue === 'set_log_channel') {
        const newLogChannel = currentSettings.logChannelId ? null : interaction.channel.id;
        updatedSettings = settingsManager.update(guildId, { logChannelId: newLogChannel });
      } else if (selectedValue === 'set_dj_only') {
        const newVal = !currentSettings.djOnly;
        updatedSettings = settingsManager.update(guildId, { djOnly: newVal });
      } else if (selectedValue === 'set_crossfade') {
        let newCrossfade = 3;
        if (currentSettings.crossfadeDuration === 3) newCrossfade = 5;
        else if (currentSettings.crossfadeDuration === 5) newCrossfade = 10;
        else if (currentSettings.crossfadeDuration === 10) newCrossfade = 0;
        else newCrossfade = 3;

        updatedSettings = settingsManager.update(guildId, { crossfadeDuration: newCrossfade });
      } else if (selectedValue === 'set_timeout') {
        let newTimeout = 60;
        if (currentSettings.emptyChannelTimeout === 60) newTimeout = 120;
        else if (currentSettings.emptyChannelTimeout === 120) newTimeout = 300;
        else if (currentSettings.emptyChannelTimeout === 300) newTimeout = 30;
        else newTimeout = 60;

        updatedSettings = settingsManager.update(guildId, { emptyChannelTimeout: newTimeout });
      } else if (selectedValue === 'set_volume') {
        let newVol = 80;
        if (currentSettings.defaultVolume === 80) newVol = 100;
        else if (currentSettings.defaultVolume === 100) newVol = 30;
        else if (currentSettings.defaultVolume === 30) newVol = 50;
        else newVol = 80;

        updatedSettings = settingsManager.update(guildId, { defaultVolume: newVol });
        if (queue) queue.setVolume(newVol);
      } else if (selectedValue === 'set_loop') {
        let newLoop = 'off';
        if (currentSettings.loopMode === 'off') newLoop = 'song';
        else if (currentSettings.loopMode === 'song') newLoop = 'queue';
        else newLoop = 'off';

        updatedSettings = settingsManager.update(guildId, { loopMode: newLoop });
        if (queue) queue.loopMode = newLoop;
      } else if (selectedValue === 'set_announce') {
        const newVal = !currentSettings.announceSongs;
        updatedSettings = settingsManager.update(guildId, { announceSongs: newVal });
      } else if (selectedValue === 'set_voice_status') {
        const newVal = !(currentSettings.updateVoiceStatus !== false);
        updatedSettings = settingsManager.update(guildId, { updateVoiceStatus: newVal });
        if (!newVal && queue?.voiceChannel) {
          clearVoiceChannelStatus(queue.voiceChannel).catch(() => {});
        }
      } else if (selectedValue === 'set_reset') {
        updatedSettings = settingsManager.reset(guildId);
        if (queue) {
          queue.mode247 = updatedSettings.mode247;
          queue.volume = updatedSettings.defaultVolume;
          queue.loopMode = updatedSettings.loopMode;
        }
      }

      const newEmbed = createSettingsEmbed(interaction.guild, updatedSettings);
      const newMenu = createSettingsSelectMenu(updatedSettings);

      return interaction.update({ embeds: [newEmbed], components: [newMenu] });
    }

    // Xử lý Dropdown đa chọn cấu hình tầng Autoplay
    if (interaction.customId === 'menu_autoplay_layers') {
      if (!isStrictAdmin(interaction.member)) {
        return interaction.reply({
          embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))],
          flags: 64
        });
      }

      const guildId = interaction.guild.id;
      const selectedLayers = interaction.values; // Mảng các giá trị được tích chọn
      const updatedSettings = settingsManager.update(guildId, { autoplayLayers: selectedLayers });

      const newEmbed = createAutoplayLayersEmbed(interaction.guild, updatedSettings);
      const newComponents = createAutoplayLayersComponents(updatedSettings);

      return interaction.update({ embeds: [newEmbed], components: newComponents });
    }
  }

  // 3. Xử lý Nút bấm điều khiển nhạc
  if (interaction.isButton()) {
    const queue = musicManager.get(interaction.guild.id);
    const customId = interaction.customId;
    const is247Mode = is247Track(queue?.currentSong, queue);

    // Cấu hình tầng Autoplay qua Preset Buttons, nút Mở nhanh hoặc Quay lại
    if (customId === 'btn_open_autoplay_layers' || customId === 'btn_layer_yt_only' || customId === 'btn_layer_yt_ai' || customId === 'btn_layer_default' || customId === 'btn_settings_back') {
      if (!isStrictAdmin(interaction.member)) {
        return interaction.reply({
          embeds: [createErrorEmbed('Bạn không có quyền thực hiện thao tác này! Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên** mới có quyền cấu hình tầng Autoplay.')],
          flags: 64
        });
      }

      const guildId = interaction.guild.id;

      if (customId === 'btn_open_autoplay_layers') {
        const currentSettings = settingsManager.get(guildId);
        const layersEmbed = createAutoplayLayersEmbed(interaction.guild, currentSettings);
        const layersComponents = createAutoplayLayersComponents(currentSettings);
        return interaction.reply({ embeds: [layersEmbed], components: layersComponents, flags: 64 });
      }

      if (customId === 'btn_settings_back') {
        const currentSettings = settingsManager.get(guildId);
        const settingsEmbed = createSettingsEmbed(interaction.guild, currentSettings);
        const settingsMenu = createSettingsSelectMenu(currentSettings);
        return interaction.update({ embeds: [settingsEmbed], components: [settingsMenu] });
      }

      let newLayers = ['ytmix', 'ai', 'lastfm', 'heuristic'];
      if (customId === 'btn_layer_yt_only') {
        newLayers = ['ytmix'];
      } else if (customId === 'btn_layer_yt_ai') {
        newLayers = ['ytmix', 'ai'];
      } else if (customId === 'btn_layer_default') {
        newLayers = ['ytmix', 'ai', 'lastfm', 'heuristic'];
      }

      const updatedSettings = settingsManager.update(guildId, { autoplayLayers: newLayers });
      const newEmbed = createAutoplayLayersEmbed(interaction.guild, updatedSettings);
      const newComponents = createAutoplayLayersComponents(updatedSettings);

      return interaction.update({ embeds: [newEmbed], components: newComponents });
    }

    // Chuyển Tab trong Menu Trợ Giúp (Help Menu Tabs)
    if (customId.startsWith('help_tab_')) {
      if (customId === 'help_tab_close') {
        logAction('MESSAGE_DELETE', {
          type: 'HELP_TAB_CLOSE',
          channelId: interaction.channelId,
          messageId: interaction.message?.id
        });
        if (interaction.message?.deletable) {
          return interaction.message.delete().catch(() => {});
        }
        return interaction.deferUpdate().catch(() => {});
      }
      const tab = customId.replace('help_tab_', '');
      const isAdmin = isStrictAdmin(interaction.member);
      if (tab === 'admin' && !isAdmin) {
        return interaction.reply({
          embeds: [createErrorEmbed('Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên** mới có thể xem trang hướng dẫn Quản trị!')],
          flags: 64
        });
      }
      const helpCommand = client.commands.get('help');
      if (helpCommand && helpCommand.createHelpMenu) {
        const payload = helpCommand.createHelpMenu(tab, isAdmin);
        return interaction.update(payload);
      }
    }

    // Nút Mở Bảng Điều Khiển Âm Nhạc (Open Music Controls - Ephemeral chỉ người bấm thấy)
    if (customId === 'btn_open_controls') {
      try {
        if (!queue || (!queue.currentSong && !queue.isPlaying)) {
          logAction('INTERACTION_REPLY', {
            type: 'BTN_OPEN_CONTROLS_NO_SONG',
            interactionId: interaction.id,
            channelId: interaction.channelId
          });
          return await interaction.reply({ embeds: [createErrorEmbed('Hiện không có bài hát nào đang phát!')], flags: 64 });
        }

        const songForEmbed = queue.currentSong || {
          title: queue.mode247 ? 'Đài Phát Thanh Lofi 24/7' : 'Đang phát âm thanh',
          duration: '3:30',
          requestedBy: queue.mode247 ? 'Auto (24/7)' : 'User',
          is247: Boolean(queue.mode247)
        };
        const cardPayload = createNowPlayingCard(songForEmbed, queue);
        logAction('INTERACTION_REPLY', {
          type: 'BTN_OPEN_CONTROLS',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          song: (songForEmbed.title || '').slice(0, 60)
        });
        return await interaction.reply({ ...cardPayload, flags: 32768 | 64 });
      } catch (openControlsErr) {
        console.error('[BTN_OPEN_CONTROLS Error]:', openControlsErr);
        if (!interaction.replied && !interaction.deferred) {
          return await interaction.reply({ embeds: [createErrorEmbed(`Lỗi khi mở bảng điều khiển: ${openControlsErr.message}`)], flags: 64 }).catch(() => {});
        }
      }
    }

    // Nút Bảng cài đặt
    if (customId === 'btn_settings') {
      if (!isStrictAdmin(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))], flags: 64 });
      }

      const guildSettings = settingsManager.get(interaction.guild.id);
      const embed = createSettingsEmbed(interaction.guild, guildSettings);
      const row = createSettingsSelectMenu(guildSettings);
      return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }

    // Nút 🌐 Mở Web Player
    if (customId === 'btn_web_player') {
      const guildSettings = settingsManager.get(interaction.guild.id);
      const isEn = guildSettings?.language === 'en';

      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.reply({
          embeds: [createErrorEmbed(isEn ? 'You must be in a Voice channel to use Web Player!' : 'Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')],
          flags: 64
        });
      }

      const { isAllowedVoiceChannel } = require('./utils/permissionHelper');
      if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(interaction.member)) {
        return interaction.reply({
          embeds: [createErrorEmbed(isEn ? `Server voice channel is locked! Please join <#${guildSettings.lockedVoiceChannelId}> to use Web Player.` : `Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)],
          flags: 64
        });
      }

      const { generateWebToken } = require('./utils/tokenHelper');
      const { registerWebSession } = require('./utils/webSessionManager');
      const { getActiveTunnelUrl } = require('./utils/statusNotifier');
      const isAdmin = isStrictAdmin(interaction.member);
      const avatarUrl = interaction.user.displayAvatarURL({ dynamic: true, size: 256 });
      const userData = {
        userId: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        avatar: avatarUrl,
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        isAdmin: Boolean(isAdmin)
      };

      const { token, pin } = generateWebToken(userData, 2, 24);
      const tunnelUrl = getActiveTunnelUrl();
      const baseUrl = (config.webUrl || 'https://anna-music-bot-ui.pages.dev');
      const tunnelSig = tunnelUrl && config.webJwtSecret ? signTunnelUrl(tunnelUrl, config.webJwtSecret) : '';
      const tunnelParam = tunnelUrl ? `&tunnel=${encodeURIComponent(tunnelUrl)}${tunnelSig ? `&tsig=${tunnelSig}` : ''}` : '';
      const webUrl = `${baseUrl}/?token=${token}&guild=${interaction.guild.id}${tunnelParam}`;

      // Tạo Components V2 Container chuẩn đồng bộ với lệnh /web
      const webContainer = {
        type: 17,
        accent_color: 0x2B7FFF,
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: isEn ? `### Web Player Controller — Anna Music\nClick the button below to open music controller interface for **${interaction.guild.name}**.` : `### Bảng Điều Khiển Web Player — Anna Music\nNhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${interaction.guild.name}**.`
              }
            ],
            accessory: {
              type: 11,
              media: { url: client.user.displayAvatarURL() }
            }
          },
          {
            type: 10,
            content: isEn ? `🔊 **Voice Channel:** <#${memberVoice.id}>\n🔑 **Connection PIN:** \`${pin}\` *(valid for 2 minutes)*` : `🔊 **Kênh Voice:** <#${memberVoice.id}>\n🔑 **Mã PIN Kết Nối:** \`${pin}\` *(hiệu lực 2 phút)*`
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: isEn ? 'Open Web Player' : 'Mở Trình Phát Web Player',
                url: webUrl,
                emoji: CUSTOM_EMOJIS.web || { name: '🌐' }
              }
            ]
          },
          {
            type: 10,
            content: isEn ? '-# One-time PIN self-destructs after opening • Automatically expires in 2 minutes' : '-# Mã PIN dùng 1 lần sẽ tự hủy sau khi mở • Hết hạn tự động sau 2 phút'
          }
        ]
      };

      try {
        await interaction.reply({ components: [webContainer], flags: 32768 | 64 });

        registerWebSession({
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          interaction,
          pin,
          token,
          isEn,
          client
        });
      } catch (err) {
        console.error('[btn_web_player Error]:', err);
      }
      return;
    }

    // Nút Xem hàng chờ (Kèm cụm nút chuyển trang và dropdown xóa bài theo trang)
    if (customId === 'btn_queue') {
      if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
        return interaction.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')], flags: 64 });
      }
      const queueContainer = createQueueContainer(queue, 1);
      return interaction.reply({ components: [queueContainer], flags: 32768 | 64 });
    }

    // Nút Chuyển trang Hàng chờ (queue_page_<page>)
    if (customId.startsWith('queue_page_')) {
      if (!queue) {
        return interaction.reply({ embeds: [createErrorEmbed('Không tìm thấy phiên phát nhạc đang hoạt động!')], flags: 64 });
      }
      const targetPage = parseInt(customId.replace('queue_page_', ''), 10) || 1;
      const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');
      const totalPages = Math.max(1, Math.ceil(userSongs.length / 10));
      const page = Math.min(Math.max(1, targetPage), totalPages);

      const queueContainer = createQueueContainer(queue, page);
      return interaction.update({ components: [queueContainer] });
    }

    // Nút mở Modal Xóa theo số thứ tự
    if (customId === 'queue_delete_modal') {
      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để xóa bài.`)], flags: 64 });
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_queue_delete_index')
        .setTitle('🗑️ Xóa bài theo số thứ tự');

      const input = new TextInputBuilder()
        .setCustomId('queue_song_position')
        .setLabel('Số thứ tự bài cần xóa')
        .setPlaceholder(`VD: 25 (Hàng chờ hiện có ${queue?.getUserSongs ? queue.getUserSongs().length : (queue?.songs?.length || 0)} bài)`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // Nút Yêu thích (Lưu bài hát đang phát vào MongoDB Atlas)
    if (customId === 'btn_favorite') {
      if (!queue || !queue.currentSong || queue.isPreparing || queue.isStopped) {
        return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Track is preparing or hasn\'t started yet, please wait a moment!' : 'Bài hát đang chuẩn bị phát hoặc chưa bắt đầu, vui lòng đợi giây lát!')], flags: 64 });
      }

      if (queue.currentSong?.is247 || queue.currentSong?.requestedBy === 'Auto (24/7)' || queue.currentSong?.requestedBy === 'Auto (24/7 Lofi)') {
        return interaction.reply({
          embeds: [createErrorEmbed('❌ Không thể thêm nhạc nền chế độ 24/7 Lofi vào danh sách yêu thích! Hãy order một bài hát để thả tim nhé.')],
          flags: 64
        });
      }

      try {
        const result = await favoriteManager.toggleFavorite(interaction.user.id, queue.currentSong);
        if (result.isAdded) {
          return interaction.reply({
            embeds: [createSuccessEmbed(`❤️ Đã thêm [**${formatMarkdownTitle(queue.currentSong.title, 60)}**](${queue.currentSong.url}) vào danh sách **Bài Hát Yêu Thích**\nTổng cộng: **${result.total} bài** • Dùng \`/like list\` (hoặc \`/fav list\`) để xem danh sách`)],
            flags: 64
          });
        } else {
          return interaction.reply({
            embeds: [createSuccessEmbed(`💔 Đã xóa [**${formatMarkdownTitle(queue.currentSong.title, 60)}**](${queue.currentSong.url}) khỏi danh sách **Bài Hát Yêu Thích** của bạn.\nCòn lại: **${result.total} bài**`)],
            flags: 64
          });
        }
      } catch (err) {
        console.error('[Favorite Button Error]:', err);
        return interaction.reply({ embeds: [createErrorEmbed(`Lỗi khi lưu bài yêu thích: ${err.message}`)], flags: 64 });
      }
    }

    // Nút Thích bài hát (Like)
    if (customId === 'btn_like') {
      if (!queue || !queue.currentSong || queue.isPreparing || queue.isStopped) {
        return interaction.reply({ embeds: [createErrorEmbed('Bài hát đang chuẩn bị phát hoặc chưa bắt đầu, vui lòng đợi giây lát!')], flags: 64 });
      }

      if (queue.currentSong?.is247 || queue.currentSong?.requestedBy === 'Auto (24/7)' || queue.currentSong?.requestedBy === 'Auto (24/7 Lofi)') {
        return interaction.reply({
          embeds: [createErrorEmbed('❌ Không thể Like nhạc nền chế độ 24/7 Lofi!')],
          flags: 64
        });
      }

      try {
        const userFavs = await favoriteManager.getFavorites(interaction.user.id);
        const alreadyFav = userFavs.some(f => f.url === queue.currentSong.url || (f.title && f.title === queue.currentSong.title));
        if (alreadyFav) {
          return interaction.reply({
            embeds: [createSuccessEmbed(`👍 Bạn đã thích bài hát này rồi: [**${formatMarkdownTitle(queue.currentSong.title, 55)}**](${queue.currentSong.url || 'https://discord.com'})`)],
            flags: 64
          });
        }
        await favoriteManager.toggleFavorite(interaction.user.id, queue.currentSong);
        return interaction.reply({
          embeds: [createSuccessEmbed(`👍 Đã thích bài hát [**${formatMarkdownTitle(queue.currentSong.title, 55)}**](${queue.currentSong.url || 'https://discord.com'}) và lưu vào danh sách yêu thích của bạn!`)],
          flags: 64
        });
      } catch (err) {
        console.error('[Like Button Error]:', err);
        return interaction.reply({ embeds: [createErrorEmbed(`Lỗi khi thích bài hát: ${err.message}`)], flags: 64 });
      }
    }

    // Nút Playlist (Xem và Quản lý Playlist cá nhân)
    if (customId === 'btn_playlist') {
      try {
        const userPlaylists = await userPlaylistManager.getUserPlaylists(interaction.user.id);
        const { generateWebToken } = require('./utils/tokenHelper');
        const { getActiveTunnelUrl } = require('./utils/statusNotifier');
        const isAdmin = isStrictAdmin(interaction.member);
        const userData = {
          userId: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          avatar: interaction.user.displayAvatarURL({ dynamic: true, size: 256 }),
          guildId: interaction.guild.id,
          guildName: interaction.guild.name,
          isAdmin: Boolean(isAdmin)
        };
        const { token, pin } = generateWebToken(userData, 3, 24);
        const tunnelUrl = getActiveTunnelUrl();
        const baseUrl = config.webUrl || 'https://anna-music-bot-ui.pages.dev';
        const tunnelSig = tunnelUrl && config.webJwtSecret ? signTunnelUrl(tunnelUrl, config.webJwtSecret) : '';
        const tunnelParam = tunnelUrl ? `&tunnel=${encodeURIComponent(tunnelUrl)}${tunnelSig ? `&tsig=${tunnelSig}` : ''}` : '';
        const playlistWebUrl = `${baseUrl}/?tab=playlists&token=${token}&guild=${interaction.guild.id}${tunnelParam}`;

        const lines = [
          `${EMOJI_TAG.playlist} **Danh sách Playlist của bạn:** (${userPlaylists.length} playlist)\n`
        ];
        if (userPlaylists.length === 0) {
          lines.push('*Bạn chưa tạo danh sách phát nào.*');
          lines.push('Nhấn nút **Quản Lý Playlist** bên dưới để tạo và thêm bài hát trên Web Panel nhé!');
        } else {
          userPlaylists.slice(0, 5).forEach((p, i) => {
            const count = (p.songs || p.tracks || []).length;
            lines.push(`**${i + 1}.** 📁 **${p.name}** — \`${count} bài\``);
          });
          if (userPlaylists.length > 5) {
            lines.push(`*... và ${userPlaylists.length - 5} playlist khác.*`);
          }
          lines.push('\nQuản lý chi tiết, thêm/xóa bài qua Web Panel bên dưới!');
        }
        const desc = lines.join('\n');

        const embed = new EmbedBuilder()
          .setColor('#2B2D31')
          .setTitle(`${EMOJI_TAG.musicNotesDouble} Quản Lý Playlist Cá Nhân`)
          .setDescription(desc)
          .setFooter({ text: `Mã PIN: ${pin} (Hiệu lực trong 5 phút)` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Mở Quản Lý Playlist (Web)')
            .setStyle(ButtonStyle.Link)
            .setURL(playlistWebUrl)
            .setEmoji(CUSTOM_EMOJIS.playlist)
        );

        return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
      } catch (plErr) {
        console.error('[Playlist Button Error]:', plErr);
        return interaction.reply({ embeds: [createErrorEmbed(`Lỗi khi tải playlist: ${plErr.message}`)], flags: 64 });
      }
    }

    // Nút Phát tất cả bài yêu thích từ Embed /favorite play
    if (customId.startsWith('btn_play_user_fav_')) {
      const targetUserId = customId.replace('btn_play_user_fav_', '');
      if (interaction.user.id !== targetUserId) {
        return interaction.reply({ embeds: [createErrorEmbed('Bạn chỉ có thể phát danh sách yêu thích của chính mình!')], flags: 64 });
      }

      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.reply({ embeds: [createErrorEmbed('Bạn cần ở trong một kênh Voice để phát nhạc!')], flags: 64 });
      }

      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.dj_only', { role: roleText }))], flags: 64 });
      }

      if (!isAllowedVoiceChannel(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        return interaction.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`)], flags: 64 });
      }

      const favorites = await favoriteManager.getFavorites(targetUserId);

      if (!favorites || favorites.length === 0) {
        return interaction.reply({ embeds: [createErrorEmbed('Danh sách yêu thích của bạn hiện đang trống!')], flags: 64 });
      }

      logAction('INTERACTION_DEFER_REPLY', {
        type: 'BTN_PLAY_FAV',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        flags: 64
      });
      await interaction.deferReply({ flags: 64 });
      const q = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
      await q.connect();
      await q.addSongs(favorites, interaction.user);

      logAction('INTERACTION_EDIT_REPLY', {
        type: 'BTN_PLAY_FAV_DONE',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        count: favorites.length
      });
      return interaction.editReply({
        embeds: [createSuccessEmbed(`❤️ Đã nạp thành công **${favorites.length} bài hát yêu thích** vào hàng chờ!`)]
      });
    }

    // Nút ➕ Thêm bài hát (Hiện Popup Modal nhập tên / link / playlist)
    if (customId === 'btn_add_song') {
      const guildSettings = settingsManager.get(interaction.guild.id);
      if (!hasMusicPermission(interaction.member)) {
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để thêm bài.`)], flags: 64 });
      }

      if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`)], flags: 64 });
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_add_song')
        .setTitle(t(interaction.guildId, 'modal.add_song_title'));

      const songInput = new TextInputBuilder()
        .setCustomId('song_query')
        .setLabel(t(interaction.guildId, 'modal.add_song_query_label').slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(t(interaction.guildId, 'modal.add_song_placeholder').slice(0, 100))
        .setRequired(true);

      const modalRow = new ActionRowBuilder().addComponents(songInput);
      modal.addComponents(modalRow);

      try {
        logAction('INTERACTION_SHOW_MODAL', {
          type: 'BTN_ADD_SONG',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          userId: interaction.user.id
        });
        return await interaction.showModal(modal);
      } catch (modalErr) {
        console.error('[BTN_ADD_SONG showModal Error]:', modalErr);
        if (!interaction.replied && !interaction.deferred) {
          return await interaction.reply({ embeds: [createErrorEmbed(`Không thể mở bảng thêm bài hát: ${modalErr.message}`)], flags: 64 }).catch(() => {});
        }
      }
    }

    // Kiểm tra quyền DJ khi bấm các nút điều khiển khác
    if (!hasMusicPermission(interaction.member)) {
      const guildSettings = settingsManager.get(interaction.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return interaction.reply({ embeds: [createErrorEmbed(t(interaction.guildId, 'common.dj_only', { role: roleText }))], flags: 64 });
    }

    if (!queue || !queue.voiceChannel || !queue.connection) {
      return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'Bot is not in any Voice channel! Use `/join` or `/play <song>` first.' : 'Bot hiện chưa tham gia phòng Voice nào! Vui lòng dùng lệnh `/join` hoặc `/play <tên_bài>` để mời bot vào phòng trước.')], flags: 64 });
    }

    const memberVoice = interaction.member?.voice?.channel;
    if (queue.voiceChannel && memberVoice?.id !== queue.voiceChannel.id) {
      return interaction.reply({ embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'You need to be in the same Voice channel as the bot to control music!' : 'Bạn cần ở cùng phòng Voice với bot để điều khiển!')], flags: 64 });
    }

    // 1. Nút 🔊 Chỉnh âm lượng (Mở Popup Modal nhập % âm lượng trực tiếp, phải gọi trước deferUpdate)
    if (customId === 'btn_volume') {
      const isEnVol = settingsManager.get(interaction.guildId)?.language === 'en';
      const modal = new ModalBuilder()
        .setCustomId('modal_set_volume')
        .setTitle(isEnVol ? '🔊 Adjust Volume (1 - 100%)' : '🔊 Điều Chỉnh Âm Lượng (1 - 100%)');

      const volInput = new TextInputBuilder()
        .setCustomId('volume_level_input')
        .setLabel(isEnVol ? 'Desired volume level (%)' : 'Nhập mức âm lượng mong muốn (%)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(isEnVol ? `Current volume: ${queue.volume || 80}% (1-100)` : `Âm lượng hiện tại: ${queue.volume || 80}% (Nhập số từ 1 đến 100)`)
        .setValue(String(queue.volume || 80))
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(volInput));
      return interaction.showModal(modal);
    }

    // 2. Nút 🎤 Xem lời bài hát trực tiếp trên Player Card (Ephemeral)
    if (customId === 'btn_lyrics') {
      if (!queue.currentSong || queue.isPreparing || queue.isStopped) {
        return interaction.reply({
          embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? 'No song is currently playing to fetch lyrics!' : 'Hiện chưa có bài hát nào đang phát để tra cứu lời!')],
          flags: 64
        });
      }

      await interaction.deferReply({ flags: 64 });
      try {
        const { fetchLyrics } = require('./utils/lyricsHelper');
        const { parseDurationToMs } = require('./utils/embed');
        const song = queue.currentSong;
        let artist = song.author || song.artist || '';
        if (['YouTube Music', 'YouTube', 'Unknown'].includes(artist)) artist = '';
        const durMs = song.durationMs || (song.duration ? parseDurationToMs(song.duration) : 0);

        const result = await fetchLyrics(song.title, artist, durMs, song.url);
        if (!result || !result.lyrics || !result.lyrics.trim()) {
          return interaction.editReply({
            embeds: [createErrorEmbed(t(interaction.guildId, 'commands.lyrics_not_found', { title: song.title }))]
          });
        }

        let lyricsText = result.lyrics.trim();
        if (lyricsText.length > 3900) {
          lyricsText = lyricsText.slice(0, 3900) + (settingsManager.get(interaction.guildId)?.language === 'en' ? '\n\n*... (Lyrics truncated)*' : '\n\n*... (Lời bài hát đã được rút gọn)*');
        }

        const lyricsEmbed = createEmbed(
          `${EMOJI_TAG.lyrics} ${result.title || song.title} — ${result.artist || artist || 'Lyrics'}`,
          lyricsText
        );
        return interaction.editReply({ embeds: [lyricsEmbed] });
      } catch (lyErr) {
        return interaction.editReply({
          embeds: [createErrorEmbed(settingsManager.get(interaction.guildId)?.language === 'en' ? `Error loading lyrics: ${lyErr.message}` : `Lỗi khi tải lời bài hát: ${lyErr.message}`)]
        });
      }
    }

    // 3. Khóa các nút điều khiển luồng phát khi bot chưa sẵn sàng hoặc bài hát đang chuẩn bị
    const playbackButtons = [
      'btn_rewind',
      'btn_previous',
      'btn_pause',
      'btn_skip',
      'btn_forward',
      'btn_loop',
      'btn_shuffle',
      'btn_stop',
      'btn_autoplay',
      'btn_dislike'
    ];
    if (playbackButtons.includes(customId)) {
      if (customId !== 'btn_autoplay' && (!queue.currentSong || queue.isPreparing || queue.isStopped)) {
        return interaction.reply({
          embeds: [createErrorEmbed('Bài hát đang chuẩn bị phát hoặc chưa bắt đầu, vui lòng đợi giây lát!')],
          flags: 64
        });
      }

      // Khóa thao tác cấp độ Guild: ngăn nhiều người bấm hoặc 1 người bấm liên hoàn khi thao tác trước chưa xong
      if (queue._isProcessingAction) {
        return interaction.reply({
          content: (settingsManager.get(interaction.guildId)?.language === 'en' ? '⏳ Action is being processed, please wait a moment!' : '⏳ Hệ thống đang xử lý thao tác trước đó, vui lòng đợi giây lát!'),
          flags: 64
        }).catch(() => {});
      }

      // Cooldown chung cấp độ Guild 1500ms cho toàn bộ luồng điều khiển nhạc
      const guildActionKey = `${interaction.guild.id}_playback_action`;
      const lastClickTime = buttonCooldownMap.get(guildActionKey) || 0;
      if (Date.now() - lastClickTime < 1500) {
        return interaction.reply({
          content: (settingsManager.get(interaction.guildId)?.language === 'en' ? '⏳ Action is being processed, please wait a moment!' : '⏳ Hệ thống đang xử lý thao tác trước đó, vui lòng đợi giây lát!'),
          flags: 64
        }).catch(() => {});
      }
      buttonCooldownMap.set(guildActionKey, Date.now());
    }

    // 4. Chặn người dùng điều khiển nhạc Radio Lofi 24/7 tự động qua các nút bấm Discord
    const blockedIn247 = [
      'btn_favorite',
      'btn_dislike',
      'btn_rewind',
      'btn_previous',
      'btn_pause',
      'btn_skip',
      'btn_forward',
      'btn_loop',
      'btn_shuffle'
    ];
    if (is247Mode && blockedIn247.includes(customId)) {
      return interaction.reply({
        embeds: [createErrorEmbed(t(interaction.guildId, 'player.radio_cannot_control'))],
        flags: 64
      });
    }

    // 5. Kiểm tra phân quyền khi bấm Dừng (btn_stop)
    if (customId === 'btn_stop') {
      const isAdmin = Boolean(isStrictAdmin(interaction.member) || interaction.guild?.ownerId === interaction.user?.id);
      if (is247Mode) {
        if (!isAdmin) {
          return interaction.reply({
            embeds: [createErrorEmbed(t(interaction.guildId, 'common.admin_only_247'))],
            flags: 64
          });
        }
      } else {
        if (!hasMusicPermission(interaction.member)) {
          return interaction.reply({
            embeds: [createErrorEmbed(t(interaction.guildId, 'common.no_permission'))],
            flags: 64
          });
        }
      }
    }

    // 6. Thực thi hành động điều khiển âm thanh với Optimistic UI
    if (playbackButtons.includes(customId)) {
      queue._isProcessingAction = true;
      try {
        let skipResult = null;
        if (customId === 'btn_skip') {
          skipResult = queue.checkOrCastSkipVote(interaction.member);
          if (skipResult.status === 'skipped') {
            if (skipResult.reason === 'vote_passed') {
              queue.textChannel?.send(t(interaction.guildId, 'skip.vote_passed', {
                title: skipResult.title,
                current: skipResult.current,
                required: skipResult.required
              })).catch(() => {});
            }
          } else if (skipResult.status === 'vote_progress') {
            queue.textChannel?.send(t(interaction.guildId, 'skip.vote_progress', {
              user: skipResult.user,
              current: skipResult.current,
              required: skipResult.required,
              needed: skipResult.needed
            })).catch(() => {});
          } else if (skipResult.status === 'vote_retracted') {
            queue.textChannel?.send(t(interaction.guildId, 'skip.vote_retracted', {
              user: skipResult.user,
              current: skipResult.current,
              required: skipResult.required
            })).catch(() => {});
          }
        }

        const isOptimistic = ((customId === 'btn_skip' && skipResult?.status === 'skipped') || customId === 'btn_previous' || customId === 'btn_stop');
        if (isOptimistic) {
          queue._pendingButtonAction = customId === 'btn_skip' ? 'skip' : (customId === 'btn_previous' ? 'previous' : 'stop');
          queue._pendingButtonActionTime = Date.now();
          setTimeout(() => {
            if (queue && queue._pendingButtonAction) {
              queue._pendingButtonAction = null;
            }
          }, 2500);
          const songForEmbed = queue.currentSong || (is247Mode ? { requestedBy: 'Auto (24/7)', title: t(interaction.guildId, 'player.radio_card_title'), is247: true } : null);
          if (songForEmbed) {
            const isV2Message = interaction.message?.components?.[0]?.type === 17 || interaction.message?.flags?.has?.(32768);
            if (isV2Message) {
              await interaction.update(createNowPlayingCard(songForEmbed, queue)).catch(() => {});
            } else {
              await interaction.update({ embeds: [createNowPlayingEmbed(songForEmbed, queue)], components: createMusicControls(queue) }).catch(() => {});
            }
          } else {
            await interaction.deferUpdate().catch(() => {});
          }
        } else {
          logAction('INTERACTION_DEFER_UPDATE', {
            customId,
            interactionId: interaction.id,
            channelId: interaction.channelId,
            guildId: interaction.guild.id
          });
          await interaction.deferUpdate().catch(() => {});
        }

        if (customId === 'btn_pause') {
          queue.togglePause();
        } else if (customId === 'btn_skip') {
          if (is247Mode) queue._is247Skipping = true;
          // Note: queue.skip() was already executed in checkOrCastSkipVote if conditions passed
        } else if (customId === 'btn_previous') {
          await queue.playPrevious();
        } else if (customId === 'btn_rewind') {
          const currentSec = Math.floor(
            ((queue.currentSong?.seekPosition || 0) * 1000 + (queue.currentResource?.playbackDuration || 0)) / 1000
          );
          const targetSec = Math.max(0, currentSec - 10);
          await queue.seek(targetSec);
        } else if (customId === 'btn_forward') {
          const { parseDurationToMs } = require('./utils/embed');
          const currentSec = Math.floor(
            ((queue.currentSong?.seekPosition || 0) * 1000 + (queue.currentResource?.playbackDuration || 0)) / 1000
          );
          const totalSec = Math.floor(
            (queue.currentSong?.durationMs || parseDurationToMs(queue.currentSong?.duration)) / 1000
          );
          const targetSec = totalSec > 5 ? Math.min(totalSec - 2, currentSec + 10) : currentSec + 10;
          await queue.seek(targetSec);
        } else if (customId === 'btn_loop') {
          queue.toggleLoop();
        } else if (customId === 'btn_shuffle') {
          if (queue.songs.length >= 2) {
            queue.shuffle();
          }
        } else if (customId === 'btn_autoplay') {
          const currentSettings = settingsManager.get(interaction.guild.id);
          const newAutoplay = !currentSettings.autoplay;
          settingsManager.update(interaction.guild.id, { autoplay: newAutoplay });
        } else if (customId === 'btn_dislike') {
          if (queue.currentSong?.url) {
            await favoriteManager.removeFavorite(interaction.user.id, queue.currentSong.url).catch(() => {});
          }
          queue.skip();
        } else if (customId === 'btn_stop') {
          queue.stop();
        }

        // Cập nhật lại giao diện NowPlaying message
        const songForEmbed = queue.currentSong || (is247Mode ? { requestedBy: 'Auto (24/7)', title: t(interaction.guildId, 'player.radio_card_title'), is247: true } : null);
        if (songForEmbed) {
          const isV2Message = interaction.message?.components?.[0]?.type === 17 || interaction.message?.flags?.has?.(32768);
          if (isV2Message) {
            const cardPayload = createNowPlayingCard(songForEmbed, queue);
            await interaction.editReply(cardPayload).catch(() => {});
          } else {
            const embed = createNowPlayingEmbed(songForEmbed, queue);
            const controls = createMusicControls(queue);
            await interaction.editReply({ embeds: [embed], components: controls }).catch(() => {});
          }

          if (queue.nowPlayingMessage && queue.nowPlayingMessage.id !== interaction.message?.id) {
            const isQueueMsgV2 = queue.nowPlayingMessage.components?.[0]?.type === 17 || queue.nowPlayingMessage.flags?.has?.(32768);
            if (isQueueMsgV2) {
              const cardPayload = createNowPlayingCard(songForEmbed, queue);
              await queue.nowPlayingMessage.edit(cardPayload).catch(() => {});
            } else {
              const embed = createNowPlayingEmbed(songForEmbed, queue);
              const controls = createMusicControls(queue);
              await queue.nowPlayingMessage.edit({ embeds: [embed], components: controls }).catch(() => {});
            }
          }
        }
      } catch (error) {
        console.error('Lỗi khi xử lý nút bấm:', error);
      } finally {
        queue._isProcessingAction = false;
      }
    }
  }
  } catch (globalInteractionErr) {
    console.error('[Global Interaction Error]:', globalInteractionErr);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ embeds: [createErrorEmbed(`Lỗi tương tác: ${globalInteractionErr.message}`)], flags: 64 });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ embeds: [createErrorEmbed(`Lỗi tương tác: ${globalInteractionErr.message}`)] });
      }
    } catch (e) {}
  }
});

// Xử lý lỗi an toàn
client.on('error', (err) => {
  console.error('[Discord Client Error]', err);
  logAction('CLIENT_ERROR', {
    guildId: '1389834422773219338',
    error: err.message || String(err)
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
  const errMsg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  if (errMsg.includes('EPIPE') || errMsg.includes('ECONNRESET')) return;
  logAction('SYSTEM_ERROR', {
    guildId: '1389834422773219338',
    error: errMsg.slice(0, 500)
  });
});

process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
    return; // Bỏ qua lỗi socket pipe đóng sớm bình thường
  }
  console.error('[Uncaught Exception]', err);
  logAction('SYSTEM_ERROR', {
    guildId: '1389834422773219338',
    error: (err.stack || err.message || String(err)).slice(0, 500)
  });
});

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Process ${signal}] Đang lưu trạng thái phiên phát nhạc và dừng hệ thống an toàn...`);
  try {
    const savePromises = [];
    for (const queue of musicManager.queues.values()) {
      if (typeof queue._saveSessionState === 'function') {
        savePromises.push(queue._saveSessionState());
      }
    }
    await Promise.allSettled(savePromises);
    await sessionManager.flushAll();
  } catch (err) {
    console.warn('[Graceful Shutdown Session Save Warning]:', err.message);
  }
  try {
    const { notifyBotShutdown } = require('./utils/statusNotifier');
    await notifyBotShutdown(client, null, signal);
  } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 5. Khởi tạo mã hóa Voice và Đăng nhập Bot
const sodium = require('libsodium-wrappers');

(async () => {
  try {
    await sodium.ready;
    console.log('🔒 [Voice Encryption] Thư viện mã hóa âm thanh libsodium đã sẵn sàng!');
  } catch (e) {
    console.warn('[Voice Encryption Warning]:', e.message);
  }

  if (!config.token || config.token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('[Error] Vui lòng cung cấp DISCORD_TOKEN hợp lệ trong file .env');
  } else {
    client.login(config.token);
  }
})();
