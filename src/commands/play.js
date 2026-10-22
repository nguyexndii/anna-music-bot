const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createErrorEmbed, createEmbed, createQueueAddedEmbed, createSuccessEmbed, createNowPlayingCard, CUSTOM_EMOJIS, EMOJI_TAG } = require('../utils/embed');
const { hasMusicPermission, isAllowedVoiceChannel } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const playlistHistoryManager = require('../structures/PlaylistHistoryManager');
const { t } = require('../utils/i18n');
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
        .setName('song')
        .setDescription('Song title, artist name, or YouTube/Spotify/SoundCloud URL')
        .setDescriptionLocalizations({
          vi: 'Tên bài hát, ca sĩ hoặc đường dẫn link YouTube/Spotify/SoundCloud (ví dụ: Vũ Lạ Lùng)'
        })
        .setRequired(true)
        .setAutocomplete(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;
    const isEn = settingsManager.get(guildId)?.language === 'en';

    // 1. Kiểm tra quyền DJ
    if (!hasMusicPermission(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.sendTemp(t(guildId, 'common.dj_only', { role: roleText }), 7000);
    }

    // 2. Kiểm tra kênh Voice
    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) {
      return ctx.sendTemp(t(guildId, 'common.no_voice'), 7000);
    }

    // 3. Kiểm tra kênh Voice bị khóa (Admin bypass)
    if (!isAllowedVoiceChannel(ctx.member)) {
      const guildSettings = settingsManager.get(guildId);
      return ctx.sendTemp(t(guildId, 'common.voice_locked', { channelId: guildSettings.lockedVoiceChannelId }), 7000);
    }

    const permissions = voiceChannel.permissionsFor(ctx.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return ctx.sendTemp(t(guildId, 'common.command_error'), 7000);
    }

    // 4. Vào phòng Voice ngay lập tức
    const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
    try {
      await queue.connect();
    } catch (connErr) {
      console.error('[Voice Connect Error]:', connErr);
      return ctx.reply(`${t(guildId, 'common.command_error')}: ${connErr.message}`);
    }

    let query = ctx.isInteraction ? (ctx.options.getString('song') || ctx.options.getString('query')) : args.join(' ');
    query = query ? query.trim() : '';

    if (!query) {
      // Nếu đang phát bài hát: Hiển thị ngay bảng điều khiển Now Playing đầy đủ
      if (queue.currentSong) {
        const card = createNowPlayingCard(queue.currentSong, queue);
        return ctx.reply(card);
      }

      // Nếu chưa có bài hát nào: Hiển thị Card Trình Phát Sẵn Sàng
      const requester = `<@${ctx.user.id}>`;
      const voiceChannelText = `<#${voiceChannel.id}>`;

      const readyTitle = isEn ? 'Ready to Receive Song Requests' : 'Sẵn sàng nhận yêu cầu bài hát';
      const readyDesc = isEn
        ? `${EMOJI_TAG.add} ${requester} • ${voiceChannelText}\n\nClick **\`Add Song\`** button below or type \`/play <song_name>\` to start playing music!`
        : `${EMOJI_TAG.add} ${requester} • ${voiceChannelText}\n\nNhấn nút **\`Thêm bài\`** bên dưới hoặc gõ lệnh \`/play <tên_bài_hát>\` để phát nhạc ngay lập tức!`;

      const embed = new EmbedBuilder()
        .setAuthor({ name: isEn ? 'Anna Music Player' : 'Trình Phát Âm Nhạc', iconURL: ctx.client.user.displayAvatarURL() })
        .setTitle(`${EMOJI_TAG.musicNotesDouble} ${readyTitle}`)
        .setColor('#2B2D31')
        .setDescription(readyDesc);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_add_song')
          .setLabel(isEn ? 'Add Song' : 'Thêm bài')
          .setEmoji(CUSTOM_EMOJIS.add)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_queue')
          .setLabel(isEn ? 'Queue' : 'Hàng chờ')
          .setEmoji(CUSTOM_EMOJIS.list)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('btn_web_player')
          .setLabel('Web Player')
          .setEmoji(CUSTOM_EMOJIS.web)
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
        return ctx.editReply(t(guildId, 'common.track_not_found'));
      }

      if (tracks.length === 1) {
        const track = tracks[0];
        const result = await queue.addSong(track, ctx.member || ctx.user);
        const position = result?.position || 1;
        return ctx.editReply({
          content: null,
          embeds: [createQueueAddedEmbed(track, position, guildId)]
        });
      } else {
        // Nhiều bài hát từ Playlist
        await queue.addSongs(tracks, ctx.member || ctx.user);

        // Lưu danh sách phát vào lịch sử server
        try {
          const userObj = ctx.member?.user || ctx.user;
          const reqName = ctx.member?.displayName || userObj?.username || 'User';
          const reqAvatar = userObj?.displayAvatarURL ? userObj.displayAvatarURL({ extension: 'png', size: 64 }) : null;

          playlistHistoryManager.addPlaylist(guildId, {
            url: query,
            title: tracks[0]?.playlistTitle || `Playlist (${tracks.length} tracks)`,
            trackCount: tracks.length,
            thumbnail: tracks[0]?.playlistThumbnail || tracks[0]?.thumbnail || null,
            addedBy: reqName,
            addedByAvatar: reqAvatar,
            tracks: tracks
          });
        } catch (plErr) {
          console.error('Error saving playlist to history in play command:', plErr);
        }

        return ctx.editReply(t(guildId, 'player.added_playlist', {
          count: tracks.length,
          title: tracks[0]?.playlistTitle || 'Playlist'
        }));
      }
    } catch (error) {
      console.error('Error executing play command:', error);
      return ctx.editReply(`${t(guildId, 'common.command_error')}: ${error.message}`);
    }
  }
};
