<div align="center">
  <h1>ANNA MUSIC BOT &amp; WEB PLAYER</h1>
  <p><b>High-Performance Discord Music Ecosystem, Vantage Monochrome Web Controller, and 4-Tier Synchronized Lyrics Engine</b></p>
  <p>
    <b>Author: Diiexe</b> | 
    <b>English Documentation</b> | 
    <a href="./README_VI.md"><b>Bản Tiếng Việt</b></a>
  </p>
</div>

---

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Capabilities](#core-capabilities)
4. [4-Tier Synchronized Lyrics Architecture](#4-tier-synchronized-lyrics-architecture)
5. [Discord Slash Commands Reference](#discord-slash-commands-reference)
6. [Web Player & REST API Endpoints](#web-player--rest-api-endpoints)
7. [Installation & Deployment](#installation--deployment)
8. [Configuration Guide (.env)](#configuration-guide-env)
9. [Process Management with PM2](#process-management-with-pm2)
10. [Troubleshooting & Maintenance](#troubleshooting--maintenance)
11. [Third-Party Credits & Acknowledgments](#third-party-credits--acknowledgments)
12. [License](#license)

---

## Overview

Anna Music Bot is an enterprise-grade music streaming platform designed for Discord communities. Built on Node.js 20 and Discord.js v14, it delivers low-latency audio playback, millisecond-accurate synchronized lyrics, local SSD caching, and a real-time web control dashboard (Vantage Monochrome UI).

The platform is optimized for single-core VPS hosting environments, utilizing intelligent stream multiplexing, circuit breakers, and zero-latency audio preloading to eliminate stutter and buffering.

---

## System Architecture

```text
[ Discord Users ]
       |
       v
[ Discord Gateway / Slash Commands ] <---> [ Discord Voice Gateway (libsodium) ]
       |                                                    ^
       v                                                    |
[ Command Dispatcher & Permissions ]                        |
       |                                                    |
       v                                                    |
[ MusicQueue Manager ] ---> [ Priority Audio Extraction ] --+
       |                           |
       |                           +---> [ SSD Local Audio Cache (2GB LRU) ]
       |                           +---> [ yt-dlp / FFmpeg Pipe (-ss / -t) ]
       |                           +---> [ SponsorBlock MV Trim API ]
       |
       +---> [ 4-Tier Lyrics Engine ]
       |           |
       |           +---> Tier 1: YouTube CC Subtitles (Original Language)
       |           +---> Tier 2: Zing MP3 API (High-speed V-Pop)
       |           +---> Tier 3: LRCLIB Open Database (International)
       |           +---> Tier 4: Python Microservice (syncedlyrics / Musixmatch / NetEase)
       |
       +---> [ Express Web Server (Port 3000) ] <---> [ Cloudflare Tunnel ] <---> [ Web Player UI ]
       |
       +---> [ MongoDB Atlas ] (Guild Settings, Playlists, User Favorites, Play History)
```

---

## Core Capabilities

### 1. High-Efficiency Audio Pipeline
- 0ms Gapless Preloading: Pre-fetches next track resource and synchronized lyrics 18 seconds before current song completes.
- Local SSD Disk Cache: Stores frequently played tracks in local storage with LRU rotation up to 2GB, bypassing YouTube download overhead.
- Single-Core VPS Concurrency: Semaphore-bounded task queue prevents CPU saturation during parallel search and extraction.
- Circuit Breaker Protection: Automatically detects failing audio streams and fails over to alternative sources within 3 seconds.

### 2. SponsorBlock Auto-Trimming & Timeline Normalization
- Removes non-music intro sketches, interludes, and outro credits using the SponsorBlock `music_offtopic` database.
- Hardware-Level FFmpeg Slicing: Injects exact `-ss` (seek start) and `-t` (duration) parameters directly into the decoding pipe.
- Subtitle Timeline Synchronization: Adjusts YouTube CC timestamps backward to match trimmed audio playback.

### 3. Vantage Monochrome Web Controller
- Real-Time Dual-Panel Dashboard: Responsive layout built with React 18 and Tailwind CSS for mobile and desktop screens.
- One-Time PIN & Magic Token Authentication: Secure 6-digit connection PIN (2-minute expiration) and HMAC-SHA256 session token (24-hour lifetime).
- Anti-Brute-Force Security: Automatic IP lockout for 5 minutes after 5 consecutive incorrect PIN attempts.
- Interactive Queue & Library: Full Drag-and-Drop playlist reordering, context menus, and custom playlist creation.

### 4. 24/7 Lofi Radio Station
- Auto-fallback to relaxing ambient lofi streams when the music queue becomes empty.
- Immediate preemption: Instantly yields playback when a user queues a new song, without disconnecting from the voice channel.

### 5. Multi-Guild Isolation & Role-Based Access Control
- Strict server boundary enforcement prevents cross-guild queue manipulation.
- Hierarchical permission system: Server Owner > Administrator > DJ Role > General Member.

---

## 4-Tier Synchronized Lyrics Architecture

Anna Music Bot employs a cascade fallback resolution system for synchronized lyrics:

1. Tier 1: YouTube Closed Captions (CC)
   - Queries official video subtitles directly with native character set preservation (e.g., Hangul, Japanese Kanji/Kana, Vietnamese).
   - Instant resolution with zero external API latency.

2. Tier 2: Zing MP3 Synchronized Lyrics
   - High-speed resolution for Vietnamese and Asian pop music (100ms - 250ms latency).
   - Word-level timestamp parsing.

3. Tier 3: LRCLIB Open Repository
   - Global crowd-sourced synchronized lyrics database for Spotify and Apple Music catalogs.

4. Tier 4: Internal Python Microservice (syncedlyrics)
   - Standalone FastAPI service running on internal loopback (`127.0.0.1:8787`).
   - Scrapes Musixmatch and NetEase for rare global releases, anime soundtracks, and indie tracks.
   - Built on the open-source library: [syncedlyrics](https://github.com/moehmeni/syncedlyrics).

- Gap Detection Logic: Automatically detects long unvoiced gaps (22 seconds or more) in lyrics data to ensure incomplete transcriptions are discarded in favor of complete lyrics.

---

## Discord Slash Commands Reference

| Command | Category | Permission | Description |
|---|---|---|---|
| `/play <query>` | Music | Everyone | Plays audio from URL, search query, or supported streaming link |
| `/pause` | Music | Everyone / DJ | Pauses active audio playback |
| `/resume` | Music | Everyone / DJ | Resumes paused audio playback |
| `/skip [position]` | Music | Everyone / DJ | Skips current track or initiates vote-skip |
| `/previous` | Music | Everyone / DJ | Replays previous track from session history |
| `/stop` | Music | DJ / Admin | Stops playback, clears queue, and leaves voice room |
| `/queue [page]` | Music | Everyone | Displays current playback queue and interactive page controls |
| `/nowplaying` | Music | Everyone | Displays rich interactive player card with live progress bar |
| `/lyrics [song]` | Lyrics | Everyone | Displays synchronized or plain-text lyrics for current or specified song |
| `/volume <level>` | Music | DJ / Admin | Adjusts playback volume between 1% and 150% |
| `/loop <mode>` | Music | Everyone / DJ | Toggles repeat mode: off, track, or queue |
| `/shuffle` | Music | Everyone / DJ | Shuffles all songs in the queue |
| `/seek <time>` | Music | DJ / Admin | Seeks to specific timestamp (e.g., `1:25` or `85s`) |
| `/replay` | Music | Everyone / DJ | Restarts the current track from 0:00 |
| `/jump <position>` | Music | DJ / Admin | Jumps directly to a specific track index in the queue |
| `/remove <index>` | Music | DJ / Admin | Removes a specific track from the queue |
| `/clear` | Music | DJ / Admin | Clears all upcoming tracks in the queue |
| `/forward <sec>` | Music | DJ / Admin | Fast-forwards playback by specified seconds |
| `/rewind <sec>` | Music | DJ / Admin | Rewinds playback by specified seconds |
| `/history` | Music | Everyone | Displays recently played songs in the server |
| `/toptracks` | Music | Everyone | Shows top 10 most played tracks in the server |
| `/web` | Controller | Everyone | Generates 6-digit PIN and secure Magic Link for Web Player |
| `/247 [mode]` | Automation | Admin | Toggles 24/7 Voice persistence and Lofi radio standby |
| `/autoplay [mode]`| Automation | DJ / Admin | Toggles intelligent music recommendations when queue ends |
| `/favorite add/list`| Library | Everyone | Manages personal favorite songs stored in MongoDB |
| `/playlist create` | Library | Everyone | Creates and manages personal custom playlists |
| `/settings view` | Config | Admin | Displays server settings, DJ roles, and music channel |
| `/settings set` | Config | Admin | Configures default volume, DJ role, lock channel, language |
| `/ping` | System | Everyone | Displays WebSocket ping, REST latency, and system uptime |
| `/stats` | System | Everyone | Displays memory consumption, CPU load, and active voice sessions |
| `/help [command]` | System | Everyone | Displays comprehensive command manual and usage tips |

---

## Web Player & REST API Endpoints

The Express backend exposes RESTful endpoints for the Vantage Monochrome Web Controller:

- `POST /api/auth/verify`: Verifies 6-digit PIN or session token; issues 24-hour HMAC token.
- `GET /api/guilds/:guildId/state`: Returns player state, current track, queue, favorites, and permissions.
  - Query parameter `?full=1`: Returns full user library and server statistics.
  - Query parameter `?fresh=1`: Bypasses RAM cache and fetches fresh data directly from MongoDB.
- `POST /api/guilds/:guildId/play`: Orders a new song or playlist from the web search bar.
- `POST /api/guilds/:guildId/action`: Executes control actions (`pause`, `resume`, `skip`, `previous`, `seek`, `volume`, `loop`, `shuffle`, `toggleFavorite`, `toggleLofiMode`).
- `GET /api/search?q=<query>`: Rate-limited live search query endpoint.
- `GET /api/lyrics?title=<t>&artist=<a>`: Multi-tier lyrics search endpoint.
- `GET /api/health`: Health status endpoint for telemetry and monitoring.

---

## Installation & Deployment

### Prerequisites
- Node.js version 20.12.0 or higher
- Python version 3.10 or higher
- FFmpeg installed and available in system PATH
- MongoDB Atlas cluster or local MongoDB instance
- Discord Bot Token with Message Content and Server Members intents enabled

### 1. Clone Repository
```bash
git clone https://github.com/nguyexndii/anna-music-bot.git
cd anna-music-bot
npm install
```

### 2. Configure Python Lyrics Microservice
```bash
cd lyrics-service
python3 -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 3. Deploy Discord Slash Commands
```bash
node src/deploy-commands.js
```

---

## Configuration Guide (.env)

Create a `.env` file in the root directory:

```env
# Discord Bot Credentials
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here
ADMIN_ID=your_discord_user_id_here

# Database
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database_name

# Web Server & Security
PORT=3000
WEB_JWT_SECRET=generate_a_random_64_byte_hex_string_here
ALLOWED_ORIGINS=http://localhost:5173,https://anna-music-bot-ui.pages.dev

# External API Integrations
LYRICS_SERVICE_URL=http://127.0.0.1:8787
SPONSORBLOCK_API=https://sponsor.ajay.app

# Environment & Performance
NODE_ENV=production
CACHE_DIR=./data/audio-cache
MAX_CACHE_SIZE_MB=2048
```

---

## Process Management with PM2

Run both services under PM2 process supervision:

```bash
# 1. Start Discord Bot & Web API
pm2 start src/index.js --name "anna-music-bot" --node-args="--max-old-space-size=512"

# 2. Start Python Lyrics Microservice
pm2 start "lyrics-service/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8787" --name "anna-lyrics"

# 3. Start Cloudflare Tunnel (if using remote web access)
pm2 start "cloudflared tunnel run anna-tunnel" --name "anna-tunnel"

# 4. Save PM2 state for automatic reboot persistence
pm2 save
pm2 startup
```

---

## Troubleshooting & Maintenance

### 1. Audio Playback Issues
- Check FFmpeg installation: `ffmpeg -version`
- Check yt-dlp binary permissions: Ensure `node_modules/yt-dlp-exec/bin/yt-dlp` has execute (`chmod +x`) permissions on Linux.
- YouTube Bot Detection: If streams timeout, supply a valid `cookies.txt` file in `./data/cookies.txt`.

### 2. Lyrics Service Diagnostic
- Check microservice status: `curl http://127.0.0.1:8787/health`
- Test query: `curl "http://127.0.0.1:8787/lyrics?title=Faded&artist=Alan%20Walker"`

### 3. Database Sync Verification
- Verify MongoDB connection string in `.env`.
- Check active connections and indexes on `guildsettings`, `favoritesongs`, and `userplaylists` collections.

---

## Third-Party Credits & Acknowledgments

- [Discord.js](https://discord.js.org/): Discord API interaction framework.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): Audio and video extraction engine.
- [FFmpeg](https://ffmpeg.org/): Audio decoding, resampling, and stream pipe processing.
- [syncedlyrics](https://github.com/moehmeni/syncedlyrics): Python multi-provider synchronized lyrics scraper.
- [SponsorBlock](https://sponsor.ajay.app/): Open database for skipping non-music segments.
- [LRCLIB](https://lrclib.net/): Public synchronized lyrics database.

---

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
