const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { EMOJI_TAG } = require('../utils/embed');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'stop',
  aliases: ['st', 'off'],
  description: 'Stop music playback and clear queue',
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop music playback and clear queue')
    .setDescriptionLocalizations({
      vi: 'Dừng phát nhạc và xóa toàn bộ hàng chờ'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildSettings = settingsManager.get(ctx.guild.id);
    const queue = musicManager.get(ctx.guild.id);
    const isAdmin = Boolean(
      ctx.member?.permissions?.has('Administrator') ||
      ctx.member?.permissions?.has('ManageGuild') ||
      ctx.guild.ownerId === ctx.user.id
    );
    const is247 = queue ? queue.mode247 : Boolean(guildSettings.mode247);
    if (is247 && !isAdmin) {
      return ctx.reply(`${EMOJI_TAG.warning} ${t(ctx.guild.id, 'common.admin_only_247')}`);
    }
    if (!hasMusicPermission(ctx.member)) {
      const roleText = guildSettings.djRoleId ? `<@&${guildSettings.djRoleId}>` : 'DJ';
      return ctx.reply(t(ctx.guild.id, 'common.dj_only', { role: roleText }));
    }

    if (!queue) {
      return ctx.reply(t(ctx.guild.id, 'common.no_queue'));
    }

    const botVoice = ctx.guild.members.me?.voice?.channel;
    const memberVoice = ctx.member?.voice?.channel;
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id)) {
      return ctx.reply(t(ctx.guild.id, 'common.different_voice', { channel: botVoice.name }));
    }
    if (!memberVoice) {
      return ctx.reply(t(ctx.guild.id, 'common.no_voice'));
    }

    queue.stop();
    const isEn = guildSettings.language === 'en';
    const modeText = queue.mode247 
      ? (isEn ? ' (Bot remains in voice due to 24/7 mode)' : ' (Bot vẫn duy trì trong voice vì đang bật chế độ 24/7)') 
      : '';
    return ctx.reply(`${t(ctx.guild.id, 'player.stopped')}${modeText}`);
  }
};
