const express = require('express');
const createAuthMiddleware = require('./middlewares/authMiddleware');
const routeState = require('./routeState');
const createGuildRoutes = require('./guildRoutes');
const createPlayerRoutes = require('./playerRoutes');
const createLyricsRoutes = require('./lyricsRoutes');
const createPlaylistRoutes = require('./playlistRoutes');

/**
 * Anna Music Bot - API Gateway Router
 * Điều phối các sub-router chuyên biệt: Guild, Player, Lyrics, Playlist
 */
module.exports = function createApiRouter(client) {
  const router = express.Router();
  router.use(express.json());

  // Cấu hình CORS siết chặt: Whitelist các domain được chỉ định hoặc Cloudflare Pages
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, ''))
    : [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
        'https://anna-music-bot-ui.pages.dev'
      ];

  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isAllowed = allowedOrigins.includes(origin) || origin.endsWith('.pages.dev') || /^https:\/\/[a-z0-9-]+\.anna-music-bot-ui\.pages\.dev$/i.test(origin);
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-vps-tunnel, x-vps-tunnel-sig');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Khởi tạo tầng bảo mật & xác thực người dùng
  const auth = createAuthMiddleware(client);

  // Mount các Route nhánh chức năng
  router.use(createGuildRoutes(client, auth, routeState));
  router.use(createPlayerRoutes(client, auth, routeState));
  router.use(createLyricsRoutes(client, auth, routeState));
  router.use(createPlaylistRoutes(client, auth, routeState));

  return router;
};
