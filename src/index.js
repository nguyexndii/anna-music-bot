const os = require('os');
if (process.platform === 'linux') {
  try { os.setPriority(0, -3); } catch (e) {}
}

const path = require('path');
const fs = require('fs');
const express = require('express');
const { Client, Collection, GatewayIntentBits, Options } = require('discord.js');
const sodium = require('libsodium-wrappers');
const config = require('./config');
const musicManager = require('./structures/MusicManager');
const sessionManager = require('./structures/SessionManager');
const { initLogger, logAction } = require('./utils/debugLogger');
const { initStatusNotifier } = require('./utils/statusNotifier');
const createApiRouter = require('./routes/api');

// 1. Khởi tạo Discord Client tối ưu bộ nhớ cho VPS 2GB RAM / 1 Core CPU
const client = new Client({
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    ReactionManager: 0,
    GuildMemberManager: { maxSize: 100, keepOverLimit: member => member.id === client.user?.id },
    UserManager: 100,
    PresenceManager: 0
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 60 },
    users: { interval: 3600, filter: () => user => user.id !== client.user?.id }
  },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  allowedMentions: { parse: [], repliedUser: false }
});
global._discordClient = client;

initLogger(client);
initStatusNotifier(client, {
  adminId: config.adminId || '875358286487097395',
  botName: 'Anna Music Bot',
  platform: 'VPS Ubuntu (PM2)'
});

client.commands = new Collection();
client.aliases = new Collection();
client.musicManager = musicManager;

// 2. Tải toàn bộ lệnh tiền tố và slash commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (command.name) {
      client.commands.set(command.name, command);
      if (Array.isArray(command.aliases)) {
        command.aliases.forEach(alias => client.aliases.set(alias, command.name));
      }
    }
  }
}

// 3. Tải tự động các Event Listeners từ src/events/
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
    const eventModule = require(path.join(eventsPath, file));
    const eventList = Array.isArray(eventModule) ? eventModule : [eventModule];
    for (const evt of eventList) {
      if (!evt || !evt.name || typeof evt.execute !== 'function') continue;
      if (evt.once) {
        client.once(evt.name, (...args) => evt.execute(client, ...args));
      } else {
        client.on(evt.name, (...args) => evt.execute(client, ...args));
      }
    }
  }
}

// 4. Keep-Alive Web Server (Express) & API Routes
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use('/api', createApiRouter(client));
app.use(express.static(path.join(__dirname, '../public')));

app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    botStatus: client.user ? 'ONLINE' : 'OFFLINE',
    wsPing: client.ws ? client.ws.ping : null,
    wsStatus: client.ws ? client.ws.status : null
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath, (err) => {
      if (err && !res.headersSent) {
        res.send('🎵 Anna Music Bot (24/7) đang hoạt động ổn định!');
      }
    });
  } else {
    res.send('🎵 Anna Music Bot (24/7) đang hoạt động ổn định!');
  }
});

function startServer(port) {
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[Express Web Server] Đang lắng nghe an toàn tại 127.0.0.1:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Express Web Server] Cổng ${port} đã có ứng dụng dùng, tự động chuyển sang ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[Express Web Server Error]', err);
    }
  });
}

console.log('🎵 ANNA MUSIC BOT ĐANG KHỞI ĐỘNG...');
const serverPort = process.env.PORT && process.env.PORT !== '3005' ? Number(process.env.PORT) : 3000;
startServer(serverPort);

// 5. Xử lý lỗi an toàn
client.on('error', (err) => {
  console.error('[Discord Client Error]', err);
  logAction('CLIENT_ERROR', { error: err.message || String(err) });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
  const errMsg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  if (errMsg.includes('EPIPE') || errMsg.includes('ECONNRESET')) return;
  logAction('SYSTEM_ERROR', { error: errMsg.slice(0, 500) });
});

process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
  console.error('[Uncaught Exception]', err);
  logAction('SYSTEM_ERROR', { error: (err.stack || err.message || String(err)).slice(0, 500) });
});

// 6. Dừng an toàn hệ thống (Graceful Shutdown)
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Process ${signal}] Đang lưu trạng thái phiên phát nhạc và dừng hệ thống an toàn...`);
  try {
    const savePromises = [];
    for (const queue of musicManager.queues.values()) {
      if (typeof queue._saveSessionState === 'function') savePromises.push(queue._saveSessionState());
    }
    await Promise.allSettled(savePromises);
    await sessionManager.flushAll();
  } catch (err) {
    console.warn('[Graceful Shutdown Session Save Warning]:', err.message);
  }
  try {
    const { notifyBotShutdown } = require('./utils/statusNotifier');
    await notifyBotShutdown(client, null, signal);
  } catch (e) {}
  try {
    const { cleanupAllProcesses } = require('./utils/musicExtractor');
    cleanupAllProcesses();
  } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 7. Khởi tạo mã hóa Voice và Đăng nhập Bot
(async () => {
  try {
    await sodium.ready;
    console.log('🔒 [Voice Encryption] Thư viện mã hóa âm thanh libsodium đã sẵn sàng!');
  } catch (e) {
    console.warn('[Voice Encryption Warning]:', e.message);
  }

  if (!config.token || config.token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('[Error] Vui lòng cung cấp DISCORD_TOKEN hợp lệ trong file .env');
  } else {
    client.login(config.token);
  }
})();
