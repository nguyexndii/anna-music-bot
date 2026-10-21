# Anna Music Bot — Tài Liệu Kỹ Thuật & Hướng Dẫn Vận Hành

<p align="center">
  <img src="public/anna-music-logo-chromatic.png" alt="Anna Music Bot Logo" width="380" />
</p>

Hệ thống bot phát nhạc Discord hiệu năng cao với kiến trúc xử lý âm thanh không độ trễ (Zero-Latency RAW PCM Pipeline), cơ chế tự động cắt đoạn mở đầu/kết thúc phi âm nhạc qua SponsorBlock, công nghệ đồng bộ lời bài hát đa tầng có khả năng tự phát hiện và vá lỗi rỗng câu (Smart Gap Detection), cùng bảng điều khiển Web Dashboard thời gian thực.

Tác giả: **Diiexe**  
Bản quyền: **Apache License 2.0**  
Ngôn ngữ tài liệu: [English](./README.md) | **Tiếng Việt**

---

## Mục Lục
1. Giới Thiệu Tổng Quan
2. Kiến Trúc Kỹ Thuật & Cơ Chế Hoạt Động Chuyên Sâu
   - Cơ Chế Xử Lý Luồng Âm Thanh Không Độ Trễ (Raw PCM Pipeline)
   - Cơ Chế Tự Động Cắt Kịch Bản MV Qua SponsorBlock & Chuẩn Hóa Hệ Quy Chiếu
   - Thuật Toán Đồng Bộ Lời Bài Hát & Tự Động Vá Lỗ Thủng (Smart Gap Detection)
   - Cơ Chế Đồng Bộ Trạng Thái Web Dashboard (Optimistic UI & HMAC-SHA256)
   - Chế Độ Duy Trì Phòng Thoại Hai Chiều 24/7 (Bi-Directional Lofi Mode)
3. Chính Sách Bảo Mật & An Toàn Thông Tin
4. Tuyên Bố Bản Quyền, Miễn Trừ Trách Nhiệm & DMCA
5. Ghi Nhận & Tri Ân Bên Thứ Ba (Third-Party Credits & Acknowledgments)
6. Yêu Cầu Môi Trường & Hệ Thống
7. Hướng Dẫn Cài Đặt & Khởi Chạy
8. Danh Mục Lệnh Slash Command Discord
9. Đặc Tả Giao Diện Lập Trình REST API
10. Điều Khoản Giấy Phép (License)

---

## 1. Giới Thiệu Tổng Quan

Anna Music Bot là giải pháp âm nhạc trực tuyến chuyên dụng cho máy chủ Discord, được thiết kế nhằm giải quyết triệt để các rào cản kỹ thuật phổ biến trong việc truyền tải âm thanh:
- Triệt tiêu độ trễ khi bắt đầu và chuyển tiếp bài hát.
- Tự động loại bỏ các đoạn đóng kịch, giới thiệu, trò chuyện đầu/cuối trong Music Video trên YouTube.
- Đảm bảo tính liên tục và khớp nhịp tuyệt đối của lời bài hát Karaoke (tránh lỗi phụ đề bị mất đoạn của các dịch vụ bên thứ ba).
- Cung cấp trải nghiệm quản trị trực quan thông qua Web Dashboard thời gian thực.

Dự án được xây dựng hoàn toàn bằng mã nguồn mở hiện đại (Node.js 20, Discord.js v14, React 18, Vite, Tailwind CSS) và tuân thủ nghiêm ngặt các tiêu chuẩn an toàn bảo mật.

---

## 2. Kiến Trúc Kỹ Thuật & Cơ Chế Hoạt Động Chuyên Sâu

### 2.1. Cơ Chế Xử Lý Luồng Âm Thanh Không Độ Trễ (Raw PCM Pipeline)
Thông thường, các bot Discord truyền thống sử dụng quy trình tải file tạm về đĩa cứng hoặc nén lại qua nhiều lớp trung gian (transcoding), gây tốn CPU và tạo độ trễ 2 – 5 giây khi đổi bài.

