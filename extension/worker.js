import {NativeClient} from './native.js';
import {scanOrders, openAndReadOrder, defaultCatalog, discoverCatalog} from './shop.js';
import {selectPending, validateCatalog, operatorPool} from './queue.js';
import {createNotifier, blockerRoles} from './notifications.js';

const state = {connection: 'disconnected', phase: 'idle', native: null, queue: [], configured: false, completionPending:false,capabilities:null};
let busy = false;
let starting = false;
let syncPromise = null;
let latestRevision = -1;
const notifyOnce = createNotifier(chrome);
const allowedCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN_ERROR';
const ownsJob = job => state.native?.current?.jobId === job.jobId && state.native.current.generation === job.generation;
function broadcast() { chrome.runtime.sendMessage({type: 'UI_STATE', payload: state}).catch(() => {}); }
function issue(code) { state.issue = allowedCode(code); state.phase = 'blocked'; const job=state.native?.current; if(job) { notifyOnce(`${job.jobId}:job:${state.issue}`, job, 'job', state.issue).catch(() => {}); chrome.action.setBadgeText({text:'!'}).catch(() => {}); } broadcast(); }
function snapshot(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < latestRevision) return;
  latestRevision = value.revision; state.native = value; state.connection = 'connected';
  if (value.current) state.phase = value.current.state === 'blocked' ? 'blocked' : 'working';
  else if (state.phase !== 'scanning') state.phase = 'idle';
  const job = value.current;
  for (const [role, data] of blockerRoles(job)) {
    const code = allowedCode(data.code || 'UNKNOWN_ERROR'); const key = `${job.jobId}:${role}:${code}`;
    notifyOnce(key, job, role, code).catch(() => {});
  }
  chrome.action.setBadgeText({text: job?.state === 'blocked' ? '!' : ''}).catch(() => {});
  broadcast();
}
const native = new NativeClient(chrome, snapshot, () => { state.connection = 'disconnected';state.capabilities=null; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); });
async function requirePairCapability(){if(!state.capabilities)state.capabilities=await native.request('GET_CAPABILITIES');if(state.capabilities.dualClientLaunch!==true||state.capabilities.operatorPools!==true)throw new Error('NATIVE_UPDATE_REQUIRED');}
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
    const {completionIntent} = await chrome.storage.local.get('completionIntent');
    state.completionPending = Boolean(completionIntent);
    const result = await native.request('GET_SNAPSHOT'); snapshot(result);
    if (completionIntent) {
      const ack = await native.request('COMPLETE_CURRENT', completionIntent);
      snapshot(ack); await chrome.storage.local.remove('completionIntent');
      state.completionPending = false;
      // This is the continuation of an explicit Success, including the normal
      // wait for owned game windows to close; it is not a new idle round.
      if(completionIntent.advanceAfterAck && !state.native?.current)await next();
    }
    delete state.issue; broadcast();
  })().catch(error => { if (error.kind === 'application') { state.connection = 'connected'; issue(error.message); } else { state.connection = 'disconnected'; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); } throw error; }).finally(() => { syncPromise = null; });
  return syncPromise;
}
async function next() {
  await requirePairCapability();
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
  claimOrder.operatorUserIds=operatorPool(order);claimOrder.privateServerSourceUserId=order.privateServerSourceUserId||order.operatorUserId||claimOrder.operatorUserIds[0]||'';
  const protectedOperatorUserIds = [...new Set(cfg.catalog.flatMap(p=>[...operatorPool(p),p.privateServerSourceUserId||p.operatorUserId].filter(Boolean)))];
  const claimed = await native.request('CLAIM_ORDER', {order:claimOrder, protectedOperatorUserIds}); snapshot(claimed);
  const job = state.native?.current;
  if (!job || job.order.orderId !== order.orderId) throw new Error('CLAIM_MISMATCH');
  state.queue = pending.slice(1); broadcast();
  await prepareCurrent(job);
}
async function prepareCurrent(job) {
  try {
    if (!ownsJob(job)) return;
    const credentials = await openAndReadOrder(job.order);
    // Success may arrive while the detail request is pending. Its old result
    // must not submit credentials or replace the next job's visible problem.
    if (!ownsJob(job)) return;
    if (!credentials?.username || !credentials?.password) throw new Error('ORDER_CREDENTIALS_MISSING');
    const result = await native.request('PREPARE_CUSTOMER', {jobId:job.jobId, generation:job.generation, username:credentials.username, password:credentials.password});
    snapshot(result);
  } catch (error) { if (ownsJob(job)) issue(error.message || 'ORDER_READ_FAILED'); }
}
async function start() {
  if (busy || starting) throw new Error('BUSY');
  starting = true;
  try { await sync();await requirePairCapability();const job=state.native?.current;if(!job)await next();else if(job.customer?.canResume){const resumed=await native.request('RESUME_UNSUBMITTED',{jobId:job.jobId,generation:job.generation});snapshot(resumed);if(state.native?.current)await prepareCurrent(state.native.current);}else if(job.customer?.userId){snapshot(await native.request('LAUNCH_PAIR',{jobId:job.jobId,generation:job.generation}));} }
  finally { starting = false; }
}
async function complete(identity) {
  if (busy) throw new Error('BUSY');
  const job = state.native?.current;
  if (!job || !identity || ['jobId','generation','completionToken'].some(k => identity[k] !== job[k]) || identity.orderId !== job.order.orderId) throw new Error('STALE_JOB');
  busy = true;
  try {
    if ((await chrome.storage.local.get('completionIntent')).completionIntent) throw new Error('COMPLETION_PENDING');
    const intent = {commandId:crypto.randomUUID(), jobId:identity.jobId, orderId:identity.orderId, generation:identity.generation, completionToken:identity.completionToken,advanceAfterAck:true};
    await chrome.storage.local.set({completionIntent:intent});
    state.completionPending = true; broadcast();
    const ack = await native.request('COMPLETE_CURRENT', intent); snapshot(ack);
    await chrome.storage.local.remove('completionIntent');
    state.completionPending = false;
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
        const pool=operatorPool(item),source=item.privateServerSourceUserId||item.operatorUserId||pool[0];
        if(!pool.length||pool.some(id=>!accountMetadata.accounts.some(a=>String(a.userId)===id)))throw new Error('INVALID_CATALOG');
        if(!accountMetadata.accounts.some(a=>String(a.userId)===source&&a.hasPrivateDestination===true&&String(a.privatePlaceId)===item.placeId))throw new Error('INVALID_CATALOG');
        const binding=JSON.stringify({pool,source});if(mappings.has(item.mapId)&&mappings.get(item.mapId)!==binding)throw new Error('INVALID_CATALOG');mappings.set(item.mapId,binding);
      }
      await chrome.storage.local.set({config:message.payload}); await config();
      const enabledProducts=new Set(message.payload.catalog.map(p=>p.productId));state.queue=state.queue.filter(o=>enabledProducts.has(o.productId));
      broadcast(); return state;
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
sync().catch(() => {});
