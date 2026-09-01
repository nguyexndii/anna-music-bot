import React, { useState, useRef, useEffect } from 'react';
import {
  ListOrdered,
  Trash2,
  Music2,
  Clock,
  CheckSquare,
  Square,
  Play,
  ChevronUp,
  ChevronDown,
  GripVertical,
  ArrowUpToLine,
  ArrowUpDown,
  X,
  Sparkles
} from 'lucide-react';

export default function QueueManager({ queue, onAction }) {
  const songs = queue || [];
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [jumpModalData, setJumpModalData] = useState(null); // { song, index }
  const [targetPosition, setTargetPosition] = useState('1');

  const listContainerRef = useRef(null);
  const autoScrollRafRef = useRef(null);

  // Auto-scroll logic during drag
  const stopAutoScroll = () => {
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  };

  const startAutoScroll = (direction, speed) => {
    stopAutoScroll();
    const scrollStep = () => {
      const scrollParent = listContainerRef.current?.closest('.overflow-y-auto') || window;
      if (scrollParent === window) {
        window.scrollBy({ top: direction * speed });
      } else {
        scrollParent.scrollBy({ top: direction * speed });
      }
      autoScrollRafRef.current = requestAnimationFrame(scrollStep);
    };
    autoScrollRafRef.current = requestAnimationFrame(scrollStep);
  };

  // Drag and Drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }

    // Proximity auto-scrolling
    const threshold = 120;
    const viewportHeight = window.innerHeight;
    const clientY = e.clientY;

    if (clientY < threshold) {
      const intensity = Math.max(2, Math.min(20, (threshold - clientY) / 4));
      startAutoScroll(-1, intensity);
    } else if (clientY > viewportHeight - threshold) {
      const intensity = Math.max(2, Math.min(20, (clientY - (viewportHeight - threshold)) / 4));
      startAutoScroll(1, intensity);
    } else {
      stopAutoScroll();
    }
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    stopAutoScroll();
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      onAction('move', { from: draggedIndex, to: targetIndex });
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    stopAutoScroll();
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  useEffect(() => {
    return () => stopAutoScroll();
  }, []);

  // Quick action: Move to Top (Play Next)
  const handleMoveToTop = (idx) => {
    if (idx <= 0) return;
    onAction('move', { from: idx, to: 0 });
  };

  // Open Jump Modal
  const openJumpModal = (song, index) => {
    setJumpModalData({ song, index });
    setTargetPosition(String(index === 0 ? 2 : 1));
  };

  const handleConfirmJump = (e) => {
    if (e) e.preventDefault();
    if (!jumpModalData) return;
    const targetIdx = parseInt(targetPosition, 10) - 1;
    if (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < songs.length && targetIdx !== jumpModalData.index) {
      onAction('move', { from: jumpModalData.index, to: targetIdx });
    }
    setJumpModalData(null);
  };

  // Toggle selection for a single track
  const toggleSelect = (idx) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  // Select / Deselect All
  const toggleSelectAll = () => {
    if (selectedIndices.size === songs.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(songs.map((_, idx) => idx)));
    }
  };

  const [showClearModal, setShowClearModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Delete selected tracks
  const handleDeleteSelected = () => {
    if (selectedIndices.size === 0) return;
    setShowBatchModal(true);
  };

  const confirmBatchDelete = () => {
    onAction('removeBatch', Array.from(selectedIndices));
    setSelectedIndices(new Set());
    setShowBatchModal(false);
  };

  const confirmClearAll = () => {
    onAction('clear');
    setSelectedIndices(new Set());
    setShowClearModal(false);
  };

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

  const isAllSelected = songs.length > 0 && selectedIndices.size === songs.length;

  return (
    <div ref={listContainerRef} className="flex flex-col gap-4 relative animate-in fade-in">
      {/* Custom Modal Xác Nhận Xóa Hết */}
      {showClearModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-anna-surface border border-anna-border p-5 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Xóa Hàng Chờ</h4>
                <p className="text-xs text-anna-muted mt-0.5">Xác nhận dọn sạch danh sách</p>
              </div>
            </div>

            <p className="text-xs text-anna-text leading-relaxed">
              Bạn có chắc chắn muốn xóa toàn bộ <b className="text-white">{songs.length}</b> bài hát trong hàng chờ?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-anna-border/50">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border text-xs font-semibold text-anna-muted hover:text-white transition"
              >
                Hủy
              </button>
              <button
                onClick={confirmClearAll}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 active:scale-95"
              >
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Modal Xác Nhận Xóa Bài Đã Chọn */}
      {showBatchModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-anna-surface border border-anna-border p-5 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Xóa Bài Hát Đã Chọn</h4>
                <p className="text-xs text-anna-muted mt-0.5">Xác nhận xóa {selectedIndices.size} bài</p>
              </div>
            </div>

            <p className="text-xs text-anna-text leading-relaxed">
              Bạn có chắc chắn muốn xóa <b className="text-white">{selectedIndices.size}</b> bài hát đã chọn khỏi hàng chờ?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-anna-border/50">
              <button
                onClick={() => setShowBatchModal(false)}
                className="px-4 py-2 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border text-xs font-semibold text-anna-muted hover:text-white transition"
              >
                Hủy
              </button>
              <button
                onClick={confirmBatchDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 active:scale-95"
              >
                Xóa {selectedIndices.size} bài
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chuyển Vị Trí Nhanh (Jump to Position) */}
      {jumpModalData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-anna-surface border border-anna-border p-5 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-anna-accent/15 border border-anna-accent/30 text-anna-accent flex items-center justify-center flex-shrink-0">
                  <ArrowUpDown className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">Chuyển Vị Trí Bài Hát</h4>
                  <p className="text-xs text-anna-muted">Đang ở vị trí <b className="text-anna-accent">#{jumpModalData.index + 1}</b></p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setJumpModalData(null)}
                className="p-1 rounded-lg text-anna-muted hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-anna-card/70 border border-anna-border/70 flex items-center gap-2.5">
              <img
                src={jumpModalData.song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}
                alt=""
                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">{jumpModalData.song.title}</p>
                <p className="text-[11px] text-anna-muted truncate mt-0.5">{jumpModalData.song.artist || 'YouTube'}</p>
              </div>
            </div>

            <form onSubmit={handleConfirmJump} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-anna-muted mb-1.5">
                  Nhập số thứ tự muốn chuyển đến (1 - {songs.length}):
                </label>
                <input
                  type="number"
                  min={1}
                  max={songs.length}
                  value={targetPosition}
                  onChange={(e) => setTargetPosition(e.target.value)}
                  className="w-full bg-anna-bg border border-anna-border focus:border-anna-accent rounded-xl px-3.5 py-2 text-sm text-white font-bold focus:outline-none text-center font-mono"
                  autoFocus
                />
              </div>

              {/* Quick Preset Chips */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTargetPosition('1')}
                  className="px-2.5 py-1 rounded-lg bg-anna-accent/15 hover:bg-anna-accent/25 text-[11px] font-bold text-anna-accent border border-anna-accent/30 transition flex items-center gap-1"
                >
                  <ArrowUpToLine className="w-3 h-3" />
                  <span>Đầu hàng chờ (#1)</span>
                </button>
                {songs.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => setTargetPosition('2')}
                    className="px-2.5 py-1 rounded-lg bg-anna-card hover:bg-anna-hover text-[11px] font-semibold text-white/80 border border-anna-border transition"
                  >
                    Vị trí #2
                  </button>
                )}
                {songs.length >= 5 && (
                  <button
                    type="button"
                    onClick={() => setTargetPosition('5')}
                    className="px-2.5 py-1 rounded-lg bg-anna-card hover:bg-anna-hover text-[11px] font-semibold text-white/80 border border-anna-border transition"
                  >
                    Vị trí #5
                  </button>
                )}
                {songs.length >= 10 && (
                  <button
                    type="button"
                    onClick={() => setTargetPosition('10')}
                    className="px-2.5 py-1 rounded-lg bg-anna-card hover:bg-anna-hover text-[11px] font-semibold text-white/80 border border-anna-border transition"
                  >
                    Vị trí #10
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTargetPosition(String(songs.length))}
                  className="px-2.5 py-1 rounded-lg bg-anna-card hover:bg-anna-hover text-[11px] font-semibold text-anna-muted border border-anna-border transition"
                >
                  Cuối cùng (#{songs.length})
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-anna-border/50 mt-1">
                <button
                  type="button"
                  onClick={() => setJumpModalData(null)}
                  className="px-4 py-2 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border text-xs font-semibold text-anna-muted hover:text-white transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition shadow-lg shadow-anna-accent/25 active:scale-95"
                >
                  Xác Nhận Chuyển
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between bg-anna-surface px-4 py-2.5 rounded-xl border border-anna-border">
        <div className="flex items-center gap-3">
          {songs.length > 0 && (
            <button
              onClick={toggleSelectAll}
              title={isAllSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              className="p-1 text-anna-muted hover:text-white transition flex items-center gap-1.5 focus-visible:outline-none"
            >
              {isAllSelected ? (
                <CheckSquare className="w-4 h-4 text-anna-accent" />
              ) : selectedIndices.size > 0 ? (
                <CheckSquare className="w-4 h-4 text-anna-accent/70" />
              ) : (
                <Square className="w-4 h-4 text-anna-muted" />
              )}
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <ListOrdered className="w-4 h-4 text-anna-accent" aria-hidden="true" />
            <span className="text-xs font-bold text-white">
              Hàng Chờ ({songs.length}/100 bài)
            </span>
          </div>

          {songs.length > 0 && totalSeconds > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-anna-muted font-mono bg-anna-card px-2 py-0.5 rounded-full border border-anna-border/50">
              <Clock className="w-3 h-3 text-anna-accent" aria-hidden="true" />
              <span>{formatTotalTime(totalSeconds)}</span>
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {selectedIndices.size > 0 ? (
            <button
              onClick={handleDeleteSelected}
              className="text-xs bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40 font-bold flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition shadow-sm active:scale-95 animate-in fade-in"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Xóa ({selectedIndices.size})</span>
            </button>
          ) : songs.length > 0 ? (
            <button
              onClick={() => setShowClearModal(true)}
              aria-label="Xóa toàn bộ bài hát trong hàng chờ"
              className="text-xs text-anna-red hover:underline font-semibold flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-anna-red focus-visible:outline-none rounded-lg px-2 py-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Xóa Hết</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Queue List */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-3xl p-4 sm:p-5 pb-6 flex flex-col gap-2">
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
            {songs.map((song, idx) => {
              const isSelected = selectedIndices.has(idx);
              const isDragging = draggedIndex === idx;
              const isDragOver = dragOverIndex === idx;

              return (
                <div
                  key={idx}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleSelect(idx)}
                  className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border transition group cursor-pointer select-none ${
                    isDragging
                      ? 'opacity-40 scale-[0.98] border-dashed border-anna-accent bg-anna-accent/10'
                      : isDragOver
                      ? 'border-t-2 border-t-anna-accent bg-anna-accent/20 shadow-md scale-[1.01]'
                      : isSelected
                      ? 'bg-anna-accent/15 border-anna-accent/50 shadow-sm'
                      : 'bg-anna-card hover:bg-anna-hover border-anna-border/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* Drag Handle */}
                    <div
                      className="cursor-grab active:cursor-grabbing text-anna-muted group-hover:text-white p-0.5"
                      title="Kéo thả để đổi thứ tự bài hát (tự động cuộn trang khi kéo sát mép)"
                    >
                      <GripVertical className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                    </div>

                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(idx);
                      }}
                      className="text-anna-muted hover:text-white p-0.5"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-anna-accent" />
                      ) : (
                        <Square className="w-4 h-4 text-anna-muted group-hover:text-anna-text" />
                      )}
                    </button>

                    {/* Rank Badge with Quick Jump click */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openJumpModal(song, idx);
                      }}
                      title="Bấm để nhảy đến vị trí khác nhanh"
                      className="w-5 h-5 rounded-md bg-white/5 hover:bg-anna-accent hover:text-white flex items-center justify-center text-[11px] font-mono font-bold text-anna-muted transition"
                    >
                      {idx + 1}
                    </button>

                    <img
                      src={song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}
                      alt={`Ảnh bìa ${song.title}`}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{song.title}</p>
                      <p className="text-[11px] text-anna-muted flex items-center gap-1.5 mt-0.5">
                        <span>{song.artist || 'YouTube'}</span>
                        <span>•</span>
                        <span className="font-mono">{song.duration}</span>
                        <span>•</span>
                        <span className="text-[10px] text-anna-accent truncate">
                          👤 {song.requestedBy || 'User'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Play Now Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction('playNow', idx);
                      }}
                      aria-label={`Phát ngay bài ${song.title}`}
                      className="p-1.5 rounded-lg text-anna-muted hover:text-white hover:bg-anna-accent/40 transition opacity-80 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title="Phát ngay bài này (Bỏ qua bài hiện tại)"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>

                    {/* Move to Top (Play Next) Button */}
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveToTop(idx);
                        }}
                        className="p-1.5 rounded-lg text-anna-muted hover:text-anna-accent hover:bg-anna-accent/20 transition opacity-80 sm:opacity-0 group-hover:opacity-100"
                        title="Đưa lên đầu hàng chờ (Phát kế tiếp)"
                      >
                        <ArrowUpToLine className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Jump to Position Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openJumpModal(song, idx);
                      }}
                      className="p-1.5 rounded-lg text-anna-muted hover:text-purple-300 hover:bg-purple-500/20 transition opacity-80 sm:opacity-0 group-hover:opacity-100"
                      title="Chuyển đến vị trí bất kỳ (Ví dụ: nhảy từ #50 lên #2)"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </button>

                    {/* Move Up */}
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAction('move', { from: idx, to: idx - 1 });
                        }}
                        className="p-1 rounded-lg text-anna-muted hover:text-white hover:bg-white/10 transition opacity-0 group-hover:opacity-100 hidden sm:block"
                        title="Đẩy lên 1 nấc"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Move Down */}
                    {idx < songs.length - 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAction('move', { from: idx, to: idx + 1 });
                        }}
                        className="p-1 rounded-lg text-anna-muted hover:text-white hover:bg-white/10 transition opacity-0 group-hover:opacity-100 hidden sm:block"
                        title="Đẩy xuống 1 nấc"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Delete Single Track */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction('remove', idx);
                      }}
                      aria-label={`Xóa bài ${song.title} khỏi hàng chờ`}
                      className="p-1.5 rounded-lg text-anna-muted hover:text-anna-red hover:bg-anna-red/10 transition opacity-80 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-anna-red focus-visible:outline-none"
                      title="Xóa khỏi hàng chờ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
