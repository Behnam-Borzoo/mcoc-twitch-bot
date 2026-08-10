import tmi from 'tmi.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startEventSub } from './eventsub.js';
import { getAccessToken, ensureFreshToken, startAutoRefresh } from './twitchAuth.js';
import { startPoll, castVote, getTally, endPoll, isPollActive } from './poll.js';
import { recordWin, recordLoss, getRecordText, resetRecord } from './record.js';
import { markActive, getPoints, addPoints, removePoints, getLeaderboard, awardPointsToActiveUsers } from './points.js';
dotenv.config();

// -------------------- تنظیمات --------------------
const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: process.env.TWITCH_OAUTH_TOKEN,
  },
  channels: [process.env.TWITCH_CHANNEL],
});

client.connect().catch(console.error);

// -------------------- خوش‌آمدگویی شروع استریم --------------------
client.on('connected', () => {
  const channel = `#${process.env.TWITCH_CHANNEL}`;
  setTimeout(() => {
    client.say(channel, `👋 Stream is live! Welcome everyone! | خوش اومدید! | Willkommen im Stream!`);
  }, 3000); // یه مکث کوتاه تا اتصال کامل جا بیفته
});

// -------------------- کامندها --------------------
// هر کامند رو اینجا اضافه/ویرایش کن
const commands = {
  '!champ': () => `🦸 Current Champion: ${process.env.CURRENT_CHAMP}`,
  '!rank': () => `⭐ Champion Rank: ${process.env.CURRENT_RANK}`,
  '!bg': () => `⚔️ Battlegrounds season is live! Ask chat for counter suggestions with !counter [champ name]`,
  '!discord': () => `💬 Join the Discord: ${process.env.DISCORD_LINK}`,
  '!commands': () => `Available commands: !champ, !rank, !bg, !discord, !commands, !vote [number], !votes, !record, !points, !leaderboard`,
};

// -------------------- تشخیص خودکار سؤال --------------------
// هر پیامی که شبیه سؤال باشه (فارسی یا انگلیسی) رو تشخیص میده
const QUESTION_WORDS = [
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'should', 'can', 'is', 'do', 'does',
  'کی', 'چی', 'چیه', 'چطور', 'چجوری', 'کدوم', 'آیا', 'چرا', 'چند',
  'wer', 'was', 'wann', 'wo', 'warum', 'wie', 'welche', 'welcher', 'kannst', 'können', 'soll', 'ist',
];

function looksLikeQuestion(text) {
  const t = text.trim().toLowerCase();
  if (t.endsWith('?') || t.endsWith('؟')) return true;
  const firstWord = t.split(/\s+/)[0];
  return QUESTION_WORDS.includes(firstWord);
}

// -------------------- کنترل اسپم (Cooldown) --------------------
const AI_COOLDOWN_MS = Number(process.env.AI_COOLDOWN_SECONDS || 20) * 1000;
const lastAiReplyPerUser = new Map();
let lastGlobalAiReply = 0;

function isOnCooldown(username) {
  const now = Date.now();
  if (now - lastGlobalAiReply < 4000) return true; // حداقل ۴ ثانیه فاصله بین جواب‌ها کلاً
  const last = lastAiReplyPerUser.get(username) || 0;
  return now - last < AI_COOLDOWN_MS;
}

function markReplied(username) {
  const now = Date.now();
  lastGlobalAiReply = now;
  lastAiReplyPerUser.set(username, now);
}

// -------------------- تماس با Claude API --------------------
async function askClaude(question, username) {
  const systemPrompt = `You are a helpful, upbeat Twitch chat assistant for a Marvel Contest of Champions (MCOC) streamer named Behnam (channel: BehnamBorzoo). He mainly plays Battlegrounds and Arena. Current champion in use: ${process.env.CURRENT_CHAMP}, rank: ${process.env.CURRENT_RANK}. Answer the viewer's MCOC-related question directly and concisely. Keep the reply under 350 characters — this is a Twitch chat message, not an essay. No markdown, plain text only. IMPORTANT: Detect the language the viewer wrote in — English, Persian/Farsi, or German are the most common in this chat — and reply in that SAME language. If it's some other language, reply in English. If the question isn't about MCOC or the stream, answer briefly and steer back to the game with light humor.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${username} asks: ${question}` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Claude API error:', response.status, errText);
    return null;
  }

  const data = await response.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

