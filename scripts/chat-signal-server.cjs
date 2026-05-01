const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const webpush = require('web-push');
const { WebSocketServer, WebSocket } = require('ws');

const HOST = process.env.CHAT_SIGNAL_HOST || '0.0.0.0';
const PORT = Number(process.env.CHAT_SIGNAL_PORT || 9000);
const PRESENCE_PORT = Number(process.env.CHAT_PRESENCE_PORT || 9001);
const PUSH_STORE_PATH = process.env.CHAT_PUSH_STORE_PATH || '/data/push-subscriptions.json';
const TURN_URL = process.env.CHAT_TURN_URL || '';
const TURN_USERNAME = process.env.CHAT_TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.CHAT_TURN_CREDENTIAL || '';
const PRESENCE_TTL_MS = Number(process.env.CHAT_PRESENCE_TTL_MS || 90000);

const app = express();
const server = http.createServer(app);
const presenceServer = http.createServer();

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

const configuredVapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
};
const vapidKeys = configuredVapid.publicKey && configuredVapid.privateKey
  ? configuredVapid
  : webpush.generateVAPIDKeys();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@poorija.local';

webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);
if (!configuredVapid.publicKey || !configuredVapid.privateKey) {
  console.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY were not provided; using ephemeral keys for this container run.');
}

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'poorija-chat-signal',
    peers: presence.size,
    queuedMessages: Array.from(offlineBoxes.values()).reduce((sum, box) => sum + box.length, 0),
    pushSubscribers: Array.from(pushSubscriptions.values()).reduce((sum, items) => sum + items.length, 0),
    turnEnabled: Boolean(TURN_URL),
    timestamp: new Date().toISOString(),
  });
});

app.get('/chat-health', (req, res) => {
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  const hostname = req.hostname || '127.0.0.1';
  res.json({
    ok: true,
    service: 'poorija-chat-signal',
    peers: presence.size,
    turnEnabled: Boolean(TURN_URL),
    peerOrigin: `${protocol}://${hostname}:${PORT}`,
    presenceUrl: `${wsProtocol}://${hostname}:${PRESENCE_PORT}/chat-signal`,
    timestamp: new Date().toISOString(),
  });
});

app.get('/turn-config', (_req, res) => {
  res.json({
    enabled: Boolean(TURN_URL),
    urls: TURN_URL,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  });
});

app.get('/push/vapid-public-key', (_req, res) => {
  res.json({
    enabled: true,
    publicKey: vapidKeys.publicKey,
  });
});

app.post('/push/subscribe', (req, res) => {
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const subscription = sanitizeSubscription(req.body?.subscription);

  if (!fingerprint || !subscription) {
    res.status(400).json({ ok: false, reason: 'invalid-subscription' });
    return;
  }

  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  const next = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
  next.push({
    ...subscription,
    updatedAt: new Date().toISOString(),
  });
  pushSubscriptions.set(fingerprint, next.slice(-5));
  savePushSubscriptions();
  res.json({ ok: true, count: pushSubscriptions.get(fingerprint).length });
});

app.post('/push/unsubscribe', (req, res) => {
  const fingerprint = sanitizeFingerprint(req.body?.fingerprint);
  const endpoint = String(req.body?.endpoint || '').slice(0, 2048);
  if (!fingerprint || !endpoint) {
    res.status(400).json({ ok: false, reason: 'invalid-unsubscribe' });
    return;
  }

  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  const next = subscriptions.filter((item) => item.endpoint !== endpoint);
  if (next.length) {
    pushSubscriptions.set(fingerprint, next);
  } else {
    pushSubscriptions.delete(fingerprint);
  }
  savePushSubscriptions();
  res.json({ ok: true });
});

const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: true,
  key: 'peerjs',
});
app.use('/peerjs', peerServer);

const presence = new Map();
const offlineBoxes = new Map();
const pushSubscriptions = loadPushSubscriptions();

function touchPresence(record) {
  record.lastSeenAt = Date.now();
  record.updatedAt = new Date(record.lastSeenAt).toISOString();
}

function sanitizeFingerprint(value) {
  return String(value || '').trim().slice(0, 128);
}

function sanitizeSubscription(value) {
  if (!value || typeof value !== 'object') return null;
  const endpoint = String(value.endpoint || '').slice(0, 2048);
  const p256dh = String(value.keys?.p256dh || '').slice(0, 512);
  const auth = String(value.keys?.auth || '').slice(0, 512);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime: value.expirationTime || null,
    keys: { p256dh, auth },
  };
}

