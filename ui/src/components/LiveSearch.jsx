import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Loader2,
  Play,
  Flame,
  Plus,
  Heart,
  Clock,
  Disc3,
  ListPlus,
  ListMusic,
  Sparkles,
  Globe,
  SlidersHorizontal
} from 'lucide-react';
import { API_BASE } from '../config';
import FavoritesModal from './FavoritesModal';
import PlaylistDetailModal from './PlaylistDetailModal';

// Helper nhận diện URL & Playlist
function detectUrlType(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  if (trimmed.includes('youtube.com/playlist') || (trimmed.includes('youtube.com/watch') && trimmed.includes('list='))) {
    return { type: 'youtube_playlist', label: 'YouTube Playlist', isPlaylist: true };
  }
  if (trimmed.includes('spotify.com/playlist/') || trimmed.includes('spotify.com/album/')) {
    return { type: 'spotify_playlist', label: 'Spotify Playlist / Album', isPlaylist: true };
  }
  if (trimmed.includes('spotify.com/track/')) {
    return { type: 'spotify_track', label: 'Spotify Track', isPlaylist: false };
  }
  if (trimmed.includes('soundcloud.com/') && (trimmed.includes('/sets/') || trimmed.includes('/sets'))) {
    return { type: 'soundcloud_playlist', label: 'SoundCloud Playlist', isPlaylist: true };
  }
  if (trimmed.includes('soundcloud.com/')) {
    return { type: 'soundcloud_track', label: 'SoundCloud Track', isPlaylist: false };
  }
  return { type: 'direct_url', label: 'Liên kết âm nhạc', isPlaylist: false };
}

function getPlaylistPreviewImage(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (match && match[1]) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  return null;
}

function getSourceLabel(track) {
  if (!track) return 'YouTube Music';
  const u = (track.url || '').toLowerCase();
  const s = (track.source || '').toLowerCase();
  if (s === 'soundcloud' || u.includes('soundcloud.com')) return 'SoundCloud';
  if (s === 'spotify' || u.includes('spotify.com')) return 'Spotify';
  if (s === 'youtube' || u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube Music';
  return track.artist || 'YouTube Music';
}

function getTrackThumb(track) {

  if (track?.thumbnail && !track.thumbnail.includes('yt3.ggpht.com') && !track.thumbnail.includes('default_user')) {
    return track.thumbnail;
  }
  if (track?.url) {
    const match = track.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) {
      return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
    }
  }
  return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120';
}

