import React, { useState, useMemo } from 'react';
import { History, Play, Clock, Search, Music2 } from 'lucide-react';

function formatRelativeTime(dateString) {
  if (!dateString) return 'Gần đây';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Gần đây';

  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Vừa xong';
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  if (diffHours < 24) return `${diffHours} giờ trước`;
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays} ngày trước`;

  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export default function HistoryTab({ player, onOrderSong }) {
  const [filterQuery, setFilterQuery] = useState('');
  const historyList = player?.history || [];

  const filteredHistory = useMemo(() => {
    if (!filterQuery.trim()) return historyList;
    const q = filterQuery.toLowerCase().trim();
    return historyList.filter(
      (item) =>
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.artist && item.artist.toLowerCase().includes(q))
    );
  }, [historyList, filterQuery]);

  return (
    <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-4 sm:p-6 flex-1 min-h-[300px] max-h-[calc(100vh-320px)] overflow-y-auto flex flex-col gap-4 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-anna-border/50">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-anna-accent/10 border border-anna-accent/20 text-anna-accent">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Lịch Sử Nghe Nhạc</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-anna-card border border-anna-border text-anna-muted font-mono font-bold">
                {historyList.length} bài
              </span>
            </h3>
            <p className="text-[11px] text-anna-muted">Danh sách các bài hát đã phát gần đây trong máy chủ</p>
          </div>
        </div>

        {/* Search inside History */}
        {historyList.length > 5 && (
          <div className="relative flex items-center min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 text-anna-muted" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Lọc bài đã nghe..."
              className="w-full bg-anna-card border border-anna-border/80 text-white placeholder-anna-muted text-xs rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:border-anna-accent transition"
            />
          </div>
        )}
      </div>

      {/* History List */}
      {filteredHistory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-anna-muted">
          <div className="w-12 h-12 rounded-2xl bg-anna-card border border-anna-border flex items-center justify-center mb-3">
            <Music2 className="w-6 h-6 text-anna-muted opacity-60" />
          </div>
          <p className="text-sm font-semibold text-white">
            {filterQuery ? 'Không tìm thấy bài hát phù hợp' : 'Chưa có lịch sử nghe nhạc'}
          </p>
          <p className="text-xs text-anna-muted mt-1 max-w-xs leading-relaxed">
            {filterQuery
              ? 'Thử tìm kiếm với từ khóa hoặc tên ca sĩ khác.'
              : 'Hãy phát một bài hát từ tab Khám Phá để bắt đầu ghi lại lịch sử.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filteredHistory.map((track, idx) => (
            <div
              key={`${track.url || track.title}-${idx}`}
              className="group flex items-center justify-between p-2.5 sm:p-3 rounded-xl bg-anna-card/60 hover:bg-anna-card border border-anna-border/50 hover:border-anna-border transition-all duration-200"
            >
              {/* Left: Index, Thumbnail & Metadata */}
              <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                <span className="w-5 text-center text-[11px] font-mono font-bold text-anna-muted/70 flex-shrink-0 group-hover:text-anna-accent transition">
                  {idx + 1}
                </span>

                <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-anna-surface border border-anna-border/60">
                  <img
                    src={track.thumbnail || '/logo.jpg'}
                    alt={track.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={(e) => {
                      e.target.src = '/logo.jpg';
                    }}
                  />
                  <button
                    onClick={() => onOrderSong(track)}
                    aria-label={`Phát lại ${track.title}`}
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white"
                  >
                    <Play className="w-4 h-4 fill-white" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <h4
                    onClick={() => onOrderSong(track)}
                    title={track.title}
                    className="text-xs font-semibold text-white truncate hover:text-anna-accent cursor-pointer transition leading-snug"
                  >
                    {track.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-anna-muted">
                    <span className="truncate max-w-[140px] sm:max-w-[200px]">
                      {track.artist || 'YouTube Music'}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-mono text-[10px]">
                      <Clock className="w-2.5 h-2.5 opacity-60" />
                      {track.duration || '3:30'}
                    </span>
                    <span>•</span>
                    <span className="text-[10px] text-anna-muted/80">
                      {formatRelativeTime(track.playedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onOrderSong(track)}
                  title="Thêm vào hàng chờ / Phát lại bài này"
                  className="px-3 py-1.5 rounded-lg bg-anna-accent/10 hover:bg-anna-accent text-anna-accent hover:text-white border border-anna-accent/30 hover:border-transparent text-xs font-bold transition flex items-center gap-1.5 active:scale-95 shadow-sm"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span className="hidden sm:inline">Phát Lại</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
