#!/bin/bash
# ==============================================================================
#  Anna Music Bot - 1-Click Auto VPS Deployer (Ubuntu/Debian)
#  Tự động cài đặt 100% môi trường, kéo code và chạy bot 24/7
# ==============================================================================

set -e

echo -e "\e[01;36m"
echo "=========================================================="
echo "    🚀 ANNA MUSIC BOT - 1-CLICK AUTO VPS INSTALLER       "
echo "=========================================================="
echo -e "\e[00m"

echo -e "\e[01;33m[1/4] Đang cài đặt Node.js 20, FFmpeg, Python và PM2...\e[00m"
export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get update -y
apt-get install -y nodejs ffmpeg git python3 python-is-python3
npm install -g pm2

echo -e "\e[01;33m[2/4] Đang tải mã nguồn bot từ GitHub...\e[00m"
cd /root
if [ -d "anna-music-bot" ]; then
    echo "Thư mục đã tồn tại, đang cập nhật code mới nhất..."
    cd anna-music-bot
    git pull
else
    git clone https://github.com/nguyexndii/anna-music-bot.git
    cd anna-music-bot
fi

echo -e "\e[01;33m[3/4] Đang cài đặt thư viện Node.js...\e[00m"
npm install

# Đổi màu prompt sang Xanh lá & Xanh dương đẹp mắt
if ! grep -q "PS1=" ~/.bashrc; then
    echo 'export PS1="\[\e[01;32m\]\u@\h\[\e[00m\]:\[\e[01;34m\]\w\[\e[00m\]\$ "' >> ~/.bashrc
fi

echo -e "\e[01;33m[4/4] Khởi động Bot chạy 24/7 với PM2...\e[00m"
if [ -f ".env" ]; then
    pm2 delete anna-bot 2>/dev/null || true
    pm2 start src/index.js --name "anna-bot"
    pm2 save
    pm2 startup systemd -u root --hp /root || true
    echo -e "\e[01;32m"
    echo "=========================================================="
    echo "    🎉 CÀI ĐẶT THÀNH CÔNG 100%! BOT ĐÃ ONLINE 24/7!      "
    echo "=========================================================="
    echo -e "\e[00m"
    pm2 status
else
    echo -e "\e[01;33m⚠️ Chưa tìm thấy file .env. Vui lòng tạo file .env bằng lệnh: nano .env\e[00m"
fi
