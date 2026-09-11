import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Volume2, VolumeX, Radio, Lock, Heart } from 'lucide-react';

function formatTime(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function parseDurationToMs(str) {
  if (!str || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return parts[0] * 1000;
}

function getSourceLabel(track) {
  if (!track) return 'YOUTUBE MUSIC';
  const u = (track.url || '').toLowerCase();
  const s = (track.source || '').toLowerCase();
  if (s === 'soundcloud' || u.includes('soundcloud.com')) return 'SOUNDCLOUD';
  if (s === 'spotify' || u.includes('spotify.com')) return 'SPOTIFY';
  if (s === 'youtube' || u.includes('youtube.com') || u.includes('youtu.be')) return 'YOUTUBE';
  if (track.album && track.album !== 'Unknown' && !track.album.toLowerCase().includes('unknown')) {
    return track.album.toUpperCase();
  }
  return 'YOUTUBE MUSIC';
}

export default function HeroPlayer({ player, onAction, user, onRequireAdmin }) {

  const isPlaying = player?.isPlaying && !player?.isPaused;
  const current   = player?.current;
  const isFav     = player?.favorites?.some(f => f.title === current?.title || f.url === current?.url);

  const [progressMs, setProgressMs]   = useState(0);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragMs, setDragMs]           = useState(0);
  const [hoverInfo, setHoverInfo]     = useState(null);
  const [localVolume, setLocalVolume] = useState(player?.volume ?? 80);
  const [previousVolume, setPreviousVolume] = useState(100);
  const [heartPopping, setHeartPopping] = useState(false);

  const progressBarRef   = useRef(null);
  const volumeDebounceRef = useRef(null);

  const totalMs = parseDurationToMs(current?.duration);

  // Sync volume from server
  useEffect(() => {
    if (volumeDebounceRef.current) return;
    if (player?.volume !== undefined) setLocalVolume(player.volume);
  }, [player?.volume]);

  // Sync progress from server
  useEffect(() => {
    if (isDragging) return;
    if (current?.playbackDurationMs !== undefined) setProgressMs(current.playbackDurationMs);
    else if (current?.startTime) setProgressMs(Math.max(0, Date.now() - current.startTime));
    else setProgressMs(0);
  }, [current?.title, current?.startTime, current?.playbackDurationMs, isDragging]);

  // Local 1s tick
  useEffect(() => {
    if (!isPlaying || totalMs <= 0 || isDragging) return;
    const t = setInterval(() => setProgressMs(p => p < totalMs ? p + 1000 : p), 1000);
    return () => clearInterval(t);
  }, [isPlaying, totalMs, isDragging]);

  const calculateTimeFromEvent = useCallback((clientX) => {
    if (!progressBarRef.current || totalMs <= 0) return 0;
    const r = progressBarRef.current.getBoundingClientRect();
    return Math.floor((Math.max(0, Math.min(clientX - r.left, r.width)) / r.width) * totalMs);
  }, [totalMs]);

  const handleSeekCommit = useCallback((ms) => {
    const s = Math.max(0, Math.min(Math.floor(totalMs / 1000), Math.floor(ms / 1000)));
    setProgressMs(ms); setIsDragging(false);
    onAction('seek', s);
  }, [totalMs, onAction]);

  const handlePointerDown = (e) => {
    if (!current || totalMs <= 0) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    if (x === undefined) return;
    setIsDragging(true); setDragMs(calculateTimeFromEvent(x));
  };

  useEffect(() => {
    if (!isDragging) return;
    const move = (e) => { const x = e.clientX ?? e.touches?.[0]?.clientX; if (x !== undefined) setDragMs(calculateTimeFromEvent(x)); };
    const up   = (e) => { const x = e.clientX ?? e.changedTouches?.[0]?.clientX; handleSeekCommit(x !== undefined ? calculateTimeFromEvent(x) : dragMs); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move); window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
  }, [isDragging, dragMs, calculateTimeFromEvent, handleSeekCommit]);

  // Keyboard shortcuts
  useEffect(() => {
    const kd = (e) => {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); onAction(isPlaying ? 'pause' : 'resume'); }
      else if (e.code === 'KeyM') { e.preventDefault(); toggleMute(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); if (current && totalMs > 0) handleSeekCommit(Math.max(0, (isDragging ? dragMs : progressMs) - 5000)); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); if (current && totalMs > 0) handleSeekCommit(Math.min(totalMs, (isDragging ? dragMs : progressMs) + 5000)); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [isPlaying, current, totalMs, isDragging, dragMs, progressMs, handleSeekCommit]);

  const toggleMute = () => {
    if ((player?.volume || 0) > 0) {
      setPreviousVolume(player?.volume || 100);
      setLocalVolume(0);
      onAction('volume', 0);
    } else {
      const restored = previousVolume || 100;
      setLocalVolume(restored);
      onAction('volume', restored);
    }
  };

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    if (!current) return;
    setHeartPopping(true);
    setTimeout(() => setHeartPopping(false), 550);
    onAction('toggleFavorite', current);
  };

  const currentDisplayMs = isDragging ? dragMs : progressMs;
  const percent = totalMs > 0 ? Math.min(100, Math.max(0, (currentDisplayMs / totalMs) * 100)) : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0 }}>

      {/* ── Top Upper Section: Vinyl Record + Track Meta ─────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        
        {/* Vinyl Player Deck */}
        <div className="vinyl-deck">
          {/* Tonearm (Needle) */}
          <div
            className={`tonearm-assembly ${isPlaying ? 'on-record' : ''}`}
            title={isPlaying ? 'Kim đĩa than đang quét bài hát' : 'Kim đĩa than đang dừng'}
            aria-hidden="true"
          >
            <div className="tonearm-base" />
            <div className="tonearm-pivot" />
            <div className="tonearm-rod" />
            <div className="tonearm-cartridge" />
          </div>

          {/* Vinyl Disc */}
          <div
            className={`vinyl-wrap ${isPlaying ? 'spinning' : current ? 'spinning-paused' : ''}`}
            aria-label={current?.title ? `Đĩa nhạc: ${current.title}` : 'Chưa có bài hát'}
          >
            <div className="vinyl-grooves" />
            <div className="vinyl-art">
              {current?.thumbnail ? (
                <img src={current.thumbnail} alt={`Bìa album: ${current.title}`} />
              ) : (
                <div className="vinyl-art-fallback">
                  <span>{current?.title?.[0] || '♪'}</span>
                </div>
              )}
            </div>
            {/* Center Spindle Hole */}
            <div className="vinyl-spindle-hole">
              <div className="spindle-dot" />
            </div>
          </div>
        </div>

        {/* Track Meta */}
        <div className="track-meta" style={{ marginTop: 8 }}>
          <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
            <p className="track-eyebrow">
              {player?.mode247 ? '24/7 · LIÊN TỤC' : getSourceLabel(current)}
            </p>
            <h1 className="track-title" title={current?.title}>
              {current?.title || 'Chưa có bài hát'}
            </h1>
            <p className="track-artist" title={current?.artist}>
              {current?.artist && current.artist !== 'Unknown' ? current.artist : 'Anna Music'}
            </p>
          </div>

          {current && (
            <button
              className={`fav-btn${isFav ? ' liked' : ''}${heartPopping ? ' heart-pop-anim' : ''}`}
              onClick={handleFavoriteClick}
              aria-label={isFav ? 'Bỏ thích' : 'Thích bài hát'}
              title={isFav ? 'Bỏ thích' : 'Thêm vào yêu thích'}
            >
              <Heart size={21} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

      </div>

      {/* ── Bottom Section: Progress + Controls + Volume + Voice ── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop: 'auto', paddingTop: 10 }}>

        {/* Progress Bar */}
        <div className="progress-wrap" style={{ marginTop: 6 }}>
          <div
            ref={progressBarRef}
            className="progress-track"
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
            onMouseMove={(e) => {
              if (!progressBarRef.current || totalMs <= 0) return;
              const r = progressBarRef.current.getBoundingClientRect();
              const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
              setHoverInfo({ percent: x / r.width * 100, timeStr: formatTime(Math.floor(x / r.width * totalMs)), x });
            }}
            onMouseLeave={() => setHoverInfo(null)}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.floor(totalMs / 1000)}
            aria-valuenow={Math.floor(currentDisplayMs / 1000)}
            aria-label="Tua bài hát"
            style={{ cursor: totalMs > 0 ? 'pointer' : 'default' }}
          >
            <div className="progress-fill" style={{ width: `${percent}%` }} />
            {hoverInfo && totalMs > 0 && !isDragging && (
              <div style={{
                position: 'absolute', top: -28, left: `${hoverInfo.percent}%`,
                transform: 'translateX(-50%)',
                background: '#0d0f11', border: '1px solid var(--border)',
                borderRadius: 6, padding: '2px 7px',
                fontFamily: '"DM Mono", monospace', fontSize: 10, color: 'var(--ink)',
                pointerEvents: 'none', whiteSpace: 'nowrap',
              }}>
                {hoverInfo.timeStr}
              </div>
            )}
          </div>
          <div className="time-row">
            <span style={{ color: isDragging ? 'var(--yellow)' : undefined }}>{formatTime(currentDisplayMs)}</span>
            <span>{current?.duration || '0:00'}</span>
          </div>
        </div>

        {/* Controls Deck */}
        <div className="player-controls" style={{ marginTop: 14 }}>
          <button
            className={`ctrl-btn${player?.shuffle ? ' active' : ''}`}
            onClick={() => onAction('shuffle')}
            aria-label="Xáo trộn"
            title="Xáo trộn hàng chờ"
          >
            <Shuffle size={17} />
          </button>
          <button className="ctrl-btn" onClick={() => onAction('previous')} aria-label="Bài trước">
            <SkipBack size={21} fill="currentColor" />
          </button>
          <button
            className="ctrl-btn ctrl-play"
            onClick={() => onAction(isPlaying ? 'pause' : 'resume')}
            aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button className="ctrl-btn" onClick={() => onAction('skip')} aria-label="Bài tiếp">
            <SkipForward size={21} />
          </button>
          <button
            className={`ctrl-btn${player?.loop ? ' active' : ''}`}
            onClick={() => onAction('loop')}
            aria-label="Lặp lại"
            title="Lặp lại"
            style={{ position: 'relative' }}
          >
            <Repeat size={17} />
            {player?.loop === 'song' && (
              <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 8, fontWeight: 700, background: 'var(--yellow)', color: '#1c1e21', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            )}
            {player?.loop === 'queue' && (
              <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 8, fontWeight: 700, background: 'var(--coral)', color: '#ffffff', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>∞</span>
            )}
          </button>
        </div>

        {/* Footer: Volume + 24/7 */}
        <div className="now-footer" style={{ marginTop: 16 }}>
          <div className="volume-row">
            <button
              onClick={toggleMute}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}
              aria-label={(player?.volume || 0) === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
              title="Tắt/Bật tiếng (M)"
            >
              {(player?.volume || 0) === 0
                ? <VolumeX size={15} style={{ color: 'var(--coral)' }} />
                : <Volume2 size={15} />}
            </button>
            <input
              type="range" min={0} max={100} value={localVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLocalVolume(v);
                if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
                volumeDebounceRef.current = setTimeout(() => { volumeDebounceRef.current = null; onAction('volume', v); }, 400);
              }}
              aria-label="Âm lượng"
              style={{ flex: 1, accentColor: 'var(--yellow)', height: 3, cursor: 'pointer' }}
            />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 9, color: 'var(--muted)', minWidth: 24 }}>{localVolume}%</span>
          </div>

          <button
            onClick={() => { if (!user?.isAdmin) { onRequireAdmin?.(); } else onAction('toggle247'); }}
            title={user?.isAdmin ? 'Bật/Tắt chế độ 24/7' : 'Yêu cầu quyền Admin'}
            style={{
              border: `1px solid ${player?.mode247 ? 'var(--coral)' : 'var(--border)'}`,
              background: player?.mode247 ? 'rgba(239,120,100,.08)' : 'transparent',
              color: player?.mode247 ? 'var(--coral)' : 'var(--muted)',
              borderRadius: 9, padding: '5px 11px',
              display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: '"DM Mono", monospace', fontSize: 9, letterSpacing: '0.1em',
              cursor: 'pointer', transition: 'all .18s',
            }}
          >
            {!user?.isAdmin && <Lock size={9} style={{ color: '#b5894a' }} />}
            <Radio size={11} />
            <span>24/7</span>
          </button>
        </div>

        {/* Voice channel info */}
        {player?.voiceChannel?.name && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.voiceChannel.name}
              </p>
              <p style={{ margin: '2px 0 0', fontFamily: '"DM Mono", monospace', fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--muted)' }}>
                {player.voiceChannel.memberCount || 0} THÀNH VIÊN
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: -6, flexShrink: 0 }}>
              {player.voiceChannel.members?.slice(0, 4).map((m, i) => (
                <img key={i} src={m.avatar} alt={m.name} title={m.name}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--paper)', objectFit: 'cover', marginLeft: i > 0 ? -6 : 0 }} />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
