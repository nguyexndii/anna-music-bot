const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createContext } = require('../utils/commandHelper');
const settingsManager = require('../structures/SettingsManager');
const config = require('../config');
const FEEDBACK_CHANNEL_ID = config.feedbackChannelId;

module.exports = {
  name: 'feedback',
  aliases: ['fb', 'gopy', 'gop-y', 'report'],
  description: 'Send feedback, suggestions, or bug reports to developers',
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Send feedback, suggestions, or bug reports to developers')
    .setDescriptionLocalizations({
      vi: 'Gửi ý kiến đóng góp hoặc báo lỗi tới ban phát triển'
    })
    .addStringOption(opt =>
      opt
        .setName('message')
        .setDescription('Feedback message or bug report content')
        .setDescriptionLocalizations({
          vi: 'Nhập nội dung ý kiến đóng góp, phản hồi hoặc mô tả lỗi bạn gặp phải'
        })
        .setRequired(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const content = ctx.options.getString('message') || (args ? args.join(' ') : '');
    const isEn = ctx.guild?.id && settingsManager.get(ctx.guild.id)?.language === 'en';

    if (!content.trim()) {
      return ctx.reply(isEn
        ? 'Please enter feedback or suggestions!\nExample: `/feedback great sound quality!`'
        : 'Vui lòng nhập nội dung phản hồi hoặc góp ý!\nVí dụ: `/feedback bot phát nhạc rất hay!`');
    }

    try {
      const feedbackChannel = await ctx.client.channels.fetch(FEEDBACK_CHANNEL_ID).catch(() => null);

      if (!feedbackChannel) {
        console.warn(`[Feedback] Không tìm thấy kênh gửi feedback ID: ${FEEDBACK_CHANNEL_ID}`);
        return ctx.reply(isEn ? 'Thank you! Your feedback has been recorded.' : 'Cảm ơn bạn! Ý kiến đóng góp của bạn đã được ghi nhận.');
      }

      const embed = new EmbedBuilder()
        .setTitle(isEn ? '📬 New Feedback / Bug Report' : '📬 Ý Kiến Phản Hồi / Báo Lỗi Mới')
        .setColor('#5865F2')
        .addFields(
          { name: isEn ? 'Sender' : 'Người gửi', value: `${ctx.user.tag} (\`${ctx.user.id}\`)`, inline: true },
          { name: isEn ? 'Server' : 'Máy chủ', value: `${ctx.guild?.name || 'DM'} (\`${ctx.guild?.id || 'N/A'}\`)`, inline: true },
          { name: isEn ? 'Channel' : 'Kênh gửi', value: `<#${ctx.channel.id}>`, inline: true },
          { name: isEn ? 'Feedback Content' : 'Nội dung phản hồi', value: `\`\`\`${content.replace(/```/g, "'''").slice(0, 1000)}\`\`\``, inline: false }
        )
        .setThumbnail(ctx.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await feedbackChannel.send({ embeds: [embed] });
      return ctx.reply(isEn
        ? 'Thank you! Your feedback has been sent directly to the development team.'
        : 'Cảm ơn bạn! Ý kiến đóng góp của bạn đã được chuyển thẳng tới ban phát triển.');
    } catch (err) {
      console.error('[Feedback Error]:', err);
      return ctx.reply(isEn
        ? 'An error occurred while sending feedback, please try again later!'
        : 'Đã xảy ra lỗi khi gửi phản hồi, vui lòng thử lại sau!');
    }
  }
};
