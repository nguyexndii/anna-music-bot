import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Music, Mic2, FlaskConical } from 'lucide-react';
import { API_BASE } from '../config';

const lyricsCache = new Map();

export default function SyncedLyrics({ guildId, currentTrack, player, onAction }) {
  const current = currentTrack || player?.current;
  const targetGuildId = guildId || player?.guildId || localStorage.getItem('anna_guild_id');

  const cacheKey = targetGuildId && current?.title ? `${targetGuildId}:${current.title}` : null;
  const [lyricsData, setLyricsData] = useState(() => (cacheKey ? lyricsCache.get(cacheKey) || null : null));
  const [loading, setLoading] = useState(false);
  const [activeLineIdx, setActiveLineIdx] = useState(-1);
  const activeLineRef = useRef(null);

  // Local auto-scroll preference (Bật/Tắt cuộn theo bài hát)
  const [autoScroll, setAutoScroll] = useState(() => {
    const saved = localStorage.getItem('anna_karaoke_autoscroll');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    const handleStorage = (e) => {
      setAutoScroll(e.detail);
    };
    window.addEventListener('anna_autoscroll_change', handleStorage);
    return () => window.removeEventListener('anna_autoscroll_change', handleStorage);
  }, []);

  // Sync active lyric line with song playback progress
  useEffect(() => {
    if (!current?.startTime || !lyricsData?.syncedLyrics || lyricsData.syncedLyrics.length === 0) return;
    
    const checkActiveLine = () => {
      const elapsedMs = Math.max(0, Date.now() - current.startTime);
      const lines = lyricsData.syncedLyrics;
      
      let foundIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const lineTime = lines[i].time ?? lines[i].timeMs ?? lines[i].startTimeMs ?? 0;
        if (elapsedMs >= lineTime) {
          foundIdx = i;
        } else {
          break;
        }
      }

      setActiveLineIdx(foundIdx);
    };

    checkActiveLine();
    const interval = setInterval(checkActiveLine, 250);

    return () => clearInterval(interval);
  }, [current?.startTime, lyricsData?.syncedLyrics]);

  // Auto-scroll to active line (CHỈ cuộn khi autoScroll === true)
  useEffect(() => {
    if (autoScroll && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIdx, autoScroll]);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!targetGuildId || !current?.title) {
      setLyricsData(null);
      return;
    }

    const key = `${targetGuildId}:${current.title}`;
    if (lyricsCache.has(key)) {
      setLyricsData(lyricsCache.get(key));
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    fetch(`${API_BASE}/api/guilds/${targetGuildId}/lyrics`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setLoading(false);
          if (data.success && (data.lyrics || data.syncedLyrics)) {
            lyricsCache.set(key, data);
            setLyricsData(data);
          } else {
            setLyricsData(null);
          }
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [targetGuildId, current?.title]);

  const toggleAutoScroll = () => {
    const next = !autoScroll;
    setAutoScroll(next);
    localStorage.setItem('anna_karaoke_autoscroll', String(next));
    window.dispatchEvent(new CustomEvent('anna_autoscroll_change', { detail: next }));
  };

  return (
    <div className="bg-anna-surface border border-anna-border/80 rounded-3xl min-h-[500px] flex flex-col shadow-2xl overflow-hidden animate-in fade-in">
      {/* Compact Track & Control Header (Chỉ 1 hàng gọn gàng, tối ưu không gian cho lời bài hát) */}
      <div className="px-4 sm:px-6 py-3 border-b border-anna-border/60 bg-anna-card/60 backdrop-blur-md flex items-center justify-between gap-3 flex-shrink-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-anna-accent/10 border border-anna-accent/20 text-anna-accent flex items-center justify-center flex-shrink-0 shadow-sm">
            <Mic2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-xs sm:max-w-md">
              {current?.title || 'Chưa có bài hát đang phát'}
            </h3>
            <p className="text-[11px] text-anna-muted truncate">
              {current?.artist && current.artist !== 'Unknown' ? current.artist : 'YouTube Music'}
            </p>
          </div>
        </div>

        {/* Compact Quick Toggle */}
        <button
          onClick={toggleAutoScroll}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition active:scale-95 flex-shrink-0 ${
            autoScroll
              ? 'bg-anna-accent text-white shadow-md shadow-anna-accent/25 border border-anna-accent'
              : 'bg-anna-surface text-anna-muted hover:text-white border border-anna-border'
          }`}
          title="Bật/Tắt tự động cuộn và làm nổi bật theo câu hát"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-white animate-pulse' : 'bg-anna-muted'}`}></span>
          <span>Tự cuộn: {autoScroll ? 'BẬT' : 'TẮT'}</span>
        </button>
      </div>

      {/* Scrollable Lyrics Container (Rộng rãi, chữ to rõ ràng kiểu Apple Music / Spotify) */}
      <div className="flex-1 overflow-y-auto max-h-[580px] px-4 sm:px-8 py-8 flex flex-col items-center text-center">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-anna-accent gap-2">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs text-anna-muted font-medium">Đang tìm lời bài hát...</span>
          </div>
        )}

        {/* Not Found State */}
        {!loading && !lyricsData && (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-anna-muted py-20 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-anna-card border border-anna-border flex items-center justify-center shadow-inner">
              <Music className="w-6 h-6 text-anna-muted opacity-60" />
            </div>
            <p className="text-xs font-medium max-w-xs leading-relaxed">
              {current ? 'Không tìm thấy lời bài hát khớp cho ca khúc này.' : 'Hãy phát một bài hát để xem lời bài hát đồng bộ nhé!'}
            </p>
          </div>
        )}

        {/* Lyrics Display */}
        {!loading && lyricsData && (
          <div className="space-y-4 max-w-2xl leading-relaxed py-4 w-full">
            {lyricsData.syncedLyrics && lyricsData.syncedLyrics.length > 0 ? (
              lyricsData.syncedLyrics.map((line, idx) => {
                const isActive = idx === activeLineIdx;
                const timeMs = line.time ?? line.timeMs ?? 0;

                return (
                  <p
                    key={idx}
                    ref={isActive ? activeLineRef : null}
                    onClick={() => {
                      if (!autoScroll) return;
                      if (timeMs >= 0 && onAction) {
                        onAction('seek', Math.floor(timeMs / 1000));
                      }
                    }}
                    title={autoScroll && timeMs > 0 ? `Nhấn để nhảy tới ${Math.floor(timeMs / 60000)}:${String(Math.floor((timeMs % 60000) / 1000)).padStart(2, '0')}` : ''}
                    className={`transition-all duration-300 py-2 px-4 rounded-2xl font-sans ${
                      autoScroll ? 'cursor-pointer select-none' : 'cursor-default select-text'
                    } ${
                      isActive && autoScroll
                        ? 'text-white text-lg sm:text-xl font-bold bg-anna-accent/20 scale-[1.03] shadow-md shadow-anna-accent/15 border border-anna-accent/30'
                        : 'text-white/40 hover:text-white/80 hover:bg-white/5 text-base sm:text-lg font-medium'
                    }`}
                  >
                    {line.text}
                  </p>
                );
              })
            ) : (
              <div className="whitespace-pre-line text-sm sm:text-base leading-relaxed text-anna-text text-left sm:text-center px-4 font-sans max-w-xl mx-auto">
                {lyricsData.lyrics}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
