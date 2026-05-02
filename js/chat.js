(function () {
  const CHAT_PROFILE_STORAGE_KEY = 'poorija_chat_profile';
  const CHAT_IDENTITY_STORAGE_KEY = 'poorija_chat_identity';
  const CHAT_HISTORY_STORAGE_KEY = 'poorija_chat_history';
  const CHAT_SESSION_KEYS_STORAGE_KEY = 'poorija_chat_session_keys';
  const CHAT_SPACES_STORAGE_KEY = 'poorija_chat_spaces';
  const CHAT_CALLS_STORAGE_KEY = 'poorija_chat_calls';
  const CHAT_CONTACTS_STORAGE_KEY = 'poorija_chat_contacts';
  const FILE_CHUNK_SIZE = 48 * 1024;
  const MAX_FILE_BYTES = 16 * 1024 * 1024;
  const SESSION_READY_TIMEOUT_MS = 8000;

  const chatState = {
    initialized: false,
    profile: {
      name: '',
      serverUrl: '',
      presenceUrl: '',
      peerOrigin: '',
      autoConnect: true,
      allowVideo: true,
      autoDiscovery: false,
      avatarData: '',
      stablePeerId: '',
      turnUrl: '',
      turnUsername: '',
      turnCredential: '',
    },
    identity: null,
    history: {},
    sessionKeys: {},
    spaces: {
      groups: [],
      channels: [],
    },
    calls: [],
    peers: [],
    activePeerClientId: null,
    activeConversationId: '',
    activeView: 'chats',
    searchQuery: '',
    ws: null,
    peer: null,
    peerTransportOrigin: '',
    peerId: '',
    clientId: '',
    connected: false,
    serverReachable: false,
    shouldReconnect: false,
    reconnectTimer: null,
    sessions: new Map(),
    incomingFiles: new Map(),
    currentCall: null,
    pendingIncomingCall: null,
    localStream: null,
    remoteStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    timerSeconds: 0,
    timerPopoverOpen: false,
    activeReactionMessageId: '',
    pendingIncomingInvite: null,
    pendingIncomingAccept: false,
    currentCallMode: 'voice',
    endingCurrentCall: false,
    callMuted: false,
    callHeld: false,
    callSpeakerEnabled: false,
    callVideoEnabled: true,
    callFacingMode: 'user',
    callDisplayMode: 'fullscreen',
    callPrimaryVideo: 'remote',
    floatingCallPosition: {
      x: 24,
      y: 24,
    },
    draggingFloatingCall: false,
    floatingDragOffset: null,
    portalsMounted: false,
    timerPortalMounted: false,
    heartbeatTimer: null,
    reconnectAttempt: 0,
  };

  function app() {
    return window.PoorijaApp;
  }

  function appState() {
    return app()?.state;
  }

  function isUnlocked() {
    return Boolean(appState() && !appState().isLocked && appState().masterPassword);
  }

  function language() {
    return appState()?.language || 'fa';
  }

  function notify(message, type = 'info') {
    app()?.showNotification?.(message, type);
  }

  function t(fa, en) {
    return language() === 'fa' ? fa : en;
  }

  function saveEncrypted(key, value) {
    const helper = app();
    if (!helper) return;
    try {
      localStorage.setItem(key, helper.encryptStorageData(value));
    } catch (error) {
      console.error(error);
    }
  }

  function loadEncrypted(key, fallback) {
    const helper = app();
    const raw = localStorage.getItem(key);
    if (!raw || !helper) return fallback;

    const decrypted = helper.decryptStorageData(raw);
    if (decrypted !== null && decrypted !== undefined) {
      return decrypted;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function chatServerOrigin() {
    const configured = String(chatState.profile.serverUrl || '').trim();
    if (!configured) return window.location.origin;
    try {
      return new URL(configured, window.location.origin).origin;
    } catch (error) {
      return window.location.origin;
    }
  }

  function wsUrl() {
    if (chatState.profile.presenceUrl) {
      return String(chatState.profile.presenceUrl);
    }
    const origin = new URL(chatServerOrigin());
    const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    if (origin.port === '9000') {
      return `${protocol}//${origin.hostname}:9001/chat-signal`;
    }
    return `${protocol}//${origin.host}/chat-signal`;
  }

  function peerTransportOrigin() {
    const configured = String(chatState.profile.peerOrigin || '').trim();
    if (configured) {
      try {
        return new URL(configured, window.location.origin).origin;
      } catch (_error) {
        /* noop */
      }
    }
    return chatServerOrigin();
  }

  function peerOptions() {
    const origin = new URL(peerTransportOrigin());
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];
    if (chatState.profile.turnUrl) {
      iceServers.push({
        urls: chatState.profile.turnUrl,
        username: chatState.profile.turnUsername || undefined,
        credential: chatState.profile.turnCredential || undefined,
      });
    }
    return {
      host: origin.hostname,
      port: origin.port || (origin.protocol === 'https:' ? '443' : '80'),
      path: '/peerjs',
      secure: origin.protocol === 'https:',
      debug: 0,
      config: {
        iceServers,
      },
    };
  }

  function isPrivateIpv4(hostname) {
    const match = String(hostname || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const [first, second] = [Number(match[1]), Number(match[2])];
    return first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }

  function localDiscoveryCandidates(fullScan = false) {
    const seedOrigin = new URL(chatState.profile.serverUrl || window.location.origin, window.location.origin);
    const hostname = seedOrigin.hostname;
    const protocol = seedOrigin.protocol || window.location.protocol || 'http:';
    const ports = Array.from(new Set([
      '9000',
      seedOrigin.port,
      window.location.port,
      '8585',
      protocol === 'https:' ? '443' : '80',
    ].filter(Boolean)));

    const origins = [];
    const pushOrigin = (host, port) => {
      const origin = `${protocol}//${host}${port ? `:${port}` : ''}`;
      if (!origins.includes(origin)) origins.push(origin);
    };

    [hostname, window.location.hostname, '127.0.0.1', 'localhost']
      .filter(Boolean)
      .forEach((host) => {
        ports.forEach((port) => pushOrigin(host, port));
      });

    if (isPrivateIpv4(hostname)) {
      const parts = hostname.split('.').map(Number);
      const base = parts.slice(0, 3).join('.');
      const focus = parts[3];
      const prioritized = [focus, 1, focus - 1, focus + 1, 10, 20, 50, 100]
        .filter((value) => Number.isFinite(value) && value > 0 && value < 255);
      const pool = fullScan
        ? Array.from({ length: 254 }, (_, index) => index + 1)
        : Array.from(new Set([
          ...prioritized,
          ...Array.from({ length: 16 }, (_, index) => focus - 8 + index).filter((value) => value > 0 && value < 255),
        ]));
      pool.forEach((suffix) => {
        ports.forEach((port) => pushOrigin(`${base}.${suffix}`, port));
      });
    }

    return origins;
  }

  async function probeRelayOrigin(origin) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1200);
    try {
      const healthResponse = await fetch(new URL('/chat-health', origin), {
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!healthResponse.ok) return null;
      const health = await healthResponse.json();
      if (!health?.ok || !String(health.service || '').includes('poorija-chat-signal')) return null;
      let turnConfig = null;
      try {
        const turnResponse = await fetch(new URL('/turn-config', origin), {
          mode: 'cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (turnResponse.ok) {
          turnConfig = await turnResponse.json();
        }
      } catch (_error) {
        /* TURN is optional here. */
      }
      return { origin, health, turnConfig };
    } catch (_error) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function discoverLocalRelayServer({ fullScan = false, silent = false } = {}) {
    const candidates = localDiscoveryCandidates(fullScan);
    for (const origin of candidates) {
      const result = await probeRelayOrigin(origin);
      if (!result) continue;
      chatState.profile.serverUrl = result.origin;
      chatState.profile.presenceUrl = String(result.health?.presenceUrl || chatState.profile.presenceUrl || '');
      chatState.profile.peerOrigin = String(result.health?.peerOrigin || chatState.profile.peerOrigin || result.origin);
      if (result.turnConfig?.enabled && result.turnConfig?.urls) {
        chatState.profile.turnUrl = String(result.turnConfig.urls || '');
        chatState.profile.turnUsername = String(result.turnConfig.username || '');
        chatState.profile.turnCredential = String(result.turnConfig.credential || '');
      }
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      renderStaticUi();
      if (!silent) {
        notify(t(`سرور محلی پیدا شد: ${result.origin}`, `Local relay discovered: ${result.origin}`), 'success');
      }
      return result;
    }
    if (!silent) {
      notify(t('سرور محلی پیدا نشد.', 'No local relay server was discovered.'), 'warning');
    }
    return null;
  }

  async function hydrateRelayTurnConfig() {
    const needsTurn = !chatState.profile.turnUrl;
    const needsPresence = !chatState.profile.presenceUrl;
    const needsPeerOrigin = !chatState.profile.peerOrigin;
    if (!needsTurn && !needsPresence && !needsPeerOrigin) return;
    try {
      if (needsPresence || needsPeerOrigin) {
        const healthResponse = await fetch(new URL('/chat-health', chatServerOrigin()), {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (healthResponse.ok) {
          const healthPayload = await healthResponse.json();
          if (healthPayload?.presenceUrl) {
            chatState.profile.presenceUrl = String(healthPayload.presenceUrl);
          }
          if (healthPayload?.peerOrigin) {
            chatState.profile.peerOrigin = String(healthPayload.peerOrigin);
          }
        }
      }
      if (!needsTurn) {
        saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
        renderStaticUi();
        return;
      }
      const response = await fetch(new URL('/turn-config', chatServerOrigin()), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload?.enabled || !payload?.urls) return;
      chatState.profile.turnUrl = String(payload.urls || '');
      chatState.profile.turnUsername = String(payload.username || '');
      chatState.profile.turnCredential = String(payload.credential || '');
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      renderStaticUi();
    } catch (error) {
      console.warn('TURN config was not available:', error);
    }
  }

  function registerChatPush(promptForAccess = false) {
    const fingerprint = chatState.identity?.fingerprint;
    if (!fingerprint) return Promise.resolve({ ok: false, reason: 'missing-fingerprint' });
    return app()?.registerWebPushSubscription?.(fingerprint, chatServerOrigin(), promptForAccess)
      || Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  function generateId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now()}-${random}`;
  }

  function getConversationKey(record) {
    if (!record) return '';
    if (record.conversationId) return record.conversationId;
    return record.fingerprint || record.peerId || record.clientId || '';
  }

  function isSelfPeerRecord(record) {
    if (!record) return false;
    return Boolean(
      (record.clientId && record.clientId === chatState.clientId)
      || (record.peerId && record.peerId === chatState.peerId)
      || (record.fingerprint && chatState.identity?.fingerprint && record.fingerprint === chatState.identity.fingerprint)
    );
  }

  function getPeerHistoryKey(peerRecord, session = null) {
    if (peerRecord) return getConversationKey(peerRecord);
    return session?.conversationId || session?.remoteFingerprint || session?.peerId || '';
  }

  function findPeerByConversationKey(conversationId) {
    if (!conversationId) return null;
    return chatState.peers.find((peer) => (
      getConversationKey(peer) === conversationId
      || peer.peerId === conversationId
      || peer.fingerprint === conversationId
      || peer.clientId === conversationId
    )) || null;
  }

  function buildProfileDraft() {
    return {
      name: document.getElementById('chatProfileName')?.value.trim() || chatState.profile.name,
      serverUrl: document.getElementById('chatServerUrl')?.value.trim() || chatState.profile.serverUrl || window.location.origin,
      autoConnect: Boolean(document.getElementById('chatAutoConnect')?.checked),
      allowVideo: Boolean(document.getElementById('chatAllowVideo')?.checked),
      autoDiscovery: Boolean(document.getElementById('chatAutoDiscovery')?.checked),
      avatarData: chatState.profile.avatarData || '',
      presenceUrl: chatState.profile.presenceUrl || '',
      peerOrigin: chatState.profile.peerOrigin || '',
      stablePeerId: chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-'),
      turnUrl: document.getElementById('chatTurnUrl')?.value.trim() || '',
      turnUsername: document.getElementById('chatTurnUsername')?.value.trim() || '',
      turnCredential: document.getElementById('chatTurnCredential')?.value || '',
    };
  }

  function syncProfileDraftFromInputs() {
    chatState.profile = {
      ...chatState.profile,
      ...buildProfileDraft(),
    };
  }

  function normalizePeerRecord(peer = {}) {
    return {
      clientId: String(peer.clientId || peer.peerId || ''),
      peerId: String(peer.peerId || ''),
      username: String(peer.username || peer.name || ''),
      name: String(peer.name || peer.username || ''),
      publicKeyData: String(peer.publicKeyData || ''),
      fingerprint: String(peer.fingerprint || ''),
      status: String(peer.status || 'offline'),
      avatarData: String(peer.avatarData || ''),
      conversationId: peer.conversationId || '',
      lastSeenAt: peer.lastSeenAt || '',
      type: peer.type || '',
      members: Array.isArray(peer.members) ? [...peer.members] : undefined,
    };
  }

  function saveContacts() {
    const contacts = chatState.peers
      .filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
      .map((peer) => normalizePeerRecord(peer));
    saveEncrypted(CHAT_CONTACTS_STORAGE_KEY, contacts);
  }

  function mergePeerRecord(peer = {}, options = {}) {
    const normalized = normalizePeerRecord(peer);
    if (!normalized.peerId || isSelfPeerRecord(normalized)) return null;
    const existing = chatState.peers.find((item) => (
      (normalized.peerId && item.peerId === normalized.peerId)
      || (normalized.clientId && item.clientId === normalized.clientId)
      || (normalized.fingerprint && item.fingerprint === normalized.fingerprint)
      || (normalized.conversationId && getConversationKey(item) === normalized.conversationId)
    ));
    const lastSeenAt = options.online ? new Date().toISOString() : (normalized.lastSeenAt || existing?.lastSeenAt || '');
    if (existing) {
      Object.assign(existing, {
        ...normalized,
        clientId: normalized.clientId || existing.clientId,
        publicKeyData: normalized.publicKeyData || existing.publicKeyData,
        fingerprint: normalized.fingerprint || existing.fingerprint,
        avatarData: normalized.avatarData || existing.avatarData,
        username: normalized.username || existing.username,
        name: normalized.name || existing.name,
        members: normalized.members || existing.members,
        status: options.online ? 'online' : (normalized.status || existing.status || 'offline'),
        lastSeenAt,
      });
      return existing;
    }
    const record = {
      ...normalized,
      status: options.online ? 'online' : normalized.status || 'offline',
      lastSeenAt,
    };
    chatState.peers.push(record);
    return record;
  }

  function findPeerRecordByPeerId(peerId) {
    if (!peerId) return null;
    return chatState.peers.find((peer) => peer.peerId === peerId) || null;
  }

  function findPeerBySession(session) {
    if (!session) return null;
    return chatState.peers.find((peer) => (
      peer.peerId === session.peerId ||
      peer.fingerprint === session.remoteFingerprint ||
      getConversationKey(peer) === session.conversationId
    )) || null;
  }

  function markPeerUnavailable(peerId, message = '') {
    if (!peerId) return;
    const record = chatState.peers.find((peer) => peer.peerId === peerId);
    let changed = false;
    if (record && record.status !== 'offline') {
      record.status = 'offline';
      record.lastSeenAt = new Date().toISOString();
      changed = true;
      saveContacts();
    }
    if (chatState.activePeerClientId || chatState.activeConversationId) {
      const stillActive = activePeer();
      if (!stillActive) {
        chatState.activePeerClientId = '';
        chatState.activeConversationId = '';
      }
    }
    if (changed) {
      notify(message || t('این کاربر آفلاین شد، اما گفتگو به‌صورت محلی باقی می‌ماند.', 'This peer went offline, but the local conversation remains available.'), 'warning');
      renderPeers();
      renderActivePeer();
    }
  }

  function getActiveConversation() {
    const peer = activePeer();
    if (peer) return peer;
    return [...chatState.spaces.groups, ...chatState.spaces.channels]
      .find((space) => space.conversationId === chatState.activeConversationId) || null;
  }

  function initials(name) {
    const clean = String(name || 'P').trim();
    return clean.slice(0, 1).toUpperCase() || 'P';
  }

  function formatTime(value) {
    try {
      return new Date(value || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_error) {
      return '';
    }
  }

  function formatTimerLabel(seconds) {
    if (!seconds) return t('بدون تایمر', 'No timer');
    if (seconds < 60) return t(`${seconds} ثانیه`, `${seconds}s`);
    if (seconds < 3600) return t(`${Math.round(seconds / 60)} دقیقه`, `${Math.round(seconds / 60)}m`);
    return t(`${Math.round(seconds / 3600)} ساعت`, `${Math.round(seconds / 3600)}h`);
  }

  function formatTimerBadge(seconds) {
    if (!seconds) return '';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  }

  function currentReactorId() {
    return chatState.clientId || chatState.peerId || chatState.identity?.fingerprint || 'local-user';
  }

  function currentReactorCandidates() {
    return new Set([
      chatState.clientId,
      chatState.peerId,
      chatState.identity?.fingerprint,
    ].filter(Boolean));
  }

  function resolveRemoteReactorId(session, message) {
    const localIds = currentReactorCandidates();
    const incomingCandidates = [
      message?.reactorId,
      message?.clientId,
      message?.peerId,
      message?.fingerprint,
    ].filter(Boolean);
    const incoming = incomingCandidates.find((candidate) => !localIds.has(candidate));
    if (incoming) return incoming;
    return session?.remoteClientId || session?.peerId || session?.remoteFingerprint || 'remote-user';
  }

  function normalizeMessageReactions(entry) {
    if (!entry) return {};
    if (entry.reactions && typeof entry.reactions === 'object' && !Array.isArray(entry.reactions)) {
      return { ...entry.reactions };
    }
    if (entry.reaction) {
      return { legacy: entry.reaction };
    }
    return {};
  }

  function summarizeMessageReactions(entry) {
    const reactions = normalizeMessageReactions(entry);
    const tally = new Map();
    Object.values(reactions).forEach((emoji) => {
      if (!emoji) return;
      tally.set(emoji, (tally.get(emoji) || 0) + 1);
    });
    return Array.from(tally.entries()).map(([emoji, count]) => ({ emoji, count }));
  }

  function applyMessageReaction(entry, reaction, reactorId = currentReactorId()) {
    if (!entry || !reactorId) return;
    const reactions = normalizeMessageReactions(entry);
    if (!reaction) delete reactions[reactorId];
    else reactions[reactorId] = reaction;
    entry.reactions = reactions;
    delete entry.reaction;
  }

  function syncTimerUi() {
    const badge = document.getElementById('chatTimerBadge');
    const toggle = document.getElementById('chatTimerToggleBtn');
    const popover = document.getElementById('chatTimerPopover');
    const seconds = Number(chatState.timerSeconds || 0);
    if (badge) {
      badge.textContent = formatTimerBadge(seconds);
      badge.classList.toggle('hidden', !seconds);
    }
    if (toggle) {
      toggle.classList.toggle('active', Boolean(seconds));
      toggle.setAttribute('title', seconds ? formatTimerLabel(seconds) : t('پیام خودتخریب', 'Self-destruct message'));
    }
    if (popover) {
      popover.classList.toggle('hidden', !chatState.timerPopoverOpen);
      popover.querySelectorAll('[data-chat-timer]').forEach((button) => {
        button.classList.toggle('active', Number(button.getAttribute('data-chat-timer') || 0) === seconds);
      });
      if (chatState.timerPopoverOpen) {
        requestAnimationFrame(positionTimerPopover);
      }
    }
  }

  function toggleTimerPopover(force) {
    chatState.timerPopoverOpen = typeof force === 'boolean' ? force : !chatState.timerPopoverOpen;
    syncTimerUi();
  }

  function setTimerSeconds(seconds) {
    chatState.timerSeconds = Number(seconds || 0);
    chatState.timerPopoverOpen = false;
    syncTimerUi();
  }

  function detectComposerDirection(value) {
    const text = String(value || '').trim();
    if (!text) return language() === 'fa' ? 'rtl' : 'ltr';
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)) return 'rtl';
    if (/[A-Za-z]/.test(text)) return 'ltr';
    return language() === 'fa' ? 'rtl' : 'ltr';
  }

  function positionTimerPopover() {
    const popover = document.getElementById('chatTimerPopover');
    const toggle = document.getElementById('chatTimerToggleBtn');
    if (!popover || !toggle || popover.classList.contains('hidden')) return;
    if (document.documentElement.classList.contains('mobile-browser-context')) {
      popover.style.left = '';
      popover.style.top = '';
      popover.style.right = '';
      popover.style.bottom = '';
      return;
    }
    const toggleRect = toggle.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const popWidth = Math.min(popover.offsetWidth || 0, Math.max(0, viewportWidth - 16));
    const left = Math.max(8, Math.min(viewportWidth - popWidth - 8, toggleRect.right - popWidth));
    const preferredTop = toggleRect.top - (popover.offsetHeight || 0) - 10;
    const fallbackTop = toggleRect.bottom + 10;
    const top = preferredTop >= 8
      ? preferredTop
      : Math.min(Math.max(8, fallbackTop), Math.max(8, viewportHeight - (popover.offsetHeight || 0) - 8));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.right = 'auto';
    popover.style.bottom = 'auto';
  }

  function statusLabel(status) {
    if (status === 'seen') return '✓✓';
    if (status === 'opened') return '✓✓';
    if (status === 'delivered') return '✓✓';
    if (status === 'queued') return '⏱';
    if (status === 'failed') return '!';
    return '✓';
  }

  function pruneExpiredHistory() {
    const now = Date.now();
    let changed = false;
    Object.keys(chatState.history).forEach((key) => {
      const next = (chatState.history[key] || []).filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > now);
      if (next.length !== (chatState.history[key] || []).length) {
        chatState.history[key] = next;
        changed = true;
      }
    });
    return changed;
  }

  function saveSessionKeys() {
    saveEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, chatState.sessionKeys);
  }

  async function persistSessionKey(session, rawKey) {
    const key = session.peerId || session.remoteFingerprint;
    if (!key || !rawKey) return;
    const record = {
      rawKey: app().arrayBufferToBase64(rawKey),
      fingerprint: session.remoteFingerprint || '',
      conversationId: session.conversationId || '',
      updatedAt: new Date().toISOString(),
    };
    chatState.sessionKeys[key] = record;
    if (session.remoteFingerprint) chatState.sessionKeys[session.remoteFingerprint] = record;
    if (session.conversationId) chatState.sessionKeys[session.conversationId] = record;
    saveSessionKeys();
  }

  async function hydrateSessionKey(session) {
    const stored = chatState.sessionKeys[session.peerId] || chatState.sessionKeys[session.remoteFingerprint] || chatState.sessionKeys[session.conversationId];
    if (!stored?.rawKey || session.cryptoKey) return;
    session.cryptoKey = await crypto.subtle.importKey(
      'raw',
      app().base64ToArrayBuffer(stored.rawKey),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    session.keyReady = true;
  }

  async function sha256Hex(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function ensureIdentity() {
    if (chatState.identity?.publicKeyData && chatState.identity?.privateKeyData) {
      return chatState.identity;
    }

    const stored = loadEncrypted(CHAT_IDENTITY_STORAGE_KEY, null);
    if (stored?.publicKeyData && stored?.privateKeyData) {
      chatState.identity = stored;
      return stored;
    }

    if (!isUnlocked()) return null;

    const keyPair = await crypto.subtle.generateKey({
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    }, true, ['encrypt', 'decrypt']);

    const exportedPublic = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const exportedPrivate = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const identity = {
      publicKeyData: app().arrayBufferToBase64(exportedPublic),
      privateKeyData: app().arrayBufferToBase64(exportedPrivate),
      fingerprint: await sha256Hex(exportedPublic),
      createdAt: new Date().toISOString(),
    };
    chatState.identity = identity;
    saveEncrypted(CHAT_IDENTITY_STORAGE_KEY, identity);
    return identity;
  }

  async function importIdentityPublicKey(publicKeyData) {
    return crypto.subtle.importKey(
      'spki',
      app().base64ToArrayBuffer(publicKeyData),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  }

  async function importIdentityPrivateKey() {
    const identity = await ensureIdentity();
    return crypto.subtle.importKey(
      'pkcs8',
      app().base64ToArrayBuffer(identity.privateKeyData),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  }

  function activePeer() {
    return chatState.peers.find((peer) => (
      peer.clientId === chatState.activePeerClientId ||
      getConversationKey(peer) === chatState.activeConversationId
    )) || null;
  }

  function activeSession() {
    const peer = activePeer();
    if (!peer) return null;
    return chatState.sessions.get(peer.peerId) || null;
  }

  function isCompactChatLayout() {
    return window.matchMedia?.('(max-width: 1023px)').matches || false;
  }

  function updateChatShellMode() {
    const shell = document.querySelector('.chat-shell');
    if (!shell) return;
    const hasConversation = Boolean(getActiveConversation());
    shell.classList.toggle('chat-has-conversation', hasConversation);
    document.documentElement.classList.toggle('chat-screen-active', appState()?.activeTab === 'chat');
    document.documentElement.classList.toggle('chat-conversation-active', hasConversation);
  }

  function conversationHistory(record) {
    const key = getConversationKey(record);
    return key ? (chatState.history[key] || []) : [];
  }

  function saveSpaces() {
    saveEncrypted(CHAT_SPACES_STORAGE_KEY, chatState.spaces);
  }

  function upsertSharedSpace(space) {
    if (!space?.conversationId || !space?.type) return null;
    const collection = space.type === 'group' ? chatState.spaces.groups : chatState.spaces.channels;
    const existing = collection.find((item) => item.conversationId === space.conversationId);
    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...space,
        members: Array.isArray(space.members) ? [...space.members] : existing.members,
      });
      saveSpaces();
      return existing;
    }
    collection.unshift({
      ...space,
      members: Array.isArray(space.members) ? [...space.members] : [],
    });
    saveSpaces();
    return collection[0];
  }

  function broadcastSpaceRecord(space) {
    if (!space) return;
    chatState.peers
      .filter((peer) => peer.status === 'online' && !peer.type && !isSelfPeerRecord(peer))
      .forEach((peer) => {
        sendRelayEnvelope(peer, {
          type: 'space-sync',
          space,
          createdAt: new Date().toISOString(),
        });
      });
  }

  function saveCalls() {
    saveEncrypted(CHAT_CALLS_STORAGE_KEY, chatState.calls.slice(-80));
  }

  function appendCall(entry) {
    chatState.calls.unshift({
      id: generateId('call'),
      createdAt: new Date().toISOString(),
      ...entry,
    });
    chatState.calls = chatState.calls.slice(0, 80);
    saveCalls();
    renderCalls();
  }

  function formatCallStatus(status) {
    switch (status) {
      case 'missed':
        return t('بی‌پاسخ', 'Missed');
      case 'incoming':
        return t('ورودی', 'Incoming');
      case 'outgoing':
        return t('خروجی', 'Outgoing');
      case 'answered':
        return t('پاسخ داده شد', 'Answered');
      case 'ringing':
        return t('در حال زنگ', 'Ringing');
      case 'failed':
        return t('ناموفق', 'Failed');
      case 'ended':
        return t('پایان‌یافته', 'Ended');
      default:
        return status || '-';
    }
  }

  function isMissedCallStatus(status) {
    return ['missed', 'failed'].includes(String(status || '').toLowerCase());
  }

  function shortSecurityValue(value, lead = 12, tail = 10) {
    const text = String(value || '').trim();
    if (!text || text === '-') return '-';
    if (text.length <= lead + tail + 1) return text;
    return `${text.slice(0, lead)}...${text.slice(-tail)}`;
  }

  function storeHistory() {
    pruneExpiredHistory();
    saveEncrypted(CHAT_HISTORY_STORAGE_KEY, chatState.history);
  }

  function loadPersistedChatState() {
    const savedProfile = loadEncrypted(CHAT_PROFILE_STORAGE_KEY, null);
    if (savedProfile) {
      chatState.profile = { ...chatState.profile, ...savedProfile };
      document.getElementById('chatProfileName').value = chatState.profile.name || '';
      document.getElementById('chatServerUrl').value = chatState.profile.serverUrl || window.location.origin;
    } else {
      chatState.profile.serverUrl = window.location.origin;
      chatState.profile.name = language() === 'fa' ? 'کاربر P00RIJA' : 'P00RIJA User';
    }
    if (!chatState.profile.stablePeerId) {
      chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    }

    const savedHistory = loadEncrypted(CHAT_HISTORY_STORAGE_KEY, {});
    if (savedHistory && typeof savedHistory === 'object') {
      chatState.history = savedHistory;
    }
    const savedSessionKeys = loadEncrypted(CHAT_SESSION_KEYS_STORAGE_KEY, {});
    if (savedSessionKeys && typeof savedSessionKeys === 'object') {
      chatState.sessionKeys = savedSessionKeys;
    }
    const savedSpaces = loadEncrypted(CHAT_SPACES_STORAGE_KEY, null);
    if (savedSpaces?.groups || savedSpaces?.channels) {
      chatState.spaces = {
        groups: Array.isArray(savedSpaces.groups) ? savedSpaces.groups : [],
        channels: Array.isArray(savedSpaces.channels) ? savedSpaces.channels : [],
      };
    }
    const savedCalls = loadEncrypted(CHAT_CALLS_STORAGE_KEY, []);
    if (Array.isArray(savedCalls)) {
      chatState.calls = savedCalls.slice(-80);
    }
    const savedContacts = loadEncrypted(CHAT_CONTACTS_STORAGE_KEY, []);
    if (Array.isArray(savedContacts) && savedContacts.length) {
      chatState.peers = savedContacts
        .map((peer) => normalizePeerRecord(peer))
        .filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
        .map((peer) => ({
          ...peer,
          status: peer.status || 'offline',
        }));
    }
  }

  function saveProfile() {
    const profile = buildProfileDraft();
    chatState.profile = profile;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, profile);
    renderStaticUi();
    broadcastHello();
    notify(t('پروفایل چت ذخیره شد', 'Chat profile saved'), 'success');
  }

  function sessionSecurityText(session) {
    if (!session?.cryptoKey) {
      return t('منتظر تبادل کلید RSA -> AES-GCM', 'Waiting for RSA -> AES-GCM key exchange');
    }
    return t('RSA-OAEP-3072 + AES-256-GCM', 'RSA-OAEP-3072 + AES-256-GCM');
  }

  function setConnectionState(connected, label) {
    chatState.connected = connected;
    const dot = document.getElementById('chatConnectionDot');
    const status = document.getElementById('chatConnectionStatus');
    if (dot) {
      dot.classList.toggle('online', connected);
    }
    if (status) {
      status.textContent = connected ? t('متصل', 'Connected') : t('عدم اتصال', 'Disconnected');
      status.title = label || '';
    }
  }

  function syncComposerDirection() {
    const composer = document.getElementById('chatComposer');
    if (!composer) return;
    const nextDir = detectComposerDirection(composer.value);
    composer.dir = nextDir;
    composer.style.textAlign = nextDir === 'rtl' ? 'right' : 'left';
  }

  function syncComposerViewportFocus(focused = false) {
    const shouldFocus = Boolean(focused && isCompactChatLayout() && appState()?.activeTab === 'chat');
    document.documentElement.classList.toggle('chat-composer-focused', shouldFocus);
    if (!shouldFocus) {
      document.getElementById('content-chat')?.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const syncFocusLayout = () => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
      document.getElementById('content-chat')?.scrollTo({ top: 0, behavior: 'auto' });
      const panel = document.getElementById('chatMessages');
      panel?.scrollTo({ top: panel.scrollHeight, behavior: 'auto' });
      document.querySelector('.chat-composer-bar')?.scrollIntoView({ block: 'end', inline: 'nearest' });
      document.getElementById('chatComposer')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    };
    window.setTimeout(syncFocusLayout, 40);
    window.setTimeout(syncFocusLayout, 180);
  }

  function renderStaticUi() {
    if (!document.getElementById('content-chat')) return;

    document.getElementById('chatProfileName').value = chatState.profile.name || '';
    document.getElementById('chatProfileName').placeholder = t('نام نمایشی', 'Display name');
    document.getElementById('chatServerUrl').value = chatState.profile.serverUrl || window.location.origin;
    document.getElementById('chatAutoConnect').checked = Boolean(chatState.profile.autoConnect);
    document.getElementById('chatAllowVideo').checked = Boolean(chatState.profile.allowVideo);
    document.getElementById('chatAutoDiscovery').checked = Boolean(chatState.profile.autoDiscovery);
    document.getElementById('chatTurnUrl').value = chatState.profile.turnUrl || '';
    document.getElementById('chatTurnUsername').value = chatState.profile.turnUsername || '';
    document.getElementById('chatTurnCredential').value = chatState.profile.turnCredential || '';
    document.getElementById('chatSearchInput').placeholder = t('جستجو در چت‌ها و پیام‌ها', 'Search chats and messages');
    document.getElementById('chatComposer').placeholder = t('پیام رمزنگاری‌شده بنویسید...', 'Write an encrypted message...');
    document.getElementById('chatTimerToggleBtn')?.setAttribute('title', t('پیام خودتخریب', 'Self-destruct message'));
    const controlLabels = {
      chatStartSessionBtn: t('ساخت سشن امن', 'Create secure session'),
      chatVoiceCallBtn: t('تماس صوتی', 'Voice call'),
      chatVideoCallBtn: t('تماس تصویری', 'Video call'),
      chatEndCallBtn: t('پایان تماس', 'End call'),
      chatSendMessageBtn: t('ارسال', 'Send'),
      chatSendFileBtn: t('ارسال فایل', 'Send file'),
      chatVoiceMessageBtn: t('پیام صوتی', 'Voice message'),
      chatMinimizeCallBtn: t('بازگشت به چت / حالت شناور', 'Return to chat / floating mode'),
      chatFloatingEndCallBtn: t('پایان تماس', 'End call'),
      chatSpeakerToggleBtn: t('اسپیکر', 'Speaker'),
      chatHoldToggleBtn: t('هولد', 'Hold'),
      chatMuteToggleBtn: t('بی‌صدا', 'Mute'),
      chatSwapVideoLayoutBtn: t('جابجایی', 'View'),
      chatFlipCameraBtn: t('چرخش', 'Flip'),
      chatVideoToggleBtn: t('ویدیو', 'Video'),
      chatEndCallControlBtn: t('پایان', 'End'),
    };
    Object.entries(controlLabels).forEach(([id, label]) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.setAttribute('title', label);
      const textNode = button.querySelector('span');
      if (textNode) textNode.textContent = label;
    });
    const localPeerId = chatState.peerId || chatState.clientId || '-';
    const localFingerprint = chatState.identity?.fingerprint || '-';
    document.getElementById('chatPeerId').textContent = shortSecurityValue(localPeerId);
    document.getElementById('chatPeerId').title = localPeerId;
    document.getElementById('chatFingerprint').textContent = shortSecurityValue(localFingerprint);
    document.getElementById('chatFingerprint').title = localFingerprint;
    document.getElementById('chatServerMeta').textContent = t(
      `Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`,
      `Signal: ${chatServerOrigin()} | WebSocket: ${wsUrl()}`
    );
    const avatarText = document.getElementById('chatProfileAvatarText');
    const avatarImage = document.getElementById('chatProfileAvatarImage');
    if (avatarText) avatarText.textContent = initials(chatState.profile.name);
    if (avatarImage) {
      avatarImage.src = chatState.profile.avatarData || '';
      avatarImage.classList.toggle('hidden', !chatState.profile.avatarData);
      avatarText?.classList.toggle('hidden', Boolean(chatState.profile.avatarData));
    }
    syncComposerDirection();
  }

  function renderPeers() {
    const list = document.getElementById('chatPeerList');
    const count = document.getElementById('chatPeerCount');
    if (!list || !count) return;

    const query = chatState.searchQuery.trim().toLowerCase();
    const allPeers = chatState.peers
      .filter((peer) => peer.peerId && !isSelfPeerRecord(peer))
      .sort((left, right) => {
        const leftOnline = left.status === 'online' ? 1 : 0;
        const rightOnline = right.status === 'online' ? 1 : 0;
        if (leftOnline !== rightOnline) return rightOnline - leftOnline;
        const leftStamp = new Date((conversationHistory(left).slice(-1)[0]?.createdAt) || left.lastSeenAt || 0).getTime();
        const rightStamp = new Date((conversationHistory(right).slice(-1)[0]?.createdAt) || right.lastSeenAt || 0).getTime();
        return rightStamp - leftStamp;
      });
    const onlinePeers = allPeers.filter((peer) => peer.status === 'online');
    if ((chatState.activePeerClientId || chatState.activeConversationId) && !activePeer() && chatState.activeView === 'chats') {
      chatState.activePeerClientId = '';
      chatState.activeConversationId = '';
    }
    if (!isCompactChatLayout() && chatState.activeView === 'chats' && !chatState.activePeerClientId && !chatState.activeConversationId && (onlinePeers.length || allPeers.length)) {
      const seedPeer = onlinePeers[0] || allPeers[0];
      if (seedPeer) {
        chatState.activePeerClientId = seedPeer.clientId;
        chatState.activeConversationId = getConversationKey(seedPeer);
      }
    }
    let records = allPeers;
    let title = t('چت‌ها', 'Chats');

    if (chatState.activeView === 'groups') {
      records = chatState.spaces.groups;
      title = t('گروه‌ها', 'Groups');
    } else if (chatState.activeView === 'channels') {
      records = chatState.spaces.channels;
      title = t('کانال‌ها', 'Channels');
    } else if (chatState.activeView === 'calls') {
      renderCalls();
      return;
    }

    if (query) {
      records = records.filter((record) => {
        const haystack = [
          record.username,
          record.name,
          record.peerId,
          record.fingerprint,
          ...conversationHistory(record).map((entry) => entry.text || entry.name || ''),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    document.getElementById('chatListTitle').textContent = title;
    count.textContent = chatState.activeView === 'chats'
      ? t(`${onlinePeers.length} آنلاین`, `${onlinePeers.length} online`)
      : String(records.length);

    if (!records.length) {
      list.innerHTML = `<div class="chat-empty-state">${query ? t('چیزی پیدا نشد.', 'No results found.') : t('هنوز موردی وجود ندارد.', 'Nothing here yet.')}</div>`;
      return;
    }

    list.innerHTML = records.map((record) => {
      const key = getConversationKey(record);
      const history = conversationHistory(record);
      const last = history[history.length - 1];
      const displayName = record.username || record.name || record.clientId || key;
      const active = key === chatState.activeConversationId || record.clientId === chatState.activePeerClientId;
      const isSecure = Boolean(record.type !== 'channel' && (chatState.sessions.get(record.peerId)?.cryptoKey || chatState.sessionKeys[record.peerId] || chatState.sessionKeys[record.fingerprint]));
      const online = record.status === 'online';
      const previewLine = last?.text
        || last?.name
        || (record.type === 'group' ? t('گروه محلی', 'Local group') : '')
        || (record.type === 'channel' ? t('کانال محلی', 'Local channel') : '')
        || (online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline'));
      return `
      <button type="button" data-chat-conversation="${app().escapeHTML(key)}" data-chat-peer="${app().escapeHTML(record.clientId || '')}" class="chat-peer-card w-full text-right ${active ? 'active' : ''}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="chat-avatar chat-peer-avatar ${online ? 'online' : 'offline'}">${record.avatarData ? `<img src="${record.avatarData}" alt="">` : app().escapeHTML(initials(displayName))}</div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2 min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <span class="chat-peer-presence-dot ${online ? 'online' : 'offline'}" aria-hidden="true"></span>
                <div class="font-semibold text-white truncate">${app().escapeHTML(displayName)}</div>
                ${isSecure ? '<span class="text-emerald-300 text-xs"><i class="fas fa-lock"></i></span>' : ''}
              </div>
              <span class="chat-peer-status-badge ${online ? 'online' : 'offline'}">${online ? t('متصل', 'Connected') : t('عدم اتصال', 'Offline')}</span>
            </div>
            <div class="flex items-center justify-between gap-3 min-w-0 mt-1">
              <div class="text-xs text-slate-400 truncate">${app().escapeHTML(previewLine)}</div>
              <span class="text-[11px] text-slate-500 shrink-0">${last ? formatTime(last.createdAt) : (record.lastSeenAt ? formatTime(record.lastSeenAt) : '')}</span>
            </div>
          </div>
        </div>
      </button>
    `;
    }).join('');

    list.querySelectorAll('[data-chat-conversation]').forEach((button) => {
      button.addEventListener('click', () => {
        chatState.activePeerClientId = button.getAttribute('data-chat-peer');
        chatState.activeConversationId = button.getAttribute('data-chat-conversation');
        updateChatShellMode();
        renderPeers();
        renderActivePeer();
      });
    });
  }

  function renderCalls() {
    const list = document.getElementById('chatPeerList');
    const callsPanelList = document.getElementById('chatCallsList');
    const count = document.getElementById('chatPeerCount');
    const title = document.getElementById('chatListTitle');
    if (title) title.textContent = t('تماس‌ها', 'Calls');
    if (count) count.textContent = String(chatState.calls.length);

    const groups = new Map();
    chatState.calls.forEach((call) => {
      const key = call.peerId || call.name || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(call);
    });

    const rows = groups.size
      ? Array.from(groups.values()).map((items) => {
        const latest = items[0];
        const missedCount = items.filter((call) => isMissedCallStatus(call.status)).length;
        const modeLabel = latest.mode === 'video' ? t('تصویری', 'Video') : t('صوتی', 'Voice');
        return `
          <details class="chat-call-accordion"${missedCount ? ' open' : ''}>
            <summary class="chat-peer-card chat-call-summary ${isMissedCallStatus(latest.status) ? 'missed' : ''}">
              <div class="min-w-0">
                <div class="font-semibold text-white truncate">${app().escapeHTML(latest.name || latest.peerId || '-')}</div>
                <div class="text-xs mt-1 ${isMissedCallStatus(latest.status) ? 'text-rose-300' : 'text-slate-400'}">
                  ${app().escapeHTML(modeLabel)} · ${app().escapeHTML(formatCallStatus(latest.status))}
                  ${missedCount ? ` · ${app().escapeHTML(t(`${missedCount} بی‌پاسخ`, `${missedCount} missed`))}` : ''}
                </div>
              </div>
              <div class="chat-call-summary-meta">
                <span class="text-xs text-slate-500">${formatTime(latest.createdAt)}</span>
                <span class="chat-call-count">${items.length}</span>
              </div>
            </summary>
            <div class="chat-call-accordion-body">
              ${items.map((call) => `
                <div class="chat-call-log-row ${isMissedCallStatus(call.status) ? 'missed' : ''}">
                  <div class="min-w-0">
                    <div class="text-sm text-white truncate">${app().escapeHTML(call.mode === 'video' ? t('تماس تصویری', 'Video call') : t('تماس صوتی', 'Voice call'))}</div>
                    <div class="text-xs ${isMissedCallStatus(call.status) ? 'text-rose-300' : 'text-slate-400'}">${app().escapeHTML(formatCallStatus(call.status))}</div>
                  </div>
                  <span class="text-xs text-slate-500">${formatTime(call.createdAt)}</span>
                </div>
              `).join('')}
            </div>
          </details>
        `;
      }).join('')
      : `<div class="chat-empty-state">${t('هنوز تماسی ثبت نشده است.', 'No calls yet.')}</div>`;

    if (list) list.innerHTML = rows;
    if (callsPanelList) callsPanelList.innerHTML = rows;
  }

  function renderMessages() {
    pruneExpiredHistory();
    const peer = getActiveConversation();
    const directPeer = activePeer();
    const panel = document.getElementById('chatMessages');
    if (!panel) return;
    if (!peer) {
      panel.innerHTML = `<div class="chat-empty-state">${t('بعد از انتخاب یک گفتگو، تاریخچه همین‌جا نشان داده می‌شود.', 'Pick a conversation to view history here.')}</div>`;
      return;
    }

    const conversationKey = getConversationKey(peer);
    const history = (chatState.history[conversationKey] || []).filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > Date.now());
    if (!history.length) {
      panel.innerHTML = `<div class="chat-empty-state">${t('هنوز پیامی ردوبدل نشده است.', 'No messages exchanged yet.')}</div>`;
      return;
    }

    const myReactorId = currentReactorId();
    panel.innerHTML = history.map((entry) => {
      const meta = `
        <div class="chat-message-meta">
          <span>${formatTime(entry.createdAt)}</span>
          ${entry.expiresAt ? `<span><i class="fas fa-stopwatch"></i> ${formatTime(entry.expiresAt)}</span>` : ''}
          ${entry.direction === 'out' ? `<span>${statusLabel(entry.status)}</span>` : ''}
        </div>`;
      const reactionSummary = summarizeMessageReactions(entry);
      const myReaction = normalizeMessageReactions(entry)[myReactorId] || '';
      const pickerOpen = chatState.activeReactionMessageId === entry.id;
      const reactionSummaryHtml = reactionSummary.length
        ? `<div class="chat-reaction-summary">
            ${reactionSummary.map(({ emoji, count }) => `
              <button type="button" data-chat-reaction-choice="${entry.id}" data-reaction="${emoji}" class="chat-reaction-chip ${myReaction === emoji ? 'active' : ''}">
                <span>${emoji}</span>
                ${count > 1 ? `<span class="chat-reaction-count">${count}</span>` : ''}
              </button>
            `).join('')}
          </div>`
        : '';
      const deleteButton = `<button type="button" data-chat-delete-message="${entry.id}" class="chat-message-delete" title="${app().escapeHTML(t('حذف پیام', 'Delete message'))}">
          <i class="fas fa-trash"></i>
        </button>`;
      const reactionToolbar = `
        <div class="chat-message-toolbar">
          <button type="button" data-chat-toggle-reaction="${entry.id}" class="chat-message-icon-btn ${pickerOpen ? 'active' : ''}" title="${app().escapeHTML(t('ری‌اکشن', 'React'))}">
            <i class="far fa-face-smile"></i>
          </button>
          ${deleteButton}
        </div>
        ${pickerOpen ? `
          <div class="chat-reaction-picker">
            ${['👍', '❤️', '🔥', '😂', '😮', '😢'].map((emoji) => `
              <button type="button" data-chat-reaction-choice="${entry.id}" data-reaction="${emoji}" class="${myReaction === emoji ? 'active' : ''}">
                ${emoji}
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${reactionSummaryHtml}
      `;
      if (entry.type === 'voice') {
        return `
          <div class="chat-message-bubble ${entry.direction === 'out' ? 'me' : 'them'} ${entry.expiresAt ? 'expiring' : ''}">
            <div class="chat-voice-message">
              <div class="font-semibold">${t('پیام صوتی رمزنگاری‌شده', 'Encrypted voice message')}</div>
              ${entry.downloadUrl ? `<audio controls src="${entry.downloadUrl}"></audio>` : `<div class="text-xs text-slate-400">${t('فایل صوتی در این دستگاه ذخیره نشده است.', 'Voice payload is not stored on this device.')}</div>`}
            </div>
            ${reactionToolbar}
            ${meta}
          </div>
        `;
      }

      if (entry.type === 'file') {
        return `
          <div class="chat-message-bubble ${entry.direction === 'out' ? 'me' : 'them'} ${entry.expiresAt ? 'expiring' : ''}">
            <div class="font-semibold mb-2">${t('فایل رمزنگاری‌شده', 'Encrypted file')}</div>
            <div class="text-sm">${app().escapeHTML(entry.name || 'file.bin')}</div>
            <div class="text-xs text-slate-400 mt-1">${entry.size || 0} B</div>
            ${entry.downloadUrl ? `<a href="${entry.downloadUrl}" download="${app().escapeHTML(entry.name || 'file.bin')}" data-chat-download-message="${entry.id}" class="inline-flex mt-3 px-3 py-2 rounded-xl bg-sky-500 text-white text-sm">${t('دانلود فایل', 'Download file')}</a>` : ''}
            ${reactionToolbar}
            ${meta}
          </div>
        `;
      }

      return `
        <div class="chat-message-bubble ${entry.direction === 'out' ? 'me' : 'them'} ${entry.expiresAt ? 'expiring' : ''}">
          <div class="text-sm whitespace-pre-wrap">${app().escapeHTML(entry.text || '')}</div>
          ${reactionToolbar}
          ${meta}
        </div>
      `;
    }).join('');

    panel.querySelectorAll('[data-chat-toggle-reaction]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entryId = button.getAttribute('data-chat-toggle-reaction') || '';
        chatState.activeReactionMessageId = chatState.activeReactionMessageId === entryId ? '' : entryId;
        renderMessages();
      });
    });

    panel.querySelectorAll('[data-chat-reaction-choice]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entryId = button.getAttribute('data-chat-reaction-choice');
        const reaction = button.getAttribute('data-reaction') || '';
        const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
        if (!entry) return;
        const currentReaction = normalizeMessageReactions(entry)[myReactorId] || '';
        const nextReaction = currentReaction === reaction ? '' : reaction;
        applyMessageReaction(entry, nextReaction, myReactorId);
        chatState.activeReactionMessageId = '';
        if (peer && !peer.type && directPeer) {
          relaySessionEvent(directPeer, {
            type: 'reaction',
            messageId: entryId,
            reaction: nextReaction,
            reactorId: myReactorId,
            clientId: chatState.clientId || '',
            peerId: chatState.peerId || '',
            fingerprint: chatState.identity?.fingerprint || '',
            createdAt: new Date().toISOString(),
          });
        }
        storeHistory();
        renderPeers();
        renderMessages();
      });
    });

    panel.querySelectorAll('[data-chat-delete-message]').forEach((button) => {
      button.addEventListener('click', () => {
        const entryId = button.getAttribute('data-chat-delete-message');
        if (!entryId) return;
        chatState.activeReactionMessageId = '';
        deleteMessageEntry(conversationKey, entryId, { broadcast: Boolean(!peer.type), peerRecord: directPeer });
      });
    });

    panel.querySelectorAll('[data-chat-download-message]').forEach((link) => {
      link.addEventListener('click', () => {
        const entryId = link.getAttribute('data-chat-download-message') || '';
        const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
        if (entry) {
          entry.status = 'opened';
          storeHistory();
          renderMessages();
        }
        if (entryId && peer && !peer.type && directPeer) {
          relaySessionEvent(directPeer, {
            type: 'receipt',
            messageId: entryId,
            status: 'opened',
            createdAt: new Date().toISOString(),
          });
        }
      });
    });

    panel.scrollTop = panel.scrollHeight;
  }

  function renderActivePeer() {
    updateChatShellMode();
    const peer = getActiveConversation();
    const directPeer = activePeer();
    const session = activeSession();
    const thread = document.querySelector('.chat-thread');
    const composerBar = document.querySelector('.chat-composer-bar');
    const securityDrawer = document.querySelector('.chat-security-drawer');
    const peerName = document.getElementById('chatActivePeerName');
    const peerMeta = document.getElementById('chatActivePeerMeta');
    const banner = document.getElementById('chatSessionBanner');
    const remoteFingerprint = document.getElementById('chatRemoteFingerprint');
    const keyMode = document.getElementById('chatSecurityKeyMode');
    const connectBtn = document.getElementById('chatStartSessionBtn');
    const sendBtn = document.getElementById('chatSendMessageBtn');
    const sendFileBtn = document.getElementById('chatSendFileBtn');
    const voiceMessageBtn = document.getElementById('chatVoiceMessageBtn');
    const voiceBtn = document.getElementById('chatVoiceCallBtn');
    const videoBtn = document.getElementById('chatVideoCallBtn');

    if (!peer) {
      peerName.textContent = t('یک کاربر را انتخاب کنید', 'Select a peer');
      peerMeta.textContent = t('برای شروع سشن امن و چت، یکی از کاربران آنلاین را انتخاب کنید.', 'Choose one of the online peers to start a secure session.');
      banner.classList.add('hidden');
      composerBar?.classList.add('hidden');
      securityDrawer?.classList.add('hidden');
      thread?.classList.add('chat-thread-empty');
      remoteFingerprint.textContent = '-';
      keyMode.textContent = t('منتظر سشن', 'Waiting for session');
      connectBtn.disabled = true;
      sendBtn.disabled = true;
      sendFileBtn.disabled = true;
      if (voiceMessageBtn) voiceMessageBtn.disabled = true;
      voiceBtn.disabled = true;
      videoBtn.disabled = true;
      renderMessages();
      return;
    }

    const displayName = peer.username || peer.name || peer.peerId;
    const busy = isCallBusy();
    const directPeerOnline = !peer.type ? peer.status === 'online' : true;
    composerBar?.classList.toggle('hidden', chatState.activeView === 'calls');
    securityDrawer?.classList.remove('hidden');
    thread?.classList.remove('chat-thread-empty');
    peerName.textContent = displayName;
    peerMeta.textContent = peer.type
      ? `${peer.type} • ${t('فضای امن محلی', 'Local secure space')}`
      : `${t('وضعیت', 'Status')}: ${peer.status === 'online' ? t('آنلاین', 'Online') : t('آفلاین', 'Offline')} • ${t('چت رمزنگاری‌شده', 'Encrypted chat')}`;
    const activeAvatar = document.getElementById('chatActiveAvatar');
    if (activeAvatar) {
      activeAvatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(displayName));
    }
    remoteFingerprint.textContent = shortSecurityValue(peer.fingerprint || peer.conversationId || '-');
    remoteFingerprint.title = peer.fingerprint || peer.conversationId || '-';
    keyMode.textContent = sessionSecurityText(session);
    connectBtn.disabled = Boolean(peer.type) || !chatState.connected || !chatState.peer;
    sendBtn.disabled = Boolean(!peer.type && (!chatState.connected || !chatState.peer));
    sendFileBtn.disabled = Boolean(!peer.type && (!chatState.connected || !chatState.peer || !directPeerOnline));
    if (voiceMessageBtn) voiceMessageBtn.disabled = Boolean(!peer.type && (!chatState.connected || !chatState.peer || !directPeerOnline));
    voiceBtn.disabled = busy || Boolean(peer.type === 'channel') || !chatState.connected || !chatState.peer || !directPeerOnline;
    videoBtn.disabled = busy || Boolean(peer.type === 'channel') || !chatState.connected || !chatState.peer || !directPeerOnline || !chatState.profile.allowVideo;
    document.getElementById('chatSecureBadge')?.classList.toggle('hidden', !(peer.type || session?.cryptoKey));

    if (session?.cryptoKey) {
      banner.textContent = t('سشن رمزنگاری فعال است و پیام‌ها روی AES-GCM رمز می‌شوند.', 'An encrypted session is active and messages are protected with AES-GCM.');
      banner.classList.remove('hidden');
    } else if (peer.type) {
      banner.textContent = peer.type === 'channel'
        ? t('کانال محلی ساخته شد. پیام‌ها در فضای امن برنامه ذخیره می‌شوند.', 'Local channel is ready. Posts are stored inside the secure app vault.')
        : t('گروه محلی ساخته شد. برای اعضای آنلاین با سشن امن، پیام ارسال می‌شود.', 'Local group is ready. Messages are sent to online members with secure sessions.');
      banner.classList.remove('hidden');
    } else {
      banner.textContent = '';
      banner.classList.add('hidden');
    }

    renderMessages();
  }

  function appendHistory(conversationId, entry) {
    if (!chatState.history[conversationId]) {
      chatState.history[conversationId] = [];
    }
    chatState.history[conversationId].push(entry);
    chatState.history[conversationId] = chatState.history[conversationId].slice(-300);
    storeHistory();
    renderPeers();
    renderMessages();

    if (entry.direction === 'in' && (document.hidden || appState()?.activeTab !== 'chat')) {
      window.dispatchEvent(new CustomEvent('poorija:chat-unread', {
        detail: {
          count: 1,
          peerId: conversationId
        }
      }));
    }
  }

  async function encryptForSession(session, plainBytes) {
    const iv = app().generateSecureRandomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.cryptoKey, plainBytes);
    return {
      iv: Array.from(iv),
      cipher: app().arrayBufferToBase64(cipher),
    };
  }

  async function decryptForSession(session, payload) {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(payload.iv || []) },
      session.cryptoKey,
      app().base64ToArrayBuffer(payload.cipher)
    );
    return decrypted;
  }

  function markMessageStatus(conversationId, messageId, status) {
    if (!conversationId || !messageId) return;
    const entry = (chatState.history[conversationId] || []).find((item) => item.id === messageId);
    if (!entry) return;
    entry.status = status;
    storeHistory();
    renderMessages();
    renderPeers();
  }

  function deleteMessageEntry(conversationId, messageId, { broadcast = false, peerRecord = null } = {}) {
    if (!conversationId || !messageId) return;
    const current = chatState.history[conversationId] || [];
    const next = current.filter((item) => item.id !== messageId);
    if (next.length === current.length) return;
    chatState.history[conversationId] = next;
    storeHistory();
    renderPeers();
    renderMessages();
    if (broadcast) {
      const targetPeer = peerRecord || findPeerByConversationKey(conversationId) || activePeer();
      relaySessionEvent(targetPeer, {
        type: 'delete',
        messageId,
        createdAt: new Date().toISOString(),
      });
    }
  }

  function sendDeliveryAck(session, messageId, status) {
    if (!session || !messageId) return;
    const payload = {
      type: 'receipt',
      messageId,
      status,
      createdAt: new Date().toISOString(),
    };
    if (session.connection?.open) {
      session.connection.send(payload);
      return;
    }
    const peerRecord = findPeerBySession(session);
    if (peerRecord) {
      relaySessionEvent(peerRecord, payload);
    }
  }

  function sendRelayEnvelope(peerRecord, payload) {
    if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !peerRecord) return false;
    chatState.ws.send(JSON.stringify({
      type: 'relay',
      toClientId: peerRecord.clientId || '',
      toFingerprint: peerRecord.fingerprint || '',
      payload,
      persist: true,
    }));
    return true;
  }

  function relaySessionEvent(peerRecord, message) {
    if (!peerRecord || !message) return false;
    const session = chatState.sessions.get(peerRecord.peerId);
    if (session?.connection?.open) {
      session.connection.send(message);
      return true;
    }
    return sendRelayEnvelope(peerRecord, {
      type: 'offline-chat',
      fromPeerId: chatState.peerId,
      message,
      createdAt: message.createdAt || new Date().toISOString(),
    });
  }

  function waitForSessionReady(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
        if (session?.cryptoKey) {
          resolve(session);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(session || null);
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  function waitForDirectConnection(peerRecord, timeoutMs = SESSION_READY_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        const session = peerRecord ? chatState.sessions.get(peerRecord.peerId) : null;
        if (session?.connection?.open) {
          resolve(session);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(session || null);
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  async function ensureDirectSession(peerRecord) {
    if (!peerRecord) return null;
    let session = chatState.sessions.get(peerRecord.peerId) || null;
    if (session?.cryptoKey && session.connection?.open) return session;

    if (!chatState.peer || !chatState.connected) {
      await connectChatTransport();
    }

    session = chatState.sessions.get(peerRecord.peerId) || null;
    if (session?.cryptoKey && session.connection?.open) return session;

    await startSecureSession(peerRecord);
    session = await waitForSessionReady(peerRecord);
    return session;
  }

  async function handleOfflineRelayMessage(message) {
    const payload = message.payload || {};
    const session = {
      peerId: payload.fromPeerId || message.fromFingerprint || message.fromClientId,
      remoteFingerprint: message.fromFingerprint || '',
    };
    await hydrateSessionKey(session);
    if (!session.cryptoKey) {
      appendHistory(session.peerId, {
        id: generateId('notice'),
        direction: 'in',
        type: 'text',
        text: t('یک پیام آفلاین رسید، اما کلید سشن قبلی برای بازکردن آن موجود نیست.', 'An offline message arrived, but the previous session key is not available.'),
        status: 'delivered',
        createdAt: payload.createdAt || new Date().toISOString(),
      });
      return;
    }
    await handleSessionMessage(session, payload.message);
  }

  async function ensureSessionKey(session, remotePeerRecord) {
    if (session.cryptoKey || !remotePeerRecord?.publicKeyData) return;
    session.remoteFingerprint = remotePeerRecord.fingerprint || session.remoteFingerprint || '';
    session.remotePublicKeyData = remotePeerRecord.publicKeyData || session.remotePublicKeyData || '';
    session.conversationId = getConversationKey(remotePeerRecord) || session.conversationId || session.remoteFingerprint || session.peerId;

    const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
    const remotePublicKey = await importIdentityPublicKey(remotePeerRecord.publicKeyData);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, remotePublicKey, rawKey);
    session.cryptoKey = cryptoKey;
    session.keyReady = true;
    await persistSessionKey(session, rawKey);
    session.connection.send({
      type: 'chat-key',
      wrappedKey: app().arrayBufferToBase64(wrapped),
      fingerprint: chatState.identity?.fingerprint || '',
    });
    renderActivePeer();
  }

  async function handleSessionMessage(session, message) {
    if (message.type === 'session-hello') {
      session.remoteClientId = message.clientId || session.remoteClientId || '';
      session.remoteFingerprint = message.fingerprint || session.remoteFingerprint || '';
      session.remotePublicKeyData = message.publicKeyData || session.remotePublicKeyData || '';
      const peer = findPeerBySession(session);
      if (peer) {
        peer.clientId = message.clientId || peer.clientId;
        peer.username = message.username || peer.username;
        peer.publicKeyData = message.publicKeyData || peer.publicKeyData;
        peer.fingerprint = message.fingerprint || peer.fingerprint;
        session.conversationId = getConversationKey(peer);
      } else if (message.peerId || session.peerId) {
        onPeerDiscovered({
          clientId: message.clientId || session.remoteClientId || session.peerId,
          peerId: message.peerId || session.peerId,
          username: message.username || session.peerId,
          publicKeyData: message.publicKeyData || '',
          fingerprint: message.fingerprint || '',
          status: 'online',
        });
      }
      if (session.initiator && !session.cryptoKey && session.connection?.open) {
        await ensureSessionKey(session, {
          peerId: session.peerId,
          clientId: session.remoteClientId,
          username: message.username || '',
          publicKeyData: session.remotePublicKeyData,
          fingerprint: session.remoteFingerprint,
        });
      }
      renderPeers();
      renderActivePeer();
      return;
    }

    if (message.type === 'chat-key') {
      const privateKey = await importIdentityPrivateKey();
      const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, app().base64ToArrayBuffer(message.wrappedKey));
      session.cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
      session.keyReady = true;
      await persistSessionKey(session, raw);
      renderActivePeer();
      return;
    }

    if (message.type === 'text') {
      const decrypted = await decryptForSession(session, message.payload);
      const text = new TextDecoder().decode(decrypted);
      appendHistory(getPeerHistoryKey(findPeerBySession(session), session), {
        id: message.id || generateId('msg'),
        direction: 'in',
        type: 'text',
        text,
        status: 'delivered',
        expiresAt: message.expiresAt || '',
        createdAt: message.createdAt || new Date().toISOString(),
      });
      sendDeliveryAck(session, message.id, appState()?.activeTab === 'chat' && !document.hidden ? 'seen' : 'delivered');
      return;
    }

    if (message.type === 'receipt') {
      markMessageStatus(getPeerHistoryKey(findPeerBySession(session), session), message.messageId, message.status || 'delivered');
      return;
    }

    if (message.type === 'reaction') {
      const key = getPeerHistoryKey(findPeerBySession(session), session);
      const entry = (chatState.history[key] || []).find((item) => item.id === message.messageId);
      if (entry) {
        applyMessageReaction(entry, message.reaction || '', resolveRemoteReactorId(session, message));
        storeHistory();
        renderPeers();
        renderMessages();
      }
      return;
    }

    if (message.type === 'delete') {
      deleteMessageEntry(getPeerHistoryKey(findPeerBySession(session), session), message.messageId);
      return;
    }

    if (message.type === 'file-start') {
      chatState.incomingFiles.set(message.transferId, {
        meta: message,
        chunks: new Array(message.totalChunks).fill(''),
        received: 0,
        session,
      });
      return;
    }

    if (message.type === 'file-chunk') {
      const transfer = chatState.incomingFiles.get(message.transferId);
      if (!transfer) return;
      transfer.chunks[message.index] = message.chunk;
      transfer.received += 1;
      if (transfer.received >= transfer.meta.totalChunks) {
        const payload = {
          iv: transfer.meta.iv,
          cipher: transfer.chunks.join(''),
        };
        const decrypted = await decryptForSession(transfer.session, payload);
        const blob = new Blob([decrypted], { type: transfer.meta.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        appendHistory(getPeerHistoryKey(findPeerBySession(session), session), {
          id: transfer.meta.messageId || generateId('file'),
          direction: 'in',
          type: transfer.meta.kind === 'voice' ? 'voice' : 'file',
          name: transfer.meta.name,
          size: transfer.meta.size,
          status: 'delivered',
          createdAt: transfer.meta.createdAt || new Date().toISOString(),
          downloadUrl: url,
          expiresAt: transfer.meta.expiresAt || '',
        });
        sendDeliveryAck(transfer.session, transfer.meta.messageId, appState()?.activeTab === 'chat' && !document.hidden ? 'seen' : 'delivered');
        chatState.incomingFiles.delete(message.transferId);
      }
    }
  }

  function sessionForPeer(peerRecord, connection) {
    const existing = chatState.sessions.get(peerRecord.peerId) || {};
    const session = {
      ...existing,
      peerId: peerRecord.peerId,
      remoteClientId: peerRecord.clientId,
      remoteFingerprint: peerRecord.fingerprint || '',
      remotePublicKeyData: peerRecord.publicKeyData || '',
      conversationId: getConversationKey(peerRecord),
      connection,
    };
    chatState.sessions.set(peerRecord.peerId, session);
    hydrateSessionKey(session).then(() => renderActivePeer()).catch(console.error);
    return session;
  }

  function bindDataConnection(peerRecord, connection, initiator = false) {
    const session = sessionForPeer(peerRecord, connection);
    session.initiator = initiator;
    session.messageQueue = session.messageQueue || Promise.resolve();

    connection.on('open', async () => {
      connection.send({
        type: 'session-hello',
        clientId: chatState.clientId || chatState.peerId,
        peerId: chatState.peerId,
        username: chatState.profile.name,
        publicKeyData: chatState.identity?.publicKeyData || '',
        fingerprint: chatState.identity?.fingerprint || '',
        createdAt: new Date().toISOString(),
      });
      if (initiator) {
        setTimeout(() => {
          const latest = chatState.sessions.get(peerRecord.peerId);
          if (latest?.connection?.open && !latest.cryptoKey && peerRecord.publicKeyData) {
            ensureSessionKey(latest, peerRecord).catch(console.error);
          }
        }, 1200);
      }
      renderActivePeer();
      notify(t('سشن P2P برقرار شد', 'P2P session established'), 'success');
    });

    connection.on('data', (message) => {
      session.messageQueue = session.messageQueue
        .then(() => handleSessionMessage(session, message))
        .catch((error) => {
          console.error(error);
          notify(t('پردازش پیام امن ناموفق بود', 'Failed to process secure message'), 'error');
        });
    });

    connection.on('close', () => {
      const existing = chatState.sessions.get(peerRecord.peerId);
      if (existing) {
        existing.connection = null;
      }
      renderActivePeer();
    });

    connection.on('error', (error) => {
      console.error(error);
      markPeerUnavailable(peerRecord.peerId, t('کانال P2P این کاربر قطع شد؛ برای جلوگیری از ارسال اشتباه از فهرست آنلاین حذف شد.', 'The peer channel dropped; the stale peer was removed from the online list.'));
    });
  }

  function onPeerDiscovered(peer) {
    if (isSelfPeerRecord(peer)) {
      chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
      saveContacts();
      renderPeers();
      renderActivePeer();
      return;
    }
    mergePeerRecord(peer, { online: true });
    chatState.peers = chatState.peers.filter((item) => !isSelfPeerRecord(item));
    saveContacts();
    if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.length) {
      const seedPeer = chatState.peers.find((item) => item.status === 'online') || chatState.peers[0];
      chatState.activePeerClientId = seedPeer.clientId;
      chatState.activeConversationId = getConversationKey(seedPeer);
    }
    [...chatState.spaces.groups, ...chatState.spaces.channels].forEach((space) => {
      sendRelayEnvelope(peer, {
        type: 'space-sync',
        space,
        createdAt: new Date().toISOString(),
      });
    });
    renderPeers();
    renderActivePeer();
  }

  function broadcastHello() {
    if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN || !chatState.peerId || !chatState.clientId) return;
    const identity = chatState.identity;
    chatState.ws.send(JSON.stringify({
      type: 'hello',
      clientId: chatState.clientId,
      username: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
      peerId: chatState.peerId,
      publicKeyData: identity?.publicKeyData || '',
      fingerprint: identity?.fingerprint || '',
      avatarData: chatState.profile.avatarData || '',
    }));
    registerChatPush(false).catch((error) => console.warn('Web Push registration skipped:', error));
  }

  function clearReconnectTimer() {
    if (chatState.reconnectTimer) {
      clearTimeout(chatState.reconnectTimer);
      chatState.reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    if (!chatState.shouldReconnect || !isUnlocked()) return;
    const delay = Math.min(15000, 1200 * (2 ** chatState.reconnectAttempt));
    chatState.reconnectAttempt += 1;
    chatState.reconnectTimer = setTimeout(async () => {
      chatState.reconnectTimer = null;
      try {
        if (chatState.peer?.destroyed) {
          chatState.peer = null;
          await connectChatTransport();
          return;
        }
        connectPresence();
      } catch (error) {
        console.error(error);
      }
    }, delay);
  }

  function startHeartbeat() {
    if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
    chatState.heartbeatTimer = setInterval(() => {
      if (chatState.ws?.readyState === WebSocket.OPEN) {
        chatState.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 20000);
  }

  function connectPresence() {
    if (chatState.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(chatState.ws.readyState)) {
      return;
    }

    chatState.ws = new WebSocket(wsUrl());
    setConnectionState(false, t('در حال اتصال...', 'Connecting...'));

    chatState.ws.addEventListener('open', () => {
      clearReconnectTimer();
      chatState.reconnectAttempt = 0;
      chatState.serverReachable = true;
      setConnectionState(true, t('متصل به سرور چت', 'Connected to chat server'));
      renderStaticUi();
      startHeartbeat();
    });

    chatState.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'welcome') {
        chatState.clientId = message.clientId || '';
        renderStaticUi();
        broadcastHello();
        return;
      }

      if (message.type === 'peers') {
        chatState.peers.forEach((peer) => {
          if (!peer.type) peer.status = 'offline';
        });
        (message.peers || []).forEach((peer) => mergePeerRecord(peer, { online: true }));
        chatState.peers = chatState.peers.filter((peer) => !isSelfPeerRecord(peer));
        saveContacts();
        renderPeers();
        renderActivePeer();
        return;
      }

      if (message.type === 'relay' && message.payload?.type === 'call-invite') {
        if (chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite) {
          const busyPeer = findPeerRecordByPeerId(message.payload.peerId || '');
          if (busyPeer) {
            sendRelayEnvelope(busyPeer, {
              type: 'call-busy',
              mode: message.payload.mode || 'voice',
              name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
            });
          }
          notify(t('در حال حاضر در تماس دیگری هستید و تماس جدید رد شد.', 'You are already in another call, so the new request was rejected.'), 'warning');
          return;
        }
        showIncomingCall(null, {
          peerId: message.payload.peerId || message.fromClientId,
          mode: message.payload.mode || 'voice',
          name: message.payload.name || message.fromClientId,
        });
        appendCall({
          name: message.payload.name || message.fromClientId,
          peerId: message.fromClientId,
          mode: message.payload.mode,
          status: 'ringing',
        });
        return;
      }

      if (message.type === 'relay' && message.payload?.type === 'call-busy') {
        notify(t('کاربر مقصد در حال حاضر در تماس دیگری است.', 'The target user is already on another call.'), 'warning');
        endCurrentCall();
        return;
      }

      if (message.type === 'relay' && message.payload?.type === 'space-sync' && message.payload?.space) {
        upsertSharedSpace(message.payload.space);
        renderPeers();
        renderActivePeer();
        return;
      }

      if (message.type === 'relay' && message.payload?.type === 'offline-chat') {
        handleOfflineRelayMessage(message).catch((error) => {
          console.error(error);
          notify(t('پیام آفلاین قابل بازکردن نبود', 'Could not open offline message'), 'warning');
        });
      }
    });

    chatState.ws.addEventListener('close', () => {
      setConnectionState(false, t('ارتباط با سرور چت قطع شد', 'Chat server disconnected'));
      chatState.serverReachable = false;
      chatState.peers.forEach((peer) => {
        if (!peer.type) peer.status = 'offline';
      });
      saveContacts();
      if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
      renderPeers();
      renderActivePeer();
      scheduleReconnect();
    });

    chatState.ws.addEventListener('error', () => {
      chatState.serverReachable = false;
      setConnectionState(false, t('سرور چت در دسترس نیست', 'Chat server is unreachable'));
    });
  }

  async function connectChatTransport() {
    if (!isUnlocked()) {
      notify(t('برای فعال‌سازی چت ابتدا باید برنامه را باز کنید', 'Unlock the app before enabling chat'), 'warning');
      return;
    }

    const configuredOrigin = new URL(chatServerOrigin());
    const shouldBootstrapLocalRelay = !chatState.profile.presenceUrl
      && !chatState.profile.peerOrigin
      && configuredOrigin.port !== '9000';

    if (chatState.profile.autoDiscovery || shouldBootstrapLocalRelay) {
      await discoverLocalRelayServer({ fullScan: false, silent: true });
    }
    await ensureIdentity();
    await hydrateRelayTurnConfig();
    chatState.shouldReconnect = true;
    renderStaticUi();

    const nextPeerOrigin = peerTransportOrigin();
    const canReusePeer = Boolean(
      chatState.peer
      && !chatState.peer.destroyed
      && chatState.peer.open
      && chatState.peerTransportOrigin === nextPeerOrigin
    );

    if (!canReusePeer && chatState.peer && !chatState.peer.destroyed) {
      chatState.peer.destroy();
      chatState.peer = null;
      chatState.peerId = '';
      chatState.sessions.clear();
    }

    if (canReusePeer) {
      connectPresence();
      return;
    }

    const PeerCtor = window.Peer;
    if (!PeerCtor) {
      notify(t('کتابخانه PeerJS لود نشده است', 'PeerJS client failed to load'), 'error');
      return;
    }

    const stablePeerId = chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
    chatState.profile.stablePeerId = stablePeerId;
    saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
    const peer = new PeerCtor(stablePeerId, peerOptions());
    chatState.peer = peer;
    chatState.peerTransportOrigin = nextPeerOrigin;

    peer.on('open', (peerId) => {
      chatState.peerId = peerId;
      renderStaticUi();
      connectPresence();
      broadcastHello();
    });

    peer.on('connection', (connection) => {
      const remotePeer = {
        clientId: connection.metadata?.clientId || connection.peer,
        peerId: connection.peer,
        username: connection.metadata?.username || connection.peer,
        publicKeyData: connection.metadata?.publicKeyData || '',
        fingerprint: connection.metadata?.fingerprint || '',
        status: 'online',
      };
      onPeerDiscovered(remotePeer);
      bindDataConnection(remotePeer, connection, false);
    });

    peer.on('call', async (call) => {
      appendCall({
        name: call.metadata?.username || call.peer,
        peerId: call.peer,
        mode: call.metadata?.mode || 'voice',
        status: 'incoming',
      });
      showIncomingCall(call);
      if (chatState.pendingIncomingAccept) {
        acceptIncomingCall().catch(console.error);
      }
    });

    peer.on('error', (error) => {
      console.error(error);
      const errorText = String(`${error?.type || ''} ${error?.message || error || ''}`);
      const missingPeer = errorText.match(/Could not connect to peer\s+([A-Za-z0-9_-]+)/i)?.[1];
      if (missingPeer || /peer-unavailable/i.test(errorText)) {
        markPeerUnavailable(missingPeer || activePeer()?.peerId || '', t('Peer انتخاب‌شده آنلاین نیست یا دیگر در دسترس نیست؛ فهرست را به‌روزرسانی کردیم.', 'The selected peer is not online or is no longer reachable; the list was refreshed.'));
        setConnectionState(Boolean(chatState.ws?.readyState === WebSocket.OPEN), t('متصل به رله؛ Peer مقصد در دسترس نیست', 'Relay connected; target peer is unreachable'));
        return;
      }
      if (errorText.includes('unavailable-id')) {
        chatState.profile.stablePeerId = generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-');
        saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      }
      notify(t('اتصال PeerJS با خطا مواجه شد', 'PeerJS connection failed'), 'error');
      setConnectionState(false, t('خطا در لایه P2P', 'P2P layer error'));
      scheduleReconnect();
    });
  }

  async function startSecureSession(targetPeer = null) {
    const peerRecord = targetPeer || activePeer();
    if (!peerRecord || !chatState.peer) return;

    const existing = chatState.sessions.get(peerRecord.peerId);
    if (existing?.connection?.open) {
      if (!existing.cryptoKey) await ensureSessionKey(existing, peerRecord);
      renderActivePeer();
      return existing;
    }

    const connection = chatState.peer.connect(peerRecord.peerId, {
      reliable: true,
      metadata: {
        clientId: chatState.clientId || chatState.peerId,
        username: chatState.profile.name,
        publicKeyData: chatState.identity?.publicKeyData || '',
        fingerprint: chatState.identity?.fingerprint || '',
      },
    });
    bindDataConnection(peerRecord, connection, true);
    return chatState.sessions.get(peerRecord.peerId) || null;
  }

  async function sendMessage() {
    let session = activeSession();
    const peer = getActiveConversation();
    const directPeer = activePeer();
    const composer = document.getElementById('chatComposer');
    if (!peer || !composer) return;

    const text = composer.value.trim();
    if (!text) return;
    const messageId = generateId('msg');
    const timerSeconds = Number(chatState.timerSeconds || 0);
    const expiresAt = timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000).toISOString() : '';

    if (peer.type) {
      appendHistory(peer.conversationId, {
        id: messageId,
        direction: 'out',
        type: 'text',
        text,
        status: 'stored',
        expiresAt,
        createdAt: new Date().toISOString(),
      });
      composer.value = '';
      if (peer.type === 'group') {
        for (const memberId of peer.members || []) {
          const member = chatState.peers.find((item) => getConversationKey(item) === memberId || item.peerId === memberId);
          const memberSession = member ? chatState.sessions.get(member.peerId) : null;
          if (member && memberSession?.cryptoKey) {
            const payload = await encryptForSession(memberSession, new TextEncoder().encode(`[${peer.name}] ${text}`));
            const outbound = { id: generateId('msg'), type: 'text', createdAt: new Date().toISOString(), payload };
            if (memberSession.connection?.open) memberSession.connection.send(outbound);
            else sendRelayEnvelope(member, { type: 'offline-chat', fromPeerId: chatState.peerId, message: outbound, createdAt: outbound.createdAt });
          }
        }
      }
      return;
    }

    if (!directPeer) return;
    if (isSelfPeerRecord(directPeer)) {
      notify(t('ارسال پیام به خود همین سشن مجاز نیست.', 'Sending a message to the current session itself is not allowed.'), 'warning');
      return;
    }
    appendHistory(getConversationKey(directPeer), {
      id: messageId,
      direction: 'out',
      type: 'text',
      text,
      status: 'queued',
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    composer.value = '';
    if (!session?.cryptoKey) {
      notify(t('در حال ساخت سشن امن برای ارسال پیام...', 'Creating secure session before sending...'), 'info');
      session = await ensureDirectSession(directPeer);
    }

    if (!session?.cryptoKey) {
      markMessageStatus(getConversationKey(directPeer), messageId, 'failed');
      notify(t('سشن امن هنوز آماده نیست. چند ثانیه بعد دوباره ارسال کنید یا اتصال را بررسی کنید.', 'Secure session is not ready yet. Try again in a few seconds or check the connection.'), 'warning');
      return;
    }

    const payload = await encryptForSession(session, new TextEncoder().encode(text));
    const outbound = {
      type: 'text',
      id: messageId,
      createdAt: new Date().toISOString(),
      expiresAt,
      payload,
    };
    if (session.connection?.open) {
      session.connection.send(outbound);
    } else {
      sendRelayEnvelope(directPeer, { type: 'offline-chat', fromPeerId: chatState.peerId, message: outbound, createdAt: outbound.createdAt });
    }
    markMessageStatus(getConversationKey(directPeer), messageId, session.connection?.open ? 'sent' : 'queued');
  }

  async function sendEncryptedBlob(file, kind = 'file') {
    let session = activeSession();
    const peer = activePeer();
    if (!peer || !file) return;
    if (isSelfPeerRecord(peer)) {
      notify(t('ارسال فایل یا پیام صوتی به همین سشن محلی مجاز نیست.', 'Sending files or voice messages to the current session itself is not allowed.'), 'warning');
      return;
    }
    const historyId = generateId(kind === 'voice' ? 'voice' : 'file');
    const localUrl = URL.createObjectURL(file);
    const timerSeconds = Number(chatState.timerSeconds || 0);
    const expiresAt = timerSeconds > 0 ? new Date(Date.now() + timerSeconds * 1000).toISOString() : '';
    appendHistory(getConversationKey(peer), {
      id: historyId,
      direction: 'out',
      type: kind,
      name: file.name,
      size: file.size,
      downloadUrl: localUrl,
      status: 'queued',
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    if (!session?.cryptoKey) {
      session = await ensureDirectSession(peer);
    }
    if (!session?.cryptoKey) {
      markMessageStatus(getConversationKey(peer), historyId, 'failed');
      notify(t('برای ارسال فایل/صدا باید سشن امن آماده باشد.', 'A secure session is required before sending files or voice messages.'), 'warning');
      return;
    }
    if (!session.connection?.open) {
      await startSecureSession(peer);
      session = await waitForDirectConnection(peer, 5000) || chatState.sessions.get(peer.peerId) || session;
    }
    if (!session?.connection?.open) {
      markMessageStatus(getConversationKey(peer), historyId, 'failed');
      notify(t('کانال مستقیم هنوز آماده نیست؛ چند ثانیه بعد دوباره تلاش کنید.', 'The direct channel is not open yet. Try again in a few seconds.'), 'warning');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      markMessageStatus(getConversationKey(peer), historyId, 'failed');
      notify(t('فعلاً فقط فایل‌های تا 16 مگابایت پشتیبانی می‌شوند', 'Files are currently limited to 16 MB'), 'warning');
      return;
    }

    const encrypted = await encryptForSession(session, await file.arrayBuffer());
    const transferId = generateId('transfer');
    const totalChunks = Math.ceil(encrypted.cipher.length / FILE_CHUNK_SIZE);

    session.connection.send({
      type: 'file-start',
      messageId: historyId,
      transferId,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      kind,
      size: file.size,
      totalChunks,
      iv: encrypted.iv,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    for (let index = 0; index < totalChunks; index += 1) {
      session.connection.send({
        type: 'file-chunk',
        transferId,
        index,
        chunk: encrypted.cipher.slice(index * FILE_CHUNK_SIZE, (index + 1) * FILE_CHUNK_SIZE),
      });
    }

    markMessageStatus(getConversationKey(peer), historyId, 'sent');
  }

  async function sendFile(file) {
    return sendEncryptedBlob(file, 'file');
  }

  async function playMediaElement(element) {
    if (!element) return;
    try {
      await element.play?.();
    } catch (_error) {
      /* ignore autoplay failures */
    }
  }

  function streamHasLiveVideo(stream) {
    return Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
  }

  function prepareVideoElement(element, { muted = false } = {}) {
    if (!element) return;
    element.autoplay = true;
    element.setAttribute('autoplay', 'autoplay');
    element.playsInline = true;
    element.setAttribute('playsinline', 'true');
    element.setAttribute('webkit-playsinline', 'true');
    element.preload = 'auto';
    element.disablePictureInPicture = true;
    element.controls = false;
    if (muted) {
      element.muted = true;
      element.defaultMuted = true;
      element.setAttribute('muted', 'muted');
    }
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_error) {
        /* noop */
      }
    });
  }

  function clearMediaElement(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.pause?.();
    element.srcObject = null;
    element.removeAttribute('src');
    element.load?.();
  }

  function activeCallPeerRecord() {
    return findPeerRecordByPeerId(chatState.currentCall?.peer || chatState.pendingIncomingCall?.peer || chatState.pendingIncomingInvite?.peerId || '') || activePeer() || null;
  }

  function syncFloatingCallPeerIdentity() {
    const peer = activeCallPeerRecord() || getActiveConversation();
    const avatar = document.getElementById('chatFloatingRemoteAvatar');
    if (avatar && peer) {
      avatar.textContent = initials(peer.username || peer.name || peer.peerId || 'P');
      avatar.classList.toggle('has-avatar', Boolean(peer.avatarData));
      avatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(peer.username || peer.name || peer.peerId || 'P'));
    }
    const title = document.getElementById('chatFloatingCallTitle');
    const status = document.getElementById('chatFloatingCallStatus');
    if (title && peer) {
      const modeLabel = chatState.currentCallMode === 'video'
        ? t('تماس تصویری فعال', 'Video call active')
        : t('تماس صوتی فعال', 'Voice call active');
      title.textContent = `${modeLabel}`;
      title.setAttribute('data-peer-name', peer.username || peer.name || peer.peerId || '');
    }
    if (status && peer && !chatState.currentCall) {
      status.textContent = app().escapeHTML(peer.username || peer.name || peer.peerId || '');
    }
  }

  function mountChatPortals() {
    if (chatState.portalsMounted) return;
    const incomingModal = document.getElementById('chatIncomingCallModal');
    const floatingCall = document.getElementById('chatFloatingCall');
    const timerPopover = document.getElementById('chatTimerPopover');
    if (incomingModal && incomingModal.parentElement !== document.body) {
      document.body.appendChild(incomingModal);
    }
    if (floatingCall && floatingCall.parentElement !== document.body) {
      document.body.appendChild(floatingCall);
    }
    if (timerPopover && timerPopover.parentElement !== document.body) {
      document.body.appendChild(timerPopover);
    }
    chatState.portalsMounted = true;
    chatState.timerPortalMounted = true;
  }

  function applyFloatingCallPosition() {
    const overlay = document.getElementById('chatFloatingCall');
    if (!overlay || chatState.callDisplayMode !== 'minimized') return;
    overlay.style.left = `${Math.max(12, chatState.floatingCallPosition.x || 24)}px`;
    overlay.style.top = `${Math.max(12, chatState.floatingCallPosition.y || 24)}px`;
  }

  function syncCallChromeState() {
    const root = document.documentElement;
    const hasCall = Boolean(chatState.currentCall);
    root.classList.toggle('chat-call-active', hasCall && chatState.callDisplayMode === 'fullscreen');
    root.classList.toggle('chat-call-minimized', hasCall && chatState.callDisplayMode === 'minimized');
  }

  function syncCallOverlayBounds() {
    const overlay = document.getElementById('chatFloatingCall');
    if (!overlay) return;
    if (chatState.callDisplayMode === 'minimized' || isCompactChatLayout()) {
      overlay.style.left = '';
      overlay.style.top = '';
      overlay.style.width = '';
      overlay.style.height = '';
      return;
    }
    if (window.innerWidth >= 768) {
      const headerRect = document.getElementById('appHeader')?.getBoundingClientRect();
      const top = Math.max(0, Math.round(headerRect?.bottom || 0));
      overlay.style.left = '0px';
      overlay.style.top = `${top}px`;
      overlay.style.width = `${window.innerWidth}px`;
      overlay.style.height = `${Math.max(0, window.innerHeight - top)}px`;
      return;
    }
    const host = (window.innerWidth >= 768
      ? document.getElementById('content-chat')
      : document.querySelector('#content-chat > .chat-shell'))
      || document.querySelector('.chat-shell');
    if (!host) return;
    const rect = host.getBoundingClientRect();
    overlay.style.left = `${Math.round(rect.left)}px`;
    overlay.style.top = `${Math.round(rect.top)}px`;
    overlay.style.width = `${Math.round(rect.width)}px`;
    overlay.style.height = `${Math.round(rect.height)}px`;
  }

  function setCallDisplayMode(mode = 'fullscreen') {
    chatState.callDisplayMode = mode;
    const overlay = document.getElementById('chatFloatingCall');
    const minimizeBtn = document.getElementById('chatMinimizeCallBtn');
    if (!overlay) return;
    overlay.dataset.callDisplay = mode;
    overlay.classList.toggle('is-minimized', mode === 'minimized');
    if (mode === 'minimized') {
      applyFloatingCallPosition();
      minimizeBtn?.setAttribute('title', t('باز کردن دوباره تماس', 'Restore call'));
      minimizeBtn?.querySelector('i')?.classList.replace('fa-arrow-right', 'fa-up-right-and-down-left-from-center');
    } else {
      overlay.style.left = '';
      overlay.style.top = '';
      minimizeBtn?.setAttribute('title', t('بازگشت به چت / حالت شناور', 'Return to chat / minimize'));
      minimizeBtn?.querySelector('i')?.classList.replace('fa-up-right-and-down-left-from-center', 'fa-arrow-right');
    }
    syncCallChromeState();
    syncCallOverlayBounds();
  }

  function toggleCallDisplayMode() {
    if (!chatState.currentCall) return;
    setCallDisplayMode(chatState.callDisplayMode === 'minimized' ? 'fullscreen' : 'minimized');
  }

  function beginFloatingCallDrag(event) {
    if (chatState.callDisplayMode !== 'minimized') return;
    const overlay = document.getElementById('chatFloatingCall');
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    chatState.draggingFloatingCall = true;
    chatState.floatingDragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    overlay.classList.add('dragging');
  }

  function moveFloatingCallDrag(event) {
    if (!chatState.draggingFloatingCall) return;
    const nextX = event.clientX - (chatState.floatingDragOffset?.x || 0);
    const nextY = event.clientY - (chatState.floatingDragOffset?.y || 0);
    const overlay = document.getElementById('chatFloatingCall');
    if (!overlay) return;
    const maxX = Math.max(12, window.innerWidth - overlay.offsetWidth - 12);
    const maxY = Math.max(12, window.innerHeight - overlay.offsetHeight - 12);
    chatState.floatingCallPosition = {
      x: Math.min(maxX, Math.max(12, nextX)),
      y: Math.min(maxY, Math.max(12, nextY)),
    };
    applyFloatingCallPosition();
  }

  function endFloatingCallDrag() {
    chatState.draggingFloatingCall = false;
    chatState.floatingDragOffset = null;
    document.getElementById('chatFloatingCall')?.classList.remove('dragging');
  }

  function isCallBusy() {
    return Boolean(chatState.currentCall || chatState.pendingIncomingCall || chatState.pendingIncomingInvite);
  }

  async function requestCallMedia(mode, includeAudio = true) {
    const wantsVideo = mode === 'video';
    const preferredConstraints = {
      audio: includeAudio,
      video: wantsVideo
        ? {
          facingMode: { ideal: chatState.callFacingMode || 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
        : false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(preferredConstraints);
    } catch (error) {
      if (!wantsVideo) throw error;
      return navigator.mediaDevices.getUserMedia({
        audio: includeAudio,
        video: true,
      });
    }
  }

  function attachLocalStream(stream) {
    if (chatState.localStream && chatState.localStream !== stream) {
      stopStream(chatState.localStream);
    }
    chatState.localStream = stream;
    const localVideo = document.getElementById('chatLocalVideo');
    const floatingLocalVideo = document.getElementById('chatFloatingLocalVideo');
    if (localVideo) {
      prepareVideoElement(localVideo, { muted: true });
      localVideo.srcObject = stream;
      localVideo.onloadedmetadata = () => playMediaElement(localVideo);
      playMediaElement(localVideo);
    }
    if (floatingLocalVideo) {
      prepareVideoElement(floatingLocalVideo, { muted: true });
      floatingLocalVideo.srcObject = stream;
      floatingLocalVideo.onloadedmetadata = () => playMediaElement(floatingLocalVideo);
      playMediaElement(floatingLocalVideo);
    }
    document.querySelector('.chat-local-stage')?.classList.toggle('has-video', streamHasLiveVideo(stream));
    syncCallStageState();
  }

  function attachRemoteStream(stream) {
    chatState.remoteStream = stream;
    const remoteVideo = document.getElementById('chatRemoteVideo');
    const floatingRemoteVideo = document.getElementById('chatFloatingRemoteVideo');
    if (remoteVideo) {
      prepareVideoElement(remoteVideo);
      remoteVideo.srcObject = stream;
      remoteVideo.onloadedmetadata = () => playMediaElement(remoteVideo);
      playMediaElement(remoteVideo);
    }
    if (floatingRemoteVideo) {
      prepareVideoElement(floatingRemoteVideo);
      floatingRemoteVideo.srcObject = stream;
      floatingRemoteVideo.onloadedmetadata = () => playMediaElement(floatingRemoteVideo);
      playMediaElement(floatingRemoteVideo);
    }
    document.getElementById('chatFloatingRemoteAvatar')?.classList.toggle('hidden', chatState.currentCallMode === 'video' && streamHasLiveVideo(stream));
    syncCallStageState();
  }

  function syncCallStageState() {
    const windowEl = document.querySelector('#chatFloatingCall .chat-floating-call-window');
    if (!windowEl) return;
    const localVideoEnabled = streamHasLiveVideo(chatState.localStream);
    const remoteVideoEnabled = streamHasLiveVideo(chatState.remoteStream);
    windowEl.dataset.callMode = chatState.currentCallMode || 'voice';
    if (chatState.currentCallMode === 'video') {
      if (!['remote', 'local'].includes(chatState.callPrimaryVideo)) {
        chatState.callPrimaryVideo = 'remote';
      }
      if (remoteVideoEnabled) {
        chatState.callPrimaryVideo = chatState.callPrimaryVideo || 'remote';
      }
    } else {
      chatState.callPrimaryVideo = 'remote';
    }
    windowEl.dataset.callPrimary = chatState.callPrimaryVideo || 'remote';
    windowEl.dataset.localVideo = localVideoEnabled ? 'on' : 'off';
    windowEl.dataset.remoteVideo = remoteVideoEnabled ? 'on' : 'off';
    document.querySelector('.chat-local-stage')?.classList.toggle('has-video', localVideoEnabled);
    document.getElementById('chatFloatingRemoteAvatar')?.classList.toggle('hidden', chatState.currentCallMode === 'video' && remoteVideoEnabled);
    document.querySelector('.chat-local-stage-placeholder')?.classList.toggle('hidden', localVideoEnabled);
  }

  function setCallControlState(id, active, disabled = false) {
    const button = document.getElementById(id);
    if (!button) return;
    button.classList.toggle('active', Boolean(active));
    button.disabled = Boolean(disabled);
  }

  function refreshCallControls() {
    setCallControlState('chatMuteToggleBtn', chatState.callMuted, !chatState.currentCall);
    setCallControlState('chatHoldToggleBtn', chatState.callHeld, !chatState.currentCall);
    setCallControlState('chatSpeakerToggleBtn', chatState.callSpeakerEnabled, !chatState.currentCall);
    setCallControlState('chatVideoToggleBtn', !chatState.callVideoEnabled, !chatState.currentCall || chatState.currentCallMode !== 'video');
    setCallControlState('chatFlipCameraBtn', false, !chatState.currentCall || chatState.currentCallMode !== 'video');
    setCallControlState('chatSwapVideoLayoutBtn', chatState.callPrimaryVideo === 'local', !chatState.currentCall || chatState.currentCallMode !== 'video');
    setCallControlState('chatEndCallControlBtn', false, !chatState.currentCall);
    document.getElementById('chatVideoToggleBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
    document.getElementById('chatFlipCameraBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
    document.getElementById('chatSwapVideoLayoutBtn')?.classList.toggle('hidden', chatState.currentCallMode !== 'video');
    syncCallStageState();
  }

  function showIncomingCall(call, invite = null) {
    const incomingPeerId = call?.peer || invite?.peerId || '';
    if (chatState.currentCall && incomingPeerId !== chatState.currentCall?.peer) {
      notify(t('در حال حاضر یک تماس فعال دارید.', 'You already have an active call.'), 'warning');
      call?.close?.();
      return;
    }
    if (call) chatState.pendingIncomingCall = call;
    if (invite) chatState.pendingIncomingInvite = invite;
    const mode = call?.metadata?.mode || invite?.mode || 'voice';
    const name = call?.metadata?.username || invite?.name || call?.peer || invite?.peerId || t('کاربر P00RIJA', 'P00RIJA User');
    document.getElementById('chatIncomingCallTitle').textContent = mode === 'video'
      ? t('تماس تصویری ورودی', 'Incoming video call')
      : t('تماس صوتی ورودی', 'Incoming voice call');
    document.getElementById('chatIncomingCallMeta').textContent = t(`${name} می‌خواهد تماس امن برقرار کند.`, `${name} wants to start a secure call.`);
    document.getElementById('chatIncomingCallAvatar').textContent = initials(name);
    const preview = document.getElementById('chatIncomingPreviewVideo');
    if (preview) {
      prepareVideoElement(preview, { muted: true });
      preview.srcObject = chatState.localStream || null;
      preview.classList.toggle('hidden', mode !== 'video');
      playMediaElement(preview);
    }
    document.getElementById('chatIncomingCallModal').classList.remove('hidden');
    renderActivePeer();
  }

  function hideIncomingCall() {
    document.getElementById('chatIncomingCallModal')?.classList.add('hidden');
    const preview = document.getElementById('chatIncomingPreviewVideo');
    if (preview) {
      preview.pause?.();
      preview.srcObject = null;
    }
    renderActivePeer();
  }

  async function acceptIncomingCall() {
    const call = chatState.pendingIncomingCall;
    if (!call) {
      chatState.pendingIncomingAccept = true;
      document.getElementById('chatIncomingCallMeta').textContent = t('در حال انتظار برای برقراری کانال تماس امن...', 'Waiting for the secure media channel to arrive...');
      return;
    }
    chatState.pendingIncomingAccept = false;
    hideIncomingCall();
    try {
      const wantsVideo = call.metadata?.mode === 'video';
      const stream = await requestCallMedia(wantsVideo ? 'video' : 'voice');
      attachLocalStream(stream);
      call.answer(stream);
      appendCall({
        name: call.metadata?.username || call.peer,
        peerId: call.peer,
        mode: wantsVideo ? 'video' : 'voice',
        status: 'answered',
      });
      bindMediaCall(call, wantsVideo ? 'video' : 'voice');
    } catch (error) {
      console.error(error);
      notify(t('دسترسی به میکروفون/دوربین ممکن نشد', 'Could not access microphone/camera'), 'error');
      call.close();
    }
  }

  function rejectIncomingCall() {
    const call = chatState.pendingIncomingCall;
    chatState.pendingIncomingAccept = false;
    if (call) {
      appendCall({
        name: call.metadata?.username || call.peer,
        peerId: call.peer,
        mode: call.metadata?.mode || 'voice',
        status: 'missed',
      });
      call.close();
    }
    chatState.pendingIncomingCall = null;
    chatState.pendingIncomingInvite = null;
    hideIncomingCall();
  }

  function bindMediaCall(call, mode) {
    chatState.currentCall = call;
    chatState.currentCallMode = mode;
    chatState.callDisplayMode = 'fullscreen';
    chatState.callPrimaryVideo = 'remote';
    chatState.callMuted = false;
    chatState.callHeld = false;
    chatState.callSpeakerEnabled = false;
    chatState.callVideoEnabled = mode === 'video';
    syncFloatingCallPeerIdentity();
    const callLabel = mode === 'video'
      ? t('تماس تصویری فعال', 'Video call active')
      : t('تماس صوتی فعال', 'Voice call active');
    document.getElementById('chatCallStatus').textContent = callLabel;
    document.getElementById('chatFloatingCallTitle').textContent = callLabel;
    document.getElementById('chatFloatingCallStatus').textContent = t('اتصال امن برقرار است', 'Secure call is active');
    document.getElementById('chatFloatingCall').classList.remove('hidden');
    setCallDisplayMode('fullscreen');
    syncCallChromeState();
    syncCallOverlayBounds();
    document.getElementById('chatEndCallBtn').classList.remove('hidden');
    refreshCallControls();
    syncCallStageState();

    call.on('stream', (stream) => {
      attachRemoteStream(stream);
    });

    call.on('close', () => {
      endCurrentCall({ closePeer: false });
    });

    call.on('error', (error) => {
      console.error(error);
      endCurrentCall({ closePeer: false });
    });

    const pc = call.peerConnection;
    if (pc) {
      pc.addEventListener('iceconnectionstatechange', () => {
        const state = pc.iceConnectionState;
        document.getElementById('chatFloatingCallStatus').textContent = t(`وضعیت تماس: ${state}`, `Call state: ${state}`);
        if (state === 'disconnected') {
          notify(t('شبکه لحظه‌ای ناپایدار شد؛ تماس را فوراً قطع نمی‌کنیم.', 'Network is temporarily unstable; keeping the call alive.'), 'info');
        }
        if (state === 'failed' || state === 'closed') {
          endCurrentCall({ closePeer: false });
        }
      });
    }
  }

  async function startCall(mode) {
    if (isCallBusy()) {
      notify(t('ابتدا تماس فعلی را تمام کنید.', 'Finish the current call first.'), 'warning');
      return;
    }
    const active = getActiveConversation();
    if (active?.type === 'group') {
      notify(t('فراخوانی گروهی در حال تکمیل است؛ فعلاً تماس مستقیم خصوصی در دسترس است.', 'Group calling is still being finalized; direct private calls are currently available.'), 'info');
      return;
    }
    const peerRecord = activePeer();
    if (!peerRecord || !chatState.peer) {
      notify(t('برای تماس ابتدا به سرور چت وصل شوید و یک کاربر را انتخاب کنید.', 'Connect to chat and select a peer before calling.'), 'warning');
      return;
    }
    if (isSelfPeerRecord(peerRecord)) {
      notify(t('تماس با همین سشن محلی مجاز نیست.', 'Calling the current session itself is not allowed.'), 'warning');
      return;
    }

    try {
      const stream = await requestCallMedia(mode);
      attachLocalStream(stream);
      syncFloatingCallPeerIdentity();
      const call = chatState.peer.call(peerRecord.peerId, stream, {
        metadata: {
          mode,
          username: chatState.profile.name,
          peerId: chatState.peerId,
        },
      });
      sendRelayEnvelope(peerRecord, {
        type: 'call-invite',
        mode,
        name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
        peerId: chatState.peerId,
      });
      appendCall({
        name: peerRecord.username || peerRecord.peerId,
        peerId: peerRecord.peerId,
        mode,
        status: 'outgoing',
      });
      bindMediaCall(call, mode);
    } catch (error) {
      console.error(error);
      notify(t('دسترسی به میکروفون/دوربین ناموفق بود', 'Failed to access microphone/camera'), 'error');
    }
  }

  function toggleMuteCall() {
    if (!chatState.localStream) return;
    chatState.callMuted = !chatState.callMuted;
    chatState.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !chatState.callMuted;
    });
    refreshCallControls();
  }

  function toggleHoldCall() {
    if (!chatState.localStream) return;
    chatState.callHeld = !chatState.callHeld;
    chatState.localStream.getTracks().forEach((track) => {
      track.enabled = !chatState.callHeld && (track.kind !== 'audio' || !chatState.callMuted) && (track.kind !== 'video' || chatState.callVideoEnabled);
    });
    document.getElementById('chatFloatingCallStatus').textContent = chatState.callHeld
      ? t('تماس روی Hold قرار گرفت', 'Call is on hold')
      : t('اتصال امن برقرار است', 'Secure call is active');
    refreshCallControls();
  }

  function toggleSpeakerCall() {
    chatState.callSpeakerEnabled = !chatState.callSpeakerEnabled;
    const remoteVideo = document.getElementById('chatFloatingRemoteVideo');
    if (remoteVideo && typeof remoteVideo.setSinkId === 'function') {
      remoteVideo.setSinkId('default').catch(() => {
        notify(t('مرورگر اجازه کنترل خروجی صدا را نمی‌دهد.', 'This browser does not allow changing the audio output.'), 'info');
      });
    }
    refreshCallControls();
  }

  function toggleVideoCall() {
    if (!chatState.localStream || chatState.currentCallMode !== 'video') return;
    chatState.callVideoEnabled = !chatState.callVideoEnabled;
    chatState.localStream.getVideoTracks().forEach((track) => {
      track.enabled = chatState.callVideoEnabled && !chatState.callHeld;
    });
    refreshCallControls();
  }

  async function flipCameraCall() {
    if (!chatState.currentCall || chatState.currentCallMode !== 'video' || !navigator.mediaDevices?.getUserMedia) return;
    const nextFacingMode = chatState.callFacingMode === 'user' ? 'environment' : 'user';
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const nextTrack = replacement.getVideoTracks()[0];
      if (!nextTrack) return;
      const sender = chatState.currentCall.peerConnection?.getSenders?.().find((item) => item.track?.kind === 'video');
      await sender?.replaceTrack(nextTrack);
      const currentVideoTracks = chatState.localStream?.getVideoTracks?.() || [];
      currentVideoTracks.forEach((track) => {
        chatState.localStream?.removeTrack?.(track);
        track.stop();
      });
      chatState.localStream?.addTrack(nextTrack);
      attachLocalStream(chatState.localStream);
      chatState.callFacingMode = nextFacingMode;
      chatState.callVideoEnabled = true;
      refreshCallControls();
      syncCallStageState();
    } catch (error) {
      console.error(error);
      notify(t('تعویض دوربین در این دستگاه/مرورگر ممکن نشد.', 'Could not switch cameras on this device/browser.'), 'warning');
    }
  }

  function endCurrentCall({ closePeer = true } = {}) {
    if (chatState.endingCurrentCall) return;
    chatState.endingCurrentCall = true;
    try {
      const activeCall = chatState.currentCall;
      chatState.currentCall = null;
      if (activeCall) {
        activeCall.peerConnection?.getSenders?.().forEach((sender) => {
          try {
            sender.track?.stop?.();
          } catch (_error) {
            /* noop */
          }
        });
        if (closePeer) {
          try {
            activeCall.close();
          } catch (_error) {
            /* noop */
          }
        }
      }
      chatState.localStream?.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      chatState.remoteStream?.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      stopStream(chatState.localStream);
      stopStream(chatState.remoteStream);
      chatState.localStream = null;
      chatState.remoteStream = null;
      clearMediaElement('chatLocalVideo');
      clearMediaElement('chatRemoteVideo');
      clearMediaElement('chatFloatingLocalVideo');
      clearMediaElement('chatFloatingRemoteVideo');
      clearMediaElement('chatIncomingPreviewVideo');
      chatState.pendingIncomingCall = null;
      chatState.pendingIncomingInvite = null;
      chatState.pendingIncomingAccept = false;
      chatState.currentCallMode = 'voice';
      chatState.callMuted = false;
      chatState.callHeld = false;
      chatState.callSpeakerEnabled = false;
      chatState.callVideoEnabled = true;
      chatState.callFacingMode = 'user';
      chatState.callDisplayMode = 'fullscreen';
      chatState.callPrimaryVideo = 'remote';
      document.getElementById('chatCallStatus').textContent = t('آماده', 'Idle');
      document.getElementById('chatEndCallBtn')?.classList.add('hidden');
      document.getElementById('chatFloatingCall')?.classList.add('hidden');
      document.getElementById('chatFloatingCall')?.style.removeProperty('width');
      document.getElementById('chatFloatingCall')?.style.removeProperty('height');
      document.getElementById('chatFloatingCall')?.style.removeProperty('left');
      document.getElementById('chatFloatingCall')?.style.removeProperty('top');
      document.getElementById('chatFloatingRemoteAvatar')?.classList.remove('hidden');
      document.querySelector('.chat-local-stage')?.classList.remove('has-video');
      hideIncomingCall();
      syncCallChromeState();
      refreshCallControls();
      syncCallStageState();
      renderActivePeer();
    } finally {
      chatState.endingCurrentCall = false;
    }
  }

  function disconnectChat() {
    chatState.shouldReconnect = false;
    clearReconnectTimer();
    if (chatState.heartbeatTimer) {
      clearInterval(chatState.heartbeatTimer);
      chatState.heartbeatTimer = null;
    }
    chatState.ws?.close();
    chatState.ws = null;
    chatState.sessions.forEach((session) => session.connection?.close());
    chatState.sessions.clear();
    if (chatState.peer && !chatState.peer.destroyed) {
      chatState.peer.destroy();
    }
    chatState.peer = null;
    chatState.peerTransportOrigin = '';
    chatState.peerId = '';
    chatState.clientId = '';
    chatState.peers.forEach((peer) => {
      if (!peer.type) peer.status = 'offline';
    });
    saveContacts();
    endCurrentCall();
    setConnectionState(false, t('آفلاین', 'Offline'));
    renderStaticUi();
    renderPeers();
    renderActivePeer();
  }

  async function rotateIdentity() {
    if (!isUnlocked()) return;
    if (!window.confirm(t('بازنشانی کلید چت، سشن‌ها و پیام‌های آفلاین قبلی را غیرقابل بازکردن می‌کند. ادامه می‌دهید؟', 'Resetting the chat key can make previous sessions and offline messages unreadable. Continue?'))) {
      return;
    }
    localStorage.removeItem(CHAT_IDENTITY_STORAGE_KEY);
    localStorage.removeItem(CHAT_SESSION_KEYS_STORAGE_KEY);
    chatState.identity = null;
    chatState.sessionKeys = {};
    chatState.sessions.clear();
    await ensureIdentity();
    renderStaticUi();
    broadcastHello();
    notify(t('کلید هویتی چت بازسازی شد', 'Chat identity key rotated'), 'success');
  }

  function setChatView(view) {
    chatState.activeView = view;
    if (view === 'calls') {
      chatState.activePeerClientId = '';
      chatState.activeConversationId = '';
    }
    updateChatShellMode();
    document.querySelectorAll('[data-chat-view]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-chat-view') === view);
    });
    document.getElementById('chatGroupComposer')?.classList.toggle('hidden', view !== 'groups');
    document.getElementById('chatChannelComposer')?.classList.toggle('hidden', view !== 'channels');
    document.getElementById('chatMessages')?.classList.toggle('hidden', view === 'calls');
    document.getElementById('chatCallsPanel')?.classList.toggle('hidden', view !== 'calls');
    document.querySelector('.chat-composer-bar')?.classList.toggle('hidden', view === 'calls');
    renderPeers();
    renderActivePeer();
  }

  function createSpace(type) {
    const input = document.getElementById(type === 'group' ? 'chatGroupNameInput' : 'chatChannelNameInput');
    const name = input?.value.trim();
    if (!name) return;
    const space = {
      type,
      name,
      conversationId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      members: type === 'group' ? chatState.peers.map((peer) => getConversationKey(peer)) : [],
      createdAt: new Date().toISOString(),
      ownerFingerprint: chatState.identity?.fingerprint || '',
    };
    upsertSharedSpace(space);
    broadcastSpaceRecord(space);
    input.value = '';
    chatState.activeConversationId = space.conversationId;
    chatState.activePeerClientId = '';
    updateChatShellMode();
    setChatView(type === 'group' ? 'groups' : 'channels');
  }

  function updateProfileAvatar(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 512 * 1024) {
      notify(t('تصویر پروفایل باید کمتر از 512 کیلوبایت باشد', 'Profile image must be under 512 KB'), 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      chatState.profile = {
        ...chatState.profile,
        ...buildProfileDraft(),
        avatarData: String(reader.result || ''),
      };
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      renderStaticUi();
      broadcastHello();
    };
    reader.readAsDataURL(file);
  }

  function supportedAudioMimeType() {
    if (!window.MediaRecorder) return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function toggleVoiceRecording() {
    const button = document.getElementById('chatVoiceMessageBtn');
    if (chatState.mediaRecorder?.state === 'recording') {
      chatState.mediaRecorder.stop();
      button?.classList.remove('recording');
      return;
    }

    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      notify(t('ضبط پیام صوتی در این مرورگر پشتیبانی نمی‌شود.', 'Voice recording is not supported in this browser.'), 'warning');
      return;
    }

    const peer = activePeer();
    if (!peer) return;
    let session = activeSession();
    if (!session?.cryptoKey) {
      session = await ensureDirectSession(peer);
    }
    if (!session?.cryptoKey) {
      notify(t('برای پیام صوتی ابتدا سشن امن لازم است.', 'A secure session is required before voice messages.'), 'warning');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedAudioMimeType();
      chatState.recordedChunks = [];
      chatState.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chatState.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chatState.recordedChunks.push(event.data);
      });
      chatState.mediaRecorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((track) => track.stop());
        button?.classList.remove('recording');
        const blob = new Blob(chatState.recordedChunks, { type: chatState.mediaRecorder?.mimeType || 'audio/webm' });
        chatState.mediaRecorder = null;
        chatState.recordedChunks = [];
        if (!blob.size) return;
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const voiceFile = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
        await sendEncryptedBlob(voiceFile, 'voice');
      });
      chatState.mediaRecorder.start();
      button?.classList.add('recording');
      notify(t('ضبط صدا شروع شد؛ برای ارسال دوباره روی میکروفون بزنید.', 'Recording started; tap the microphone again to send.'), 'info');
    } catch (error) {
      console.error(error);
      notify(t('دسترسی به میکروفون ممکن نشد.', 'Could not access microphone.'), 'error');
    }
  }

  function bindDomEvents() {
    if (chatState.initialized) return;
    chatState.initialized = true;
    mountChatPortals();

    document.getElementById('chatSaveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('chatBackToListBtn')?.addEventListener('click', () => {
      chatState.activePeerClientId = '';
      chatState.activeConversationId = '';
      updateChatShellMode();
      renderPeers();
      renderActivePeer();
    });
    document.getElementById('chatProfileAvatarBtn')?.addEventListener('click', () => document.getElementById('chatProfileAvatarInput')?.click());
    document.getElementById('chatProfileAvatarInput')?.addEventListener('change', (event) => {
      updateProfileAvatar(event.target.files?.[0]);
      event.target.value = '';
    });
    ['chatProfileName', 'chatServerUrl', 'chatTurnUrl', 'chatTurnUsername', 'chatTurnCredential'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', syncProfileDraftFromInputs);
    });
    ['chatAutoConnect', 'chatAllowVideo', 'chatAutoDiscovery'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', syncProfileDraftFromInputs);
    });
    document.querySelectorAll('[data-chat-view]').forEach((button) => {
      button.addEventListener('click', () => setChatView(button.getAttribute('data-chat-view') || 'chats'));
    });
    document.getElementById('chatSearchInput')?.addEventListener('input', (event) => {
      chatState.searchQuery = event.target.value || '';
      renderPeers();
      renderMessages();
    });
    document.getElementById('chatCreateGroupBtn')?.addEventListener('click', () => createSpace('group'));
    document.getElementById('chatCreateChannelBtn')?.addEventListener('click', () => createSpace('channel'));
    document.getElementById('chatReconnectBtn')?.addEventListener('click', async () => {
      disconnectChat();
      await connectChatTransport();
    });
    document.getElementById('chatConnectBtn')?.addEventListener('click', connectChatTransport);
    document.getElementById('chatDiscoverLocalBtn')?.addEventListener('click', async () => {
      await discoverLocalRelayServer({ fullScan: true, silent: false });
    });
    document.getElementById('chatResetIdentityBtn')?.addEventListener('click', rotateIdentity);
    document.getElementById('chatStartSessionBtn')?.addEventListener('click', startSecureSession);
    document.getElementById('chatSendMessageBtn')?.addEventListener('click', sendMessage);
    document.getElementById('chatSendFileBtn')?.addEventListener('click', () => document.getElementById('chatFileInput')?.click());
    document.getElementById('chatVoiceMessageBtn')?.addEventListener('click', toggleVoiceRecording);
    document.getElementById('chatComposer')?.addEventListener('input', () => {
      syncComposerDirection();
      syncComposerViewportFocus(true);
    });
    document.getElementById('chatComposer')?.addEventListener('focus', () => {
      syncComposerDirection();
      syncComposerViewportFocus(true);
    });
    document.getElementById('chatComposer')?.addEventListener('blur', () => {
      syncComposerViewportFocus(false);
    });
    document.getElementById('chatTimerToggleBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleTimerPopover();
    });
    document.querySelectorAll('[data-chat-timer]').forEach((button) => {
      button.addEventListener('click', () => setTimerSeconds(Number(button.getAttribute('data-chat-timer') || 0)));
    });
    document.getElementById('chatFileInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await sendFile(file);
      }
      event.target.value = '';
    });
    document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => startCall('voice'));
    document.getElementById('chatVideoCallBtn')?.addEventListener('click', () => startCall('video'));
    document.getElementById('chatEndCallBtn')?.addEventListener('click', endCurrentCall);
    document.getElementById('chatFloatingEndCallBtn')?.addEventListener('click', endCurrentCall);
    document.getElementById('chatEndCallControlBtn')?.addEventListener('click', endCurrentCall);
    document.getElementById('chatMinimizeCallBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCallDisplayMode();
    });
    document.getElementById('chatAcceptCallBtn')?.addEventListener('click', acceptIncomingCall);
    document.getElementById('chatRejectCallBtn')?.addEventListener('click', rejectIncomingCall);
    document.getElementById('chatMuteToggleBtn')?.addEventListener('click', toggleMuteCall);
    document.getElementById('chatHoldToggleBtn')?.addEventListener('click', toggleHoldCall);
    document.getElementById('chatSpeakerToggleBtn')?.addEventListener('click', toggleSpeakerCall);
    document.getElementById('chatVideoToggleBtn')?.addEventListener('click', toggleVideoCall);
    document.getElementById('chatFlipCameraBtn')?.addEventListener('click', flipCameraCall);
    document.getElementById('chatSwapVideoLayoutBtn')?.addEventListener('click', () => {
      chatState.callPrimaryVideo = chatState.callPrimaryVideo === 'remote' ? 'local' : 'remote';
      refreshCallControls();
    });
    document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    document.addEventListener('click', (event) => {
      const popover = document.getElementById('chatTimerPopover');
      const toggle = document.getElementById('chatTimerToggleBtn');
      if (!popover || popover.classList.contains('hidden')) return;
      if (popover.contains(event.target) || toggle?.contains(event.target)) return;
      toggleTimerPopover(false);
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-chat-toggle-reaction]') || event.target.closest('[data-chat-reaction-choice]')) return;
      if (chatState.activeReactionMessageId && !event.target.closest('.chat-message-toolbar') && !event.target.closest('.chat-reaction-picker')) {
        chatState.activeReactionMessageId = '';
        renderMessages();
      }
    });
    document.getElementById('chatFloatingCallHeader')?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      beginFloatingCallDrag(event);
    });
    document.getElementById('chatFloatingCall')?.addEventListener('click', (event) => {
      if (chatState.callDisplayMode !== 'minimized') return;
      if (event.target.closest('button')) return;
      setCallDisplayMode('fullscreen');
    });
    window.addEventListener('pointermove', moveFloatingCallDrag);
    window.addEventListener('pointerup', endFloatingCallDrag);
    window.addEventListener('pointercancel', endFloatingCallDrag);
    window.addEventListener('resize', () => {
      if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
      syncCallOverlayBounds();
    });
    window.visualViewport?.addEventListener('resize', () => {
      if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
      syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
      syncCallOverlayBounds();
    });
    window.visualViewport?.addEventListener('scroll', () => {
      if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
      syncComposerViewportFocus(document.activeElement?.id === 'chatComposer');
      syncCallOverlayBounds();
    });
    window.addEventListener('scroll', () => {
      if (chatState.timerPopoverOpen) requestAnimationFrame(positionTimerPopover);
      syncCallOverlayBounds();
    }, true);

    window.addEventListener('poorija:tab-switched', async (event) => {
      if (event.detail?.tabName === 'chat') {
        renderStaticUi();
        renderPeers();
        renderActivePeer();
        setChatView(chatState.activeView);
        if (isUnlocked() && chatState.profile.autoConnect && !chatState.connected) {
          await connectChatTransport();
        }
      }
    });

    window.addEventListener('poorija:unlock', async () => {
      loadPersistedChatState();
      await ensureIdentity();
      renderStaticUi();
      renderPeers();
      renderActivePeer();
      setChatView(chatState.activeView);
      if (chatState.profile.autoConnect) {
        await connectChatTransport();
      }
    });

    window.addEventListener('poorija:lock', () => {
      disconnectChat();
    });

    window.addEventListener('poorija:language-changed', () => {
      renderStaticUi();
      renderPeers();
      renderActivePeer();
      setChatView(chatState.activeView);
    });

    window.addEventListener('resize', () => {
      if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.length) {
        chatState.activePeerClientId = chatState.peers[0].clientId;
        chatState.activeConversationId = getConversationKey(chatState.peers[0]);
      }
      updateChatShellMode();
      applyFloatingCallPosition();
      syncCallOverlayBounds();
      renderPeers();
      renderActivePeer();
    });

    window.addEventListener('poorija:notifications-enabled', () => {
      registerChatPush(true).catch((error) => console.warn('Web Push registration failed:', error));
    });
  }

  async function initChatModule() {
    if (!document.getElementById('content-chat')) return;
    loadPersistedChatState();
    bindDomEvents();
    renderStaticUi();
    renderPeers();
    renderActivePeer();
    setChatView(chatState.activeView);
    syncTimerUi();
    refreshCallControls();
    if (isUnlocked()) {
      await ensureIdentity();
      renderStaticUi();
      if (chatState.profile.autoConnect && appState()?.activeTab === 'chat') {
        await connectChatTransport();
      }
    }
    setInterval(() => {
      if (pruneExpiredHistory()) {
        storeHistory();
        renderMessages();
        renderPeers();
      }
    }, 30000);
  }

  document.addEventListener('DOMContentLoaded', initChatModule);
})();
