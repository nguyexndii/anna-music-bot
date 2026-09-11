import React from 'react';

export default function Toast({ toasts, toast, onDismiss }) {
  // Support both array 'toasts' or single object 'toast'
  const items = Array.isArray(toasts) ? toasts : (toast ? [toast] : []);
  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: '90vw',
      }}
    >
      {items.map((item) => {
        const isError = item.type === 'error';
        const isInfo = item.type === 'info';
        return (
          <div
            key={item.id || item.message}
            onClick={() => onDismiss?.(item.id)}
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              background: isError ? '#2a1616' : 'var(--paper)',
              border: `1px solid ${isError ? '#5c2020' : 'var(--border)'}`,
              borderLeft: `3px solid ${isError ? 'var(--coral)' : isInfo ? '#6fcf97' : 'var(--yellow)'}`,
              color: 'var(--ink)',
              borderRadius: 10,
              padding: '9px 16px',
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 13,
              boxShadow: '0 8px 24px rgba(0,0,0,.45)',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              animation: 'toastIn .22s cubic-bezier(0.2,0.8,0.2,1)',
            }}
          >
            <span>{item.message}</span>
          </div>
        );
      })}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

