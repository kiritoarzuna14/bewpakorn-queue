import {NativeClient} from './native.js';
import {scanOrders, openAndReadOrder, readOrderMetadata, defaultCatalog, discoverCatalog} from './shop.js';
import {selectPending, validateCatalog, operatorPool} from './queue.js';
import {createNotifier, blockerRoles} from './notifications.js';

const ROBLOX_LOGIN_URL = 'https://www.roblox.com/login';
const ROBLOX_HOME_URL = 'https://www.roblox.com/';
const ROBLOX_COOKIE_NAME = '.ROBLOSECURITY';

const state = {
  connection: 'disconnected',
  phase: 'idle',
  native: null,
  queue: [],
  configured: false,
  completionPending: false,
  mutationPending: false,
  accounts: [],
  capabilities: null,
  browserNotice: null,
  hasCredentials: false
};

let busy = false;
let starting = false;
let syncPromise = null;
let latestRevision = -1;
let accountsPromise = null, importedIdentity = '';
// Transient in-memory credentials for 1-click Copy in Side Panel only; never persisted or broadcast.
let activeCredentials = null;
let robloxLoginTabId = null;
let cookieCheckInFlight = false;
let cookieCheckQueued = false;
let cookieDebounceTimer = null;
let ramSyncTimer = null;
let rejectedCookieKey = '';
let autoSubmittedKey = '';
let autoFillInFlight = false;

const notifyOnce = createNotifier(chrome);
const allowedCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN_ERROR';
const ownsJob = job => state.native?.current?.jobId === job.jobId && state.native.current.generation === job.generation;
const legacyCode = code => /^(PAIR_|PRIVATE_TARGET_)/.test(code || '');
const identityOf = job => job ? {jobId: job.jobId, orderId: job.order.orderId, generation: job.generation, completionToken: job.completionToken} : null;
const sameIdentity = (a, b) => a === null ? b === null : !!b && ['jobId', 'orderId', 'generation', 'completionToken'].every(k => a[k] === b[k]);
const historyTarget = () => state.native?.historyTarget || state.native?.handled?.at(-1) || null;
const protectedIds = cfg => [...new Set([...(cfg.protectedOperatorUserIds || []), ...(cfg.catalog || []).flatMap(p => [...operatorPool(p), p.privateServerSourceUserId || p.operatorUserId].filter(Boolean))])];

function clearActiveCredentials() {
  activeCredentials = null;
  state.hasCredentials = false;
}

function isRobloxUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname === 'roblox.com' || u.hostname.endsWith('.roblox.com'));
  } catch { return false; }
}

function cookieDetails(cookie) {
  const domain = cookie.domain.replace(/^\./, '');
  const details = {url: 'https://' + domain + (cookie.path || '/'), name: ROBLOX_COOKIE_NAME, storeId: cookie.storeId};
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  return details;
}

function sameCookie(a, b) {
  return Boolean(a && b && a.value === b.value && a.domain === b.domain && a.path === b.path && a.storeId === b.storeId);
}

async function openRobloxLoginTab({focus = true, navigate = true} = {}) {
  if (!chrome.tabs?.query || !chrome.tabs?.create) return null;
  const focusTab = async tab => {
    if (!tab) return null;
    const update = {};
    if (focus) update.active = true;
    if (navigate) {
      let onLogin = false;
      try { const u = new URL(tab.url || ''); onLogin = u.hostname === 'www.roblox.com' && u.pathname.startsWith('/login'); } catch {}
      if (!onLogin) update.url = ROBLOX_LOGIN_URL;
    }
    if (Object.keys(update).length) await chrome.tabs.update(tab.id, update);
    if (focus && tab.windowId !== undefined) await chrome.windows?.update?.(tab.windowId, {focused: true}).catch?.(() => {});
    robloxLoginTabId = tab.id;
    return tab.id;
  };
  if (robloxLoginTabId !== null) {
    try {
      const existing = await chrome.tabs.get(robloxLoginTabId);
      if (existing && (isRobloxUrl(existing.url) || existing.url === 'about:blank')) return await focusTab(existing);
    } catch { robloxLoginTabId = null; }
  }
  try {
    const tabs = await chrome.tabs.query({url: ['https://roblox.com/*', 'https://*.roblox.com/*']});
    const candidate = tabs.find(t => isRobloxUrl(t.url));
    if (candidate) return await focusTab(candidate);
  } catch {}
  const created = await chrome.tabs.create({url: ROBLOX_LOGIN_URL, active: focus});
  robloxLoginTabId = created?.id ?? null;
  return robloxLoginTabId;
}

