# Anna Music Bot — Lyrics Fallback Service (Python Microservice)

<p align="center">
  <b>🇺🇸 English Documentation</b> • 
  <a href="#-tài-liệu-hướng-dẫn-tiếng-việt"><b>🇻🇳 Bản Tiếng Việt</b></a>
</p>

---

## 🇺🇸 English Documentation

### Overview
An ultra-lightweight microservice running internally on your VPS (`127.0.0.1:8787`), utilizing the `syncedlyrics` library to aggregate synchronized karaoke `.lrc` lyrics from multiple major providers: **Musixmatch, NetEase, Genius, LRCLIB...**

Engineered specifically for **2GB RAM / 1 vCPU VPS**:
- Listens exclusively on local loopback interface `127.0.0.1` (secure, never exposed to the public internet).
- Runs with a single worker (`workers=1`), remaining idle when no requests arrive to minimize memory footprint.
- Enforces a strict memory cap via systemd (`MemoryMax=200M`) to prevent any memory leak from affecting the primary Discord bot.

---

### Setup & Deployment Guide (Ubuntu / Debian)

#### Step 1: Install Python3, pip, and venv
```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv
```

#### Step 2: Create a Dedicated Virtual Environment
Using a virtual environment isolates dependencies and prevents conflicts with system packages:
```bash
cd ~/anna-music-bot/lyrics-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### Step 3: Test Run Manually
Test the service manually before setting up systemd:
```bash
source venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8787 --workers 1
```
In another VPS terminal session, verify with `curl`:
```bash
curl "http://127.0.0.1:8787/lyrics?title=co+em&artist=madihu"
```
If you receive a JSON payload with `syncedLyrics` and `"success": true`, press `Ctrl + C` to stop the manual process and proceed to create the systemd service.

#### Step 4: Configure Systemd Service
Create the systemd service unit file:
```bash
sudo nano /etc/systemd/system/anna-lyrics.service
```
Insert the following configuration (adjust `User` and `WorkingDirectory` if your path differs):
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
> **RAM Protection Strategy**:
> - `MemoryMax=200M`: Hard ceiling. If the process exceeds 200MB, Linux systemd automatically terminates and restarts it within 5 seconds. This guarantees that your 2GB VPS is safe from OOM events.
> - `MemoryHigh=150M`: Warning threshold. The OS begins actively reclaiming cached memory pages once usage hits 150MB.

Save and exit (`Ctrl + O` $\rightarrow$ `Enter`, then `Ctrl + X`).

#### Step 5: Enable & Start the Service
```bash
# Reload systemd daemon
sudo systemctl daemon-reload

# Enable automatic start on system boot
sudo systemctl enable anna-lyrics.service

# Start the service immediately
sudo systemctl start anna-lyrics.service
```

#### Step 6: Status & Real-time Logs
```bash
# Check status (Active: active (running))
sudo systemctl status anna-lyrics.service

# View live real-time logs
sudo journalctl -u anna-lyrics.service -f
```

#### Step 7: Updating Code
When pulling new updates or modifying service files:
```bash
sudo systemctl stop anna-lyrics.service
cd ~/anna-music-bot/lyrics-service
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl start anna-lyrics.service
```

---

## 🇻🇳 Tài Liệu Hướng Dẫn Tiếng Việt

### Giới Thiệu
Microservice siêu nhẹ chạy nội bộ trên VPS (cổng `127.0.0.1:8787`), sử dụng thư viện `syncedlyrics` để gom lời bài hát và lời đồng bộ (Karaoke) từ nhiều nguồn lớn: **Musixmatch, NetEase, Genius, Lrclib...**

Được thiết kế tối ưu riêng cho **VPS 2GB RAM**:
- Chỉ lắng nghe trên giao diện cục bộ `127.0.0.1` (an toàn, không lộ ra internet).
- Chạy với 1 worker duy nhất (`workers=1`), khi không có yêu cầu thì ở trạng thái idle, tiêu thụ cực ít tài nguyên.
- Được giới hạn trần RAM cứng qua systemd (`MemoryMax=200M`) để không bao giờ ảnh hưởng tới bot Discord chính.

---

### Hướng Dẫn Cài Đặt & Triển Khai Trên VPS (Ubuntu / Debian)

#### Bước 1: Kiểm tra và cài đặt Python3 + pip + venv (nếu chưa có)
Mở terminal VPS và chạy lệnh:
```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv
```

#### Bước 2: Tạo Virtual Environment riêng cho service
Sử dụng virtual environment giúp cô lập các package, không xung đột với Python của hệ điều hành:
```bash
cd ~/anna-music-bot/lyrics-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### Bước 3: Kiểm tra chạy thử thủ công
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

#### Bước 4: Tạo file Systemd Service tự động chạy nền
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

#### Bước 5: Kích hoạt & Khởi động Service
```bash
# Nạp lại cấu hình systemd
sudo systemctl daemon-reload

# Bật tự khởi động cùng hệ thống khi VPS reboot
sudo systemctl enable anna-lyrics.service

# Khởi động service ngay lập tức
sudo systemctl start anna-lyrics.service
```

#### Bước 6: Kiểm tra Trạng thái & Xem Log
```bash
# Kiểm tra trạng thái đang chạy (Active: active (running))
sudo systemctl status anna-lyrics.service

# Xem log thời gian thực
sudo journalctl -u anna-lyrics.service -f
```

#### Bước 7: Cách cập nhật Code khi có thay đổi sau này
Khi bạn pull code mới hoặc chỉnh sửa file trong thư mục `lyrics-service`:
```bash
# Dừng service tạm thời
sudo systemctl stop anna-lyrics.service

# Cập nhật requirements nếu có thêm thư viện
cd ~/anna-music-bot/lyrics-service
source venv/bin/activate
pip install -r requirements.txt

# Khởi động lại service
sudo systemctl start anna-lyrics.service
```
