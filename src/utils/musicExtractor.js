// Tự động vá lỗi thư viện yt-search (tránh lỗi title.trim() undefined khi YouTube trả về playlist/mix không có tiêu đề)
try {
  const fs = require('fs');
  const path = require('path');
  const ytSearchDist = path.join(__dirname, '../../node_modules/yt-search/dist/yt-search.js');
  if (fs.existsSync(ytSearchDist)) {
    let code = fs.readFileSync(ytSearchDist, 'utf8');
    let changed = false;
    if (code.includes('title: title.trim()')) {
      code = code.replace(/title:\s*title\.trim\(\)/g, 'title: (typeof title === "string" ? title.trim() : "")');
      changed = true;
    }
    if (code.includes('_title.trim()')) {
      code = code.replace(/_title\.trim\(\)/g, '(_title || "").trim()');
      code = code.replace(/_title2\.trim\(\)/g, '(_title2 || "").trim()');
      code = code.replace(/_title3\.trim\(\)/g, '(_title3 || "").trim()');
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(ytSearchDist, code, 'utf8');
    }
  }
} catch (e) {}

const ytdlp = require('yt-dlp-exec');
const play = require('play-dl');
const yts = require('yt-search');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const fetch = globalThis.fetch || require('node-fetch');
const spotifyUrlInfo = require('spotify-url-info')(fetch);

// Đường dẫn file cookies YouTube (Netscape format). Cài trong .env: YTDLP_COOKIES_FILE=/root/anna-music-bot/youtube.cookies
// File này giúp yt-dlp xác thực để bypass kiểm tra bot của YouTube trên Datacenter IP
const YTDLP_COOKIES_FILE = process.env.YTDLP_COOKIES_FILE || null;


/**
 * Định dạng mili-giây sang MM:SS
 */
