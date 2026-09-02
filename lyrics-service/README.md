# Anna Music Bot — Lyrics Fallback Service (Microservice Python)

Microservice siêu nhẹ chạy nội bộ trên VPS (cổng `127.0.0.1:8787`), sử dụng thư viện `syncedlyrics` để gom lời bài hát và lời đồng bộ (Karaoke) từ nhiều nguồn lớn: **Musixmatch, NetEase, Genius, Lrclib...**

Được thiết kế tối ưu riêng cho **VPS 2GB RAM**:
- Chỉ lắng nghe trên giao diện cục bộ `127.0.0.1` (an toàn, không lộ ra internet).
- Chạy với 1 worker duy nhất (`workers=1`), khi không có yêu cầu thì ở trạng thái idle, tiêu thụ cực ít tài nguyên.
- Được giới hạn trần RAM cứng qua systemd (`MemoryMax=200M`) để không bao giờ ảnh hưởng tới bot Discord chính.

---

## 🛠️ Hướng Dẫn Cài Đặt & Triển Khai Trên VPS (Ubuntu / Debian)

### Bước 1: Kiểm tra và cài đặt Python3 + pip + venv (nếu chưa có)
Mở terminal VPS và chạy lệnh:
```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv
```

---

### Bước 2: Tạo Virtual Environment riêng cho service
Sử dụng virtual environment giúp cô lập các package, không xung đột với Python của hệ điều hành:
```bash
cd ~/anna-music-bot/lyrics-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

### Bước 3: Kiểm tra chạy thử thủ công
Trước khi cấu hình systemd, bạn có thể chạy thử để xem service hoạt động:
```bash
source venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8787 --workers 1
```

Mở một tab terminal khác trên VPS và chạy lệnh `curl` test:
```bash
curl "http://127.0.0.1:8787/lyrics?title=co+em&artist=madihu"
```
Nếu nhận được JSON chứa `syncedLyrics` và `"success": true` thì bấm `Ctrl + C` ở tab terminal chạy uvicorn để dừng lại và chuyển sang bước tạo systemd service.

---

### Bước 4: Tạo file Systemd Service tự động chạy nền
Tạo file cấu hình dịch vụ:
```bash
sudo nano /etc/systemd/system/anna-lyrics.service
```

Dán nội dung sau vào file (thay `root` hoặc user tương ứng nếu bạn đang dùng user khác, và thay đúng đường dẫn thư mục):

```ini
[Unit]
Description=Anna Music Bot - Lyrics Fallback Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/anna-music-bot/lyrics-service
ExecStart=/root/anna-music-bot/lyrics-service/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8787 --workers 1
Restart=on-failure
RestartSec=5
MemoryMax=200M
MemoryHigh=150M

[Install]
WantedBy=multi-user.target
```

> [!IMPORTANT]
> **Giải thích giới hạn RAM**:
> - `MemoryMax=200M`: Đây là ngưỡng giới hạn cứng — nếu tiến trình tiêu thụ quá 200MB, Linux systemd sẽ tự động kill và restart lại service sau 5 giây. Điều này đảm bảo VPS 2GB không bao giờ bị rò rỉ bộ nhớ hay ảnh hưởng bot chính.
> - `MemoryHigh=150M`: Cảnh báo hệ thống bắt đầu thu hồi trang nhớ đệm khi chạm 150MB.

Nhấn `Ctrl + O` -> `Enter` để lưu, sau đó nhấn `Ctrl + X` để thoát `nano`.

---

### Bước 5: Kích hoạt & Khởi động Service
```bash
# Nạp lại cấu hình systemd
sudo systemctl daemon-reload

# Bật tự khởi động cùng hệ thống khi VPS reboot
sudo systemctl enable anna-lyrics.service

# Khởi động service ngay lập tức
sudo systemctl start anna-lyrics.service
```

---

### Bước 6: Kiểm tra Trạng thái & Xem Log
```bash
# Kiểm tra trạng thái đang chạy (Active: active (running))
sudo systemctl status anna-lyrics.service

# Xem log thời gian thực
sudo journalctl -u anna-lyrics.service -f
```

---

### Bước 7: Cách cập nhật Code khi có thay đổi sau này
Khi bạn pull code mới hoặc chỉnh sửa file trong thư mục `lyrics-service`:
```bash
# Dừng service tạm thời
sudo systemctl stop anna-lyrics.service

# (Cập nhật requirements nếu có thêm thư viện)
cd ~/anna-music-bot/lyrics-service
source venv/bin/activate
pip install -r requirements.txt

# Khởi động lại service
sudo systemctl start anna-lyrics.service
```
