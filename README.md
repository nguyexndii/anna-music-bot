# Anna Music Bot — Technical Documentation & Operations Guide

<p align="center">
  <img src="public/anna-music-logo-chromatic.png" alt="Anna Music Bot Logo" width="380" />
</p>

High-performance Discord music automation system featuring a direct Zero-Latency Raw PCM pipeline, SponsorBlock non-music segment auto-trimming, multi-provider synchronized lyrics with Smart Gap Detection, and a real-time reactive Web Dashboard.

Author: **Diiexe**  
License: **Apache License 2.0**  
Documentation Language: **English** | [Bản Tiếng Việt](./README_VI.md)

---

## Table of Contents
1. System Overview
2. Core Architecture & In-Depth Technical Mechanisms
   - Zero-Latency Raw PCM Audio Pipeline
   - SponsorBlock Non-Music Auto-Trim & Time Normalization
   - Smart Gap-Resilient Synchronized Lyrics Algorithm
   - Web Dashboard Architecture (Optimistic UI & HMAC-SHA256)
   - Smart 24/7 Bi-Directional Lofi Voice Retention
3. Security Policy & Infrastructure Protection
4. Copyright, Fair Use, Anime Character Disclaimer & DMCA
5. Third-Party Credits & Open Source Acknowledgments
6. System Requirements
7. Installation & Deployment Guide
8. Discord Slash Commands Specification
9. REST API Reference
10. License Terms

---

## 1. System Overview

Anna Music Bot is a specialized audio streaming architecture designed for Discord communities, addressing key challenges in self-hosted audio delivery:
- Elimination of buffer latency during playback initialization and track switching.
- Automatic removal of dialogues, skits, and silent credits in music videos.
- Prevention of broken or incomplete synchronized lyrics via an intelligent gap detection engine.
- Real-time web-based queue inspection and playback control with instantaneous visual feedback.

The system is developed on modern open-source foundations (Node.js 20, Discord.js v14, React 18, Vite, Tailwind CSS) following rigorous security and performance standards.

---

## 2. Core Architecture & In-Depth Technical Mechanisms

### 2.1. Zero-Latency Raw PCM Audio Pipeline
Conventional Discord bots frequently download media files to a local disk or employ multi-stage transcoding pipelines, introducing a 2 to 5-second delay before playback begins.

Anna Music Bot adopts a direct stream architecture:
1. **Demuxing & Direct Stream Extraction**: `yt-dlp` extracts the high-bitrate audio stream URL directly (WebM/Opus or M4A/AAC), utilizing browser-exported `cookies.txt` to bypass YouTube Bot Challenge rate limits.
2. **Single-Pass FFmpeg Decoding**: The remote stream URL is piped directly into a single child process of `FFmpeg`. FFmpeg decodes the stream into **Raw 16-bit Little-Endian Stereo PCM (`s16le`)** at a standard sampling rate of **48,000 Hz**.
3. **Direct Voice Feed**: The raw PCM stream is ingested directly into `@discordjs/voice` via `AudioPlayer` configured with `inputType: StreamType.Raw`. This eliminates redundant encode/decode cycles, reduces server CPU utilization below 5%, and provides instantaneous audio output.

---

### 2.2. SponsorBlock Non-Music Auto-Trim & Time Normalization
Many YouTube music videos feature theatrical dialogues, sponsor segments, or extended intros spanning 30 seconds to over 2 minutes prior to the first musical note.

The system mitigates this disruption through the following pipeline:
1. **Segment Discovery**: When a track is enqueued or immediately before playback, `sponsorBlockHelper.js` queries the open SponsorBlock API for segments classified under `music_offtopic`.
2. **Offset Resolution**:
   - If an off-topic segment begins near the start (`segment[0] <= 2s` and `segment[1] >= 5s`), the true music start point is set to: `trimStart = segment[1]`.
   - If an off-topic segment occurs at the end, the true music end point is set to: `trimEnd = segment[0]`.
   - The effective duration is calculated as: `realDurationSec = trimEnd - trimStart`.
