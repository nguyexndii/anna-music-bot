import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, Sparkles, Plus, Play } from 'lucide-react';

export default function LiveSearch({ onOrderSong }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const quickTags = ['Chill Lofi', 'V-Pop Hot', 'Indie Việt', 'US-UK Hits'];

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=6`);
        const data = await res.json();
        setLoading(false);
        if (data.success && data.results) {
          setResults(data.results);
        } else {
          setResults([]);
        }
      } catch (err) {
        setLoading(false);
      }
    }, 300); // 300ms Debounce

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="absolute left-4 w-5 h-5 text-anna-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm bài hát, nghệ sĩ hoặc dán link YouTube/Spotify..."
          className="w-full bg-anna-surface border border-anna-border focus:border-anna-accent rounded-2xl pl-12 pr-12 py-3.5 text-sm text-white placeholder-anna-muted focus:outline-none focus:ring-2 focus:ring-anna-accent/30 transition shadow-inner"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 text-anna-muted hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quick Tags */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-anna-muted text-[11px] font-semibold">Gợi ý:</span>
        {quickTags.map((tag) => (
          <button
            key={tag}
            onClick={() => setQuery(tag)}
            className="px-3 py-1 rounded-full bg-anna-card hover:bg-anna-hover text-anna-text hover:text-white border border-anna-border transition flex-shrink-0"
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Search Results Container */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-4 flex-1 min-h-[360px] max-h-[500px] overflow-y-auto flex flex-col gap-2 relative">
        
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 bg-anna-surface/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-7 h-7 text-anna-accent animate-spin" />
            <span className="text-xs text-anna-muted font-medium">Đang tìm kiếm bài hát...</span>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-anna-muted">
            <div className="w-12 h-12 rounded-2xl bg-anna-card border border-anna-border flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-anna-accent" />
            </div>
            <p className="text-sm font-semibold text-white">Tìm kiếm bài hát tức thời</p>
            <p className="text-xs text-anna-muted mt-1 max-w-xs">
              Gõ tên bài hát hoặc dán link YouTube/Spotify để thêm bài vào hàng chờ ngay lập tức!
            </p>
          </div>
        )}

        {/* Results List */}
        {!loading && results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((track, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-anna-card hover:bg-anna-hover border border-anna-border/70 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={track.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}
                    alt={track.title}
                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white line-clamp-1">{track.title}</p>
                    <p className="text-[11px] text-anna-muted flex items-center gap-1.5 mt-0.5">
                      <span>{track.artist}</span>
                      <span>•</span>
                      <span className="font-mono text-anna-text">{track.duration}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onOrderSong(track)}
                    className="px-3 py-1.5 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition flex items-center gap-1 shadow-sm shadow-anna-accent/20 active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
