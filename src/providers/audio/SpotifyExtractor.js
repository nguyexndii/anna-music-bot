const fetch = globalThis.fetch || require('node-fetch');
const spotifyUrlInfo = require('spotify-url-info')(fetch);

const DEFAULT_FALLBACK_THUMB = 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';

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
          const spotifyUrl = item.track.external_urls?.spotify || (item.track.id ? `https://open.spotify.com/track/${item.track.id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`);
          tracks.push({
            title: title,
            url: spotifyUrl,
            searchQuery: `${title}`,
            duration: formatMs(item.track.duration_ms),
            thumbnail: item.track.album?.images?.[0]?.url || DEFAULT_FALLBACK_THUMB,
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

async function enrichSpotifyTracksWithThumbnails(tracks, defaultCover) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks;

  // 1. Gán thumbnail mặc định là ảnh bìa Playlist/Album trước để không bao giờ bị null
  for (const t of tracks) {
    if (!t.thumbnail && defaultCover) {
      t.thumbnail = defaultCover;
    }
  }

  const enrichBatch = async (batch) => {
    await Promise.allSettled(batch.map(async item => {
      if (!item.uri) return;
      const trackId = item.uri.replace('spotify:track:', '').split('?')[0];
      if (!trackId) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, {
          signal: controller.signal
        });
        if (res.ok) {
          const d = await res.json();
          if (d.thumbnail_url) {
            item.thumbnail = d.thumbnail_url;
          }
        }
      } catch (err) {
        // Giữ fallback defaultCover đã được gán sẵn
      } finally {
        clearTimeout(timeout);
      }
    }));
  };

  // 2. Tải trước 5 bài đầu tiên (~100-200ms) để phản hồi API siêu nhanh mà không nghẽn Event Loop
  const firstBatch = tracks.slice(0, 5);
  await enrichBatch(firstBatch);

  // 3. Tải tiếp các bài còn lại ở background để không làm nghẽn API (mỗi đợt 25 bài)
  const remaining = tracks.slice(5);
  if (remaining.length > 0) {
    (async () => {
      const batchSize = 25;
      for (let i = 0; i < remaining.length; i += batchSize) {
        await enrichBatch(remaining.slice(i, i + batchSize));
      }
    })().catch(() => {});
  }

  return tracks;
}

module.exports = {
  formatMs,
  DEFAULT_FALLBACK_THUMB,
  spotifyUrlInfo,
  getSpotifyApiToken,
  fetchSpotifyPlaylistFull,
  enrichSpotifyTracksWithThumbnails
};
