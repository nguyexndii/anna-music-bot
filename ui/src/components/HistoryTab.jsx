import React, { useState, useMemo } from 'react';
import { Play, Search, X } from 'lucide-react';

function formatRelativeTime(dateString) {
  if (!dateString) return 'Gần đây';
  const date = new Date(dateString);
  if (isNaN(date)) return 'Gần đây';
  const diff = Date.now() - date;
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1)   return 'Vừa xong';
  if (mins < 60)  return `${mins} phút trước`;
  if (hrs < 24)   return `${hrs} giờ trước`;
  if (days === 1) return 'Hôm qua';
  if (days < 7)   return `${days} ngày trước`;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export default function HistoryTab({ player, onOrderSong }) {
  const [query, setQuery] = useState('');
  const history = player?.history || [];

  const filtered = useMemo(() => {
    if (!query.trim()) return history;
    const q = query.toLowerCase();
    return history.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(q));
  }, [history, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Search box */}
      <div className="search-box" style={{ marginBottom: 16 }}>
        <Search size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Tìm trong lịch sử phát nhạc..."
        />
        {query && (
          <button onClick={() => setQuery('')} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}>
            <X size={15} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--muted)', textAlign: 'center', padding: '60px 0' }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[10, 18, 24, 18, 10].map((h, i) => (
              <span key={i} style={{ width: 2.5, height: h, background: 'var(--border)', borderRadius: 2, display: 'block' }} />
            ))}
          </div>
          <div>
            <p style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14, margin: '0 0 4px' }}>
              {query ? 'Không tìm thấy bài hát' : 'Chưa có lịch sử phát nhạc'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {query ? 'Hãy thử tìm bằng từ khóa khác.' : 'Các bài hát đã phát trên Discord sẽ tự động xuất hiện ở đây.'}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div className="section-label">
            <span>{filtered.length} BÀI ĐÃ PHÁT</span>
            <span style={{ fontSize: 9 }}>BẤM ĐỂ PHÁT LẠI</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map((track, i) => (
              <div
                key={`${track.title}-${track.playedAt || i}`}
                className="song-row"
                onClick={() => onOrderSong?.(track)}
                style={{ borderRadius: 10 }}
              >
                <div className="song-thumb">
                  {track.thumbnail ? (
                    <img src={track.thumbnail} alt="" />
                  ) : (
                    <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: 'rgba(255,255,255,.6)' }}>{i + 1}</span>
                  )}
                </div>
                <div className="song-info">
                  <span className="song-name">{track.title}</span>
                  <span className="song-sub">{track.artist && track.artist !== 'Unknown' ? track.artist : 'YouTube Music'}</span>
                </div>
                <span className="song-dur">{formatRelativeTime(track.playedAt)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onOrderSong?.(track); }}
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--soft)', color: 'var(--ink)', display: 'grid', placeItems: 'center',
                    marginLeft: 6, flexShrink: 0, cursor: 'pointer'
                  }}
                  title="Phát lại bài này"
                >
                  <Play size={13} fill="currentColor" style={{ marginLeft: 1 }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
