require('dotenv').config();

const cleanEnv = (val, fallback = '') => {
  if (!val) return fallback;
  return String(val).replace(/^["']|["']$/g, '').trim();
};

module.exports = {
  token: cleanEnv(process.env.DISCORD_TOKEN),
  clientId: cleanEnv(process.env.DISCORD_CLIENT_ID),
  prefix: cleanEnv(process.env.PREFIX, '.'),
  port: parseInt(cleanEnv(process.env.PORT, '3000'), 10) || 3000,
  default247Stream: cleanEnv(process.env.DEFAULT_247_STREAM, 'https://www.youtube.com/watch?v=rFZHOHl-L8A'),
  embedColor: '#5865F2',
  errorColor: '#e74c3c',
  successColor: '#2ecc71',
  warningColor: '#f1c40f',
  geminiApiKeys: cleanEnv(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY).split(',').map(k => cleanEnv(k)).filter(Boolean),
  mongoUri: cleanEnv(process.env.MONGODB_URI),
  webJwtSecret: cleanEnv(process.env.WEB_JWT_SECRET || process.env.WEB_TOKEN_SECRET),
  adminId: cleanEnv(process.env.ADMIN_USER_ID, '875358286487097395'),
  allowedGuildIds: cleanEnv(process.env.ALLOWED_GUILD_IDS, '').split(',').map(g => cleanEnv(g)).filter(Boolean),
  errorLogChannelId: cleanEnv(process.env.ERROR_LOG_CHANNEL_ID, '1547449482835394640'),
  feedbackChannelId: cleanEnv(process.env.FEEDBACK_CHANNEL_ID, '1543117987148603473'),
  staffVoiceChannels: cleanEnv(process.env.STAFF_VOICE_CHANNELS, '1447095306079698984').split(',').map(s => s.trim()).filter(Boolean),
  webUrl: (() => {
    const raw = cleanEnv(process.env.WEB_URL);
    if (!raw || /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(raw)) return 'https://anna-music-bot-ui.pages.dev';
    return raw.replace(/\/$/, '');
  })()
};
