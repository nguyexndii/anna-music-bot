<div align="center">
  <img src="public/anna-music-logo-chromatic.png" alt="Anna Music Logo" width="360" />

  # ANNA MUSIC BOT & WEB PLAYER (24/7)

  **Next-Gen Discord Music Ecosystem: Discord Components V2 UI • Vintage Vinyl Web Player • 4-Tier Karaoke Lyrics Engine**

  [![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
  [![Discord.js](https://img.shields.io/badge/Discord.js-v14%20(Components%20V2)-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
  [![FastAPI](https://img.shields.io/badge/Python-FastAPI%20Lyrics-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![React](https://img.shields.io/badge/Web%20UI-React%2018%20%2B%20Tailwind-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
  [![MongoDB](https://img.shields.io/badge/Database-MongoDB%20%2B%20JSON-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

  <p align="center">
    <b>Author: Diiexe</b> • 
    <b>🇺🇸 English Documentation</b> • 
    <a href="./README_VI.md"><b>🇻🇳 Bản Tiếng Việt</b></a>
  </p>
</div>

---

## Table of Contents
1. [Key Highlights & Exclusive Strengths](#key-highlights--exclusive-strengths)
2. [System Architecture](#system-architecture)
3. [Discord Commands Reference (Slash & Prefix)](#discord-commands-reference-slash--prefix)
4. [Installation & Deployment Guide](#installation--deployment-guide)
5. [Project Structure](#project-structure)
6. [Security & Infrastructure Protection](#security--infrastructure-protection)
7. [Copyright, Disclaimer & DMCA](#copyright-disclaimer--dmca)
8. [Third-Party Credits & Acknowledgments](#third-party-credits--acknowledgments)
9. [License Terms](#license-terms)

---

## Key Highlights & Exclusive Strengths

### 1. Dual-Interface Experience: Discord Components V2 & Vintage Vinyl Web Player
* **Discord Components V2 (`type: 17`):** The `/nowplaying`, `/queue`, `/like`, and `/web` controllers are built using Discord's latest Container UI specifications. Features interactive progress bars, live in-chat lyrics, and lag-free media control buttons.
* **Vintage Vinyl Web Player (`HeroPlayer`):** The Web Player recreates a classic turntable with a mechanical tonearm that dynamically tracks playback percentage (`16.5°` – `33.5°`). Includes a 60fps draggable Floating Mini Vinyl that docks smoothly to screen edges.
* **1-Click Secure Login (`/web`):** Generates a 6-digit PIN (self-destructs after 3 minutes) and an HMAC-SHA256 signed Magic Token bound to the active voice session. Features brute-force IP lockout protection (locks after 5 failed attempts).

### 2. 4-Tier Multi-Provider Karaoke Engine & Smart Gap Detection
Automatically retrieves millisecond-synchronized `.lrc` lyrics in customizable priority order (configurable directly from the Web Dashboard):
1. **Tier 1 — YouTube CC:** Official closed captions extracted directly from the video with zero latency.
2. **Tier 2 — Zing MP3 Lyrics Engine:** Word-accurate V-Pop karaoke lyrics (ultra-fast `100ms - 250ms` response).
3. **Tier 3 — LRCLIB Open Database:** Synchronized lyrics repository from Spotify & Apple Music (`50ms - 150ms` response).
4. **Tier 4 — Python Fallback Microservice (`syncedlyrics`):** Internal FastAPI service (`127.0.0.1:8787`) scraping **Musixmatch** and **NetEase** for rare international tracks, Anime, J-Pop, and C-Pop.
* **Smart Gap Detection Algorithm:** Automatically catches missing vocal verses (sentence gap $\ge 22\text{s}$) — e.g., when Zing MP3 transcribes only the lead singer and omits a 34-second guest verse. The engine holds resolution and promotes the complete LRCLIB candidate as the winner!
* **Fullscreen Karaoke & Offset Calibration:** 60fps fullscreen web karaoke with click-to-seek navigation, automatic remix detection, and fine-grained offset adjustment (`-5s` to `+5s`) persisted to the database.

### 3. SponsorBlock Auto-Trim & Lyrics Timeline Normalization
* **Automatic Music Video Trim:** Queries SponsorBlock's `music_offtopic` database to automatically strip 30s to 2+ minutes of theatrical storytelling, sketches, and intro/outro credits in YouTube MVs.
* **FFmpeg Hardware-Level Trimming:** Injects `-ss <trimStart>` and `-to <trimEnd>` directly into the decoding process, launching playback right at the first musical note without software seek latency.
* **Timeline Normalization:** Automatically adjusts YouTube CC timestamps backward by the trimmed duration, ensuring subtitles remain 100% time-aligned with audio output.

### 4. Zero-Latency Playback (`0ms` Preload) & VPS Efficiency
* **Instant Preload:** Automatically preloads the next audio stream (`preloadedResource`) and lyrics into RAM at **18 seconds** before the current song ends, achieving instantaneous track switching (`0ms delay`).
* **Intelligent Memory Protection (`systemMonitor`):** Checks available VPS RAM before preloading (only preloads if free RAM < 85%) and enforces a strict `MemoryMax=200M` limit on the Python microservice via systemd.
* **Audio Crossfade:** Smoothly blends the end of the current track (fade-out) with the beginning of the next track (fade-in) with configurable duration from `0s` to `10s`.

### 5. Smart 24/7 Bi-Directional Lofi & 3-Tier Autoplay
* **Dynamic 24/7 Lofi Station (`lofiDiscovery`):** Stays in the voice channel 24/7 when the queue empties, streaming relaxing instrumental lofi tailored to the time of day (morning, afternoon, late night) with an anti-repetition memory buffer of 100 songs. Immediately yields to incoming user songs with 0s latency.
* **3-Tier Autoplay Recommendation:** Cascades through `YouTube Mix (RD)` $\rightarrow$ `Last.fm Similar` $\rightarrow$ `Heuristic Fallback` with regional language filters (`V-Pop`, `K-Pop`, `J-Pop`, `US-UK`) to always match your music taste.

### 6. Hybrid Storage & Auto-Session Recovery (`SessionManager`)
* **Hybrid Storage Architecture:** Combines **MongoDB Atlas Cloud** with resilient **local JSON storage** (`data/`).
* **Playback State Persistence:** Saves queue states and the exact second of playback every 15 seconds. If the bot or VPS restarts, Anna automatically rejoins the voice channel and resumes playback from the exact interrupted timestamp.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        DISCORD & WEB CLIENTS                            │
└───────────────┬─────────────────────────────────────────┬───────────────┘
                │ Slash / Prefix Commands                 │ HTTPS (PIN / Bearer Token)
                ▼                                         ▼
┌───────────────────────────────┐         ┌───────────────────────────────┐
│    DISCORD GATEWAY & VOICE    │         │      STATIC WEB PLAYER UI     │
│   (Discord.js v14 + @voice)   │         │ (React 18 + Tailwind + Vite)  │
└───────────────┬───────────────┘         └───────────────┬───────────────┘
                │                                         │ REST API Polling
                ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANNA BOT CORE (NODE.JS + EXPRESS)                    │
│  • MusicManager / MusicQueue (18s Preload, Crossfade, SponsorBlock)     │
│  • 3-Layer Autoplay & 24/7 Dynamic Lofi Engine                          │
│  • Smart 4-Tier Lyrics Engine (YouTube CC, Zing MP3, LRCLIB)           │
│  • Direct Raw PCM s16le Audio Pipeline                                  │
└───────┬───────────────────────────┬─────────────────────────────┬───────┘
        │ HTTP (127.0.0.1:8787)     │ Mongoose / FS               │ Stream / API
        ▼                           ▼                             ▼
┌───────────────────┐     ┌───────────────────────┐     ┌─────────────────┐
│   PYTHON FASTAPI  │     │    HYBRID DATABASE    │     │  EXTERNAL APIS  │
│   LYRICS SERVICE  │     │ • MongoDB Atlas Cloud │     │ • YouTube/yt-dlp│
│  • Musixmatch     │     │ • Local JSON Fallback │     │ • Spotify/SCloud│
│  • NetEase Music  │     │   (data/*.json)       │     │ • ZingMP3/LRCLIB│
└───────────────────┘     └───────────────────────┘     └─────────────────┘
```

---

## Discord Commands Reference (Slash & Prefix)

The bot supports both **Slash Commands (/)** and **Prefix Commands** with convenient shortcuts (Aliases):

### Music Playback & Favorites
| Command | Aliases | Description |
| :--- | :--- | :--- |
| `/play <query/url>` | `p` | Play music or playlist from YouTube, Spotify, SoundCloud (with autocomplete). |
| `/web` | — | Receive Magic Token link and 6-digit PIN to access the Web Player. |
| `/nowplaying` | `np`, `c`, `panel` | Display the interactive Now Playing embed (Components V2) with controls. |
| `/lyrics [song]` | `ly`, `loi` | View synchronized lyrics from YouTube CC, Zing MP3, LRCLIB, or Musixmatch. |
| `/like [action]` | `fav`, `yeuthich`| Manage (`list`, `add`, `remove`) and play (`play`) personal favorite songs. |
| `/pause` / `/resume`| `unpause` | Pause or resume current audio playback. |
| `/skip` | `s`, `sk`, `fs` | Skip current track and play the next queued item. |
| `/stop` | `st`, `off` | Stop playback, clear the queue, and disconnect from voice. |
| `/join` / `/leave` | `j`, `dc`, `out` | Summon the bot to or disconnect from the active voice channel. |

### Queue & Audio Management
| Command | Aliases | Description |
| :--- | :--- | :--- |
| `/queue [page]` | `q`, `list` | View the paginated list of songs in the current queue. |
| `/move <from> [to]` | `mv`, `jump` | Move a song to a new position in the queue (default brings to `#1`). |
| `/remove <index>` | `rm`, `xoa` | Remove a song from the queue by its index number. |
| `/shuffle` | `sh`, `mix` | Shuffle the ordering of all remaining songs in the queue. |
| `/volume <1-150>` | `vol`, `v` | Adjust master playback volume level from 1% to 150%. |
| `/loop [mode]` | `l`, `repeat` | Cycle loop mode: `off` (Disabled) $\rightarrow$ `song` (Repeat 1) $\rightarrow$ `queue` (Repeat All). |

### Administration & Utilities
| Command | Aliases | Description |
| :--- | :--- | :--- |
| `/settings` | `caidat`, `config` | Open the comprehensive server configuration dashboard (Admin only). |
| `/247 [on/off]` | `24/7` | Toggle 24/7 voice retention mode with ambient lofi music. |
| `/autoplay [status]`| `ap`, `auto` | Toggle automatic similar music recommendations when queue ends. |
| `/lockvoice` | `lockvc`, `setvoice`| Lock bot operations to one designated voice channel. |
| `/setchannel` | `channel`, `kenhnhac`| Restrict music command responses to a designated text channel. |
| `/setdj` | `djrole`, `djonly` | Configure DJ role and toggle DJ-only mode. |
| `/setlog` | `logchannel`, `log` | Designate a channel for logging voice activity, commands, and web actions. |
| `/ping` / `/feedback` | `ms`, `fb`, `gopy` | Check network latency (ping) or submit feedback to developers. |
| `/help` | `h`, `lenh` | Display the categorized interactive help manual. |

---

## Installation & Deployment Guide

### 1. System Requirements
- **Node.js**: `20.x LTS` or `22.x` or later.
- **Python**: `3.10+` (only needed if running the optional `lyrics-service`).
- **Media Tools**: `ffmpeg` and `yt-dlp` installed and accessible in the system `PATH`.
- **Database**: MongoDB Atlas cluster (if omitted, automatically falls back to local JSON files in `data/`).

### 2. Environment Configuration (.env)
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```
Example configuration:
```env
# Discord Credentials
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/anna_bot?retryWrites=true&w=majority

# Web Dashboard Server
PORT=3005
WEB_JWT_SECRET=your_super_secret_jwt_hmac_key_random_string

# Default Ambient Stream
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk
LASTFM_API_KEY=your_optional_lastfm_key
```

### 3. Launch with Docker Compose (Recommended)
```bash
docker compose up -d --build
```

### 4. Manual VPS Deployment (Ubuntu / Debian / Windows)

#### Step 1: Install & Run Main Bot (Node.js)
```bash
# Install backend dependencies
npm install

# Register Slash Commands on Discord
node src/deploy-commands.js

# Run in Development mode
npm run dev

# Or run in Production with PM2
npm install -g pm2
pm2 start src/index.js --name "anna-music-bot"
pm2 save
```

#### Step 2: Run Lyrics Fallback Microservice (Python - Optional)
This microservice serves as Tier 4 fallback for rare international tracks:
```bash
cd lyrics-service
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787 --workers 1
```
*(See [lyrics-service/README.md](./lyrics-service/README.md) for detailed instructions on configuring a systemd service with `MemoryMax=200M`).*

---

## Project Structure

```text
anna-music-bot/
├── lyrics-service/        # Optional Python FastAPI microservice (Musixmatch & NetEase)
│   ├── main.py            # Async concurrent scraping API with LRU cache
│   └── README.md          # Systemd configuration guide with 200MB RAM cap
├── public/                # Static Web Player build & 404 page
│   ├── anna-avatar-icon.png
│   ├── anna-music-logo-chromatic.png
│   └── 404.html
├── src/
│   ├── commands/          # 27 Slash & Prefix commands (play, web, lyrics, settings...)
│   ├── database/          # Mongoose connection & models (Session, History, Favorite...)
│   ├── routes/
│   │   └── api.js         # Express REST API for Web Player (Auth PIN, State, Lyrics)
│   ├── structures/        # Core managers (MusicQueue, SessionManager, MusicManager...)
│   ├── utils/             # Stream extraction, SponsorBlock, 4-Tier Lyrics, Lofi Discovery
│   ├── config.js          # Centralized configuration loader
│   ├── deploy-commands.js # Slash command deployment script
│   └── index.js           # Main application entry point & Express server
├── Dockerfile             # Multi-stage container build file
├── docker-compose.yml     # Docker compose service definition
├── LICENSE                # MIT License
├── README.md              # English Documentation
└── README_VI.md           # Vietnamese Documentation
```

---

## Security & Infrastructure Protection

1. **Role-Based Authorization**: Administrative APIs (guild configuration, lyrics hierarchy, channel locks) enforce `ManageGuild` Discord permissions or the designated DJ role.
2. **Brute-Force PIN Protection**: 6-digit Web Player login PINs expire after 3 minutes. The system automatically locks out client IPs for 15 minutes after 5 consecutive incorrect attempts.
3. **Denial-of-Service Rate Limiting**: Express rate limiters protect all REST endpoints against high-frequency automated scraping.
4. **Credential Isolation**: Sensitive variables (`.env`, `cookies.txt`, local storage) are git-ignored and never committed to public repositories.

---

## Copyright, Disclaimer & DMCA

1. **Source Code Copyright**: The Anna Music Bot architecture and codebase are copyrighted by **Diiexe**, licensed under the **MIT License**.
2. **Anime Character & Fan Project Disclaimer**:
   - The name *"Anna"* and associated visual avatars/banners are inspired by anime characters and remain the intellectual property of their respective creators and animation studios.
   - Anna Music Bot is an independent, non-profit, fan-made open-source project with no official affiliation or endorsement from any anime studio.
3. **Audio Stream Fair Use Disclaimer**:
   - Anna Music Bot **does not store, host, distribute, or download audio files** to server storage.
   - The software acts solely as an ephemeral audio relay passing user-requested public streams into private Discord voice sessions under non-commercial Fair Use principles.
4. **Lyrics Intellectual Property**: All song lyrics remain the exclusive property of their respective artists, songwriters, and publishers, retrieved dynamically via open third-party APIs.
5. **DMCA Compliance & Takedown Procedure**: Copyright owners wishing to restrict their content from being relayed by this bot may submit a request for digital blacklisting.

---

## Third-Party Credits & Acknowledgments

Anna Music Bot is built upon the foundation of outstanding open-source projects and community APIs:
* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: Core media extraction utility powering direct stream demuxing and closed caption retrieval.
* **[FFmpeg](https://ffmpeg.org/)**: Industry-standard audio processing framework powering zero-latency hardware trimming and `s16le` PCM decoding.
* **[SponsorBlock](https://sponsor.ajay.app/)**: Open community database created by Ajay Ramachandran, providing `music_offtopic` segment timestamps.
* **[LRCLIB](https://lrclib.net/)**: Open, community-driven synchronized lyrics database.
* **[Zing MP3](https://zingmp3.vn/)**: Music streaming platform providing millisecond-accurate Vietnamese karaoke lyrics.
* **[Discord.js](https://discord.js.org/) & [@discordjs/voice](https://github.com/discordjs/voice)**: Official libraries for Discord Gateway and Voice v4 protocol implementation.
* **[React](https://react.dev/) & [Vite](https://vitejs.dev/) & [Tailwind CSS](https://tailwindcss.com/)**: Modern web toolchain powering the real-time Dashboard.
* **[syncedlyrics](https://github.com/brentvollebregt/syncedlyrics)**: Multi-provider Python lyrics scraping library.
* **[Muse](https://github.com/museofficial/muse) & [LavaMusic](https://github.com/appujet/lavamusic)**: Architectural inspiration for queue handling and SponsorBlock integration in Discord music bots.

---

## License Terms

This project is distributed under the terms of the **[MIT License](LICENSE)**.  
Copyright © 2026 **Diiexe** (`Anna Music Bot Project`).

Under MIT terms: You are granted permission to freely use, copy, modify, merge, publish, and distribute the software for non-commercial community purposes, with the **sole requirement of preserving the original copyright notice crediting Diiexe** (`Copyright (c) 2026 Diiexe`).