3. **Direct FFmpeg Hardware Demux Trimming**: When initiating playback, the bot injects `-ss <trimStart>` and `-to <trimEnd>` arguments directly into the FFmpeg command line, allowing FFmpeg to skip non-music packets at the demuxer level without software seek delays.
4. **Lyrics Timeline Normalization**:
   - **Studio Audio Providers (`zingmp3`, `lrclib`, `syncedlyrics`)**: Studio recordings always align with the music start ($0\text{s}$). Because FFmpeg has removed the non-music intro, the Discord audio counter matches studio lyrics 1:1 (`autoOffsetMs = 0`).
   - **YouTube Closed Captions (`youtube_cc`)**: Closed captions are synchronized with the uncut video. The bot dynamically shifts all lyric timestamps backward by the trimmed duration:
     $$\text{line.time} = \max(0, \text{line.time} - \text{trimStart} \times 1000)$$
     This preserves word-level synchronization between subtitle text and speaker output.

---

### 2.3. Smart Gap-Resilient Synchronized Lyrics Algorithm
The bot executes a Weighted Parallel Race across 4 lyrics providers: YouTube Closed Captions, Zing MP3 Lyrics, LRCLIB Database, and a fallback Syncedlyrics microservice (Musixmatch / NetEase).

To resolve instances where a single provider lacks complete vocals (e.g., Zing MP3 only transcribes the lead artist while omitting a 34-second guest verse in duets), the `Smart Gap Detection` engine functions as follows:

1. **Concurrent Layer Race**: All active providers begin fetching concurrently at $t = 0\text{ms}$.
2. **Quality Metric Evaluation (`evaluateLyricsQuality`)**:
   - Computes consecutive sentence time deltas:
     $$\Delta t = \text{line}_{i+1}.\text{time} - \text{line}_i.\text{time}$$
   - If any intra-song gap $\Delta t \ge 22,000\text{ms}$ (22 seconds) is discovered, the candidate is flagged with `hasAbnormalGap = true`.
3. **Smart Priority Window**:
   - If the earliest candidate comes from the guild's #1 configured priority provider and contains no abnormal gaps (`hasAbnormalGap === false`), it is resolved immediately with 0ms delay.
   - If the earliest candidate contains an abnormal gap (such as Zing MP3 missing 34 seconds), resolution is deferred up to 1200ms to allow LRCLIB or other providers to deliver complete data.
4. **Candidate Selection (`pickBestLyricsCandidate`)**:
   - Rule 1: A candidate without abnormal gaps always defeats a candidate with gaps.
   - Rule 2: If both are flawless (or both contain gaps), the user-defined priority order (`lyricsLayers`) determines the winner.
   - Rule 3: Ties are resolved in favor of the candidate with higher sentence coverage.
5. **Collaborative Artist Parsing in `generateSearchVariants`**: Automatically detects and splits featured/duet artists (e.g., isolating `marzuz` from `marzuz, Changg`), enabling LRCLIB exact matching via `/api/get` in under 200ms.

---

### 2.4. Web Dashboard Architecture (Optimistic UI & HMAC-SHA256)
1. **Optimistic UI Paradigm**: User interactions (Play, Pause, Skip, Seek, Volume) mutate local client state immediately at $t = 0\text{ms}$ while dispatching an asynchronous HTTP POST request to the backend. In the event of a network failure, client state automatically rolls back to server ground truth.
2. **Bandwidth-Optimized Tiered Polling**: The dashboard polls `/api/guilds/:guildId/state` periodically. The endpoint omits heavy playback history unless explicitly requested via `?full=1`, reducing bandwidth consumption by 95% per poll.
3. **HMAC-SHA256 Magic Token Authentication**: Authenticated sessions are issued via the `/web` slash command. Tokens are cryptographically signed with `WEB_JWT_SECRET` and encode `guildId`, `userId`, `isAdmin` permissions, and an expiration timestamp.

---

### 2.5. Smart 24/7 Bi-Directional Lofi Voice Retention
- **Persistent Channel Presence**: Maintains voice presence 24/7 regardless of user presence or empty queue states.
- **Curated Instrumental Selection**: Streams non-intrusive Lo-Fi and acoustic ambient music suitable for study and focus.
- **Bi-Directional Yielding**: Seamlessly pauses the Lofi stream when user requests arrive, and smoothly restores the ambient stream once the user queue is depleted.
- **Anti-Repetition Tracking (`LofiHistoryManager`)**: Tracks the last 50 played ambient tracks in RAM to prevent repetitive playback loops.

