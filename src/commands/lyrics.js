const musicManager = require('../structures/MusicManager');
const { fetchLyrics } = require('../utils/lyricsHelper');
const { getSongLyrics } = require('../utils/geminiHelper');
const { createEmbed, createErrorEmbed } = require('../utils/embed');

module.exports = {
  name: 'lyrics',
  aliases: ['ly', 'lyric', 'loibaihat', 'loi'],
  description: 'Hiển thị lời bài hát (Lyrics) chuẩn xác từ Spotify/Musixmatch',
  async execute(message, args) {
    const queue = musicManager.get(message.guild.id);
    let targetTitle = '';
    let targetArtist = '';

    if (args.length > 0) {
      targetTitle = args.join(' ');
    } else if (queue && queue.currentSong && queue.currentSong.requestedBy !== 'Auto (24/7)') {
      targetTitle = queue.currentSong.title;
      targetArtist = queue.currentSong.author || '';
    } else {
      return message.reply('Vui lòng nhập tên bài hát hoặc đang phát một bài hát để xem lời!\nVí dụ: `.lyrics có em madihu`');
    }

    const searchingMsg = await message.reply({
      embeds: [createEmbed('📜 Đang tìm lời bài hát...', `Đang tra cứu lời bài hát cho **${targetTitle}**...`)]
    }).catch(() => null);

    try {
      // Tìm kiếm lời bài hát chuẩn xác 100% từ Spotify / Musixmatch
      const result = await fetchLyrics(targetTitle, targetArtist);

      if (!result || !result.lyrics || result.lyrics.trim().length === 0) {
        const notFoundEmbed = createErrorEmbed(`Không tìm thấy lời bài hát cho **${targetTitle}**!\nHãy thử nhập đầy đủ tên bài hát kèm tên ca sĩ (vd: \`.ly Có Em Madihu\`).`);
        if (searchingMsg) {
          return searchingMsg.edit({ embeds: [notFoundEmbed] });
        } else {
          return message.reply({ embeds: [notFoundEmbed] });
        }
      }

      let lyricsText = result.lyrics.trim();
      if (lyricsText.length > 4000) {
        lyricsText = lyricsText.slice(0, 3950) + '\n\n*... (Lời bài hát quá dài đã được rút gọn)*';
      }

      const lyricsEmbed = createEmbed(
        `📜 ${result.title} — ${result.artist}`,
        lyricsText,
        '#5865F2'
      )
      .setFooter({ text: `Anna Music 24/7 • ${message.guild.name}` });

      if (searchingMsg) {
        await searchingMsg.edit({ embeds: [lyricsEmbed] });
      } else {
        await message.reply({ embeds: [lyricsEmbed] });
      }
    } catch (err) {
      console.error('[Lyrics Command Error]:', err);
      if (searchingMsg) {
        await searchingMsg.edit({ embeds: [createErrorEmbed(`Đã xảy ra lỗi khi tìm lời bài hát: ${err.message}`)] }).catch(() => {});
      }
    }
  }
};
