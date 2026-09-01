import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  Radio,
  Infinity,
  Mic,
  Music,
  Lock,
  Minimize2,
  Heart
} from 'lucide-react';

export default function HeroPlayer({ player, onAction, user, onRequireAdmin, onToggleMinimize }) {
  const isPlaying = player?.isPlaying && !player?.isPaused;
  const current = player?.current;
  const isFav = player?.favorites?.some(f => f.title === current?.title || f.url === current?.url);

  // Local progress interpolation for smooth 1-second ticks
  const [progressMs, setProgressMs] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMs, setDragMs] = useState(0);
  const [hoverInfo, setHoverInfo] = useState(null); // { percent, timeStr, x }
  const [previousVolume, setPreviousVolume] = useState(100);
  const [localVolume, setLocalVolume] = useState(player?.volume ?? 80);
  const volumeDebounceRef = useRef(null);

  // Sync local volume with server value (when not dragging)
  useEffect(() => {
    if (volumeDebounceRef.current) return; // user is actively dragging
    if (player?.volume !== undefined) setLocalVolume(player.volume);
  }, [player?.volume]);

  const progressBarRef = useRef(null);
  const totalMs = parseDurationToMs(current?.duration);


  // Sync with server startTime when not actively dragging
  useEffect(() => {
    if (isDragging) return;
    if (current?.startTime) {
      setProgressMs(Math.max(0, Date.now() - current.startTime));
    } else {
      setProgressMs(0);
    }
  }, [current?.title, current?.startTime, isDragging]);

  // Local 1-second interval timer
  useEffect(() => {
    if (!isPlaying || totalMs <= 0 || isDragging) return;
    const timer = setInterval(() => {
      setProgressMs(prev => (prev < totalMs ? prev + 1000 : prev));
    }, 1000);
    return () => clearInterval(timer);
  }, [isPlaying, totalMs, isDragging]);

  // Helper to calculate time from mouse/touch event
  const calculateTimeFromEvent = useCallback((clientX) => {
    if (!progressBarRef.current || totalMs <= 0) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = offsetX / rect.width;
    return Math.floor(ratio * totalMs);
  }, [totalMs]);

  // Handle Seek Interaction
  const handleSeekCommit = useCallback((targetMs) => {
    const targetSeconds = Math.max(0, Math.min(Math.floor(totalMs / 1000), Math.floor(targetMs / 1000)));
    setProgressMs(targetMs);
    setIsDragging(false);
    onAction('seek', targetSeconds);
  }, [totalMs, onAction]);

  // Pointer Down
  const handlePointerDown = (e) => {
    if (!current || totalMs <= 0) return;
    const clientX = e.clientX || (e.touches && e.touches[0]?.clientX);
    if (clientX === undefined) return;

    const clickedMs = calculateTimeFromEvent(clientX);
    setIsDragging(true);
    setDragMs(clickedMs);
  };

  // Pointer Move (Window level while dragging)
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      const clientX = e.clientX || (e.touches && e.touches[0]?.clientX);
      if (clientX === undefined) return;
      const moveMs = calculateTimeFromEvent(clientX);
      setDragMs(moveMs);
    };

    const handlePointerUp = (e) => {
      const clientX = e.clientX || (e.changedTouches && e.changedTouches[0]?.clientX);
      if (clientX !== undefined) {
        const finalMs = calculateTimeFromEvent(clientX);
        handleSeekCommit(finalMs);
      } else {
        handleSeekCommit(dragMs);
      }
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging, dragMs, calculateTimeFromEvent, handleSeekCommit]);

  // Hover Tooltip over Progress Bar
  const handleProgressBarMouseMove = (e) => {
    if (!progressBarRef.current || totalMs <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = offsetX / rect.width;
    const timeAtHover = Math.floor(ratio * totalMs);

    setHoverInfo({
      percent: ratio * 100,
      timeStr: formatTime(timeAtHover),
      x: offsetX
    });
  };

  const handleProgressBarMouseLeave = () => {
    setHoverInfo(null);
  };

  // Global Keyboard Shortcuts (Space, M, Arrows)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        onAction(isPlaying ? 'pause' : 'resume');
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyJ') {
        // Tua lùi 5s
        e.preventDefault();
        if (current && totalMs > 0) {
          const newTimeMs = Math.max(0, (isDragging ? dragMs : progressMs) - 5000);
          handleSeekCommit(newTimeMs);
        }
      } else if (e.code === 'ArrowRight' || e.code === 'KeyL') {
        // Tua tiến 5s
        e.preventDefault();
        if (current && totalMs > 0) {
          const newTimeMs = Math.min(totalMs, (isDragging ? dragMs : progressMs) + 5000);
          handleSeekCommit(newTimeMs);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, player?.volume, current, totalMs, isDragging, dragMs, progressMs, handleSeekCommit]);

  const toggleMute = () => {
    if ((player?.volume || 0) > 0) {
      setPreviousVolume(player?.volume || 100);
      onAction('volume', 0);
    } else {
      onAction('volume', previousVolume || 100);
    }
  };

  // 24/7 Action with Admin check
  const handleToggle247 = () => {
    if (!user?.isAdmin) {
      onRequireAdmin?.();
    } else {
      onAction('toggle247');
    }
  };

  const currentDisplayMs = isDragging ? dragMs : progressMs;
  const percent = totalMs > 0 ? Math.min(100, Math.max(0, (currentDisplayMs / totalMs) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Player Card (Nhấp vào bất kỳ đâu trên khung để thu nhỏ) */}
      <div
        onClick={onToggleMinimize}
        title="Nhấp vào khung để thu nhỏ thanh phát nhạc"
        className="bg-gradient-to-b from-anna-surface to-anna-card border border-anna-border/80 hover:border-anna-accent/50 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center relative overflow-hidden cursor-pointer transition-all duration-300 group"
      >
        
        {/* Glowing Ambient Backdrop */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-anna-accent/20 rounded-full blur-3xl pointer-events-none transition-all duration-700"></div>
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-anna-pink/15 rounded-full blur-3xl pointer-events-none"></div>

        {/* Status Header */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full flex items-center justify-between mb-3 z-10"
        >
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-anna-bg/60 border border-anna-border/60 text-xs font-semibold text-anna-text">
            {isPlaying ? (
              <>
                <span className="w-2 h-2 rounded-full bg-anna-green animate-ping" aria-hidden="true"></span>
                <span>Đang phát</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-anna-yellow" aria-hidden="true"></span>
                <span>Tạm dừng</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {player?.mode247 && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-anna-pink/10 border border-anna-pink/30 text-xs font-bold text-anna-pink">
                <Infinity className="w-3.5 h-3.5" aria-hidden="true" />
                <span>24/7 Lofi</span>
              </div>
            )}
          </div>
        </div>

        {/* Vinyl Disc / Thumbnail */}
        <div className="relative my-3">
          <div
            className={`w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-[#0a0a0a] border-4 border-[#222] shadow-2xl flex items-center justify-center p-3 relative transition-transform duration-500 group-hover:border-anna-accent/60 ${
              isPlaying ? 'vinyl-spinning' : 'vinyl-paused'
            }`}
          >
            <div className="absolute inset-2 rounded-full border border-white/5 pointer-events-none"></div>
            <div className="absolute inset-6 rounded-full border border-white/5 pointer-events-none"></div>
            <div className="absolute inset-10 rounded-full border border-white/5 pointer-events-none"></div>
            
            <img
              src={current?.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500'}
              alt={current?.title ? `Ảnh bìa ${current.title}` : 'Ảnh bìa bài hát'}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover shadow-inner ring-4 ring-[#111]"
            />
            <div className="absolute w-6 h-6 rounded-full bg-anna-surface border-2 border-anna-border shadow-inner"></div>
          </div>
        </div>

        {/* Track Info */}
        <div className="w-full mt-2 z-10">
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight line-clamp-1 hover:line-clamp-none transition-all">
            {current?.title || 'Chưa có bài hát đang phát'}
          </h2>
          <p className="text-xs sm:text-sm font-medium text-anna-muted mt-1 flex items-center justify-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-anna-accent" aria-hidden="true" />
            <span>{current?.artist && current.artist !== 'Unknown' ? current.artist : 'YouTube Music'}</span>
          </p>

          {/* Requester Badge & Favorite Button */}
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-2 bg-anna-bg/80 border border-anna-border/60 px-3 py-1 rounded-full text-xs text-anna-muted">
              {current?.requestedByAvatar && (
                <img
                  src={current.requestedByAvatar}
                  alt=""
                  className="w-4 h-4 rounded-full object-cover"
                  aria-hidden="true"
                />
              )}
              <span>Yêu cầu bởi: <b className="text-white">{current?.requestedBy || 'Tự động phát 🎵'}</b></span>
            </div>

            {current && (
              <button
                onClick={() => onAction('toggleFavorite', current)}
                title={isFav ? "Xóa khỏi danh sách Yêu thích" : "Thêm vào bài hát Yêu thích ❤️"}
                className={`px-3 py-1 rounded-full border transition flex items-center gap-1.5 text-xs font-semibold active:scale-95 ${
                  isFav
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 shadow-sm'
                    : 'bg-anna-bg/80 hover:bg-anna-hover text-anna-muted hover:text-white border-anna-border/60'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                <span>{isFav ? 'Đã thích' : 'Yêu thích'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Audio Visualizer */}
        <div
          className={`w-full flex items-center justify-center gap-1 my-5 h-8 px-4 ${
            isPlaying ? 'animating' : ''
          }`}
          aria-hidden="true"
        >
          <span className="v-bar h-2 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-5 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-7 w-1 rounded-full bg-anna-pink"></span>
          <span className="v-bar h-4 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-6 w-1 rounded-full bg-anna-pink"></span>
          <span className="v-bar h-8 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-3 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-6 w-1 rounded-full bg-anna-pink"></span>
          <span className="v-bar h-7 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-4 w-1 rounded-full bg-anna-accent"></span>
          <span className="v-bar h-2 w-1 rounded-full bg-anna-pink"></span>
        </div>

        {/* Interactive Seek Bar */}
        <div className="w-full z-10 space-y-2">
          <div
            ref={progressBarRef}
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
            onMouseMove={handleProgressBarMouseMove}
            onMouseLeave={handleProgressBarMouseLeave}
            className={`group relative w-full bg-anna-border/60 rounded-full cursor-pointer transition-all duration-150 py-1.5 flex items-center select-none ${
              totalMs > 0 ? 'hover:scale-[1.01]' : 'pointer-events-none opacity-60'
            }`}
            role="slider"
            aria-valuemin="0"
            aria-valuemax={Math.floor(totalMs / 1000)}
            aria-valuenow={Math.floor(currentDisplayMs / 1000)}
            aria-label="Tua bài hát"
          >
            {/* Progress Track Background */}
            <div className="relative w-full h-2 rounded-full overflow-hidden bg-anna-border/80 group-hover:h-2.5 transition-all">
              {/* Active Progress Fill */}
              <div
                className="h-full bg-gradient-to-r from-anna-accent via-anna-pink to-pink-500 rounded-full transition-[width] duration-75"
                style={{ width: `${percent}%` }}
              ></div>
            </div>

            {/* Glowing Scrubber Thumb */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-md shadow-black/50 border-2 border-anna-accent transition-transform duration-75 ${
                isDragging ? 'scale-125 ring-4 ring-anna-accent/40' : 'scale-0 group-hover:scale-100'
              }`}
              style={{ left: `${percent}%` }}
            ></div>

            {/* Hover Timestamp Preview Tooltip */}
            {hoverInfo && totalMs > 0 && !isDragging && (
              <div
                className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-lg bg-[#0b0c10] border border-anna-border text-[10px] font-mono font-bold text-white shadow-xl pointer-events-none z-20"
                style={{ left: `${hoverInfo.percent}%` }}
              >
                {hoverInfo.timeStr}
              </div>
            )}
          </div>

          {/* Time Labels */}
          <div className="flex items-center justify-between text-[11px] font-mono text-anna-muted px-0.5 select-none">
            <span className={isDragging ? 'text-anna-accent font-bold' : ''}>
              {formatTime(currentDisplayMs)}
            </span>
            <span>{current?.duration || '0:00'}</span>
          </div>
        </div>

        {/* Controls Deck */}
        <div className="w-full flex items-center justify-center gap-3 sm:gap-4 mt-4 z-10">
          <button
            onClick={() => onAction('shuffle')}
            aria-label="Xáo trộn hàng chờ bài hát"
            title="Xáo trộn hàng chờ"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
          >
            <Shuffle className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => onAction('previous')}
            aria-label="Quay lại bài trước đó (tối đa 5 bài)"
            title="Quay lại bài trước đó (Lưu 5 bài)"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          <button
            onClick={() => onAction(isPlaying ? 'pause' : 'resume')}
            aria-label={isPlaying ? 'Tạm dừng bài hát (Space)' : 'Tiếp tục phát bài hát (Space)'}
            title={isPlaying ? 'Tạm dừng (Phím cách)' : 'Phát tiếp (Phím cách)'}
            className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-anna-accent to-anna-pink hover:opacity-90 text-white flex items-center justify-center shadow-lg shadow-anna-accent/30 transition active:scale-95 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => onAction('skip')}
            aria-label="Chuyển sang bài hát tiếp theo"
            title="Chuyển bài tiếp theo"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={() => onAction('loop')}
            aria-label="Thay đổi chế độ lặp lại"
            title="Chế độ lặp lại"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95 relative focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
          >
            <Repeat className="w-4 h-4" />
            {player?.loop === 'song' && (
              <span className="absolute -top-1 -right-1 text-[9px] font-black bg-anna-accent text-white rounded-full w-4 h-4 flex items-center justify-center">
                1
              </span>
            )}
            {player?.loop === 'queue' && (
              <span className="absolute -top-1 -right-1 text-[9px] font-black bg-anna-pink text-white rounded-full w-4 h-4 flex items-center justify-center">
                ∞
              </span>
            )}
          </button>
        </div>

        {/* Volume & 24/7 Controls */}
        <div className="w-full flex items-center justify-between gap-4 mt-6 pt-4 border-t border-anna-border/50 text-xs z-10">
          <div className="flex items-center gap-2 flex-1">
            <button
              onClick={toggleMute}
              aria-label={(player?.volume || 0) === 0 ? "Bật âm thanh (Phím M)" : "Tắt tiếng (Phím M)"}
              title={(player?.volume || 0) === 0 ? "Bật âm thanh (M)" : "Tắt tiếng (M)"}
              className="text-anna-muted hover:text-white transition p-1 rounded-lg focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
            >
              {(player?.volume || 0) === 0 ? (
                <VolumeX className="w-4 h-4 text-anna-red" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="150"
              value={localVolume}
              onChange={(e) => {
                const vol = Number(e.target.value);
                setLocalVolume(vol);
                // Debounce: chỉ gửi lệnh lên bot sau 400ms không kéo nữa
                if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
                volumeDebounceRef.current = setTimeout(() => {
                  volumeDebounceRef.current = null;
                  onAction('volume', vol);
                }, 400);
              }}
              aria-label="Điều chỉnh âm lượng bot nhạc"
              className="w-full accent-anna-accent h-1.5 bg-anna-border rounded-lg cursor-pointer focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
            />
            <span className="text-xs font-mono text-anna-muted w-8 text-right">
              {localVolume}%
            </span>
          </div>

          <button
            onClick={handleToggle247}
            aria-label="Bật hoặc tắt chế độ treo 24/7 Lofi"
            title={user?.isAdmin ? "Bật/Tắt chế độ 24/7" : "Yêu cầu quyền Admin"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition font-medium text-xs focus-visible:ring-2 focus-visible:ring-anna-pink focus-visible:outline-none ${
              player?.mode247
                ? 'bg-anna-pink/10 border-anna-pink/40 text-anna-pink'
                : 'bg-anna-bg hover:bg-anna-hover border-anna-border text-anna-text'
            }`}
          >
            {!user?.isAdmin && <Lock className="w-3 h-3 text-amber-400" />}
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Treo 24/7</span>
          </button>
        </div>

      </div>

      {/* Voice Channel State Card */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-anna-green/10 text-anna-green border border-anna-green/20 flex items-center justify-center">
            <Mic className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>{player?.voiceChannel?.name || 'Chưa vào kênh Voice'}</span>
            </div>
            <p className="text-[11px] text-anna-muted font-medium">
              {player?.voiceChannel?.memberCount || 0} thành viên đang nghe
            </p>
          </div>
        </div>

        <div className="flex items-center -space-x-2">
          {player?.voiceChannel?.members?.slice(0, 4).map((m, idx) => (
            <img
              key={idx}
              src={m.avatar}
              alt={m.name}
              title={m.name}
              className="w-6 h-6 rounded-full border-2 border-anna-surface object-cover"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function parseDurationToMs(str) {
  if (!str || str.includes('Live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return parts[0] * 1000;
}
