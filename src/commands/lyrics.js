const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const { fetchLyrics } = require('../utils/lyricsHelper');
const { createEmbed, createErrorEmbed, parseDurationToMs } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: 'lyrics',
  aliases: ['ly', 'lyric', 'loibaihat', 'loi'],
  description: 'Display synchronized song lyrics from Spotify/Musixmatch',
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Display synchronized song lyrics from Spotify/Musixmatch')
    .setDescriptionLocalizations({
      vi: 'Hiển thị lời bài hát (Lyrics) chuẩn xác từ Spotify/Musixmatch'
    })
    .addStringOption(opt =>
      opt
        .setName('query')
        .setDescription('Song title to search lyrics for')
        .setDescriptionLocalizations({
          vi: 'Tên bài hát cần tra cứu lời'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const queue = musicManager.get(ctx.guild.id);
    let targetTitle = '';
    let targetArtist = '';
    let targetDurationMs = 0;
    let targetUrl = null;

    const queryInput = ctx.options.getString('query');
    if (queryInput) {
      targetTitle = queryInput.trim();
    } else if (args && args.length > 0) {
      targetTitle = args.join(' ');
    } else if (queue && queue.currentSong) {
      targetTitle = queue.currentSong.title;
      targetArtist = queue.currentSong.author || queue.currentSong.artist || '';
      targetDurationMs = queue.currentSong.durationMs || (queue.currentSong.duration ? parseDurationToMs(queue.currentSong.duration) : 0);
      targetUrl = queue.currentSong.url || null;
    } else {
      return ctx.reply('Vui lòng nhập tên bài hát hoặc đang phát một bài hát để xem lời!\nVí dụ: `/lyrics có em madihu`');
    }

    if (targetArtist === 'YouTube Music' || targetArtist === 'YouTube' || targetArtist === 'Unknown') {
      targetArtist = '';
    }

    await ctx.deferReply();

    try {
      const result = await fetchLyrics(targetTitle, targetArtist, targetDurationMs, targetUrl);

      if (!result || !result.lyrics || result.lyrics.trim().length === 0) {
        const notFoundEmbed = createErrorEmbed(`Không tìm thấy lời bài hát cho **${targetTitle}**!\nHãy thử nhập đầy đủ tên bài hát kèm tên ca sĩ (vd: \`/lyrics Có Em Madihu\`).`);
        return ctx.editReply({ embeds: [notFoundEmbed] });
      }

      let lyricsText = result.lyrics.trim();
      if (lyricsText.length > 4000) {
        lyricsText = lyricsText.slice(0, 3950) + '\n\n*... (Lời bài hát quá dài đã được rút gọn)*';
      }

      const lyricsEmbed = createEmbed(
        `📜 ${result.title} — ${result.artist}`,
        lyricsText,
        '#5865F2'
      ).setFooter({ text: `Anna Music 24/7 • ${ctx.guild.name}` });

      return ctx.editReply({ embeds: [lyricsEmbed] });
    } catch (err) {
      console.error('[Lyrics Command Error]:', err);
      return ctx.editReply({ embeds: [createErrorEmbed(`Đã xảy ra lỗi khi tìm lời bài hát: ${err.message}`)] });
    }
  }
};