// Self-contained functions injected strictly into https://www.roblox.com/login.
// Never bypasses, clicks, or interacts with any CAPTCHA/human-verification modal.
function fillRobloxLoginInPage(username, password) {
  if (location.origin !== 'https://www.roblox.com' || !location.pathname.toLowerCase().startsWith('/login')) return 'NOT_LOGIN_PAGE';
  const visible = sel => Array.from(document.querySelectorAll(sel)).some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible('[role="dialog"],[aria-modal="true"],iframe[src*="captcha"],iframe[src*="arkoselabs"],[data-testid*="captcha"]')) return 'CHALLENGE';
  const u = document.querySelector('#login-username');
  const p = document.querySelector('#login-password');
  const legacy = document.querySelector('#login-button');
  const formButtons = p?.form ? Array.from(p.form.querySelectorAll('button[type="submit"]')) : [];
  const named = Array.from(document.querySelectorAll('button')).filter(e => e.type === 'submit' && /^(sign in|log in|เข้าสู่ระบบ|ลงชื่อเข้าใช้)$/i.test((e.textContent || '').trim()));
  const b = legacy || (formButtons.length === 1 ? formButtons[0] : named.length === 1 ? named[0] : null);
  if (!u || !p || !b || u.disabled || p.disabled || u.readOnly || p.readOnly) return 'NOT_READY';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return 'NOT_READY';
  const setReactInput = (el, val) => {
    el.focus();
    const prev = el.value;
    setter.call(el, val);
    if (el._valueTracker) el._valueTracker.setValue(prev);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  };
  setReactInput(u, username);
  setReactInput(p, password);
  return (u.value === username && p.value === password) ? 'FILLED' : 'FILL_MISMATCH';
}

function submitRobloxLoginInPage(expectedUsername, expectedPassword) {
  if (location.origin !== 'https://www.roblox.com' || !location.pathname.toLowerCase().startsWith('/login')) return 'NOT_LOGIN_PAGE';
  const visible = sel => Array.from(document.querySelectorAll(sel)).some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (visible('[role="dialog"],[aria-modal="true"],iframe[src*="captcha"],iframe[src*="arkoselabs"],[data-testid*="captcha"]')) return 'CHALLENGE';
  const u = document.querySelector('#login-username');
  const p = document.querySelector('#login-password');
  const legacy = document.querySelector('#login-button');
  const formButtons = p?.form ? Array.from(p.form.querySelectorAll('button[type="submit"]')) : [];
  const named = Array.from(document.querySelectorAll('button')).filter(e => e.type === 'submit' && /^(sign in|log in|เข้าสู่ระบบ|ลงชื่อเข้าใช้)$/i.test((e.textContent || '').trim()));
  const b = legacy || (formButtons.length === 1 ? formButtons[0] : named.length === 1 ? named[0] : null);
  if (!u || !p || !b) return 'NOT_READY';
  if (u.value !== expectedUsername || p.value !== expectedPassword) return 'FILL_MISMATCH';
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'PENDING';
  b.click();
  return 'CLICKED';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForRobloxLoginTab(tabId, job, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!ownsJob(job) || state.native?.current?.customer?.state !== 'preparing') return false;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return false; }
    if (tab?.status === 'complete') {
      try {
        const u = new URL(tab.url || '');
        if (u.origin === 'https://www.roblox.com' && u.pathname.toLowerCase().startsWith('/login')) return true;
        if (!isRobloxUrl(tab.url || '')) return false;
      } catch { return false; }
    }
    await sleep(200);
  }
  return false;
}

