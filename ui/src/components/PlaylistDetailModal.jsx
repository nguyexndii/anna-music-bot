import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { X, Play, Plus, ListPlus, ChevronLeft, ChevronRight, Loader2, Music, Search, Check } from 'lucide-react';
import { API_BASE } from '../config';

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

export default function PlaylistDetailModal({
  isOpen,
  onClose,
  playlist,
  guildId,
  token,
  onOrderSong
}) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [addedTracks, setAddedTracks] = useState(new Set());

  // Fetch / load playlist tracks
  useEffect(() => {
    if (!isOpen || !playlist) return;

    setFilterQuery('');
    setError(null);
    setAddedTracks(new Set());

    // Neu playlist object da co san tracks
    if (Array.isArray(playlist.tracks) && playlist.tracks.length > 0) {
      setTracks(playlist.tracks);
      setLoading(false);
      return;
    }

    // Nguoc lai fetch tu API
    if (playlist.url && guildId) {
      let isMounted = true;
      setLoading(true);

      const targetUrl = `${API_BASE}/api/guilds/${guildId}/playlist-info?url=${encodeURIComponent(playlist.url)}`;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      fetch(targetUrl, { headers })
        .then((res) => res.json())
        .then((data) => {
          if (!isMounted) return;
          if (data.success && data.playlist?.tracks) {
            setTracks(data.playlist.tracks);
          } else {
            setError(data.error || 'Không thể tải chi tiết danh sách phát');
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('[PlaylistDetailModal Error]:', err);
          setError('Lỗi kết nối máy chủ khi tải danh sách phát');
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      return () => {
        isMounted = false;
      };
    }
  }, [isOpen, playlist, guildId, token]);

  // Handle ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filtered tracks
  const filteredTracks = useMemo(() => {
    if (!filterQuery.trim()) return tracks;
    const q = filterQuery.trim().toLowerCase();
    return tracks.filter(
      (t) =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q))
    );
  }, [tracks, filterQuery]);

  // Actions
  const handlePlayAll = () => {
    if (!playlist) return;
    onOrderSong?.({
      url: playlist.url,
      title: playlist.title || playlist.name || 'Danh Sách Phát',
      isPlaylist: true,
      itemCount: tracks.length || playlist.trackCount || playlist.itemCount
    });
    onClose?.();
  };

  const handleAddSingleTrack = (track, e) => {
    e?.stopPropagation();
    if (!track) return;
    const key = track.url || track.title;
    setAddedTracks((prev) => new Set([...prev, key]));
    onOrderSong?.(track);
  };

  if (!isOpen || !playlist) return null;

  const displayTitle = playlist.title || playlist.name || 'Danh Sách Phát';
  const totalCount = tracks.length || playlist.trackCount || playlist.itemCount || 0;
  const thumb = playlist.thumbnail || (tracks[0] && getTrackThumb(tracks[0])) || null;

  return ReactDOM.createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.18s ease-out'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '88vh',
          borderRadius: 20,
          background: 'var(--paper)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: 'rgba(255, 255, 255, 0.015)',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                overflow: 'hidden',
                flexShrink: 0,
                background: '#1d2024',
                border: '1px solid var(--border)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              {thumb ? (
                <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Music size={20} style={{ color: 'var(--yellow)' }} />
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--ink)',
                    letterSpacing: '-0.01em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={displayTitle}
                >
                  {displayTitle}
                </h3>
                {totalCount > 0 && (
                  <span
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 6,
                      background: 'rgba(232, 201, 119, 0.12)',
                      color: 'var(--yellow)',
                      border: '1px solid rgba(232, 201, 119, 0.25)',
                      flexShrink: 0
                    }}
                  >
                    {totalCount} BÀI
                  </span>
                )}
              </div>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontFamily: '"DM Mono", monospace'
                }}
              >
                Nhấn bài để thêm lẻ, hoặc phát toàn bộ
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={handlePlayAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(232, 201, 119, 0.4)',
                background: 'rgba(232, 201, 119, 0.15)',
                color: 'var(--yellow)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              title="Thêm toàn bộ bài hát trong danh sách vào hàng chờ"
            >
              <ListPlus size={14} />
              <span>Phát cả bộ</span>
            </button>

            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--soft)',
                color: 'var(--muted)',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s'
              }}
              aria-label="Đóng"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search inside playlist */}
        {tracks.length > 5 && (
          <div
            style={{
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(0, 0, 0, 0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Search size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={`Lọc trong ${tracks.length} bài hát...`}
              style={{
                flex: 1,
                border: 0,
                background: 'transparent',
                color: 'var(--ink)',
                fontSize: 12,
                outline: 'none'
              }}
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  padding: 2
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* Body: Tracks List (Scroll toàn bộ danh sách mượt mà) */}
        <div
          style={{
            padding: '12px 20px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: '62vh'
          }}
        >
          {loading ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 16px',
                color: 'var(--muted)',
                gap: 12
              }}
            >
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--yellow)' }} />
              <span style={{ fontSize: 12.5 }}>Đang tải danh sách bài hát từ playlist...</span>
            </div>
          ) : error ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 16px',
                textAlign: 'center',
                gap: 12
              }}
            >
              <p style={{ margin: 0, color: 'var(--coral)', fontSize: 13 }}>{error}</p>
              <button
                onClick={handlePlayAll}
                className="primary-button"
                style={{ height: 34, padding: '0 16px', fontSize: 12 }}
              >
                Phát toàn bộ bằng liên kết
              </button>
            </div>
          ) : tracks.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 16px',
                color: 'var(--muted)',
                fontSize: 13
              }}
            >
              Không tìm thấy bài hát nào trong playlist.
            </div>
          ) : (
            filteredTracks.map((song, idx) => {
              const globalIndex = idx + 1;
              const isAdded = addedTracks.has(song.url || song.title);

              return (
                <div
                  key={song.url || idx}
                  onClick={(e) => handleAddSingleTrack(song, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: 'var(--soft)',
                    border: '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s, transform 0.12s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(232, 201, 119, 0.4)';
                    e.currentTarget.style.background = 'rgba(232, 201, 119, 0.05)';
                    e.currentTarget.style.transform = 'translateX(2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.background = 'var(--soft)';
                    e.currentTarget.style.transform = 'none';
                  }}
                  title="Nhấn để thêm bài này vào hàng chờ"
                >
                  <span
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 11,
                      color: 'var(--muted)',
                      width: 24,
                      textAlign: 'right',
                      flexShrink: 0
                    }}
                  >
                    #{globalIndex}
                  </span>

                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: '#22252a',
                      position: 'relative'
                    }}
                  >
                    <img
                      src={getTrackThumb(song)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={song.title}
                    >
                      {song.title}
                    </p>
                    <p
                      style={{
                        margin: '2px 0 0',
                        fontSize: 11,
                        color: 'var(--muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {song.artist || 'YouTube'}
                    </p>
                  </div>

                  {song.duration && (
                    <span
                      style={{
                        fontFamily: '"DM Mono", monospace',
                        fontSize: 11,
                        color: 'var(--muted)',
                        flexShrink: 0
                      }}
                    >
                      {song.duration}
                    </span>
                  )}

                  <button
                    onClick={(e) => handleAddSingleTrack(song, e)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: isAdded ? 'rgba(74, 222, 128, 0.15)' : 'rgba(232, 201, 119, 0.1)',
                      border: isAdded ? '1px solid rgba(74, 222, 128, 0.3)' : '1px solid rgba(232, 201, 119, 0.2)',
                      display: 'grid',
                      placeItems: 'center',
                      color: isAdded ? '#4ade80' : 'var(--yellow)',
                      flexShrink: 0,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    title={isAdded ? 'Đã thêm' : 'Thêm vào hàng chờ'}
                  >
                    {isAdded ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Thông tin & Nút hành động */}
        {!loading && tracks.length > 0 && (
          <div
            style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              background: 'rgba(255, 255, 255, 0.015)'
            }}
          >
            <span
              style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 11,
                color: 'var(--muted)'
              }}
            >
              {filterQuery ? `Tìm thấy ${filteredTracks.length} / ${tracks.length} bài hát` : `Danh sách ${tracks.length} bài hát • Cuộn để xem tất cả`}
            </span>

            <button
              onClick={handlePlayAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid rgba(232, 201, 119, 0.3)',
                background: 'rgba(232, 201, 119, 0.1)',
                color: 'var(--yellow)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              <ListPlus size={13} />
              <span>Phát cả bộ</span>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
