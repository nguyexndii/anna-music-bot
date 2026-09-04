import React, { useState, useEffect, useCallback, useRef } from 'react';
import HeroPlayer from './components/HeroPlayer';
import LiveSearch from './components/LiveSearch';
import QueueManager from './components/QueueManager';
import SyncedLyrics from './components/SyncedLyrics';
import SettingsTab from './components/SettingsTab';
import HistoryTab from './components/HistoryTab';
import PermissionModal from './components/PermissionModal';
import ConnectingStepper from './components/ConnectingStepper';
import Toast from './components/Toast';
import { Search, ListMusic, Mic2, Settings, History, AlertCircle } from 'lucide-react';
import { API_BASE } from './config';

// ─── Rail tab definitions ────────────────────────────────────────────────────
const TABS = [
  { id: 'search',   label: 'Khám Phá', Icon: Search    },
  { id: 'queue',    label: 'Hàng Chờ', Icon: ListMusic  },
  { id: 'lyrics',   label: 'Lời Nhạc', Icon: Mic2       },
  { id: 'history',  label: 'Lịch Sử',  Icon: History    },
  { id: 'settings', label: 'Cài Đặt',  Icon: Settings   },
];

// ─── Brand Logo Mark ────────────────────────────────────────────────────────
function BrandMark({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="brand-logo-btn group"
      title="Về trang Khám Phá"
      aria-label="Về trang Khám Phá"
    >
      <img src="/logo.jpg" alt="Anna Logo" className="brand-logo-img" />
      <div className="brand-mark-text">
        <span className="y">an</span><span className="c">na</span>
      </div>
    </button>
  );
}

// ─── PIN / Auth screen ───────────────────────────────────────────────────────
function AuthScreen({ onVerify, authError, isVerifying }) {
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState('');
  const error = localError || authError;

  const submit = (e) => {
    e.preventDefault();
    setLocalError('');
    let val = e.target.tokenInput.value.trim();
    if (val.includes('token=')) {
      try {
        const parsed = new URL(val);
        val = parsed.searchParams.get('token') || val;
      } catch {
        const m = val.match(/token=([a-zA-Z0-9._-]+)/);
        if (m) val = m[1];
      }
    }
    if (!val) return;
    localStorage.removeItem('anna_web_token');
    onVerify(val, true);
  };

  return (
    <main className="auth-shell">
      <div className="auth-brand">
        <img src="/logo.jpg" alt="Anna Music" style={{ width: 54, height: 54, borderRadius: 16, margin: '0 auto 12px', border: '1px solid var(--border)', objectFit: 'cover' }} />
        <div className="brand-name"><span className="y">an</span><b className="c">na</b></div>
        <div className="brand-subtitle">MUSIC WEB PLAYER</div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="card-kicker">KẾT NỐI TÀI KHOẢN</div>
        <h1>Nhập mã PIN</h1>
        <p className="card-copy">Dùng lệnh <code style={{color:'var(--yellow)'}}>/web</code> trong Discord để nhận mã 6 số</p>
        <label className="pin-label" htmlFor="tokenInput">MÃ PIN</label>
        <input
          id="tokenInput"
          name="tokenInput"
          autoFocus
          inputMode="numeric"
          maxLength={30}
          value={pin}
          onChange={e => { setPin(e.target.value); setLocalError(''); }}
          placeholder="Nhập PIN 6 số..."
        />
        <div className="pin-digits" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={pin[i] ? 'filled' : ''}></span>
          ))}
        </div>
        {error && <p className="form-error"><AlertCircle size={12} style={{display:'inline',marginRight:4}} />{error}</p>}
        <button className="primary-button" type="submit" disabled={isVerifying}>
          {isVerifying ? 'Đang kết nối...' : 'Kết Nối'}
        </button>
        <p className="card-footnote">Mã PIN chỉ có hiệu lực trong phiên hiện tại.</p>
      </form>
      <footer className="auth-footer">ANNA MUSIC · 2024</footer>
    </main>
  );
}

