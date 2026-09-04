import React, { useState, useEffect, useRef } from 'react';
import { Loader2, SlidersHorizontal, Sparkles, AlignLeft, Disc3 } from 'lucide-react';
import { API_BASE } from '../config';

// Module-level cache to prevent re-fetching when user switches tabs
const lyricsCache = new Map();

function parseDurationToMs(str) {
  if (!str || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return parts[0] * 1000;
}

function getSavedOffset(title) {
  if (!title) return null;
  try {
    const raw = localStorage.getItem(`lyrics_offset_${title}`);
    return raw !== null ? Number(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveOffset(title, offsetMs) {
  if (!title) return;
  try {
    localStorage.setItem(`lyrics_offset_${title}`, String(offsetMs));
  } catch (e) {}
}

export default function SyncedLyrics({ player, onAction, isActive = true }) {
  const current = player?.current;
  const songKey = current?.title ? `${current.title}|${current.artist || ''}` : '';

  const isLofiTrack = Boolean(
    (current?.requestedBy === 'Auto (24/7)' && !current?.artist) ||
    current?.title?.toLowerCase()?.includes('lofi') ||
    current?.title?.toLowerCase()?.includes('lo-fi') ||
    current?.title?.toLowerCase()?.includes('chillhop') ||
    current?.title?.toLowerCase()?.includes('beats to relax') ||
    current?.title?.toLowerCase()?.includes('không lời') ||
    current?.title?.toLowerCase()?.includes('instrumental')
  );

  const [lyricsData, setLyricsData] = useState(() => {
    return songKey && lyricsCache.has(songKey) ? lyricsCache.get(songKey) : null;
  });
  const [loading, setLoading]       = useState(() => {
    return !isLofiTrack && Boolean(songKey && !lyricsCache.has(songKey));
  });
  const [activeLineIdx, setActiveLineIdx] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [manualOffsetMs, setManualOffsetMs] = useState(() => {
    return getSavedOffset(current?.title) ?? 0;
  });
  const [showSyncAdjust, setShowSyncAdjust] = useState(false);
  const [viewMode, setViewMode] = useState('synced'); // 'synced' or 'plain'

  const activeLineRef = useRef(null);
  const containerRef  = useRef(null);

  // Khi qua bài mới: Cuộn ngay lập tức lên đầu trang (scrollTop = 0) và reset index
  useEffect(() => {
    setActiveLineIdx(-1);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    const saved = getSavedOffset(current?.title);
    setManualOffsetMs(saved ?? 0);
  }, [current?.title, current?.url]);

  // Khi dữ liệu lời bài hát mới nạp xong: đảm bảo luôn ở đầu trang
  useEffect(() => {
    if (containerRef.current && activeLineIdx <= 0) {
      containerRef.current.scrollTop = 0;
    }
  }, [lyricsData, current?.title]);

  // Khi người dùng chuyển từ tab khác quay lại tab Lời Nhạc:
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    if (activeLineIdx <= 0) {
      containerRef.current.scrollTop = 0;
    } else if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [isActive]);

  // Fetch lyrics with caching
  useEffect(() => {
    if (isLofiTrack) {
      setLyricsData(null);
      setLoading(false);
      return;
    }

    if (!current?.title) {
      setLyricsData(null);
      setLoading(false);
      return;
    }

    const key = `${current.title}|${current.artist || ''}`;
    const savedOffset = getSavedOffset(current.title);

    if (lyricsCache.has(key)) {
      const cached = lyricsCache.get(key);
      setLyricsData(cached);
      if (savedOffset === null) {
        setManualOffsetMs(cached?.autoOffsetMs || 0);
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setActiveLineIdx(-1);

    const durMs = current.durationMs || parseDurationToMs(current.duration);
    const params = new URLSearchParams({ title: current.title });
    if (current.artist && current.artist !== 'Unknown') params.set('artist', current.artist);
    if (durMs > 0) params.set('duration', durMs);

    fetch(`${API_BASE}/api/lyrics?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const result = d?.success ? d : null;
        if (result) {
          lyricsCache.set(key, result);
          if (savedOffset === null && result.autoOffsetMs) {
            setManualOffsetMs(result.autoOffsetMs);
          }
        }
        setLyricsData(result);
        setLoading(false);
      })
      .catch(() => {
        setLyricsData(null);
        setLoading(false);
      });
  }, [current?.title, current?.artist, current?.duration, current?.durationMs, isLofiTrack]);

  // Sync active line — compensates for server poll delay using serverTime
  useEffect(() => {
    if (!lyricsData?.syncedLyrics?.length) return;
    const paused = player?.isPaused || !player?.isPlaying;

    // If server gave us playbackDurationMs + serverTime, compensate for time elapsed since poll
    let base;
    if (typeof current?.playbackDurationMs === 'number' && typeof current?.serverTime === 'number') {
      const networkCompensation = paused ? 0 : Math.max(0, Date.now() - current.serverTime);
      base = current.playbackDurationMs + networkCompensation;
    } else if (current?.startTime) {
      base = Math.max(0, Date.now() - current.startTime);
    } else {
      base = 0;
    }

    const t0 = Date.now();
    const baseAtT0 = base;

    const tick = () => {
      const elapsed = (paused ? baseAtT0 : Math.max(0, baseAtT0 + (Date.now() - t0))) + manualOffsetMs;
      let found = -1;
      for (let i = 0; i < lyricsData.syncedLyrics.length; i++) {
        const lt = lyricsData.syncedLyrics[i].time ?? lyricsData.syncedLyrics[i].timeMs ?? 0;
        if (elapsed >= lt) found = i; else break;
      }
      setActiveLineIdx(found);
    };

    tick();
    const iv = setInterval(tick, 150);
    return () => clearInterval(iv);
  }, [current?.title, current?.startTime, current?.playbackDurationMs, current?.serverTime, player?.isPaused, player?.isPlaying, lyricsData?.syncedLyrics, manualOffsetMs]);

  // Auto-scroll — smoothly center active line, or scroll to top if song just started
  useEffect(() => {
    if (!autoScroll || viewMode === 'plain' || !containerRef.current) return;
    if (activeLineIdx <= 0) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeLineIdx, autoScroll, viewMode]);

  const updateOffset = (newOffset) => {
    setManualOffsetMs(newOffset);
    saveOffset(current?.title, newOffset);
  };

  // Lofi / 24/7 special view
  if (isLofiTrack || lyricsData?.isLofi) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 20px', textAlign: 'center' }}>
        <div style={{
          fontFamily: '"DM Mono", monospace', fontSize: 10, letterSpacing: '0.16em',
          color: 'var(--yellow)', background: 'rgba(232,201,119,0.1)', padding: '5px 14px',
          borderRadius: 999, border: '1px solid rgba(232,201,119,0.3)', marginBottom: 14
        }}>
          LOFI 24/7 · PHÁT TỰ ĐỘNG
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
          Không gian âm nhạc Lofi Chill
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.6 }}>
          Bản nhạc thư giãn tự động không lời. Chúc bạn có những phút giây làm việc và học tập hiệu quả ☕
        </p>
      </div>
    );
  }

  const hasSynced = Boolean(lyricsData?.syncedLyrics?.length > 0);
  const showSynced = hasSynced && viewMode === 'synced';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ── Lyrics Topbar Header ──────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0, flex: 1, paddingRight: 10 }}>
          <p
            title={current?.title}
            style={{
              fontFamily: '"DM Mono", monospace', fontSize: 9.5, letterSpacing: '0.14em',
              color: 'var(--yellow)', margin: '0 0 2px', textTransform: 'uppercase',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {current?.title || 'Chưa có bài hát'}
          </p>
          <p
            title={current?.artist}
            style={{
              fontSize: 11.5, color: 'var(--muted)', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {current?.artist && current.artist !== 'Unknown' ? current.artist : ''}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {/* View Mode Toggle (Synced vs Plain text) */}
          {hasSynced && (
            <button
              onClick={() => setViewMode(m => m === 'plain' ? 'synced' : 'plain')}
              style={{
                border: `1px solid ${viewMode === 'plain' ? 'var(--yellow)' : 'var(--border)'}`,
                background: viewMode === 'plain' ? 'rgba(232,201,119,.12)' : 'transparent',
                color: viewMode === 'plain' ? 'var(--yellow)' : 'var(--muted)',
                borderRadius: 8, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', fontSize: 10, fontFamily: '"DM Mono", monospace'
              }}
              title={viewMode === 'plain' ? 'Chuyển sang xem lời chạy theo nhạc' : 'Chuyển sang đọc toàn bộ lời bài hát'}
            >
              <AlignLeft size={11} />
              <span>{viewMode === 'plain' ? 'LỜI THƯỜNG' : 'ĐỒNG BỘ'}</span>
            </button>
          )}

          {/* Sync Offset Adjuster Toggle (Only in synced view) */}
          {showSynced && (
            <button
              onClick={() => setShowSyncAdjust(p => !p)}
              style={{
                border: `1px solid ${showSyncAdjust ? 'var(--yellow)' : 'var(--border)'}`,
                background: showSyncAdjust ? 'rgba(232,201,119,.12)' : 'transparent',
                color: showSyncAdjust ? 'var(--yellow)' : 'var(--muted)',
                borderRadius: 8, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', fontSize: 10, fontFamily: '"DM Mono", monospace'
              }}
              title="Chỉnh độ trễ nhịp lời bài hát (+/- giây)"
            >
              <SlidersHorizontal size={11} />
              <span>{manualOffsetMs !== 0 ? `${manualOffsetMs > 0 ? '+' : ''}${(manualOffsetMs/1000).toFixed(1)}s` : 'KHỚP'}</span>
            </button>
          )}

          {/* Auto Scroll Toggle */}
          {showSynced && (
            <button
              onClick={() => setAutoScroll(p => !p)}
              style={{
                border: `1px solid ${autoScroll ? 'var(--yellow)' : 'var(--border)'}`,
                background: autoScroll ? 'rgba(232,201,119,.08)' : 'transparent',
                color: autoScroll ? 'var(--yellow)' : 'var(--muted)',
                borderRadius: 8, padding: '5px 10px',
                fontFamily: '"DM Mono", monospace', fontSize: 9.5, letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              {autoScroll ? 'TỰ CUỘN' : 'TẮT CUỘN'}
            </button>
          )}

          {lyricsData?.lyrics && !hasSynced && (
            <span style={{
              fontFamily: '"DM Mono", monospace', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.08em',
              border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', background: 'var(--soft)'
            }}>
              LỜI THAM KHẢO
            </span>
          )}
        </div>
      </div>

      {/* ── Sync Calibration Bar with Multi-tier Offset Controls ── */}
      {showSyncAdjust && showSynced && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap',
          padding: '8px 12px', marginBottom: 12, borderRadius: 12,
          background: 'var(--paper)', border: '1px solid var(--border)', flexShrink: 0
        }}>
          <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 9.5, color: 'var(--muted)' }}>CHỈNH NHỊP:</span>
          <button
            onClick={() => updateOffset(manualOffsetMs - 10000)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Lùi lời bài hát lại 10 giây"
          >
            -10s
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs - 2000)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Lùi lời bài hát lại 2 giây"
          >
            -2s
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs - 500)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Lùi lời bài hát lại 0.5 giây"
          >
            -0.5s
          </button>
          <button
            onClick={() => updateOffset(0)}
            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--yellow)', background: 'transparent', color: 'var(--yellow)', fontSize: 10, fontFamily: '"DM Mono", monospace', cursor: 'pointer', fontWeight: 700 }}
          >
            RESET
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs + 500)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Nhảy lời bài hát sớm hơn 0.5 giây"
          >
            +0.5s
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs + 2000)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Nhảy lời bài hát sớm hơn 2 giây"
          >
            +2s
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs + 10000)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--ink)', fontSize: 10, cursor: 'pointer' }}
            title="Nhảy lời bài hát sớm hơn 10 giây"
          >
            +10s
          </button>
          <button
            onClick={() => updateOffset(manualOffsetMs + 20000)}
            style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--soft)', color: 'var(--yellow)', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
            title="Nhảy lời bài hát sớm hơn 20 giây"
          >
            +20s
          </button>
        </div>
      )}

      {/* ── Scroll Container (Centered Lyrics with Top & Bottom Fade Mask) ── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingTop: '20px',
          paddingBottom: '55%',
          paddingRight: 6,
          textAlign: 'center',
          minHeight: 0,
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 85%, transparent 100%)',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 10, color: 'var(--muted)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--yellow)' }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, letterSpacing: '0.12em' }}>ĐANG TẢI LỜI BÀI HÁT...</span>
          </div>
        )}

        {!loading && !lyricsData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '70px 20px', gap: 14, textAlign: 'center' }}>
            <div style={{ width: 44, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
              {[10, 18, 22, 18, 10].map((h, i) => (
                <span key={i} style={{ width: 2.5, height: h, background: 'var(--border)', borderRadius: 2, display: 'block' }} />
              ))}
            </div>
            <div>
              <p style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 15, margin: '0 0 6px' }}>Không có lời bài hát</p>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0, maxWidth: 300, lineHeight: 1.6 }}>
                {current ? 'Bản nhạc này chưa có dữ liệu lời bài hát (Beat / Remix / Nhạc không lời).' : 'Phát một bài hát để xem lời nhé!'}
              </p>
            </div>
          </div>
        )}

        {!loading && lyricsData && (
          <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {showSynced ? (
              lyricsData.syncedLyrics.map((line, i) => {
                const isActive = i === activeLineIdx;
                const timeMs = line.time ?? line.timeMs ?? 0;
                return (
                  <p
                    key={i}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => { if (timeMs >= 0 && onAction) onAction('seek', Math.floor((timeMs - manualOffsetMs) / 1000)); }}
                    title={timeMs > 0 ? `Nhảy tới ${formatLyricTime(timeMs)}` : undefined}
                    style={{
                      margin: '5px 0',
                      padding: '10px 20px',
                      borderRadius: 16,
                      fontSize: 17,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? '#ffffff' : 'rgba(238, 233, 224, 0.36)',
                      lineHeight: 1.55,
                      cursor: 'pointer',
                      transition: 'color 0.25s ease, background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
                      background: isActive ? 'rgba(232, 201, 119, 0.12)' : 'transparent',
                      border: isActive ? '1px solid rgba(232, 201, 119, 0.3)' : '1px solid transparent',
                      boxShadow: isActive ? '0 6px 20px rgba(0,0,0,0.35), inset 0 0 10px rgba(232,201,119,0.06)' : 'none',
                      textShadow: isActive ? '0 0 14px rgba(232, 201, 119, 0.35)' : 'none',
                      maxWidth: '96%',
                      textAlign: 'center',
                      userSelect: 'none',
                    }}
                  >
                    {line.text}
                  </p>
                );
              })
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{
                  fontFamily: '"DM Mono", monospace', fontSize: 9.5, letterSpacing: '0.12em',
                  color: 'var(--muted)', background: 'rgba(255,255,255,0.04)', padding: '4px 14px',
                  borderRadius: 999, border: '1px solid var(--border)', marginBottom: 16
                }}>
                  LỜI THAM KHẢO · CÓ THỂ KHÁC VỚI BẢN BẠN ĐANG PHÁT
                </div>
                <div style={{ whiteSpace: 'pre-line', fontSize: 15, lineHeight: 2.2, color: 'var(--ink)', padding: '8px 16px', maxWidth: '90%', textAlign: 'center', opacity: 0.85 }}>
                  {lyricsData.lyrics}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function formatLyricTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
