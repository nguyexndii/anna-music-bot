const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createErrorEmbed, createEmbed, createQueueAddedEmbed, createSuccessEmbed, createNowPlayingEmbed, createMusicControls, CUSTOM_EMOJIS, EMOJI_TAG } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');
const config = require('../config');

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Phát nhạc từ link YouTube, SoundCloud, Spotify hoặc Playlist (Tối đa 20 bài)',
  async execute(message, args) {
    // 1. Kiểm tra quyền DJ
    if (!hasMusicPermission(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return message.reply(`Bạn cần có vai trò ${roleText} để phát nhạc.`);
    }

    // 2. Kiểm tra kênh Voice
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('Bạn cần tham gia vào một kênh Voice trước!');
    }

    // 3. Kiểm tra kênh Voice bị khóa (Admin bypass)
    if (!isAllowedVoiceChannel(message.member)) {
      const guildSettings = settingsManager.get(message.guild.id);
      return message.reply(`Máy chủ đã khóa kênh Voice cố định! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`);
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return message.reply('Bot không có quyền kết nối hoặc phát âm thanh trong kênh Voice của bạn!');
    }

    // 4. Vào phòng Voice ngay lập tức
    const queue = musicManager.getOrCreate(message.guild, message.channel, voiceChannel);
    try {
      await queue.connect();
    } catch (connErr) {
      console.error('[Voice Connect Error]:', connErr);
      return message.reply(`Không thể kết nối vào phòng Voice: ${connErr.message}`);
    }

    let query = args.join(' ');
    if (!query) {
      // Nếu đang phát bài hát: Hiển thị ngay bảng điều khiển Now Playing đầy đủ
      if (queue.currentSong) {
        const embed = createNowPlayingEmbed(queue.currentSong, queue);
        const controls = createMusicControls(queue);
        return message.reply({ embeds: [embed], components: controls });
      }

      // Nếu chưa có bài hát nào: Hiển thị Card Trình Phát Sẵn Sàng nguyên khối
      const requester = `<@${message.author.id}>`;
      const voiceChannelText = `<#${voiceChannel.id}>`;

      const embed = new EmbedBuilder()
        .setAuthor({ name: 'Trình Phát Âm Nhạc', iconURL: message.client.user.displayAvatarURL() })
        .setTitle('🎵 Sẵn sàng nhận yêu cầu bài hát')
        .setColor('#2B2D31')
        .setDescription(
          `${EMOJI_TAG.add} ${requester} • ${voiceChannelText}\n\n` +
          `Nhấn nút **\`Thêm bài hát\`** bên dưới hoặc gõ \`${config.prefix}p <tên_bài_hát>\` để phát nhạc ngay lập tức!`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_add_song')
          .setLabel('Thêm bài hát')
          .setEmoji(CUSTOM_EMOJIS.add)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_queue')
          .setLabel('Hàng chờ')
          .setEmoji(CUSTOM_EMOJIS.list)
          .setStyle(ButtonStyle.Secondary)
      );

      return message.reply({
        embeds: [embed],
        components: [row]
      });
    }

    let loadingMsg = await message.reply('Đang tìm kiếm bài hát...').catch(() => null);

    try {
      const tracks = await searchTrack(query);
      if (!tracks || tracks.length === 0) {
        if (loadingMsg) await loadingMsg.edit('Không tìm thấy bài hát hoặc Playlist phù hợp!').catch(() => {});
        return;
      }

      if (tracks.length === 1) {
        const track = tracks[0];
        await queue.addSong(track, message.author);

        const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');
        const position = userSongs.length || 1;
        if (loadingMsg) {
          await loadingMsg.edit({
            content: null,
            embeds: [createQueueAddedEmbed(track, position)]
          }).catch(() => {});
        }
      } else {
        // Nhiều bài hát từ Playlist (Tối đa 20 bài)
        await queue.addSongs(tracks, message.author);
        if (loadingMsg) {
          await loadingMsg.edit(`Đã thêm thành công **${tracks.length} bài hát** từ Playlist vào hàng chờ!`).catch(() => {});
        }
      }
    } catch (error) {
      console.error('Error executing play command:', error);
      if (loadingMsg) {
        await loadingMsg.edit(`Đã xảy ra lỗi khi phát nhạc: ${error.message}`).catch(() => {});
      }
    }
  }
};
