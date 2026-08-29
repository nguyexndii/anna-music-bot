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
  embedColor: '#5865F2', // Modern Blurple
  errorColor: '#e74c3c',
  successColor: '#2ecc71',
  warningColor: '#f1c40f',
  geminiApiKeys: cleanEnv(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY).split(',').map(k => cleanEnv(k)).filter(Boolean),
  mongoUri: cleanEnv(process.env.MONGODB_URI),
  webJwtSecret: cleanEnv(process.env.WEB_JWT_SECRET)
};