---

## 3. Security Policy & Infrastructure Protection

1. **Role-Based Authorization**:
   - Endpoints modifying server configurations, channel locks, or lyrics provider order require Discord `ManageGuild` administrative permissions or the configured DJ role.
2. **Denial-of-Service Rate Limiting**:
   - Express rate limiters protect all REST endpoints against high-frequency automated requests.
3. **Credential Isolation**:
   - Sensitive variables (`DISCORD_TOKEN`, `MONGODB_URI`, `WEB_JWT_SECRET`, and `cookies.txt`) are isolated in environment files and `.gitignore`.
4. **Responsible Disclosure**:
   - Security vulnerabilities should be reported directly to **Diiexe** rather than opened as public issues.

---

## 4. Copyright, Fair Use, Anime Character Disclaimer & DMCA

1. **Source Code Copyright**:
   - The Anna Music Bot architecture and codebase are copyrighted by **Diiexe**, licensed under the **Apache License 2.0**.
2. **Anime Character & Fan Project Disclaimer**:
   - The name *"Anna"* and associated visual avatars/banners are inspired by anime characters and remain the intellectual property of their respective creators, illustrators, and animation production studios.
   - Anna Music Bot is an independent, non-profit, fan-made open-source project. It is not affiliated with, endorsed by, or sponsored by any animation studio or franchise.
3. **Audio Stream Fair Use Disclaimer**:
   - Anna Music Bot **does not store, host, distribute, or download audio files** to server storage.
   - The software acts solely as an ephemeral, real-time audio relay passing user-requested public streams (from YouTube, SoundCloud, or Zing MP3) into private Discord voice sessions under non-commercial Fair Use principles.
4. **Lyrics Intellectual Property**:
   - All song lyrics and transcriptions are the property of their respective artists, songwriters, and publishers, retrieved dynamically via open third-party APIs.
5. **DMCA Compliance & Takedown Procedure**:
   - Copyright holders wishing to restrict their content from being relayed by this bot may submit a request for digital blacklisting.

---

## 5. Third-Party Credits & Open Source Acknowledgments

