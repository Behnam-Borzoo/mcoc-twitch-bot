import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POINTS_FILE = path.join(__dirname, 'points.json');

function loadPoints() {
  try {
    return JSON.parse(fs.readFileSync(POINTS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function savePoints(data) {
  try {
    fs.writeFileSync(POINTS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('⚠️ Failed to save points.json:', err.message);
  }
}

let points = loadPoints(); // { username: number }
const lastSeen = new Map(); // username -> آخرین زمانی که پیام داده

const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // کسی که توی ۱۰ دقیقه اخیر پیام داده «فعال» حساب میشه

export function markActive(username) {
  lastSeen.set(username, Date.now());
}

export function getPoints(username) {
  return points[username] || 0;
}

export function addPoints(username, amount) {
  points[username] = (points[username] || 0) + amount;
  savePoints(points);
  return points[username];
}

export function removePoints(username, amount) {
  points[username] = Math.max(0, (points[username] || 0) - amount);
  savePoints(points);
  return points[username];
}

export function getLeaderboard(limit = 5) {
  return Object.entries(points)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

// -------------------- امتیاز دوره‌ای به کاربرای فعال --------------------
export function awardPointsToActiveUsers(amount) {
  const now = Date.now();
  let count = 0;
  for (const [username, ts] of lastSeen.entries()) {
    if (now - ts <= ACTIVE_WINDOW_MS) {
      addPoints(username, amount);
      count++;
    }
  }
  return count;
}
