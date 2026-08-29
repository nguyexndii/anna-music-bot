require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  prefix: process.env.PREFIX || '.',
  port: process.env.PORT || 3000,
  default247Stream: process.env.DEFAULT_247_STREAM || 'https://www.youtube.com/watch?v=rFZHOHl-L8A',
  embedColor: '#5865F2', // Modern Blurple
  errorColor: '#e74c3c',
  successColor: '#2ecc71',
  warningColor: '#f1c40f',
  geminiApiKeys: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean),
  mongoUri: process.env.MONGODB_URI
};
