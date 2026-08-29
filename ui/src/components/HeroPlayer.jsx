import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Volume2,
  Radio,
  Infinity,
  Mic,
  Music
} from 'lucide-react';

export default function HeroPlayer({ player, onAction }) {
  const isPlaying = player?.isPlaying && !player?.isPaused;
  const current = player?.current;

  // Local progress interpolation for smooth 1-second ticks
  const [progressMs, setProgressMs] = useState(0);
  const totalMs = parseDurationToMs(current?.duration);

  useEffect(() => {
    if (current?.startTime) {
      setProgressMs(Math.max(0, Date.now() - current.startTime));
    } else {
      setProgressMs(0);
    }
  }, [current?.title, current?.startTime]);

  useEffect(() => {
    if (!isPlaying || totalMs <= 0) return;
    const timer = setInterval(() => {
      setProgressMs(prev => (prev < totalMs ? prev + 1000 : prev));
    }, 1000);
    return () => clearInterval(timer);
  }, [isPlaying, totalMs]);

  const percent = totalMs > 0 ? Math.min(100, (progressMs / totalMs) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Player Card */}
      <div className="bg-gradient-to-b from-anna-surface to-anna-card border border-anna-border/80 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
        
        {/* Glowing Ambient Backdrop */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-anna-accent/20 rounded-full blur-3xl pointer-events-none transition-all duration-700"></div>
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-anna-pink/15 rounded-full blur-3xl pointer-events-none"></div>

        {/* Status Header */}
        <div className="w-full flex items-center justify-between mb-4 z-10">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-anna-bg/60 border border-anna-border/60 text-xs font-semibold text-anna-text">
            {isPlaying ? (
              <>
                <span className="w-2 h-2 rounded-full bg-anna-green animate-ping"></span>
                <span>Đang phát</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-anna-yellow"></span>
                <span>Tạm dừng</span>
              </>
            )}
          </div>

          {player?.mode247 && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-anna-pink/10 border border-anna-pink/30 text-xs font-bold text-anna-pink">
              <Infinity className="w-3.5 h-3.5" />
              <span>24/7 Lofi</span>
            </div>
          )}
        </div>

        {/* Vinyl Disc / Thumbnail */}
        <div className="relative my-4 group">
          <div className={`w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-[#0a0a0a] border-4 border-[#222] shadow-2xl flex items-center justify-center p-3 relative ${isPlaying ? 'vinyl-spinning' : 'vinyl-paused'}`}>
            <div className="absolute inset-2 rounded-full border border-white/5 pointer-events-none"></div>
            <div className="absolute inset-6 rounded-full border border-white/5 pointer-events-none"></div>
            <div className="absolute inset-10 rounded-full border border-white/5 pointer-events-none"></div>
            
            <img
              src={current?.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500'}
              alt={current?.title || 'Music'}
              className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover shadow-inner ring-4 ring-[#111]"
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
            <Music className="w-3.5 h-3.5 text-anna-accent" />
            <span>{current?.artist || 'Anna Music DJ AI'}</span>
          </p>

          {/* Requester Badge */}
          <div className="mt-3 inline-flex items-center gap-2 bg-anna-bg/80 border border-anna-border/60 px-3 py-1 rounded-full text-xs text-anna-muted">
            {current?.requestedByAvatar && (
              <img src={current.requestedByAvatar} alt="" className="w-4 h-4 rounded-full object-cover" />
            )}
            <span>Yêu cầu bởi: <b className="text-white">{current?.requestedBy || 'Hệ thống (24/7)'}</b></span>
          </div>
        </div>

        {/* Audio Visualizer */}
        <div className={`w-full flex items-center justify-center gap-1 my-5 h-8 px-4 ${isPlaying ? 'animating' : ''}`}>
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

        {/* Progress Bar */}
        <div className="w-full z-10 space-y-1.5">
          <div className="relative w-full bg-anna-border/50 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-anna-accent to-anna-pink rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            ></div>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-anna-muted px-0.5">
            <span>{formatTime(progressMs)}</span>
            <span>{current?.duration || '0:00'}</span>
          </div>
        </div>

        {/* Controls Deck */}
        <div className="w-full flex items-center justify-center gap-3 sm:gap-4 mt-5 z-10">
          <button
            onClick={() => onAction('shuffle')}
            title="Xáo trộn hàng chờ"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95"
          >
            <Shuffle className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => onAction('resume')}
            title="Phát lại từ đầu"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={() => onAction(isPlaying ? 'pause' : 'resume')}
            title={isPlaying ? 'Tạm dừng' : 'Phát tiếp'}
            className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-anna-accent to-anna-pink hover:opacity-90 text-white flex items-center justify-center shadow-lg shadow-anna-accent/30 transition active:scale-95"
          >
            {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current ml-0.5" />}
          </button>

          <button
            onClick={() => onAction('skip')}
            title="Chuyển bài tiếp theo"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={() => onAction('loop')}
            title="Chế độ lặp lại"
            className="p-2.5 rounded-xl hover:bg-anna-hover text-anna-muted hover:text-white transition active:scale-95 relative"
          >
            <Repeat className="w-4 h-4" />
            {player?.loop === 'track' && (
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
            <Volume2 className="w-4 h-4 text-anna-muted" />
            <input
              type="range"
              min="0"
              max="150"
              value={player?.volume || 100}
              onChange={(e) => onAction('volume', e.target.value)}
              className="w-full accent-anna-accent h-1.5 bg-anna-border rounded-lg cursor-pointer"
            />
            <span className="text-xs font-mono text-anna-muted w-8 text-right">
              {player?.volume || 100}%
            </span>
          </div>

          <button
            onClick={() => onAction('toggle247')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition font-medium text-xs ${
              player?.mode247
                ? 'bg-anna-pink/10 border-anna-pink/40 text-anna-pink'
                : 'bg-anna-bg hover:bg-anna-hover border-anna-border text-anna-text'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Treo 24/7</span>
          </button>
        </div>

      </div>

      {/* Voice Channel State Card */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-anna-green/10 text-anna-green border border-anna-green/20 flex items-center justify-center">
            <Mic className="w-4 h-4" />
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
