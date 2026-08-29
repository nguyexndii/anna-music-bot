import React from 'react';
import { Disc, Key } from 'lucide-react';

export default function Navbar({ guild, user, onOpenAuthModal }) {
  return (
    <header className="sticky top-0 z-40 bg-anna-surface/80 backdrop-blur-xl border-b border-anna-border/60 px-4 lg:px-8 py-3 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Brand & Server Info */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-anna-accent to-anna-pink text-white shadow-lg shadow-anna-accent/20">
            <Disc className="w-5 h-5 animate-spin-slow" />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-anna-green border-2 border-anna-surface"></span>
          </div>
          <div>
            <h1 className="font-extrabold text-white text-base tracking-wide flex items-center gap-2">
              ANNA MUSIC
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-anna-accent/20 text-anna-accent border border-anna-accent/30">
                WEB UI
              </span>
            </h1>
            <p className="text-xs text-anna-muted font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-anna-green animate-pulse"></span>
              {guild?.name || 'Đang kết nối Server Discord...'}
            </p>
          </div>
        </div>

        {/* User Profile / Auth Button */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2.5 bg-anna-card border border-anna-border/80 px-3 py-1.5 rounded-full shadow-sm">
              <img
                src={user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
                alt={user.displayName}
                className="w-6 h-6 rounded-full ring-1 ring-anna-border object-cover"
              />
              <span className="text-xs font-semibold text-white max-w-[120px] truncate">
                {user.displayName || user.username}
              </span>
              <span className="text-[10px] bg-anna-accent/20 text-anna-accent px-1.5 py-0.5 rounded font-bold">
                ONLINE
              </span>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="px-3.5 py-1.5 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition shadow-md shadow-anna-accent/20 flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Nhập Token (.web)</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