Anna Music Bot tối ưu hóa pipeline âm thanh theo mô hình Direct Stream:
1. **Trích xuất luồng (Demuxing)**: `yt-dlp` được cấu hình để trích xuất trực tiếp URL âm thanh gốc chất lượng cao (WebM/Opus hoặc M4A/AAC) kết hợp cơ chế xác thực qua `cookies.txt` nhằm tránh rào cản Bot Challenge từ YouTube.
2. **Chuyển đổi tín hiệu một bước qua FFmpeg**: Luồng dữ liệu âm thanh từ URL được truyền trực tiếp vào tiến trình con duy nhất của `FFmpeg`. FFmpeg giải mã trực tiếp luồng stream sang định dạng **RAW PCM Stereo 16-bit Little-Endian (`s16le`)** với tần số lấy mẫu chuẩn **48,000 Hz**.
3. **Đẩy luồng trực tiếp vào Discord Voice**: Tín hiệu `s16le` được chuyển thẳng vào đối tượng `AudioResource` của `@discordjs/voice` với cấu hình `inputType: StreamType.Raw`. Quá trình này không cần mã hóa trung gian, giữ nguyên chất lượng âm thanh gốc, giảm thiểu tải CPU máy chủ xuống dưới 5% và giúp âm thanh phát ra loa kênh thoại ngay lập tức khi người dùng chọn bài.

---

### 2.2. Cơ Chế Tự Động Cắt Kịch Bản MV Qua SponsorBlock & Chuẩn Hóa Hệ Quy Chiếu
Các Music Video trên YouTube thường chứa đoạn đóng kịch mở đầu (intro dialogue), quảng cáo tài trợ hoặc phần giới thiệu hậu trường dài từ 30 giây đến hơn 2 phút trước khi âm nhạc bắt đầu.

Hệ thống xử lý vấn đề này theo quy trình:
1. **Truy vấn phân đoạn phi âm nhạc**: Khi bài hát được thêm vào hàng đợi hoặc trước thời điểm phát, module `sponsorBlockHelper.js` truy vấn API của SponsorBlock để tìm các phân đoạn được gắn thẻ `music_offtopic`.
2. **Xác định mốc cắt (Offset Resolution)**:
   - Nếu phân đoạn phi âm nhạc nằm ở đầu bài (`segment[0] <= 2s` và `segment[1] >= 5s`), điểm bắt đầu nhạc thực tế được gán: `trimStart = segment[1]`.
   - Nếu phân đoạn phi âm nhạc nằm ở cuối bài, điểm kết thúc nhạc thực tế được gán: `trimEnd = segment[0]`.
   - Thời lượng bài hát thực tế được tính toán lại: `realDurationSec = trimEnd - trimStart`.
3. **Cắt bằng cờ phần cứng FFmpeg**: Khi khởi chạy stream, bot truyền trực tiếp các tham số `-ss <trimStart>` và `-to <trimEnd>` vào lệnh thực thi của FFmpeg. Bộ giải mã FFmpeg tự động bỏ qua toàn bộ các khung hình phi âm nhạc mà không phát sinh độ trễ tua bài trong kênh thoại.
4. **Chuẩn hóa hệ quy chiếu thời gian cho Lời bài hát**:
   - **Với nguồn lời từ phòng thu (`zingmp3`, `lrclib`, `syncedlyrics`)**: Bản thu gốc của phòng thu luôn bắt đầu từ giây `0:00`. Vì FFmpeg đã cắt bỏ đoạn kịch đầu bài, bộ đếm thời gian phát của Discord khớp hoàn toàn 100% với lời bài hát phòng thu (`autoOffsetMs = 0`).
   - **Với phụ đề YouTube CC (`youtube_cc`)**: Mốc thời gian của phụ đề video YouTube được gắn liền với video chưa cắt. Bot tự động dịch chuyển toàn bộ mốc thời gian của các câu hát lùi lại một khoảng bằng đoạn đã cắt:
     $$\text{line.time} = \max(0, \text{line.time} - \text{trimStart} \times 1000)$$
     Nhờ đó, phụ đề YouTube CC hiển thị chuẩn xác từng từ với âm thanh thực tế phát ra loa.

---

