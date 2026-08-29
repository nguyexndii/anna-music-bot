# 🎵 Anna Music Bot (24/7 Discord Music Bot with Gemini AI)

Bot phát nhạc Discord chuyên nghiệp, hỗ trợ phát nhạc 24/7, tự động kết nối lại (Auto-reconnect), tích hợp **Trợ lý DJ Gemini AI**, dàn nút bấm tương tác và lệnh tiền tố riêng biệt `.`.

---

## 🚀 Tính năng nổi bật

- 🧠 **Trợ lý DJ Gemini AI**: Tìm bài hát bằng ngôn ngữ tự nhiên, tâm trạng, ngữ cảnh hoặc câu lời bài hát bất kỳ (`.ai`).
- ♾️ **Chế độ 24/7**: Bot luôn giữ kết nối trong kênh Voice ngay cả khi không có ai nghe hoặc phát hết nhạc.
- ✨ **Cơ chế Autoplay Đa Lớp Thông Minh**:
  0. **Lớp 0 (Siêu ưu tiên - Gemini DJ AI)**: Tự động phân tích cảm xúc, nhịp điệu (tempo), thể loại và gợi ý bài hát chuẩn gu nhất khi bật trong Cài đặt.
  1. **Lớp 1 (Ưu tiên cao - YouTube Mix)**: Tự động lấy danh sách bài hát liên quan trực tiếp từ thuật toán YouTube Mix (`RD<videoId>`).
  2. **Lớp 2 (Fallback - Last.fm Similar Tracks)**: Sử dụng Last.fm API để tìm các bài hát có phong cách tương đồng từ cơ sở dữ liệu âm nhạc toàn cầu.
  3. **Lớp 3 (Fallback cuối cùng - Heuristic)**: Phân tích ca sĩ, thể loại (Bolero, Nhạc xưa, Indie, Ballad, Pop...) và lọc triệt để các bài remix/karaoke/1hour.
- ⚡ **Tải trước ngầm (Pre-fetching Buffer)**: Tải trước bài tiếp theo trong hậu trường, giúp chuyển bài với **độ trễ 0 giây** và hòa âm mượt mà không bị khựng.
- 🎵 **Hỗ trợ Playlist YouTube & Spotify**: Tự động nhận diện và thêm tối đa 20 bài đầu tiên từ Playlist vào hàng chờ.
- 🗑️ **Hàng chờ tương tác**: Xem hàng chờ và chọn bài để xóa trực tiếp qua Menu Dropdown.
- 🎙️ **Voice Channel Status**: Tự động cập nhật tên bài hát đang phát vào trạng thái phòng thoại.
- 🎛️ **Giao diện Nút bấm (Button Controls)**: Điều khiển nhạc trực tiếp bằng nút bấm ngay trên Embed tin nhắn (Tạm dừng, Bỏ qua, Loop, Thêm bài, Dừng).
- 🌐 **Web Server Keep-Alive**: Tích hợp Express Server tại `/` và `/health` giúp treo bot 24/7 miễn phí.
- ⚡ **Tiền tố lệnh `.` chống trùng**: Tích hợp các lệnh `.p`, `.ai`, `.pause`, `.resume`, `.sk`, `.st`, `.q`, `.np`, `.v`, `.l`, `.247`, `.join`, `.leave`, `.caidat`, `.h`.

---

## 🛠️ Hướng dẫn cài đặt & Chạy Bot

### 1. Yêu cầu hệ thống
- **Node.js**: v18.x trở lên (khuyên dùng Node v20/v24).
- **Discord Bot Token**: Đã bật Intent **Message Content Intent** trong [Discord Developer Portal](https://discord.com/developers/applications).

### 2. Cấu hình biến môi trường
Tạo file `.env` từ file `.env.example` và điền thông tin:
```env
DISCORD_TOKEN=Token_Bot_Cua_Ban
DISCORD_CLIENT_ID=Client_ID_Bot_Cua_Ban
PORT=3000
DEFAULT_247_STREAM=https://www.youtube.com/watch?v=jfKfPfyJRdk

# (Tùy chọn) Last.fm API Key cho lớp Autoplay thứ 2
LASTFM_API_KEY=

# (Tùy chọn) Google Gemini AI API Keys (hỗ trợ nhiều key xoay vòng)
GEMINI_API_KEYS=key1,key2,key3
```

### 3. Cài đặt thư viện
```bash
npm install
```

### 4. Khởi chạy bot
```bash
npm start
```
Hoặc nhấp đúp chuột vào file `start-bot.bat` trên Windows.

---

## 📋 Danh sách Lệnh (`.`)

| Lệnh | Alias | Mô tả |
| :--- | :--- | :--- |
| `.play <tên / link / playlist>` | `.p` | Phát nhạc hoặc thêm vào hàng chờ (hỗ trợ cả Playlist Spotify/YouTube) |
| `.ai <tâm trạng / lời bài hát>` | `.gemini`, `.dj` | **DJ Gemini AI** tìm & phát nhạc theo ngôn ngữ tự nhiên hoặc câu hát |
| `.pause` | | Tạm dừng phát nhạc |
| `.resume` | `.unpause` | Tiếp tục phát nhạc |
| `.skip` | `.s`, `.sk` | Bỏ qua bài hát hiện tại |
| `.stop` | `.st` | Dừng phát nhạc & xóa hàng chờ |
| `.queue` | `.q`, `.list` | Xem danh sách bài hát & chọn bài để xóa qua Dropdown |
| `.remove <số>` | `.xoa <số>` | Xóa bài hát khỏi hàng chờ theo số thứ tự |
| `.nowplaying` | `.np` | Xem bài đang phát & dàn nút bấm điều khiển |
| `.volume <1-100>` | `.vol`, `.v` | Điều chỉnh âm lượng phát |
| `.loop` | `.l` | Tắt / Lặp bài / Lặp danh sách |
| `.autoplay` | `.ap` | Bật / Tắt chế độ tự động phát bài tương tự |
| `.crossfade <0-10>` | `.fade` | Chỉnh thời gian hòa âm chuyển bài (giây) |
| `.247` | `.24/7` | Bật / Tắt chế độ duy trì Voice 24/7 |
| `.join` | `.j`, `.thamgia` | Mời bot vào kênh Voice của bạn |
| `.leave` | `.dc`, `.out` | Cho bot rời khỏi kênh Voice |
| `.caidat` | `.settings` | Mở bảng điều khiển cài đặt Bot (Admin only) |
| `.setdj @role` | | Cài đặt vai trò DJ và bật/tắt DJ Only |
| `.lockvoice <#kênh / off>` | | Khóa kênh Voice cố định |
| `.setchannel <#kênh / off>` | | Khóa kênh văn bản dùng lệnh |
| `.help` | `.h` | Hiển thị bảng trợ giúp |

---

## 🌐 Hướng dẫn treo Bot 24/7 miễn phí

1. Upload mã nguồn lên dịch vụ hosting (Discloud, Render, Railway, VPS,...).
2. Lấy URL của ứng dụng (vd: `https://anna-music-bot.onrender.com/health`).
3. Đăng ký tài khoản tại [UptimeRobot.com](https://uptimerobot.com) -> Tạo **HTTP Monitor** với chu kỳ 5 phút/lần tới URL trên. Bot của bạn sẽ hoạt động liên tục không lo bị rơi vào trạng thái ngủ!
