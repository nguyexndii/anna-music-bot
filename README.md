# Anna Music Bot

Bot phát nhạc Discord hiệu năng cao, hỗ trợ phát nhạc 24/7 ổn định, tự động kết nối lại, giao diện Web Player thời gian thực và kiến trúc streaming đa tầng tối ưu.

---

## Tính năng Nổi bật

### 1. Kiến trúc Streaming Đa tầng & Vượt rào cản Bot Challenge
- **Xác thực YouTube qua Cookies**: Sử dụng cookies đã xác thực kết hợp cùng `yt-dlp` để stream trực tiếp các bài hát chất lượng cao từ YouTube mà không bị chặn IP hay yêu cầu xác minh tài khoản từ phía máy chủ.
- **Cơ chế Failover thông minh qua SoundCloud**: Khi bài hát YouTube bị giới hạn bản quyền hoặc lỗi DRM, hệ thống tự động tìm bản thu thay thế trên SoundCloud kết hợp thuật toán so khớp thời lượng chính xác, tránh các bản thu demo hoặc bị cắt đầu/đuôi.
- **Đường truyền âm thanh thuần s16le**: Pipeline xử lý stream trực tiếp loại bỏ các bước transcode FFmpeg trùng lặp, tối ưu hóa độ trễ và giảm tải CPU máy chủ xuống mức tối thiểu.

### 2. Chế độ Lofi 24/7 Hai chiều Thông minh
- **Duy trì Voice liên tục**: Giữ bot trong phòng thoại 24/7 ngay cả khi phòng trống hoặc khi danh sách phát kết thúc.
- **Kho nhạc Lofi không lời tuyển chọn**: Tích hợp danh sách các bản lofi/acoustic không lời Việt Nam được chọn lọc kỹ lưỡng, phù hợp để làm việc và thư giãn.
- **Bộ nhớ chống lặp bài (LofiHistoryManager)**: Ghi nhớ các bài hát đã phát gần nhất để đảm bảo không bị lặp lại nội dung.
- **Bảo toàn hàng đợi 2 chiều**: Khi bật Lofi, hàng đợi của người dùng vẫn được bảo lưu. Khi có người thêm bài hát mới hoặc bấm "Tiếp tục phát nhạc", bot sẽ lập tức chuyển về hàng đợi người dùng.

### 3. Đồng bộ Lời bài hát (Official Closed Captions)
- **Ưu tiên phụ đề chính thức (Official CC)**: Trích xuất trực tiếp phụ đề đồng bộ từng mili-giây từ kênh phát hành chính chủ trên YouTube, tránh các bản AI auto-caption bị sai lời.
- **Hệ thống Fallback đa nguồn**: Kết hợp cùng Lrclib và Canvas để đảm bảo tỷ lệ hiển thị lời bài hát cao nhất với giao diện Karaoke mượt mà.

### 4. Tối ưu Hiệu năng & Giảm tải Backend
- **RAM Cache cho FavoriteManager**: Lưu trữ danh sách bài hát yêu thích trực tiếp trong RAM, loại bỏ 100% truy vấn đọc MongoDB trong các vòng lặp polling tần suất cao.
- **Phân luồng dữ liệu State Polling**: Endpoint `/api/guilds/:guildId/state` tự động lược bỏ các mảng dữ liệu nặng khi không có tham số `?full=1`, giảm tới 95% băng thông truyền tải trên mỗi yêu cầu.

---

## Cấu trúc Mã nguồn

```text
anna-music-bot/
├── public/                 # Bản build giao diện Web Player (Vite React dist)
├── src/
│   ├── commands/           # Danh sách Slash Command (/play, /queue, /web, /settings...)
│   ├── routes/             # Express REST API phục vụ Web UI (/api/guilds/...)
│   ├── structures/         # Các module nòng cốt: MusicQueue, FavoriteManager, LofiHistoryManager
│   ├── utils/              # Trích xuất stream, xử lý lyrics, bảo mật token, giao diện Discord embed
│   └── index.js            # Điểm khởi chạy bot và lắng nghe sự kiện Discord
├── .env.example            # Bản mẫu cấu hình biến môi trường
├── package.json
└── README.md
```

