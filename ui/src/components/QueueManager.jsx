import React from 'react';
import { ListOrdered, Trash2, Music2, Clock } from 'lucide-react';

export default function QueueManager({ queue, onAction }) {
  const songs = queue || [];

  // Tính tổng thời lượng hàng chờ
  const totalSeconds = songs.reduce((acc, s) => {
    if (!s.duration || s.duration.includes('Live')) return acc;
    const parts = s.duration.split(':').map(Number);
    if (parts.length === 2) return acc + parts[0] * 60 + parts[1];
    if (parts.length === 3) return acc + parts[0] * 3600 + parts[1] * 60 + parts[2];
    return acc;
  }, 0);

  const formatTotalTime = (sec) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m ${s}s`;
  };

  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between bg-anna-surface px-4 py-2.5 rounded-xl border border-anna-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <ListOrdered className="w-4 h-4 text-anna-accent" aria-hidden="true" />
            <span className="text-xs font-bold text-white">Danh Sách Chờ ({songs.length} bài)</span>
          </div>

          {songs.length > 0 && totalSeconds > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-anna-muted font-mono bg-anna-card px-2 py-0.5 rounded-full border border-anna-border/50">
              <Clock className="w-3 h-3 text-anna-accent" aria-hidden="true" />
              <span>{formatTotalTime(totalSeconds)}</span>
            </span>
          )}
        </div>

        {songs.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Bạn có chắc chắn muốn xóa toàn bộ bài hát trong hàng chờ?')) {
                onAction('stop');
              }
            }}
            aria-label="Xóa toàn bộ bài hát trong hàng chờ"
            className="text-xs text-anna-red hover:underline font-semibold flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-anna-red focus-visible:outline-none rounded-lg px-2 py-1 transition"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Xóa Hàng Chờ</span>
          </button>
        )}
      </div>

      {/* Queue List */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-4 flex-1 min-h-[360px] max-h-[500px] overflow-y-auto flex flex-col gap-2">
        {songs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-anna-muted">
            <div className="w-12 h-12 rounded-2xl bg-anna-card border border-anna-border flex items-center justify-center mb-3 shadow-inner">
              <Music2 className="w-6 h-6 text-anna-muted" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-white">Hàng chờ đang trống</p>
            <p className="text-xs text-anna-muted mt-1">
              Hãy chuyển qua tab <b>Live Search</b> để thêm bài hát vào hàng chờ nhé!
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {songs.map((song, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border/60 transition group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-5 text-center text-xs font-mono font-bold text-anna-muted">
                    {idx + 1}
                  </span>
                  <img
                    src={song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}
                    alt={`Ảnh bìa ${song.title}`}
                    className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{song.title}</p>
                    <p className="text-[11px] text-anna-muted flex items-center gap-1.5 mt-0.5">
                      <span>{song.artist || 'YouTube'}</span>
                      <span>•</span>
                      <span className="font-mono">{song.duration}</span>
                      <span>•</span>
                      <span className="text-[10px] text-anna-accent">
                        👤 {song.requestedBy || 'User'}
                      </span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => onAction('remove', idx)}
                  aria-label={`Xóa bài ${song.title} khỏi hàng chờ`}
                  className="p-1.5 rounded-lg text-anna-muted hover:text-anna-red hover:bg-anna-red/10 transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-anna-red focus-visible:outline-none"
                  title="Xóa khỏi hàng chờ"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
