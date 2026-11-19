<div align="center">
  <h1>ANNA MUSIC BOT &amp; WEB PLAYER</h1>
  <p><b>Hệ Sinh Thái Phát Nhạc Discord Hiệu Năng Cao, Kiến Trúc Module Hóa, Bảng Điều Khiển Web Vantage Monochrome và Bộ Máy Đồng Bộ Lời Bài Hát 4 Tầng</b></p>
  <p>
    <b>Tác giả: Diiexe</b> | 
    <a href="./README.md"><b>English Documentation</b></a> | 
    <b>Bản Tiếng Việt</b>
  </p>
</div>

---

## Mục Lục
1. [Tổng Quan Dự Án](#tổng-quan-dự-án)
2. [Kiến Trúc Kỹ Thuật &amp; Sơ Đồ Cấu Trúc](#kiến-trúc-kỹ-thuật--sơ-đồ-cấu-trúc)
3. [Các Năng Lực Nổi Bật](#các-năng-lực-nổi-bật)
4. [Hệ Thống Lời Bài Hát Đồng Bộ 4 Tầng](#hệ-thống-lời-bài-hát-đồng-bộ-4-tầng)
5. [Danh Sách Lệnh Discord (Slash Commands)](#danh-sách-lệnh-discord-slash-commands)
6. [Giao Tiếp Web Player &amp; REST API Endpoints](#giao-tiếp-web-player--rest-api-endpoints)
7. [Hướng Dẫn Cài Đặt &amp; Triển Khai](#hướng-dẫn-cài-đặt--triển-khai)
8. [Cấu Hình Môi Trường (.env)](#cấu-hình-môi-trường-env)
9. [Quản Lý Tiến Trình Bằng PM2](#quản-lý-tiến-trình-bằng-pm2)
10. [Xử Lý Sự Cố &amp; Bảo Trì](#xử-lý-sự-cố--bảo-trì)
11. [Ghi Nhận Đóng Góp &amp; Thư Viện Bên Thứ Ba](#ghi-nhận-đóng-góp--thư-viện-bên-thứ-ba)
12. [Giấy Phép](#giấy-phép)

---

## Tổng Quan Dự Án

Anna Music Bot là nền tảng phát nhạc trực tuyến chuyên dụng cho các cộng đồng máy chủ Discord, được xây dựng trên nền tảng Node.js 20 và Discord.js v14. Hệ thống cung cấp khả năng phát âm thanh độ trễ thấp, đồng bộ lời bài hát từng mili-giây, cơ chế lưu đệm âm thanh cục bộ trên ổ cứng SSD và bảng điều khiển trực quan qua giao diện web thời gian thực (Vantage Monochrome UI).

Hệ thống được thiết kế và tinh chỉnh chuyên sâu cho môi trường máy chủ ảo VPS cấu hình 1 CPU Core, sử dụng kỹ thuật điều phối luồng âm thanh thông minh, cơ chế ngắt mạch an toàn (Circuit Breaker), cơ chế bảo vệ kết nối thoại (Voice Readiness Guard) và tính năng tải trước không độ trễ (0ms Preload) để loại bỏ hoàn toàn hiện tượng nghẽn luồng hay giật cục âm thanh.

---

## Kiến Trúc Kỹ Thuật & Sơ Đồ Cấu Trúc

### Sơ Đồ Luồng Hoạt Động Cấp Cao

```text
[ Người Dùng Discord ]
       |
       v
[ Discord Gateway / Slash Commands ] <---> [ Discord Voice Gateway (libsodium) ]
       |                                                    ^
       v                                                    |
[ Bộ Điều Phối Lệnh & Sự Kiện ]                             |
       |                                                    |
       v                                                    |
[ MusicQueue Engine ] ---> [ VoiceConnectionManager & Guard ]
       |                           |
       |                           +---> [ Bộ Nhớ Đệm SSD Cục Bộ (2GB LRU) ]
       |                           +---> [ Đường Ống yt-dlp / FFmpeg (-ss / -t) ]
       |                           +---> [ API Cắt Đoạn MV SponsorBlock ]
       |
       +---> [ Các Nhà Cung Cấp Âm Thanh Module Hóa ]
       |           +---> Trích xuất YouTube
       |           +---> Trích xuất Spotify (Phạt lũy tiến)
       |           +---> Trích xuất Apple Music
       |           +---> Bộ điều phối Semaphore giới hạn tải CPU
       |
       +---> [ Bộ Máy Lời Bài Hát 4 Tầng ]
       |           +---> Tầng 1: Phụ Đề Gốc YouTube CC (Đa ngôn ngữ chuẩn)
       |           +---> Tầng 2: Zing MP3 API (Phản hồi siêu tốc cho nhạc Việt)
       |           +---> Tầng 3: Cơ Sở Dữ Liệu Mở LRCLIB (Quốc tế / Spotify)
       |           +---> Tầng 4: Python Microservice (syncedlyrics / Musixmatch / NetEase)
       |
       +---> [ Express Web Server Module Hóa (Cổng 3000) ] <---> [ Cloudflare Tunnel ] <---> [ Web Player UI ]
       |           +---> Định tuyến Player, Guild, Playlist, Lyrics & Middleware Xác Thực
       |
       +---> [ MongoDB Atlas ] (Cài Đặt Máy Chủ, Playlist, Bài Hát Yêu Thích, Bộ Đệm Lời)
```

### Cấu Trúc Thư Mục Dự Án

```text
anna-music-bot/
├── data/                   # Bộ nhớ đệm SSD, file phiên và cookie lưu trữ
├── lyrics-service/         # Microservice Python FastAPI cào lời bài hát đồng bộ
├── src/
│   ├── commands/           # Các lệnh Slash Command (/play, /queue, /web, /join, /volume, v.v.)
│   ├── database/           # Mongoose schemas & Trình quản lý kết nối MongoDB
│   │   └── models/         # FavoriteSong, GuildSettings, LyricCache, UserPlaylist
│   ├── events/             # Các trình xử lý sự kiện Discord module hóa
│   │   ├── ready.js                # Khởi động bot, khóa kênh thoại & thiết lập presence
│   │   ├── interactionCreate.js    # Điều phối Slash Command & tương tác nút bấm
│   │   ├── voiceStateUpdate.js     # Theo dõi chuyển kênh thoại & tự động ngắt kết nối
│   │   ├── guildEvents.js          # Tham gia/rời máy chủ & dọn dẹp cache
│   │   └── messageEvents.js        # Xử lý tin nhắn dự phòng
│   ├── providers/          # Bộ trích xuất âm thanh và nguồn lời bài hát chuyên biệt
│   │   ├── audio/          # YoutubeExtractor, SpotifyExtractor, AppleMusicExtractor, SemaphoreManager
│   │   └── lyrics/         # LrclibProvider, ZingMp3Provider, YoutubeCcProvider, lyricsTextUtils
│   ├── routes/             # Bộ định tuyến REST API Express module hóa
│   │   ├── middlewares/    # authMiddleware (Xác thực token HMAC & bảo vệ brute-force mã PIN)
│   │   ├── guildRoutes.js          # Cài đặt máy chủ & đồng bộ trạng thái
│   │   ├── lyricsRoutes.js         # API tra cứu lời bài hát đa tầng
│   │   ├── playerRoutes.js         # Các lệnh điều khiển phát nhạc (play, pause, skip, seek, v.v.)
│   │   ├── playlistRoutes.js       # CRUD danh sách phát & API ảnh bìa Bento
│   │   └── routeState.js           # Trạng thái dùng chung giữa các router
│   ├── structures/         # Các cỗ máy điều phối hàng đợi và phát nhạc
│   │   ├── queue/          # QueuePlaybackEngine, DiscordCardRenderer, VoiceConnectionManager
│   │   ├── MusicQueue.js           # Bộ điều phối chính kết nối các engine thành phần
│   │   ├── SettingsManager.js      # Bộ đệm và lưu trữ cài đặt máy chủ
│   │   └── UserPlaylistManager.js  # Quản lý danh sách phát và bài hát yêu thích người dùng
│   ├── utils/              # Bộ tạo Embed, hệ thống Emoji tùy chỉnh, công cụ tìm kiếm
│   ├── config.js           # Cấu hình biến môi trường và hằng số hệ thống
│   ├── deploy-commands.js  # Script đăng ký lệnh Slash Command lên Discord API
│   └── index.js            # Điểm khởi chạy ứng dụng Bot và máy chủ HTTP REST
├── package.json
└── README.md
```

---

## Các Năng Lực Nổi Bật

### 1. Đường Ống Âm Thanh Hiệu Suất Cao & Voice Readiness Guard
- **Cơ chế bảo vệ kết nối thoại (Voice Readiness Guard)**: Bắt buộc kết nối đạt trạng thái `VoiceConnectionStatus.Ready` trước khi liên kết trình phát (`subscribe`) và bơm luồng âm thanh, triệt tiêu hoàn toàn lỗi bot bị mất tiếng khi người dùng chuyển bài liên tục hoặc socket UDP đang bắt tay lại.
- **Tải trước không độ trễ (0ms Preload)**: Tự động nạp trước luồng âm thanh và lời bài hát của bài kế tiếp vào bộ nhớ RAM trước khi bài hiện tại kết thúc 18 giây.
- **Lưu đệm cục bộ trên ổ cứng SSD (Local Audio Cache)**: Tự động lưu các bài hát nghe nhiều vào ổ cứng máy chủ theo thuật toán LRU với dung lượng tối đa 2GB, bỏ qua thời gian tải từ YouTube.
- **Giới hạn tải cho VPS 1-core**: Sử dụng Semaphore kiểm soát số lượng luồng tải đồng thời, ngăn chặn việc CPU bị chiếm dụng 100%.
- **Ngắt mạch tự động (Circuit Breaker)**: Tự động phát hiện luồng phát âm thanh bị nghẽn và chuyển đổi nguồn dự phòng trong vòng 3 giây.

### 2. Tự Động Cắt Đoạn Kịch Bản MV & Đồng Bộ Timeline
- Tích hợp cơ sở dữ liệu SponsorBlock `music_offtopic` để tự động cắt bỏ từ 30 giây đến hơn 2 phút cảnh dạo đầu, tiểu phẩm kịch bản và danh đề kết thúc của các Video ca nhạc.
- Cắt trực tiếp bằng FFmpeg: Truyền trực tiếp tham số `-ss` và `-t` vào tiến trình giải mã luồng, bài hát cất tiếng ngay lập tức tại nốt nhạc đầu tiên.
- Tự động căn chỉnh timeline phụ đề: Trừ lùi mốc thời gian phụ đề YouTube CC tương ứng với đoạn mở đầu đã cắt, đảm bảo lời hát khớp 100% với tiếng nhạc.

### 3. Kiến Trúc Module Hóa (Độc Lập Trách Nhiệm)
- Phân tách hoàn toàn mã nguồn thành các module độc lập: Router API, Sự kiện Discord Gateway, Bộ trích xuất âm thanh, Engine lời nhạc, và Cỗ máy điều phối phát nhạc.
- Đảm bảo tính chịu lỗi cao: Bất kỳ sự cố nào ở một nhà cung cấp phụ trợ đều được cô lập và không làm ảnh hưởng đến tiến trình phát nhạc chính.

### 4. Hệ Thống Emoji Frosted Glass Tùy Chỉnh & Discord Components v2
- Tích hợp đồng bộ hệ thống Application Emoji custom chuẩn Frosted Glass (`<:tag:id>`) với cơ chế tự động fallback trên toàn bộ thẻ thông tin Embed, nút bấm điều khiển và tin nhắn thông báo.
- Tone màu nền tối đồng nhất sang trọng (`0x2B2D31`) cùng bố cục các hàng nút hành động tinh gọn.

### 5. Ưu Tiên Kênh Voice Khóa Cố Định & Tự Động Kết Nối Lại
- Tự động duy trì và ưu tiên kênh thoại cố định đã khóa của máy chủ (`lockedVoiceChannelId`), ngăn ngừa hiện tượng bot bị trôi phiên khi khởi động lại.
- Đồng bộ phiên thông minh: Tự động nhận diện và đồng hành cùng phòng thoại của người dùng khi có tương tác hợp lệ.

### 6. Bảng Điều Khiển Web Vantage Monochrome & Ảnh Bìa Bento
- Bảng điều khiển kép thời gian thực (Dual-Panel): Giao diện tối giản hiện đại bằng React 18 và Tailwind CSS, hiển thị mượt mà trên cả máy tính và điện thoại.
- Xác thực an toàn bằng mã PIN & Magic Token: Sử dụng mã PIN 6 số dùng một lần (hết hạn sau 2 phút) và mã phiên HMAC-SHA256 (hiệu lực 24 giờ).
- Ảnh bìa Playlist kiểu Bento Grid: Tự động ghép 4 ảnh bìa dạng Bento Grid hoặc hỗ trợ người dùng tự tải URL ảnh bìa tùy chỉnh.
- Cơ chế chống vét cạn mã PIN (Anti-Brute-Force): Tự động khóa địa chỉ IP trong 5 phút nếu nhập sai quá 5 lần liên tiếp.

### 7. Đài Phát Thanh Lofi 24/7
- Tự động chuyển tiếp mượt mà sang các bản nhạc lofi thư giãn không lời khi hàng đợi bài hát kết thúc.
- Cơ chế nhường chỗ tức thì: Khi người dùng thêm bài hát mới vào hàng đợi, bot lập tức chuyển sang bài của người dùng mà không làm ngắt kết nối kênh voice.

### 8. Cô Lập Đa Máy Chủ & Phân Quyền Chặt Chẽ
- Cô lập hoàn toàn hàng chờ giữa các máy chủ Discord khác nhau, ngăn chặn can thiệp chéo tài nguyên.
- Phân cấp quyền hạn nghiêm ngặt: Chủ Máy Chủ > Quản Trị Viên > Vai Trò DJ > Thành Viên Thường.

---

## Hệ Thống Lời Bài Hát Đồng Bộ 4 Tầng

Bot sử dụng thuật toán tìm kiếm đa tầng kết hợp so khớp thông minh:

1. **Tầng 1: Phụ Đề Chính Thức YouTube CC**
   - Ưu tiên kiểm tra và bóc tách phụ đề gốc do nghệ sĩ hoặc kênh phát hành cung cấp (giữ nguyên chữ tiếng Hàn Hangul, tiếng Nhật Kanji/Kana, v.v.).
   - Trả lời tức thì với độ trễ 0ms.

2. **Tầng 2: Hệ Thống Lời Zing MP3**
   - Tìm kiếm với độ trễ cực thấp (100ms - 250ms) cho các bài hát V-Pop và nhạc trẻ Việt Nam.
   - Hỗ trợ định dạng lời chạy từng từ (Word-by-word Karaoke).

3. **Tầng 3: Cơ Sở Dữ Liệu Mở LRCLIB**
   - Thư viện dữ liệu cộng đồng cho các bài hát quốc tế, Spotify và Apple Music.

4. **Tầng 4: Microservice Python Dự Phòng (syncedlyrics)**
   - Chạy độc lập trên cổng nội bộ `127.0.0.1:8787` thông qua framework FastAPI.
   - Tìm kiếm nâng cao trên Musixmatch và NetEase cho các bài hát quốc tế hiếm hoặc nhạc Anime.
   - Thư viện mã nguồn mở: [syncedlyrics](https://github.com/moehmeni/syncedlyrics).

- **Thuật toán phát hiện khoảng trống lời hát (Gap Detection)**: Khi lời bài hát bị thiếu một đoạn dài từ 22 giây trở lên (ví dụ bài hát có đoạn rap của khách mời nhưng bị bỏ sót), hệ thống tự động loại bỏ và chọn ứng viên hoàn chỉnh hơn.

---

## Danh Sách Lệnh Discord (Slash Commands)

| Lệnh | Phân Loại | Quyền Hạn | Mô Tả Chức Năng |
|---|---|---|---|
| `/play <từ khóa>` | Phát Nhạc | Mọi Người | Phát nhạc từ URL, tên bài hát hoặc link playlist |
| `/pause` | Phát Nhạc | Mọi Người / DJ | Tạm dừng phát âm thanh |
| `/resume` | Phát Nhạc | Mọi Người / DJ | Tiếp tục phát âm thanh đang tạm dừng |
| `/skip [vị trí]` | Phát Nhạc | Mọi Người / DJ | Bỏ qua bài hát hiện tại hoặc mở biểu quyết bỏ qua |
| `/previous` | Phát Nhạc | Mọi Người / DJ | Phát lại bài hát vừa phát trước đó trong phiên |
| `/stop` | Phát Nhạc | DJ / Admin | Dừng phát nhạc, xóa hàng chờ và rời khỏi phòng thoại |
| `/queue [trang]` | Phát Nhạc | Mọi Người | Xem danh sách hàng chờ phát nhạc kèm nút lật trang |
| `/nowplaying` | Phát Nhạc | Mọi Người | Xem thẻ bài hát đang phát với thanh tiến trình trực quan |
| `/lyrics [bài]` | Lời Nhạc | Mọi Người | Tra cứu lời bài hát đồng bộ hoặc toàn bộ văn bản |
| `/volume <mức>` | Phát Nhạc | DJ / Admin | Điều chỉnh âm lượng trong khoảng từ 1% đến 150% |
| `/loop <chế độ>` | Phát Nhạc | Mọi Người / DJ | Bật chế độ lặp lại: tắt, lặp một bài hoặc lặp hàng chờ |
| `/shuffle` | Phát Nhạc | Mọi Người / DJ | Trộn ngẫu nhiên thứ tự các bài hát trong hàng chờ |
| `/seek <thời gian>`| Phát Nhạc | DJ / Admin | Tua nhanh tới mốc thời gian chỉ định (ví dụ `1:25` hoặc `85s`) |
| `/replay` | Phát Nhạc | Mọi Người / DJ | Phát lại bài hát hiện tại từ đầu (0:00) |
| `/jump <thứ tự>` | Phát Nhạc | DJ / Admin | Nhảy thẳng đến bài hát ở vị trí chỉ định trong hàng chờ |
| `/remove <thứ tự>`| Phát Nhạc | DJ / Admin | Xóa bài hát chỉ định ra khỏi hàng chờ |
| `/clear` | Phát Nhạc | DJ / Admin | Xóa toàn bộ bài hát đang chờ phát |
| `/forward <giây>` | Phát Nhạc | DJ / Admin | Tua nhanh một số giây nhất định |
| `/rewind <giây>` | Phát Nhạc | DJ / Admin | Tua lùi một số giây nhất định |
| `/history` | Phát Nhạc | Mọi Người | Xem lịch sử các bài hát vừa phát trong máy chủ |
| `/toptracks` | Phát Nhạc | Mọi Người | Xem danh sách 10 bài hát được nghe nhiều nhất |
| `/web` | Điều Khiển | Mọi Người | Lấy mã PIN 6 số và link đăng nhập Web Player an toàn |
| `/247 [bật/tắt]` | Tự Động | Admin | Bật/tắt chế độ duy trì kênh thoại 24/7 và đài Lofi |
| `/autoplay [chế độ]`| Tự Động | DJ / Admin | Tự động tìm và phát bài tương tự khi hết hàng chờ |
| `/favorite add/list`| Thư Viện | Mọi Người | Quản lý danh sách bài hát yêu thích cá nhân trên MongoDB |
| `/playlist create` | Thư Viện | Mọi Người | Tạo và chỉnh sửa danh sách phát cá nhân |
| `/settings view` | Cài Đặt | Admin | Xem cấu hình máy chủ, vai trò DJ và kênh chỉ định |
| `/settings set` | Cài Đặt | Admin | Cài đặt âm lượng mặc định, vai trò DJ, khóa kênh, ngôn ngữ |
| `/ping` | Hệ Thống | Mọi Người | Kiểm tra độ trễ kết nối WebSocket, REST và thời gian hoạt động |
| `/stats` | Hệ Thống | Mọi Người | Xem mức tiêu thụ RAM, tải CPU và số phòng thoại đang hoạt động |
| `/help [lệnh]` | Hệ Thống | Mọi Người | Xem sổ tay hướng dẫn chi tiết về các tính năng của bot |

---

## Giao Tiếp Web Player & REST API Endpoints

Hệ thống cung cấp các cổng API cho giao diện Web Player:

- `POST /api/auth/verify`: Xác thực mã PIN 6 số hoặc token; cấp token phiên HMAC 24 giờ.
- `GET /api/guilds/:guildId/state`: Trả về trạng thái máy chủ, bài đang phát, hàng chờ và quyền hạn.
  - Tham số `?full=1`: Nạp toàn bộ thư viện người dùng và thống kê máy chủ.
  - Tham số `?fresh=1`: Bỏ qua bộ nhớ RAM cache và đọc trực tiếp từ MongoDB.
- `POST /api/guilds/:guildId/play`: Đặt bài hát hoặc playlist mới từ thanh tìm kiếm trên Web.
- `POST /api/guilds/:guildId/action`: Thực thi các lệnh điều khiển (`pause`, `resume`, `skip`, `previous`, `seek`, `volume`, `loop`, `shuffle`, `toggleFavorite`, `toggleLofiMode`).
- `GET /api/guilds/:guildId/playlists`: Lấy danh sách phát của người dùng theo máy chủ.
- `POST /api/guilds/:guildId/playlists`: Tạo danh sách phát cá nhân mới.
- `PUT /api/guilds/:guildId/playlists/:id/cover`: Cập nhật ảnh bìa tùy chỉnh hoặc chọn từ danh sách bài hát.
- `GET /api/search?q=<query>`: API tìm kiếm bài hát trực tiếp (có rate-limit chống quá tải).
- `GET /api/lyrics?title=<t>&artist=<a>`: API tra cứu lời bài hát đa tầng.
- `GET /api/health`: Kiểm tra sức khỏe hệ thống phục vụ giám sát và telemetry.

---

## Hướng Dẫn Cài Đặt & Triển Khai

### Yêu Cầu Môi Trường
- Node.js phiên bản 20.12.0 trở lên
- Python phiên bản 3.10 trở lên
- FFmpeg đã cài đặt và có trong biến môi trường PATH hệ thống
- Cụm cơ sở dữ liệu MongoDB Atlas hoặc máy chủ MongoDB cục bộ
- Discord Bot Token đã bật các quyền hạn Message Content Intent và Server Members Intent

### 1. Tải Mã Nguồn
```bash
git clone https://github.com/nguyexndii/anna-music-bot.git
cd anna-music-bot
npm install
```

### 2. Thiết Lập Microservice Python
```bash
cd lyrics-service
python3 -m venv venv
source venv/bin/activate  # Trên Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 3. Đăng Ký Lệnh Slash Command Lên Discord
```bash
node src/deploy-commands.js
```

---

## Cấu Hình Môi Trường (.env)

Tạo file `.env` tại thư mục gốc với các thông số:

```env
# Thông tin xác thực Discord Bot
DISCORD_TOKEN=điền_token_bot_tại_đây
CLIENT_ID=điền_client_id_của_bot
ADMIN_ID=điền_id_discord_của_bạn

# Cơ sở dữ liệu
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname

# Máy chủ Web & Bảo mật
PORT=3000
WEB_JWT_SECRET=chuỗi_bí_mật_ngẫu_nhiên_64_ký_tự
ALLOWED_ORIGINS=http://localhost:5173,https://anna-music-bot-ui.pages.dev

# Tích hợp dịch vụ ngoài
LYRICS_SERVICE_URL=http://127.0.0.1:8787
SPONSORBLOCK_API=https://sponsor.ajay.app

# Môi trường và hiệu năng
NODE_ENV=production
CACHE_DIR=./data/audio-cache
MAX_CACHE_SIZE_MB=2048
```

---

## Quản Lý Tiến Trình Bằng PM2

Triển khai và vận hành an toàn trên máy chủ với PM2:

```bash
# 1. Khởi động Discord Bot và Web API
pm2 start src/index.js --name "anna-music-bot" --node-args="--max-old-space-size=512"

# 2. Khởi động Microservice Python
pm2 start "lyrics-service/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8787" --name "anna-lyrics"

# 3. Khởi động Cloudflare Tunnel (nếu truy cập Web từ xa)
pm2 start "cloudflared tunnel run anna-tunnel" --name "anna-tunnel"

# 4. Lưu trạng thái khởi động cùng hệ điều hành
pm2 save
pm2 startup
```

---

## Xử Lý Sự Cố & Bảo Trì

### 1. Sự Cố Âm Thanh
- Kiểm tra cài đặt FFmpeg: gõ lệnh `ffmpeg -version`.
- Kiểm tra quyền thực thi của yt-dlp: Đảm bảo file `node_modules/yt-dlp-exec/bin/yt-dlp` có quyền thực thi (`chmod +x`) trên Linux.
- Chặn IP từ YouTube: Nếu stream bị quá thời gian chờ, đặt file cookie hợp lệ tại `./data/cookies.txt`.

### 2. Kiểm Tra Dịch Vụ Lời Nhạc
- Kiểm tra trạng thái: `curl http://127.0.0.1:8787/health`.
- Thử nghiệm truy vấn: `curl "http://127.0.0.1:8787/lyrics?title=Faded&artist=Alan%20Walker"`.

### 3. Kiểm Tra Đồng Bộ Dữ Liệu
- Kiểm tra chuỗi kết nối MongoDB Atlas trong `.env`.
- Đảm bảo các collection `guildsettings`, `favoritesongs`, `userplaylists`, và `lyriccaches` đã được đánh index đầy đủ.

---

## Ghi Nhận Đóng Góp & Thư Viện Bên Thứ Ba

- [Discord.js](https://discord.js.org/): Thư viện tương tác nền tảng Discord API.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): Bộ máy phân tích và trích xuất luồng âm thanh/video.
- [FFmpeg](https://ffmpeg.org/): Bộ giải mã, chuyển đổi định dạng và truyền luồng âm thanh.
- [syncedlyrics](https://github.com/moehmeni/syncedlyrics): Thư viện Python cào lời bài hát đồng bộ đa nguồn.
- [SponsorBlock](https://sponsor.ajay.app/): Cơ sở dữ liệu mở bỏ qua các đoạn ngoài âm nhạc trong video.
- [LRCLIB](https://lrclib.net/): Cơ sở dữ liệu lời bài hát đồng bộ cộng đồng mở.

---

## Giấy Phép

Dự án được phát hành theo giấy phép MIT. Xem file [LICENSE](./LICENSE) để biết thêm chi tiết.