Anna Music Bot is built upon the foundation of outstanding open-source projects and community APIs:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: Core media extraction utility powering direct stream demuxing and closed caption retrieval.
- **[FFmpeg](https://ffmpeg.org/)**: Industry-standard audio processing framework powering zero-latency hardware trimming and `s16le` PCM decoding.
- **[SponsorBlock](https://sponsor.ajay.app/)**: Open community database created by Ajay Ramachandran, providing `music_offtopic` segment timestamps.
- **[LRCLIB](https://lrclib.net/)**: Open, community-driven synchronized lyrics database.
- **[Zing MP3](https://zingmp3.vn/)**: Music streaming platform providing millisecond-accurate Vietnamese karaoke lyrics.
- **[Discord.js](https://discord.js.org/) & [@discordjs/voice](https://github.com/discordjs/voice)**: Official libraries for Discord Gateway and Voice v4 protocol implementation.
- **[React](https://react.dev/) & [Vite](https://vitejs.dev/) & [Tailwind CSS](https://tailwindcss.com/)**: Modern web toolchain powering the real-time Dashboard.
- **[syncedlyrics](https://github.com/brentvollebregt/syncedlyrics)**: Multi-provider Python lyrics scraping library.
- **[Muse](https://github.com/museofficial/muse) & [LavaMusic](https://github.com/appujet/lavamusic)**: Architectural inspiration for queue handling and SponsorBlock integration in Discord music bots.

---

## 6. System Requirements

- **Operating System**: Linux (Ubuntu 20.04/22.04 LTS, Debian 11/12) or Windows 10/11 / Windows Server.
- **Node.js**: Version `20.x LTS` or `22.x` or later.
- **yt-dlp**: Latest version installed in system `PATH`.
- **FFmpeg**: Version 5.x, 6.x, or 7.x installed in system `PATH`.
- **Database**: MongoDB (Local instance or MongoDB Atlas).
- **Discord Bot Token**: With `Message Content` and `Server Members` Privileged Intents enabled.
- **Python (Optional)**: Python 3.10+ if deploying the supplementary `lyrics-service`.

---

## 7. Installation & Deployment Guide

### Step 1: Clone Repository
```bash
git clone https://github.com/your-username/anna-music-bot.git
cd anna-music-bot
```

### Step 2: Install Dependencies
```bash
# Install backend packages
npm install

# Build Web UI (optional, pre-built in public/)
cd ../anna-music-bot-ui
npm install
npm run build
```

### Step 3: Environment Setup
Create a `.env` file in the `anna-music-bot/` directory:
```env
# Discord Credentials
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/anna_bot?retryWrites=true&w=majority

# Web Dashboard Server
PORT=3005
WEB_JWT_SECRET=your_super_secret_jwt_hmac_key_random_string

# Default Ambient Stream
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk

# Optional API Keys
LASTFM_API_KEY=your_optional_lastfm_key
```

### Step 4: YouTube Cookie Placement (Recommended for VPS)
To prevent YouTube bot challenge blocks on cloud datacenters, export your browser cookies and save to:
```text
anna-music-bot/cookies.txt
```

### Step 5: Start Service
```bash
# Development mode
npm run dev

# Production mode with PM2
npm install -g pm2
pm2 start src/index.js --name "anna-music-bot"
pm2 save
```

---

## 8. Discord Slash Commands Specification

| Command | Syntax | Description |
| :--- | :--- | :--- |
| `/play` | `/play <query \| url \| playlist>` | Enqueues and plays audio from YouTube, Spotify, or SoundCloud |
| `/web` | `/web` | Generates a 1-click authenticated link to the real-time Web Dashboard |
| `/nowplaying` | `/nowplaying` | Displays the current track embed with interactive control buttons |
| `/queue` | `/queue [page]` | Displays current song queue pagination |
| `/skip` | `/skip` | Skips the current track |
| `/pause` | `/pause` | Pauses audio playback |
| `/resume` | `/resume` | Resumes paused playback |
| `/stop` | `/stop` | Stops playback, clears queue, and leaves channel |
| `/volume` | `/volume <1-150>` | Adjusts audio playback volume |
| `/loop` | `/loop <off \| song \| queue>` | Sets loop mode (Off / Single Track / Full Queue) |
| `/autoplay` | `/autoplay` | Toggles automatic discovery of similar music when queue finishes |
| `/247` | `/247` | Toggles 24/7 Voice Channel persistence |
| `/settings` | `/settings` | Opens administrative configuration dashboard |
| `/help` | `/help` | Displays complete command guide |

---

## 9. REST API Reference

The embedded Express web service listens on `PORT` (default `3005`):

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/guilds/:guildId/state` | Returns playback state, active track, volume, voice status (`?full=1` appends history) |
| `POST` | `/api/guilds/:guildId/action` | Dispatches actions: `play`, `pause`, `skip`, `seek`, `volume`, `loop`, `shuffle`, `toggle247`, `toggleLofiMode` |
| `GET` | `/api/guilds/:guildId/lyrics` | Returns real-time synchronized karaoke lyrics |
| `GET` | `/api/guilds/:guildId/settings` | Returns guild configuration (log channel, SponsorBlock, lyrics provider hierarchy) |
| `POST` | `/api/guilds/:guildId/settings` | Updates guild configuration (Requires Admin or DJ role) |
| `GET` | `/api/search?q=:query` | Search query endpoint with debounced multi-provider lookup |
| `GET` | `/health` | Health check endpoint returning uptime, memory, and Node.js version |

---

## 10. License Terms

This project is licensed under the terms of the **[Apache License, Version 2.0](LICENSE)**.  
Copyright © 2026 **Diiexe** (`Anna Music Bot Project`). All rights reserved.

Key terms under Apache 2.0:
- **Freedom of Use**: You are granted permission to use, reproduce, modify, and distribute the software for non-commercial community purposes.
- **Attribution**: You must retain the original copyright notice crediting **Diiexe** in all copies or substantial portions of the Work.
- **State Changes**: Any modified files must carry prominent notices stating that you altered the code.
- **Trademark Protection**: This license does not grant permission to use the trade name *"Anna Music Bot"*, avatars, or branding logos for endorsement without prior written consent.

For full legal terms, consult the [LICENSE](./LICENSE) file.
