const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { fetchLyrics } = require('../utils/lyricsHelper');
const { createEmbed, createErrorEmbed, parseDurationToMs, EMOJI_TAG } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');
const { t } = require('../utils/i18n');

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
        .setName('song')
        .setDescription('Song title to search lyrics for (leave empty for current song)')
        .setDescriptionLocalizations({
          vi: 'Tên bài hát cần tra cứu lời (để trống để xem bài đang phát)'
        })
        .setRequired(false)
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildId = ctx.guild.id;
    const isEn = settingsManager.get(guildId)?.language === 'en';

    const queue = musicManager.get(guildId);
    let targetTitle = '';
    let targetArtist = '';
    let targetDurationMs = 0;
    let targetUrl = null;

    const queryInput = ctx.options.getString('song') || ctx.options.getString('query');
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
      const prompt = isEn
        ? 'Please enter a song name or play a song to view lyrics!\nExample: `/lyrics stay the kid laroi`'
        : 'Vui lòng nhập tên bài hát hoặc đang phát một bài hát để xem lời!\nVí dụ: `/lyrics có em madihu`';
      return ctx.reply({ content: prompt, flags: 64 });
    }

    if (targetArtist === 'YouTube Music' || targetArtist === 'YouTube' || targetArtist === 'Unknown') {
      targetArtist = '';
    }

    await ctx.deferReply();

    try {
      const layers = settingsManager.get(guildId).lyricsLayers;
      const result = await fetchLyrics(targetTitle, targetArtist, targetDurationMs, targetUrl, layers);

      if (!result || !result.lyrics) {
        return ctx.editReply({
          embeds: [createErrorEmbed(t(guildId, 'commands.lyrics_not_found', { title: targetTitle }))]
        });
      }

      let lyricsText = result.lyrics.trim();
      const truncatedNotice = isEn ? '\n\n*... (Lyrics truncated)*' : '\n\n*... (Lời bài hát đã được rút gọn)*';
      if (lyricsText.length > 3900) {
        lyricsText = lyricsText.slice(0, 3900) + truncatedNotice;
      }

      const lyricsTitle = isEn
        ? `${EMOJI_TAG.lyrics} Lyrics • ${result.title || targetTitle}`
        : `${EMOJI_TAG.lyrics} Lời Bài Hát • ${result.title || targetTitle}`;

      const embed = createEmbed(
        lyricsTitle,
        lyricsText
      );

      return ctx.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Lỗi khi tra cứu lyrics:', err);
      return ctx.editReply({
        embeds: [createErrorEmbed(t(guildId, 'commands.lyrics_not_found', { title: targetTitle }))]
      });
    }
  }
};
