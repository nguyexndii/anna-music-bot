const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const favoriteManager = require('../structures/FavoriteManager');
const musicManager = require('../structures/MusicManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createEmbed, createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'favorite',
  aliases: ['fav', 'yeuthich', 'like', 'likes'],
  description: 'Manage and play your personal favorite songs list',
  data: new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('Manage and play your personal favorite songs list')
    .setDescriptionLocalizations({
      vi: 'Quản lý và phát danh sách bài hát yêu thích cá nhân'
    })
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('View your favorite songs list')
        .setDescriptionLocalizations({
          vi: 'Xem danh sách bài hát yêu thích của bạn'
        })
    )
    .addSubcommand(sub =>
      sub
        .setName('play')
        .setDescription('Play all your favorite songs into voice channel')
        .setDescriptionLocalizations({
          vi: 'Phát toàn bộ bài hát yêu thích vào phòng Voice'
        })
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a song to your favorites')
        .setDescriptionLocalizations({
          vi: 'Thêm bài hát vào danh sách yêu thích'
        })
        .addStringOption(opt =>
          opt
            .setName('query')
            .setDescription('Song title or URL')
            .setDescriptionLocalizations({
              vi: 'Tên bài hát hoặc link YouTube/Spotify'
            })
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a song from favorites by position number')
        .setDescriptionLocalizations({
          vi: 'Xóa bài hát khỏi danh sách yêu thích theo số thứ tự'
        })
        .addIntegerOption(opt =>
          opt
            .setName('index')
            .setDescription('Position number to remove')
            .setDescriptionLocalizations({
              vi: 'Số thứ tự bài hát cần xóa'
            })
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('Clear all favorite songs')
        .setDescriptionLocalizations({
          vi: 'Xóa toàn bộ danh sách bài hát yêu thích'
        })
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const userId = ctx.user.id;

    let sub = null;
    if (ctx.isInteraction) {
      sub = ctx.options.getSubcommand(false) || 'list';
    } else {
      sub = args[0]?.toLowerCase() || 'list';
    }

    // 1. Lệnh play / p -> Phát toàn bộ bài hát yêu thích
    if (sub === 'play' || sub === 'p') {
      const voiceChannel = ctx.member?.voice?.channel;
      if (!voiceChannel) {
        return ctx.reply({ embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice trước để phát nhạc!')] });
      }

      const favorites = await favoriteManager.getFavorites(userId);
      if (!favorites || favorites.length === 0) {
        return ctx.reply({ embeds: [createErrorEmbed('Danh sách yêu thích của bạn hiện đang trống! Hãy bấm nút `♡` khi đang nghe nhạc để thêm bài.')] });
      }

      const queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
      await queue.connect();

      await ctx.deferReply();
      await queue.addSongs(favorites, ctx.user);

      return ctx.editReply({
        embeds: [createSuccessEmbed(`❤️ Đã nạp thành công **${favorites.length} bài hát yêu thích** của <@${userId}> vào hàng chờ!`)]
      });
    }

    // 2. Lệnh add <tên/link> -> Thêm bài hát thủ công
    if (sub === 'add' || sub === 'a') {
      let query = ctx.isInteraction ? ctx.options.getString('query') : args.slice(1).join(' ').trim();
      if (!query) {
        return ctx.reply({ embeds: [createErrorEmbed('Vui lòng nhập tên bài hát hoặc link cần thêm! Ví dụ: `/favorite add Vũ Lạ Lùng`')] });
      }

      await ctx.deferReply();
      const tracks = await searchTrack(query);
      if (!tracks || tracks.length === 0) {
        return ctx.editReply({ embeds: [createErrorEmbed('Không tìm thấy bài hát phù hợp trên YouTube!')] });
      }

      const track = tracks[0];
      const result = await favoriteManager.toggleFavorite(userId, track);

      return ctx.editReply({
        embeds: [createSuccessEmbed(`Đã thêm bài hát vào danh sách yêu thích trên MongoDB Atlas: [**${track.title}**](${track.url})\nTổng cộng: **${result.total} bài**`)]
      });
    }

    // 3. Lệnh clear -> Xóa toàn bộ
    if (sub === 'clear') {
      await favoriteManager.clearFavorites(userId);
      return ctx.reply({ embeds: [createSuccessEmbed('Đã xóa sạch toàn bộ danh sách bài hát yêu thích của bạn!')] });
    }

    // 4. Lệnh remove <số thứ tự>
    if (sub === 'remove' || sub === 'xoa') {
      const idx = ctx.isInteraction ? ctx.options.getInteger('index') : parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        return ctx.reply({ embeds: [createErrorEmbed('Vui lòng nhập số thứ tự bài cần xóa! Ví dụ: `/favorite remove 1`')] });
      }

      const result = await favoriteManager.removeFavorite(userId, idx - 1);
      if (!result.removedSong) {
        return ctx.reply({ embeds: [createErrorEmbed('Không tìm thấy bài hát ở số thứ tự này!')] });
      }

      return ctx.reply({
        embeds: [createSuccessEmbed(`Đã xóa bài **${result.removedSong.title}** khỏi danh sách yêu thích!\nCòn lại: **${result.total} bài**`)]
      });
    }

    // 5. Mặc định / list: Hiển thị Danh Sách Bài Hát Yêu Thích
    const favorites = await favoriteManager.getFavorites(userId);

    const embed = new EmbedBuilder()
      .setTitle(`❤️ Bài Hát Yêu Thích — ${ctx.user.username}`)
      .setColor('#E0245E')
      .setThumbnail(ctx.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    if (!favorites || favorites.length === 0) {
      embed.setDescription(
        'Danh sách yêu thích của bạn hiện đang trống!\n\n💡 **Cách thêm bài hát:**\n• Bấm nút **`♡`** trên bảng điều khiển khi đang phát bài bất kỳ\n• Hoặc dùng lệnh: `/favorite add <tên bài hát>`'
      );
      return ctx.reply({ embeds: [embed] });
    }

    const listSlice = favorites.slice(0, 15);
    let desc = `**Bạn đang có ${favorites.length} bài hát yêu thích:**\n\n`;
    listSlice.forEach((song, idx) => {
      desc += `\`${idx + 1}.\` [${song.title.slice(0, 50)}](${song.url}) | \`${song.duration}\`\n`;
    });

    if (favorites.length > 15) {
      desc += `\n*...và còn **${favorites.length - 15} bài hát** khác nữa.*`;
    }

    desc += '\n\n💡 *Dùng `/favorite play` để phát toàn bộ danh sách này vào phòng Voice.*';
    embed.setDescription(desc);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_play_user_fav_${userId}`)
        .setLabel('Phát tất cả bài yêu thích')
        .setEmoji('▶')
        .setStyle(ButtonStyle.Success)
    );

    return ctx.reply({ embeds: [embed], components: [row] });
  }
};