async function autoFillAndSubmitRobloxLogin(job, credentials) {
  if (!chrome.scripting?.executeScript || !chrome.tabs?.get || !credentials?.username || !credentials?.password) return 'UNAVAILABLE';
  const key = `${job.jobId}:${job.generation}`;
  if (autoFillInFlight || autoSubmittedKey === key) return 'SKIPPED';
  if (!ownsJob(job) || state.native?.current?.customer?.state !== 'preparing' || state.browserNotice?.code === 'CUSTOMER_ID_MISMATCH') return 'SKIPPED';
  autoFillInFlight = true;
  try {
    const tabId = await openRobloxLoginTab({focus: true, navigate: true});
    if (tabId === null) return 'UNAVAILABLE';
    const ready = await waitForRobloxLoginTab(tabId, job, 20000);
    if (!ready) return 'NOT_LOGIN_PAGE';
    if (!ownsJob(job) || state.native?.current?.customer?.state !== 'preparing' || state.browserNotice?.code === 'CUSTOMER_ID_MISMATCH') return 'SKIPPED';

    let filled = false;
    const fillDeadline = Date.now() + 15000;
    while (Date.now() < fillDeadline) {
      if (!ownsJob(job) || state.native?.current?.customer?.state !== 'preparing') return 'CANCELLED';
      let outcome;
      try {
        const res = await chrome.scripting.executeScript({target: {tabId}, func: fillRobloxLoginInPage, args: [credentials.username, credentials.password]});
        outcome = res?.[0]?.result;
      } catch { return 'SCRIPT_FAILED'; }
      if (outcome === 'FILLED') { filled = true; break; }
      if (outcome === 'CHALLENGE' || outcome === 'NOT_LOGIN_PAGE') return outcome;
      await sleep(250);
    }
    if (!filled) return 'FORM_TIMEOUT';

    const submitDeadline = Date.now() + 5000;
    while (Date.now() < submitDeadline) {
      if (!ownsJob(job) || state.native?.current?.customer?.state !== 'preparing') return 'CANCELLED';
      autoSubmittedKey = key;
      let outcome;
      try {
        const res = await chrome.scripting.executeScript({target: {tabId}, func: submitRobloxLoginInPage, args: [credentials.username, credentials.password]});
        outcome = res?.[0]?.result;
      } catch { return 'SCRIPT_FAILED'; }
      if (outcome === 'CLICKED') return 'CLICKED';
      if (outcome === 'PENDING') {
        autoSubmittedKey = '';
        await sleep(200);
        continue;
      }
      if (outcome === 'CHALLENGE' || outcome === 'NOT_LOGIN_PAGE' || outcome === 'FILL_MISMATCH') {
        if (outcome === 'CHALLENGE') autoSubmittedKey = key;
        return outcome;
      }
      return outcome || 'SCRIPT_FAILED';
    }
    return 'SUBMIT_TIMEOUT';
  } finally {
    autoFillInFlight = false;
  }
}

async function clearChromeRobloxCookie(expectedCookie = null, {redirect = true} = {}) {
  if (!chrome.cookies?.get || !chrome.cookies?.remove) return false;
  let storeId = expectedCookie?.storeId;
  if (expectedCookie) {
    const details = cookieDetails(expectedCookie);
    const current = await chrome.cookies.get(details);
    if (!sameCookie(current, expectedCookie)) return false;
    await chrome.cookies.remove(details);
  } else {
    let all = [];
    if (chrome.cookies.getAll) {
      all = (await chrome.cookies.getAll({name: ROBLOX_COOKIE_NAME})).filter(c => {
        const d = (c.domain || '').toLowerCase();
        return d === 'roblox.com' || d.endsWith('.roblox.com');
      });
    } else {
      const single = await chrome.cookies.get({url: ROBLOX_HOME_URL, name: ROBLOX_COOKIE_NAME});
      if (single) all = [single];
    }
    for (const c of all) {
      storeId = storeId || c.storeId;
      await chrome.cookies.remove(cookieDetails(c));
    }
  }
  if (redirect && chrome.tabs?.query && chrome.tabs?.update) {
    try {
      const tabs = await chrome.tabs.query({url: ['https://roblox.com/*', 'https://*.roblox.com/*']});
      let target = tabs.find(t => t.id === robloxLoginTabId) || tabs.find(t => t.active && isRobloxUrl(t.url)) || tabs.find(t => isRobloxUrl(t.url));
      if (target) await chrome.tabs.update(target.id, {url: ROBLOX_LOGIN_URL});
    } catch {}
  }
  return true;
}

function stopRamSyncPolling() {
  if (ramSyncTimer) {
    clearInterval(ramSyncTimer);
    ramSyncTimer = null;
  }
}

function shouldPollBrowserLogin() {
  const job = state.native?.current;
  return Boolean(
    state.connection === 'connected' &&
    job &&
    job.customer?.source !== 'ram' &&
    job.customer?.state === 'preparing' &&
    job.customer?.loginMode === 'browser' &&
    chrome.cookies?.get
  );
}

function ensureRamSyncPolling() {
  if (!shouldPollBrowserLogin()) {
    stopRamSyncPolling();
    return;
  }
  if (ramSyncTimer) return;
  ramSyncTimer = setInterval(() => {
    if (!shouldPollBrowserLogin()) {
      stopRamSyncPolling();
      return;
    }
    tryCaptureBrowserSession().catch(() => {});
    syncRamCustomerOnce().catch(() => {});
  }, 2000);
  ramSyncTimer.unref?.();
}

