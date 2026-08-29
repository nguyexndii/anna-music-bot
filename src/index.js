const {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
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

// 1. Khởi tạo Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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

// 3. Keep-Alive Web Server (Express) chống trùng Port
const app = express();
app.get('/', (req, res) => {
  res.send('🎵 Anna Music Bot (24/7) đang hoạt động ổn định!');
});
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime(), botStatus: client.user ? 'ONLINE' : 'OFFLINE' });
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
startServer(Number(config.port) || 3005);

// 4. Sự kiện khi Bot sẵn sàng
client.once('clientReady', async () => {
  console.log(`🚀 [Discord Bot Ready] Đăng nhập thành công: ${client.user.tag}`);
  client.user.setActivity('ò_Ó 🫵 | .h', { type: ActivityType.Listening });
  await connectDatabase();

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
        setVoiceChannelStatus(voiceChannel, '♾️ 24/7 Mode');
        await q._play247BackgroundLofi();
      } catch (recErr) {
        console.warn(`[24/7 Recovery Error for Guild ${session.guildId}]:`, recErr.message);
      }
    }
  } catch (syncErr) {
    console.warn('[Session Sync Error]:', syncErr.message);
  }

  console.log('✨ Anna Music Bot đã sẵn sàng nhận lệnh 24/7!');
});

// Xử lý Lệnh tin nhắn (Có kiểm tra khóa kênh chat & tự xóa tin nhắn cảnh báo)
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const cmdName = client.commands.has(commandName) ? commandName : client.aliases.get(commandName);
  if (!cmdName) return;

  // Kiểm tra khóa kênh lệnh âm nhạc (Admin luôn được phép dùng ở mọi kênh)
  const isOwnerOrAdmin = message.author.id === message.guild.ownerId || message.member?.permissions.has('Administrator') || message.member?.permissions.has('ManageGuild');
  const guildSettings = settingsManager.get(message.guild.id);
  if (!isOwnerOrAdmin && guildSettings.musicChannelId && message.channel.id !== guildSettings.musicChannelId) {
    if (cmdName !== 'setchannel' && cmdName !== 'caidat') {
      message.delete().catch(() => {});

      message.channel.send({
        content: `⚠️ <@${message.author.id}>, bạn chỉ được phép dùng lệnh nhạc tại kênh <#${guildSettings.musicChannelId}>!`
      }).then(warningMsg => {
        setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
      }).catch(() => {});

      return;
    }
  }

  const command = client.commands.get(cmdName);
  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(`[Command Error] Lỗi khi chạy lệnh .${commandName}:`, error);
    message.reply({ embeds: [createErrorEmbed('Đã xảy ra lỗi khi thực thi lệnh này!')] }).catch(() => {});
  }
});

// Xử lý VoiceStateUpdate (Bot rời phòng, đổi phòng hoặc phòng trống)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = oldState.guild || newState.guild;
  if (!guild) return;

  const queue = musicManager.get(guild.id);

  // 1. Khi chính BOT bị ngắt kết nối hoặc rời khỏi kênh Voice
  if (oldState.id === client.user.id && !newState.channelId) {
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
    if (oldState.channel) {
      await clearVoiceChannelStatus(oldState.channel).catch(() => {});
    }
    if (queue) {
      queue.voiceChannel = newState.channel;
      if (queue.currentSong) {
        await setVoiceChannelStatus(newState.channel, `🎶 ${queue.currentSong.title}`).catch(() => {});
      }
    }
    return;
  }

  // 3. Xử lý phòng trống (không còn người nghe)
  if (!queue || !queue.voiceChannel) return;

  const botVoiceChannel = guild.channels.cache.get(queue.voiceChannel.id);
  if (!botVoiceChannel) return;

  const humanMembers = botVoiceChannel.members.filter(m => !m.user.bot);
  const guildSettings = settingsManager.get(guild.id);

  if (humanMembers.size === 0) {
    queue.startEmptyRoomTimer(guildSettings.emptyChannelTimeout || 60);
  } else {
    queue.clearEmptyRoomTimer();
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

// Xử lý Tương tác (Nút bấm, Menu Dropdown, Modal thêm bài hát)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;

  // 1. Xử lý Popup Modal Thêm bài hát (Hỗ trợ cả Playlist tối đa 20 bài)
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'modal_add_song') {
      const query = interaction.fields.getTextInputValue('song_query')?.trim();
      if (!query) {
        return interaction.reply({ embeds: [createErrorEmbed('Vui lòng nhập tên bài hát hoặc đường dẫn hợp lệ!')], flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      const memberVoice = interaction.member?.voice?.channel;
      if (!memberVoice) {
        return interaction.editReply({ embeds: [createErrorEmbed('Bạn cần ở trong một kênh Voice để thêm bài hát!')] });
      }

      try {
        const tracks = await searchTrack(query);
        if (!tracks || tracks.length === 0) {
          return interaction.editReply({ embeds: [createErrorEmbed('Không tìm thấy bài hát hoặc Playlist phù hợp với từ khóa này!')] });
        }

        const queue = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
        await queue.connect();

        if (tracks.length === 1) {
          const track = tracks[0];
          await queue.addSong(track, interaction.user);
          return interaction.editReply({
            embeds: [createSuccessEmbed(`Đã thêm bài hát vào hàng chờ: [**${track.title}**](${track.url})`)]
          });
        } else {
          await queue.addSongs(tracks, interaction.user);
          return interaction.editReply({
            embeds: [createSuccessEmbed(`Đã thêm thành công **${tracks.length} bài hát** từ Playlist vào hàng chờ!`)]
          });
        }
      } catch (err) {
        console.error('[Modal Add Song Error]:', err);
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

      if (selectedValue === 'set_ai') {
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
        return interaction.message.delete().catch(() => {});
      }
      const tab = customId.replace('help_tab_', '');
      const helpCommand = client.commands.get('help');
      if (helpCommand && helpCommand.createHelpMenu) {
        const payload = helpCommand.createHelpMenu(tab);
        return interaction.update(payload);
      }
    }

    // Nút Mở Bảng Điều Khiển Âm Nhạc (Open Music Controls)
    if (customId === 'btn_open_controls') {
      if (!queue || !queue.currentSong) {
        return interaction.reply({ embeds: [createErrorEmbed('Hiện không có bài hát nào đang phát!')] });
      }

      const embed = createNowPlayingEmbed(queue.currentSong, queue);
      const controls = createMusicControls(queue);
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

      await interaction.deferReply({ flags: 64 });
      const q = musicManager.getOrCreate(interaction.guild, interaction.channel, memberVoice);
      await q.connect();
      await q.addSongs(favorites, interaction.user);

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
