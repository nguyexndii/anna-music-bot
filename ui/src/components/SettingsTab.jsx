import React from 'react';
import { Sliders, Radio, Sparkles } from 'lucide-react';

export default function SettingsTab({ player, onAction }) {
  return (
    <div className="bg-anna-surface border border-anna-border/80 rounded-2xl p-6 flex-1 flex flex-col gap-5">
      <h3 className="text-sm font-bold text-white flex items-center gap-2">
        <Sliders className="w-4 h-4 text-anna-accent" />
        <span>Cài Đặt Phát Nhạc Server</span>
      </h3>

      {/* 24/7 Lofi Mode */}
      <div className="flex items-center justify-between p-3.5 rounded-xl bg-anna-card border border-anna-border">
        <div className="pr-4">
          <p className="text-xs font-bold text-white flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-anna-pink" />
            <span>Chế độ Treo Lofi 24/7</span>
          </p>
          <p className="text-[11px] text-anna-muted mt-0.5">
            Tự động phát Lofi thư giãn khi không có người nghe hoặc hết bài hát trong hàng chờ.
          </p>
        </div>

        <button
          onClick={() => onAction('toggle247')}
          className={`w-11 h-6 rounded-full relative p-0.5 transition flex-shrink-0 ${
            player?.mode247 ? 'bg-anna-pink' : 'bg-anna-border'
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full bg-white transition-transform ${
              player?.mode247 ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          ></div>
        </button>
      </div>

      {/* Autoplay DJ AI */}
      <div className="flex items-center justify-between p-3.5 rounded-xl bg-anna-card border border-anna-border">
        <div className="pr-4">
          <p className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-anna-green" />
            <span>DJ AI Tự Động Gợi Ý (Autoplay)</span>
          </p>
          <p className="text-[11px] text-anna-muted mt-0.5">
            Tự động chọn bài hát tương tự phù hợp khi còn người trong phòng Voice.
          </p>
        </div>

        <button
          className="w-11 h-6 rounded-full bg-anna-green relative p-0.5 transition flex-shrink-0"
        >
          <div className="w-5 h-5 rounded-full bg-white transition-transform translate-x-5"></div>
        </button>
      </div>
    </div>
  );
}