---

## Yêu cầu Hệ thống

- **Node.js**: Phiên bản 18.x trở lên (khuyên dùng Node.js 20 LTS hoặc 22).
- **yt-dlp**: Cài đặt phiên bản mới nhất và có sẵn trong PATH hệ thống.
- **FFmpeg**: Đã cài đặt và có sẵn trong PATH hệ thống.
- **MongoDB**: Cơ sở dữ liệu lưu trữ cấu hình guild, bài hát yêu thích và thống kê.
- **Discord Bot Token**: Đã kích hoạt đầy đủ các Intent cần thiết (`Message Content Intent`, `Server Members Intent`).

---

## Hướng dẫn Cài đặt & Vận hành

### 1. Cài đặt thư viện phụ thuộc
```bash
npm install
```

### 2. Thiết lập file cấu hình môi trường (.env)
Tạo file `.env` từ `.env.example` và thiết lập các giá trị:
```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id
MONGODB_URI=your_mongodb_connection_string
PORT=3005
WEB_TOKEN_SECRET=your_hmac_sha256_secret_key
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk

# Tùy chọn: Last.fm API Key cho Autoplay đa tầng
LASTFM_API_KEY=
```

### 3. Cấu hình YouTube Cookies (Bỏ qua Bot Challenge)
Xuất file `cookies.txt` từ trình duyệt của bạn (dùng tiện ích Get cookies.txt LOCALLY) và đặt tại thư mục gốc của bot:
```text
anna-music-bot/
└── cookies.txt
```

### 4. Khởi chạy
```bash
# Môi trường phát triển
npm run dev

# Môi trường Production (quản lý qua PM2)
pm2 start src/index.js --name "anna-music-bot"
```

---

## Danh mục Slash Command Discord (/)

| Lệnh | Mô tả |
| :--- | :--- |
| `/play <tên / link / playlist>` | Phát nhạc hoặc thêm vào hàng đợi (hỗ trợ cả YouTube, Spotify, SoundCloud) |
| `/web` | Nhận liên kết Magic Token đăng nhập trực tiếp vào Web Player |
| `/pause` | Tạm dừng phát nhạc |
| `/resume` | Tiếp tục phát nhạc |
| `/skip` | Bỏ qua bài hát hiện tại |
| `/stop` | Dừng phát nhạc và dọn dẹp hàng đợi |
| `/queue` | Xem danh sách hàng đợi và quản lý danh sách bài |
| `/nowplaying` | Xem bài đang phát cùng cụm nút điều khiển trực quan |
| `/volume <1-150>` | Điều chỉnh âm lượng phát nhạc |
| `/loop` | Chuyển chế độ lặp: Tắt / Lặp bài / Lặp toàn bộ hàng đợi |
| `/autoplay` | Bật / Tắt chế độ tự động phát bài liên quan khi hết nhạc |
| `/247` | Bật / Tắt chế độ duy trì Voice 24/7 |
| `/settings` | Mở bảng thiết lập bot (chỉ dành cho Quản trị viên) |
| `/help` | Hiển thị bảng hướng dẫn sử dụng |

---

## Giao diện Lập trình REST API

Express server hoạt động trên cổng được chỉ định (mặc định: 3005) phục vụ giao tiếp với Web Player:

- `GET /api/guilds/:guildId/state`: Truy xuất trạng thái phát nhạc, voice channel và bài hát (`?full=1` để lấy toàn bộ lịch sử).
- `POST /api/guilds/:guildId/action`: Thực thi các lệnh điều khiển (`play`, `pause`, `skip`, `seek`, `volume`, `loop`, `shuffle`, `toggle247`, `toggleLofiMode`...).
- `GET /api/search?q=query`: Tìm kiếm bài hát tích hợp debounce.
- `GET /api/guilds/:guildId/lyrics`: Lấy lời bài hát đồng bộ thời gian thực.
- `GET /health`: Kiểm tra tình trạng hoạt động của dịch vụ.
