const settingsManager = require('../structures/SettingsManager');
const musicManager = require('../structures/MusicManager');
const { logAction } = require('../utils/debugLogger');
const { isAllowedGuild } = require('./guildEvents');

/**
 * Ghi log tin nhắn của người dùng trong kênh voice / kênh âm nhạc hoặc có đính kèm
 * Đồng thời tự động repost Now Playing Card xuống đáy khi có cuộc hội thoại người dùng
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function handleMessageCreate(client, message) {
  if (message.author.bot || !message.guild) return;
  if (!isAllowedGuild(message.guild.id, message.author.id)) return;

  // Tự động đẩy thẻ Now Playing xuống đáy khi người dùng chat trong kênh text âm nhạc (>= 2-3 tin nhắn, debounce 4s, cooldown 15s)
  try {
    const queue = musicManager.get(message.guild.id);
    if (queue && queue.textChannel && queue.textChannel.id === message.channel.id && queue.currentSong && !queue.isStopped) {
      const is247Lofi = Boolean(queue.currentSong?.requestedBy === 'Auto (24/7)' || queue.currentSong?.is247);
      if (!is247Lofi) {
        queue._chatMsgCount = (queue._chatMsgCount || 0) + 1;
        const now = Date.now();
        const lastRepostTime = queue._lastChatRepostTime || 0;
        const cooldownMs = 15000; // Cooldown 15s giữa các lần repost thẻ

        if (queue._chatMsgCount >= 2 && (now - lastRepostTime >= cooldownMs)) {
          if (queue._chatRepostDebounceTimer) {
            clearTimeout(queue._chatRepostDebounceTimer);
          }
          queue._chatRepostDebounceTimer = setTimeout(async () => {
            queue._chatRepostDebounceTimer = null;
            queue._chatMsgCount = 0;
            queue._lastChatRepostTime = Date.now();
            if (typeof queue.repostNowPlayingCardToBottom === 'function') {
              await queue.repostNowPlayingCardToBottom().catch(() => {});
            }
          }, 4000); // Debounce 4s
        }
      }
    }
  } catch (e) {}

  const isVoiceText = message.channel.isVoiceBased?.() || message.channel.type === 2;
  const guildSettings = settingsManager.get(message.guild.id);
  const isMusicChan = guildSettings.musicChannelId && message.channel.id === guildSettings.musicChannelId;

  if (isVoiceText || isMusicChan || message.attachments.size > 0) {
    const attachmentUrls = message.attachments.map(a => a.url);
    logAction('MESSAGE_USER_SEND', {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      user: message.author.tag,
      content: message.content,
      attachments: attachmentUrls,
      avatar: message.author.displayAvatarURL({ dynamic: true })
    });
  }
}

/**
 * Xử lý ghi nhận khi tin nhắn bị sửa (Message Update)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} oldMessage
 * @param {import('discord.js').Message} newMessage
 */
async function handleMessageUpdate(client, oldMessage, newMessage) {
  try {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    logAction('MESSAGE_EDIT', {
      type: 'USER_MESSAGE_EDIT',
      channelId: newMessage.channelId,
      guildId: newMessage.guild.id,
      userId: newMessage.author?.id,
      user: newMessage.author?.tag,
      messageId: newMessage.id,
      oldContent: oldMessage.content || '',
      newContent: newMessage.content || ''
    });
  } catch (e) {}
}

/**
 * Xử lý ghi nhận khi tin nhắn bị xóa (Message Delete)
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function handleMessageDelete(client, message) {
  try {
    if (!message.guild || message.author?.id === client.user.id) return;
    logAction('MESSAGE_DELETE', {
      type: 'USER_MESSAGE_DELETE',
      channelId: message.channelId,
      guildId: message.guild.id,
      userId: message.author?.id,
      user: message.author?.tag,
      messageId: message.id,
      content: message.content || ''
    });
  } catch (e) {}
}

module.exports = [
  {
    name: 'messageCreate',
    execute: handleMessageCreate
  },
  {
    name: 'messageUpdate',
    execute: handleMessageUpdate
  },
  {
    name: 'messageDelete',
    execute: handleMessageDelete
  }
];
