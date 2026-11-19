const fetch = globalThis.fetch || require('node-fetch');
const spotifyUrlInfo = require('spotify-url-info')(fetch);

const DEFAULT_FALLBACK_THUMB = 'https://anna-music-bot-ui.pages.dev/default-playlist.jpg';

const SPOTIFY_URL_REGEX = /(?:open\.)?spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/i;
const SPOTIFY_URI_REGEX = /^spotify:(track|playlist|album):([a-zA-Z0-9]+)$/i;

/**
 * Chuẩn hóa URL Spotify: loại bỏ mã vùng /intl-vi/ hoặc /intl-[a-z-]+/
 * @param {string} url
 * @returns {string}
 */
function normalizeSpotifyUrl(url) {
  if (!url || typeof url !== 'string') return url;
  let clean = url.trim();
  clean = clean.replace(/spotify\.com\/intl-[a-z-]+\//i, 'spotify.com/');
  return clean;
}

/**
 * Phân tích URL hoặc URI Spotify thành đối tượng chứa type (track/playlist/album) và id
 * @param {string} url
 * @returns {{ type: 'track'|'playlist'|'album', id: string } | null}
 */
function parseSpotifyUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const uriMatch = url.match(SPOTIFY_URI_REGEX);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }
  const urlMatch = url.match(SPOTIFY_URL_REGEX);
  if (urlMatch) {
    return { type: urlMatch[1].toLowerCase(), id: urlMatch[2] };
  }
  return null;
}

/**
 * Phân tích và trích xuất metadata từ Spotify URL/URI (tên bài, nghệ sĩ, thời lượng, thumbnail)
 * @param {string} rawUrl
 * @returns {Promise<{ title: string, artist: string, durationSec: number, durationMs: number, thumbnail: string|null, url: string, type: string } | null>}
 */
async function parseSpotifyMetadata(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const parsed = parseSpotifyUrl(rawUrl);
  const normalizedUrl = normalizeSpotifyUrl(rawUrl);

  if (parsed?.type === 'track') {
    const trackId = parsed.id;
    let trackName = '';
    let artistName = '';
    let durationMs = 0;
    let thumbnail = null;

    // 1. Thử trích xuất qua spotify-url-info với URL đã chuẩn hóa (bỏ /intl-*)
    try {
      const data = await spotifyUrlInfo.getData(normalizedUrl);
      if (data && (data.name || data.title)) {
        trackName = (data.name || data.title || '').trim();
        artistName = data.artists?.map(a => a.name).join(', ') || data.artists?.[0]?.name || data.artist || '';
        durationMs = data.duration_ms || data.duration || 0;
        thumbnail = data.coverArt?.sources?.[0]?.url || null;
      }
    } catch (e) {}

    // 2. Fallback qua Spotify oEmbed
    if (!trackName && trackId) {
      try {
        const oRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
        if (oRes.ok) {
          const oData = await oRes.json();
          trackName = (oData.title || '').trim();
          artistName = (oData.author_name || '').trim();
          thumbnail = oData.thumbnail_url || null;
        }
      } catch (e) {}
    }

    // 3. Fallback qua Spotify Web API chính thức nếu có Token
    if (!trackName && trackId) {
      try {
        const token = await getSpotifyApiToken();
        if (token) {
          const apiRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            trackName = (apiData.name || '').trim();
            artistName = apiData.artists?.map(a => a.name).join(', ') || '';
            durationMs = apiData.duration_ms || 0;
            thumbnail = apiData.album?.images?.[0]?.url || null;
          }
        }
      } catch (e) {}
    }

    if (trackName) {
      const durationSec = durationMs ? Math.round(durationMs / 1000) : 0;
      return {
        type: 'track',
        id: trackId,
        title: trackName,
        artist: artistName,
        durationSec,
        durationMs,
        thumbnail,
        url: `https://open.spotify.com/track/${trackId}`
      };
    }
    return null;
  }

  return null;
}

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
  SPOTIFY_URL_REGEX,
  SPOTIFY_URI_REGEX,
  normalizeSpotifyUrl,
  parseSpotifyUrl,
  parseSpotifyMetadata,
  spotifyUrlInfo,
  getSpotifyApiToken,
  fetchSpotifyPlaylistFull,
  enrichSpotifyTracksWithThumbnails
};
