import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Loader2,
  Play,
  Flame,
  Plus,
  Music,
  Heart,
  Clock,
  Disc3,
  ListPlus,
  History,
  ChevronRight,
  User,
  Calendar,
  Sparkles,
  Music2
} from 'lucide-react';
import { API_BASE } from '../config';

// Helper nhận diện nhanh URL & Playlist
function detectUrlType(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  if (trimmed.includes('youtube.com/playlist') || (trimmed.includes('youtube.com/watch') && trimmed.includes('list='))) {
    return { type: 'youtube_playlist', label: 'YouTube Playlist', isPlaylist: true };
  }
  if (trimmed.includes('spotify.com/playlist/') || trimmed.includes('spotify.com/album/')) {
    return { type: 'spotify_playlist', label: 'Spotify Playlist / Album', isPlaylist: true };
  }
  if (trimmed.includes('spotify.com/track/')) {
    return { type: 'spotify_track', label: 'Spotify Track', isPlaylist: false };
  }
  if (trimmed.includes('soundcloud.com/') && (trimmed.includes('/sets/') || trimmed.includes('/sets'))) {
    return { type: 'soundcloud_playlist', label: 'SoundCloud Playlist', isPlaylist: true };
  }
  if (trimmed.includes('soundcloud.com/')) {
    return { type: 'soundcloud_track', label: 'SoundCloud Track', isPlaylist: false };
  }
  return { type: 'direct_url', label: 'Liên kết âm nhạc', isPlaylist: false };
}

function getPlaylistPreviewImage(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (match && match[1]) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  return null;
}

// Helper lấy ảnh bìa YouTube / Track chuẩn xác
function getTrackThumb(track) {
  if (track?.url) {
    const match = track.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) {
      return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
    }
  }
  if (track?.thumbnail && !track.thumbnail.includes('yt3.ggpht.com') && !track.thumbnail.includes('default_user')) {
    return track.thumbnail;
  }
  return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120';
}

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