function loadPushSubscriptions() {
  try {
    if (!fs.existsSync(PUSH_STORE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(PUSH_STORE_PATH, 'utf8'));
    return new Map(Object.entries(raw || {}).map(([fingerprint, items]) => [
      sanitizeFingerprint(fingerprint),
      Array.isArray(items) ? items.map(sanitizeSubscription).filter(Boolean) : [],
    ]).filter(([fingerprint, items]) => fingerprint && items.length));
  } catch (error) {
    console.error('Failed to load push subscriptions:', error);
    return new Map();
  }
}

function savePushSubscriptions() {
  try {
    fs.mkdirSync(path.dirname(PUSH_STORE_PATH), { recursive: true });
    fs.writeFileSync(PUSH_STORE_PATH, JSON.stringify(Object.fromEntries(pushSubscriptions), null, 2));
  } catch (error) {
    console.error('Failed to save push subscriptions:', error);
  }
}

async function sendPushNotification(toFingerprint, kind = 'chat') {
  const fingerprint = sanitizeFingerprint(toFingerprint);
  const subscriptions = pushSubscriptions.get(fingerprint) || [];
  if (!subscriptions.length) return;

  const payload = JSON.stringify({
    title: 'P00RIJA Cryptography',
    body: kind === 'call-invite'
      ? 'Encrypted call update received.'
      : 'Encrypted chat update received.',
    tag: `poorija-${kind}`,
    url: './#chat',
    data: {
      kind,
      timestamp: Date.now(),
    },
  });

  const remaining = [];
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload);
      remaining.push(subscription);
    } catch (error) {
      if (![404, 410].includes(error?.statusCode)) {
        console.error('Failed to send web push:', error?.statusCode || error?.message || error);
        remaining.push(subscription);
      }
    }
  }));

  if (remaining.length) {
    pushSubscriptions.set(fingerprint, remaining);
  } else {
    pushSubscriptions.delete(fingerprint);
  }
  savePushSubscriptions();
}

function snapshotPeers() {
  return Array.from(presence.values())
    .filter((client) => client.peerId)
    .map((client) => ({
      clientId: client.clientId,
      username: client.username || 'P00RIJA User',
      peerId: client.peerId,
      publicKeyData: client.publicKeyData || '',
      fingerprint: client.fingerprint || '',
      avatarData: client.avatarData || '',
      status: 'online',
      updatedAt: client.updatedAt,
    }));
}

function broadcastPeers() {
  const payload = JSON.stringify({
    type: 'peers',
    peers: snapshotPeers(),
  });

  for (const client of presence.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function safeSend(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

const wsServer = new WebSocketServer({ server: presenceServer, path: '/chat-signal' });

wsServer.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  const record = {
    clientId,
    ws,
    username: '',
    peerId: '',
    publicKeyData: '',
    fingerprint: '',
    avatarData: '',
    updatedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
  };

  presence.set(clientId, record);
  safeSend(ws, { type: 'welcome', clientId });

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_error) {
      safeSend(ws, { type: 'error', reason: 'invalid-json' });
      return;
    }
    touchPresence(record);

    if (message.type === 'hello') {
      record.username = String(message.username || '').slice(0, 80);
      record.peerId = String(message.peerId || '').slice(0, 160);
      record.publicKeyData = String(message.publicKeyData || '');
      record.fingerprint = String(message.fingerprint || '').slice(0, 128);
      record.avatarData = String(message.avatarData || '').slice(0, 700000);
      const queued = offlineBoxes.get(record.fingerprint) || [];
      if (queued.length) {
        for (const item of queued.splice(0, 100)) {
          safeSend(ws, item);
        }
        offlineBoxes.delete(record.fingerprint);
      }
      broadcastPeers();
      return;
    }

    if (message.type === 'relay') {
      const toFingerprint = String(message.toFingerprint || '').slice(0, 128);
      const target = presence.get(String(message.toClientId || '')) ||
        Array.from(presence.values()).find((client) => client.fingerprint && client.fingerprint === toFingerprint);
      if (!target) {
        if (message.persist && toFingerprint) {
          const queued = offlineBoxes.get(toFingerprint) || [];
          const payloadType = String(message.payload?.type || 'chat').slice(0, 80);
          queued.push({
            type: 'relay',
            fromClientId: clientId,
            fromFingerprint: record.fingerprint,
            payload: message.payload || null,
            queuedAt: new Date().toISOString(),
          });
          offlineBoxes.set(toFingerprint, queued.slice(-100));
          safeSend(ws, { type: 'queued', toFingerprint, count: offlineBoxes.get(toFingerprint).length });
          sendPushNotification(toFingerprint, payloadType).catch((error) => console.error(error));
          return;
        }
        safeSend(ws, { type: 'error', reason: 'target-offline', toClientId: message.toClientId || '' });
        return;
      }
      safeSend(target.ws, {
        type: 'relay',
        fromClientId: clientId,
        fromFingerprint: record.fingerprint,
        payload: message.payload || null,
      });
      return;
    }

    if (message.type === 'ping') {
      safeSend(ws, { type: 'pong', timestamp: Date.now() });
    }
  });

  ws.on('close', () => {
    presence.delete(clientId);
    broadcastPeers();
  });

  ws.on('error', () => {
    presence.delete(clientId);
    broadcastPeers();
  });
});

setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const [clientId, record] of presence.entries()) {
    if (record.ws.readyState !== WebSocket.OPEN || now - (record.lastSeenAt || 0) > PRESENCE_TTL_MS) {
      presence.delete(clientId);
      try {
        record.ws.terminate();
      } catch (_error) {
        // The socket may already be closed.
      }
      changed = true;
    }
  }
  if (changed) broadcastPeers();
}, 30000).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`Poorija chat signal server listening on http://${HOST}:${PORT}`);
});

presenceServer.listen(PRESENCE_PORT, HOST, () => {
  console.log(`Poorija chat presence socket listening on ws://${HOST}:${PRESENCE_PORT}/chat-signal`);
});
