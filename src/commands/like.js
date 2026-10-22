const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');
const favoriteManager = require('../structures/FavoriteManager');
const settingsManager = require('../structures/SettingsManager');
const musicManager = require('../structures/MusicManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createEmbed, createSuccessEmbed, createErrorEmbed, formatMarkdownTitle, CUSTOM_EMOJIS, EMOJI_TAG } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'like',
  aliases: ['fav', 'favorite', 'yeuthich', 'likes'],
  description: 'Manage and play your personal liked songs list',
  data: new SlashCommandBuilder()
    .setName('like')
    .setDescription('Manage and play your personal liked songs list')
    .setDescriptionLocalizations({
      vi: 'Quản lý và phát danh sách bài hát yêu thích cá nhân'
    })
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('View your liked songs list')
        .setDescriptionLocalizations({
          vi: 'Xem danh sách các bài hát bạn đã thích'
        })
    )
    .addSubcommand(sub =>
      sub
        .setName('play')
        .setDescription('Play liked songs into voice channel')
        .setDescriptionLocalizations({
          vi: 'Phát bài hát yêu thích vào phòng Voice'
        })
        .addIntegerOption(opt =>
          opt
            .setName('index')
            .setDescription('Position number of the specific song to play (leave blank to play all)')
            .setDescriptionLocalizations({
              vi: 'Số thứ tự bài hát muốn phát (ví dụ: 1, 2, 3... - để trống nếu muốn phát toàn bộ danh sách)'
            })
            .setMinValue(1)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a song to your liked songs list')
        .setDescriptionLocalizations({
          vi: 'Thêm bài hát vào danh sách yêu thích'
        })
        .addStringOption(opt =>
          opt
            .setName('song')
            .setDescription('Song title, artist name, or YouTube/Spotify URL')
            .setDescriptionLocalizations({
              vi: 'Tên bài hát, tên ca sĩ hoặc đường dẫn link YouTube/Spotify (ví dụ: Vũ Lạ Lùng)'
            })
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a song from liked list by its position number')
        .setDescriptionLocalizations({
          vi: 'Xóa bài hát khỏi danh sách yêu thích theo số thứ tự'
        })
        .addIntegerOption(opt =>
          opt
            .setName('index')
            .setDescription('Position number of the song to remove (e.g. 1, 2, 3...)')
            .setDescriptionLocalizations({
              vi: 'Số thứ tự của bài hát cần xóa trong danh sách yêu thích (ví dụ: 1, 2, 3...)'
            })
            .setMinValue(1)
            .setRequired(true)
        )
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const userId = ctx.user.id;
    const isEn = ctx.guild?.id && settingsManager.get(ctx.guild.id)?.language === 'en';

    let sub = null;
    if (ctx.isInteraction) {
      sub = ctx.options.getSubcommand(false) || 'list';
    } else {
      sub = args[0]?.toLowerCase() || 'list';
    }

    // 1. Lệnh play / p -> Phát toàn bộ bài hát yêu thích hoặc 1 bài cụ thể
    if (sub === 'play' || sub === 'p') {
      const voiceChannel = ctx.member?.voice?.channel;
      if (!voiceChannel) {
        return ctx.reply({ embeds: [createErrorEmbed(isEn ? 'You must be in a Voice channel to play music!' : 'Bạn cần tham gia vào một kênh Voice trước để phát nhạc!')], flags: 64 });
      }

      const favorites = await favoriteManager.getFavorites(userId);
      if (!favorites || favorites.length === 0) {
        return ctx.reply({ embeds: [createErrorEmbed(isEn ? 'Your favorites list is empty! Click the `♡` button while listening to add songs.' : 'Danh sách yêu thích của bạn hiện đang trống! Hãy bấm nút `♡` khi đang nghe nhạc để thêm bài.')], flags: 64 });
      }

      const playIdx = ctx.isInteraction ? ctx.options.getInteger('index') : parseInt(args[1], 10);
      const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
      await queue.connect();

      if (playIdx && !isNaN(playIdx) && playIdx >= 1) {
        if (playIdx > favorites.length) {
          return ctx.reply({ embeds: [createErrorEmbed(isEn ? `Invalid index! You have **${favorites.length} songs** in favorites.` : `Số thứ tự không hợp lệ! Bạn có **${favorites.length} bài hát** trong danh sách yêu thích.`)], flags: 64 });
        }
        const song = favorites[playIdx - 1];
        await ctx.deferReply({ flags: 64 });
        await queue.addSong(song, ctx.member || ctx.user);
        return ctx.editReply({
          embeds: [createSuccessEmbed(isEn ? `<:anna_heart:1562002749099479090> Added [**${formatMarkdownTitle(song.title, 60)}**](${song.url}) to queue!` : `<:anna_heart:1562002749099479090> Đã nạp bài hát [**${formatMarkdownTitle(song.title, 60)}**](${song.url}) vào hàng chờ!`)]
        });
      }

      await ctx.deferReply();
      await queue.addSongs(favorites, ctx.member || ctx.user);

      return ctx.editReply({
        embeds: [createSuccessEmbed(isEn ? `<:anna_heart:1562002749099479090> Successfully added **${favorites.length} favorite songs** of <@${userId}> to queue!` : `<:anna_heart:1562002749099479090> Đã nạp thành công **${favorites.length} bài hát yêu thích** của <@${userId}> vào hàng chờ!`)]
      });
    }

    // 2. Lệnh add <tên/link> -> Thêm bài hát thủ công hoặc bài đang phát
    if (sub === 'add' || sub === 'a') {
      const queue = musicManager.get(ctx.guild.id);
      let query = ctx.isInteraction ? (ctx.options.getString('song') || ctx.options.getString('query')) : args.slice(1).join(' ').trim();
      
      if (!query) {
        if (queue && queue.currentSong) {
          if (queue.currentSong.is247 || queue.currentSong.requestedBy === 'Auto (24/7)' || queue.currentSong.requestedBy === 'Auto (24/7 Lofi)') {
            return ctx.reply({ embeds: [createErrorEmbed(isEn ? '❌ Cannot add 24/7 Lofi background radio to favorites! Please play a song first.' : '❌ Không thể thêm nhạc nền chế độ 24/7 Lofi vào danh sách yêu thích! Hãy order một bài hát để thả tim nhé.')], flags: 64 });
          }
          const result = await favoriteManager.toggleFavorite(userId, queue.currentSong);
          const formattedTitle = formatMarkdownTitle(queue.currentSong.title, 60);
          const notifContent = isEn
            ? `<:anna_heart:1562002749099479090> ${result.isAdded ? 'Added' : 'Removed'} [**${formattedTitle}**](${queue.currentSong.url}) ${result.isAdded ? 'to' : 'from'} **Liked Songs**\nTotal: **${result.total} songs**`
            : `<:anna_heart:1562002749099479090> ${result.isAdded ? 'Đã thêm' : 'Đã xóa'} [**${formattedTitle}**](${queue.currentSong.url}) ${result.isAdded ? 'vào danh sách' : 'khỏi danh sách'} **Bài Hát Yêu Thích**\nTổng cộng: **${result.total} bài**`;
          return ctx.reply({
            embeds: [createSuccessEmbed(notifContent)],
            flags: 64
          });
        }
        return ctx.reply({ embeds: [createErrorEmbed(isEn ? 'Please enter a song name or URL to add! Example: `/like add Stay`' : 'Vui lòng nhập tên bài hát hoặc link cần thêm! Ví dụ: `/like add Vũ Lạ Lùng`')] });
      }

      await ctx.deferReply();
      const tracks = await searchTrack(query);
      if (!tracks || tracks.length === 0) {
        return ctx.editReply({ embeds: [createErrorEmbed(isEn ? 'No matching songs found on YouTube!' : 'Không tìm thấy bài hát phù hợp trên YouTube!')] });
      }

      const track = tracks[0];
      if (track.is247 || track.requestedBy === 'Auto (24/7)' || track.requestedBy === 'Auto (24/7 Lofi)') {
        return ctx.editReply({ embeds: [createErrorEmbed(isEn ? '❌ Cannot add 24/7 Lofi background radio to favorites!' : '❌ Không thể thêm nhạc nền chế độ 24/7 Lofi vào danh sách yêu thích!')] });
      }

      try {
        const result = await favoriteManager.toggleFavorite(userId, track);
        const actionText = isEn
          ? (result.isAdded ? 'Added song to favorites' : 'Removed song from favorites')
          : (result.isAdded ? 'Đã thêm bài hát vào danh sách yêu thích' : 'Đã xóa bài hát khỏi danh sách yêu thích');
        const totalText = isEn ? `Total: **${result.total} songs**` : `Tổng cộng: **${result.total} bài**`;
        return ctx.editReply({
          embeds: [createSuccessEmbed(`${actionText}: [**${formatMarkdownTitle(track.title, 60)}**](${track.url})\n${totalText}`)]
        });
      } catch (fErr) {
        let msg = fErr.message;
        if (isEn) {
          if (fErr.code === 'ERR_CANNOT_FAVORITE_247' || fErr.message.includes('24/7')) {
            msg = '❌ Cannot add 24/7 Lofi background radio to favorites!';
          } else if (fErr.code === 'ERR_INVALID_SONG_DATA' || fErr.message.includes('không hợp lệ')) {
            msg = '❌ Invalid song data!';
          }
        }
        return ctx.editReply({ embeds: [createErrorEmbed(msg)] });
      }
    }

    // 3. Lệnh remove <số thứ tự>
    if (sub === 'remove' || sub === 'xoa') {
      const idx = ctx.isInteraction ? ctx.options.getInteger('index') : parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        return ctx.reply({ embeds: [createErrorEmbed(isEn ? 'Please enter the track number to remove! Example: `/like remove 1`' : 'Vui lòng nhập số thứ tự bài cần xóa! Ví dụ: `/like remove 1`')], flags: 64 });
      }

      const result = await favoriteManager.removeFavorite(userId, idx - 1);
      if (!result.removedSong) {
        return ctx.reply({ embeds: [createErrorEmbed(isEn ? 'No song found at this position!' : 'Không tìm thấy bài hát ở số thứ tự này!')], flags: 64 });
      }

      return ctx.reply({
        embeds: [createSuccessEmbed(isEn ? `Removed **${formatMarkdownTitle(result.removedSong.title, 60)}** from favorites!\nRemaining: **${result.total} songs**` : `Đã xóa bài **${formatMarkdownTitle(result.removedSong.title, 60)}** khỏi danh sách yêu thích!\nCòn lại: **${result.total} bài**`)],
        flags: 64,
        ephemeral: true
      });
    }

    // 4. Mặc định / list: Hiển thị Danh Sách Bài Hát Yêu Thích (Components V2)
    const favorites = await favoriteManager.getFavorites(userId);
    const userName = ctx.user.displayName || ctx.user.globalName || ctx.user.username;
    const avatarUrl = ctx.user.displayAvatarURL({ dynamic: true, size: 256 });

    if (!favorites || favorites.length === 0) {
      const emptyContainer = {
        type: 17,
        accent_color: 0xE0245E,
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: isEn ? '### Liked Songs Collection — ' + userName + '\nYour favorites list is currently empty!\n\n💡 **How to add songs:**\n• Click **Favorite** button on player card while listening\n• Or use: `/like add <song_name>`' : '### Danh Sách Bài Hát Yêu Thích — ' + userName + '\nDanh sách yêu thích của bạn hiện đang trống!\n\n💡 **Cách thêm bài hát:**\n• Bấm nút **Favorite** trên bảng điều khiển khi đang phát bài bất kỳ\n• Hoặc dùng lệnh: `/like add <tên bài hát>`'
              }
            ],
            accessory: {
              type: 11,
              media: { url: avatarUrl }
            }
          }
        ]
      };
      return ctx.reply({ components: [emptyContainer], flags: 32768 | 64 });
    }

    const listSlice = favorites.slice(0, 15);
    let descLines = [];
    listSlice.forEach((song, idx) => {
      const cleanTitle = formatMarkdownTitle(song.title, 50);
      const songUrl = (song.url && song.url !== 'null') ? song.url : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(song.title);
      descLines.push('`' + (idx + 1) + '.` **[' + cleanTitle + '](' + songUrl + ')** | `' + (song.duration || '3:30') + '`');
    });

    if (favorites.length > 15) {
      descLines.push(isEn ? '\n*...and **' + (favorites.length - 15) + ' more songs** in your collection.*\n' : '\n*...và còn **' + (favorites.length - 15) + ' bài hát** khác trong danh sách.*\n');
    }

    descLines.push(isEn ? '\n💡 *Click the button below to play your entire collection in Voice.*' : '\n💡 *Bấm nút bên dưới để phát toàn bộ danh sách vào phòng Voice.*');

    const containerComponents = [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: isEn ? '### Liked Songs Collection — ' + userName + '\n**You have ' + favorites.length + ' favorite songs in your collection:**' : '### Danh Sách Bài Hát Yêu Thích — ' + userName + '\n**Bạn đang có ' + favorites.length + ' bài hát yêu thích trong bộ sưu tập:**'
          }
        ],
        accessory: {
          type: 11,
          media: { url: avatarUrl }
        }
      },
      {
        type: 10,
        content: descLines.join('\n')
      }
    ];

    // Menu chọn bài cụ thể nếu có
    const selectOptions = favorites.slice(0, 25).map((song, idx) => ({
      label: ((idx + 1) + '. ' + song.title).slice(0, 95),
      description: ((isEn ? 'Duration: ' : 'Thời lượng: ') + (song.duration || '3:30')).slice(0, 95),
      value: 'fav_song_' + idx,
      emoji: CUSTOM_EMOJIS.musicNote
    }));

    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('menu_play_fav_song_' + userId)
        .setPlaceholder(isEn ? 'Choose a specific song to play...' : 'Chọn bài hát cụ thể để phát...')
        .addOptions(selectOptions);
      containerComponents.push(new ActionRowBuilder().addComponents(selectMenu).toJSON());
    }

    // Nút Phát tất cả màu xám chuẩn (style: 2)
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_play_user_fav_' + userId)
        .setLabel(isEn ? 'Play All (' + favorites.length + ' tracks)' : 'Phát tất cả (' + favorites.length + ' bài)')
        .setEmoji(CUSTOM_EMOJIS.play)
        .setStyle(ButtonStyle.Secondary)
    );
    containerComponents.push(btnRow.toJSON());

    const likeContainer = {
      type: 17,
      accent_color: 0xE0245E,
      components: containerComponents
    };

    return ctx.reply({ components: [likeContainer], flags: 32768 | 64 });
  }
};