// -------------------- چک کردن اینکه کاربر مدیر/برودکستره --------------------
function isModOrBroadcaster(tags) {
  if (tags.badges && tags.badges.broadcaster) return true;
  return !!tags.mod;
}

// -------------------- مدت‌زمان پیش‌فرض رأی‌گیری (ثانیه) --------------------
const POLL_DURATION_SECONDS = Number(process.env.POLL_DURATION_SECONDS || 60);

client.on('message', async (channel, tags, message, self) => {
  if (self) return; // پیام خود بات رو نادیده بگیر

  const msg = message.trim().toLowerCase();
  const username = tags['display-name'] || tags.username;
  markActive((tags.username || username).toLowerCase());

  // کامندهای ثابت (اولویت با اینهاست)
  if (commands[msg]) {
    client.say(channel, commands[msg]());
    return;
  }

  // -------------------- کامندهای رأی‌گیری --------------------
  if (msg.startsWith('!startvote ')) {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه رأی‌گیری شروع کنه.`);
      return;
    }
    const optionsRaw = message.slice(11).trim();
    const result = startPoll(optionsRaw, POLL_DURATION_SECONDS, (endMessage) => {
      client.say(channel, endMessage);
    });
    client.say(channel, result.ok ? result.message : `⚠️ ${result.error}`);
    return;
  }

  if (msg.startsWith('!vote ')) {
    const num = parseInt(message.slice(6).trim(), 10);
    if (isNaN(num)) return;
    const result = castVote(username, num);
    if (!result.ok && result.error) {
      client.say(channel, `@${username} ${result.error}`);
    }
    // موفق بود یا پول فعال نبود → بی‌سروصدا، برای جلوگیری از اسپم چت
    return;
  }

  if (msg === '!votes') {
    const tally = getTally();
    if (!tally) {
      client.say(channel, 'الان رأی‌گیری‌ای فعال نیست.');
      return;
    }
    const breakdown = tally.map((t) => `${t.option}: ${t.votes}`).join('  |  ');
    client.say(channel, `📊 ${breakdown}`);
    return;
  }

  if (msg === '!endvote') {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه رأی‌گیری رو تموم کنه.`);
      return;
    }
    const result = endPoll();
    client.say(channel, result || 'الان رأی‌گیری‌ای فعال نیست.');
    return;
  }

  // -------------------- کامندهای ردیاب Win/Loss --------------------
  if (msg === '!win') {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه رکورد رو ثبت کنه.`);
      return;
    }
    const { message } = recordWin();
    client.say(channel, message);
    return;
  }

  if (msg === '!loss') {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه رکورد رو ثبت کنه.`);
      return;
    }
    const { message } = recordLoss();
    client.say(channel, message);
    return;
  }

  if (msg === '!record') {
    client.say(channel, getRecordText());
    return;
  }

  if (msg === '!resetrecord') {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه رکورد رو ریست کنه.`);
      return;
    }
    client.say(channel, resetRecord());
    return;
  }

  // -------------------- کامندهای Loyalty Points --------------------
  if (msg === '!points') {
    const userKey = (tags.username || username).toLowerCase();
    client.say(channel, `@${username} امتیاز فعلیت: ${getPoints(userKey)} 🏅`);
    return;
  }

  if (msg === '!leaderboard') {
    const top = getLeaderboard(5);
    if (top.length === 0) {
      client.say(channel, 'هنوز کسی امتیازی نگرفته.');
      return;
    }
    const text = top.map(([user, pts], i) => `${i + 1}. ${user}: ${pts}`).join('  |  ');
    client.say(channel, `🏆 برترین‌ها: ${text}`);
    return;
  }

  if (msg.startsWith('!addpoints ')) {
    if (!isModOrBroadcaster(tags)) return;
    const parts = message.slice(11).trim().split(/\s+/);
    const targetUser = (parts[0] || '').replace('@', '').toLowerCase();
    const amount = parseInt(parts[1], 10);
    if (!targetUser || isNaN(amount)) {
      client.say(channel, 'فرمت درست: !addpoints username 50');
      return;
    }
    const newTotal = addPoints(targetUser, amount);
    client.say(channel, `✅ ${amount} امتیاز به ${targetUser} اضافه شد. امتیاز جدید: ${newTotal}`);
    return;
  }

  if (msg.startsWith('!removepoints ')) {
    if (!isModOrBroadcaster(tags)) return;
    const parts = message.slice(14).trim().split(/\s+/);
    const targetUser = (parts[0] || '').replace('@', '').toLowerCase();
    const amount = parseInt(parts[1], 10);
    if (!targetUser || isNaN(amount)) {
      client.say(channel, 'فرمت درست: !removepoints username 50');
      return;
    }
    const newTotal = removePoints(targetUser, amount);
    client.say(channel, `✅ ${amount} امتیاز از ${targetUser} کم شد. امتیاز جدید: ${newTotal}`);
    return;
  }

  // -------------------- پایان استریم: معرفی فالوورهای جدید و تشکر --------------------
  if (msg === '!endstream') {
    if (!isModOrBroadcaster(tags)) {
      client.say(channel, `@${username} فقط مدیر یا برودکستر می‌تونه این کامند رو بزنه.`);
      return;
    }

    if (newFollowersThisSession.length === 0) {
      client.say(channel, `🙏 Thanks everyone for hanging out today! See you next stream! | ممنون که امروز همراه ما بودید، تا استریم بعدی! | Danke fürs Zuschauen, bis zum nächsten Stream! ❤️`);
      return;
    }

    const names = newFollowersThisSession.join(', ');
    client.say(channel, `🎉 New followers today: ${names} — thank you so much for joining the fam! | فالوورهای جدید امروز: ${names} — خیلی ممنون که به جمع پیوستید! | Neue Follower heute: ${names} — danke, dass ihr dabei seid! 🔥`);

    setTimeout(() => {
      client.say(channel, `🙏 Thanks everyone for an awesome stream — see you next time! | ممنون بابت این استریم عالی، می‌بینمتون دفعه بعد! | Danke für einen tollen Stream — bis zum nächsten Mal! ❤️`);
    }, 2000);

    newFollowersThisSession = [];
    saveNewFollowers(newFollowersThisSession);
    return;
  }

  // سؤال دستی صریح: !ask ...
  if (msg.startsWith('!ask ')) {
    const question = message.slice(5).trim();
    if (isOnCooldown(username)) {
      client.say(channel, `@${username} یکم صبر کن، الان زیاد سؤال جواب داده شده 🙏`);
      return;
    }
    markReplied(username);
    const answer = await askClaude(question, username);
    if (answer) client.say(channel, `@${username} ${answer}`);
    return;
  }

  // تشخیص خودکار: اگه پیام شبیه سؤال بود و کامند نبود
  if (!message.startsWith('!') && looksLikeQuestion(message)) {
    if (isOnCooldown(username)) return; // بی‌سروصدا رد شو، اسپم چت نکنه
    markReplied(username);
    try {
      const answer = await askClaude(message, username);
      if (answer) client.say(channel, `@${username} ${answer}`);
    } catch (err) {
      console.error('AI reply failed:', err);
    }
  }
});

// -------------------- پیام‌های خودکار دوره‌ای --------------------
const autoMessages = [
  `🏆 Behnam is grinding Battlegrounds! Type !bg for info.`,
  `💬 Got a question about MCOC? Just ask in chat!`,
  `👉 Type !commands to see what I can do.`,
];

let autoIndex = 0;
const AUTO_MESSAGE_INTERVAL_MINUTES = 15;

setInterval(() => {
  const channel = `#${process.env.TWITCH_CHANNEL}`;
  client.say(channel, autoMessages[autoIndex]);
  autoIndex = (autoIndex + 1) % autoMessages.length;
}, AUTO_MESSAGE_INTERVAL_MINUTES * 60 * 1000);