### 2.3. Thuật Toán Đồng Bộ Lời Bài Hát & Tự Động Vá Lỗ Thủng (Smart Gap Detection)
Hệ thống sử dụng cơ chế Cuộc đua song song có trọng số (Weighted Parallel Race) giữa 4 tầng cung cấp lời bài hát: YouTube Closed Captions, Zing MP3 Lyrics, LRCLIB Database và Microservice Syncedlyrics (Musixmatch / NetEase).

Để giải quyết bài toán một dịch vụ bên thứ ba bị thiếu lời (ví dụ Zing MP3 chỉ làm Karaoke cho ca sĩ chính và bỏ trống 34 giây đoạn hát của nghệ sĩ song ca trong bài "Và Thế Giới Đã Mất Đi Một Người Cô Đơn"), thuật toán `Smart Gap Detection` hoạt động như sau:

1. **Khởi chạy cuộc đua song song**: Khi phát bài hát, tất cả các nguồn lời bài hát được kích hoạt đồng thời.
2. **Đánh giá chất lượng lời bài hát (`evaluateLyricsQuality`)**:
   - Duyệt qua từng câu hát liên tiếp và tính khoảng thời gian trống giữa chúng:
     $$\Delta t = \text{line}_{i+1}.\text{time} - \text{line}_i.\text{time}$$
   - Nếu tồn tại $\Delta t \ge 22,000\text{ms}$ (22 giây) ở giữa bài hát, nguồn dữ liệu đó bị đánh dấu là có lỗ thủng bất thường (`hasAbnormalGap = true`).
3. **Cơ chế cửa sổ ưu tiên thông minh (Priority Window)**:
   - Nếu nguồn trả về đầu tiên là tầng ưu tiên số 1 của máy chủ và không bị thủng lỗ (`hasAbnormalGap === false`): Hệ thống chốt kết quả ngay lập tức (Zero Latency).
   - Nếu nguồn trả về đầu tiên bị thủng lỗ (như Zing MP3 bị rỗng 34 giây): Hệ thống không chốt vội mà mở một cửa sổ chờ tối đa 1200ms để đợi LRCLIB hoặc các nguồn khác về đích.
4. **Lựa chọn người chiến thắng (`pickBestLyricsCandidate`)**:
   - Tiêu chí 1: Nguồn không bị thủng lỗ luôn đánh bại nguồn bị thủng lỗ.
   - Tiêu chí 2: Nếu cả hai cùng không bị thủng lỗ (hoặc cùng bị thủng), ưu tiên theo thứ tự cấu hình của quản trị viên (`lyricsLayers`).
   - Tiêu chí 3: Bản ghi có số lượng câu hát nhiều hơn sẽ giành chiến thắng.
5. **Tách nghệ sĩ thông minh trong `generateSearchVariants`**: Tự động nhận diện và phân tách các nghệ sĩ hợp tác (ví dụ tách `marzuz, Changg` thành `marzuz` và `Changg`), giúp LRCLIB tìm trúng bản thu chuẩn xác ngay tại tầng `/api/get` chỉ trong 200ms.

---

### 2.4. Cơ Chế Đồng Bộ Trạng Thái Web Dashboard (Optimistic UI & HMAC-SHA256)
1. **Kiến trúc Optimistic UI**: Khi người dùng nhấn nút Tạm dừng (Pause), Tiếp tục (Resume), Chuyển bài (Skip) hoặc Kéo thanh âm lượng trên Web Dashboard, giao diện người dùng lập tức cập nhật trạng thái hiển thị ngay ở $t = 0\text{ms}$ mà không chờ phản hồi từ mạng. Một HTTP POST request được gửi song song đến backend. Nếu yêu cầu thất bại, hệ thống tự động hoàn tác (rollback) trạng thái về giá trị thực tế.
2. **Cơ chế Polling phân tầng tối ưu băng thông**: Web Dashboard định kỳ gửi request đến `/api/guilds/:guildId/state`. Endpoint này tự động lược bỏ các mảng dữ liệu lịch sử nặng khi không có tham số `?full=1`, giúp giảm tới 95% lưu lượng mạng trên mỗi chu kỳ.
3. **Xác thực an toàn qua Magic Token**: Người dùng tạo link đăng nhập tức thì thông qua lệnh `/web`. Token được ký bằng thuật toán HMAC-SHA256 với khóa bí mật `WEB_JWT_SECRET`, chứa định danh máy chủ (`guildId`), định danh người dùng (`userId`), trạng thái quyền quản trị (`isAdmin`) và thời hạn hết hạn ngắn nhằm bảo vệ máy chủ tối đa.

