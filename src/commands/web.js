const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { generateWebToken } = require('../utils/tokenHelper');
const { createErrorEmbed } = require('../utils/embed');
const { isAllowedVoiceChannel } = require('../utils/permissionHelper');
const settingsManager = require('../structures/SettingsManager');
const { createContext } = require('../utils/commandHelper');
const config = require('../config');

module.exports = {
  name: 'web',
  description: 'Open Web Player music controller interface and get PIN',
  data: new SlashCommandBuilder()
    .setName('web')
    .setDescription('Open Web Player music controller interface and get PIN')
    .setDescriptionLocalizations({
      vi: 'Mở giao diện Web Player điều khiển âm nhạc và lấy mã PIN kết nối'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const client = ctx.client;
    const guild = ctx.guild;
    const member = ctx.member;
    const author = ctx.user;

    // 1. Kiểm tra User có trong kênh Voice hay không
    const userVoice = member?.voice?.channel;
    if (!userVoice) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed('Bạn cần tham gia vào một kênh Voice để sử dụng Web Player!')]
      }, 7000);
    }

    // 2. Kiểm tra kênh Voice bị khóa
    const guildSettings = settingsManager.get(guild.id);
    if (guildSettings.lockedVoiceChannelId && !isAllowedVoiceChannel(member)) {
      return ctx.sendTemp({
        embeds: [createErrorEmbed(`Máy chủ đã khóa kênh Voice! Vui lòng vào kênh <#${guildSettings.lockedVoiceChannelId}> để dùng Web Player.`)]
      }, 7000);
    }

    // 3. Tạo User data và Magic Token (kèm PIN 6 số hiệu lực 3 phút, session 2 giờ)
    const isAdmin = member?.permissions?.has('Administrator') || member?.permissions?.has('ManageGuild') || guild.ownerId === author.id;
    const avatarUrl = author.displayAvatarURL({ dynamic: true, size: 256 });
    const userData = {
      userId: author.id,
      username: author.username,
      displayName: member?.displayName || author.globalName || author.username,
      avatar: avatarUrl,
      guildId: guild.id,
      guildName: guild.name,
      isAdmin: Boolean(isAdmin)
    };

    const { token, pin } = generateWebToken(userData, 3, 2);
    const baseUrl = (config.webUrl || 'https://anna-music-bot-ui.pages.dev');
    const webUrl = `${baseUrl}/?token=${token}&guild=${guild.id}`;

    // 4. Tạo Embed tinh gọn
    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: 'ANNA MUSIC', iconURL: client.user.displayAvatarURL() })
      .setTitle('Bảng Điều Khiển Web Player')
      .setDescription(
        `Nhấn nút bên dưới để mở giao diện điều khiển nhạc cho máy chủ **${guild.name}**.\n\n` +
        `🔊 **Kênh Voice:** <#${userVoice.id}>\n` +
        `🔑 **Mã PIN:** \`${pin}\` *(dùng 1 lần)*`
      )
      .setFooter({ text: 'Mã dùng 1 lần sẽ tự hủy sau khi mở • Hết hạn sau 3 phút' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Mở Web Player')
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl)
        .setEmoji('🌐')
    );

    try {
      const replyFlags = ctx.isInteraction ? 64 : 4096;
      const replyMsg = await ctx.reply({ embeds: [embed], components: [row], flags: replyFlags });
      // Tự động vô hiệu hóa mã PIN sau 3 phút (vì Discord API không cho phép bot xóa tin nhắn ẩn)
      setTimeout(async () => {
        try {
          if (ctx.isInteraction && ctx.interaction) {
            const expiredEmbed = new EmbedBuilder()
              .setColor('#ef7864')
              .setAuthor({ name: 'ANNA MUSIC', iconURL: client.user.displayAvatarURL() })
              .setTitle('⚠️ Mã PIN Web Player Đã Hết Hạn')
              .setDescription(
                'Mã PIN và liên kết đăng nhập đã tự hủy sau **3 phút** vì lý do bảo mật.\n\n' +
                'Nếu bạn muốn mở lại Web Player, vui lòng gõ lại lệnh `/web` để nhận mã mới nhé!'
              )
              .setFooter({ text: 'Bạn có thể bấm "Bỏ qua tin nhắn" bên dưới để đóng thông báo này' });

            await ctx.interaction.editReply({ embeds: [expiredEmbed], components: [] }).catch(() => {});
          } else if (replyMsg && typeof replyMsg.delete === 'function') {
            await replyMsg.delete().catch(() => {});
          }
        } catch (e) {}
      }, 180 * 1000);
    } catch (err) {
      console.error('[Web Command Error]:', err);
    }
  }
};