// ─── No Voice screen ─────────────────────────────────────────────────────────
function NoVoiceScreen({ user, onRefresh, isRefreshing, onLogout }) {
  return (
    <main className="auth-shell">
      <div className="auth-brand">
        <img src="/logo.jpg" alt="Anna Music" style={{ width: 54, height: 54, borderRadius: 16, margin: '0 auto 12px', border: '1px solid var(--border)', objectFit: 'cover' }} />
        <div className="brand-name"><span className="y">an</span><b className="c">na</b></div>
        <div className="brand-subtitle">MUSIC WEB PLAYER</div>
      </div>
      <section className="auth-card voice-card">
        <div className="quiet-shape" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        <div className="card-kicker">PHIÊN KẾT NỐI</div>
        <h1>Chưa ở trong kênh Voice</h1>
        <p className="card-copy">
          Để sử dụng web player, bạn cần tham gia một kênh thoại (Voice Channel) trên Discord trước. Bot và bạn phải ở cùng kênh.
        </p>
        {user?.guildName && (
          <div className="server-badge">{user.guildName.toUpperCase()}</div>
        )}
        <div className="voice-actions">
          <button className="primary-button" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? 'Đang kiểm tra...' : 'Thử Lại'}
          </button>
          <button className="ghost-button" onClick={onLogout}>
            Đổi Mã PIN
          </button>
        </div>
        <p className="hint">Sau khi vào kênh Voice, nhấn Thử Lại để đồng bộ.</p>
      </section>
      <footer className="auth-footer">ANNA MUSIC · 2024</footer>
    </main>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => {
    const u = new URLSearchParams(window.location.search);
    return u.get('token') || localStorage.getItem('anna_web_token') || null;
  });
  const [guildId, setGuildId] = useState(() => {
    const u = new URLSearchParams(window.location.search);
    return u.get('guild') || localStorage.getItem('anna_guild_id') || null;
  });

  const [user, setUser]                   = useState(null);
  const [guild, setGuild]                 = useState(null);
  const [player, setPlayer]               = useState(null);
  const [activeWebUsers, setActiveWebUsers] = useState([]);
  const [activeTab, setActiveTab]         = useState('search');
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [authError, setAuthError]         = useState(null);
  const [isVerifying, setIsVerifying]     = useState(true);
  const [isRefreshingVoice, setIsRefreshingVoice] = useState(false);
  const [toasts, setToasts]               = useState([]);

  // Toast stack manager (supports quick repetitive clicks independently)
  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2800);
  }, []);

  const handleDismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleAuthExpired = useCallback((msg = 'Phiên làm việc đã hết hạn. Vui lòng kết nối lại!') => {
    setUser(null); setToken(null);
    localStorage.removeItem('anna_web_token');
    showToast(msg, 'error');
    setAuthError(msg);
  }, [showToast]);

  const handleLogout = () => {
    setUser(null); setToken(null);
    localStorage.removeItem('anna_web_token');
    localStorage.removeItem('anna_guild_id');
    setAuthError(null);
  };

  // 1. Verify token/PIN with smooth min delay (800ms)
  const verifyToken = useCallback((tokenToVerify, isUserInitiated = false) => {
    if (!tokenToVerify) { setIsVerifying(false); return; }
    setIsVerifying(true);
    if (isUserInitiated) setAuthError(null);
    const startTime = Date.now();
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 7000);
    fetch(`${API_BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenToVerify }),
      signal: controller.signal,
    })
      .then(async res => {
        clearTimeout(tid);
        const data = await res.json().catch(() => ({}));
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, 700 - elapsed);
        setTimeout(() => {
          setIsVerifying(false);
          if (res.ok && data.success && data.user) {
            const sess = data.token || tokenToVerify;
            setUser(data.user); setGuildId(data.user.guildId); setToken(sess);
            localStorage.setItem('anna_web_token', sess);
            localStorage.setItem('anna_guild_id', data.user.guildId);
            setAuthError(null);
          } else {
            setUser(null); setToken(null);
            localStorage.removeItem('anna_web_token');
            localStorage.removeItem('anna_guild_id');
            if (isUserInitiated) setAuthError(data.error || 'Mã PIN không đúng hoặc đã hết hạn.');
            else setAuthError(null);
          }
        }, delay);
      })
      .catch(err => {
        clearTimeout(tid);
        setIsVerifying(false);
        setUser(null); setToken(null);
        localStorage.removeItem('anna_web_token');
        localStorage.removeItem('anna_guild_id');
        if (isUserInitiated)
          setAuthError(err.name === 'AbortError' ? 'Kết nối quá thời gian!' : 'Không thể kết nối đến máy chủ bot!');
        else setAuthError(null);
      });
  }, []);

  // 2. URL token on mount
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const tok = u.get('token'); const gld = u.get('guild');
    if (tok) {
      setToken(tok); localStorage.setItem('anna_web_token', tok);
      if (gld) { setGuildId(gld); localStorage.setItem('anna_guild_id', gld); }
      verifyToken(tok, true);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const saved = localStorage.getItem('anna_web_token');
      if (saved) {
        verifyToken(saved, false);
      } else {
        setTimeout(() => setIsVerifying(false), 500);
      }
    }
  }, [verifyToken]);

  // 3. Refresh voice session
  const handleRefreshVoice = () => {
    const tok = token || localStorage.getItem('anna_web_token');
    if (!tok) return;
    setIsRefreshingVoice(true);
    fetch(`${API_BASE}/api/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok }),
    })
      .then(async res => {
        if (res.status === 401) { setIsRefreshingVoice(false); handleAuthExpired('Phiên kết nối đã hết hạn!'); return; }
        const data = await res.json().catch(() => ({}));
        setIsRefreshingVoice(false);
        if (res.ok && data.success && data.user) {
          setUser(data.user);
          if (data.user.isInVoice) showToast('Đã kết nối phòng Voice thành công!');
          else showToast('Bạn chưa tham gia kênh Voice!', 'error');
        } else {
          setUser(null); setToken(null);
          localStorage.removeItem('anna_web_token');
          showToast(data.error || 'Phiên kết nối đã hết hạn!', 'error');
        }
      })
      .catch(() => { setIsRefreshingVoice(false); showToast('Không thể kết nối đến máy chủ bot!', 'error'); });
  };

  // 4. Poll state every 2s
  const fetchState = useCallback(() => {
    const cg = guildId || user?.guildId;
    const ct = token || localStorage.getItem('anna_web_token');
    if (!cg || !user) return;
    fetch(`${API_BASE}/api/guilds/${cg}/state`, {
      headers: ct ? { 'Authorization': `Bearer ${ct}` } : {},
    })
      .then(async res => {
        if (res.status === 401) { handleAuthExpired(); return; }
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          if (data.guild) setGuild(data.guild);
          if (data.player) setPlayer(data.player);
          if (data.activeWebUsers) setActiveWebUsers(data.activeWebUsers);
        }
      })
      .catch(() => {});
  }, [guildId, token, user, handleAuthExpired]);

  useEffect(() => {
    if (!user) return;
    fetchState();
    const iv = setInterval(fetchState, 2000);
    return () => clearInterval(iv);
  }, [user, fetchState]);

  // 5. Order song
  const handleOrderSong = async (track) => {
    const cg = guildId || user?.guildId;
    const ct = token || localStorage.getItem('anna_web_token');
    if (!cg || !ct) return;
    const title = track?.title || track?.name || (track?.isPlaylist ? 'Danh sách phát' : 'bài hát');
    try {
      showToast(`Đang thêm "${title}"...`, 'info');
      const res = await fetch(`${API_BASE}/api/guilds/${cg}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ct}` },
        body: JSON.stringify({ track, token: ct }),
      });
      if (res.status === 401) { handleAuthExpired(); return; }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.isPlaylist || data.addedCount || track?.isPlaylist) {
          const c = data.addedCount || (data.tracks ? data.tracks.length : '');
          showToast(`Đã thêm Playlist${c ? ` (${c} bài)` : ''} vào hàng chờ!`);
        } else {
          showToast(`Đã thêm "${data.track?.title || title}" vào hàng chờ!`);
        }
        fetchState();
      } else {
        showToast(data.error || 'Lỗi thêm bài hát', 'error');
        if (data.error?.includes('Voice')) handleRefreshVoice();
      }
    } catch { showToast('Không thể gửi yêu cầu đến bot!', 'error'); }
  };

  // 6. Player action
  const handlePlayerAction = async (action, value = null) => {
    const cg = guildId || user?.guildId;
    const ct = token || localStorage.getItem('anna_web_token');
    if (!cg || !ct) return;
    const adminOnly = ['toggle247','set247','settings','updateSettings'];
    if (adminOnly.includes(action) && !user?.isAdmin) { setIsPermissionModalOpen(true); return; }
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${cg}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ct}` },
        body: JSON.stringify({ action, value, token: ct }),
      });
      if (res.status === 401) { handleAuthExpired(); return; }
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || data.code === 'PERMISSION_DENIED') { setIsPermissionModalOpen(true); return; }
      if (res.ok && data.success) { if (data.message) showToast(data.message); fetchState(); }
      else showToast(data.error || 'Lỗi thao tác!', 'error');
    } catch { showToast('Lỗi gửi lệnh điều khiển!', 'error'); }
  };

  // Tab switching
  const switchTab = (id) => {
    if (id === activeTab) return;
    setActiveTab(id);
  };

  // ── Renders ─────────────────────────────────────────────────────────────────
  if (isVerifying) {
    return <ConnectingStepper />;
  }

  if (!user) {
    return (
      <AuthScreen
        onVerify={verifyToken}
        authError={authError}
        isVerifying={isVerifying}
      />
    );
  }

  if (!user.isInVoice || (!user.isSameVoice && user.botVoice)) {
    return (
      <NoVoiceScreen
        user={user}
        onRefresh={handleRefreshVoice}
        isRefreshing={isRefreshingVoice}
        onLogout={handleLogout}
      />
    );
  }

  const activeTabDef = TABS.find(t => t.id === activeTab);
  const otherUsers = (activeWebUsers || []).filter(u => u.userId && user && String(u.userId) !== String(user.userId));

  return (
    <div className="music-app">
      {/* ── Rail ─────────────────────────────────────── */}
      <aside className="rail">
        <BrandMark onClick={() => switchTab('search')} />
        <nav className="rail-nav" aria-label="Điều hướng">
          {TABS.map(({ id, label, Icon }) => {
            const queueCount = id === 'queue' ? (player?.queue?.length || 0) : 0;
            return (
              <button
                key={id}
                className={`rail-btn${activeTab === id ? ' active' : ''}`}
                onClick={() => switchTab(id)}
                aria-label={label}
                aria-pressed={activeTab === id}
                style={{ position: 'relative' }}
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon size={20} strokeWidth={1.6} />
                  {queueCount > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: -5,
                      right: -8,
                      background: 'var(--yellow)',
                      color: '#111',
                      fontSize: 9,
                      fontWeight: 800,
                      minWidth: 15,
                      height: 15,
                      borderRadius: 999,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 3px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                      fontFamily: '"DM Mono", monospace'
                    }}>
                      {queueCount > 99 ? '99+' : queueCount}
                    </span>
                  )}
                </div>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="rail-bottom">
          {otherUsers.slice(0, 3).map((u, i) => (
            <img
              key={u.userId || i}
              className="rail-avatar"
              src={u.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
              alt={u.displayName || u.username}
              title={`${u.displayName || u.username} (đang xem)`}
              style={{ opacity: 0.6 }}
            />
          ))}
          <img
            className="rail-avatar"
            src={user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
            alt={user.displayName}
            title={`${user.displayName || user.username} (bạn)`}
            style={{ borderColor: 'var(--yellow)' }}
          />
        </div>
      </aside>

      {/* ── Now Playing ───────────────────────────────── */}
      <section className="now-playing">
        <header className="now-topbar">
          <span className="now-eyebrow">ĐANG PHÁT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Online Users Avatar Stack */}
            <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row-reverse' }}>
              {(() => {
                const myUser = user ? [{ ...user, isMe: true }] : [];
                const otherUsers = (activeWebUsers || []).filter(u => u.userId !== user?.id && u.id !== user?.id && u.username !== user?.username);
                const allUsers = [...myUser, ...otherUsers];
                const maxVisible = 3;
                const visible = allUsers.slice(0, maxVisible);
                const extra = allUsers.length - maxVisible;

                return (
                  <>
                    {extra > 0 && (
                      <div
                        style={{
                          width: 22, height: 22, borderRadius: '50%', background: '#2a2d32',
                          border: '2px solid var(--paper)', display: 'grid', placeItems: 'center',
                          fontSize: 8.5, fontFamily: '"DM Mono", monospace', fontWeight: 700, color: 'var(--yellow)',
                          marginLeft: -7, zIndex: 1
                        }}
                        title={`+${extra} người khác đang online`}
                      >
                        +{extra > 9 ? '9+' : extra}
                      </div>
                    )}
                    {visible.reverse().map((u, i) => (
                      <img
                        key={u.id || u.userId || i}
                        src={u.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                        alt={u.displayName || u.username}
                        title={`${u.displayName || u.username || 'Người dùng'}${u.isMe ? ' (Bạn)' : ''}`}
                        style={{
                          width: 22, height: 22, borderRadius: '50%',
                          border: `2px solid ${u.isMe ? 'var(--yellow)' : 'var(--border)'}`,
                          objectFit: 'cover',
                          marginLeft: i > 0 ? -7 : 0,
                          zIndex: maxVisible - i + 2,
                          transition: 'transform 0.15s, z-index 0.15s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.25)'; e.currentTarget.style.zIndex = 20; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.zIndex = String(maxVisible - i + 2); }}
                      />
                    ))}
                  </>
                );
              })()}
            </div>
            <span className="now-eyebrow" style={{ color: 'var(--yellow)' }}>
              {Math.max(1, activeWebUsers?.length || 1)} ONLINE
            </span>
          </div>
        </header>
        <HeroPlayer
          player={player}
          onAction={handlePlayerAction}
          user={user}
          onRequireAdmin={() => setIsPermissionModalOpen(true)}
        />
      </section>

      {/* ── Content Panel ─────────────────────────────── */}
      <section className="content-panel">
        <header className="content-header">
          <h2 className="content-title">
            {activeTabDef?.label}
            {activeTab === 'queue' && (
              <span className="live-dot" title="Hàng chờ đang hoạt động" />
            )}
            {activeTab === 'search' && player?.isPlaying && (
              <span className="live-dot" title="Đang phát" />
            )}
          </h2>
          <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            {guild?.name || user?.guildName || ''}
          </span>
        </header>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div className="tab-enter" style={{ height: '100%', display: activeTab === 'search' ? 'flex' : 'none', flexDirection: 'column' }}>
            <LiveSearch onOrderSong={handleOrderSong} player={player} guildId={guildId} token={token} />
          </div>
          <div className="tab-enter" style={{ height: '100%', display: activeTab === 'queue' ? 'flex' : 'none', flexDirection: 'column' }}>
            <QueueManager queue={player?.queue} onAction={handlePlayerAction} />
          </div>
          <div className="tab-enter" style={{ height: '100%', display: activeTab === 'lyrics' ? 'flex' : 'none', flexDirection: 'column' }}>
            <SyncedLyrics player={player} onAction={handlePlayerAction} isActive={activeTab === 'lyrics'} />
          </div>
          <div className="tab-enter" style={{ height: '100%', display: activeTab === 'history' ? 'flex' : 'none', flexDirection: 'column' }}>
            <HistoryTab player={player} onOrderSong={handleOrderSong} />
          </div>
          <div className="tab-enter" style={{ height: '100%', display: activeTab === 'settings' ? 'flex' : 'none', flexDirection: 'column' }}>
            <SettingsTab
              guildId={guildId}
              guildName={guild?.name}
              token={token}
              player={player}
              user={user}
              onAction={handlePlayerAction}
              onRequireAdmin={() => setIsPermissionModalOpen(true)}
            />
          </div>
        </div>


        <footer className="panel-footer">
          <span>ANNA MUSIC</span>
          <span>WEB PLAYER</span>
        </footer>
      </section>

      {/* ── Modals / Toasts ───────────────────────────── */}
      <PermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        user={user}
      />
      <Toast toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