---

### 2.5. Chế Độ Duy Trì Phòng Thoại Hai Chiều 24/7 (Bi-Directional Lofi Mode)
- **Duy trì kết nối thoại liên tục**: Bot luôn giữ trạng thái kết nối trong kênh thoại 24/7 kể cả khi danh sách phát của người dùng kết thúc hoặc phòng thoại không còn thành viên.
- **Kho nhạc Lofi không lời tuyển chọn**: Sử dụng danh mục các bản nhạc Lofi / Acoustic Chill không lời êm dịu, không gây ảnh hưởng đến cuộc trò chuyện hoặc công việc học tập của người dùng.
- **Bảo toàn hàng đợi hai chiều**: Khi người dùng thêm bài hát mới vào hàng đợi, bot lập tức tạm dừng luồng Lofi và phát bài hát của người dùng. Khi hàng đợi bài hát kết thúc, bot tự động kích hoạt lại luồng Lofi một cách êm đềm mà không ngắt kết nối.
- **Bộ nhớ chống lặp (`LofiHistoryManager`)**: Tự động ghi nhớ 50 bài hát gần nhất đã phát để đảm bảo không xảy ra hiện tượng phát lặp lại bài trong chế độ 24/7.

---

## 3. Chính Sách Bảo Mật & An Toàn Thông Tin

Dự án tuân thủ nghiêm ngặt các quy tắc an toàn bảo mật trong môi trường Discord và hệ thống máy chủ:

1. **Xác thực API & Giới hạn quyền hạn (Authorization)**:
   - Các API thay đổi cấu hình bot, sắp xếp tầng lời bài hát, thiết lập kênh văn bản/thoại bắt buộc phải có quyền quản trị máy chủ Discord (`ManageGuild`) hoặc vai trò DJ được chỉ định.
2. **Phòng chống tấn công cạn kiệt tài nguyên (Rate Limiting)**:
   - Tích hợp middleware giới hạn tần suất gửi yêu cầu (`express-rate-limit`) trên tất cả các endpoint của Web API, ngăn ngừa việc gửi request liên tục làm quá tải CPU hoặc tràn bộ nhớ máy chủ.
3. **Cách ly dữ liệu nhạy cảm**:
   - Khóa bí mật JWT (`WEB_JWT_SECRET`), token bot Discord (`DISCORD_TOKEN`), chuỗi kết nối cơ sở dữ liệu (`MONGODB_URI`) và file chứa cookies YouTube (`cookies.txt`) được lưu trữ độc lập trong biến môi trường và file cục bộ, được liệt kê đầy đủ trong `.gitignore`, tuyệt đối không bao giờ được chia sẻ hoặc đẩy lên kho lưu trữ mã nguồn công khai.
4. **Chính sách báo cáo lỗ hổng an toàn (Safe Disclosure)**:
   - Nếu bạn phát hiện bất kỳ vấn đề bảo mật nào liên quan đến mã nguồn, vui lòng không mở Issue công khai. Hãy liên hệ trực tiếp với tác giả **Diiexe** để phối hợp kiểm tra và xử lý an toàn.

---

## 4. Tuyên Bố Bản Quyền, Miễn Trừ Trách Nhiệm & DMCA

1. **Bản Quyền Mã Nguồn Phần Mềm**:
   - Toàn bộ kiến trúc mã nguồn của dự án Anna Music Bot thuộc bản quyền của tác giả **Diiexe**, được phát hành theo giấy phép **Apache License 2.0**.

