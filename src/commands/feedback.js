const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createContext } = require('../utils/commandHelper');

const FEEDBACK_CHANNEL_ID = '1543117987148603473';

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
          vi: 'Nội dung góp ý hoặc báo lỗi'
        })
        .setRequired(true)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const content = ctx.options.getString('message') || (args ? args.join(' ') : '');

    if (!content.trim()) {
      return ctx.reply('Vui lòng nhập nội dung phản hồi hoặc góp ý!\nVí dụ: `/feedback bot phát nhạc rất hay!`');
    }

    try {
      const feedbackChannel = await ctx.client.channels.fetch(FEEDBACK_CHANNEL_ID).catch(() => null);

      if (!feedbackChannel) {
        console.warn(`[Feedback] Không tìm thấy kênh gửi feedback ID: ${FEEDBACK_CHANNEL_ID}`);
        return ctx.reply('Cảm ơn bạn! Ý kiến đóng góp của bạn đã được ghi nhận.');
      }

      const embed = new EmbedBuilder()
        .setTitle('📬 Ý Kiến Phản Hồi / Báo Lỗi Mới')
        .setColor('#5865F2')
        .addFields(
          { name: 'Người gửi', value: `${ctx.user.tag} (\`${ctx.user.id}\`)`, inline: true },
          { name: 'Máy chủ', value: `${ctx.guild?.name || 'DM'} (\`${ctx.guild?.id || 'N/A'}\`)`, inline: true },
          { name: 'Kênh gửi', value: `<#${ctx.channel.id}>`, inline: true },
          { name: 'Nội dung phản hồi', value: `\`\`\`${content.slice(0, 1000)}\`\`\``, inline: false }
        )
        .setThumbnail(ctx.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await feedbackChannel.send({ embeds: [embed] });
      return ctx.reply('Cảm ơn bạn! Ý kiến đóng góp của bạn đã được chuyển thẳng tới ban phát triển.');
    } catch (err) {
      console.error('[Feedback Error]:', err);
      return ctx.reply('Đã xảy ra lỗi khi gửi phản hồi, vui lòng thử lại sau!');
    }
  }
};