export default function LiveSearch({ onOrderSong, player }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');
  const [historyTimeFilter, setHistoryTimeFilter] = useState('all'); // 'all', 'today', 'yesterday', 'older'
  const debounceRef = useRef(null);

  const detected = useMemo(() => detectUrlType(query), [query]);

  // Live Search Effect với Debounce 250ms
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    if (detected?.isPlaylist) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(trimmed)}&limit=8`);
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
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query, detected?.isPlaylist]);

  const handleOrderTrack = (track) => {
    onOrderSong(track);
  };

  const handleAddPlaylistUrl = (url) => {
    onOrderSong({ url: url || query.trim(), isPlaylist: true });
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      if (detected?.isPlaylist) {
        handleAddPlaylistUrl(query.trim());
      } else if (results.length > 0) {
        handleOrderTrack(results[0]);
      } else if (query.trim().startsWith('http')) {
        handleOrderTrack({ url: query.trim() });
        setQuery('');
      }
    }
  };

  // Dữ liệu thực tế từ Player State
  const favorites = player?.favorites || [];
  const history = player?.history || [];
  const topTracks = player?.topTracks || [];
  const recentPlaylists = player?.recentPlaylists || [];

  const hasAnyData = favorites.length > 0 || history.length > 0 || topTracks.length > 0 || recentPlaylists.length > 0;

  // Lọc lịch sử theo Text & Thời gian
  const filteredHistory = useMemo(() => {
    let list = history;

    // Lọc theo khoảng thời gian
    if (historyTimeFilter !== 'all') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfYesterday = startOfToday - 86400000;

      list = list.filter((t) => {
        if (!t.playedAt) return false;
        const time = new Date(t.playedAt).getTime();
        if (isNaN(time)) return false;

        if (historyTimeFilter === 'today') {
          return time >= startOfToday;
        }
        if (historyTimeFilter === 'yesterday') {
          return time >= startOfYesterday && time < startOfToday;
        }
        if (historyTimeFilter === 'older') {
          return time < startOfYesterday;
        }
        return true;
      });
    }

    // Lọc theo Text
    if (historyFilter.trim()) {
      const q = historyFilter.toLowerCase().trim();
      list = list.filter(
        (t) =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.requesterName && t.requesterName.toLowerCase().includes(q))
      );
    }

    return list;
  }, [history, historyFilter, historyTimeFilter]);

  return (
    <div className="flex flex-col gap-4 animate-in fade-in">
      {/* Search Bar */}
      <div className="relative flex items-center">
        <Search className="w-5 h-5 absolute left-4 text-anna-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tìm bài hát, ca sĩ, dán link YouTube / Spotify / Playlist..."
          className="w-full bg-anna-surface border border-anna-border focus:border-anna-accent rounded-2xl pl-12 pr-12 py-3.5 text-sm text-white placeholder-anna-muted focus:outline-none focus:ring-2 focus:ring-anna-accent/30 transition shadow-inner"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Xóa nội dung tìm kiếm"
            className="absolute right-4 text-anna-muted hover:text-white focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none rounded-lg p-1 transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Instant Playlist Detection Banner */}
      {detected?.isPlaylist && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-anna-accent/25 via-purple-600/20 to-pink-500/20 border border-anna-accent/40 shadow-xl flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Playlist Artwork Thumbnail */}
            <div className="w-12 h-12 rounded-xl overflow-hidden relative flex-shrink-0 bg-anna-card border border-white/10 shadow-lg group">
              {getPlaylistPreviewImage(query) ? (
                <img
                  src={getPlaylistPreviewImage(query)}
                  alt="Ảnh Playlist"
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-anna-accent to-purple-600 flex items-center justify-center text-white">
                  <Disc3 className="w-6 h-6 animate-spin" style={{ animationDuration: '8s' }} />
                </div>
              )}
              <div className="absolute inset-0 bg-black/20 ring-1 ring-inset ring-white/10 rounded-xl pointer-events-none"></div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {detected.label}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-anna-green/20 border border-anna-green/30 text-anna-green font-bold">
                  Sẵn sàng thêm
                </span>
              </div>
              <p className="text-xs text-anna-muted truncate mt-0.5 max-w-md font-mono">
                {query}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleAddPlaylistUrl(query.trim())}
            className="px-4 py-2.5 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition flex items-center gap-2 flex-shrink-0 shadow-lg shadow-anna-accent/30 active:scale-95"
          >
            <ListPlus className="w-4 h-4" />
            <span>Thêm Cả Playlist</span>
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <div className="bg-anna-surface border border-anna-border/80 rounded-3xl p-5 sm:p-6 pb-8 flex flex-col gap-6 relative">
        
        {/* Loading Overlay */}
        {loading && (
          <div
            className="absolute inset-0 bg-anna-surface/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2 rounded-3xl animate-in fade-in"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-8 h-8 text-anna-accent animate-spin" />
            <span className="text-xs font-semibold text-white">Đang tìm kiếm bài hát...</span>
          </div>
        )}

        {/* 1. Live Search Results */}
        {query.trim() && !detected?.isPlaylist ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-anna-muted flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-anna-accent" />
                <span>Kết Quả Tìm Kiếm ({results.length})</span>
              </h3>
            </div>

            {results.length === 0 && !loading ? (
              <div className="p-8 text-center text-anna-muted">
                <p className="text-sm font-semibold text-white">Không tìm thấy bài hát</p>
                <p className="text-xs text-anna-muted mt-1">
                  Hãy thử gõ tên bài hát khác hoặc dán trực tiếp đường link YouTube/Spotify vào ô tìm kiếm nhé!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {results.map((song) => (
                  <div
                    key={song.id || song.url}
                    onClick={() => handleOrderTrack(song)}
                    className="group flex items-center justify-between p-2.5 rounded-2xl bg-anna-card/60 hover:bg-anna-card border border-anna-border/40 hover:border-anna-accent/50 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                      <div className="w-11 h-11 rounded-xl overflow-hidden relative flex-shrink-0 bg-anna-surface border border-anna-border/60">
                        <img
                          src={song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120'}
                          alt={song.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition flex items-center justify-center">
                          <Play className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition fill-white" />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-anna-accent transition">
                          {song.title}
                        </h4>
                        <p className="text-[11px] text-anna-muted truncate mt-0.5">
                          {song.artist && song.artist !== 'Unknown' ? song.artist : 'YouTube Music'}
                          {song.duration ? ` • ${song.duration}` : ''}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOrderTrack(song);
                      }}
                      className="w-8 h-8 rounded-xl bg-anna-accent/10 hover:bg-anna-accent text-anna-accent hover:text-white border border-anna-accent/30 hover:border-transparent flex items-center justify-center transition active:scale-95 flex-shrink-0"
                      title="Thêm vào hàng chờ"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Hub Landing Sections khi không gõ tìm kiếm */
          <div className="flex flex-col gap-6">
            
            {/* 2. Recently Played Horizontal Carousel */}
            {history.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-anna-muted flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-anna-cyan" />
                    <span>Nghe Gần Đây</span>
                  </h3>
                  
                  {/* Nút Xem Tất Cả Lịch Sử */}
                  <button
                    onClick={() => setShowHistoryModal(true)}
                    className="text-xs font-bold text-anna-accent hover:text-white transition flex items-center gap-1 group py-1 px-2 rounded-lg hover:bg-anna-card"
                  >
                    <span>Lịch sử phòng nhạc</span>
                    <ChevronRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition" />
                  </button>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x scrollbar-thin">
                  {history.slice(0, 10).map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOrderTrack(item)}
                      className="group flex-shrink-0 w-32 sm:w-36 flex flex-col gap-2 p-2 rounded-2xl bg-anna-card/50 hover:bg-anna-card border border-anna-border/40 hover:border-anna-accent/50 transition cursor-pointer snap-start"
                    >
                      <div className="w-full aspect-square rounded-xl overflow-hidden relative bg-anna-surface border border-anna-border/60">
                        <img
                          src={getTrackThumb(item)}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition"></div>
                        <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-anna-accent text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg translate-y-1 group-hover:translate-y-0">
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-anna-accent transition">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-anna-muted truncate mt-0.5">
                          {item.artist || 'YouTube Music'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Recent Playlists Horizontal Carousel */}
            {recentPlaylists.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-anna-muted flex items-center gap-1.5">
                    <Disc3 className="w-3.5 h-3.5 text-anna-pink" />
                    <span>Playlist Đã Thêm Gần Đây</span>
                  </h3>
                  <span className="text-[10px] text-anna-muted">Lưu tự động</span>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x scrollbar-thin">
                  {recentPlaylists.slice(0, 8).map((pl, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleAddPlaylistUrl(pl.url)}
                      className="group flex-shrink-0 w-32 sm:w-36 flex flex-col gap-2 p-2 rounded-2xl bg-anna-card/50 hover:bg-anna-card border border-anna-border/40 hover:border-anna-pink/50 transition cursor-pointer snap-start"
                    >
                      <div className="w-full aspect-square rounded-xl overflow-hidden relative bg-gradient-to-tr from-anna-accent/40 via-purple-600/40 to-pink-500/40 border border-white/10 flex items-center justify-center">
                        {pl.thumbnail ? (
                          <img
                            src={pl.thumbnail}
                            alt={pl.title || 'Playlist'}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <Disc3 className="w-8 h-8 text-white/80 group-hover:rotate-45 transition duration-300" />
                        )}
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition"></div>
                        <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-anna-pink text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg translate-y-1 group-hover:translate-y-0">
                          <ListPlus className="w-3.5 h-3.5" />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-anna-pink transition">
                          {pl.title || 'Danh sách phát'}
                        </h4>
                        <p className="text-[11px] text-anna-muted truncate mt-0.5">
                          {pl.itemCount ? `${pl.itemCount} bài hát` : 'Playlist'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Top Most Played Songs */}
            {topTracks.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-anna-muted flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Top Bài Hát Nghe Nhiều Nhất</span>
                  </h3>
                  <span className="text-[10px] text-anna-muted">Thống kê máy chủ</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {topTracks.slice(0, 6).map((track, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleOrderTrack(track)}
                      className="group flex items-center justify-between p-2.5 rounded-2xl bg-anna-card/50 hover:bg-anna-card border border-anna-border/40 hover:border-amber-400/50 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                        <span className="w-5 text-center text-xs font-mono font-bold text-amber-400 flex-shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="w-10 h-10 rounded-xl overflow-hidden relative flex-shrink-0 bg-anna-surface border border-anna-border/60">
                          <img
                            src={getTrackThumb(track)}
                            alt={track.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition">
                            {track.title}
                          </h4>
                          <p className="text-[11px] text-anna-muted truncate mt-0.5">
                            {track.artist || 'YouTube Music'}
                            {track.playCount ? ` • ${track.playCount} lượt nghe` : ''}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOrderTrack(track);
                        }}
                        className="w-8 h-8 rounded-xl bg-amber-400/10 hover:bg-amber-400 text-amber-400 hover:text-black border border-amber-400/30 hover:border-transparent flex items-center justify-center transition active:scale-95 flex-shrink-0"
                        title="Phát bài này"
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State khi mới cài bot chưa có dữ liệu */}
            {!hasAnyData && (
              <div className="py-16 flex flex-col items-center justify-center text-center p-6 text-anna-muted">
                <div className="w-16 h-16 rounded-3xl bg-anna-card border border-anna-border flex items-center justify-center mb-4 shadow-inner">
                  <Music className="w-8 h-8 text-anna-accent" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Bắt đầu khám phá âm nhạc</h3>
                <p className="text-xs text-anna-muted max-w-sm">
                  Gõ tên bài hát hoặc dán link YouTube/Spotify ở thanh trên để thêm vào hàng chờ nhé!
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Spotify-grade History Modal (Lịch Sử Phòng Nhạc) */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#131418] border border-white/10 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200 relative">
            
            {/* Ambient Violet Glow */}
            <div className="absolute -top-20 -left-20 w-48 h-48 bg-anna-accent/20 rounded-full blur-3xl pointer-events-none"></div>

            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 z-10 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-anna-accent/15 border border-anna-accent/30 text-anna-accent flex items-center justify-center shadow-inner flex-shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-white">Lịch Sử Phòng Nhạc</h3>
                    <span className="text-[10px] font-bold text-anna-accent bg-anna-accent/10 border border-anna-accent/20 px-2.5 py-0.5 rounded-full">
                      {history.length} bài đã phát
                    </span>
                  </div>
                  <p className="text-[11px] text-anna-muted mt-0.5">
                    Các bài hát đã được phát gần đây trong phòng thoại của máy chủ
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowHistoryModal(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-anna-muted hover:text-white border border-white/10 transition flex items-center justify-center active:scale-95"
                title="Đóng cửa sổ"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 z-10 flex-shrink-0">
              <div className="relative flex-1 flex items-center">
                <Search className="w-4 h-4 absolute left-3.5 text-anna-muted pointer-events-none" />
                <input
                  type="text"
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                  placeholder="Lọc theo tên bài hát, nghệ sĩ..."
                  className="w-full bg-[#1c1e24] border border-white/10 text-white placeholder-anna-muted text-xs rounded-xl pl-9 pr-8 py-2.5 focus:outline-none focus:border-anna-accent transition"
                />
                {historyFilter && (
                  <button
                    onClick={() => setHistoryFilter('')}
                    className="absolute right-3 text-anna-muted hover:text-white p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Time Filter Pills */}
              <div className="flex items-center gap-1 bg-[#1c1e24] p-1 rounded-xl border border-white/10 flex-shrink-0">
                {[
                  { key: 'all', label: 'Tất cả' },
                  { key: 'today', label: 'Hôm nay' },
                  { key: 'yesterday', label: 'Hôm qua' },
                  { key: 'older', label: 'Cũ hơn' }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setHistoryTimeFilter(tab.key)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition active:scale-95 ${
                      historyTimeFilter === tab.key
                        ? 'bg-anna-accent text-white shadow-sm'
                        : 'text-anna-muted hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* History Track List */}
            <div className="flex-1 overflow-y-auto max-h-[50vh] flex flex-col gap-1.5 pr-1 z-10 scrollbar-thin">
              {filteredHistory.length === 0 ? (
                <div className="py-14 flex flex-col items-center justify-center text-center text-anna-muted">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <Music2 className="w-6 h-6 text-anna-muted" />
                  </div>
                  <p className="text-xs font-bold text-white">
                    {historyFilter ? 'Không tìm thấy bài hát phù hợp' : 'Chưa có bài hát trong khoảng thời gian này'}
                  </p>
                  <p className="text-[11px] text-anna-muted mt-1 max-w-xs">
                    {historyFilter ? 'Hãy thử tìm bằng từ khóa khác hoặc xóa bộ lọc.' : 'Các bài hát phát trong voice chat sẽ tự động lưu vào đây.'}
                  </p>
                </div>
              ) : (
                filteredHistory.map((track, idx) => (
                  <div
                    key={idx}
                    className="group flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-anna-accent/40 transition duration-150"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                      {/* Track Number / Play Icon on Hover */}
                      <div className="w-7 text-center flex-shrink-0 flex items-center justify-center">
                        <span className="text-xs font-mono font-bold text-anna-muted/70 group-hover:hidden">
                          {idx + 1}
                        </span>
                        <button
                          onClick={() => {
                            handleOrderTrack(track);
                            setShowHistoryModal(false);
                          }}
                          className="w-6 h-6 rounded-full bg-anna-accent text-white hidden group-hover:flex items-center justify-center shadow-md shadow-anna-accent/30 transform hover:scale-110 active:scale-95 transition"
                          title="Phát bài này"
                        >
                          <Play className="w-3 h-3 fill-current ml-0.5" />
                        </button>
                      </div>

                      {/* Thumbnail */}
                      <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-anna-card border border-white/10 relative">
                        <img
                          src={getTrackThumb(track)}
                          alt={track.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      </div>

                      {/* Title & Artist & Timestamp */}
                      <div className="min-w-0 flex-1">
                        <h4
                          onClick={() => {
                            handleOrderTrack(track);
                            setShowHistoryModal(false);
                          }}
                          className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-anna-accent cursor-pointer transition"
                        >
                          {track.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-anna-muted">
                          <span className="truncate max-w-[120px] sm:max-w-[200px]">
                            {track.artist && track.artist !== 'Unknown' ? track.artist : 'YouTube Music'}
                          </span>
                          <span>•</span>
                          <span className="text-[10px] text-anna-muted/80">
                            {formatRelativeTime(track.playedAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Play Button */}
                    <button
                      onClick={() => {
                        handleOrderTrack(track);
                        setShowHistoryModal(false);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition flex items-center gap-1.5 active:scale-95 shadow-md shadow-anna-accent/25 flex-shrink-0"
                    >
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                      <span>Phát Lại</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer Note */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-anna-muted/70 z-10 flex-shrink-0">
              <span>Tự động lưu 100 bài hát phát gần nhất</span>
              <span>Bấm phát lại để nối tiếp vào hàng chờ</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
