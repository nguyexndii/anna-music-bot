const {
  createNowPlayingCard,
  createNowPlayingEmbed,
  createMusicControls
} = require('../../utils/embed');
const { fetchLyrics, prefetchLyrics } = require('../../utils/lyricsHelper');
const settingsManager = require('../SettingsManager');
const { isCpuOverloaded } = require('../../utils/systemMonitor');

function parseDurationToSeconds(str) {
  if (!str || typeof str !== 'string' || str.toLowerCase().includes('live')) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseDurationToMs(str) {
  return parseDurationToSeconds(str) * 1000;
}

class DiscordCardRenderer {
  constructor(queue) {
    this.queue = queue;
  }

  get currentSong() {
    return this.queue.currentSong;
  }

  get nowPlayingMessage() {
    return this.queue.nowPlayingMessage;
  }

  set nowPlayingMessage(msg) {
    this.queue.nowPlayingMessage = msg;
  }

  get hasSyncedLyrics() {
    return this.queue.hasSyncedLyrics;
  }

  set hasSyncedLyrics(val) {
    this.queue.hasSyncedLyrics = val;
  }

  get cachedSyncedLyrics() {
    return this.queue.cachedSyncedLyrics;
  }

  set cachedSyncedLyrics(val) {
    this.queue.cachedSyncedLyrics = val;
  }

  get currentLyricText() {
    return this.queue.currentLyricText;
  }

  set currentLyricText(val) {
    this.queue.currentLyricText = val;
  }

  _sanitizeDiscordLyricLine(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_~|]/g, '')
      .replace(/@(everyone|here)/gi, '')
      .replace(/<@&?\d+>/g, '')
      .trim();
  }

  clearLiveLyrics() {
    if (this.queue.liveLyricsTimer) {
      clearTimeout(this.queue.liveLyricsTimer);
      this.queue.liveLyricsTimer = null;
    }
    if (this.queue._prefetchLyricsTimer) {
      clearTimeout(this.queue._prefetchLyricsTimer);
      this.queue._prefetchLyricsTimer = null;
    }
    this.queue.currentLyricText = '';
    this.queue.currentLyricIndex = -1;
    this.queue.cachedSyncedLyrics = null;
    this.queue.hasSyncedLyrics = false;
    this.queue.autoLyricOffsetMs = 0;
    this.queue.userLyricOffsetMs = 0;
    this.queue.currentLyricOffsetMs = 0;
    this.queue._lastLyricsEditTime = 0;
    this.queue._lastProgressEditTime = 0;
    this.queue._lastRenderedLyricIdx = -1;
    this.queue._lastRenderedChunkIdx = -1;
  }

  schedulePrefetchLyrics(delayMs = 2000) {
    if (this.queue._prefetchLyricsTimer) {
      clearTimeout(this.queue._prefetchLyricsTimer);
    }
    this.queue._prefetchLyricsTimer = setTimeout(() => {
      this.queue._prefetchLyricsTimer = null;
      this._prefetchQueueLyrics();
    }, delayMs);
  }

  _prefetchQueueLyrics() {
    if (this.queue.isDestroyed || this.queue.isStopped) return;
    try {
      if (typeof isCpuOverloaded === 'function' && isCpuOverloaded(0.8)) return;

      const guildSettings = this.queue.guild?.id ? settingsManager.get(this.queue.guild.id) : null;
      const layers = guildSettings?.lyricsLayers;

      const userQueue = (this.queue.songs || []).filter(s => s && !s.is247 && s.requestedBy !== 'Auto (24/7)');
      const nextTrack = userQueue[0] || this.queue.prefetchedSong;
      if (!nextTrack || nextTrack.is247) return;

      const durMs = nextTrack.durationMs || (nextTrack.duration ? parseDurationToMs(nextTrack.duration) : 0);
      prefetchLyrics(nextTrack.title, nextTrack.artist, durMs, nextTrack.url, layers);
    } catch (e) {}
  }

  _applySyncedLyrics(song, lyricsData) {
    if (!song || !lyricsData || !Array.isArray(lyricsData.syncedLyrics) || lyricsData.syncedLyrics.length < 3) {
      return false;
    }

    let activeSyncedLyrics = lyricsData.syncedLyrics;
    let activeAutoOffsetMs = lyricsData.autoOffsetMs || 0;

    if (song.trimStart > 0 || song.trimEnd > 0) {
      const trimStartMs = (song.trimStart || 0) * 1000;
      const realDurMs = song.durationMs || 0;
      activeAutoOffsetMs = 0;

      const lastLineMs = Array.isArray(lyricsData.syncedLyrics) && lyricsData.syncedLyrics.length > 0
        ? (lyricsData.syncedLyrics[lyricsData.syncedLyrics.length - 1].time || 0)
        : 0;
      const lyricDurSec = Number(lyricsData.duration) || Math.round(lastLineMs / 1000);
      const rawSec = song.rawDurationSec || 0;
      const realSec = song.realDurationSec || Math.round(realDurMs / 1000);

      let shouldShiftTimestamps = false;
      if (lyricsData.source === 'youtube_cc') {
        shouldShiftTimestamps = trimStartMs > 500;
      } else if (rawSec > realSec && lyricDurSec > 0) {
        const diffRaw = Math.abs(lyricDurSec - rawSec);
        const diffReal = Math.abs(lyricDurSec - realSec);
        shouldShiftTimestamps = diffRaw <= 3 && diffReal >= 8;
      }

      if (shouldShiftTimestamps && trimStartMs > 0 && Array.isArray(lyricsData.syncedLyrics)) {
        activeSyncedLyrics = lyricsData.syncedLyrics
          .map(line => ({
            ...line,
            time: line.time - trimStartMs,
            time_ms: (line.time_ms ?? line.time) - trimStartMs
          }))
          .filter(line => line.time >= -500 && (realDurMs <= 0 || line.time <= realDurMs + 2000))
          .map(line => ({
            ...line,
            time: Math.max(0, line.time),
            time_ms: Math.max(0, line.time_ms)
          }));
      }
    }

    this.queue.cachedSyncedLyrics = activeSyncedLyrics;
    this.queue.hasSyncedLyrics = true;
    this.queue.autoLyricOffsetMs = Number(activeAutoOffsetMs || 0);
    this.queue.userLyricOffsetMs = Number(lyricsData.userSavedOffsetMs || 0);
    this.queue.currentLyricOffsetMs = this.queue.userLyricOffsetMs + this.queue.autoLyricOffsetMs;
    this.queue._lastLyricsEditTime = 0;
    this.queue._lastRenderedLyricIdx = -1;
    this.queue._lastRenderedChunkIdx = -1;
    return true;
  }

  async attachLateLyrics(song, lyricsData) {
    if (this.queue.isDestroyed || this.queue.isStopped || this.queue.currentSong !== song) return;
    if (this.queue.hasSyncedLyrics) return;

    const applied = this._applySyncedLyrics(song, lyricsData);
    if (!applied) return;

    console.log(`[Live Lyrics Hot-Attach] Đã nạp nóng thành công ${lyricsData.syncedLyrics?.length} câu lời (nguồn: ${lyricsData.source}) cho "${song.title}"`);
    this.scheduleNextLyricUpdate(song);

    if (this.queue.nowPlayingMessage) {
      try {
        const cardPayload = createNowPlayingCard(song, this.queue);
        await this.queue.nowPlayingMessage.edit(cardPayload).catch(() => {});
      } catch (e) {}
    }
  }

  async startLiveLyrics() {
    this.clearLiveLyrics();
    const song = this.queue.currentSong;
    if (!song || song.is247 || song.requestedBy === 'Auto (24/7)' || (this.queue.mode247 && !song)) {
      return;
    }

    this._prefetchQueueLyrics();

    try {
      if (this.queue.isDestroyed || this.queue.isStopped || this.queue.currentSong !== song) return;

      const guildSettings = this.queue.guild?.id ? settingsManager.get(this.queue.guild.id) : null;
      const durationMs = (song.rawDurationSec ? song.rawDurationSec * 1000 : (song.durationMs || (song.duration ? parseDurationToMs(song.duration) : 0)));
      const lyricsData = await fetchLyrics(song.title, song.artist, durationMs, song.url, guildSettings?.lyricsLayers);

      if (this.queue.isDestroyed || this.queue.isStopped || this.queue.currentSong !== song) return;

      if (lyricsData && Array.isArray(lyricsData.syncedLyrics) && lyricsData.syncedLyrics.length >= 3) {
        this._applySyncedLyrics(song, lyricsData);
        console.log(`[Live Lyrics] Hiển thị tức thì (${lyricsData.syncedLyrics.length} câu, offset: ${this.queue.currentLyricOffsetMs}ms, nguồn: ${lyricsData.source}) cho "${song.title}"`);
        this.scheduleNextLyricUpdate(song);
      } else {
        this.queue.hasSyncedLyrics = false;
        this.queue.cachedSyncedLyrics = null;
        this.queue.currentLyricText = '';
        this.scheduleProgressBarUpdate(song);
      }
    } catch (err) {
      this.queue.hasSyncedLyrics = false;
      this.queue.cachedSyncedLyrics = null;
      this.queue.currentLyricText = '';
      this.scheduleProgressBarUpdate(song);
    }
  }

  async scheduleProgressBarUpdate(song) {
    if (this.queue.liveLyricsTimer) {
      clearTimeout(this.queue.liveLyricsTimer);
      this.queue.liveLyricsTimer = null;
    }

    const is247Mode = Boolean(
      song?.is247 ||
      song?.requestedBy === 'Auto (24/7)' ||
      song?.requestedBy === 'Auto (24/7 Lofi)' ||
      (typeof song?.requestedBy === 'string' && song.requestedBy.includes('24/7')) ||
      (this.queue.mode247 && (!song || song.is247))
    );

    if (this.queue.isDestroyed || this.queue.isStopped || this.queue.currentSong !== song || !this.queue.nowPlayingMessage || this.queue.hasSyncedLyrics || is247Mode) {
      return;
    }

    if (this.queue.paused) {
      return;
    }

    if (this.queue._pendingButtonAction && this.queue._pendingButtonActionTime && (Date.now() - this.queue._pendingButtonActionTime > 2500)) {
      this.queue._pendingButtonAction = null;
    }
    if (this.queue._isProcessingAction || this.queue._pendingButtonAction) {
      this.queue.liveLyricsTimer = setTimeout(() => this.scheduleProgressBarUpdate(song), 1500);
      return;
    }

    try {
      const now = Date.now();
      const timeSinceLastEdit = now - (this.queue._lastProgressEditTime || 0);

      if (timeSinceLastEdit >= 4000) {
        this.queue._lastProgressEditTime = now;
        const cardPayload = createNowPlayingCard(this.queue.currentSong, this.queue);
        await this.queue.nowPlayingMessage.edit(cardPayload).catch(editErr => {
          if (editErr?.code === 10008) {
            this.clearLiveLyrics();
            this.queue.nowPlayingMessage = null;
          }
        });
      }

      const seekMs = (song.seekPosition || 0) * 1000;
      const playbackMs = seekMs + (this.queue.currentResource?.playbackDuration || 0);
      const totalMs = song.durationMs || (song.duration ? parseDurationToMs(song.duration) : 0);

      if (totalMs > 0 && playbackMs >= totalMs) {
        return;
      }

      this.queue.liveLyricsTimer = setTimeout(() => this.scheduleProgressBarUpdate(song), 4000);
    } catch (e) {}
  }

  async scheduleNextLyricUpdate(song) {
    if (this.queue.liveLyricsTimer) {
      clearTimeout(this.queue.liveLyricsTimer);
      this.queue.liveLyricsTimer = null;
    }

    if (this.queue.isDestroyed || this.queue.isStopped || this.queue.currentSong !== song || !this.queue.cachedSyncedLyrics || !this.queue.nowPlayingMessage) {
      return;
    }

    if (this.queue.paused) {
      return;
    }

    if (this.queue._pendingButtonAction && this.queue._pendingButtonActionTime && (Date.now() - this.queue._pendingButtonActionTime > 2500)) {
      this.queue._pendingButtonAction = null;
    }
    if (this.queue._isProcessingAction || this.queue._pendingButtonAction) {
      this.queue.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), 1500);
      return;
    }

    try {
      const seekMs = (song.seekPosition || 0) * 1000;
      const offsetMs = this.queue.currentLyricOffsetMs || 0;
      const rawCurrentMs = seekMs + (this.queue.currentResource?.playbackDuration || 0);
      const effectiveCurrentMs = rawCurrentMs + offsetMs;

      const LOOKAHEAD_MS = 1500;
      const embedEffectiveMs = effectiveCurrentMs + LOOKAHEAD_MS;

      const lyrics = this.queue.cachedSyncedLyrics;
      let low = 0;
      let high = lyrics.length - 1;
      let activeIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lyrics[mid].time <= embedEffectiveMs) {
          activeIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (activeIdx < 0) {
        const firstLineTime = lyrics[0]?.time || 5000;
        const msUntilFirst = Math.max(1000, (firstLineTime - LOOKAHEAD_MS) - effectiveCurrentMs);
        this.queue.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), Math.min(msUntilFirst, 4000));
        return;
      }

      const chunkIndex = Math.max(0, Math.floor(activeIdx / 4));
      const startIdx = chunkIndex * 4;
      const visibleLines = lyrics.slice(startIdx, startIdx + 4);

      const lines = [];
      for (const line of visibleLines) {
        const text = this._sanitizeDiscordLyricLine(line?.text || '');
        if (text) {
          lines.push(`> • *${text}*`);
        }
      }

      const newLyricText = lines.join('\n');
      const now = Date.now();
      const timeSinceLastEdit = now - (this.queue._lastLyricsEditTime || 0);

      if (chunkIndex !== this.queue._lastRenderedChunkIdx || !this.queue.currentLyricText) {
        if (timeSinceLastEdit >= 4000) {
          if (newLyricText && newLyricText !== this.queue.currentLyricText) {
            this.queue.currentLyricText = newLyricText;
            this.queue.currentLyricIndex = startIdx;
            this.queue._lastRenderedLyricIdx = activeIdx;
            this.queue._lastRenderedChunkIdx = chunkIndex;
            this.queue._lastLyricsEditTime = now;

            const cardPayload = createNowPlayingCard(this.queue.currentSong, this.queue);
            await this.queue.nowPlayingMessage.edit(cardPayload).catch(editErr => {
              if (editErr?.code === 10008) {
                this.clearLiveLyrics();
                this.queue.nowPlayingMessage = null;
              }
            });
          } else {
            this.queue.currentLyricIndex = startIdx;
            this.queue._lastRenderedLyricIdx = activeIdx;
            this.queue._lastRenderedChunkIdx = chunkIndex;
          }
        } else {
          const waitCooldown = 4000 - timeSinceLastEdit;
          this.queue.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), Math.max(300, waitCooldown));
          return;
        }
      }

      const nextChunkIdx = (chunkIndex + 1) * 4;
      if (nextChunkIdx >= lyrics.length) {
        return;
      }

      const nextChunkStartLine = lyrics[nextChunkIdx];
      const msUntilNextChunk = Math.max(1000, (nextChunkStartLine.time - LOOKAHEAD_MS) - effectiveCurrentMs);
      const minCooldownRemaining = Math.max(0, 4000 - (Date.now() - (this.queue._lastLyricsEditTime || 0)));
      const dynamicDelay = Math.max(msUntilNextChunk, minCooldownRemaining);

      this.queue.liveLyricsTimer = setTimeout(() => this.scheduleNextLyricUpdate(song), dynamicDelay);
    } catch (schedErr) {}
  }

  refreshNowPlayingCard() {
    if (this.queue.hasSyncedLyrics) return;
    if (this.queue._refreshCardTimer) clearTimeout(this.queue._refreshCardTimer);
    this.queue._refreshCardTimer = setTimeout(async () => {
      try {
        if (!this.queue.nowPlayingMessage || !this.queue.currentSong || this.queue.isStopped) return;
        const isV2 = this.queue.nowPlayingMessage.components?.[0]?.type === 17 || this.queue.nowPlayingMessage.flags?.has?.(32768);
        if (isV2) {
          const cardPayload = createNowPlayingCard(this.queue.currentSong, this.queue);
          await this.queue.nowPlayingMessage.edit(cardPayload).catch(() => {});
        } else {
          const embed = createNowPlayingEmbed(this.queue.currentSong, this.queue);
          const controls = createMusicControls(this.queue);
          await this.queue.nowPlayingMessage.edit({ embeds: [embed], components: controls }).catch(() => {});
        }
      } catch (e) {}
    }, 600);
  }

  scheduleRepostNowPlayingCard(delayMs = 1200) {
    if (this.queue._repostCardTimer) {
      clearTimeout(this.queue._repostCardTimer);
    }
    this.queue._repostCardTimer = setTimeout(async () => {
      this.queue._repostCardTimer = null;
      await this.repostNowPlayingCardToBottom();
    }, delayMs);
  }

  async repostNowPlayingCardToBottom() {
    if (this.queue.isDestroyed || this.queue.isStopped || !this.queue.currentSong || !this.queue.textChannel) return;
    const is247Lofi = Boolean(this.queue.currentSong?.requestedBy === 'Auto (24/7)' || this.queue.currentSong?.is247);
    if (is247Lofi) return;

    try {
      let isAlreadyLast = false;
      try {
        const lastMessages = await this.queue.textChannel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastMsg = lastMessages?.first();
        isAlreadyLast = Boolean(this.queue.nowPlayingMessage && lastMsg && lastMsg.id === this.queue.nowPlayingMessage.id);
      } catch (fetchErr) {}

      if (isAlreadyLast) return;

      const cardPayload = createNowPlayingCard(this.queue.currentSong, this.queue);

      if (this.queue.nowPlayingMessage) {
        const oldMsg = this.queue.nowPlayingMessage;
        this.queue.nowPlayingMessage = null;
        await oldMsg.delete().catch(() => {});
      }

      const newMsg = await this.queue.textChannel.send(cardPayload);
      this.queue.nowPlayingMessage = newMsg;

      this.queue._lastRenderedChunkIdx = -1;
      this.queue._lastLyricsEditTime = 0;

      if (this.queue.hasSyncedLyrics) {
        this.scheduleNextLyricUpdate(this.queue.currentSong);
      } else {
        this.scheduleProgressBarUpdate(this.queue.currentSong);
      }
    } catch (err) {
      console.warn('[RepostNowPlayingCard] Lỗi khi đưa thẻ Now Playing xuống đáy:', err.message);
    }
  }
}

module.exports = DiscordCardRenderer;
