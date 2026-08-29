const { createEmbed, EMOJI_TAG } = require('../utils/embed');

module.exports = {
  name: 'ping',
  aliases: ['latency', 'ms'],
  description: 'Kiểm tra độ trễ mạng của Bot tới Discord',
  async execute(message) {
    const sent = await message.reply('Đang đo độ trễ mạng...').catch(() => null);
    if (!sent) return;

    const roundtrip = sent.createdTimestamp - message.createdTimestamp;
    const wsLatency = Math.round(message.client.ws.ping);

    const embed = createEmbed(
      `${EMOJI_TAG.signal} Độ Trễ Kết Nối Mạng`,
      `• **Độ trễ phản hồi (Roundtrip):** \`${roundtrip}ms\`\n• **Độ trễ Discord WebSocket:** \`${wsLatency}ms\``,
      '#5865F2'
    );

    return sent.edit({ content: null, embeds: [embed] });
  }
};