2. **Tuyên Bố Về Tên Gọi & Hình Ảnh Nhân Vật Anime (Fan-Made Disclaimer)**:
   - Tên gọi *"Anna"* và các hình ảnh đại diện/banner lấy cảm hứng từ nhân vật Anime thuộc quyền sở hữu trí tuệ của tác giả, họa sĩ minh họa và studio sản xuất nguyên tác tương ứng.
   - Dự án Anna Music Bot là một sản phẩm phần mềm độc lập do người hâm mộ phát triển (Non-profit Fan Project), hoàn toàn phi thương mại và không có bất kỳ mối liên kết chính thức, ủy quyền hay tài trợ nào từ phía các studio sản xuất hoặc đơn vị sở hữu bản quyền nhân vật anime đó.

3. **Tuyên Bố Miễn Trừ Trách Nhiệm Về Dữ Liệu Âm Nhạc (Fair Use Disclaimer)**:
   - Anna Music Bot **không lưu trữ, không sao chép, không tải về và không phân phối bất kỳ file âm thanh nào** trên hệ thống máy chủ hoặc đĩa cứng.
   - Hệ thống chỉ đóng vai trò là một kênh chuyển tiếp luồng âm thanh kỹ thuật số trực tiếp (ephemeral stream-through relay) theo thời gian thực từ các nguồn dữ liệu công khai trên Internet do chính người dùng máy chủ Discord yêu cầu, phục vụ mục đích nghe nhạc cá nhân / nghiên cứu công nghệ phi thương mại (Non-commercial Fair Use) trong phạm vi nhóm nhỏ.

4. **Bản Quyền Lời Bài Hát & Phụ Đề**:
   - Lời bài hát, phụ đề và bản dịch hiển thị trên giao diện thuộc quyền sở hữu trí tuệ của tác giả, nghệ sĩ và các đơn vị phát hành âm nhạc tương ứng. Dữ liệu này được trích xuất phục vụ mục đích hỗ trợ hiển thị thông tin học thuật theo thời gian thực từ các API mở của bên thứ ba.

5. **Tiếp Nhận Thông Báo Gỡ Bỏ (DMCA Compliance)**:
   - Chúng tôi tôn trọng quyền sở hữu trí tuệ hợp pháp của các tác giả và đơn vị phát hành. Nếu bạn là chủ sở hữu bản quyền hợp pháp của bất kỳ nội dung nào và muốn hạn chế bot phát nội dung đó, vui lòng gửi yêu cầu để chúng tôi hỗ trợ chặn thông qua danh sách đen kỹ thuật số (Blacklist).

---

## 5. Ghi Nhận & Tri Ân Bên Thứ Ba (Third-Party Credits & Acknowledgments)