async function syncRamCustomerOnce() {
  const job = state.native?.current;
  if (!job || job.customer?.source === 'ram' || job.customer?.state !== 'preparing' || job.customer?.loginMode !== 'browser' || state.connection !== 'connected') return false;
  const username = job.customer?.username || job.order?.customerUsername;
  if (!username) return false;
  try {
    const reply = await native.request('SYNC_RAM_CUSTOMER', {jobId: job.jobId, generation: job.generation, username});
    if (reply?.snapshot) snapshot(reply.snapshot);
    if (reply?.synced) {
      clearActiveCredentials();
      state.browserNotice = null;
      rejectedCookieKey = '';
      stopRamSyncPolling();
      broadcast();
      return true;
    }
  } catch (error) {
    if (error?.kind === 'application' && error.message === 'ROLE_CONFLICT') issue('ROLE_CONFLICT');
  }
  return false;
}

async function tryCaptureBrowserSession(storeId) {
  if (!chrome.cookies?.get) return false;
  if (state.connection !== 'connected' || !state.native) {
    try { await sync({advance: false}); } catch { return false; }
  }
  const job = state.native?.current;
  if (!job || job.customer?.source === 'ram' || job.customer?.state !== 'preparing' || state.connection !== 'connected') return false;
  const username = job.customer?.username || job.order?.customerUsername;
  if (!username) return false;
  if (cookieCheckInFlight) {
    cookieCheckQueued = true;
    return false;
  }
  cookieCheckInFlight = true;
  try {
    const query = {url: ROBLOX_HOME_URL, name: ROBLOX_COOKIE_NAME};
    if (storeId) query.storeId = storeId;
    const cookie = await chrome.cookies.get(query);
    if (!cookie?.value) {
      if (state.browserNotice?.code === 'CUSTOMER_ID_MISMATCH') {
        state.browserNotice = null;
        broadcast();
      }
      return false;
    }
    const key = `${job.jobId}:${job.generation}:${cookie.value}`;
    if (key === rejectedCookieKey) return false;
    const reply = await native.request('IMPORT_BROWSER_SESSION', {
      jobId: job.jobId,
      generation: job.generation,
      username,
      cookie: cookie.value
    });
    if (reply?.snapshot) snapshot(reply.snapshot);
    if (reply?.matched && reply?.imported) {
      clearActiveCredentials();
      state.browserNotice = null;
      rejectedCookieKey = '';
      stopRamSyncPolling();
      if (reply.canClearBrowserCookie) {
        await clearChromeRobloxCookie(cookie, {redirect: true}).catch(() => {});
      }
      broadcast();
      return true;
    }
    if (reply?.code === 'CUSTOMER_ID_MISMATCH') {
      rejectedCookieKey = key;
      state.browserNotice = {
        code: 'CUSTOMER_ID_MISMATCH',
        actualUsername: reply.actualUsername || '',
        expectedUsername: username
      };
      broadcast();
      return false;
    }
    if (reply?.code === 'CUSTOMER_SESSION_INVALID') {
      rejectedCookieKey = key;
      return false;
    }
    return false;
  } catch (error) {
    if (error?.kind === 'application' && ['ROLE_CONFLICT', 'RAM_IMPORT_UNCERTAIN', 'RAM_RECEIVER_UNAVAILABLE', 'RAM_RECEIVER_AMBIGUOUS', 'RAM_IMPORT_FAILED', 'RAM_PERSISTENCE_UNVERIFIED'].includes(error.message)) {
      issue(error.message);
    }
    return false;
  } finally {
    cookieCheckInFlight = false;
    if (cookieCheckQueued) {
      cookieCheckQueued = false;
      queueMicrotask(() => { tryCaptureBrowserSession().catch(() => {}); });
    }
  }
}

async function accounts() {
  if (accountsPromise) return accountsPromise;
  accountsPromise = (async () => {
    const result = await native.request('GET_ACCOUNT_METADATA');
    state.accounts = (result.accounts || []).filter(a => /^\d+$/.test(String(a.userId))).map(a => ({userId: String(a.userId), username: typeof a.username === 'string' ? a.username : ''}));
    broadcast();
    return {accounts: state.accounts};
  })().finally(() => { accountsPromise = null; });
  return accountsPromise;
}

function broadcast() { chrome.runtime.sendMessage({type: 'UI_STATE', payload: state}).catch(() => {}); }

function issue(code) {
  state.issue = allowedCode(code);
  state.phase = 'blocked';
  const job = state.native?.current;
  if (job) {
    notifyOnce(`${job.jobId}:job:${state.issue}`, job, 'job', state.issue).catch(() => {});
    chrome.action.setBadgeText({text: '!'}).catch(() => {});
  }
  broadcast();
}

