import {NativeClient} from './native.js';
import {scanOrders, openAndReadOrder, defaultCatalog, discoverCatalog} from './shop.js';
import {selectPending, validateCatalog} from './queue.js';
import {createNotifier} from './notifications.js';

const state = {connection: 'disconnected', phase: 'idle', native: null, queue: [], configured: false};
let busy = false;
let syncPromise = null;
let latestRevision = -1;
const notifyOnce = createNotifier(chrome);
const allowedCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN_ERROR';
function broadcast() { chrome.runtime.sendMessage({type: 'UI_STATE', payload: state}).catch(() => {}); }
function issue(code) { state.issue = allowedCode(code); state.phase = 'blocked'; const job=state.native?.current; if(job) { notifyOnce(`${job.jobId}:job:${state.issue}`, job, 'job', state.issue).catch(() => {}); chrome.action.setBadgeText({text:'!'}).catch(() => {}); } broadcast(); }
function snapshot(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < latestRevision) return;
  latestRevision = value.revision; state.native = value; state.connection = 'connected';
  if (value.current) state.phase = value.current.state === 'blocked' ? 'blocked' : 'working';
  else if (state.phase !== 'scanning') state.phase = 'idle';
  const job = value.current;
  for (const [role, data] of [['customer', job?.customer], ['operator', job?.operator], ['job', job]]) {
    if (data?.state !== 'blocked' && !data?.code) continue;
    const code = allowedCode(data.code || 'UNKNOWN_ERROR'); const key = `${job.jobId}:${role}:${code}`;
    notifyOnce(key, job, role, code).catch(() => {});
  }
  chrome.action.setBadgeText({text: job?.state === 'blocked' ? '!' : ''}).catch(() => {});
  broadcast();
}
const native = new NativeClient(chrome, snapshot, () => { state.connection = 'disconnected'; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); });
async function config() {
  const stored = await chrome.storage.local.get('config');
  const value = stored.config || {version:1, shopOrigin:'https://bewpakorn.rdcw.xyz', catalog:await defaultCatalog()};
  state.configured = Boolean(stored.config && validConfig(value));
  return value;
}
function validConfig(value) { try { const result = validateCatalog(value); return result === undefined || result === true || result?.ok === true; } catch { return false; } }
async function sync() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await config();
    const result = await native.request('GET_SNAPSHOT'); snapshot(result);
    const {completionIntent} = await chrome.storage.local.get('completionIntent');
    if (completionIntent) {
      const ack = await native.request('COMPLETE_CURRENT', completionIntent);
      snapshot(ack); await chrome.storage.local.remove('completionIntent');
    }
    delete state.issue; broadcast();
  })().catch(error => { state.connection = 'disconnected'; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); throw error; }).finally(() => { syncPromise = null; });
  return syncPromise;
}
async function next() {
  const cfg = await config();
  if (!state.configured) throw new Error('SETUP_REQUIRED');
  delete state.issue; state.phase = 'scanning'; broadcast();
  const orders = await scanOrders(cfg);
  const pending = selectPending(orders, state.native?.handled || []);
  state.queue = pending;
  if (!pending.length) { state.phase = 'empty'; broadcast(); return; }
  const order = pending[0];
  // Username is deliberately blank at claim: the host binds it exactly once
  // when the claimed order's credential form is read in PREPARE_CUSTOMER.
  const claimOrder = Object.fromEntries(['shopId','orderId','productId','productName','mapId','mapName','placeId','operatorUserId','createdAt','customerUsername','quantity'].map(key => [key, order[key] ?? (key === 'customerUsername' ? '' : null)]));
  const claimed = await native.request('CLAIM_ORDER', {order:claimOrder}); snapshot(claimed);
  const job = state.native?.current;
  if (!job || job.order.orderId !== order.orderId) throw new Error('CLAIM_MISMATCH');
  state.queue = pending.slice(1); broadcast();
  try {
    const credentials = await openAndReadOrder(order);
    if (!credentials?.username || !credentials?.password) throw new Error('ORDER_CREDENTIALS_MISSING');
    const result = await native.request('PREPARE_CUSTOMER', {jobId:job.jobId, generation:job.generation, username:credentials.username, password:credentials.password});
    snapshot(result);
  } catch (error) { issue(error.message || 'ORDER_READ_FAILED'); }
}
async function start() {
  if (busy) throw new Error('BUSY');
  busy = true;
  try { await sync(); if (!state.native?.current) await next(); }
  finally { busy = false; }
}
async function complete(identity) {
  if (busy) throw new Error('BUSY');
  const job = state.native?.current;
  if (!job || !identity || ['jobId','generation','completionToken'].some(k => identity[k] !== job[k]) || identity.orderId !== job.order.orderId) throw new Error('STALE_JOB');
  busy = true;
  try {
    if ((await chrome.storage.local.get('completionIntent')).completionIntent) throw new Error('COMPLETION_PENDING');
    const intent = {commandId:crypto.randomUUID(), jobId:identity.jobId, orderId:identity.orderId, generation:identity.generation, completionToken:identity.completionToken};
    await chrome.storage.local.set({completionIntent:intent});
    const ack = await native.request('COMPLETE_CURRENT', intent); snapshot(ack);
    await chrome.storage.local.remove('completionIntent');
    await next();
  } finally { busy = false; }
}
async function handle(message) {
  switch (message?.type) {
    case 'UI_GET': await config(); if (!busy && (state.connection === 'disconnected' || (await chrome.storage.local.get('completionIntent')).completionIntent)) { try { await sync(); } catch { /* show outstanding intent */ } } return state;
    case 'UI_START': await start(); return state;
    case 'UI_COMPLETE': await complete(message.payload); return state;
    case 'UI_ACCOUNTS': return native.request('GET_ACCOUNT_METADATA');
    case 'UI_OPTIONS_GET': return {config:await config(), products:await discoverCatalog()};
    case 'UI_OPTIONS_SAVE': {
      if (!validConfig(message.payload) || !message.payload.catalog.length) throw new Error('INVALID_CATALOG');
      const authority = new Map((await discoverCatalog()).map(p => [p.productId, p]));
      const accountMetadata = await native.request('GET_ACCOUNT_METADATA');
      if (!Array.isArray(accountMetadata?.accounts)) throw new Error('INVALID_CATALOG');
      const mappings = new Map();
      for (const item of message.payload.catalog) {
        const known = authority.get(item.productId);
        if (!known || ['productName','mapId','mapName','placeId'].some(key => item[key] !== known[key])) throw new Error('INVALID_CATALOG');
        if (item.operatorUserId && !accountMetadata.accounts.some(a => String(a.userId) === item.operatorUserId && String(a.placeId) === item.placeId)) throw new Error('INVALID_CATALOG');
        if (mappings.has(item.mapId) && mappings.get(item.mapId) !== item.operatorUserId) throw new Error('INVALID_CATALOG');
        mappings.set(item.mapId, item.operatorUserId);
      }
      await chrome.storage.local.set({config:message.payload}); await config(); broadcast(); return state;
    }
    default: throw new Error('UNKNOWN_COMMAND');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('UI_') || message.type === 'UI_STATE') return false;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) { sendResponse({ok:false,error:{code:'UNAUTHORIZED'}}); return false; }
  handle(message).then(payload => sendResponse({ok:true,payload})).catch(error => { const code = allowedCode(error.code || error.message); if (!['BUSY','STALE_JOB','UNKNOWN_COMMAND','INVALID_CATALOG'].includes(code)) issue(code); sendResponse({ok:false,error:{code}}); });
  return true;
});
chrome.action.onClicked.addListener(tab => { chrome.sidePanel.open({windowId:tab.windowId}).catch(() => {}); start().catch(error => issue(error.message)); });
// Reconcile an existing job or completion only; never select a new order on wake.
sync().catch(() => { state.connection = 'disconnected'; broadcast(); });
