import React, { useState, useEffect } from 'react';
import { Loader2, Music } from 'lucide-react';

export default function SyncedLyrics({ guildId, currentTrack }) {
  const [lyricsData, setLyricsData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!guildId || !currentTrack) return;
    let isMounted = true;
    setLoading(true);

    fetch(`/api/guilds/${guildId}/lyrics`)
      .then(res => res.json())
      .then(data => {
        if (isMounted) {
          setLoading(false);
          if (data.success) {
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
  }, [guildId, currentTrack?.title]);

  return (
    <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-6 flex-1 min-h-[400px] max-h-[500px] overflow-y-auto flex flex-col items-center text-center relative">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-base font-bold text-white">
          {currentTrack?.title || 'Chưa có bài hát đang phát'}
        </h3>
        <p className="text-xs text-anna-muted mt-0.5">
          {currentTrack?.artist || 'Nghệ Sĩ'}
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-anna-accent">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      )}

      {!loading && !lyricsData && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-anna-muted py-12">
          <Music className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-xs">Không tìm thấy lời bài hát cho ca khúc này.</p>
        </div>
      )}

      {!loading && lyricsData && (
        <div className="space-y-4 text-sm font-medium text-anna-muted max-w-lg leading-relaxed">
          {lyricsData.syncedLyrics && lyricsData.syncedLyrics.length > 0 ? (
            lyricsData.syncedLyrics.map((line, idx) => (
              <p key={idx} className="lyric-line text-anna-muted">
                {line.text}
              </p>
            ))
          ) : (
            <div className="whitespace-pre-line text-xs leading-relaxed text-anna-text">
              {lyricsData.lyrics}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