function snapshot(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < latestRevision) return;
  latestRevision = value.revision;
  state.native = value;
  state.connection = 'connected';
  if (value.current) state.phase = value.current.state === 'blocked' ? 'blocked' : 'working';
  else if (state.phase !== 'scanning') state.phase = 'idle';
  const job = value.current;
  if (activeCredentials && (!job || activeCredentials.jobId !== job.jobId || activeCredentials.generation !== job.generation || job.customer?.state === 'ready' || job.customer?.source === 'ram')) {
    clearActiveCredentials();
  }
  if (!job || job.customer?.state !== 'preparing' || job.customer?.source === 'ram') {
    state.browserNotice = null;
    rejectedCookieKey = '';
    autoSubmittedKey = '';
  }
  for (const [role, data] of blockerRoles(job)) {
    if (legacyCode(data.code)) continue;
    const code = allowedCode(data.code || 'UNKNOWN_ERROR');
    const key = `${job.jobId}:${role}:${code}`;
    notifyOnce(key, job, role, code).catch(() => {});
  }
  chrome.action.setBadgeText({text: job?.state === 'blocked' ? '!' : ''}).catch(() => {});
  const imported = job?.customer?.state === 'ready' && job.customer.source !== 'ram' ? `${job.jobId}:${job.generation}:${job.customer.userId}` : '';
  if (imported && imported !== importedIdentity) {
    importedIdentity = imported;
    accounts().catch(() => {});
  }
  ensureRamSyncPolling();
  broadcast();
}

const native = new NativeClient(chrome, snapshot, () => {
  state.connection = 'disconnected';
  state.capabilities = null;
  state.issue = 'NATIVE_DISCONNECTED';
  clearActiveCredentials();
  stopRamSyncPolling();
  broadcast();
});

async function requireCapability() {
  if (!state.capabilities) state.capabilities = await native.request('GET_CAPABILITIES');
  if (
    state.capabilities.loginOnly !== true ||
    state.capabilities.accountSelection !== true ||
    state.capabilities.undoLast !== true ||
    state.capabilities.ramImportSupported !== true ||
    state.capabilities.browserLogin !== true
  ) throw new Error('NATIVE_UPDATE_REQUIRED');
}

async function config() {
  const stored = await chrome.storage.local.get('config');
  const value = stored.config || {version: 1, shopOrigin: 'https://bewpakorn.rdcw.xyz', catalog: await defaultCatalog()};
  state.configured = Boolean(stored.config && validConfig(value));
  return value;
}

function validConfig(value) {
  try {
    const result = validateCatalog(value);
    return result === undefined || result === true || result?.ok === true;
  } catch { return false; }
}

