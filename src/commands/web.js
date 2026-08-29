const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { generateWebToken } = require('../utils/tokenHelper');
const config = require('../config');

module.exports = {
  name: 'web',
  description: 'Nhận Magic Link để mở Web Player điều khiển nhạc',
  usage: '',
  async execute(client, message, args) {
    const guild = message.guild;
    const member = message.member;
    const author = message.author;

    // Lấy thông tin user
    const avatarUrl = author.displayAvatarURL({ dynamic: true, size: 256 });
    const userData = {
      userId: author.id,
      username: author.username,
      displayName: member?.displayName || author.globalName || author.username,
      avatar: avatarUrl,
      guildId: guild.id,
      guildName: guild.name
    };

    // Tạo Magic Token
    const token = generateWebToken(userData);
    const baseUrl = process.env.WEB_URL || `http://${message.guild?.id ? 'localhost' : 'localhost'}:${config.port}`;
    const webUrl = `${baseUrl}/?token=${token}&guild=${guild.id}`;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: 'ANNA MUSIC • WEB PLAYER', iconURL: client.user.displayAvatarURL() })
      .setTitle('🌐 Magic Link Điều Khiển Nhạc Trên Web')
      .setDescription(
        `Xin chào **${userData.displayName}**!\n\n` +
        `Dưới đây là liên kết riêng tư của bạn để truy cập **Web Player** của máy chủ **${guild.name}**.\n` +
        `Tại Web Player, bạn có thể:\n` +
        `• 🔍 **Live Search:** Tìm kiếm và chọn bài hát tức thời.\n` +
        `• 📋 **Quản lý Hàng chờ:** Xem, kéo thả, xóa bài trong hàng chờ.\n` +
        `• 📜 **Karaoke Lyrics:** Lời bài hát đồng bộ thời gian thực.\n` +
        `• ⏯️ **Điều khiển:** Chỉnh âm lượng, chuyển bài, bật/tắt 24/7 Lofi.\n\n` +
        `> 🔒 *Mỗi thao tác trên Web sẽ tự động ghi nhận Avatar & Tên của bạn!*`
      )
      .setThumbnail(avatarUrl)
      .setFooter({ text: 'Liên kết có hiệu lực trong 48 giờ • Vui lòng không chia sẻ cho người lạ' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Mở Web Player Ngay')
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl)
        .setEmoji('🌐')
    );

    // Gửi tin nhắn
    try {
      if (message.deletable) {
        // Xóa lệnh gõ để giữ kênh chat sạch sẽ và gửi DM hoặc tin nhắn riêng
        await message.reply({ embeds: [embed], components: [row] });
      } else {
        await message.reply({ embeds: [embed], components: [row] });
      }
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
