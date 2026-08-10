import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'record.json');

const STREAK_MILESTONES = [3, 5, 10, 15, 20];

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { wins: 0, losses: 0, streak: 0, streakType: null, bestWinStreak: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('⚠️ Failed to save record.json:', err.message);
  }
}

let state = loadState();

// -------------------- ثبت یه Win --------------------
// خروجی: { message, milestoneHit }
export function recordWin() {
  state.wins++;
  if (state.streakType === 'win') {
    state.streak++;
  } else {
    state.streak = 1;
    state.streakType = 'win';
  }
  if (state.streak > state.bestWinStreak) state.bestWinStreak = state.streak;
  saveState(state);

  const milestoneHit = STREAK_MILESTONES.includes(state.streak);
  let message = `✅ Win ثبت شد! رکورد الان: ${state.wins}W - ${state.losses}L`;
  if (milestoneHit) {
    message = `🔥🔥 ${state.streak} برد پشت‌سرهم! ${message}`;
  }
  return { message, milestoneHit };
}

// -------------------- ثبت یه Loss --------------------
export function recordLoss() {
  state.losses++;
  if (state.streakType === 'loss') {
    state.streak++;
  } else {
    state.streak = 1;
    state.streakType = 'loss';
  }
  saveState(state);

  const message = `❌ Loss ثبت شد. رکورد الان: ${state.wins}W - ${state.losses}L`;
  return { message };
}

// -------------------- نمایش رکورد فعلی --------------------
export function getRecordText() {
  const total = state.wins + state.losses;
  const winRate = total > 0 ? ((state.wins / total) * 100).toFixed(0) : 0;
  const streakText =
    state.streak > 1
      ? ` — Streak فعلی: ${state.streak} ${state.streakType === 'win' ? 'برد 🔥' : 'باخت 😬'}`
      : '';
  return `📊 رکورد امروز: ${state.wins}W - ${state.losses}L (${winRate}% Win Rate)${streakText} | بهترین Win Streak: ${state.bestWinStreak}`;
}

// -------------------- ریست کردن رکورد (مثلاً شروع استریم جدید) --------------------
export function resetRecord() {
  state = { wins: 0, losses: 0, streak: 0, streakType: null, bestWinStreak: 0 };
  saveState(state);
  return '🔄 رکورد صفر شد. موفق باشی امروز!';
}