async function sync({advance = true} = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await config();
    const {completionIntent} = await chrome.storage.local.get('completionIntent');
    const {mutationIntent} = await chrome.storage.local.get('mutationIntent');
    state.completionPending = Boolean(completionIntent);
    state.mutationPending = Boolean(mutationIntent) || busy;
    const result = await native.request('GET_SNAPSHOT');
    snapshot(result);
    delete state.issue;
    if (completionIntent) {
      const ack = await native.request('COMPLETE_CURRENT', completionIntent);
      snapshot(ack);
      await chrome.storage.local.remove('completionIntent');
      if (advance && completionIntent.advanceAfterAck && !state.native?.current) await next();
      state.completionPending = false;
    }
    if (mutationIntent) await executeMutation(mutationIntent);
    if (shouldPollBrowserLogin()) tryCaptureBrowserSession().catch(() => {});
    broadcast();
  })().catch(error => {
    if (error.kind === 'application') {
      state.connection = 'connected';
      issue(error.message);
    } else {
      state.connection = 'disconnected';
      state.issue = 'NATIVE_DISCONNECTED';
      broadcast();
    }
    throw error;
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

async function next() {
  await requireCapability();
  const cfg = await config();
  if (!state.configured) throw new Error('SETUP_REQUIRED');
  delete state.issue;
  state.phase = 'scanning';
  broadcast();
  const orders = await scanOrders(cfg);
  const pending = selectPending(orders, state.native?.handled || []);
  state.queue = pending;
  if (!pending.length) {
    state.phase = 'empty';
    broadcast();
    return;
  }
  const order = pending[0];
  const claimOrder = Object.fromEntries(['shopId', 'orderId', 'productId', 'productName', 'mapId', 'mapName', 'placeId', 'operatorUserId', 'createdAt', 'customerUsername', 'quantity', 'status'].map(key => [key, order[key] ?? (key === 'customerUsername' ? '' : null)]));
  claimOrder.operatorUserIds = operatorPool(order);
  const protectedOperatorUserIds = protectedIds(cfg);
  const claimed = await native.request('CLAIM_ORDER', {order: claimOrder, protectedOperatorUserIds});
  snapshot(claimed);
  const job = state.native?.current;
  if (!job || job.order.orderId !== order.orderId) throw new Error('CLAIM_MISMATCH');
  state.queue = pending.slice(1);
  broadcast();
  await prepareCurrent(job);
}

async function prepareCurrent(job) {
  try {
    if (!ownsJob(job) || job.customer?.source === 'ram') return;
    if (job.order.revisit === true && job.order.status && !['PROCESSING', 'COMPLETED'].includes(job.order.status)) {
      issue('ORDER_CHANGED');
      return;
    }
    const credentials = await openAndReadOrder(job.order);
    if (!ownsJob(job) || state.native.current.customer?.source === 'ram') return;
    if (!credentials?.username || !credentials?.password) throw new Error('ORDER_CREDENTIALS_MISSING');
    activeCredentials = {jobId: job.jobId, generation: job.generation, username: credentials.username, password: credentials.password};
    state.hasCredentials = true;
    state.browserNotice = null;
    rejectedCookieKey = '';
    autoSubmittedKey = '';
    const result = await native.request('PREPARE_CUSTOMER', {jobId: job.jobId, generation: job.generation, username: credentials.username, mode: 'browser'});
    snapshot(result);
    if (ownsJob(job) && state.native?.current?.customer?.state === 'preparing') {
      const captured = await tryCaptureBrowserSession().catch(() => false);
      if (!captured && ownsJob(job) && state.native?.current?.customer?.state === 'preparing' && state.browserNotice?.code !== 'CUSTOMER_ID_MISMATCH') {
        await openRobloxLoginTab({focus: true, navigate: true}).catch(() => {});
        await autoFillAndSubmitRobloxLogin(job, credentials).catch(() => {});
      }
      ensureRamSyncPolling();
    }
  } catch (error) {
    if (ownsJob(job)) issue(error.message || 'ORDER_READ_FAILED');
  }
}

async function start() {
  if (busy || starting || state.mutationPending) throw new Error('BUSY');
  starting = true;
  try {
    await sync();
    await requireCapability();
    const job = state.native?.current;
    if (!job) await next();
    else if (job.customer?.canResume) {
      const resumed = await native.request('RESUME_UNSUBMITTED', {jobId: job.jobId, generation: job.generation});
      snapshot(resumed);
      if (state.native?.current) await prepareCurrent(state.native.current);
    } else if (job.customer?.source === 'order' && job.customer?.state === 'preparing' && job.customer?.loginMode === 'browser') {
      await openRobloxLoginTab({focus: true, navigate: false}).catch(() => {});
      await tryCaptureBrowserSession().catch(() => {});
      ensureRamSyncPolling();
    }
  } finally { starting = false; }
}

async function executeMutation(intent) {
  let ack;
  try { ack = await native.request(intent.type, intent.payload); }
  catch (error) {
    if (error.kind === 'application' && error.message !== 'RAM_IMPORT_UNCERTAIN') {
      await chrome.storage.local.remove('mutationIntent');
      state.mutationPending = busy;
    }
    throw error;
  }
  snapshot(ack);
  delete state.issue;
  const job = state.native?.current;
  if (intent.prepare && job && job.customer?.source !== 'ram' && job.customer?.state === 'waiting') await prepareCurrent(job);
  await chrome.storage.local.remove('mutationIntent');
  state.mutationPending = busy;
  broadcast();
}

async function mutation(type, identity, build, prepare) {
  if (busy || state.mutationPending) throw new Error('BUSY');
  const captured = identityOf(state.native?.current);
  if (!sameIdentity(identity, captured)) throw new Error('STALE_JOB');
  const target = historyTarget();
  const targetId = target?.orderId ?? null;
  if (type === 'UNDO_LAST' && (!targetId || identity?.expectedLastOrderId !== undefined && identity.expectedLastOrderId !== targetId)) throw new Error(targetId ? 'STALE_JOB' : 'NOTHING_TO_UNDO');
  busy = true;
  state.mutationPending = true;
  broadcast();
  try {
    if ((await chrome.storage.local.get('completionIntent')).completionIntent || (await chrome.storage.local.get('mutationIntent')).mutationIntent) throw new Error('COMPLETION_PENDING');
    await sync({advance: false});
    await requireCapability();
    if (!sameIdentity(captured, identityOf(state.native?.current)) || (type === 'UNDO_LAST' && historyTarget()?.orderId !== targetId)) throw new Error('STALE_JOB');
    delete state.issue;
    const payload = await build(captured, target);
    if (!sameIdentity(captured, identityOf(state.native?.current)) || (type === 'UNDO_LAST' && historyTarget()?.orderId !== targetId)) throw new Error('STALE_JOB');
    const intent = {type, payload: {commandId: crypto.randomUUID(), ...payload}, prepare};
    await chrome.storage.local.set({mutationIntent: intent});
    state.mutationPending = true;
    broadcast();
    await executeMutation(intent);
  } finally {
    busy = false;
    state.mutationPending = Boolean((await chrome.storage.local.get('mutationIntent')).mutationIntent);
    broadcast();
  }
}

async function undo(payload) {
  const identity = payload?.jobId ? payload : null;
  if (payload?.expectedLastOrderId !== historyTarget()?.orderId) throw new Error('STALE_JOB');
  return mutation('UNDO_LAST', identity, async (current, target) => {
    const cfg = await config();
    const result = {expectedJobId: current?.jobId ?? null, expectedGeneration: current?.generation ?? null, expectedLastOrderId: target.orderId, protectedOperatorUserIds: protectedIds(cfg)};
    if (target.needsRestoreOrder || !target.order && !state.native?.historyTarget) result.restoreOrder = await readOrderMetadata(target.orderId, cfg);
    return result;
  }, true);
}

async function selectAccount(payload) {
  if (!payload || !['customer', 'operator'].includes(payload.role) || !['order', 'ram'].includes(payload.source) || payload.role === 'operator' && payload.source !== 'ram' || payload.source === 'ram' && !/^\d+$/.test(String(payload.userId))) throw new Error('INVALID_SELECTION');
  return mutation('SELECT_ACCOUNT', payload, async current => ({jobId: current.jobId, generation: current.generation, role: payload.role, source: payload.source, ...(payload.source === 'ram' ? {userId: String(payload.userId)} : {})}), payload.role === 'customer' && payload.source === 'order');
}

async function complete(identity) {
  if (busy || state.mutationPending) throw new Error('BUSY');
  const job = state.native?.current;
  if (!job || !identity || ['jobId', 'generation', 'completionToken'].some(k => identity[k] !== job[k]) || identity.orderId !== job.order.orderId) throw new Error('STALE_JOB');
  busy = true;
  try {
    if ((await chrome.storage.local.get('completionIntent')).completionIntent) throw new Error('COMPLETION_PENDING');
    const intent = {commandId: crypto.randomUUID(), jobId: identity.jobId, orderId: identity.orderId, generation: identity.generation, completionToken: identity.completionToken, advanceAfterAck: true};
    await chrome.storage.local.set({completionIntent: intent});
    state.completionPending = true;
    clearActiveCredentials();
    stopRamSyncPolling();
    broadcast();
    const ack = await native.request('COMPLETE_CURRENT', intent);
    snapshot(ack);
    await chrome.storage.local.remove('completionIntent');
    await next();
  } finally {
    busy = false;
    state.completionPending = Boolean((await chrome.storage.local.get('completionIntent')).completionIntent);
    broadcast();
  }
}

async function copyCredentials(payload) {
  const job = state.native?.current;
  if (!job || job.customer?.source === 'ram') throw new Error('CREDENTIALS_UNAVAILABLE');
  if (payload?.jobId && (payload.jobId !== job.jobId || payload.generation !== job.generation)) throw new Error('STALE_JOB');
  if (!activeCredentials || activeCredentials.jobId !== job.jobId || activeCredentials.generation !== job.generation) {
    const credentials = await openAndReadOrder(job.order);
    if (!ownsJob(job) || !credentials?.username || !credentials?.password) throw new Error('CREDENTIALS_UNAVAILABLE');
    activeCredentials = {jobId: job.jobId, generation: job.generation, username: credentials.username, password: credentials.password};
    state.hasCredentials = true;
  }
  return {username: activeCredentials.username, password: activeCredentials.password};
}

async function launchGame(payload) {
  const job = state.native?.current;
  if (!job || !payload || payload.jobId !== job.jobId || payload.generation !== job.generation) throw new Error('STALE_JOB');
  const mode = ['auto', 'private', 'public'].includes(payload.mode) ? payload.mode : 'auto';
  const result = await native.request('LAUNCH_CUSTOMER_GAME', {jobId: job.jobId, generation: job.generation, mode});
  snapshot(result);
  return state;
}

async function handle(message) {
  switch (message?.type) {
    case 'UI_GET':
      await config();
      if (!busy && (state.connection === 'disconnected' || (await chrome.storage.local.get('completionIntent')).completionIntent || (await chrome.storage.local.get('mutationIntent')).mutationIntent)) {
        try { await sync(); } catch { /* show outstanding intent */ }
      }
      return state;
    case 'UI_START': await start(); return state;
    case 'UI_COMPLETE': await complete(message.payload); return state;
    case 'UI_UNDO': await undo(message.payload); return state;
    case 'UI_SELECT_ACCOUNT': await selectAccount(message.payload); return state;
    case 'UI_ACCOUNTS': return accounts();
    case 'UI_COPY_CREDENTIALS': return copyCredentials(message.payload);
    case 'UI_OPEN_ROBLOX_LOGIN': await openRobloxLoginTab({focus: true, navigate: true}); return state;
    case 'UI_CLEAR_ROBLOX_COOKIE': {
      await clearChromeRobloxCookie(null, {redirect: true});
      rejectedCookieKey = '';
      autoSubmittedKey = '';
      state.browserNotice = null;
      broadcast();
      const job = state.native?.current;
      if (job && job.customer?.source !== 'ram' && job.customer?.state === 'preparing') {
        try {
          const creds = await copyCredentials({jobId: job.jobId, generation: job.generation});
          await autoFillAndSubmitRobloxLogin(job, creds);
        } catch {
          await openRobloxLoginTab({focus: true, navigate: true});
        }
      } else {
        await openRobloxLoginTab({focus: true, navigate: true});
      }
      return state;
    }
    case 'UI_AUTO_FILL_LOGIN': {
      const job = state.native?.current;
      if (!job || job.customer?.source === 'ram' || job.customer?.state !== 'preparing') return state;
      autoSubmittedKey = '';
      const creds = await copyCredentials({jobId: job.jobId, generation: job.generation});
      await autoFillAndSubmitRobloxLogin(job, creds);
      return state;
    }
    case 'UI_CHECK_BROWSER_LOGIN':
      rejectedCookieKey = '';
      state.browserNotice = null;
      await tryCaptureBrowserSession();
      await syncRamCustomerOnce();
      return state;
    case 'UI_LAUNCH_GAME': return launchGame(message.payload);
    case 'UI_OPTIONS_GET': return {config: await config(), products: await discoverCatalog()};
    case 'UI_OPTIONS_SAVE': {
      if (!validConfig(message.payload) || !message.payload.catalog.length) throw new Error('INVALID_CATALOG');
      const authority = new Map((await discoverCatalog()).map(p => [p.productId, p]));
      for (const item of message.payload.catalog) {
        const known = authority.get(item.productId);
        if (!known || ['productName', 'mapId', 'mapName', 'placeId'].some(key => item[key] !== known[key])) throw new Error('INVALID_CATALOG');
      }
      const previousConfig = await config();
      const protectedOperatorUserIds = [...new Set([...protectedIds(previousConfig), ...protectedIds(message.payload)])];
      const nextConfig = {...message.payload, protectedOperatorUserIds};
      if (!validConfig(nextConfig)) throw new Error('INVALID_CATALOG');
      await chrome.storage.local.set({config: nextConfig});
      await config();
      const enabledProducts = new Set(message.payload.catalog.map(p => p.productId));
      state.queue = state.queue.filter(o => enabledProducts.has(o.productId));
      broadcast();
      return state;
    }
    default: throw new Error('UNKNOWN_COMMAND');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('UI_') || message.type === 'UI_STATE') return false;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    sendResponse({ok: false, error: {code: 'UNAUTHORIZED'}});
    return false;
  }
  handle(message)
    .then(payload => sendResponse({ok: true, payload}))
    .catch(error => {
      const code = allowedCode(error.code || error.message);
      if (!['BUSY', 'STALE_JOB', 'UNKNOWN_COMMAND', 'INVALID_CATALOG', 'CREDENTIALS_UNAVAILABLE'].includes(code)) issue(code);
      sendResponse({ok: false, error: {code}});
    });
  return true;
});

chrome.cookies?.onChanged?.addListener(info => {
  if (info.removed || info.cookie?.name !== ROBLOX_COOKIE_NAME) return;
  const domain = (info.cookie.domain || '').toLowerCase();
  if (domain !== 'roblox.com' && !domain.endsWith('.roblox.com')) return;
  if (cookieDebounceTimer) clearTimeout(cookieDebounceTimer);
  cookieDebounceTimer = setTimeout(() => {
    cookieDebounceTimer = null;
    tryCaptureBrowserSession(info.cookie.storeId).catch(() => {});
  }, 150);
});

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
  start().catch(error => issue(error.message));
});

// Reconcile an existing job or completion only; never select a new order on wake.
sync().catch(() => {});