function formatMs(ms) {
  if (!ms || isNaN(ms)) return '3:30';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Trích xuất ảnh thumbnail chất lượng cao và chuẩn xác nhất cho bài hát YouTube/Web
 */
function resolveBestThumbnail(entry, fallbackId = null) {
  if (!entry && !fallbackId) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300';
  
  const id = (typeof entry === 'object' ? entry?.id : null) || fallbackId || (typeof entry?.url === 'string' ? entry.url.match(/(?:v=|\/vi\/|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] : null);
  
  // 1. Nếu có YouTube Video ID hợp lệ -> Luôn ưu tiên ảnh hqdefault.jpg chuẩn theo video
  if (id && typeof id === 'string' && id.length === 11) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  // 2. Nếu có mảng thumbnails trong metadata
  if (entry && Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0) {
    const validThumbs = entry.thumbnails.filter(t => t?.url && !t.url.includes('yt3.ggpht.com') && !t.url.includes('default_user') && !t.url.includes('avatar'));
    if (validThumbs.length > 0) {
      const sorted = [...validThumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
      return sorted[0]?.url || validThumbs[validThumbs.length - 1]?.url;
    }
  }

  if (entry?.thumbnail && typeof entry.thumbnail === 'string' && !entry.thumbnail.includes('yt3.ggpht.com') && !entry.thumbnail.includes('default_user')) {
    return entry.thumbnail;
  }

  return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300';
}

/**
 * Tách tên nghệ sĩ và tên bài hát từ tiêu đề
 */
function parseArtistAndTitle(rawTitle) {
  let artist = '';
  let songName = rawTitle || '';

  if (rawTitle.includes('-')) {
    const parts = rawTitle.split('-');
    artist = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    songName = parts.slice(1).join('-').replace(/\[.*?\]|\(.*?\)/g, '').trim();
  } else if (rawTitle.includes('|')) {
    const parts = rawTitle.split('|');
    songName = parts[0].replace(/\[.*?\]|\(.*?\)/g, '').trim();
    artist = parts.slice(1).join(' ').replace(/\[.*?\]|\(.*?\)/g, '').trim();
  } else {
    songName = rawTitle.replace(/\[.*?\]|\(.*?\)/g, '').trim();
  }

  const cleanSong = songName.replace(/official|music|video|audio|lyrics|mv|hd|4k|m\/v/gi, '').trim();
  return { artist, songName: cleanSong, rawSongName: songName };
}

let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyApiToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`
      },
      body: 'grant_type=client_credentials'
    });

    if (res.ok) {
      const data = await res.json();
      spotifyTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000
      };
      return spotifyTokenCache.token;
    }
  } catch (e) {
    console.warn('[Spotify Token Error]:', e.message);
  }
  return null;
}

async function fetchSpotifyPlaylistFull(playlistId) {
  const token = await getSpotifyApiToken();
  if (!token) return null;

  const tracks = [];
  let offset = 0;
  const limit = 100;

  while (offset < 2000) {
    try {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.items || data.items.length === 0) break;

      for (const item of data.items) {
        if (item.track && item.track.name) {
          const artistName = item.track.artists ? item.track.artists.map(a => a.name).join(', ') : '';
          const title = artistName ? `${item.track.name} - ${artistName}` : item.track.name;
          tracks.push({
            title: title,
            url: null,
            searchQuery: `${title}`,
            duration: formatMs(item.track.duration_ms),
            thumbnail: item.track.album?.images?.[0]?.url || null,
            isLive: false
          });
        }
      }

      if (tracks.length >= (data.total || 0) || !data.next) break;
      offset += limit;
    } catch (err) {
      console.warn('[Spotify Playlist Page Error]:', err.message);
      break;
    }
  }

  return tracks.length > 0 ? tracks : null;
}

/**
 * Tìm kiếm và trích xuất thông tin bài hát / Playlist từ YouTube, Spotify, SoundCloud
 * (Tối đa 100 bài đối với Playlist)
 */
async function searchTrack(query) {
  try {
    // 1. Xử lý Playlist / Album Spotify (Giới hạn tối đa 100 bài)
    if (query.includes('spotify.com/playlist/') || query.includes('spotify.com/album/')) {
      try {
        const spotifyTracks = await spotifyUrlInfo.getTracks(query);
        if (spotifyTracks && spotifyTracks.length > 0) {
          const limited = spotifyTracks.slice(0, 100);
          return limited.map(item => {
            const artistName = item.artist || item.artists?.[0]?.name || '';
            const title = artistName ? `${item.name} - ${artistName}` : item.name;
            return {
              title: title,
              url: null,
              searchQuery: `${title}`,
              duration: formatMs(item.duration),
              thumbnail: item.coverArt?.sources?.[0]?.url || null,
              isLive: false
            };
          });
        }
      } catch (spErr) {
        console.warn('[Spotify Playlist extraction error]:', spErr.message);
      }
    }

    // 2. Xử lý Single Track Spotify
    if (query.includes('spotify.com/track/')) {
      try {
        const trackData = await spotifyUrlInfo.getData(query);
        if (trackData && trackData.name) {
          const artistName = trackData.artists?.[0]?.name || trackData.artist || '';
          const title = artistName ? `${trackData.name} - ${artistName}` : trackData.name;
          const results = await searchTrack(title);
          if (results && results.length > 0) {
            return results;
          }
        }
      } catch (spTrackErr) {
        console.warn('[Spotify Track extraction error]:', spTrackErr.message);
      }
    }

    // 3. Xử lý Playlist YouTube (Giới hạn tối đa 100 bài)
    if (query.includes('youtube.com/playlist') || (query.includes('youtube.com/watch') && query.includes('list='))) {
      try {
        const res = await ytdlp(query, {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
          yesPlaylist: true,
          noWarnings: true
        });

        if (res && res.entries && res.entries.length > 0) {
          const limited = res.entries.slice(0, 100);
          return limited.map(e => {
            const trackUrl = e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
            return {
              title: e.title,
              url: trackUrl,
              searchQuery: e.title,
              duration: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '3:30',
              thumbnail: resolveBestThumbnail(e),
              isLive: false
            };
          });
        }
      } catch (ytErr) {
        console.warn('[YouTube Playlist extraction error]:', ytErr.message);
      }
    }

let soundCloudClientId = null;
async function ensureSoundCloudAuth() {
  if (soundCloudClientId) return soundCloudClientId;
  try {
    soundCloudClientId = await play.getFreeClientID();
    if (soundCloudClientId) {
      await play.setToken({ soundcloud: { client_id: soundCloudClientId } });
    }
  } catch (e) {
    console.warn('[SoundCloud Auth Warning]:', e.message);
  }
  return soundCloudClientId;
}

function extractSoundCloudTitleFromUrl(url) {
  if (!url) return 'SoundCloud Track';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const slug = parts[parts.length - 1];
      return slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  } catch (e) {}
  return 'SoundCloud Track';
}

    // 4. Xử lý SoundCloud (Cả bài hát đơn và Playlist / Album - Giới hạn 100 bài)
    if (query.includes('soundcloud.com')) {
      try {
        await ensureSoundCloudAuth();
        const scData = await play.soundcloud(query);

        if (scData && scData.type === 'playlist') {
          const allTracks = await scData.all_tracks();
          const limited = allTracks.slice(0, 100);
          return limited.map(track => ({
            title: track.name || 'SoundCloud Track',
            url: track.permalink || track.url || query,
            duration: track.durationInMs ? formatMs(track.durationInMs) : '3:30',
            thumbnail: track.thumbnail || null,
            isLive: false
          }));
        }

        if (scData && scData.name) {
          return [{
            title: scData.name,
            url: scData.permalink || scData.url || query,
            duration: scData.durationInMs ? formatMs(scData.durationInMs) : '3:30',
            thumbnail: scData.thumbnail || null,
            isLive: false
          }];
        }
      } catch (scErr) {
        console.warn('[SoundCloud play-dl error, falling back to yt-dlp]:', scErr.message);
      }

      // Fallback
      try {
        const info = await ytdlp(query, {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
          noWarnings: true
        });

        if (info.entries && Array.isArray(info.entries) && info.entries.length > 0) {
          const limited = info.entries.slice(0, 100);
          return limited.map(item => {
            let trackTitle = item.title || item.name;
            if (!trackTitle || trackTitle === 'SoundCloud Track') {
              trackTitle = extractSoundCloudTitleFromUrl(item.url || item.webpage_url);
            }
            return {
              title: trackTitle,
              url: item.url || item.webpage_url || query,
              duration: item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '3:30',
              thumbnail: item.thumbnail || info.thumbnail || null,
              isLive: false
            };
          });
        }

        let singleTitle = info.title;
        if (!singleTitle || singleTitle === 'SoundCloud Track') {
          singleTitle = extractSoundCloudTitleFromUrl(info.webpage_url || query);
        }

        return [{
          title: singleTitle,
          url: info.webpage_url || query,
          duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}` : '3:30',
          thumbnail: info.thumbnail || null,
          isLive: false
        }];
      } catch (ytdlpErr) {
        console.warn('[SoundCloud yt-dlp error]:', ytdlpErr.message);
      }
    }

    // 5. Xử lý đường dẫn Direct HTTP/HTTPS (File audio hoặc Livestream)
    if (query.startsWith('http://') || query.startsWith('https://')) {
      try {
        const info = await ytdlp(query, {
          dumpSingleJson: true,
          noWarnings: true,
          callHome: false,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true
        });
        return [{
          title: info.title || 'Audio Stream',
          url: info.webpage_url || query,
          duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : 'Live Stream',
          thumbnail: info.thumbnail || null,
          isLive: Boolean(info.is_live)
        }];
      } catch (err) {
        console.warn('[yt-dlp info error, fallback to direct stream]:', err.message);
        return [{
          title: 'Direct Audio Stream',
          url: query,
          duration: 'Live Stream',
          thumbnail: null,
          isLive: true
        }];
      }
    }

    // 6. Tìm kiếm YouTube cho từ khóa (Tự động ưu tiên bản Audio / Lyric Video chuẩn nhịp nếu user không ghi rõ 'mv')
    try {
      const userWantsRemix = /\b(remix|mix|mashup|vinahouse|cover|speed\s*up|slowed|nightcore|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi)\b/i.test(query);
      const isExplicitMv = /\bmv\b|\bvideo\b|\bm\/v\b/i.test(query);
      const r = await yts(query);
      if (r && r.videos && r.videos.length > 0) {
        let candidateVideos = r.videos;
        if (!userWantsRemix) {
          const cleanFiltered = candidateVideos.filter(v => {
            const t = (v.title || '').toLowerCase();
            if (v.seconds > 600) return false;
            return !/\b(remix|mashup|vinahouse|bass\s*boosted|speed\s*up|slowed|nightcore|cover|parody|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi\s*ver|tiktok)/i.test(t);
          });
          if (cleanFiltered.length > 0) {
            candidateVideos = cleanFiltered;
          }
        }

        const topVideos = candidateVideos.slice(0, 6);
        let best = topVideos[0];
        if (!isExplicitMv && topVideos.length > 1) {
          const audioCandidate = topVideos.find(t => {
            const title = (t.title || '').toLowerCase();
            return (title.includes('audio') || title.includes('lyric') || title.includes('topic')) && !title.includes('teaser') && !title.includes('trailer');
          });
          if (audioCandidate) {
            best = audioCandidate;
          }
        }
        return [{
          title: best.title,
          url: best.url,
          duration: best.timestamp || (best.seconds ? `${Math.floor(best.seconds / 60)}:${String(best.seconds % 60).padStart(2, '0')}` : '3:30'),
          thumbnail: best.thumbnail || `https://i.ytimg.com/vi/${best.videoId}/hqdefault.jpg`,
          artist: best.author?.name || 'YouTube',
          isLive: Boolean(best.live)
        }];
      }
    } catch (ytsErr) {
      console.warn('[searchTrack yt-search error, fallback play-dl]:', ytsErr.message);
    }

    // Fallback qua play-dl nếu yt-search lỗi
    try {
      const searchResults = await play.search(query, { limit: 1, source: { youtube: 'video' } });
      if (searchResults && searchResults.length > 0) {
        const track = searchResults[0];
        return [{
          title: track.title,
          url: track.url,
          duration: track.durationRaw || '3:30',
          thumbnail: resolveBestThumbnail(track),
          artist: track.channel?.name || 'YouTube',
          isLive: Boolean(track.live)
        }];
      }
    } catch (pErr) {}

    // Fallback: yt-dlp search nếu play-dl gặp lỗi
    try {
      const res = await ytdlp(`ytsearch3:${query}`, {
        dumpSingleJson: true,
        noWarnings: true,
        flatPlaylist: true
      });

      if (res && res.entries && res.entries.length > 0) {
        const bestEntry = res.entries[0];
        const url = bestEntry.url || `https://www.youtube.com/watch?v=${bestEntry.id}`;
        return [{
          title: bestEntry.title,
          url: url,
          duration: bestEntry.duration ? `${Math.floor(bestEntry.duration / 60)}:${String(bestEntry.duration % 60).padStart(2, '0')}` : '3:30',
          thumbnail: resolveBestThumbnail(bestEntry),
          artist: bestEntry.uploader || bestEntry.channel || 'YouTube',
          isLive: false
        }];
      }
    } catch (ytErr) {
      console.warn('[yt-dlp keyword search fallback error]:', ytErr.message);
    }

    return null;
  } catch (error) {
    console.error('Error in searchTrack:', error);
    return null;
  }
}

