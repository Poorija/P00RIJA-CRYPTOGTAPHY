(function () {
  const CHAT_PROFILE_STORAGE_KEY = 'poorija_chat_profile';
  const CHAT_IDENTITY_STORAGE_KEY = 'poorija_chat_identity';
  const CHAT_HISTORY_STORAGE_KEY = 'poorija_chat_history';
  const CHAT_SESSION_KEYS_STORAGE_KEY = 'poorija_chat_session_keys';
  const CHAT_SPACES_STORAGE_KEY = 'poorija_chat_spaces';
  const CHAT_CALLS_STORAGE_KEY = 'poorija_chat_calls';
  const FILE_CHUNK_SIZE = 48 * 1024;
  const MAX_FILE_BYTES = 16 * 1024 * 1024;
  const SESSION_READY_TIMEOUT_MS = 8000;

  const chatState = {
    initialized: false,
    profile: {
      name: '',
      serverUrl: '',
      autoConnect: true,
      allowVideo: true,
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
    const origin = new URL(chatServerOrigin());
    const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${origin.host}/chat-signal`;
  }

  function peerOptions() {
    const origin = new URL(chatServerOrigin());
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

  async function hydrateRelayTurnConfig() {
    if (chatState.profile.turnUrl) return;
    try {
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

  function getPeerHistoryKey(peerRecord, session = null) {
    if (peerRecord) return getConversationKey(peerRecord);
    return session?.conversationId || session?.remoteFingerprint || session?.peerId || '';
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
    let changed = false;
    chatState.peers = chatState.peers.filter((peer) => {
      const keep = peer.peerId !== peerId;
      if (!keep) changed = true;
      return keep;
    });
    if (chatState.activePeerClientId || chatState.activeConversationId) {
      const stillActive = activePeer();
      if (!stillActive) {
        chatState.activePeerClientId = '';
        chatState.activeConversationId = '';
      }
    }
    if (changed) {
      notify(message || t('این کاربر دیگر در دسترس نیست و از فهرست آنلاین حذف شد.', 'This peer is no longer reachable and was removed from the online list.'), 'warning');
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

  function statusLabel(status) {
    if (status === 'seen') return '✓✓';
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
  }

  function conversationHistory(record) {
    const key = getConversationKey(record);
    return key ? (chatState.history[key] || []) : [];
  }

  function saveSpaces() {
    saveEncrypted(CHAT_SPACES_STORAGE_KEY, chatState.spaces);
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

  function storeHistory() {
    pruneExpiredHistory();
    saveEncrypted(CHAT_HISTORY_STORAGE_KEY, chatState.history);
  }

  function loadPersistedChatState() {
    const savedProfile = loadEncrypted(CHAT_PROFILE_STORAGE_KEY, null);
    if (savedProfile) {
      chatState.profile = { ...chatState.profile, ...savedProfile };
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
  }

  function saveProfile() {
    const profile = {
      name: document.getElementById('chatProfileName')?.value.trim() || chatState.profile.name,
      serverUrl: document.getElementById('chatServerUrl')?.value.trim() || chatState.profile.serverUrl || window.location.origin,
      autoConnect: Boolean(document.getElementById('chatAutoConnect')?.checked),
      allowVideo: Boolean(document.getElementById('chatAllowVideo')?.checked),
      avatarData: chatState.profile.avatarData || '',
      stablePeerId: chatState.profile.stablePeerId || generateId('poorija-peer').replace(/[^a-zA-Z0-9_-]/g, '-'),
      turnUrl: document.getElementById('chatTurnUrl')?.value.trim() || '',
      turnUsername: document.getElementById('chatTurnUsername')?.value.trim() || '',
      turnCredential: document.getElementById('chatTurnCredential')?.value || '',
    };
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
      status.textContent = label;
    }
  }

  function syncComposerDirection() {
    const composer = document.getElementById('chatComposer');
    if (!composer) return;
    composer.dir = language() === 'fa' ? 'rtl' : 'ltr';
  }

  function renderStaticUi() {
    if (!document.getElementById('content-chat')) return;

    document.getElementById('chatProfileName').value = chatState.profile.name || '';
    document.getElementById('chatProfileName').placeholder = t('نام نمایشی', 'Display name');
    document.getElementById('chatServerUrl').value = chatState.profile.serverUrl || window.location.origin;
    document.getElementById('chatAutoConnect').checked = Boolean(chatState.profile.autoConnect);
    document.getElementById('chatAllowVideo').checked = Boolean(chatState.profile.allowVideo);
    document.getElementById('chatTurnUrl').value = chatState.profile.turnUrl || '';
    document.getElementById('chatTurnUsername').value = chatState.profile.turnUsername || '';
    document.getElementById('chatTurnCredential').value = chatState.profile.turnCredential || '';
    document.getElementById('chatSearchInput').placeholder = t('جستجو در چت‌ها و پیام‌ها', 'Search chats and messages');
    document.getElementById('chatComposer').placeholder = t('پیام رمزنگاری‌شده بنویسید...', 'Write an encrypted message...');
    document.getElementById('chatPeerId').textContent = chatState.peerId || chatState.clientId || '-';
    document.getElementById('chatFingerprint').textContent = chatState.identity?.fingerprint?.slice(0, 24) || '-';
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
    const onlinePeers = chatState.peers.filter((peer) => peer.peerId && peer.clientId !== chatState.clientId);
    let records = onlinePeers;
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
      return `
      <button type="button" data-chat-conversation="${app().escapeHTML(key)}" data-chat-peer="${app().escapeHTML(record.clientId || '')}" class="chat-peer-card w-full text-right ${active ? 'active' : ''}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="chat-avatar">${record.avatarData ? `<img src="${record.avatarData}" alt="">` : app().escapeHTML(initials(displayName))}</div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <div class="font-semibold text-white truncate">${app().escapeHTML(displayName)}</div>
              ${isSecure ? '<span class="text-emerald-300 text-xs"><i class="fas fa-lock"></i></span>' : ''}
            </div>
            <div class="text-xs text-slate-400 truncate mt-1">${app().escapeHTML(last?.text || last?.name || record.peerId || record.type || '-')}</div>
          </div>
          <span class="text-[11px] text-slate-500">${last ? formatTime(last.createdAt) : ''}</span>
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

    const rows = chatState.calls.length
      ? chatState.calls.map((call) => `
        <div class="chat-peer-card">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold text-white truncate">${app().escapeHTML(call.name || call.peerId || '-')}</div>
              <div class="text-xs text-slate-400 mt-1">${app().escapeHTML(call.mode || 'call')} · ${app().escapeHTML(call.status || '')}</div>
            </div>
            <span class="text-xs text-slate-500">${formatTime(call.createdAt)}</span>
          </div>
        </div>
      `).join('')
      : `<div class="chat-empty-state">${t('هنوز تماسی ثبت نشده است.', 'No calls yet.')}</div>`;

    if (list) list.innerHTML = rows;
    if (callsPanelList) callsPanelList.innerHTML = rows;
  }

  function renderMessages() {
    pruneExpiredHistory();
    const peer = getActiveConversation();
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

    panel.innerHTML = history.map((entry) => {
      const meta = `
        <div class="chat-message-meta">
          <span>${formatTime(entry.createdAt)}</span>
          ${entry.expiresAt ? `<span><i class="fas fa-clock"></i> ${formatTime(entry.expiresAt)}</span>` : ''}
          ${entry.direction === 'out' ? `<span>${statusLabel(entry.status)}</span>` : ''}
        </div>`;
      const reactions = `
        <div class="chat-reactions">
          ${['👍', '❤️', '🔒'].map((emoji) => `<button type="button" data-chat-reaction="${entry.id}" data-reaction="${emoji}" class="${entry.reaction === emoji ? 'active' : ''}">${emoji}</button>`).join('')}
        </div>`;
      if (entry.type === 'voice') {
        return `
          <div class="chat-message-bubble ${entry.direction === 'out' ? 'me' : 'them'} ${entry.expiresAt ? 'expiring' : ''}">
            <div class="chat-voice-message">
              <div class="font-semibold">${t('پیام صوتی رمزنگاری‌شده', 'Encrypted voice message')}</div>
              ${entry.downloadUrl ? `<audio controls src="${entry.downloadUrl}"></audio>` : `<div class="text-xs text-slate-400">${t('فایل صوتی در این دستگاه ذخیره نشده است.', 'Voice payload is not stored on this device.')}</div>`}
            </div>
            ${reactions}
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
            ${entry.downloadUrl ? `<a href="${entry.downloadUrl}" download="${app().escapeHTML(entry.name || 'file.bin')}" class="inline-flex mt-3 px-3 py-2 rounded-xl bg-sky-500 text-white text-sm">${t('دانلود فایل', 'Download file')}</a>` : ''}
            ${reactions}
            ${meta}
          </div>
        `;
      }

      return `
        <div class="chat-message-bubble ${entry.direction === 'out' ? 'me' : 'them'} ${entry.expiresAt ? 'expiring' : ''}">
          <div class="text-sm whitespace-pre-wrap">${app().escapeHTML(entry.text || '')}</div>
          ${reactions}
          ${meta}
        </div>
      `;
    }).join('');

    panel.querySelectorAll('[data-chat-reaction]').forEach((button) => {
      button.addEventListener('click', () => {
        const entryId = button.getAttribute('data-chat-reaction');
        const reaction = button.getAttribute('data-reaction');
        const entry = (chatState.history[conversationKey] || []).find((item) => item.id === entryId);
        if (!entry) return;
        entry.reaction = entry.reaction === reaction ? '' : reaction;
        const session = activeSession();
        if (session?.connection?.open && peer && !peer.type) {
          session.connection.send({
            type: 'reaction',
            messageId: entryId,
            reaction: entry.reaction,
            createdAt: new Date().toISOString(),
          });
        }
        storeHistory();
        renderMessages();
      });
    });

    panel.scrollTop = panel.scrollHeight;
  }

  function renderActivePeer() {
    updateChatShellMode();
    const peer = getActiveConversation();
    const directPeer = activePeer();
    const session = activeSession();
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
    peerName.textContent = displayName;
    peerMeta.textContent = peer.type
      ? `${peer.type} • ${t('محلی و رمزنگاری‌شده', 'local encrypted space')}`
      : `${peer.peerId} • ${t('آخرین وضعیت', 'Status')}: ${peer.status || 'online'}`;
    const activeAvatar = document.getElementById('chatActiveAvatar');
    if (activeAvatar) {
      activeAvatar.innerHTML = peer.avatarData ? `<img src="${peer.avatarData}" alt="">` : app().escapeHTML(initials(displayName));
    }
    remoteFingerprint.textContent = peer.fingerprint || peer.conversationId || '-';
    keyMode.textContent = sessionSecurityText(session);
    connectBtn.disabled = Boolean(peer.type) || !chatState.connected || !chatState.peer;
    sendBtn.disabled = Boolean(!peer.type && (!chatState.connected || !chatState.peer));
    sendFileBtn.disabled = !peer.type && !session?.cryptoKey;
    if (voiceMessageBtn) voiceMessageBtn.disabled = Boolean(!peer.type && (!chatState.connected || !chatState.peer));
    voiceBtn.disabled = Boolean(peer.type === 'channel') || !chatState.connected || !chatState.peer;
    videoBtn.disabled = Boolean(peer.type === 'channel') || !chatState.connected || !chatState.peer || !chatState.profile.allowVideo;
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

  function sendDeliveryAck(session, messageId, status) {
    if (!session?.connection?.open || !messageId) return;
    session.connection.send({
      type: 'receipt',
      messageId,
      status,
      createdAt: new Date().toISOString(),
    });
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
        id: generateId('msg'),
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
        entry.reaction = message.reaction || '';
        storeHistory();
        renderMessages();
      }
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
          id: generateId('file'),
          direction: 'in',
          type: transfer.meta.kind === 'voice' ? 'voice' : 'file',
          name: transfer.meta.name,
          size: transfer.meta.size,
          status: 'delivered',
          createdAt: transfer.meta.createdAt || new Date().toISOString(),
          downloadUrl: url,
        });
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
    const existing = chatState.peers.find((item) => item.clientId === peer.clientId);
    if (existing) {
      Object.assign(existing, peer);
    } else {
      chatState.peers.push(peer);
    }
    chatState.peers = chatState.peers.filter((item) => item.peerId !== chatState.peerId);
    if (!isCompactChatLayout() && !chatState.activePeerClientId && !chatState.activeConversationId && chatState.peers.length) {
      chatState.activePeerClientId = chatState.peers[0].clientId;
      chatState.activeConversationId = getConversationKey(chatState.peers[0]);
    }
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
        chatState.peers = (message.peers || []).filter((peer) => peer.clientId !== chatState.clientId);
        renderPeers();
        renderActivePeer();
        return;
      }

      if (message.type === 'relay' && message.payload?.type === 'call-invite') {
        notify(t(`درخواست تماس ${message.payload.mode === 'video' ? 'تصویری' : 'صوتی'} دریافت شد`, `Incoming ${message.payload.mode === 'video' ? 'video' : 'voice'} call request`), 'info');
        appendCall({
          name: message.payload.name || message.fromClientId,
          peerId: message.fromClientId,
          mode: message.payload.mode,
          status: 'ringing',
        });
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
      if (chatState.heartbeatTimer) clearInterval(chatState.heartbeatTimer);
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

    await ensureIdentity();
    await hydrateRelayTurnConfig();
    chatState.shouldReconnect = true;
    renderStaticUi();

    if (chatState.peer && !chatState.peer.destroyed) {
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
    const timerSeconds = Number(document.getElementById('chatTimerSelect')?.value || 0);
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
    if (!session?.cryptoKey) {
      notify(t('در حال ساخت سشن امن برای ارسال پیام...', 'Creating secure session before sending...'), 'info');
      session = await ensureDirectSession(directPeer);
    }

    if (!session?.cryptoKey) {
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
    appendHistory(getConversationKey(directPeer), {
      id: messageId,
      direction: 'out',
      type: 'text',
      text,
      status: session.connection?.open ? 'sent' : 'queued',
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    composer.value = '';
  }

  async function sendEncryptedBlob(file, kind = 'file') {
    let session = activeSession();
    const peer = activePeer();
    if (!peer || !file) return;
    if (!session?.cryptoKey) {
      session = await ensureDirectSession(peer);
    }
    if (!session?.cryptoKey) {
      notify(t('برای ارسال فایل/صدا باید سشن امن آماده باشد.', 'A secure session is required before sending files or voice messages.'), 'warning');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      notify(t('فعلاً فقط فایل‌های تا 16 مگابایت پشتیبانی می‌شوند', 'Files are currently limited to 16 MB'), 'warning');
      return;
    }

    const encrypted = await encryptForSession(session, await file.arrayBuffer());
    const transferId = generateId('transfer');
    const totalChunks = Math.ceil(encrypted.cipher.length / FILE_CHUNK_SIZE);

    session.connection.send({
      type: 'file-start',
      transferId,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      kind,
      size: file.size,
      totalChunks,
      iv: encrypted.iv,
      createdAt: new Date().toISOString(),
    });

    for (let index = 0; index < totalChunks; index += 1) {
      session.connection.send({
        type: 'file-chunk',
        transferId,
        index,
        chunk: encrypted.cipher.slice(index * FILE_CHUNK_SIZE, (index + 1) * FILE_CHUNK_SIZE),
      });
    }

    const localUrl = kind === 'voice' ? URL.createObjectURL(file) : '';
    appendHistory(getConversationKey(peer), {
      id: generateId(kind === 'voice' ? 'voice' : 'file'),
      direction: 'out',
      type: kind,
      name: file.name,
      size: file.size,
      downloadUrl: localUrl,
      status: 'sent',
      createdAt: new Date().toISOString(),
    });
  }

  async function sendFile(file) {
    return sendEncryptedBlob(file, 'file');
  }

  function attachLocalStream(stream) {
    chatState.localStream = stream;
    const localVideo = document.getElementById('chatLocalVideo');
    const floatingLocalVideo = document.getElementById('chatFloatingLocalVideo');
    if (localVideo) {
      localVideo.srcObject = stream;
    }
    if (floatingLocalVideo) {
      floatingLocalVideo.srcObject = stream;
    }
  }

  function attachRemoteStream(stream) {
    chatState.remoteStream = stream;
    const remoteVideo = document.getElementById('chatRemoteVideo');
    const floatingRemoteVideo = document.getElementById('chatFloatingRemoteVideo');
    if (remoteVideo) {
      remoteVideo.srcObject = stream;
    }
    if (floatingRemoteVideo) {
      floatingRemoteVideo.srcObject = stream;
    }
  }

  function showIncomingCall(call) {
    chatState.pendingIncomingCall = call;
    const mode = call.metadata?.mode || 'voice';
    const name = call.metadata?.username || call.peer;
    document.getElementById('chatIncomingCallTitle').textContent = mode === 'video'
      ? t('تماس تصویری ورودی', 'Incoming video call')
      : t('تماس صوتی ورودی', 'Incoming voice call');
    document.getElementById('chatIncomingCallMeta').textContent = t(`${name} می‌خواهد تماس امن برقرار کند.`, `${name} wants to start a secure call.`);
    document.getElementById('chatIncomingCallAvatar').textContent = initials(name);
    document.getElementById('chatIncomingCallModal').classList.remove('hidden');
  }

  function hideIncomingCall() {
    document.getElementById('chatIncomingCallModal')?.classList.add('hidden');
    chatState.pendingIncomingCall = null;
  }

  async function acceptIncomingCall() {
    const call = chatState.pendingIncomingCall;
    if (!call) return;
    hideIncomingCall();
    try {
      const wantsVideo = call.metadata?.mode === 'video';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo });
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
    if (call) {
      appendCall({
        name: call.metadata?.username || call.peer,
        peerId: call.peer,
        mode: call.metadata?.mode || 'voice',
        status: 'missed',
      });
      call.close();
    }
    hideIncomingCall();
  }

  function bindMediaCall(call, mode) {
    chatState.currentCall = call;
    const callLabel = mode === 'video'
      ? t('تماس تصویری فعال', 'Video call active')
      : t('تماس صوتی فعال', 'Voice call active');
    document.getElementById('chatCallStatus').textContent = callLabel;
    document.getElementById('chatFloatingCallTitle').textContent = callLabel;
    document.getElementById('chatFloatingCallStatus').textContent = t('اتصال امن برقرار است', 'Secure call is active');
    document.getElementById('chatFloatingCall').classList.remove('hidden');
    document.getElementById('chatEndCallBtn').classList.remove('hidden');

    call.on('stream', (stream) => {
      attachRemoteStream(stream);
    });

    call.on('close', () => {
      endCurrentCall();
    });

    call.on('error', (error) => {
      console.error(error);
      endCurrentCall();
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
          endCurrentCall();
        }
      });
    }
  }

  async function startCall(mode) {
    const active = getActiveConversation();
    if (active?.type === 'group') {
      const members = (active.members || [])
        .map((memberId) => chatState.peers.find((peer) => getConversationKey(peer) === memberId || peer.peerId === memberId))
        .filter(Boolean);
      for (const member of members) {
        chatState.activePeerClientId = member.clientId;
        chatState.activeConversationId = getConversationKey(member);
        await startCall(mode);
      }
      chatState.activeConversationId = active.conversationId;
      chatState.activePeerClientId = '';
      renderActivePeer();
      return;
    }
    const peerRecord = activePeer();
    if (!peerRecord || !chatState.peer) {
      notify(t('برای تماس ابتدا به سرور چت وصل شوید و یک کاربر را انتخاب کنید.', 'Connect to chat and select a peer before calling.'), 'warning');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      });
      attachLocalStream(stream);
      const call = chatState.peer.call(peerRecord.peerId, stream, {
        metadata: {
          mode,
          username: chatState.profile.name,
        },
      });
      sendRelayEnvelope(peerRecord, {
        type: 'call-invite',
        mode,
        name: chatState.profile.name || t('کاربر P00RIJA', 'P00RIJA User'),
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

  function endCurrentCall() {
    if (chatState.currentCall) {
      chatState.currentCall.close();
      chatState.currentCall = null;
    }
    if (chatState.localStream) {
      chatState.localStream.getTracks().forEach((track) => track.stop());
      chatState.localStream = null;
    }
    const localVideo = document.getElementById('chatLocalVideo');
    const remoteVideo = document.getElementById('chatRemoteVideo');
    const floatingLocalVideo = document.getElementById('chatFloatingLocalVideo');
    const floatingRemoteVideo = document.getElementById('chatFloatingRemoteVideo');
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (floatingLocalVideo) floatingLocalVideo.srcObject = null;
    if (floatingRemoteVideo) floatingRemoteVideo.srcObject = null;
    chatState.remoteStream = null;
    document.getElementById('chatCallStatus').textContent = t('آماده', 'Idle');
    document.getElementById('chatEndCallBtn')?.classList.add('hidden');
    document.getElementById('chatFloatingCall')?.classList.add('hidden');
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
    chatState.peerId = '';
    chatState.clientId = '';
    chatState.peers = [];
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
    };
    if (type === 'group') chatState.spaces.groups.unshift(space);
    else chatState.spaces.channels.unshift(space);
    saveSpaces();
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
      chatState.profile.avatarData = String(reader.result || '');
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
    document.getElementById('chatResetIdentityBtn')?.addEventListener('click', rotateIdentity);
    document.getElementById('chatStartSessionBtn')?.addEventListener('click', startSecureSession);
    document.getElementById('chatSendMessageBtn')?.addEventListener('click', sendMessage);
    document.getElementById('chatSendFileBtn')?.addEventListener('click', () => document.getElementById('chatFileInput')?.click());
    document.getElementById('chatVoiceMessageBtn')?.addEventListener('click', toggleVoiceRecording);
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
    document.getElementById('chatAcceptCallBtn')?.addEventListener('click', acceptIncomingCall);
    document.getElementById('chatRejectCallBtn')?.addEventListener('click', rejectIncomingCall);
    document.getElementById('chatComposer')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

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
