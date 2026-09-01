const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const musicManager = require('../structures/MusicManager');
const settingsManager = require('../structures/SettingsManager');
const { createSuccessEmbed, createErrorEmbed, EMOJI_TAG } = require('../utils/embed');
const { createContext } = require('../utils/commandHelper');

module.exports = {
  name: '247',
  aliases: ['24/7', 'alwaysonline'],
  description: 'Toggle 24/7 voice stay & relaxing Lofi background playback (Server Managers only)',
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Toggle 24/7 voice stay & relaxing Lofi background playback (Server Managers only)')
    .setDescriptionLocalizations({
      vi: 'Bật/tắt duy trì bot trong Voice 24/7 và phát Lofi thư giãn (Chỉ Quản trị viên)'
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt
        .setName('status')
        .setDescription('Turn 24/7 mode on or off')
        .setDescriptionLocalizations({
          vi: 'Bật hoặc tắt chế độ 24/7'
        })
        .setRequired(false)
        .addChoices(
          { name: 'On', name_localizations: { vi: 'Bật (ON)' }, value: 'on' },
          { name: 'Off', name_localizations: { vi: 'Tắt (OFF)' }, value: 'off' }
        )
    ),
  async execute(source, args) {
    const ctx = createContext(source, args);
    if (!ctx.guild) return;

    // Chỉ Admin máy chủ mới được phép cấu hình chế độ 24/7
    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const hasAdminPerm = ctx.member?.permissions.has('Administrator') || ctx.member?.permissions.has('ManageGuild');
    if (!isOwner && !hasAdminPerm) {
      return ctx.reply({
        embeds: [createErrorEmbed('Chỉ **Chủ sở hữu máy chủ** hoặc **Quản trị viên (Administrator / Manage Server)** mới có quyền thay đổi Cài đặt 24/7!')]
      });
    }

    const voiceChannel = ctx.member?.voice?.channel;
    let queue = musicManager.get(ctx.guild.id);
    const statusOption = ctx.options.getString('status');

    if (!queue) {
      if (!voiceChannel) {
        return ctx.reply({ embeds: [createErrorEmbed('Bạn cần vào một phòng Voice trước để bật chế độ 24/7!')] });
      }
      queue = musicManager.getOrCreate(ctx.guild, ctx.channel, voiceChannel);
      await queue.connect();
      queue.set247(true);
      settingsManager.update(ctx.guild.id, { mode247: true });
      await queue._play247BackgroundLofi();
      return ctx.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã kết nối vào Voice và BẬT chế độ 24/7 (Đang phát nhạc Lofi thư giãn)!`)] });
    }

    let is247;
    if (statusOption === 'on') {
      is247 = true;
      queue.set247(true);
      settingsManager.update(ctx.guild.id, { mode247: true });
    } else if (statusOption === 'off') {
      is247 = false;
      queue.set247(false);
      settingsManager.update(ctx.guild.id, { mode247: false });
    } else {
      is247 = queue.toggle247();
      settingsManager.update(ctx.guild.id, { mode247: is247 });
    }

    if (is247) {
      if (!queue.currentSong) {
        await queue._play247BackgroundLofi();
      }
      return ctx.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã **BẬT** chế độ 24/7 (Bot sẽ duy trì trong phòng và phát Lofi khi trống)!`)] });
    } else {
      return ctx.reply({ embeds: [createSuccessEmbed(`${EMOJI_TAG.infinity} Đã **TẮT** chế độ 24/7 (Bot sẽ tự rời phòng khi hết nhạc hoặc phòng trống sau 1 phút)!`)] });
    }
  }
};
