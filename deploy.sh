#!/bin/bash
# =============================================
# MCOC Twitch Bot VPS
# =============================================
set -e

echo "MCOC Twitch Bot..."
echo ""

# ---------- ۱. نصب Node.js (اگه از قبل نصب نباشه) ----------
if ! command -v node &> /dev/null; then
  echo "Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "Node.js: $(node --version)"
fi

# ---------- ۲. نصب PM2 (اگه از قبل نباشه) ----------
if ! command -v pm2 &> /dev/null; then
  echo "PM2..."
  sudo npm install -g pm2
else
  echo ""
fi

# ---------- ۳. گرفتن آدرس Repo از کاربر ----------
if [ -z "$1" ]; then
  read -p "🔗 آدرس گیت‌هاب ریپوی خودت رو وارد کن (https://github.com/user/repo.git): " REPO_URL
else
  REPO_URL="$1"
fi

PROJECT_DIR="mcoc-twitch-bot"

# ---------- ۴. کلون یا آپدیت پروژه ----------
if [ -d "$PROJECT_DIR" ]; then
  echo "..."
  cd "$PROJECT_DIR"
  git pull
else
  echo "GitHub..."
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# ---------- ۵. نصب پکیج‌ها ----------
echo "..."
npm install

# ---------- ۶. ساخت فایل .env (فقط اگه وجود نداشته باشه) ----------
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo ".env!"
  echo "nano (Token، API Key و...)."
  echo "Enter: Ctrl+X"
  read -p "Enter..." _
  nano .env
else
  echo ".env."
fi

# ---------- ۷. اجرا با PM2 ----------
echo "🚀PM2..."
pm2 start index.js --name mcoc-bot --update-env || pm2 restart mcoc-bot --update-env
pm2 save

# ---------- ۸. راه‌اندازی خودکار بعد از ریبوت سرور ----------
echo ""
echo "Bot"
pm2 startup || true

echo ""
echo "Bot:"
pm2 status

echo ""
echo "pm2 logs mcoc-bot"
echo "pm2 restart mcoc-bot --update-env"
