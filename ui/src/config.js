function getApiBase() {
  const envUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && envUrl.startsWith('http://')) {
    return ''; // Dùng Cloudflare Pages Function / _redirects để tránh Mixed Content
  }
  return envUrl;
}

export const API_BASE = getApiBase();
