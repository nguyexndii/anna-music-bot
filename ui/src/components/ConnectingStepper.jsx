import React from 'react';

export default function ConnectingStepper() {
  return (
    <main className="auth-shell">
      <div className="auth-brand">
        <div className="brand-name"><span className="y">an</span><b className="c">na</b></div>
        <div className="brand-subtitle">MUSIC WEB PLAYER</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 2, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', margin: '0 auto 18px' }}>
          <div style={{
            height: '100%', width: '40%', background: 'var(--yellow)', borderRadius: 2,
            animation: 'slide 1.2s ease-in-out infinite',
          }} />
        </div>
        <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', margin: 0 }}>
          ĐANG KẾT NỐI...
        </p>
      </div>
      <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
      <footer className="auth-footer">ANNA MUSIC · 2024</footer>
    </main>
  );
}