// -------------------- امتیازدهی دوره‌ای به کاربرای فعال --------------------
const POINTS_PER_INTERVAL = Number(process.env.POINTS_PER_INTERVAL || 10);
const POINTS_INTERVAL_MINUTES = Number(process.env.POINTS_INTERVAL_MINUTES || 10);

setInterval(() => {
  const count = awardPointsToActiveUsers(POINTS_PER_INTERVAL);
  if (count > 0) console.log(`🏅 ${POINTS_PER_INTERVAL} امتیاز به ${count} کاربر فعال داده شد.`);
}, POINTS_INTERVAL_MINUTES * 60 * 1000);

// -------------------- یادآوری دوره‌ای فالو/حمایت (چندزبانه، چرخشی) --------------------
const followReminders = [
  `🔥 If you're enjoying the stream, a follow means a lot — thanks for hanging out!`,
  `❤️ اگه از استریم لذت می‌برید، یه فالو یادتون نره — خیلی کمک می‌کنه بهم!`,
  `💪 Wenn dir der Stream gefällt, würde mich ein Follow riesig freuen!`,
];
let followReminderIndex = 0;
const FOLLOW_REMINDER_INTERVAL_MINUTES = Number(process.env.FOLLOW_REMINDER_INTERVAL_MINUTES || 20);

