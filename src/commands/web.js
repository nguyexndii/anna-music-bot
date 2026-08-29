const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { generateWebToken } = require('../utils/tokenHelper');
const { createErrorEmbed } = require('../utils/embed');
const config = require('../config');

module.exports = {
  name: 'web',
  description: 'Mở giao diện Web Player điều khiển âm nhạc',
  usage: '',
  async execute(message, args) {
    const client = message.client;
    const guild = message.guild;
    const member = message.member;
    const author = message.author;

    // 1. Kiểm tra User có trong kênh Voice hay không
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return message.reply({
        embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')]
      });
    }

    // 2. Tạo User data và Magic Token
    const avatarUrl = author.displayAvatarURL({ dynamic: true, size: 256 });
    const userData = {
      userId: author.id,
      username: author.username,
      displayName: member?.displayName || author.globalName || author.username,
      avatar: avatarUrl,
      guildId: guild.id,
      guildName: guild.name
    };

    const token = generateWebToken(userData, 2); // Hiệu lực 2 phút
    const baseUrl = (process.env.WEB_URL || 'https://anna-music-bot-ui.pages.dev').replace(/\/$/, '');
    const webUrl = `${baseUrl}/?token=${token}&guild=${guild.id}`;

    // 3. Tạo Embed tinh gọn & chuyên nghiệp
    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: 'ANNA MUSIC', iconURL: client.user.displayAvatarURL() })
      .setTitle('Bảng Điều Khiển Web Player')
      .setDescription(`Nhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${guild.name}**.\n\n🔊 **Kênh Voice:** <#${userVoice.id}>`)
      .setFooter({ text: 'Liên kết có hiệu lực trong 2 phút' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Mở Web Player')
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl)
        .setEmoji('🌐')
    );

    try {
      await message.reply({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
