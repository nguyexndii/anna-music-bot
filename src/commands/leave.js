const { SlashCommandBuilder } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { hasMusicPermission } = require('../utils/permissionHelper');
const { createContext } = require('../utils/commandHelper');
const { EMOJI_TAG } = require('../utils/embed');
const { t } = require('../utils/i18n');

module.exports = {
  name: 'leave',
  aliases: ['dc', 'dis', 'disconnect', 'out', 'roi'],
  description: 'Disconnect bot from current voice channel',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect bot from current voice channel')
    .setDescriptionLocalizations({
      vi: 'Yêu cầu bot rời khỏi kênh Voice'
    }),
  async execute(source, args) {
    const ctx = createContext(source, args);
    const guildSettings = settingsManager.get(ctx.guild.id);
    const queue = musicManager.get(ctx.guild.id);
    const isAdmin = ctx.member.permissions.has('Administrator') || 
                    ctx.member.permissions.has('ManageGuild') || 
                    ctx.guild.ownerId === ctx.user.id;

    // BẢO VỆ CHẾ ĐỘ 24/7
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
    if (botVoice && (!memberVoice || memberVoice.id !== botVoice.id) && !isAdmin) {
      return ctx.reply(t(ctx.guild.id, 'common.different_voice', { channel: botVoice.name }));
    }
    if (!memberVoice && !isAdmin) {
      return ctx.reply(t(ctx.guild.id, 'common.no_voice'));
    }

    // Nếu Admin đồng ý rời phòng, tắt 24/7
    if (queue.mode247) {
      queue.mode247 = false;
      settingsManager.update(ctx.guild.id, { mode247: false });
    }

    queue.destroy();
    return ctx.reply(guildSettings.language === 'en' ? '👋 Disconnected and left the voice channel.' : '👋 Đã ngắt kết nối và rời phòng Voice.');
  }
};
