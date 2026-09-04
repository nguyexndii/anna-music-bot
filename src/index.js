const {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const musicManager = require('./structures/MusicManager');
const settingsManager = require('./structures/SettingsManager');
const favoriteManager = require('./structures/FavoriteManager');
const { connectDatabase } = require('./database/mongoose');
const { searchTrack } = require('./utils/musicExtractor');
const {
  createNowPlayingEmbed,
  createMusicControls,
  createSettingsEmbed,
  createSettingsSelectMenu,
  createQueueEmbed,
  createQueueDeleteSelectMenu,
  createSuccessEmbed,
  createErrorEmbed,
  createEmbed,
  setVoiceChannelStatus,
  clearVoiceChannelStatus
} = require('./utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('./utils/permissionHelper');
const { initLogger, logAction } = require('./utils/debugLogger');

// 1. Khởi tạo Discord Client (Tắt triệt để ping/tít tít thông báo với allowedMentions)
const client = new Client({
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

initLogger(client);

client.commands = new Collection();
client.aliases = new Collection();

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
app.use(express.json());
app.use('/api', createApiRouter(client));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime(), botStatus: client.user ? 'ONLINE' : 'OFFLINE' });
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

  // Đăng ký Slash Commands tự động lên Discord REST API
  try {
    const { deploySlashCommands } = require('./deploy-commands');
    await deploySlashCommands(client);
  } catch (deployErr) {
    console.warn('[Auto-Deploy Slash Commands Error]:', deployErr.message);
  }

  // 🔄 Tự động khôi phục kết nối các phòng Voice 24/7 khi bot khởi động lại / sau khi mất kết nối
  try {
    await sessionManager.syncFromDatabase();
    const activeSessions = sessionManager.getAllActive247Sessions();
    for (const session of activeSessions) {
      try {
        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) continue;
        const voiceChannel = guild.channels.cache.get(session.voiceChannelId);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) continue;
        const textChannel = session.textChannelId ? guild.channels.cache.get(session.textChannelId) : null;

        console.log(`[24/7 Auto-Recovery] Đang tự động kết nối lại phòng: ${voiceChannel.name} tại máy chủ ${guild.name}...`);
        const q = musicManager.getOrCreate(guild, textChannel, voiceChannel);
        await q.connect();
        logAction('VOICE_STATUS_UPDATE', {
          source: 'index.js/24x7-recovery',
          channelId: voiceChannel.id,
          status: '24/7 Mode'
        });
        setVoiceChannelStatus(voiceChannel, '♾️ 24/7 Mode');
        await q._play247BackgroundLofi();
      } catch (recErr) {
        console.warn(`[24/7 Recovery Error for Guild ${session.guildId}]:`, recErr.message);
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
      queue.destroy();
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

// Xử lý Tương tác (Slash Commands, Nút bấm, Menu Dropdown, Modal thêm bài hát)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;

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
          content: `⚠️ Bot chỉ nhận lệnh trong kênh <#${guildSettings.musicChannelId}>!`,
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
      const errMsg = `Đã xảy ra lỗi khi thực thi lệnh: ${err.message}`;
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
      const query = interaction.fields.getTextInputValue('song_query')?.trim();
      if (!query) {
        logAction('INTERACTION_REPLY', {
          type: 'MODAL_NO_QUERY',
          interactionId: interaction.id,
          channelId: interaction.channelId,
          flags: 64
        });
        return interaction.reply({ embeds: [createErrorEmbed('Vui lòng nhập tên bài hát hoặc đường dẫn hợp lệ!')], flags: 64 });
      }

      logAction('INTERACTION_DEFER_REPLY', {
        type: 'MODAL_ADD_SONG',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        flags: 64
      });
      await interaction.deferReply({ flags: 64 });

      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        logAction('INTERACTION_EDIT_REPLY', {
          type: 'MODAL_NO_VOICE',
          interactionId: interaction.id,
          channelId: interaction.channelId
        });
        return interaction.editReply({ embeds: [createErrorEmbed('Bạn cần ở trong một kênh Voice để thêm bài hát!')] });
      }

      try {
        const tracks = await searchTrack(query);
        if (!tracks || tracks.length === 0) {
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_NO_RESULT',
            interactionId: interaction.id,
            channelId: interaction.channelId
          });
          return interaction.editReply({ embeds: [createErrorEmbed('Không tìm thấy bài hát hoặc Playlist phù hợp với từ khóa này!')] });
        }

        const queue = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
        await queue.connect();

        if (tracks.length === 1) {
          const track = tracks[0];
          await queue.addSong(track, interaction.user);
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_ADDED_SINGLE',
            interactionId: interaction.id,
            channelId: interaction.channelId,
            content: track.title.slice(0, 60)
          });
          return interaction.editReply({
            embeds: [createSuccessEmbed(`Đã thêm bài hát vào hàng chờ: [**${track.title}**](${track.url})`)]
          });
        } else {
          await queue.addSongs(tracks, interaction.user);
          logAction('INTERACTION_EDIT_REPLY', {
            type: 'MODAL_ADDED_PLAYLIST',
            interactionId: interaction.id,
            channelId: interaction.channelId,
            count: tracks.length
          });
          return interaction.editReply({
            embeds: [createSuccessEmbed(`Đã thêm thành công **${tracks.length} bài hát** từ Playlist vào hàng chờ!`)]
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
        return interaction.editReply({ embeds: [createErrorEmbed(`Lỗi khi thêm bài hát: ${err.message}`)] });
      }
    }
  }

  // 2. Xử lý Menu Dropdown (Cài đặt & Xóa bài khỏi Hàng chờ)
  if (interaction.isStringSelectMenu()) {
    // Xóa bài hát khỏi Hàng chờ
    if (interaction.customId === 'menu_queue_remove') {
      const queue = musicManager.get(interaction.guild.id);
      if (!queue) {
        return interaction.reply({ embeds: [createErrorEmbed('Không tìm thấy phiên phát nhạc đang hoạt động!')], flags: 64 });
      }

      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để xóa bài.`)], flags: 64 });
      }

      if (interaction.values[0] === 'remove_all') {
        queue.songs = [];
        const newEmbed = createQueueEmbed(queue);
        return interaction.update({ embeds: [newEmbed], components: [] });
      }

      const idx = parseInt(interaction.values[0].replace('remove_', ''), 10);
      if (!isNaN(idx) && idx >= 0 && idx < queue.songs.length) {
        const removed = queue.songs.splice(idx, 1)[0];
        const newEmbed = createQueueEmbed(queue);
        const newMenu = createQueueDeleteSelectMenu(queue);
        return interaction.update({ embeds: [newEmbed], components: newMenu ? [newMenu] : [] });
      }
    }

    // Bảng Cài đặt
    if (interaction.customId === 'menu_settings') {
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasAdminPerm = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');

      if (!isOwner && !hasAdminPerm) {
        return interaction.reply({ embeds: [createErrorEmbed('Bạn cần quyền `Quản Trị Viên` hoặc `Quản Lý Máy Chủ` để thay đổi cài đặt!')], flags: 64 });
      }

      const selectedValue = interaction.values[0];
      const guildId = interaction.guild.id;
      const currentSettings = settingsManager.get(guildId);
      const queue = musicManager.get(guildId);

      let updatedSettings = {};

      if (selectedValue === 'set_language') {
        const newLang = currentSettings.language === 'en' ? 'vi' : 'en';
        updatedSettings = settingsManager.update(guildId, { language: newLang });
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
  }

  // 3. Xử lý Nút bấm điều khiển nhạc
  if (interaction.isButton()) {
    const queue = musicManager.get(interaction.guild.id);
    const customId = interaction.customId;

    // Chuyển Tab trong Menu Trợ Giúp (Help Menu Tabs)
    if (customId.startsWith('help_tab_')) {
      if (customId === 'help_tab_close') {
        logAction('MESSAGE_DELETE', {
          type: 'HELP_TAB_CLOSE',
          channelId: interaction.channelId,
          messageId: interaction.message?.id
        });
        return interaction.message.delete().catch(() => {});
      }
      const tab = customId.replace('help_tab_', '');
      const isOwner = interaction.guild?.ownerId === interaction.user.id;
      const hasAdminPerm = interaction.member?.permissions?.has('Administrator') || interaction.member?.permissions?.has('ManageGuild');
      const isAdmin = Boolean(isOwner || hasAdminPerm);
      const helpCommand = client.commands.get('help');
      if (helpCommand && helpCommand.createHelpMenu) {
        const payload = helpCommand.createHelpMenu(tab, isAdmin);
        return interaction.update(payload);
      }
    }

    // Nút Mở Bảng Điều Khiển Âm Nhạc (Open Music Controls)
    if (customId === 'btn_open_controls') {
      if (!queue || !queue.currentSong) {
        logAction('INTERACTION_REPLY', {
          type: 'BTN_OPEN_CONTROLS_NO_SONG',
          interactionId: interaction.id,
          channelId: interaction.channelId
        });
        return interaction.reply({ embeds: [createErrorEmbed('Hiện không có bài hát nào đang phát!')] });
      }

      const embed = createNowPlayingEmbed(queue.currentSong, queue);
      const controls = createMusicControls(queue);
      logAction('INTERACTION_REPLY', {
        type: 'BTN_OPEN_CONTROLS',
        interactionId: interaction.id,
        channelId: interaction.channelId,
        song: (queue.currentSong.title || '').slice(0, 60)
      });
      const replyMsg = await interaction.reply({ embeds: [embed], components: controls, withResponse: true });
      queue.nowPlayingMessage = replyMsg?.resource?.message || replyMsg;
      return;
    }

    // Nút Bảng cài đặt
    if (customId === 'btn_settings') {
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasAdminPerm = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
      if (!isOwner && !hasAdminPerm) {
        return interaction.reply({ embeds: [createErrorEmbed('Chỉ Quản Trị Viên (Administrator) hoặc Quản Lý Máy Chủ mới được mở bảng cài đặt!')], flags: 64 });
      }

      const guildSettings = settingsManager.get(interaction.guild.id);
      const embed = createSettingsEmbed(interaction.guild, guildSettings);
      const row = createSettingsSelectMenu(guildSettings);
      return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }

    // Nút 🌐 Mở Web Player
    if (customId === 'btn_web_player') {
      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.reply({
          embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice để mở Web Player!')],
          flags: 64
        });
      }

      const { isAllowedVoiceChannel } = require('./utils/permissionHelper');
      const settingsManager = require('./structures/SettingsManager');
      const guildSettings = settingsManager.get(interaction.guild.id);
      if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(interaction.member)) {
        return interaction.reply({
          embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)],
          flags: 64
        });
      }

      const { generateWebToken } = require('./utils/tokenHelper');
      const avatarUrl = interaction.user.displayAvatarURL({ dynamic: true, size: 256 });
      const userData = {
        userId: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        avatar: avatarUrl,
        guildId: interaction.guild.id,
        guildName: interaction.guild.name
      };

      const { token, pin } = generateWebToken(userData, 2);
      const baseUrl = (process.env.WEB_URL || 'https://anna-music-bot-ui.pages.dev').replace(/\/$/, '');
      const webUrl = `${baseUrl}/?token=${token}&guild=${interaction.guild.id}`;

      const embed = new EmbedBuilder()
        .setColor(config.embedColor || '#5865F2')
        .setAuthor({ name: 'ANNA MUSIC', iconURL: client.user.displayAvatarURL() })
        .setTitle('Bảng Điều Khiển Web Player')
        .setDescription(
          `Nhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${interaction.guild.name}**.\n\n` +
          `🔊 **Kênh Voice:** <#${memberVoice.id}>\n` +
          `🔑 **Mã PIN:** \`${pin}\``
        )
        .setFooter({ text: 'Mã PIN có hiệu lực trong 2 phút' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Mở Web Player')
          .setStyle(ButtonStyle.Link)
          .setURL(webUrl)
          .setEmoji('🌐')
      );

      return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }

    // Nút Xem hàng chờ (Kèm menu dropdown xóa bài trực tiếp)
    if (customId === 'btn_queue') {
      if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
        return interaction.reply({ embeds: [createErrorEmbed('Hàng chờ âm nhạc hiện đang trống!')], flags: 64 });
      }
      const qEmbed = createQueueEmbed(queue);
      const deleteMenu = createQueueDeleteSelectMenu(queue);
      const components = deleteMenu ? [deleteMenu] : [];
      return interaction.reply({ embeds: [qEmbed], components, flags: 64 });
    }

    // Nút Yêu thích (Lưu bài hát đang phát vào MongoDB Atlas)
    if (customId === 'btn_favorite') {
      if (!queue || !queue.currentSong) {
        return interaction.reply({ embeds: [createErrorEmbed('Hiện tại không có bài hát nào đang phát để thêm vào yêu thích!')], flags: 64 });
      }

      try {
        const result = await favoriteManager.toggleFavorite(interaction.user.id, queue.currentSong);
        if (result.isAdded) {
          return interaction.reply({
            embeds: [createSuccessEmbed(`❤️ Đã thêm [**${queue.currentSong.title}**](${queue.currentSong.url}) vào danh sách **Bài Hát Yêu Thích**\nTổng cộng: **${result.total} bài** • Gõ \`.fav\` để xem danh sách`)],
            flags: 64
          });
        } else {
          return interaction.reply({
            embeds: [createSuccessEmbed(`💔 Đã xóa [**${queue.currentSong.title}**](${queue.currentSong.url}) khỏi danh sách **Bài Hát Yêu Thích** của bạn.\nCòn lại: **${result.total} bài**`)],
            flags: 64
          });
        }
      } catch (err) {
        console.error('[Favorite Button Error]:', err);
        return interaction.reply({ embeds: [createErrorEmbed(`Lỗi khi lưu bài yêu thích: ${err.message}`)], flags: 64 });
      }
    }

    // Nút Phát tất cả bài yêu thích từ Embed .fav
    if (customId.startsWith('btn_play_user_fav_')) {
      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.reply({ embeds: [createErrorEmbed('Bạn cần ở trong một kênh Voice để phát nhạc!')], flags: 64 });
      }

      const targetUserId = customId.replace('btn_play_user_fav_', '');
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
      if (!hasMusicPermission(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
        return interaction.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để thêm bài.`)], flags: 64 });
      }

      if (!isAllowedVoiceChannel(interaction.member)) {
        const guildSettings = settingsManager.get(interaction.guild.id);
        return interaction.reply({ embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`)], flags: 64 });
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_add_song')
        .setTitle('➕ Thêm bài hát hoặc Playlist');

      const songInput = new TextInputBuilder()
        .setCustomId('song_query')
        .setLabel('Tên bài hát, Link bài hoặc Link Playlist')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Dán link YouTube/Spotify Playlist (tối đa 20 bài) hoặc tên bài...')
        .setRequired(true);

      const modalRow = new ActionRowBuilder().addComponents(songInput);
      modal.addComponents(modalRow);

      return interaction.showModal(modal);
    }

    // Kiểm tra quyền DJ khi bấm các nút điều khiển khác
    if (!hasMusicPermission(interaction.member)) {
      const guildSettings = settingsManager.get(interaction.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : '`DJ`';
      return interaction.reply({ embeds: [createErrorEmbed(`Chế độ DJ đang bật! Bạn cần có vai trò ${roleText} để điều khiển.`)], flags: 64 });
    }

    if (!queue || !queue.voiceChannel || !queue.connection) {
      return interaction.reply({ embeds: [createErrorEmbed('Bot hiện chưa tham gia phòng Voice nào! Vui lòng dùng lệnh `.thamgia` hoặc `.p <tên_bài>` để mời bot vào phòng trước.')], flags: 64 });
    }

    const memberVoice = interaction.member?.voice?.channel;
    if (queue.voiceChannel && memberVoice?.id !== queue.voiceChannel.id) {
      return interaction.reply({ embeds: [createErrorEmbed('Bạn cần ở cùng phòng Voice với bot để điều khiển!')], flags: 64 });
    }

    try {
      logAction('INTERACTION_DEFER_UPDATE', {
        customId,
        interactionId: interaction.id,
        channelId: interaction.channelId,
        guildId: interaction.guild.id
      });
      await interaction.deferUpdate().catch(() => {});

      if (customId === 'btn_pause') {
        queue.togglePause();
      } else if (customId === 'btn_skip') {
        queue.skip();
      } else if (customId === 'btn_loop') {
        queue.toggleLoop();
      } else if (customId === 'btn_stop') {
        queue.stop();
      }

      // Cập nhật lại giao diện NowPlaying message nếu có
      if (queue.currentSong && queue.nowPlayingMessage) {
        const embed = createNowPlayingEmbed(queue.currentSong, queue);
        const controls = createMusicControls(queue);
        logAction('MESSAGE_EDIT', {
          type: 'NOW_PLAYING_CONTROLS_BTN',
          channelId: interaction.channelId,
          messageId: queue.nowPlayingMessage.id,
          song: (queue.currentSong.title || '').slice(0, 60)
        });
        await queue.nowPlayingMessage.edit({ embeds: [embed], components: controls }).catch(() => {});
      }
    } catch (error) {
      console.error('Lỗi khi xử lý nút bấm:', error);
    }
  }
});

// Xử lý lỗi an toàn
client.on('error', (err) => console.error('[Discord Client Error]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
    return; // Bỏ qua lỗi socket pipe đóng sớm bình thường
  }
  console.error('[Uncaught Exception]', err);
});

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
