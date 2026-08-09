#!/bin/bash
# =============================================
# MCOC Twitch Bot — اسکریپت نصب خودکار روی VPS
# =============================================
set -e

echo "شروع نصب MCOC Twitch Bot..."
echo ""

# ---------- ۱. نصب Node.js (اگه از قبل نصب نباشه) ----------
if ! command -v node &> /dev/null; then
  echo "📦 در حال نصب Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "✅ Node.js از قبل نصب است: $(node --version)"
fi

# ---------- ۲. نصب PM2 (اگه از قبل نباشه) ----------
if ! command -v pm2 &> /dev/null; then
  echo "📦 در حال نصب PM2..."
  sudo npm install -g pm2
else
  echo "✅ PM2 از قبل نصب است."
fi

# ---------- ۳. گرفتن آدرس Repo از کاربر ----------
if [ -z "$1" ]; then
  read -p "🔗 آدرس گیت‌هاب ریپوی خودت رو وارد کن (مثلاً https://github.com/Behnam-Borzoo/mcoc-twitch-bot.git): " REPO_URL
else
  REPO_URL="$1"
fi

PROJECT_DIR="mcoc-twitch-bot"

# ---------- ۴. کلون یا آپدیت پروژه ----------
if [ -d "$PROJECT_DIR" ]; then
  echo "📁 پوشه پروژه از قبل هست، آپدیت می‌کنم..."
  cd "$PROJECT_DIR"
  git pull
else
  echo "📥 در حال دانلود پروژه از GitHub..."
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# ---------- ۵. نصب پکیج‌ها ----------
echo "📦 در حال نصب پکیج‌های پروژه..."
npm install

# ---------- ۶. ساخت فایل .env (فقط اگه وجود نداشته باشه) ----------
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  فایل .env ساخته شد ولی هنوز خالیه!"
  echo "⚠️  الان با nano بازش می‌کنم — مقادیر واقعی (Token، API Key و...) رو پر کن."
  echo "⚠️  برای ذخیره: Ctrl+O بعد Enter — برای خروج: Ctrl+X"
  read -p "برای ادامه Enter بزن..." _
  nano .env
else
  echo "✅ فایل .env از قبل موجوده، دست‌نخورده می‌مونه."
fi

# ---------- ۷. اجرا با PM2 ----------
echo "🚀 در حال اجرای Bot با PM2..."
pm2 start index.js --name mcoc-bot --update-env || pm2 restart mcoc-bot --update-env
pm2 save

# ---------- ۸. راه‌اندازی خودکار بعد از ریبوت سرور ----------
echo ""
echo "برای اینکه Bot بعد از ری‌استارت سرور خودش روشن بشه، این دستور رو اجرا کن"
echo "(یه خط بهت میده که باید کپی/پیست و اجرا کنی):"
echo ""
pm2 startup || true

echo ""
echo "✅ تمام شد! وضعیت Bot:"
pm2 status

echo ""
echo "برای دیدن لاگ‌های زنده: pm2 logs mcoc-bot"
echo "برای ری‌استارت کردن بعد از تغییر .env: pm2 restart mcoc-bot --update-env"
