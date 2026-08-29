const favoriteManager = require('../structures/FavoriteManager');
const musicManager = require('../structures/MusicManager');
const { searchTrack } = require('../utils/musicExtractor');
const { createEmbed, createSuccessEmbed, createErrorEmbed } = require('../utils/embed');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

module.exports = {
  name: 'favorite',
  aliases: ['fav', 'yeuthich', 'like', 'likes'],
  description: 'Quản lý và phát danh sách bài hát yêu thích cá nhân lưu trên MongoDB Atlas',
  async execute(message, args) {
    const sub = args[0]?.toLowerCase();
    const userId = message.author.id;

    // 1. Lệnh .fav play / .fav p -> Phát toàn bộ bài hát yêu thích
    if (sub === 'play' || sub === 'p') {
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        return message.reply({ embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice trước để phát nhạc!')] });
      }

      const favorites = await favoriteManager.getFavorites(userId);
      if (!favorites || favorites.length === 0) {
        return message.reply({ embeds: [createErrorEmbed('Danh sách yêu thích của bạn hiện đang trống! Hãy bấm nút `♡` khi đang nghe nhạc để thêm bài.')] });
      }

      const queue = musicManager.getOrCreate(message.guild, message.channel, voiceChannel);
      await queue.connect();

      const loadingMsg = await message.reply({ embeds: [createEmbed('❤️ Đang nạp nhạc yêu thích...', `Đang nạp **${favorites.length} bài hát** từ MongoDB Atlas vào hàng chờ...`)] });

      await queue.addSongs(favorites, message.author);

      return loadingMsg.edit({
        embeds: [createSuccessEmbed(`Đã nạp thành công **${favorites.length} bài hát yêu thích** của <@${userId}> vào hàng chờ!`)]
      });
    }

    // 2. Lệnh .fav add <tên/link> -> Thêm bài hát thủ công
    if (sub === 'add' || sub === 'a') {
      const query = args.slice(1).join(' ').trim();
      if (!query) {
        return message.reply({ embeds: [createErrorEmbed('Vui lòng nhập tên bài hát hoặc link cần thêm! Ví dụ: `.fav add Vũ Lạ Lùng`')] });
      }

      const loadingMsg = await message.reply({ embeds: [createEmbed('🔎 Đang tìm bài hát...', `Đang tìm kiếm: \`${query}\``)] });
      const tracks = await searchTrack(query);
      if (!tracks || tracks.length === 0) {
        return loadingMsg.edit({ embeds: [createErrorEmbed('Không tìm thấy bài hát phù hợp trên YouTube!')] });
      }

      const track = tracks[0];
      const result = await favoriteManager.toggleFavorite(userId, track);

      return loadingMsg.edit({
        embeds: [createSuccessEmbed(`Đã thêm bài hát vào danh sách yêu thích trên MongoDB Atlas: [**${track.title}**](${track.url})\nTổng cộng: **${result.total} bài**`)]
      });
    }

    // 3. Lệnh .fav clear -> Xóa toàn bộ
    if (sub === 'clear') {
      await favoriteManager.clearFavorites(userId);
      return message.reply({ embeds: [createSuccessEmbed('Đã xóa sạch toàn bộ danh sách bài hát yêu thích của bạn!')] });
    }

    // 4. Lệnh .fav remove <số thứ tự>
    if (sub === 'remove' || sub === 'xoa') {
      const idx = parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        return message.reply({ embeds: [createErrorEmbed('Vui lòng nhập số thứ tự bài cần xóa! Ví dụ: `.fav remove 1`')] });
      }

      const result = await favoriteManager.removeFavorite(userId, idx - 1);
      if (!result.removedSong) {
        return message.reply({ embeds: [createErrorEmbed('Không tìm thấy bài hát ở số thứ tự này!')] });
      }

      return message.reply({
        embeds: [createSuccessEmbed(`Đã xóa bài **${result.removedSong.title}** khỏi danh sách yêu thích!\nCòn lại: **${result.total} bài**`)]
      });
    }

    // 5. Mặc định: Hiển thị Danh Sách Bài Hát Yêu Thích
    const favorites = await favoriteManager.getFavorites(userId);

    const embed = new EmbedBuilder()
      .setTitle(`❤️ Bài Hát Yêu Thích — ${message.author.username}`)
      .setColor('#E0245E')
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    if (!favorites || favorites.length === 0) {
      embed.setDescription(
        'Danh sách yêu thích của bạn hiện đang trống!\n\n💡 **Cách thêm bài hát:**\n• Bấm nút **`♡`** trên bảng điều khiển khi đang phát bài bất kỳ\n• Hoặc gõ lệnh: `.fav add <tên bài hát>`'
      );
      return message.reply({ embeds: [embed] });
    }

    const listSlice = favorites.slice(0, 15);
    let desc = `**Bạn đang có ${favorites.length} bài hát yêu thích:**\n\n`;
    listSlice.forEach((song, idx) => {
      desc += `\`${idx + 1}.\` [${song.title.slice(0, 50)}](${song.url}) | \`${song.duration}\`\n`;
    });

    if (favorites.length > 15) {
      desc += `\n*...và còn **${favorites.length - 15} bài hát** khác nữa.*`;
    }

    desc += '\n\n💡 *Gõ `.fav play` để phát toàn bộ danh sách này vào phòng Voice.*';
    embed.setDescription(desc);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_play_user_fav_${userId}`)
        .setLabel('Phát tất cả bài yêu thích')
        .setEmoji('▶')
        .setStyle(ButtonStyle.Success)
    );

    return message.reply({ embeds: [embed], components: [row] });
  }
};
