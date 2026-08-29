const { EmbedBuilder } = require('discord.js');

const FEEDBACK_CHANNEL_ID = '1543117987148603473';

module.exports = {
  name: 'feedback',
  aliases: ['fb', 'gopy', 'gop-y', 'report'],
  description: 'Gửi ý kiến đóng góp, phản hồi hoặc báo lỗi tới ban phát triển',
  async execute(message, args) {
    if (args.length === 0) {
      return message.reply('Vui lòng nhập nội dung phản hồi hoặc góp ý!\nVí dụ: .feedback bot phát nhạc rất hay!');
    }

    const content = args.join(' ');

    try {
      const feedbackChannel = await message.client.channels.fetch(FEEDBACK_CHANNEL_ID).catch(() => null);

      if (!feedbackChannel) {
        console.warn(`[Feedback] Không tìm thấy kênh gửi feedback ID: ${FEEDBACK_CHANNEL_ID}`);
        return message.reply('Cảm ơn bạn! Ý kiến đóng góp của bạn đã được ghi nhận.');
      }

      const embed = new EmbedBuilder()
        .setTitle('📬 Ý Kiến Phản Hồi / Báo Lỗi Mới')
        .setColor('#5865F2')
        .addFields(
          { name: 'Người gửi', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
          { name: 'Máy chủ', value: `${message.guild?.name || 'DM'} (\`${message.guild?.id || 'N/A'}\`)`, inline: true },
          { name: 'Kênh gửi', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Nội dung phản hồi', value: `\`\`\`${content.slice(0, 1000)}\`\`\``, inline: false }
        )
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await feedbackChannel.send({ embeds: [embed] });
      return message.reply('Cảm ơn bạn! Ý kiến đóng góp của bạn đã được chuyển thẳng tới ban phát triển.');
    } catch (err) {
      console.error('[Feedback Error]:', err);
      return message.reply('Đã xảy ra lỗi khi gửi phản hồi, vui lòng thử lại sau!');
    }
  }
};