Dự án Anna Music Bot được xây dựng dựa trên sự kế thừa và tích hợp các công cụ, thư viện mã nguồn mở và dịch vụ API xuất sắc sau:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: Công cụ trích xuất luồng media mạnh mẽ nhất hiện nay, đóng vai trò nòng cốt trong việc lấy luồng âm thanh và phụ đề Closed Captions.
- **[FFmpeg](https://ffmpeg.org/)**: Bộ giải mã và xử lý tín hiệu âm thanh tốc độ cao, hỗ trợ việc cắt đoạn phi âm nhạc (`-ss`, `-to`) và chuyển đổi tín hiệu sang RAW PCM `s16le`.
- **[SponsorBlock](https://sponsor.ajay.app/)**: Cơ sở dữ liệu cộng đồng mở tuyệt vời do Ajay Ramachandran sáng lập, cung cấp dữ liệu phân đoạn `music_offtopic` để tự động loại bỏ các đoạn đóng kịch trong Music Video.
- **[LRCLIB](https://lrclib.net/)**: Cơ sở dữ liệu lời bài hát đồng bộ mã nguồn mở chất lượng cao dành cho cộng đồng.
- **[Zing MP3](https://zingmp3.vn/)**: Nền tảng âm nhạc cung cấp dữ liệu phụ đề Karaoke V-Pop chuẩn xác từng câu và mốc thời gian.
- **[Discord.js](https://discord.js.org/) & [@discordjs/voice](https://github.com/discordjs/voice)**: Thư viện chuẩn mực kết nối Discord API và giải pháp Discord Voice Gateway v4.
- **[React](https://react.dev/) & [Vite](https://vitejs.dev/) & [Tailwind CSS](https://tailwindcss.com/)**: Nền tảng công nghệ xây dựng giao diện Web Dashboard thời gian thực hiện đại, nhẹ và tối ưu tốc độ render.
- **[syncedlyrics](https://github.com/brentvollebregt/syncedlyrics)**: Thư viện trích xuất lời bài hát đồng bộ đa nguồn dự phòng bằng Python.
- **[Muse](https://github.com/museofficial/muse) & [LavaMusic](https://github.com/appujet/lavamusic)**: Các dự án mã nguồn mở đã truyền cảm hứng về kiến trúc phát nhạc và ứng dụng SponsorBlock trong hệ sinh thái Discord Bot.

---

## 6. Yêu Cầu Môi Trường & Hệ Thống

- **Hệ điều hành**: Linux (Ubuntu 20.04/22.04 LTS, Debian 11/12) hoặc Windows 10/11 / Windows Server.
- **Node.js**: Phiên bản `20.x LTS` hoặc `22.x` trở lên.
- **yt-dlp**: Phiên bản mới nhất (bắt buộc có sẵn trong biến môi trường PATH của hệ thống).
- **FFmpeg**: Phiên bản 5.x, 6.x hoặc 7.x (bắt buộc có sẵn trong PATH của hệ thống).
- **Cơ sở dữ liệu**: MongoDB (cục bộ hoặc MongoDB Atlas).
- **Tài khoản Discord Developer**: Ứng dụng Bot Discord đã kích hoạt đầy đủ các Privileged Gateway Intents (`Message Content Intent`, `Server Members Intent`).
- **Python (Tùy chọn)**: Phiên bản 3.10 trở lên nếu bạn muốn triển khai microservice phụ trợ `lyrics-service`.

---

## 7. Hướng Dẫn Cài Đặt & Khởi Chạy

### Bước 1: Sao chép mã nguồn
```bash
git clone https://github.com/your-username/anna-music-bot.git
cd anna-music-bot
```

### Bước 2: Cài đặt thư viện phụ thuộc
```bash
# Cài đặt thư viện cho Backend Bot
npm install

# Build giao diện Web UI (nếu có chỉnh sửa trong thư mục anna-music-bot-ui)
cd ../anna-music-bot-ui
npm install
npm run build
# Bản build sẽ tự động được đóng gói vào thư mục anna-music-bot/public
```

### Bước 3: Cấu hình biến môi trường
Tạo file `.env` tại thư mục gốc của bot theo mẫu sau:
```env
# Discord Bot Credentials
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Cơ sở dữ liệu MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/anna_bot?retryWrites=true&w=majority

# Web Dashboard & HTTP Server
PORT=3005
WEB_JWT_SECRET=your_super_secret_jwt_hmac_key_random_string

# Cấu hình luồng Lofi mặc định
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk

# Khóa API mở rộng (Tùy chọn)
LASTFM_API_KEY=your_optional_lastfm_key
```

### Bước 4: Thiết lập file YouTube Cookies (Khuyên dùng khi chạy trên VPS)
Để tránh các giới hạn IP và Bot Challenge từ YouTube, hãy xuất cookies từ trình duyệt của bạn (dùng tiện ích mở rộng như "Get cookies.txt LOCALLY") và lưu file tại đường dẫn:
```text
anna-music-bot/cookies.txt
```

### Bước 5: Khởi chạy hệ thống
```bash
# Chạy trong môi trường phát triển (Development)
npm run dev

# Khởi chạy trong môi trường Production thông qua PM2
npm install -g pm2
pm2 start src/index.js --name "anna-music-bot"
pm2 save
```

---

## 8. Danh Mục Lệnh Slash Command Discord

| Lệnh | Cú pháp | Chức năng chi tiết |
| :--- | :--- | :--- |
| `/play` | `/play <tên bài \| url \| playlist>` | Phát nhạc hoặc thêm vào hàng đợi (hỗ trợ YouTube, Spotify, SoundCloud...) |
| `/web` | `/web` | Tạo link đăng nhập bảo mật 1-click vào Web Dashboard thời gian thực |
| `/nowplaying` | `/nowplaying` | Hiển thị thẻ bài hát đang phát kèm các nút điều khiển trực quan |
| `/queue` | `/queue [trang]` | Xem danh sách các bài hát đang chờ phát |
| `/skip` | `/skip` | Bỏ qua bài hát hiện tại |
| `/pause` | `/pause` | Tạm dừng phát nhạc |
| `/resume` | `/resume` | Tiếp tục phát nhạc |
| `/stop` | `/stop` | Dừng nhạc, xóa danh sách hàng đợi và rời phòng thoại |
| `/volume` | `/volume <1-150>` | Điều chỉnh âm lượng bài hát |
| `/loop` | `/loop <off \| song \| queue>` | Đổi chế độ lặp (Tắt / Lặp 1 bài / Lặp cả danh sách) |
| `/autoplay` | `/autoplay` | Bật/tắt tự động phát các bài hát tương tự khi hết nhạc |
| `/247` | `/247` | Bật/tắt chế độ duy trì phòng thoại 24/7 |
| `/settings` | `/settings` | Mở bảng điều khiển cấu hình bot (Dành riêng cho Quản trị viên) |
| `/help` | `/help` | Xem bảng hướng dẫn đầy đủ danh mục lệnh |

---

## 9. Đặc Tả Giao Diện Lập Trình REST API

Máy chủ HTTP tích hợp Express hoạt động tại cổng được cấu hình trong biến môi trường `PORT` (mặc định: `3005`):

| Phương thức | Đường dẫn Endpoint | Mô tả chức năng |
| :--- | :--- | :--- |
| `GET` | `/api/guilds/:guildId/state` | Trả về trạng thái phát nhạc, bài hát hiện tại, âm lượng, kênh thoại (`?full=1` để lấy toàn bộ lịch sử) |
| `POST` | `/api/guilds/:guildId/action` | Thực thi các lệnh: `play`, `pause`, `skip`, `seek`, `volume`, `loop`, `shuffle`, `toggle247`, `toggleLofiMode` |
| `GET` | `/api/guilds/:guildId/lyrics` | Lấy dữ liệu lời bài hát Karaoke đồng bộ theo thời gian thực |
| `GET` | `/api/guilds/:guildId/settings` | Đọc cấu hình máy chủ (Kênh chỉ định, SponsorBlock, danh sách tầng lời bài hát...) |
| `POST` | `/api/guilds/:guildId/settings` | Cập nhật cấu hình máy chủ (Yêu cầu quyền Admin hoặc vai trò DJ) |
| `GET` | `/api/search?q=:query` | Tìm kiếm bài hát tích hợp debounce hỗ trợ nhiều nguồn |
| `GET` | `/health` | Kiểm tra tình trạng hoạt động của bot (Thời gian Uptime, RAM, phiên bản Node.js) |

---

## 10. Điều Khoản Giấy Phép (License)

Dự án này được cấp phép theo điều khoản của **[Apache License, Version 2.0](LICENSE)**.  
Bản quyền © 2026 thuộc về tác giả **Diiexe** (`Dự án Anna Music Bot`). Toàn bộ quyền được bảo lưu.

Các điều kiện cốt lõi theo giấy phép Apache 2.0:
- **Quyền sử dụng**: Bạn được cấp quyền tự do sử dụng, sao chép, chỉnh sửa và phân phối lại mã nguồn cho các mục đích phi thương mại.
- **Ghi nhận nguồn gốc (Attribution)**: Bất kỳ bản sao hoặc sản phẩm phái sinh nào đều bắt buộc phải giữ nguyên thông báo bản quyền gốc ghi nhận tác giả **Diiexe** và cung cấp bản sao của giấy phép Apache 2.0.
- **Minh bạch sửa đổi (State Changes)**: Các file được chỉnh sửa bắt buộc phải mang ghi chú rõ ràng nêu bật các thay đổi đã thực hiện.
- **Bảo vệ thương hiệu (Trademarks)**: Giấy phép này **không cấp quyền** sử dụng tên gọi *"Anna Music Bot"*, hình ảnh đại diện hoặc logo của dự án để quảng bá các sản phẩm phái sinh mà không có sự chấp thuận bằng văn bản của tác giả.

Xem toàn văn văn bản pháp lý tại file [LICENSE](./LICENSE).
