import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import HeroPlayer from './components/HeroPlayer';
import LiveSearch from './components/LiveSearch';
import QueueManager from './components/QueueManager';
import SyncedLyrics from './components/SyncedLyrics';
import SettingsTab from './components/SettingsTab';
import AuthModal from './components/AuthModal';
import Toast from './components/Toast';
import { Search, ListMusic, Mic2, Settings } from 'lucide-react';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('anna_web_token') || null);
  const [guildId, setGuildId] = useState(() => localStorage.getItem('anna_guild_id') || null);
  const [user, setUser] = useState(null);
  const [guild, setGuild] = useState(null);
  const [player, setPlayer] = useState(null);
  const [activeTab, setActiveTab] = useState('search');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  }, []);

  // 1. Đọc Token từ URL Parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const guildFromUrl = urlParams.get('guild');

    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      localStorage.setItem('anna_web_token', tokenFromUrl);
    }
    if (guildFromUrl) {
      setGuildId(guildFromUrl);
      localStorage.setItem('anna_guild_id', guildFromUrl);
    }

    if (tokenFromUrl || guildFromUrl) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // 2. Xác thực Token
  useEffect(() => {
    if (!token) {
      setIsAuthModalOpen(true);
      return;
    }

    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.user) {
          setUser(data.user);
          setGuildId(data.user.guildId);
          localStorage.setItem('anna_guild_id', data.user.guildId);
          showToast(`Đã kết nối: @${data.user.displayName || data.user.username}!`);
          setIsAuthModalOpen(false);
        } else {
          setIsAuthModalOpen(true);
        }
      })
      .catch(() => {
        setIsAuthModalOpen(true);
      });
  }, [token, showToast]);

  // 3. Polling trạng thái nhạc (1.5s)
  const fetchState = useCallback(() => {
    if (!guildId) return;
    fetch(`/api/guilds/${guildId}/state`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          if (data.guild) setGuild(data.guild);
          if (data.player) setPlayer(data.player);
        }
      })
      .catch(() => {});
  }, [guildId]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1500);
    return () => clearInterval(interval);
  }, [fetchState]);

  // 4. Order Song từ Web
  const handleOrderSong = async (track) => {
    if (!guildId) {
      showToast('Vui lòng kết nối server trước khi order bài!', 'error');
      return;
    }
    if (!token) {
      setIsAuthModalOpen(true);
      return;
    }

    try {
      showToast(`Đang thêm "${track.title}"...`);
      const res = await fetch(`/api/guilds/${guildId}/play`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ track, token })
      });

      const data = await res.json();
      if (data.success) {
        showToast(`✅ ${data.message}`);
        fetchState();
      } else {
        showToast(`❌ ${data.error || 'Lỗi thêm bài'}`, 'error');
      }
    } catch (err) {
      showToast('Lỗi kết nối máy chủ!', 'error');
    }
  };

  // 5. Thao tác điều khiển Player
  const handlePlayerAction = async (action, value = null) => {
    if (!guildId) return;
    if (!token) {
      setIsAuthModalOpen(true);
      return;
    }

    try {
      const res = await fetch(`/api/guilds/${guildId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action, value, token })
      });

      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        fetchState();
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) {
      showToast('Lỗi gửi lệnh điều khiển!', 'error');
    }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-anna-accent selection:text-white">
      {/* Top Navbar */}
      <Navbar
        guild={guild}
        user={user}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      {/* Main Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Hero Player Deck (5 Cols) */}
        <div className="lg:col-span-5">
          <HeroPlayer player={player} onAction={handlePlayerAction} />
        </div>

        {/* Right Column: Tabs (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          
          {/* Tab Navigation Buttons */}
          <div className="flex items-center gap-2 bg-anna-surface p-1.5 rounded-2xl border border-anna-border/80 shadow-md overflow-x-auto">
            <button
              onClick={() => setActiveTab('search')}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 ${
                activeTab === 'search'
                  ? 'bg-anna-accent text-white shadow-sm shadow-anna-accent/20'
                  : 'text-anna-muted hover:text-white hover:bg-anna-card'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>Live Search</span>
            </button>

            <button
              onClick={() => setActiveTab('queue')}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 ${
                activeTab === 'queue'
                  ? 'bg-anna-accent text-white shadow-sm shadow-anna-accent/20'
                  : 'text-anna-muted hover:text-white hover:bg-anna-card'
              }`}
            >
              <ListMusic className="w-4 h-4" />
              <span>Hàng Chờ</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-anna-border text-white">
                {player?.queue?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('lyrics')}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 ${
                activeTab === 'lyrics'
                  ? 'bg-anna-accent text-white shadow-sm shadow-anna-accent/20'
                  : 'text-anna-muted hover:text-white hover:bg-anna-card'
              }`}
            >
              <Mic2 className="w-4 h-4" />
              <span>Lời Bài Hát</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95 ${
                activeTab === 'settings'
                  ? 'bg-anna-accent text-white shadow-sm shadow-anna-accent/20'
                  : 'text-anna-muted hover:text-white hover:bg-anna-card'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Active Tab Body */}
          {activeTab === 'search' && <LiveSearch onOrderSong={handleOrderSong} />}
          {activeTab === 'queue' && <QueueManager queue={player?.queue} onAction={handlePlayerAction} />}
          {activeTab === 'lyrics' && <SyncedLyrics guildId={guildId} currentTrack={player?.current} />}
          {activeTab === 'settings' && <SettingsTab player={player} onAction={handlePlayerAction} />}

        </div>

      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSubmitToken={(t) => {
          setToken(t);
          localStorage.setItem('anna_web_token', t);
        }}
      />

      {/* Toast Notification */}
      <Toast toast={toast} />
    </div>
  );
}
