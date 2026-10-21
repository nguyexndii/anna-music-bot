<div align="center">
  <img src="public/anna-music-logo-chromatic.png" alt="Anna Music Logo" width="360" />

  # ANNA MUSIC BOT & WEB PLAYER (24/7)

  **Hệ sinh thái phát nhạc Discord thế hệ mới: Giao diện Discord Components V2 • Web Player Mâm Đĩa Than Cổ Điển • Lời Bài Hát Karaoke 4 Tầng**

  [![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
  [![Discord.js](https://img.shields.io/badge/Discord.js-v14%20(Components%20V2)-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
  [![FastAPI](https://img.shields.io/badge/Python-FastAPI%20Lyrics-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![React](https://img.shields.io/badge/Web%20UI-React%2018%20%2B%20Tailwind-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
  [![MongoDB](https://img.shields.io/badge/Database-MongoDB%20%2B%20JSON-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

  <p align="center">
    <b>Tác giả: Diiexe</b> • 
    <a href="./README.md"><b>🇺🇸 English Documentation</b></a> • 
    <b>🇻🇳 Bản Tiếng Việt</b>
  </p>
</div>

---

## Mục Lục
1. [Điểm Nổi Bật & Các Tính Năng Độc Quyền](#điểm-nổi-bật--các-tính-năng-độc-quyền)
2. [Kiến Trúc Hệ Thống (System Architecture)](#kiến-trúc-hệ-thống-system-architecture)
3. [Danh Sách Lệnh Discord (Slash & Prefix Commands)](#danh-sách-lệnh-discord-slash--prefix-commands)
4. [Hướng Dẫn Cài Đặt & Triển Khai (Deployment)](#hướng-dẫn-cài-đặt--triển-khai-deployment)
5. [Cấu Trúc Thư Mục (Project Structure)](#cấu-trúc-thư-mục-project-structure)
6. [Chính Sách Bảo Mật & An Toàn](#chính-sách-bảo-mật--an-toàn)
7. [Tuyên Bố Bản Quyền, Miễn Trừ & DMCA](#tuyên-bố-bản-quyền-miễn-trừ--dmca)
8. [Tri Ân & Ghi Nhận Bên Thứ Ba (Credits)](#tri-ân--ghi-nhận-bên-thứ-ba-credits)
9. [Điều Khoản Giấy Phép (License)](#điều-khoản-giấy-phép-license)

---

## Điểm Nổi Bật & Các Tính Năng Độc Quyền

### 1. Trải Nghiệm Điều Khiển Kép: Discord Components V2 & Web Player Mâm Đĩa Than
* **Discord Components V2 (`type: 17`):** Bảng điều khiển `/nowplaying`, `/queue`, `/like` và `/web` được xây dựng bằng chuẩn Container giao diện mới nhất của Discord. Hiển thị trực quan thanh tiến trình bài hát, lời bài hát chạy trực tiếp trên tin nhắn và cụm nút bấm tương tác nhanh không gây lag.
* **Mâm Đĩa Than Cổ Điển (`HeroPlayer`):** Web Player tái hiện mâm đĩa than vintage với cần kim cơ học (Tonearm) chuyển động chính xác theo tỷ lệ phần trăm thời gian thực (`16.5°` – `33.5°`). Tích hợp đĩa than thu nhỏ kéo thả mượt mà 60fps (Floating Mini Vinyl) tự động hút cạnh màn hình.
* **Đăng nhập 1 chạm an toàn (`/web`):** Cấp mã PIN 6 chữ số (tự hủy sau 3 phút) và liên kết Magic Token (ký HMAC-SHA256) riêng biệt cho từng phiên Voice. Tích hợp cơ chế bảo vệ chống dò mã PIN (tự động khóa IP sau 5 lần nhập sai).

### 2. Hệ Thống Lời Bài Hát Đa Nguồn 4 Tầng (4-Tier Karaoke Engine) & Tự Động Vá Lời
Tự động truy xuất lời bài hát đồng bộ thời gian thực chuẩn `.lrc` theo thứ tự ưu tiên (quản trị viên có thể tự do đảo vị trí ưu tiên `#1` – `#4` ngay trên Web Dashboard):
1. **Tầng 1 — YouTube CC:** Trích xuất phụ đề chính thức từ video gốc của nghệ sĩ với độ trễ 0ms.
2. **Tầng 2 — Zing MP3 Lyrics Engine:** Kho lời Karaoke V-Pop chính xác từng câu/từ (phản hồi siêu tốc `100ms - 250ms`).
3. **Tầng 3 — LRCLIB Open Database:** Cơ sở dữ liệu lời đồng bộ Spotify & Apple Music (phản hồi `50ms - 150ms`).
4. **Tầng 4 — Python Fallback Microservice (`syncedlyrics`):** Dịch vụ phụ trợ FastAPI chạy nội bộ (`127.0.0.1:8787`), cào lời từ **Musixmatch** và **NetEase** cho các bản nhạc quốc tế hiếm, Anime, J-Pop, C-Pop.
* **Thuật toán Smart Gap Detection:** Tự động phát hiện khi một nguồn bị mất đoạn (khoảng cách giữa 2 câu $\ge 22\text{s}$) — ví dụ Zing MP3 chỉ làm lời ca sĩ chính và bỏ quên 34s của khách mời trong bài song ca. Hệ thống sẽ hoãn chốt và tự động thăng hạng nguồn LRCLIB đầy đủ hơn làm người chiến thắng!
* **Karaoke Toàn Màn Hình & Tinh Chỉnh Bù Trễ:** Hỗ trợ hát Karaoke 60fps trên Web, nhấp vào câu hát bất kỳ để tua nhanh, tự động nhận diện bản Remix và cho phép cộng/trừ độ trễ (`-5s` đến `+5s`) lưu trực tiếp vào cơ sở dữ liệu.

### 3. SponsorBlock Auto-Trim & Đồng Bộ Hệ Quy Chiếu Lời Bài Hát
* **Tự động cắt kịch bản Music Video:** Truy vấn phân đoạn `music_offtopic` từ SponsorBlock để tự động cắt bỏ 30 giây đến hơn 2 phút đoạn đóng kịch, giới thiệu, trò chuyện đầu/cuối trong MV YouTube.
* **Cắt bằng cờ phần cứng FFmpeg:** Truyền trực tiếp cờ `-ss <trimStart>` và `-to <trimEnd>` vào pipeline âm thanh, giúp người nghe vào thẳng nốt nhạc đầu tiên mà không bị giật lag tua bài.
* **Đồng bộ hệ quy chiếu lời bài hát:** Tự động dịch chuyển lùi mốc thời gian của phụ đề YouTube CC tương ứng với đoạn đã cắt, đảm bảo lời bài hát luôn khớp từng từ với âm thanh thực tế phát ra loa Discord.

### 4. Chuyển Bài 0ms & Hiệu Năng Vượt Trội (Chuẩn VPS 2GB RAM)
* **Instant Preload:** Tự động nạp trước luồng âm thanh (`preloadedResource`) và lời bài hát vào bộ đệm RAM ở **18 giây cuối** trước khi bài đang phát kết thúc, giúp chuyển bài mới tức thì không có độ trễ (`0ms delay`).
* **Bảo vệ bộ nhớ thông minh (`systemMonitor`):** Tự động kiểm tra dung lượng RAM VPS (chỉ thực hiện preload khi RAM khả dụng < 85%) và giới hạn trần RAM `MemoryMax=200M` cho microservice Python qua systemd.
* **Hòa âm chuyển bài (Crossfade):** Hỗ trợ tùy chỉnh giảm dần âm lượng cuối bài (Fade-out) và tăng dần âm lượng đầu bài mới (Fade-in) mượt mà từ `0s` đến `10s`.

### 5. Đài Radio Lofi 24/7 & Autoplay 3 Tầng Thông Minh
* **Đài Lofi 24/7 Theo Khung Giờ (`lofiDiscovery`):** Khi phòng thoại trống hoặc hết bài hát, bot tự động duy trì kết nối và phát nhạc Lofi thư giãn theo khung giờ trong ngày (sáng, chiều, đêm khuya), lọc sạch nhạc rác và chống lặp 100 bài gần nhất. Ngay khi có người thêm bài hát mới, bot lập tức chuyển về bài hát của người dùng với độ trễ 0s.
* **Autoplay 3 Tầng Giữ Đúng Gu Nhạc:** Kết hợp `YouTube Mix (RD)` $\rightarrow$ `Last.fm Similar` $\rightarrow$ `Heuristic Fallback` cùng bộ lọc phân tích ngôn ngữ/vùng miền (`V-Pop`, `K-Pop`, `J-Pop`, `US-UK`) để luôn gợi ý bài hát cùng thể loại.

### 6. Lưu Trữ Hybrid & Tự Phục Hồi Phiên (SessionManager)
* **Cơ chế lưu trữ kép (Hybrid Database):** Kết hợp giữa **MongoDB Atlas Cloud** và các file **JSON cục bộ dự phòng** (`data/`).
* **Khôi phục trạng thái phát:** Tự động lưu trạng thái hàng đợi và vị trí giây đang phát mỗi 15 giây. Khi bot hoặc máy chủ VPS khởi động lại, bot sẽ tự động vào lại đúng kênh Voice và phát tiếp đoạn nhạc đang dang dở.

---

## Kiến Trúc Hệ Thống (System Architecture)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                       NGƯỜI DÙNG (DISCORD & WEB)                        │
└───────────────┬─────────────────────────────────────────┬───────────────┘
                │ Slash / Prefix Commands                 │ HTTPS (PIN / Bearer Token)
                ▼                                         ▼
┌───────────────────────────────┐         ┌───────────────────────────────┐
│    DISCORD GATEWAY & VOICE    │         │      STATIC WEB PLAYER UI     │
│   (Discord.js v14 + @voice)   │         │ (React 18 + Tailwind + Vite)  │
└───────────────┬───────────────┘         └───────────────┬───────────────┘
                │                                         │ REST API Polling
                ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANNA BOT CORE (NODE.JS + EXPRESS)                    │
│  • MusicManager / MusicQueue (18s Preload, Crossfade, SponsorBlock)     │
│  • 3-Layer Autoplay & 24/7 Dynamic Lofi Engine                          │
│  • Smart 4-Tier Lyrics Engine (YouTube CC, Zing MP3, LRCLIB)           │
│  • Direct Raw PCM s16le Audio Pipeline                                  │
└───────┬───────────────────────────┬─────────────────────────────┬───────┘
        │ HTTP (127.0.0.1:8787)     │ Mongoose / FS               │ Stream / API
        ▼                           ▼                             ▼
┌───────────────────┐     ┌───────────────────────┐     ┌─────────────────┐
│   PYTHON FASTAPI  │     │    HYBRID DATABASE    │     │  EXTERNAL APIS  │
│   LYRICS SERVICE  │     │ • MongoDB Atlas Cloud │     │ • YouTube/yt-dlp│
│  • Musixmatch     │     │ • Local JSON Fallback │     │ • Spotify/SCloud│
│  • NetEase Music  │     │   (data/*.json)       │     │ • ZingMP3/LRCLIB│
└───────────────────┘     └───────────────────────┘     └─────────────────┘
```

---

## Danh Sách Lệnh Discord (Slash & Prefix Commands)

Bot hỗ trợ song song cả **Slash Commands (/)** lẫn **Prefix Commands** kèm hệ thống phím tắt (Aliases) tiện lợi:

### Lệnh Âm Nhạc & Bài Hát Yêu Thích
| Lệnh chính | Phím tắt (Aliases) | Mô tả chức năng |
| :--- | :--- | :--- |
| `/play <tên/link>` | `p` | Phát bài hát hoặc Playlist từ YouTube, Spotify, SoundCloud (có gợi ý tìm kiếm). |
| `/web` | — | Nhận liên kết Magic Token và mã PIN 6 số đăng nhập trực tiếp vào Web Player. |
| `/nowplaying` | `np`, `c`, `panel` | Hiển thị thẻ bài hát đang phát (Components V2) và cụm nút bấm điều khiển. |
| `/lyrics [tên_bài]`| `ly`, `loi` | Xem lời bài hát đồng bộ từ YouTube CC, Zing MP3, LRCLIB hoặc Musixmatch. |
| `/like [hành_động]`| `fav`, `yeuthich`| Quản lý (`list`, `add`, `remove`) và phát (`play`) danh sách bài hát yêu thích cá nhân. |
| `/pause` / `/resume`| `unpause` | Tạm dừng hoặc tiếp tục phát bài hát hiện tại. |
| `/skip` | `s`, `sk`, `fs` | Bỏ qua bài hát hiện tại để phát bài kế tiếp. |
| `/stop` | `st`, `off` | Dừng phát nhạc, xóa sạch hàng đợi và ngắt kết nối voice. |
| `/join` / `/leave` | `j`, `dc`, `out` | Mời bot vào phòng hoặc ngắt kết nối khỏi phòng Voice. |

### Lệnh Quản Lý Hàng Đợi & Âm Thanh
| Lệnh chính | Phím tắt (Aliases) | Mô tả chức năng |
| :--- | :--- | :--- |
| `/queue [trang]` | `q`, `list` | Xem danh sách bài hát trong hàng đợi có phân trang. |
| `/move <từ> [đến]` | `mv`, `jump` | Di chuyển vị trí bài hát trong hàng đợi (mặc định đưa lên `#1`). |
| `/remove <vị_trí>` | `rm`, `xoa` | Xóa một bài hát khỏi hàng đợi theo số thứ tự. |
| `/shuffle` | `sh`, `mix` | Xáo trộn ngẫu nhiên thứ tự các bài hát trong hàng đợi. |
| `/volume <1-150>` | `vol`, `v` | Điều chỉnh âm lượng bài hát từ 1% đến 150%. |
| `/loop [chế_độ]` | `l`, `repeat` | Chuyển chế độ lặp: `off` (Tắt) $\rightarrow$ `song` (1 bài) $\rightarrow$ `queue` (Cả hàng đợi). |

### Lệnh Quản Trị Máy Chủ & Tiện Ích
| Lệnh chính | Phím tắt (Aliases) | Mô tả chức năng |
| :--- | :--- | :--- |
| `/settings` | `caidat`, `config` | Mở bảng điều khiển cài đặt toàn diện (chỉ dành cho Quản trị viên). |
| `/247 [on/off]` | `24/7` | Bật/tắt chế độ duy trì phòng Voice 24/7 và phát đài Lofi thư giãn. |
| `/autoplay [trạng_thái]`| `ap`, `auto` | Bật/tắt tự động phát nhạc tương tự khi hết hàng đợi. |
| `/lockvoice` | `lockvc`, `setvoice`| Khóa cố định một phòng Voice duy nhất cho bot hoạt động. |
| `/setchannel` | `channel`, `kenhnhac`| Khóa kênh văn bản chuyên dụng để nhận lệnh âm nhạc. |
| `/setdj` | `djrole`, `djonly` | Thiết lập vai trò DJ và bật/tắt chế độ chỉ DJ mới được chỉnh nhạc. |
| `/setlog` | `logchannel`, `log` | Thiết lập kênh ghi nhật ký toàn bộ hoạt động của bot và Web Player. |
| `/ping` / `/feedback` | `ms`, `fb`, `gopy` | Kiểm tra độ trễ mạng (Ping) hoặc gửi góp ý trực tiếp đến nhà phát triển. |
| `/help` | `h`, `lenh` | Hiển thị bảng hướng dẫn sử dụng phân loại chi tiết. |

---

## Hướng Dẫn Cài Đặt & Triển Khai (Deployment)

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản `20.x LTS` hoặc `22.x` trở lên.
- **Python**: Phiên bản `3.10+` (chỉ cần thiết nếu bạn muốn chạy microservice `lyrics-service`).
- **Công cụ âm thanh**: `ffmpeg` và `yt-dlp` đã được cài đặt và có sẵn trong biến môi trường `PATH`.
- **Cơ sở dữ liệu**: MongoDB Atlas (nếu không cấu hình, bot sẽ tự động chuyển sang lưu bằng file JSON trong thư mục `data/`).

### 2. Cấu hình biến môi trường (.env)
Sao chép file `.env.example` thành `.env` và điền các thông số:
```bash
cp .env.example .env
```
Nội dung file `.env` mẫu:
```env
# Discord Credentials
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Cơ sở dữ liệu
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/anna_bot?retryWrites=true&w=majority

# Web Dashboard Server
PORT=3005
WEB_JWT_SECRET=your_super_secret_jwt_hmac_key_random_string

# Cấu hình mặc định
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk
LASTFM_API_KEY=your_optional_lastfm_key
```

### 3. Khởi chạy bằng Docker Compose (Khuyên dùng)
Dự án đã tích hợp sẵn Dockerfile và docker-compose.yml:
```bash
docker compose up -d --build
```

### 4. Khởi chạy thủ công trên VPS (Ubuntu / Debian / Windows)

#### Bước 1: Cài đặt & chạy Bot chính (Node.js)
```bash
# Cài đặt thư viện
npm install

# Đồng bộ Slash Commands lên Discord
node src/deploy-commands.js

# Khởi chạy bot trong môi trường Development
npm run dev

# Hoặc khởi chạy trong môi trường Production thông qua PM2
npm install -g pm2
pm2 start src/index.js --name "anna-music-bot"
pm2 save
```

#### Bước 2: Khởi chạy Lyrics Fallback Microservice (Python - Tùy chọn)
Microservice này đóng vai trò tầng dự phòng số 4 cho nhạc quốc tế hiếm:
```bash
cd lyrics-service
python3 -m venv venv
source venv/bin/activate  # Trên Windows dùng: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787 --workers 1
```
*(Xem chi tiết cách tạo service chạy nền tự động kèm giới hạn RAM `MemoryMax=200M` bằng systemd tại [lyrics-service/README.md](./lyrics-service/README.md)).*

---

## Cấu Trúc Thư Mục (Project Structure)

```text
anna-music-bot/
├── lyrics-service/        # Microservice Python FastAPI cào lời Musixmatch & NetEase (Tùy chọn)
│   ├── main.py            # API xử lý tìm kiếm đa luồng song song (LRU Cache)
│   └── README.md          # Hướng dẫn cấu hình systemd giới hạn 200MB RAM
├── public/                # Bản build giao diện tĩnh (Static Web Player & trang 404)
│   ├── anna-avatar-icon.png
│   ├── anna-music-logo-chromatic.png
│   └── 404.html
├── src/
│   ├── commands/          # 27 Slash & Prefix commands (play, web, lyrics, settings...)
│   ├── database/          # Kết nối Mongoose & các Models (Session, History, Favorite...)
│   ├── routes/
│   │   └── api.js         # Express REST API phục vụ Web Player (Auth PIN, State, Lyrics)
│   ├── structures/        # Quản lý hàng đợi & luồng phát (MusicQueue, SessionManager...)
│   ├── utils/             # Trích xuất âm thanh, SponsorBlock, 4-Tier Lyrics, Lofi Discovery
│   ├── config.js          # Quản lý cấu hình tập trung
│   ├── deploy-commands.js # Script đăng ký Slash Commands
│   └── index.js           # Điểm khởi động bot và Express API server
├── Dockerfile             # Đóng gói Container tự động
├── docker-compose.yml     # Cấu hình khởi chạy Docker multi-container
├── LICENSE                # Giấy phép MIT License
├── README.md              # Tài liệu Tiếng Anh
└── README_VI.md           # Tài liệu Tiếng Việt
```

---

## Chính Sách Bảo Mật & An Toàn

1. **Phân quyền chặt chẽ (Role-Based Authorization)**: Các API thay đổi cấu hình máy chủ, khóa phòng voice hay đổi thứ tự tầng lời bài hát bắt buộc người dùng phải có quyền `ManageGuild` (Quản lý Máy chủ) hoặc vai trò DJ.
2. **Bảo vệ mã PIN & Token (Brute-force Protection)**: Mã PIN 6 chữ số đăng nhập Web Player tự hủy sau 3 phút. Hệ thống tự động khóa IP trong 15 phút nếu nhập sai mã PIN quá 5 lần liên tiếp.
3. **Chống tấn công từ chối dịch vụ (Rate Limiting)**: Tích hợp middleware giới hạn tần suất gửi yêu cầu trên toàn bộ REST API để bảo vệ tài nguyên máy chủ VPS.
4. **Cách ly dữ liệu nhạy cảm**: Biến môi trường `.env`, cookies YouTube và dữ liệu cục bộ được đưa vào `.gitignore`, tuyệt đối không bao giờ được đưa lên kho lưu trữ mã nguồn công khai.

---

## Tuyên Bố Bản Quyền, Miễn Trừ & DMCA

1. **Bản Quyền Mã Nguồn**: Toàn bộ kiến trúc mã nguồn của dự án thuộc bản quyền của tác giả **Diiexe**, phát hành dưới giấy phép mã nguồn mở **MIT License**.
2. **Tuyên Bố Về Tên Gọi & Hình Ảnh Anime (Fan Project Disclaimer)**:
   - Tên gọi *"Anna"* và hình ảnh nhân vật lấy cảm hứng từ thế giới Anime thuộc quyền sở hữu trí tuệ của tác giả, họa sĩ và studio sản xuất nguyên tác tương ứng.
   - Anna Music Bot là một dự án phần mềm độc lập phi thương mại do người hâm mộ phát triển (Non-profit Fan Project), không có mối liên kết chính thức hay tài trợ từ phía các hãng phim anime.
3. **Tuyên Bố Miễn Trừ Dữ Liệu Âm Nhạc (Fair Use Stream Relay)**:
   - Anna Music Bot **không lưu trữ, không sao chép, không tải về và không phân phối bất kỳ file âm thanh nào** trên hệ thống máy chủ hoặc đĩa cứng.
   - Bot đóng vai trò là kênh chuyển tiếp luồng âm thanh kỹ thuật số trực tiếp (stream-through relay) từ các nguồn dữ liệu công khai trên Internet theo yêu cầu của người dùng vì mục đích thưởng thức cá nhân phi thương mại (Non-commercial Fair Use).
4. **Bản Quyền Lời Bài Hát**: Toàn bộ lời bài hát thuộc quyền sở hữu của các nhạc sĩ, nghệ sĩ và đơn vị phát hành tương ứng, được trích xuất thời gian thực từ các API mở của bên thứ ba.
5. **Tiếp Nhận Thông Báo Gỡ Bỏ (DMCA Compliance)**: Chúng tôi tôn trọng quyền sở hữu trí tuệ hợp pháp. Nếu bạn là chủ sở hữu bản quyền của bất kỳ nội dung nào và muốn hạn chế bot phát nội dung đó, vui lòng gửi yêu cầu để chúng tôi hỗ trợ chặn qua danh sách đen (Blacklist).

---

## Tri Ân & Ghi Nhận Bên Thứ Ba (Credits)

Dự án Anna Music Bot được xây dựng dựa trên sự kế thừa và tích hợp các công cụ, thư viện mã nguồn mở xuất sắc:
* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: Công cụ trích xuất luồng media trực tiếp và phụ đề Closed Captions.
* **[FFmpeg](https://ffmpeg.org/)**: Bộ giải mã và xử lý tín hiệu âm thanh tốc độ cao (`-ss`, `-to`, RAW PCM `s16le`).
* **[SponsorBlock](https://sponsor.ajay.app/)**: Cơ sở dữ liệu cộng đồng mở tuyệt vời do Ajay Ramachandran sáng lập, cung cấp dữ liệu phân đoạn `music_offtopic`.
* **[LRCLIB](https://lrclib.net/)**: Cơ sở dữ liệu lời bài hát đồng bộ mã nguồn mở chất lượng cao.
* **[Zing MP3](https://zingmp3.vn/)**: Nền tảng âm nhạc cung cấp dữ liệu phụ đề Karaoke V-Pop chuẩn xác.
* **[Discord.js](https://discord.js.org/) & [@discordjs/voice](https://github.com/discordjs/voice)**: Thư viện kết nối Discord Gateway và Discord Voice Gateway v4.
* **[React](https://react.dev/) & [Vite](https://vitejs.dev/) & [Tailwind CSS](https://tailwindcss.com/)**: Bộ công cụ xây dựng giao diện Web Player thời gian thực.
* **[syncedlyrics](https://github.com/brentvollebregt/syncedlyrics)**: Thư viện cào lời bài hát đồng bộ từ Musixmatch & NetEase.
* **[Muse](https://github.com/museofficial/muse) & [LavaMusic](https://github.com/appujet/lavamusic)**: Ý tưởng thiết kế về kiến trúc Music Bot và ứng dụng SponsorBlock cho Discord bot.

---

## Điều Khoản Giấy Phép (License)

Dự án này được phân phối dưới các điều khoản của **[MIT License](LICENSE)**.  
Bản quyền © 2026 thuộc về tác giả **Diiexe** (`Dự án Anna Music Bot`).

Theo điều khoản MIT: Bạn được toàn quyền tự do sử dụng, sao chép, chỉnh sửa, sáp nhập, xuất bản và phân phối mã nguồn cho các mục đích phi thương mại, với **điều kiện bắt buộc duy nhất là giữ nguyên thông báo bản quyền ghi nhận tác giả Diiexe** (`Copyright (c) 2026 Diiexe`).
