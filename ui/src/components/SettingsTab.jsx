import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Radio,
  Sparkles,
  ShieldCheck,
  User,
  Mic2,
  ScrollText,
  Lock,
  Bell,
  Volume2,
  Music,
  Hash,
  Disc
} from 'lucide-react';
import { API_BASE } from '../config';

export default function SettingsTab({ guildId, guildName, token, player, onAction, user }) {
  const isAdmin = Boolean(user?.isAdmin);

  // Local User Preferences
  const [autoScrollLyrics, setAutoScrollLyrics] = useState(() => {
    const saved = localStorage.getItem('anna_karaoke_autoscroll');
    return saved !== null ? saved === 'true' : true;
  });

  // Server Settings State
  const [serverSettings, setServerSettings] = useState({
    logChannelId: null,
    musicChannelId: null,
    lockedVoiceChannelId: null,
    mode247: false,
    autoplay: true,
    crossfadeDuration: 0,
    updateVoiceStatus: true,
    announceSongs: true,
    djOnly: false,
    djRoleId: null,
    defaultVolume: 80
  });

  const [textChannels, setTextChannels] = useState([]);
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState('');

  useEffect(() => {
    if (!isAdmin || !guildId || !token) return;

    setIsLoadingSettings(true);
    fetch(`${API_BASE}/api/guilds/${guildId}/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        setIsLoadingSettings(false);
        if (data.success && data.settings) {
          setServerSettings((prev) => ({ ...prev, ...data.settings }));
          setTextChannels(data.textChannels || []);
          setVoiceChannels(data.voiceChannels || []);
          setRoles(data.roles || []);
        }
      })
      .catch(() => {
        setIsLoadingSettings(false);
      });
  }, [isAdmin, guildId, token]);

  const toggleAutoScroll = () => {
    const next = !autoScrollLyrics;
    setAutoScrollLyrics(next);
    localStorage.setItem('anna_karaoke_autoscroll', String(next));
    window.dispatchEvent(new CustomEvent('anna_autoscroll_change', { detail: next }));
  };

  const updateSetting = async (key, value) => {
    const newSettings = { ...serverSettings, [key]: value };
    setServerSettings(newSettings);
    setIsSaving(true);

    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ [key]: value })
      });
      const data = await res.json().catch(() => ({}));
      setIsSaving(false);
      if (res.ok && data.success) {
        setSaveSuccessMessage('Đã lưu thay đổi!');
        setTimeout(() => setSaveSuccessMessage(''), 2500);
      }
    } catch (err) {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-anna-surface border border-anna-border/80 rounded-3xl p-5 sm:p-6 pb-8 flex flex-col gap-5 animate-in fade-in">
      {/* Header with Role Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-anna-border/50">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-anna-accent" />
          <h3 className="text-sm font-bold text-white">Cài Đặt</h3>
          {saveSuccessMessage && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-anna-green/20 text-anna-green font-bold animate-in fade-in">
              ✓ {saveSuccessMessage}
            </span>
          )}
        </div>

        {isAdmin ? (
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-anna-green/10 border border-anna-green/30 text-anna-green font-bold flex items-center gap-1 shadow-sm">
            <ShieldCheck className="w-3 h-3" />
            <span>Quản Trị Viên</span>
          </span>
        ) : (
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-anna-card border border-anna-border text-anna-muted font-bold flex items-center gap-1">
            <User className="w-3 h-3" />
            <span>Thành Viên</span>
          </span>
        )}
      </div>

      {/* SECTION 1: Cài Đặt Cá Nhân */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-anna-muted flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-anna-accent" />
          <span>Tùy Chọn Cá Nhân</span>
        </h4>

        {/* Karaoke Auto-Scroll Toggle */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 hover:border-anna-border transition">
          <div className="pr-4">
            <div className="flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-anna-accent" />
              <p className="text-xs font-bold text-white">Tự động cuộn lời bài hát (Karaoke Sync)</p>
            </div>
            <p className="text-[11px] text-anna-muted mt-1 leading-relaxed">
              Tự động cuộn và làm nổi bật theo từng câu hát khi bài hát đang phát.
            </p>
          </div>

          <button
            onClick={toggleAutoScroll}
            title={autoScrollLyrics ? 'Tắt tự động cuộn' : 'Bật tự động cuộn'}
            className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none ${
              autoScrollLyrics ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                autoScrollLyrics ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* SECTION 2: Cài Đặt Server (Chỉ hiển thị cho Quản Trị Viên) */}
      {isAdmin && (
        <div className="flex flex-col gap-3.5 pt-3 border-t border-anna-border/50 animate-in fade-in">
          <h4 className="text-xs font-bold uppercase tracking-wider text-anna-green flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Cài Đặt Máy Chủ</span>
          </h4>

          {/* 1. Log Channel */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 flex flex-col gap-2.5 transition">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <ScrollText className="w-3.5 h-3.5 text-anna-accent" />
                <span>Kênh Nhật Ký Hoạt Động (Log Channel)</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Ghi lại toàn bộ nhật ký hoạt động của bot vào kênh Discord được chỉ định.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-anna-border/40">
              <select
                value={serverSettings.logChannelId || ''}
                onChange={(e) => updateSetting('logChannelId', e.target.value || null)}
                disabled={isSaving}
                className="flex-1 bg-anna-surface border border-anna-border text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-anna-accent font-medium transition cursor-pointer"
              >
                <option value="">🚫 Tắt kênh nhật ký</option>
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    # {ch.name}
                  </option>
                ))}
              </select>

              {serverSettings.logChannelId && (
                <button
                  onClick={() => updateSetting('logChannelId', null)}
                  disabled={isSaving}
                  className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition active:scale-95"
                >
                  Tắt Log
                </button>
              )}
            </div>
          </div>

          {/* 2. Lock Command Channel */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 flex flex-col gap-2.5 transition">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-anna-accent" />
                <span>Kênh Nhận Lệnh (Music Channel)</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Giới hạn chỉ cho phép sử dụng lệnh bot tại kênh chat được chỉ định.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-anna-border/40">
              <select
                value={serverSettings.musicChannelId || ''}
                onChange={(e) => updateSetting('musicChannelId', e.target.value || null)}
                disabled={isSaving}
                className="flex-1 bg-anna-surface border border-anna-border text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-anna-accent font-medium transition cursor-pointer"
              >
                <option value="">🌐 Cho phép dùng lệnh ở mọi kênh</option>
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    # {ch.name}
                  </option>
                ))}
              </select>

              {serverSettings.musicChannelId && (
                <button
                  onClick={() => updateSetting('musicChannelId', null)}
                  disabled={isSaving}
                  className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition active:scale-95"
                >
                  Mở Khóa
                </button>
              )}
            </div>
          </div>

          {/* 3. Lock Voice Channel */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 flex flex-col gap-2.5 transition">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-anna-accent" />
                <span>Khóa Phòng Voice Cố Định</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Cố định bot chỉ tham gia và phát nhạc tại phòng Voice được chọn.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-anna-border/40">
              <select
                value={serverSettings.lockedVoiceChannelId || ''}
                onChange={(e) => updateSetting('lockedVoiceChannelId', e.target.value || null)}
                disabled={isSaving}
                className="flex-1 bg-anna-surface border border-anna-border text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-anna-accent font-medium transition cursor-pointer"
              >
                <option value="">🔊 Cho phép bot vào mọi phòng Voice</option>
                {voiceChannels.map((vc) => (
                  <option key={vc.id} value={vc.id}>
                    🔊 {vc.name}
                  </option>
                ))}
              </select>

              {serverSettings.lockedVoiceChannelId && (
                <button
                  onClick={() => updateSetting('lockedVoiceChannelId', null)}
                  disabled={isSaving}
                  className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition active:scale-95"
                >
                  Mở Khóa
                </button>
              )}
            </div>
          </div>

          {/* 4. 24/7 Mode */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 hover:border-anna-border transition">
            <div className="pr-4">
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-anna-accent" />
                <span>Chế Độ 24/7 (Luôn Trực Tuyến)</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Duy trì kết nối liên tục trong phòng Voice và phát nhạc nền khi hàng chờ trống.
              </p>
            </div>

            <button
              onClick={() => {
                const next = !serverSettings.mode247;
                updateSetting('mode247', next);
                onAction('set247', next);
              }}
              title={serverSettings.mode247 ? 'Tắt chế độ 24/7' : 'Bật chế độ 24/7'}
              className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none ${
                serverSettings.mode247 ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                  serverSettings.mode247 ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* 5. Autoplay */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 hover:border-anna-border transition">
            <div className="pr-4">
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-anna-accent" />
                <span>Tự Động Phát Bài Tương Tự (Autoplay)</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Tự động tìm kiếm và nối tiếp các bài hát tương tự khi kết thúc hàng chờ.
              </p>
            </div>

            <button
              onClick={() => {
                const next = serverSettings.autoplay === false;
                updateSetting('autoplay', next);
                onAction('setAutoplay', next);
              }}
              title={serverSettings.autoplay !== false ? 'Tắt Autoplay' : 'Bật Autoplay'}
              className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none ${
                serverSettings.autoplay !== false ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                  serverSettings.autoplay !== false ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* 6. Crossfade */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 flex flex-col gap-2.5 transition">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Disc className="w-3.5 h-3.5 text-anna-accent" />
                <span>Hòa Âm Chuyển Bài (Fade-in)</span>
              </p>
              <span className="text-xs font-mono font-bold text-anna-accent bg-anna-accent/10 px-2 py-0.5 rounded-md">
                {serverSettings.crossfadeDuration > 0 ? `${serverSettings.crossfadeDuration} giây` : 'Tắt (0s)'}
              </span>
            </div>
            <p className="text-[11px] text-anna-muted leading-relaxed">
              Tạo hiệu ứng tăng dần âm lượng khi bắt đầu bài hát mới để chuyển bài mượt mà hơn.
            </p>

            <div className="flex items-center gap-3 pt-2 border-t border-anna-border/40">
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={serverSettings.crossfadeDuration || 0}
                onChange={(e) => updateSetting('crossfadeDuration', parseInt(e.target.value, 10))}
                className="flex-1 accent-anna-accent cursor-pointer"
              />
              <span className="text-[11px] font-mono text-anna-muted w-8 text-right">
                {serverSettings.crossfadeDuration || 0}s
              </span>
            </div>
          </div>

          {/* 7. Voice Channel Status */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 hover:border-anna-border transition">
            <div className="pr-4">
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-anna-accent" />
                <span>Trạng Thái Kênh Voice (Voice Status)</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Hiển thị tên bài hát đang phát trên thanh trạng thái của phòng Voice.
              </p>
            </div>

            <button
              onClick={() => updateSetting('updateVoiceStatus', serverSettings.updateVoiceStatus === false)}
              title={serverSettings.updateVoiceStatus !== false ? 'Tắt trạng thái voice' : 'Bật trạng thái voice'}
              className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none ${
                serverSettings.updateVoiceStatus !== false ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                  serverSettings.updateVoiceStatus !== false ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* 8. Announce Songs */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 hover:border-anna-border transition">
            <div className="pr-4">
              <p className="text-xs font-bold text-white flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-anna-accent" />
                <span>Thông Báo Bài Hát Mới</span>
              </p>
              <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                Gửi tin nhắn thông báo kèm nút điều khiển mỗi khi chuyển sang bài hát tiếp theo.
              </p>
            </div>

            <button
              onClick={() => updateSetting('announceSongs', serverSettings.announceSongs === false)}
              title={serverSettings.announceSongs !== false ? 'Tắt thông báo bài hát' : 'Bật thông báo bài hát'}
              className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-anna-accent focus-visible:outline-none ${
                serverSettings.announceSongs !== false ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                  serverSettings.announceSongs !== false ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* 9. DJ Mode */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-anna-card border border-anna-border/80 flex flex-col gap-2.5 transition">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-anna-accent" />
                  <span>Chế Độ DJ (DJ Only)</span>
                </p>
                <p className="text-[11px] text-anna-muted mt-0.5 leading-relaxed">
                  Chỉ cho phép Quản trị viên và thành viên có vai trò DJ điều khiển nhạc.
                </p>
              </div>

              <button
                onClick={() => updateSetting('djOnly', !serverSettings.djOnly)}
                className={`w-12 h-6 rounded-full relative p-0.5 transition-all flex-shrink-0 active:scale-95 ${
                  serverSettings.djOnly ? 'bg-anna-accent shadow-lg shadow-anna-accent/25' : 'bg-anna-border'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                    serverSettings.djOnly ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {serverSettings.djOnly && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-anna-border/40 animate-in fade-in">
                <span className="text-xs text-white font-medium">Vai trò DJ:</span>
                <select
                  value={serverSettings.djRoleId || ''}
                  onChange={(e) => updateSetting('djRoleId', e.target.value || null)}
                  disabled={isSaving}
                  className="flex-1 bg-anna-surface border border-anna-border text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-anna-accent font-medium transition cursor-pointer"
                >
                  <option value="">🏷️ Chọn vai trò Discord...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      @{r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
