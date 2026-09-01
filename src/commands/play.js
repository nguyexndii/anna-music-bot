const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createErrorEmbed, createEmbed, createQueueAddedEmbed, createSuccessEmbed, createNowPlayingEmbed, createMusicControls, CUSTOM_EMOJIS, EMOJI_TAG } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const config = require('../config');

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Play a song or playlist from YouTube, Spotify, SoundCloud',
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube, Spotify, SoundCloud')
    .setDescriptionLocalizations({
      vi: 'Phát bài hát hoặc Playlist từ YouTube, Spotify, SoundCloud'
    })
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song title, artist name, or URL')
        .setDescriptionLocalizations({
          vi: 'Tên bài hát, ca sĩ hoặc đường dẫn'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);

    // 1. Kiểm tra quyền DJ
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.sendTemp(`Bạn cần có vai trò ${roleText} để phát nhạc.`, 7000);
    }

    // 2. Kiểm tra kênh Voice
    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) {
      return ctx.sendTemp('Bạn cần tham gia vào một kênh Voice trước!', 7000);
    }

    // 3. Kiểm tra kênh Voice bị khóa (Admin bypass)
    if (!isAllowedVoiceChannel(ctx.member)) {
      const guildSettings = settingsManager.get(ctx.guild.id);
      return ctx.sendTemp(`Máy chủ đã khóa kênh Voice cố định! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để nghe nhạc.`, 7000);
    }

    const permissions = voiceChannel.permissionsFor(ctx.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return ctx.sendTemp('Bot không có quyền kết nối hoặc phát âm thanh trong kênh Voice của bạn!', 7000);
    }

    // 4. Vào phòng Voice ngay lập tức
    const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
    try {
      await queue.connect();
    } catch (connErr) {
      console.error('[Voice Connect Error]:', connErr);
      return ctx.reply(`Không thể kết nối vào phòng Voice: ${connErr.message}`);
    }

    let query = ctx.isInteraction ? ctx.options.getString('query') : args.join(' ');
    query = query ? query.trim() : '';

    if (!query) {
      // Nếu đang phát bài hát: Hiển thị ngay bảng điều khiển Now Playing đầy đủ
      if (queue.currentSong) {
        const embed = createNowPlayingEmbed(queue.currentSong, queue);
        const controls = createMusicControls(queue);
        return ctx.reply({ embeds: [embed], components: controls });
      }

      // Nếu chưa có bài hát nào: Hiển thị Card Trình Phát Sẵn Sàng
      const requester = `<@${ctx.user.id}>`;
      const voiceChannelText = `<#${voiceChannel.id}>`;

      const embed = new EmbedBuilder()
        .setAuthor({ name: 'Trình Phát Âm Nhạc • Music Player', iconURL: ctx.client.user.displayAvatarURL() })
        .setTitle('🎵 Sẵn sàng nhận yêu cầu bài hát')
        .setColor('#2B2D31')
        .setDescription(
          `${EMOJI_TAG.add} ${requester} • ${voiceChannelText}\n\n` +
          `Nhấn nút **\`Thêm bài hát\`** bên dưới hoặc gõ lệnh \`/play <tên_bài_hát>\` để phát nhạc ngay lập tức!`
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
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('btn_web_player')
          .setLabel('Web Player')
          .setEmoji('🌐')
          .setStyle(ButtonStyle.Success)
      );

      return ctx.reply({
        embeds: [embed],
        components: [row]
      });
    }

    await ctx.deferReply();

    try {
      const tracks = await searchTrack(query);
      if (!tracks || tracks.length === 0) {
        return ctx.editReply('Không tìm thấy bài hát hoặc Playlist phù hợp!');
      }

      if (tracks.length === 1) {
        const track = tracks[0];
        await queue.addSong(track, ctx.user);

        const userSongs = queue.songs.filter(s => s.requestedBy !== 'Auto' && s.requestedBy !== 'Auto (24/7)');
        const position = userSongs.length || 1;
        return ctx.editReply({
          content: null,
          embeds: [createQueueAddedEmbed(track, position)]
        });
      } else {
        // Nhiều bài hát từ Playlist
        await queue.addSongs(tracks, ctx.user);
        return ctx.editReply(`Đã thêm thành công **${tracks.length} bài hát** từ Playlist vào hàng chờ!`);
      }
    } catch (error) {
      console.error('Error executing play command:', error);
      return ctx.editReply(`Đã xảy ra lỗi khi phát nhạc: ${error.message}`);
    }
  }
};