/**
 * Lớp 1 (Ưu tiên cao nhất): Lấy bài tương tự từ YouTube Mix (RD<videoId>)
 */
async function getYoutubeMix(lastSong, playedUrls = []) {
  if (!lastSong || !lastSong.url) return null;

  try {
    const match = lastSong.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (!match || !match[1]) return null;

    const videoId = match[1];
    const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

    const res = await ytdlp(mixUrl, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      playlistEnd: 15
    });

    if (res && res.entries && res.entries.length > 0) {
      for (const entry of res.entries) {
        if (!entry || !entry.title) continue;

        const trackUrl = entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
        if (!trackUrl) continue;

        if (trackUrl === lastSong.url || playedUrls.includes(trackUrl)) {
          continue;
        }

        return {
          title: entry.title,
          url: trackUrl,
          duration: entry.duration ? `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}` : '3:30',
          thumbnail: entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null),
          isLive: false,
          requestedBy: 'Auto'
        };
      }
    }
  } catch (err) {
    console.warn('[Autoplay YouTube Mix Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 2 (Fallback thứ 2): Lấy bài tương tự từ Last.fm Similar Track API
 */
async function getLastfmSimilar(lastSong, playedUrls = []) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey || !lastSong || !lastSong.title) return null;

  try {
    const { artist, songName } = parseArtistAndTitle(lastSong.title);
    if (!artist || !songName) return null;

    const apiUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(songName)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=10`;
    const response = await fetch(apiUrl);
    if (!response.ok) return null;

    const data = await response.json();
    const tracks = data?.similartracks?.track;
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return null;

    for (const simTrack of tracks) {
      const trackName = simTrack.name;
      const trackArtist = typeof simTrack.artist === 'string' ? simTrack.artist : (simTrack.artist?.name || '');
      const fullQuery = `${trackName} ${trackArtist}`.trim();

      // Bỏ qua nếu bài hát đã có trong lịch sử phát
      if (playedUrls.some(u => typeof u === 'string' && u.toLowerCase().includes(trackName.toLowerCase()))) {
        continue;
      }

      const results = await searchTrack(fullQuery);
      if (results && results.length > 0) {
        const found = results[0];
        if (found.url && !playedUrls.includes(found.url) && found.url !== lastSong.url) {
          return {
            title: found.title,
            url: found.url,
            duration: found.duration || '3:30',
            thumbnail: found.thumbnail || null,
            isLive: false,
            requestedBy: 'Auto'
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Autoplay Last.fm Warning]:', err.message);
  }
  return null;
}

/**
 * Lớp 3 (Fallback cuối cùng): Logic Heuristic nhận diện thể loại / ca sĩ và lọc từ khóa rác
 */
async function getHeuristicRelatedTrack(lastSong, playedUrls = []) {
  if (!lastSong || !lastSong.title) return null;

  try {
    const rawTitle = lastSong.title;
    const lowerTitle = rawTitle.toLowerCase();
    const isOriginalRemix = /remix|vinahey|house|edm/i.test(rawTitle);

    const { artist, songName } = parseArtistAndTitle(rawTitle);
    const cleanSong = songName;

    const isVintageOrBolero = /bolero|nhạc vàng|trịnh|khánh ly|quang dũng|tuấn ngọc|ngọc lan|lệ quyên|nhạc xưa|trữ tình|tiền chiến|chế linh|như quỳnh|hương lan|thanh tuyền|quang lê|duy khánh|phạm duy/i.test(lowerTitle);
    const isIndieOrChill = /vũ|thịnh suy|chillies|ngọt|đinh dũng|trang|marzuz|hoàng dũng|fishy|greyd|kai đinh|mr siro|acoustic|chill|lofi|ballad|buồn/i.test(lowerTitle);

    const searchQueries = [];

    if (artist && artist.length > 1) {
      if (isVintageOrBolero) {
        searchQueries.push(`ytsearch8:${artist} nhạc trữ tình xưa hay nhất`);
        searchQueries.push(`ytsearch8:${artist} official audio`);
      } else if (isIndieOrChill) {
        searchQueries.push(`ytsearch8:${artist} bài hát hay nhất`);
        searchQueries.push(`ytsearch8:${artist} official acoustic`);
      } else {
        searchQueries.push(`ytsearch8:${artist} official audio`);
        searchQueries.push(`ytsearch8:${artist} greatest hits`);
      }
    }

    if (isVintageOrBolero) {
      searchQueries.push(`ytsearch8:${cleanSong} nhạc vàng xưa tuyển chọn`);
    } else if (isIndieOrChill) {
      searchQueries.push(`ytsearch8:${cleanSong} indie acoustic chill`);
      searchQueries.push(`ytsearch8:${cleanSong} acoustic official`);
    } else {
      searchQueries.push(`ytsearch8:${cleanSong} ${artist} official`);
      searchQueries.push(`ytsearch8:${cleanSong} official audio`);
    }

    const junkPattern = /(remix|vinahey|house|edm|bassboost|1 hour|1h|karaoke|beat chuẩn|beat karaoke|instrumental|reaction|parody|speed up|slowed|nightcore|tập \d+|liên khúc|nonstop|dj|tiktok mashup|quẩy|playlist)/i;

    for (const query of searchQueries) {
      try {
        const res = await ytdlp(query, {
          dumpSingleJson: true,
          noWarnings: true,
          flatPlaylist: true
        });

        if (res && res.entries && res.entries.length > 0) {
          for (const entry of res.entries) {
            if (!entry || !entry.title) continue;

            const trackUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

            if (trackUrl === lastSong.url || playedUrls.includes(trackUrl)) continue;

            if (!isOriginalRemix && junkPattern.test(entry.title)) {
              continue;
            }

            if (entry.duration && (entry.duration > 600 || entry.duration < 60)) {
              continue;
            }

            return {
              title: entry.title,
              url: trackUrl,
              duration: entry.duration ? `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}` : '3:30',
              thumbnail: entry.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
              isLive: false,
              requestedBy: 'Auto'
            };
          }
        }
      } catch (qErr) {
        console.warn(`[Autoplay search failed for query: ${query}]:`, qErr.message);
      }
    }
  } catch (err) {
    console.error('[getHeuristicRelatedTrack Error]:', err.message);
  }
  return null;
}

const { getGeminiRecommendation } = require('./geminiHelper');

const historyManager = require('../structures/HistoryManager');

/**
 * Thuật toán Autoplay Điều Phối Đa Lớp Thông Minh (Chống lặp lại 20 bài gần nhất):
 * 0. Gemini DJ AI (Khi BẬT trong Cài đặt)
 * 1. YouTube Mix (Ưu tiên cao)
 * 2. Last.fm Similar Track (Fallback thứ 2)
 * 3. Heuristic Fallback (Fallback cuối cùng)
 */
async function getRelatedTrack(lastSong, guildIdOrHistory = [], useAi = true) {
  if (!lastSong || !lastSong.title) return null;

  const guildId = typeof guildIdOrHistory === 'string' ? guildIdOrHistory : null;
  const playedList = Array.isArray(guildIdOrHistory) ? guildIdOrHistory : (guildId ? historyManager.getHistory(guildId) : []);

  // 0. Lớp 0 (Siêu ưu tiên nếu bật Trí tuệ nhân tạo): Gemini DJ AI
  if (useAi) {
    try {
      const aiRec = await getGeminiRecommendation(lastSong.title, playedList);
      if (aiRec && (aiRec.searchQuery || aiRec.title)) {
        const query = aiRec.searchQuery || `${aiRec.title} ${aiRec.artist || ''}`.trim();
        const results = await searchTrack(query);
        if (results && results.length > 0) {
          const found = results[0];
          const isRepeat = guildId ? historyManager.isRecentlyPlayed(guildId, found, 20) : playedList.some(p => typeof p === 'string' ? p === found.url : (p.url === found.url || p.title === found.title));

          if (found.url && !isRepeat && found.url !== lastSong.url) {
            console.log(`[Autoplay] Found via Gemini DJ AI: ${found.title} (${aiRec.reason || ''})`);
            found.requestedBy = 'Auto';
            return found;
          }
        }
      }
    } catch (aiErr) {
      console.warn('[Autoplay Gemini AI Warning]:', aiErr.message);
    }
  }

  // 1. Lớp 1: YouTube Mix (Ưu tiên cao)
  const ytMixTrack = await getYoutubeMix(lastSong, playedList);
  if (ytMixTrack) {
    console.log('[Autoplay] Found via YouTube Mix');
    return ytMixTrack;
  }

  // 2. Lớp 2: Last.fm Similar Track (Fallback thứ 2)
  const lastfmTrack = await getLastfmSimilar(lastSong, playedList);
  if (lastfmTrack) {
    console.log('[Autoplay] Found via Last.fm');
    return lastfmTrack;
  }

  // 3. Lớp 3: Heuristic Fallback (Fallback cuối cùng)
  const heuristicTrack = await getHeuristicRelatedTrack(lastSong, playedList);
  if (heuristicTrack) {
    console.log('[Autoplay] Found via heuristic fallback');
    return heuristicTrack;
  }

  return null;
}

// Bộ quản lý tiến trình con (FFmpeg & yt-dlp) để chống tràn / rò rỉ RAM (Zombie processes)
const activeProcesses = new Set();

function registerProcess(proc) {
  if (!proc) return;
  activeProcesses.add(proc);
  const cleanup = () => {
    activeProcesses.delete(proc);
  };
  proc.on('exit', cleanup);
  proc.on('close', cleanup);
  proc.on('error', cleanup);
}

function killProcess(proc) {
  if (!proc) return;
  activeProcesses.delete(proc);
  try {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  } catch (e) {}
}

function cleanupAllProcesses() {
  for (const proc of activeProcesses) {
    killProcess(proc);
  }
}

// Tự động dọn dẹp tiến trình con khi Node.js process thoát
process.on('exit', cleanupAllProcesses);
process.on('SIGINT', () => { cleanupAllProcesses(); process.exit(); });
process.on('SIGTERM', () => { cleanupAllProcesses(); process.exit(); });

/**
 * Tạo một luồng phát đơn qua yt-dlp & FFmpeg với cơ chế kiểm tra gói dữ liệu đầu tiên (First-Chunk Confirmation)
 * Nếu YouTube bị chặn bot (ra 0 byte / code 183), hàm sẽ reject ngay lập tức để kích hoạt cơ chế Failover.
 */
function createSingleStream(targetQueryOrUrl, crossfadeSeconds = 0, seekSeconds = 0, isSoundCloud = false) {
  return new Promise((resolve, reject) => {
    const ytdlpOptions = {
      output: '-',
      format: 'bestaudio/best',
      ffmpegLocation: ffmpeg,
      noPlaylist: true,
      noWarnings: true
    };

    if (!isSoundCloud) {
      ytdlpOptions.extractorArgs = 'youtube:player_client=android';
      ytdlpOptions.preferFreeFormats = true;
      if (YTDLP_COOKIES_FILE) {
        ytdlpOptions.cookies = YTDLP_COOKIES_FILE;
      }
    }

    let ytdlpStreamProcess = null;
    try {
      ytdlpStreamProcess = ytdlp.exec(targetQueryOrUrl, ytdlpOptions);
      if (ytdlpStreamProcess) registerProcess(ytdlpStreamProcess);
    } catch (err) {
      return reject(err);
    }

    if (!ytdlpStreamProcess || !ytdlpStreamProcess.stdout) {
      return reject(new Error(`Không thể khởi chạy yt-dlp cho: ${targetQueryOrUrl}`));
    }

    const ffmpegArgs = [];
    if (seekSeconds && Number(seekSeconds) > 0) {
      ffmpegArgs.push('-ss', String(Math.floor(Number(seekSeconds))));
    }

    ffmpegArgs.push(
      '-i', 'pipe:0',
      '-vn'
    );

    if (crossfadeSeconds && Number(crossfadeSeconds) > 0) {
      const fadeSec = Math.min(1.5, Number(crossfadeSeconds));
      ffmpegArgs.push('-af', `afade=t=in:ss=0:d=${fadeSec}`);
    }

    ffmpegArgs.push(
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'ogg',
      'pipe:1'
    );

    const ffmpegProcess = spawn(ffmpeg || 'ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    registerProcess(ffmpegProcess);

    let ffmpegStderr = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
      if (ffmpegStderr.length > 4000) ffmpegStderr = ffmpegStderr.slice(-2000);
    });

    let ytdlpStderr = '';
    ytdlpStreamProcess.stderr.on('data', (chunk) => {
      ytdlpStderr += chunk.toString();
      if (ytdlpStderr.length > 4000) ytdlpStderr = ytdlpStderr.slice(-2000);
    });

    ffmpegProcess.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[FFmpeg stdin Error]:', err.message);
      }
    });

    ytdlpStreamProcess.stdout.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.warn('[yt-dlp stdout Error]:', err.message);
      }
    });

    ytdlpStreamProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[yt-dlp Process Error]:', err.message);
      }
    });

    ffmpegProcess.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.error('[FFmpeg Process Error]:', err.message);
      }
    });

    ytdlpStreamProcess.stdout.pipe(ffmpegProcess.stdin);

    let firstChunkReceived = false;
    const passThroughStream = new PassThrough();
    ffmpegProcess.stdout.pipe(passThroughStream);

    // Timeout bảo vệ: Nếu sau 7 giây không có dữ liệu âm thanh nào, tự hủy để failover
    const safetyTimeout = setTimeout(() => {
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        reject(new Error('Quá thời gian chờ âm thanh từ nguồn này (Timeout 7s)'));
      }
    }, 7000);

    // Khi nhận được gói âm thanh đầu tiên: Xác nhận luồng chạy tốt 100%!
    ffmpegProcess.stdout.once('data', () => {
      firstChunkReceived = true;
      clearTimeout(safetyTimeout);

      const resource = createAudioResource(passThroughStream, {
        inputType: StreamType.OggOpus,
        inlineVolume: true
      });

      resource.destroy = () => {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
      };

      resolve(resource);
    });

    ffmpegProcess.on('close', (code) => {
      clearTimeout(safetyTimeout);
      if (!firstChunkReceived) {
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
        const lastErr = (ytdlpStderr || ffmpegStderr).slice(-200).trim();
        reject(new Error(`FFmpeg exited with code ${code}: ${lastErr}`));
      } else {
        if (code !== 0 && code !== null) {
          const lastErr = (ffmpegStderr || ytdlpStderr).slice(-200).trim();
          if (lastErr) console.warn(`[FFmpeg exited code ${code}]:`, lastErr);
        }
        try { ytdlpStreamProcess.stdout.unpipe(ffmpegProcess.stdin); } catch (e) {}
        killProcess(ffmpegProcess);
        killProcess(ytdlpStreamProcess);
      }
    });
  });
}

/**
 * Tạo Discord AudioResource với kiến trúc Failover Tự Động 2 Tầng Siêu Bền Vững:
 * Tầng 1: YouTube (Direct android client)
 * Tầng 2: SoundCloud Fallback (Bypass 100% mọi cơ chế chặn bot / IP Datacenter, phát nhạc 24/7)
 */
async function createResource(trackItem, crossfadeSeconds = 0, seekSeconds = 0) {
  let targetUrl = typeof trackItem === 'string' ? trackItem : (trackItem.url || trackItem.searchQuery);
  const trackTitle = typeof trackItem === 'object' ? (trackItem.title || trackItem.searchQuery) : trackItem;

  // Nếu track chưa có direct URL (từ playlist Spotify): tìm kiếm URL YouTube trước
  if (!targetUrl || (!targetUrl.startsWith('http') && trackItem.searchQuery)) {
    try {
      const searchRes = await searchTrack(trackItem.searchQuery);
      if (searchRes && searchRes.length > 0 && searchRes[0].url) {
        targetUrl = searchRes[0].url;
        trackItem.url = targetUrl;
      }
    } catch (e) {
      console.warn('[Resolve track URL failed]:', e.message);
    }
  }

  // TẦNG 1: Thử phát từ YouTube
  try {
    return await createSingleStream(targetUrl, crossfadeSeconds, seekSeconds, false);
  } catch (ytErr) {
    const errMsg = ytErr.message.split('\n')[0];
    console.warn(`[YouTube Stream Blocked/Failed for "${trackTitle}"]: ${errMsg}`);

    // TẦNG 2 (FAILOVER TỰ ĐỘNG): Chuyển ngay lập tức sang nguồn SoundCloud
    // SoundCloud KHÔNG BAO GIỜ chặn IP Datacenter của VPS, không cần cookies, phát ngay lập tức
    console.log(`[Failover] Đang tự động chuyển sang phát "${trackTitle}" từ SoundCloud dự phòng...`);
    const cleanSearch = (trackTitle || targetUrl)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\[.*?\]|【.*?】|\(.*?\)/g, ' ')
      .replace(/(?:official\s*music\s*video|official\s*video|official\s*audio|official\s*mv|lyric\s*video|visualizer\s*video|video\s*lyric|music\s*video|visualizer|audio|lyrics?|mv\s*official|official|full\s*hd|4k|1080p)/gi, ' ')
      .replace(/[-|:/\\–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const scQuery = `scsearch1:${cleanSearch || 'lofi hip hop'}`;
    try {
      return await createSingleStream(scQuery, crossfadeSeconds, seekSeconds, true);
    } catch (scErr) {
      console.error(`[SoundCloud Fallback Failed for "${trackTitle}"]:`, scErr.message);
      throw new Error(`Không thể phát bài hát "${trackTitle}": Cả nguồn YouTube và SoundCloud đều không khả dụng.`);
    }
  }
}

/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web
 */
/**
 * Tìm kiếm danh sách nhiều bài hát phục vụ Live Search trên Web (Siêu tốc độ)
 */
async function searchMultipleTracks(query, limit = 20, mode = 'official') {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  query = query.trim();

  if (query.startsWith('http')) {
    const directRes = await searchTrack(query);
    return directRes || [];
  }

  // Helper chạy tác vụ với timeout an toàn, tránh treo Node.js Event Loop
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Search timeout (${ms}ms)`)), ms))
  ]);

  // 1. Ưu tiên cao nhất: yt-search (Lấy cả Playlists/Albums và Videos đầy đủ)
  try {
    const isPlaylistQuery = /\balbum\b|\bplaylist\b|\btuyển tập\b|\bdanh sách phát\b/i.test(query);
    const r = await withTimeout(yts(query), 4000);
    if (r) {
      const playlistResults = (r.playlists || []).slice(0, isPlaylistQuery ? 8 : 4).map(p => ({
        title: p.title,
        url: p.url,
        duration: p.videoCount ? `${p.videoCount} bài` : 'Playlist',
        thumbnail: p.thumbnail || `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120`,
        artist: p.author?.name || 'YouTube Playlist',
        isPlaylist: true,
        itemCount: p.videoCount,
        isLive: false
      }));

      let rawVideos = r.videos || [];
      const userWantsRemix = /\b(remix|mix|mashup|vinahouse|cover|speed\s*up|slowed|nightcore|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi)\b/i.test(query);

      if (mode === 'official' && !userWantsRemix) {
        const remixPattern = /\b(remix|mashup|vinahouse|bass\s*boosted|speed\s*up|slowed|nightcore|cover|parody|karaoke|beat|liên\s*khúc|nonstop|dj\b|lofi\s*ver|tiktok)/i;
        const cleanOfficialVideos = rawVideos.filter(v => {
          const title = (v.title || '').toLowerCase();
          if (v.seconds > 600) return false; // Loại bỏ video dài > 10 phút (1 hour mix, compilation)
          if (remixPattern.test(title)) return false; // Lọc sạch remix, cover, vinahouse, v.v.
          return true;
        });

        // Nếu có các bản thu chuẩn, chỉ hiển thị bản thu chuẩn
        if (cleanOfficialVideos.length >= 2) {
          rawVideos = cleanOfficialVideos;
        } else if (cleanOfficialVideos.length > 0) {
          // Đưa các bản thu chuẩn lên đầu danh sách
          const cleanIds = new Set(cleanOfficialVideos.map(v => v.videoId));
          rawVideos = [...cleanOfficialVideos, ...rawVideos.filter(v => !cleanIds.has(v.videoId))];
        }

        const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        rawVideos = rawVideos.map(v => {
          let score = 0;
          const title = (v.title || '').toLowerCase();
          const author = (v.author?.name || '').toLowerCase();

          // Khớp từ khóa tìm kiếm
          const matchedWords = qWords.filter(w => title.includes(w) || author.includes(w));
          score += (matchedWords.length / Math.max(1, qWords.length)) * 100;

          // Điểm cộng kênh chính chủ và bản thu chuẩn
          if (author.includes('topic') || author.includes('official') || author.includes('records') || author.includes('vevo')) score += 40;
          // Ưu tiên mạnh bản audio
          if (title.includes('official audio') || title.includes('(audio)') || title.includes('audio version')) score += 50;
          if (title.includes('audio') || title.includes('bản thu')) score += 25;
          if (title.includes('lyric video') || title.includes('lyrics')) score += 15;

          // Phạt nhẹ MV nếu đã có bản audio (để bản audio/bản thu chuẩn xếp trên MV)
          if (title.includes('official music video') || title.includes('official mv') || title.includes('official video') || title.includes('(mv)') || title.includes('[mv]')) {
            score -= 10;
          }

          return { ...v, score };
        }).sort((a, b) => b.score - a.score);
      }

      const videoResults = rawVideos.map(v => ({
        title: v.title,
        url: v.url,
        duration: v.timestamp || (v.seconds ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}` : '3:30'),
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        artist: v.author?.name || 'YouTube',
        isPlaylist: false,
        isLive: Boolean(v.live)
      }));

      // Nếu từ khóa chứa 'album' hoặc 'playlist' -> Ưu tiên playlist lên đầu!
      const combined = isPlaylistQuery
        ? [...playlistResults, ...videoResults]
        : (playlistResults.length > 0 ? [playlistResults[0], ...videoResults, ...playlistResults.slice(1)] : videoResults);

      if (combined.length > 0) {
        return combined.slice(0, Math.min(limit, 25));
      }
    }
  } catch (ytsErr) {
    console.warn('[searchMultipleTracks yt-search notice]:', ytsErr.message);
  }

  // 2. Fallback nhẹ qua play-dl (không spawn process nặng)
  try {
    const searchResults = await withTimeout(
      play.search(query, { limit: Math.min(limit, 15), source: { youtube: 'video' } }),
      3000
    );
    if (searchResults && searchResults.length > 0) {
      return searchResults.map(track => ({
        title: track.title,
        url: track.url,
        duration: track.durationRaw || '3:30',
        thumbnail: resolveBestThumbnail(track),
        artist: track.channel?.name || 'YouTube',
        isLive: Boolean(track.live)
      }));
    }
  } catch (err) {}

  // 3. Fallback an toàn qua yt-dlp nếu cả yt-search và play-dl đều không trả về kết quả
  try {
    const ytRes = await withTimeout(
      ytdlp(`ytsearch${Math.min(limit, 15)}:${query}`, {
        dumpSingleJson: true,
        noWarnings: true,
        flatPlaylist: true
      }),
      4500
    );
    if (ytRes && ytRes.entries && Array.isArray(ytRes.entries) && ytRes.entries.length > 0) {
      return ytRes.entries.map(e => ({
        title: e.title,
        url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
        duration: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '3:30',
        thumbnail: resolveBestThumbnail(e),
        artist: e.uploader || e.channel || 'YouTube',
        isLive: false
      })).filter(t => t.url);
    }
  } catch (ytErr) {
    console.warn('[searchMultipleTracks yt-dlp fallback notice]:', ytErr.message);
  }

  return [];
}

module.exports = {
  searchTrack,
  searchMultipleTracks,
  getYoutubeMix,
  getLastfmSimilar,
  getHeuristicRelatedTrack,
  getRelatedTrack,
  createResource
};
