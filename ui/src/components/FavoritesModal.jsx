import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Play, ChevronLeft, ChevronRight, Heart } from 'lucide-react';

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

export default function FavoritesModal({ isOpen, onClose, favorites = [], onOrderSong }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 7; // 7 bài / trang cho giao diện to, thoáng, vừa vặn

  const totalPages = Math.max(1, Math.ceil(favorites.length / pageSize));

  // Reset về trang 1 khi mở modal hoặc danh sách thay đổi
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
    }
  }, [isOpen]);

  // Đóng modal khi nhấn phím ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const startIndex = (currentPage - 1) * pageSize;
  const currentSongs = favorites.slice(startIndex, startIndex + pageSize);

  const handlePlayAll = () => {
    favorites.forEach((song) => {
      onOrderSong?.(song);
    });
    onClose?.();
  };

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
          maxWidth: 620,
          maxHeight: '86vh',
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
            padding: '18px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: 'rgba(255, 255, 255, 0.015)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: 'var(--ink)',
                letterSpacing: '-0.02em'
              }}
            >
              Bài Hát Yêu Thích
            </h3>
            <span
              style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 6,
                background: 'rgba(232, 201, 119, 0.12)',
                color: 'var(--yellow)',
                border: '1px solid rgba(232, 201, 119, 0.25)'
              }}
            >
              {favorites.length} BÀI
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {favorites.length > 0 && (
              <button
                onClick={handlePlayAll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--soft)',
                  color: 'var(--yellow)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                title="Thêm tất cả bài yêu thích vào hàng chờ"
              >
                <Play size={12} fill="var(--yellow)" />
                <span>Phát tất cả</span>
              </button>
            )}

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
              aria-label="Đóng popup"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: Danh sách bài hát */}
        <div
          style={{
            padding: '14px 20px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {favorites.length === 0 ? (
            <div
              style={{
                padding: '48px 16px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13
              }}
            >
              <Heart size={32} style={{ color: 'var(--border)', margin: '0 auto 12px', display: 'block' }} />
              Chưa có bài hát nào trong danh sách yêu thích.
            </div>
          ) : (
            currentSongs.map((song, idx) => {
              const globalIndex = startIndex + idx + 1;
              return (
                <div
                  key={song.url || idx}
                  onClick={() => onOrderSong?.(song)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
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
                  title="Nhấn để thêm vào hàng chờ"
                >
                  <span
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 11,
                      color: 'var(--muted)',
                      width: 22,
                      textAlign: 'right',
                      flexShrink: 0
                    }}
                  >
                    #{globalIndex}
                  </span>

                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
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
                        fontSize: 13,
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
                        fontSize: 11.5,
                        color: 'var(--muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {song.artist || 'YouTube'}
                    </p>
                  </div>

                  <span
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 11,
                      color: 'var(--muted)',
                      flexShrink: 0
                    }}
                  >
                    {song.duration || ''}
                  </span>

                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'rgba(232, 201, 119, 0.1)',
                      border: '1px solid rgba(232, 201, 119, 0.2)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--yellow)',
                      flexShrink: 0,
                      marginLeft: 4
                    }}
                  >
                    <Play size={13} fill="var(--yellow)" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Phân trang */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              background: 'rgba(255, 255, 255, 0.01)'
            }}
          >
            <span
              style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 11,
                color: 'var(--muted)'
              }}
            >
              Trang {currentPage} / {totalPages}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: currentPage === 1 ? 'transparent' : 'var(--soft)',
                  color: currentPage === 1 ? '#444850' : 'var(--ink)',
                  fontSize: 11.5,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <ChevronLeft size={14} />
                <span>Trước</span>
              </button>

              {/* Các nút số trang */}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: page === currentPage ? '1px solid var(--yellow)' : '1px solid var(--border)',
                    background: page === currentPage ? 'rgba(232, 201, 119, 0.15)' : 'var(--soft)',
                    color: page === currentPage ? 'var(--yellow)' : 'var(--muted)',
                    fontFamily: '"DM Mono", monospace',
                    fontSize: 12,
                    fontWeight: page === currentPage ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {page}
                </button>
              ))}

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: currentPage === totalPages ? 'transparent' : 'var(--soft)',
                  color: currentPage === totalPages ? '#444850' : 'var(--ink)',
                  fontSize: 11.5,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <span>Sau</span>
                <ChevronRight size={14} />
              </button>
            </div>
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