export default function LiveSearch({ onOrderSong, player, guildId, token }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(() => localStorage.getItem('anna_search_mode') || 'official');
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const debounceRef = useRef(null);

  const detected = useMemo(() => detectUrlType(query), [query]);

  const handleModeChange = (mode) => {
    setSearchMode(mode);
    localStorage.setItem('anna_search_mode', mode);
  };

  // Live Search Effect - lấy 20 kết quả theo mode với AbortController và debounce an toàn
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    if (detected?.isPlaylist) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const abortController = new AbortController();

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/search?q=${encodeURIComponent(trimmed)}&limit=20&mode=${searchMode}`,
          { signal: abortController.signal }
        );
        const data = await res.json();
        setLoading(false);
        if (data.success && data.results) {
          setResults(data.results);
        } else {
          setResults([]);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setLoading(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(debounceRef.current);
      abortController.abort();
    };
  }, [query, searchMode, detected?.isPlaylist]);

  const handleOrderTrack = (track) => {
    onOrderSong(track);
  };

  const handleAddPlaylistUrl = (pl) => {
    if (typeof pl === 'string') {
      onOrderSong({ url: pl, title: 'Danh Sách Phát', isPlaylist: true });
    } else if (pl && typeof pl === 'object') {
      onOrderSong({
        url: pl.url || query.trim(),
        title: pl.title || pl.name || 'Danh Sách Phát',
        itemCount: pl.itemCount || pl.trackCount || pl.tracksCount,
        isPlaylist: true
      });
    }
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      if (detected?.isPlaylist) {
        handleAddPlaylistUrl(query.trim());
      } else if (results.length > 0) {
        handleOrderTrack(results[0]);
      } else if (query.trim().startsWith('http')) {
        handleOrderTrack({ url: query.trim() });
        setQuery('');
      }
    }
  };

  const favorites = player?.favorites || [];
  const history = player?.history || [];
  const topTracks = player?.topTracks || [];
  const recentPlaylists = player?.recentPlaylists || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ── Search Input Box ──────────────────────────────── */}
      <div className="search-box">
        <Search size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tìm bài hát, ca sĩ, dán link YouTube / Spotify / Playlist..."
          autoFocus
        />

        {/* Nút Nâng Cao Lồng Trong Ô Nhập */}
        <button
          onClick={() => handleModeChange(searchMode === 'all' ? 'official' : 'all')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 9px',
            borderRadius: 7,
            border: searchMode === 'all' ? '1px solid rgba(232,201,119,0.5)' : '1px solid var(--border)',
            background: searchMode === 'all' ? 'rgba(232,201,119,0.15)' : 'var(--soft)',
            color: searchMode === 'all' ? 'var(--yellow)' : 'var(--muted)',
            boxShadow: searchMode === 'all' ? '0 0 10px rgba(232,201,119,0.18)' : 'none',
            fontSize: 9.5,
            fontWeight: searchMode === 'all' ? 700 : 500,
            fontFamily: '"DM Mono", monospace',
            letterSpacing: '0.04em',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all .2s cubic-bezier(0.4, 0, 0.2, 1)',
            marginRight: 4
          }}
          title={searchMode === 'all' ? 'Đang bật tìm kiếm nâng cao (Mở rộng Remix, Cover, Live...) — Nhấn để tắt' : 'Bật tìm kiếm nâng cao (Mở rộng Remix, Cover, Live...)'}
        >
          <SlidersHorizontal size={12} style={{ color: searchMode === 'all' ? 'var(--yellow)' : 'var(--muted)' }} />
          <span>NÂNG CAO</span>
        </button>

        {query ? (
          <button
            onClick={() => setQuery('')}
            style={{ border: 0, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 2 }}
            aria-label="Xóa tìm kiếm"
          >
            <X size={15} />
          </button>
        ) : (
          <span className="search-kbd">ENTER</span>
        )}
      </div>

      {/* ── Playlist Detection Banner ─────────────────────── */}
      {detected?.isPlaylist && (
        <div style={{
          margin: '-10px 0 18px',
          padding: '12px 16px',
          borderRadius: 14,
          background: 'rgba(232,201,119,0.06)',
          border: '1px solid rgba(232,201,119,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
              background: '#1c1e22', border: '1px solid var(--border)', display: 'grid', placeItems: 'center'
            }}>
              {getPlaylistPreviewImage(query) ? (
                <img src={getPlaylistPreviewImage(query)} alt="Playlist" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Disc3 size={20} style={{ color: 'var(--yellow)', animation: 'spin 8s linear infinite' }} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, fontWeight: 700, color: 'var(--yellow)', letterSpacing: '0.1em' }}>
                  {detected.label.toUpperCase()}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {query}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleAddPlaylistUrl(query.trim())}
            style={{
              height: 36, borderRadius: 9, padding: '0 14px',
              background: 'var(--yellow)', color: '#1c1e21',
              fontWeight: 700, fontSize: 12, border: 0,
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', flexShrink: 0
            }}
          >
            <ListPlus size={15} />
            <span>Thêm Playlist</span>
          </button>
        </div>
      )}

      {/* ── Main Scroll Area ──────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 2 }}>
        
        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 10, color: 'var(--muted)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--yellow)' }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, letterSpacing: '0.14em' }}>ĐANG TÌM KIẾM...</span>
          </div>
        )}

        {/* 1. Results List when Query is Typed */}
        {query.trim() && !detected?.isPlaylist && !loading && (
          <div>
            <div className="section-label">
              <span>KẾT QUẢ TÌM KIẾM ({results.length})</span>
              <span style={{ fontSize: 9 }}>NHẤN ĐỂ PHÁT</span>
            </div>

            {results.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                <p style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14, margin: '0 0 6px' }}>Không tìm thấy bài hát</p>
                <p style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>Hãy thử tìm bằng từ khóa khác hoặc dán trực tiếp đường dẫn YouTube / Spotify nhé!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {results.map((song, i) => {
                  const isPlaylist = song.isPlaylist || song.type === 'playlist';
                  return (
                    <div
                      key={song.id || song.url || i}
                      onClick={() => handleOrderTrack(song)}
                      className="song-row"
                      style={{ borderRadius: 10 }}
                    >
                      <div className="song-thumb">
                        <img src={getTrackThumb(song)} alt="" />
                      </div>
                      <div className="song-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="song-name" title={song.title}>{song.title}</span>
                          {isPlaylist && (
                            <span style={{
                              fontFamily: '"DM Mono", monospace', fontSize: 9, padding: '1px 6px', borderRadius: 4,
                              background: 'rgba(232,201,119,0.15)', color: 'var(--yellow)', border: '1px solid rgba(232,201,119,0.3)', flexShrink: 0
                            }}>
                              PLAYLIST
                            </span>
                          )}
                        </div>
                        <span className="song-sub" title={song.artist}>
                          {song.artist && song.artist !== 'Unknown' ? song.artist : getSourceLabel(song)}
                          {song.itemCount ? ` • ${song.itemCount} bài` : ''}
                        </span>
                      </div>
                      <span className="song-dur">{song.duration || ''}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOrderTrack(song); }}
                        style={{
                          width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--soft)', color: 'var(--ink)', display: 'grid', placeItems: 'center',
                          marginLeft: 6, flexShrink: 0, cursor: 'pointer'
                        }}
                        title="Thêm vào hàng chờ"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. Default Discover Landing when Query is Empty */}
        {!query.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            
            {/* Recently Played */}
            {history.length > 0 && (
              <div>
                <div className="section-label">
                  <span>NGHE GẦN ĐÂY</span>
                </div>
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, paddingTop: 4 }}>
                  {history.slice(0, 8).map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOrderTrack(item)}
                      style={{
                        width: 140, flexShrink: 0, cursor: 'pointer', padding: 10,
                        borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--border)',
                        transition: 'border-color .18s, transform .15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
                    >
                      <div style={{ width: '100%', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: '#202328', position: 'relative', marginBottom: 8 }}>
                        <img src={getTrackThumb(item)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <p title={item.title} style={{ margin: '0 0 3px', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </p>
                      <p title={item.artist} style={{ margin: 0, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.artist && item.artist !== 'Unknown' ? item.artist : getSourceLabel(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}



            {/* Playlists Gần Đây (Shows first track's thumbnail!) */}
            {recentPlaylists.length > 0 && (
              <div>
                <div className="section-label">
                  <span>PLAYLIST ĐÃ THÊM GẦN ĐÂY</span>
                  <span style={{ fontSize: 9 }}>NHẤN ĐỂ XEM CHI TIẾT & PHÁT</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                  {recentPlaylists.slice(0, 6).map((pl, idx) => {
                    const thumb = pl.thumbnail || getPlaylistPreviewImage(pl.url) || pl.firstTrackThumb;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedPlaylist(pl);
                          setIsPlaylistModalOpen(true);
                        }}
                        className="playlist-hover-card"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
                          background: 'var(--paper)', border: '1px solid var(--border)', cursor: 'pointer',
                          transition: 'border-color .18s, background .18s, transform .15s',
                          position: 'relative', overflow: 'hidden',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(232,201,119,0.6)';
                          e.currentTarget.style.background = 'rgba(232,201,119,0.06)';
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.querySelector('.pl-play-icon')?.style && (e.currentTarget.querySelector('.pl-play-icon').style.opacity = '1');
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.background = 'var(--paper)';
                          e.currentTarget.style.transform = 'none';
                          e.currentTarget.querySelector('.pl-play-icon')?.style && (e.currentTarget.querySelector('.pl-play-icon').style.opacity = '0');
                        }}
                        title="Xem toàn bộ bài hát trong playlist này"
                      >
                        <div style={{ width: 44, height: 44, borderRadius: 9, overflow: 'hidden', background: '#202328', display: 'grid', placeItems: 'center', flexShrink: 0, border: '1px solid var(--border)', position: 'relative' }}>
                          {thumb ? (
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <ListMusic size={20} style={{ color: 'var(--yellow)' }} />
                          )}
                          <div
                            className="pl-play-icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddPlaylistUrl(pl);
                            }}
                            title="Phát toàn bộ ngay lập tức"
                            style={{
                              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)',
                              display: 'grid', placeItems: 'center', opacity: 0,
                              transition: 'opacity .18s',
                            }}
                          >
                            <Play size={16} fill="var(--yellow)" style={{ color: 'var(--yellow)' }} />
                          </div>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p title={pl.title || pl.name} style={{ margin: 0, fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pl.title || pl.name || 'Danh Sách Phát'}
                          </p>
                          <p style={{ margin: '2px 0 0', fontFamily: '"DM Mono", monospace', fontSize: 9, color: 'var(--muted)' }}>
                            {pl.trackCount || pl.itemCount ? `${pl.trackCount || pl.itemCount} BÀI` : 'PLAYLIST'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddPlaylistUrl(pl);
                          }}
                          title="Phát toàn bộ ngay lập tức"
                          style={{
                            border: 0,
                            background: 'transparent',
                            padding: 4,
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                            color: 'var(--yellow)',
                            opacity: 0.75,
                            transition: 'opacity 0.15s, transform 0.15s'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.75'; e.currentTarget.style.transform = 'none'; }}
                        >
                          <Play size={14} fill="var(--yellow)" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Favorites */}
            {favorites.length > 0 && (
              <div>
                <div className="section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>BÀI HÁT YÊU THÍCH ({favorites.length})</span>
                    <Heart size={12} style={{ color: 'var(--coral)' }} />
                  </div>
                  <button
                    onClick={() => setIsFavoritesModalOpen(true)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: 'var(--yellow)',
                      fontSize: 10,
                      fontFamily: '"DM Mono", monospace',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    title="Mở toàn bộ danh sách yêu thích"
                  >
                    <span>XEM TẤT CẢ</span>
                    <span>↗</span>
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {favorites.slice(0, 4).map((fav, idx) => (
                    <button
                      key={idx}
                      className="song-row"
                      onClick={() => handleOrderTrack(fav)}
                      title={`Phát ${fav.title}`}
                    >
                      <div className="song-thumb">
                        <img src={getTrackThumb(fav)} alt="" />
                      </div>
                      <div className="song-info">
                        <span className="song-name" title={fav.title}>{fav.title}</span>
                        <span className="song-sub" title={fav.artist}>{fav.artist || 'YouTube'}</span>
                      </div>
                      <span className="song-dur">{fav.duration || ''}</span>
                    </button>
                  ))}
                </div>

                {favorites.length > 4 && (
                  <button
                    onClick={() => setIsFavoritesModalOpen(true)}
                    style={{
                      marginTop: 8,
                      width: '100%',
                      padding: '8px 0',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--soft)',
                      color: 'var(--yellow)',
                      fontSize: 11,
                      fontFamily: '"DM Mono", monospace',
                      letterSpacing: '0.06em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'border-color .15s, background .15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--yellow)';
                      e.currentTarget.style.background = 'rgba(232,201,119,0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.background = 'var(--soft)';
                    }}
                  >
                    <span>XEM TOÀN BỘ DANH SÁCH YÊU THÍCH ({favorites.length} BÀI)</span>
                    <span>↗</span>
                  </button>
                )}
              </div>
            )}

            {/* Top Tracks */}
            {topTracks.length > 0 && (
              <div>
                <div className="section-label">
                  <span>PHỔ BIẾN TRONG MÁY CHỦ</span>
                  <Flame size={12} style={{ color: 'var(--yellow)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {topTracks.slice(0, 8).map((top, idx) => (
                    <button
                      key={idx}
                      className="song-row"
                      onClick={() => handleOrderTrack(top)}
                      title={`Phát ${top.title}`}
                    >
                      <div className="song-thumb" style={{ position: 'relative', overflow: 'hidden' }}>
                        <img src={getTrackThumb(top)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {idx < 3 && (
                          <span style={{
                            position: 'absolute', bottom: 2, right: 3,
                            fontFamily: '"DM Mono", monospace', fontWeight: 800,
                            fontSize: 10, color: 'var(--yellow)',
                            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                            lineHeight: 1
                          }}>#{idx + 1}</span>
                        )}
                      </div>
                      <div className="song-info">
                        <span className="song-name" title={top.title}>{top.title}</span>
                        <span className="song-sub" title={top.artist}>{top.playCount ? `Đã phát ${top.playCount} lần` : (top.artist || '')}</span>
                      </div>
                      <span className="song-dur">{top.duration || ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* ── Modal Danh Sách Yêu Thích ───────────────────── */}
      <FavoritesModal
        isOpen={isFavoritesModalOpen}
        onClose={() => setIsFavoritesModalOpen(false)}
        favorites={favorites}
        onOrderSong={handleOrderTrack}
      />

      {/* ── Modal Chi Tiết Playlist ─────────────────────── */}
      <PlaylistDetailModal
        isOpen={isPlaylistModalOpen}
        onClose={() => {
          setIsPlaylistModalOpen(false);
          setSelectedPlaylist(null);
        }}
        playlist={selectedPlaylist}
        guildId={guildId || player?.guildId}
        token={token}
        onOrderSong={handleOrderTrack}
      />
    </div>
  );
}
