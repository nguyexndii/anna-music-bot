const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, EMOJI_TAG } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'ping',
  aliases: ['latency', 'ms'],
  description: 'Check bot network latency to Discord',
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot network latency to Discord')
    .setDescriptionLocalizations({
      vi: 'Kiểm tra độ trễ mạng của bot tới Discord'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const sent = await ctx.reply('Đang đo độ trễ mạng...');

    const start = ctx.isInteraction ? ctx.interaction.createdTimestamp : ctx.message.createdTimestamp;
    const end = sent?.createdTimestamp || Date.now();
    const roundtrip = Math.max(1, end - start);
    const wsLatency = Math.round(ctx.client.ws.ping);

    const embed = createEmbed(
      `${EMOJI_TAG.signal} Độ Trễ Kết Nối Mạng (Latency)`,
      `• **Độ trễ phản hồi (Roundtrip):** \`${roundtrip}ms\`\n• **Độ trễ Discord WebSocket:** \`${wsLatency}ms\``,
      '#5865F2'
    );

    return ctx.editReply({ content: null, embeds: [embed] });
  }
};
