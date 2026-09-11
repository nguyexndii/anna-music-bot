import React, { useEffect } from 'react';
import { ShieldAlert, Lock, X, Check } from 'lucide-react';

export default function PermissionModal({ isOpen, onClose, user }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-modal-title"
    >
      <div
        className="bg-[#12131a] border border-amber-500/30 w-full max-w-md rounded-3xl p-6 shadow-2xl shadow-amber-500/10 flex flex-col items-center text-center relative overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glowing Ambient Backdrop */}
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-amber-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-anna-pink/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-anna-muted hover:text-white p-1.5 rounded-full hover:bg-anna-hover transition z-10"
          aria-label="Đóng thông báo"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon with Glowing Ring */}
        <div className="relative my-2">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#181924] border border-amber-500/40 flex items-center justify-center text-amber-400 text-xs">
            <Lock className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* Modal Header */}
        <h3 id="permission-modal-title" className="text-lg font-bold text-white mt-3">
          Yêu Cầu Quyền Quản Trị Viên
        </h3>
        
        <p className="text-xs text-anna-muted mt-2 leading-relaxed px-2">
          Bạn không có quyền chỉnh sửa mục này. Chỉ <span className="text-white font-semibold">Chủ sở hữu máy chủ (Server Owner)</span> hoặc thành viên có quyền <span className="text-amber-400 font-semibold">Quản trị viên (Administrator / Manage Server)</span> mới có thể thay đổi Cài Đặt Phát Nhạc của Server.
        </p>

        {/* User Identity Chip */}
        <div className="w-full bg-[#181924] border border-anna-border/80 rounded-2xl p-3 mt-4 flex items-center gap-3 text-left">
          <img
            src={user?.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}
            alt=""
            className="w-10 h-10 rounded-xl object-cover border border-anna-border"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-white truncate">
              {user?.displayName || user?.username || 'Thành viên'}
            </div>
            <div className="text-[11px] text-anna-muted flex items-center gap-1 mt-0.5">
              <span className="inline-block w-2 h-2 rounded-full bg-anna-muted"></span>
              <span>Vai trò: <b className="text-anna-text">Thành viên thường</b></span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold whitespace-nowrap">
            Chỉ Xem
          </span>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full mt-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition active:scale-95"
        >
          <Check className="w-4 h-4" />
          <span>Đã hiểu</span>
        </button>
      </div>
    </div>
  );
}
