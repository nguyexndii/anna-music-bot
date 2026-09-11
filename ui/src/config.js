function getApiBase() {
  const envUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && envUrl.startsWith('http://')) {
    return ''; // Dùng Cloudflare Pages Function / _redirects để tránh Mixed Content
  }
  return envUrl;
}

export const API_BASE = getApiBase();

export const DEFAULT_TRACK_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
  '<defs>' +
  '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
  '<stop offset="0%" stop-color="#1c1917"/>' +
  '<stop offset="100%" stop-color="#09090b"/>' +
  '</linearGradient>' +
  '<linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">' +
  '<stop offset="0%" stop-color="#f59e0b"/>' +
  '<stop offset="100%" stop-color="#b45309"/>' +
  '</linearGradient>' +
  '</defs>' +
  '<rect width="100" height="100" rx="14" fill="url(#bg)"/>' +
  '<circle cx="50" cy="50" r="34" fill="#18181b" stroke="#27272a" stroke-width="1.5"/>' +
  '<circle cx="50" cy="50" r="24" fill="none" stroke="#27272a" stroke-width="1" stroke-dasharray="2,2"/>' +
  '<circle cx="50" cy="50" r="13" fill="url(#accent)"/>' +
  '<circle cx="50" cy="50" r="4" fill="#09090b"/>' +
  '<path d="M48 43.5v9a3 3 0 1 1-1.8-2.7V45h5.5v-1.5h-3.7z" fill="#ffffff" opacity="0.95"/>' +
  '</svg>'
);
