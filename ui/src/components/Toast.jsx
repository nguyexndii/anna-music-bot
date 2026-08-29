import React from 'react';
import { Check, AlertCircle } from 'lucide-react';

export default function Toast({ toast }) {
  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 transition-all duration-300 pointer-events-none">
      <div className="bg-anna-card/95 border border-anna-border backdrop-blur-xl px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-xs font-semibold text-white">
        <div
          className={`w-6 h-6 rounded-lg flex items-center justify-center ${
            toast.type === 'error'
              ? 'bg-anna-red/20 text-anna-red'
              : 'bg-anna-green/20 text-anna-green'
          }`}
        >
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
        </div>
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
