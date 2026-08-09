import tmi from 'tmi.js';
import dotenv from 'dotenv';
import { startEventSub } from './eventsub.js';
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

// -------------------- کامندها --------------------
// هر کامند رو اینجا اضافه/ویرایش کن
const commands = {
  '!champ': () => `🦸 Current Champion: ${process.env.CURRENT_CHAMP}`,
  '!rank': () => `⭐ Champion Rank: ${process.env.CURRENT_RANK}`,
  '!bg': () => `⚔️ Battlegrounds season is live! Ask chat for counter suggestions with !counter [champ name]`,
  '!discord': () => `💬 Join the Discord: ${process.env.DISCORD_LINK}`,
  '!commands': () => `Available commands: !champ, !rank, !bg, !discord, !commands`,
};

// -------------------- تشخیص خودکار سؤال --------------------
// هر پیامی که شبیه سؤال باشه (فارسی یا انگلیسی) رو تشخیص میده
const QUESTION_WORDS = [
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'should', 'can', 'is', 'do', 'does',
  'کی', 'چی', 'چیه', 'چطور', 'چجوری', 'کدوم', 'آیا', 'چرا', 'چند',
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
  const systemPrompt = `You are a helpful, upbeat Twitch chat assistant for a Marvel Contest of Champions (MCOC) streamer named Behnam (channel: BehnamBorzoo). He mainly plays Battlegrounds and Arena. Current champion in use: ${process.env.CURRENT_CHAMP}, rank: ${process.env.CURRENT_RANK}. Answer the viewer's MCOC-related question directly and concisely. Keep the reply under 350 characters — this is a Twitch chat message, not an essay. No markdown, plain text only. If the question isn't about MCOC or the stream, answer briefly and steer back to the game with light humor.`;

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

client.on('message', async (channel, tags, message, self) => {
  if (self) return; // پیام خود بات رو نادیده بگیر

  const msg = message.trim().toLowerCase();
  const username = tags['display-name'] || tags.username;

  // کامندهای ثابت (اولویت با اینهاست)
  if (commands[msg]) {
    client.say(channel, commands[msg]());
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

console.log('✅ MCOC Bot is starting...');

// -------------------- Follow / Sub Alerts (EventSub) --------------------
if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN) {
  startEventSub({
    clientId: process.env.TWITCH_CLIENT_ID,
    accessToken: process.env.TWITCH_ACCESS_TOKEN,
    channelLogin: process.env.TWITCH_CHANNEL,
    onEvent: (type, event) => {
      const channel = `#${process.env.TWITCH_CHANNEL}`;

      if (type === 'channel.follow') {
        client.say(channel, `🎉 Welcome ${event.user_name}! Thanks for the follow! 🔥`);
      }

      if (type === 'channel.subscribe') {
        client.say(channel, `⭐ ${event.user_name} just subscribed! Thank you so much! 💪`);
      }
    },
  }).catch((err) => console.error('❌ EventSub failed to start:', err.message));
} else {
  console.log('ℹ️ TWITCH_CLIENT_ID / TWITCH_ACCESS_TOKEN تنظیم نشده — Follow/Sub alerts غیرفعاله.');
}
