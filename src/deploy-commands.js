const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Danh sách các lệnh tắt Slash (Shortcuts) tiện lợi
const SLASH_SHORTCUTS = [
  {
    target: 'play',
    builder: () => new SlashCommandBuilder()
      .setName('p')
      .setDescription('Play a song or playlist (Shortcut for /play)')
      .setDescriptionLocalizations({ vi: 'Phát bài hát hoặc Playlist nhanh (Lệnh tắt của /play)' })
      .addStringOption(opt =>
        opt
          .setName('query')
          .setDescription('Song title, artist name, or URL')
          .setDescriptionLocalizations({ vi: 'Tên bài hát, ca sĩ hoặc đường dẫn' })
          .setRequired(false)
      )
  },
  {
    target: 'skip',
    builder: () => new SlashCommandBuilder()
      .setName('s')
      .setDescription('Skip current song (Shortcut for /skip)')
      .setDescriptionLocalizations({ vi: 'Bỏ qua bài hát hiện tại (Lệnh tắt của /skip)' })
  },
  {
    target: 'queue',
    builder: () => new SlashCommandBuilder()
      .setName('q')
      .setDescription('View current music queue (Shortcut for /queue)')
      .setDescriptionLocalizations({ vi: 'Xem danh sách hàng chờ (Lệnh tắt của /queue)' })
      .addIntegerOption(opt =>
        opt
          .setName('page')
          .setDescription('Page number to view')
          .setDescriptionLocalizations({ vi: 'Số trang cần xem' })
          .setMinValue(1)
          .setRequired(false)
      )
  },
  {
    target: 'nowplaying',
    builder: () => new SlashCommandBuilder()
      .setName('np')
      .setDescription('View now playing song & controls (Shortcut for /nowplaying)')
      .setDescriptionLocalizations({ vi: 'Xem bài hát đang phát & bảng điều khiển (Lệnh tắt của /nowplaying)' })
  },
  {
    target: 'volume',
    builder: () => new SlashCommandBuilder()
      .setName('vol')
      .setDescription('Adjust playback volume 1-100 (Shortcut for /volume)')
      .setDescriptionLocalizations({ vi: 'Điều chỉnh âm lượng phát nhạc 1-100 (Lệnh tắt của /volume)' })
      .addIntegerOption(opt =>
        opt
          .setName('level')
          .setDescription('Volume level from 1 to 100')
          .setDescriptionLocalizations({ vi: 'Mức âm lượng từ 1 đến 100' })
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(false)
      )
  },
  {
    target: 'favorite',
    builder: () => new SlashCommandBuilder()
      .setName('fav')
      .setDescription('Manage & play favorite songs (Shortcut for /favorite)')
      .setDescriptionLocalizations({ vi: 'Quản lý & phát bài yêu thích (Lệnh tắt của /favorite)' })
      .addSubcommand(sub =>
        sub
          .setName('list')
          .setDescription('View favorites list')
          .setDescriptionLocalizations({ vi: 'Xem danh sách yêu thích' })
      )
      .addSubcommand(sub =>
        sub
          .setName('play')
          .setDescription('Play all favorite songs into voice')
          .setDescriptionLocalizations({ vi: 'Phát tất cả bài yêu thích' })
      )
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Add song to favorites')
          .setDescriptionLocalizations({ vi: 'Thêm bài vào danh sách yêu thích' })
          .addStringOption(opt =>
            opt
              .setName('query')
              .setDescription('Song title or URL')
              .setDescriptionLocalizations({ vi: 'Tên bài hát hoặc link' })
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Remove a song by position')
          .setDescriptionLocalizations({ vi: 'Xóa bài khỏi yêu thích theo số thứ tự' })
          .addIntegerOption(opt =>
            opt
              .setName('index')
              .setDescription('Position number')
              .setDescriptionLocalizations({ vi: 'Số thứ tự' })
              .setMinValue(1)
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('clear')
          .setDescription('Clear all favorite songs')
          .setDescriptionLocalizations({ vi: 'Xóa toàn bộ danh sách yêu thích' })
      )
  },
  {
    target: 'lyrics',
    builder: () => new SlashCommandBuilder()
      .setName('ly')
      .setDescription('Display song lyrics (Shortcut for /lyrics)')
      .setDescriptionLocalizations({ vi: 'Hiển thị lời bài hát (Lệnh tắt của /lyrics)' })
      .addStringOption(opt =>
        opt
          .setName('query')
          .setDescription('Song title to search lyrics for')
          .setDescriptionLocalizations({ vi: 'Tên bài hát tra cứu lời' })
          .setRequired(false)
      )
  },
  {
    target: 'help',
    builder: () => new SlashCommandBuilder()
      .setName('h')
      .setDescription('Display bot command guide (Shortcut for /help)')
      .setDescriptionLocalizations({ vi: 'Xem danh sách & hướng dẫn lệnh (Lệnh tắt của /help)' })
  },
  {
    target: 'move',
    builder: () => new SlashCommandBuilder()
      .setName('mv')
      .setDescription('Move a song position (Shortcut for /move)')
      .setDescriptionLocalizations({ vi: 'Di chuyển vị trí bài hát (Lệnh tắt của /move)' })
      .addIntegerOption(opt =>
        opt
          .setName('from')
          .setDescription('Current position of the song')
          .setDescriptionLocalizations({ vi: 'Vị trí bài hát hiện tại' })
          .setMinValue(1)
          .setRequired(true)
      )
      .addIntegerOption(opt =>
        opt
          .setName('to')
          .setDescription('New position (default: 1)')
          .setDescriptionLocalizations({ vi: 'Vị trí mới (mặc định: 1)' })
          .setMinValue(1)
          .setRequired(false)
      )
  }
];

async function deploySlashCommands(customClient = null) {
  const token = config.token;
  const clientId = config.clientId || customClient?.user?.id;
  const guildId = process.env.GUILD_ID || config.guildId;

  if (!token) {
    console.error('[Deploy Slash] Lỗi: Chưa cấu hình DISCORD_TOKEN trong file .env');
    return false;
  }

  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      try {
        const command = require(path.join(commandsPath, file));
        if (command.data && typeof command.data.toJSON === 'function') {
          commands.push(command.data.toJSON());
        }
      } catch (err) {
        console.warn(`[Deploy Slash] Không thể đọc SlashCommand data từ ${file}:`, err.message);
      }
    }
  }

  // Bổ sung các lệnh tắt Slash tiện lợi (/p, /s, /q, /np, /vol, /fav, /ly, /h)
  for (const shortcut of SLASH_SHORTCUTS) {
    try {
      const shortcutBuilder = shortcut.builder();
      if (shortcutBuilder && typeof shortcutBuilder.toJSON === 'function') {
        commands.push(shortcutBuilder.toJSON());
      }
    } catch (err) {
      console.warn(`[Deploy Slash] Lỗi tạo Shortcut /${shortcut.target}:`, err.message);
    }
  }

  if (commands.length === 0) {
    console.warn('[Deploy Slash] Không tìm thấy Slash Command nào để đăng ký.');
    return false;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log(`🚀 [Deploy Slash] Đang đồng bộ ${commands.length} Slash Commands (kèm Shortcuts) lên Discord...`);

    // 1. Đăng ký cho toàn bộ Server mà bot đang tham gia (Cập nhật 0 giây ngay lập tức!)
    if (customClient && customClient.guilds && customClient.guilds.cache.size > 0) {
      for (const [gId, guild] of customClient.guilds.cache) {
        try {
          await rest.put(
            Routes.applicationGuildCommands(clientId, gId),
            { body: commands }
          );
          console.log(`✅ [Deploy Slash] Đã đăng ký thành công ${commands.length} Guild Slash Commands cho Server: ${guild.name} (${gId})`);
        } catch (gErr) {
          console.warn(`[Deploy Slash] Lỗi đăng ký Guild ${gId}:`, gErr.message);
        }
      }
    } else if (guildId && clientId) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ [Deploy Slash] Đã đăng ký thành công ${commands.length} Guild Slash Commands cho Server: ${guildId}`);
    }

    // 2. Dọn dẹp / Xóa Global Commands cũ để tránh hiển thị 2 lần mỗi lệnh trên Discord
    if (clientId) {
      try {
        await rest.put(
          Routes.applicationCommands(clientId),
          { body: [] }
        );
        console.log(`🧹 [Deploy Slash] Đã dọn dẹp Global Commands cũ để tránh trùng lặp.`);
      } catch (cleanErr) {
        console.warn('[Deploy Slash] Không thể dọn Global Commands cũ:', cleanErr.message);
      }
    }

    return true;
  } catch (error) {
    console.error('[Deploy Slash Error]:', error);
    return false;
  }
}

// Chạy trực tiếp qua CLI: node src/deploy-commands.js
if (require.main === module) {
  (async () => {
    await deploySlashCommands();
  })();
}

module.exports = { deploySlashCommands, SLASH_SHORTCUTS };
