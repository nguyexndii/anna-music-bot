const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { generateWebToken } = require('../utils/tokenHelper');
const { createErrorEmbed } = require('../utils/embed');
const { isAllowedVoiceChannel } = require('../utils/permissionHelper');
const settingsManager = require('../structures/SettingsManager');
const config = require('../config');

// Helper gửi thông báo tự động xóa sau delayMs (mặc định 7s)
function sendTemp(message, payload, delayMs = 7000) {
  message.reply(payload).then(msg => {
    setTimeout(() => {
      msg.delete().catch(() => {});
      if (message.deletable) message.delete().catch(() => {});
    }, delayMs);
  }).catch(() => {});
}

module.exports = {
  name: 'web',
  description: 'Mở giao diện Web Player điều khiển âm nhạc',
  usage: '',
  async execute(message, args) {
    const client = message.client;
    const guild = message.guild;
    const member = message.member;
    const author = message.author;

    // 1. Kiểm tra User có trong kênh Voice hay không (Tự động xóa sau 7s)
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return sendTemp(message, {
        embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')]
      }, 7000);
    }

    // 2. Kiểm tra kênh Voice bị khóa (Tự động xóa sau 7s)
    const guildSettings = settingsManager.get(guild.id);
    if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(member)) {
      return sendTemp(message, {
        embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)]
      }, 7000);
    }

    // 3. Tạo User data và Magic Token (kèm PIN 6 số)
    const avatarUrl = author.displayAvatarURL({ dynamic: true, size: 256 });
    const userData = {
      userId: author.id,
      username: author.username,
      displayName: member?.displayName || author.globalName || author.username,
      avatar: avatarUrl,
      guildId: guild.id,
      guildName: guild.name
    };

    const { token, pin } = generateWebToken(userData, 2); // Hiệu lực 2 phút
    const baseUrl = (process.env.WEB_URL || 'https://anna-music-bot-ui.pages.dev').replace(/\/$/, '');
    const webUrl = `${baseUrl}/?token=${token}&guild=${guild.id}`;

    // 4. Tạo Embed tinh gọn
    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: 'ANNA MUSIC', iconURL: client.user.displayAvatarURL() })
      .setTitle('Bảng Điều Khiển Web Player')
      .setDescription(
        `Nhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${guild.name}**.\n\n` +
        `🔊 **Kênh Voice:** <#${userVoice.id}>\n` +
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

    try {
      const replyMsg = await message.reply({ embeds: [embed], components: [row], flags: 4096 });
      // Tự động xóa tin nhắn bot và tin nhắn .web sau đúng 2 phút khi mã PIN hết hạn
      setTimeout(() => {
        replyMsg.delete().catch(() => {});
        if (message.deletable) message.delete().catch(() => {});
      }, 2 * 60 * 1000);
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
