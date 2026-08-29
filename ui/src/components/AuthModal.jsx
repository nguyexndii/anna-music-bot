import React, { useState } from 'react';
import { Key } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, onSubmitToken }) {
  const [tokenInput, setTokenInput] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-anna-surface border border-anna-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-anna-accent/10 border border-anna-accent/20 text-anna-accent flex items-center justify-center mx-auto">
          <Key className="w-6 h-6" />
        </div>
        <div className="text-center">
          <h3 className="text-base font-bold text-white">Đăng Nhập Magic Token (.web)</h3>
          <p className="text-xs text-anna-muted mt-1">
            Gõ lệnh <code className="bg-anna-card px-1.5 py-0.5 rounded text-anna-accent font-bold">.web</code> trong Discord để nhận liên kết riêng tư kèm Avatar của bạn!
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-anna-muted uppercase">
            Hoặc dán Token trực tiếp:
          </label>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Dán mã Token nhận từ bot..."
            className="w-full bg-anna-card border border-anna-border focus:border-anna-accent rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-anna-muted focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl bg-anna-card hover:bg-anna-hover text-anna-text text-xs font-bold transition"
          >
            Đóng
          </button>
          <button
            onClick={() => {
              if (tokenInput.trim()) onSubmitToken(tokenInput.trim());
            }}
            className="flex-1 py-2 rounded-xl bg-anna-accent hover:bg-anna-accentHover text-white text-xs font-bold transition shadow-md shadow-anna-accent/20"
          >
            Xác Nhận
          </button>
        </div>
      </div>
    </div>
  );
}
