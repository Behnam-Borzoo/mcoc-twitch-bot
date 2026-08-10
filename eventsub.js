import WebSocket from 'ws';

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX_BASE = 'https://api.twitch.tv/helix';

// -------------------- گرفتن آی‌دی کانال از یوزرنیم --------------------
async function getBroadcasterId(login, clientId, accessToken) {
  const res = await fetch(`${HELIX_BASE}/users?login=${encodeURIComponent(login)}`, {
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch broadcaster id: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.data || !data.data.length) throw new Error(`No Twitch user found for login "${login}"`);
  return data.data[0].id;
}

// -------------------- ساخت یه Subscription روی EventSub --------------------
async function createSubscription(type, version, condition, sessionId, clientId, accessToken) {
  const res = await fetch(`${HELIX_BASE}/eventsub/subscriptions`, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type,
      version,
      condition,
      transport: { method: 'websocket', session_id: sessionId },
    }),
  });
  if (!res.ok) {
    console.error(`❌ Failed to subscribe to ${type}:`, res.status, await res.text());
  } else {
    console.log(`✅ Subscribed to ${type}`);
  }
}

// -------------------- شروع اتصال EventSub --------------------
// getAccessToken باید یه تابع async باشه که همیشه توکن تازه برمی‌گردونه (از twitchAuth.js)
export async function startEventSub({ clientId, getAccessToken, channelLogin, onEvent }) {
  const accessToken = await getAccessToken();
  const broadcasterId = await getBroadcasterId(channelLogin, clientId, accessToken);
  console.log(`📡 Broadcaster ID for ${channelLogin}: ${broadcasterId}`);

  function connect() {
    const ws = new WebSocket(EVENTSUB_WS_URL);

    ws.on('open', () => console.log('🔌 EventSub WebSocket connected'));

    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      const type = msg.metadata?.message_type;

      if (type === 'session_welcome') {
        const sessionId = msg.payload.session.id;
        console.log('👋 EventSub session established:', sessionId);

        const freshToken = await getAccessToken();

        await createSubscription(
          'channel.follow',
          '2',
          { broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId },
          sessionId,
          clientId,
          freshToken
        );

        await createSubscription(
          'channel.subscribe',
          '1',
          { broadcaster_user_id: broadcasterId },
          sessionId,
          clientId,
          freshToken
        );
      }

      if (type === 'notification') {
        const eventType = msg.metadata.subscription_type;
        onEvent(eventType, msg.payload.event);
      }

      if (type === 'session_reconnect') {
        const newUrl = msg.payload.session.reconnect_url;
        console.log('🔄 EventSub asked us to reconnect...');
        ws.close();
        const newWs = new WebSocket(newUrl);
        newWs.on('open', () => console.log('🔌 Reconnected to EventSub'));
      }
    });

    ws.on('close', () => {
      console.log('⚠️ EventSub connection closed. Reconnecting in 5s...');
      setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('EventSub WS error:', err.message));
  }

  connect();
}
