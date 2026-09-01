import React, { useState } from 'react';
import { Disc, Key, Share2, Check } from 'lucide-react';

export default function Navbar({ guild, user, activeWebUsers = [], onOpenAuthModal }) {
  const [copied, setCopied] = useState(false);

  const copyWebLink = () => {
    const token = localStorage.getItem('anna_web_token');
    const guildId = localStorage.getItem('anna_guild_id');
    const link = token && guildId ? `${window.location.origin}/?token=${token}&guild=${guildId}` : window.location.href;
    
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const otherUsers = (activeWebUsers || []).filter(u => u.userId && user && String(u.userId) !== String(user.userId));

  return (
    <header className="sticky top-0 z-40 bg-anna-surface/80 backdrop-blur-xl border-b border-anna-border/60 px-4 lg:px-8 py-3 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Brand & Server Info */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl overflow-visible">
            <img
              src="/logo.jpg"
              alt="Anna Music Logo"
              className="w-10 h-10 rounded-xl object-cover shadow-lg shadow-anna-accent/20 border border-white/10"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-anna-green border-2 border-anna-surface"></span>
          </div>
          <div>
            <h1 className="font-extrabold text-white text-base tracking-wide flex items-center gap-2">
              ANNA MUSIC
            </h1>
            <p className="text-xs text-anna-muted font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${user ? 'bg-anna-green animate-pulse' : 'bg-anna-muted'}`} aria-hidden="true"></span>
              {guild?.name || (user ? 'Đang kết nối Server...' : 'Anna Music Web Player')}
            </p>
          </div>
        </div>

        {/* User Profile / Action Buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Share Link Button */}
          <button
            onClick={copyWebLink}
            aria-label="Sao chép liên kết Web Player"
            title="Sao chép liên kết phiên Web"
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-anna-card hover:bg-anna-hover text-anna-text hover:text-white border border-anna-border/80 text-xs font-semibold transition flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-anna-green" aria-hidden="true" />
                <span className="hidden sm:inline text-anna-green">Đã sao chép!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Chia sẻ Link</span>
              </>
            )}
          </button>

          {user ? (
            <div className="flex items-center gap-2.5 bg-anna-card border border-anna-border/80 px-3 py-1.5 rounded-full shadow-sm">
              {/* Stack Avatar: chính chủ chồng lên các user khác */}
              <div className="flex items-center -space-x-2 relative">
                {/* Avatar các user khác đang xem Web */}
                {otherUsers.slice(0, 3).map((other, idx) => (
                  <img
                    key={other.userId || idx}
                    src={other.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                    alt={`Avatar của ${other.displayName || other.username}`}
                    title={`${other.displayName || other.username} (Đang xem Web)`}
                    className="w-6 h-6 rounded-full ring-2 ring-anna-surface object-cover transition-transform duration-200 hover:scale-125 hover:z-30 cursor-pointer opacity-75 hover:opacity-100"
                  />
                ))}

                {/* Avatar chính chủ (ở trên cùng) */}
                <img
                  src={user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                  alt={`Avatar của ${user.displayName}`}
                  title={`${user.displayName || user.username} (Bạn)`}
                  className="w-6 h-6 rounded-full ring-2 ring-anna-accent object-cover transition-transform duration-200 hover:scale-110 z-20 shadow-sm"
                />
              </div>

              <span className="text-xs font-semibold text-white max-w-[120px] truncate">
                {user.displayName || user.username}
              </span>
              <span className="text-[10px] bg-anna-accent/20 text-anna-accent px-1.5 py-0.5 rounded font-bold">
                {otherUsers.length > 0 ? `${otherUsers.length + 1} ONLINE` : 'ONLINE'}
              </span>
            </div>
          ) : (
            <div className="text-xs text-anna-muted font-medium px-3 py-1.5 rounded-full bg-anna-card border border-anna-border/60">
              Chưa kết nối
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
