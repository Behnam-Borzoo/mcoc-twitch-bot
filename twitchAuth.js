import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, 'twitch_token.json');

function loadTokenState() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokenState(state) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('⚠️ Failed to save twitch_token.json:', err.message);
  }
}

// اولین بار از .env می‌خونه، بعدش همیشه از فایل ذخیره‌شده استفاده می‌کنه
let tokenState = loadTokenState();
if (!tokenState) {
  tokenState = {
    access_token: process.env.TWITCH_ACCESS_TOKEN,
    refresh_token: process.env.TWITCH_REFRESH_TOKEN,
    // فرض می‌کنیم توکن اولیه تازه‌ست؛ ۳ ساعت دیگه رفرش میشه (زودتر از انقضای واقعی ۴ ساعته)
    expires_at: Date.now() + 3 * 60 * 60 * 1000,
  };
  saveTokenState(tokenState);
}

async function refreshAccessToken() {
  if (!tokenState.refresh_token || !process.env.TWITCH_CLIENT_SECRET) {
    console.error('⚠️ رفرش توکن ممکن نیست: TWITCH_REFRESH_TOKEN یا TWITCH_CLIENT_SECRET تنظیم نشده.');
    return false;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenState.refresh_token,
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    console.error('❌ Twitch token refresh failed:', res.status, await res.text());
    return false;
  }

  const data = await res.json();
  tokenState = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokenState.refresh_token,
    expires_at: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3 * 60 * 60 * 1000),
  };
  saveTokenState(tokenState);
  console.log('🔄 Twitch access token رفرش شد.');
  return true;
}

export function getAccessToken() {
  return tokenState.access_token;
}

// اگه کمتر از ۱۰ دقیقه به انقضا مونده، رفرشش کن — همیشه توکن معتبر برمی‌گردونه
export async function ensureFreshToken() {
  if (Date.now() > tokenState.expires_at - 10 * 60 * 1000) {
    await refreshAccessToken();
  }
  return tokenState.access_token;
}

export function startAutoRefresh(intervalMinutes = 30) {
  setInterval(() => {
    ensureFreshToken();
  }, intervalMinutes * 60 * 1000);
}

export { refreshAccessToken };
