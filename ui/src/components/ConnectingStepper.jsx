import React from 'react';
import { Check, Loader2, Volume2 } from 'lucide-react';

export default function ConnectingStepper({
  step = 4,
  statusText = 'Đang tải dữ liệu Player...',
  userVoiceName = null,
  guildName = null
}) {
  const steps = [
    { id: 1, label: 'Voice session' },
    { id: 2, label: 'Bot selection' },
    { id: 3, label: 'Connecting' },
    { id: 4, label: 'Player data' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-4 animate-in fade-in duration-300">
      {/* Breadcrumb style path */}
      <div className="text-xs font-mono text-anna-muted mb-12 flex items-center gap-2">
        <span className="text-white font-semibold">🎵 Music Player</span>
        <span>›</span>
        <span className="text-anna-accent font-semibold">📋 Queue</span>
      </div>

      {/* 4-Step Stepper Bar (FlaviBot Style) */}
      <div className="w-full max-w-xl flex items-center justify-between relative px-2 sm:px-6">
        {/* Connecting Background Line */}
        <div className="absolute top-4 left-8 right-8 h-[2px] bg-anna-border -z-0"></div>

        {/* Dynamic Progress Line */}
        <div
          className="absolute top-4 left-8 h-[2px] bg-gradient-to-r from-anna-accent to-anna-pink -z-0 transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, ((step - 1) / (steps.length - 1)) * 80))}%` }}
        ></div>

        {steps.map((s) => {
          const isDone = s.id < step;
          const isCurrent = s.id === step;

          return (
            <div key={s.id} className="flex flex-col items-center gap-3 relative z-10">
              {/* Step Circle */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  isDone
                    ? 'bg-anna-accent text-white shadow-lg shadow-anna-accent/30 ring-4 ring-[#0b0c10]'
                    : isCurrent
                    ? 'bg-[#181924] border-2 border-anna-accent text-anna-accent shadow-md shadow-anna-accent/20 ring-4 ring-[#0b0c10]'
                    : 'bg-[#181924] border border-anna-border text-anna-muted ring-4 ring-[#0b0c10]'
                }`}
              >
                {isDone ? (
                  <Check className="w-4 h-4 text-white stroke-[3]" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-anna-accent animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-anna-border"></span>
                )}
              </div>

              {/* Step Label */}
              <span
                className={`text-[11px] sm:text-xs font-medium transition-colors ${
                  isDone || isCurrent ? 'text-white font-bold' : 'text-anna-muted'
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Voice info badge if available */}
      {userVoiceName && (
        <div className="mt-8 px-4 py-2 rounded-full bg-[#181926] border border-anna-border/70 flex items-center gap-2 text-xs text-anna-muted shadow-sm">
          <Volume2 className="w-3.5 h-3.5 text-anna-green" />
          <span>
            Bạn đang ở: <strong className="text-white">{userVoiceName}</strong> trên <strong className="text-white">{guildName || 'Server'}</strong>
          </span>
        </div>
      )}

      {/* Loading Status Text & Spinner */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-anna-accent animate-spin opacity-90" />
        <p className="text-xs sm:text-sm font-medium text-anna-muted animate-pulse">
          {statusText}
        </p>
      </div>
    </div>
  );
}