setInterval(() => {
  const channel = `#${process.env.TWITCH_CHANNEL}`;
  client.say(channel, followReminders[followReminderIndex]);
  followReminderIndex = (followReminderIndex + 1) % followReminders.length;
}, FOLLOW_REMINDER_INTERVAL_MINUTES * 60 * 1000);

console.log('✅ MCOC Bot is starting...');

// -------------------- ردیابی فالوورهای جدید این سشن (برای معرفی پایان استریم) --------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEW_FOLLOWERS_FILE = path.join(__dirname, 'new_followers.json');

function loadNewFollowers() {
  try {
    return JSON.parse(fs.readFileSync(NEW_FOLLOWERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveNewFollowers(list) {
  try {
    fs.writeFileSync(NEW_FOLLOWERS_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('⚠️ Failed to save new_followers.json:', err.message);
  }
}

let newFollowersThisSession = loadNewFollowers();

// -------------------- Follow / Sub Alerts (EventSub) --------------------
if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN) {
  startEventSub({
    clientId: process.env.TWITCH_CLIENT_ID,
    getAccessToken: ensureFreshToken,
    channelLogin: process.env.TWITCH_CHANNEL,
    onEvent: (type, event) => {
      const channel = `#${process.env.TWITCH_CHANNEL}`;

      if (type === 'channel.follow') {
        newFollowersThisSession.push(event.user_name);
        saveNewFollowers(newFollowersThisSession);
        client.say(channel, `🎉 Welcome ${event.user_name}! Thanks for the follow! 🔥`);
      }

      if (type === 'channel.subscribe') {
        client.say(channel, `⭐ ${event.user_name} just subscribed! Thank you so much! 💪`);
      }
    },
  }).catch((err) => console.error('❌ EventSub failed to start:', err.message));

  // اگه Client Secret و Refresh Token تنظیم شده باشن، هر ۳۰ دقیقه چک می‌کنه که توکن منقضی نشده باشه
  if (process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_REFRESH_TOKEN) {
    startAutoRefresh(30);
    console.log('✅ Auto token refresh فعاله.');
  } else {
    console.log('ℹ️ TWITCH_CLIENT_SECRET / TWITCH_REFRESH_TOKEN تنظیم نشده — باید دستی توکن رو تمدید کنی.');
  }
} else {
  console.log('ℹ️ TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN تنظیم نشده — Follow/Sub alerts غیرفعاله.');
}
