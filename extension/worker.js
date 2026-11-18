import {NativeClient} from './native.js';
import {scanOrders, openAndReadOrder, readOrderMetadata, defaultCatalog, discoverCatalog} from './shop.js';
import {selectPending, validateCatalog, operatorPool} from './queue.js';
import {createNotifier, blockerRoles} from './notifications.js';

const state = {connection: 'disconnected', phase: 'idle', native: null, queue: [], configured: false, completionPending:false,mutationPending:false,accounts:[],capabilities:null};
let busy = false;
let starting = false;
let syncPromise = null;
let latestRevision = -1;
let accountsPromise = null, importedIdentity = '';
const notifyOnce = createNotifier(chrome);
const allowedCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN_ERROR';
const ownsJob = job => state.native?.current?.jobId === job.jobId && state.native.current.generation === job.generation;
const legacyCode = code => /^(PAIR_|PRIVATE_TARGET_)/.test(code || '');
const identityOf = job => job ? {jobId:job.jobId,orderId:job.order.orderId,generation:job.generation,completionToken:job.completionToken} : null;
const sameIdentity = (a,b) => a === null ? b === null : !!b && ['jobId','orderId','generation','completionToken'].every(k=>a[k]===b[k]);
const historyTarget = () => state.native?.historyTarget || state.native?.handled?.at(-1) || null;
const protectedIds = cfg => [...new Set([...(cfg.protectedOperatorUserIds || []),...(cfg.catalog || []).flatMap(p=>[...operatorPool(p),p.privateServerSourceUserId||p.operatorUserId].filter(Boolean))])];
async function accounts() {
  if (accountsPromise) return accountsPromise;
  accountsPromise=(async()=>{const result=await native.request('GET_ACCOUNT_METADATA');state.accounts=(result.accounts || []).filter(a=>/^\d+$/.test(String(a.userId))).map(a=>({userId:String(a.userId),username:typeof a.username==='string'?a.username:''}));broadcast();return {accounts:state.accounts};})().finally(()=>{accountsPromise=null;});
  return accountsPromise;
}
function broadcast() { chrome.runtime.sendMessage({type: 'UI_STATE', payload: state}).catch(() => {}); }
function issue(code) { state.issue = allowedCode(code); state.phase = 'blocked'; const job=state.native?.current; if(job) { notifyOnce(`${job.jobId}:job:${state.issue}`, job, 'job', state.issue).catch(() => {}); chrome.action.setBadgeText({text:'!'}).catch(() => {}); } broadcast(); }
function snapshot(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < latestRevision) return;
  latestRevision = value.revision; state.native = value; state.connection = 'connected';
  if (value.current) state.phase = value.current.state === 'blocked' ? 'blocked' : 'working';
  else if (state.phase !== 'scanning') state.phase = 'idle';
  const job = value.current;
  for (const [role, data] of blockerRoles(job)) {
    if (legacyCode(data.code)) continue;
    const code = allowedCode(data.code || 'UNKNOWN_ERROR'); const key = `${job.jobId}:${role}:${code}`;
    notifyOnce(key, job, role, code).catch(() => {});
  }
  chrome.action.setBadgeText({text: job?.state === 'blocked' ? '!' : ''}).catch(() => {});
  const imported=job?.customer?.state==='ready' && job.customer.source!=='ram' ? `${job.jobId}:${job.generation}:${job.customer.userId}` : '';
  if (imported && imported!==importedIdentity) { importedIdentity=imported;accounts().catch(()=>{}); }
  broadcast();
}
const native = new NativeClient(chrome, snapshot, () => { state.connection = 'disconnected';state.capabilities=null; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); });
async function requireCapability(){if(!state.capabilities)state.capabilities=await native.request('GET_CAPABILITIES');if(state.capabilities.manualChallengePause!==true||state.capabilities.loginOnly!==true||state.capabilities.accountSelection!==true||state.capabilities.undoLast!==true||state.capabilities.ramImportSupported!==true)throw new Error('NATIVE_UPDATE_REQUIRED');}
async function config() {
  const stored = await chrome.storage.local.get('config');
  const value = stored.config || {version:1, shopOrigin:'https://bewpakorn.rdcw.xyz', catalog:await defaultCatalog()};
  state.configured = Boolean(stored.config && validConfig(value));
  return value;
}
function validConfig(value) { try { const result = validateCatalog(value); return result === undefined || result === true || result?.ok === true; } catch { return false; } }
async function sync({advance=true}={}) {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await config();
    const {completionIntent} = await chrome.storage.local.get('completionIntent');
    const {mutationIntent} = await chrome.storage.local.get('mutationIntent');
    state.completionPending = Boolean(completionIntent);
    state.mutationPending = Boolean(mutationIntent) || busy;
    const result = await native.request('GET_SNAPSHOT'); snapshot(result);
    delete state.issue;
    if (completionIntent) {
      const ack = await native.request('COMPLETE_CURRENT', completionIntent);
      snapshot(ack); await chrome.storage.local.remove('completionIntent');
      if(advance && completionIntent.advanceAfterAck && !state.native?.current)await next();
      state.completionPending = false;
    }
    if (mutationIntent) await executeMutation(mutationIntent);
    broadcast();
  })().catch(error => { if (error.kind === 'application') { state.connection = 'connected'; issue(error.message); } else { state.connection = 'disconnected'; state.issue = 'NATIVE_DISCONNECTED'; broadcast(); } throw error; }).finally(() => { syncPromise = null; });
  return syncPromise;
}
async function next() {
  await requireCapability();
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
  const claimOrder = Object.fromEntries(['shopId','orderId','productId','productName','mapId','mapName','placeId','operatorUserId','createdAt','customerUsername','quantity','status'].map(key => [key, order[key] ?? (key === 'customerUsername' ? '' : null)]));
  claimOrder.operatorUserIds=operatorPool(order);
  const protectedOperatorUserIds = protectedIds(cfg);
  const claimed = await native.request('CLAIM_ORDER', {order:claimOrder, protectedOperatorUserIds}); snapshot(claimed);
  const job = state.native?.current;
  if (!job || job.order.orderId !== order.orderId) throw new Error('CLAIM_MISMATCH');
  state.queue = pending.slice(1); broadcast();
  await prepareCurrent(job);
}
async function prepareCurrent(job) {
  try {
    if (!ownsJob(job) || job.customer?.source==='ram') return;
    if (job.order.revisit===true && job.order.status && !['PROCESSING','COMPLETED'].includes(job.order.status)) {issue('ORDER_CHANGED');return;}
    const credentials = await openAndReadOrder(job.order);
    // Success may arrive while the detail request is pending. Its old result
    // must not submit credentials or replace the next job's visible problem.
    if (!ownsJob(job) || state.native.current.customer?.source==='ram') return;
    if (!credentials?.username || !credentials?.password) throw new Error('ORDER_CREDENTIALS_MISSING');
    const result = await native.request('PREPARE_CUSTOMER', {jobId:job.jobId, generation:job.generation, username:credentials.username, password:credentials.password});
    snapshot(result);
  } catch (error) { if (ownsJob(job)) issue(error.message || 'ORDER_READ_FAILED'); }
}
async function start() {
  if (busy || starting || state.mutationPending) throw new Error('BUSY');
  starting = true;
  try { await sync();await requireCapability();const job=state.native?.current;if(!job)await next();else if(job.customer?.canResume){const resumed=await native.request('RESUME_UNSUBMITTED',{jobId:job.jobId,generation:job.generation});snapshot(resumed);if(state.native?.current)await prepareCurrent(state.native.current);} }
  finally { starting = false; }
}
async function executeMutation(intent) {
  let ack;
  try { ack=await native.request(intent.type,intent.payload); }
  catch(error) {
    // A definitive native rejection acknowledges that nothing was changed.
    // An unsettled import and a lost reply retain the exact original command.
    if(error.kind==='application' && error.message!=='RAM_IMPORT_UNCERTAIN') {await chrome.storage.local.remove('mutationIntent');state.mutationPending=busy;}
    throw error;
  }
  snapshot(ack);
  delete state.issue;
  const job=state.native?.current;
  if (intent.prepare && job && job.customer?.source!=='ram' && job.customer?.state==='waiting') await prepareCurrent(job);
  // Retain the acknowledged command until its credential-read continuation
  // finishes. A restarted worker replays the ACK and prepares only waiting jobs.
  await chrome.storage.local.remove('mutationIntent');state.mutationPending=busy;broadcast();
}
async function mutation(type,identity,build,prepare) {
  if (busy || state.mutationPending) throw new Error('BUSY');
  const captured=identityOf(state.native?.current);
  if (!sameIdentity(identity,captured)) throw new Error('STALE_JOB');
  const target=historyTarget();const targetId=target?.orderId ?? null;
  if (type==='UNDO_LAST' && (!targetId || identity?.expectedLastOrderId!==undefined && identity.expectedLastOrderId!==targetId)) throw new Error(targetId?'STALE_JOB':'NOTHING_TO_UNDO');
  busy = true;
  state.mutationPending=true;broadcast();
  try {
    if ((await chrome.storage.local.get('completionIntent')).completionIntent || (await chrome.storage.local.get('mutationIntent')).mutationIntent) throw new Error('COMPLETION_PENDING');
    await sync({advance:false});await requireCapability();
    if (!sameIdentity(captured,identityOf(state.native?.current)) || (type==='UNDO_LAST' && historyTarget()?.orderId!==targetId)) throw new Error('STALE_JOB');
    delete state.issue;
    const payload=await build(captured,target);
    if (!sameIdentity(captured,identityOf(state.native?.current)) || (type==='UNDO_LAST' && historyTarget()?.orderId!==targetId)) throw new Error('STALE_JOB');
    const intent={type,payload:{commandId:crypto.randomUUID(),...payload},prepare};
    await chrome.storage.local.set({mutationIntent:intent});state.mutationPending=true;broadcast();
    await executeMutation(intent);
  } finally { busy = false;state.mutationPending=Boolean((await chrome.storage.local.get('mutationIntent')).mutationIntent);broadcast(); }
}
async function undo(payload) {
  const identity=payload?.jobId ? payload : null;
  // The target is part of the rendered panel identity even when no job exists.
  if (payload?.expectedLastOrderId!==historyTarget()?.orderId) throw new Error('STALE_JOB');
  return mutation('UNDO_LAST',identity,async (current,target)=>{
    const cfg=await config();
    const result={expectedJobId:current?.jobId ?? null,expectedGeneration:current?.generation ?? null,expectedLastOrderId:target.orderId,protectedOperatorUserIds:protectedIds(cfg)};
    if (target.needsRestoreOrder || !target.order && !state.native?.historyTarget) result.restoreOrder=await readOrderMetadata(target.orderId,cfg);
    return result;
  },true);
}
async function selectAccount(payload) {
  if (!payload || !['customer','operator'].includes(payload.role) || !['order','ram'].includes(payload.source) || payload.role==='operator' && payload.source!=='ram' || payload.source==='ram' && !/^\d+$/.test(String(payload.userId))) throw new Error('INVALID_SELECTION');
  return mutation('SELECT_ACCOUNT',payload,async current=>({jobId:current.jobId,generation:current.generation,role:payload.role,source:payload.source,...(payload.source==='ram'?{userId:String(payload.userId)}:{})}),payload.role==='customer' && payload.source==='order');
}
async function complete(identity) {
  if (busy || state.mutationPending) throw new Error('BUSY');
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
    await next();
  } finally { busy = false;state.completionPending=Boolean((await chrome.storage.local.get('completionIntent')).completionIntent);broadcast(); }
}
async function handle(message) {
  switch (message?.type) {
    case 'UI_GET': await config(); if (!busy && (state.connection === 'disconnected' || (await chrome.storage.local.get('completionIntent')).completionIntent || (await chrome.storage.local.get('mutationIntent')).mutationIntent)) { try { await sync(); } catch { /* show outstanding intent */ } } return state;
    case 'UI_START': await start(); return state;
    case 'UI_COMPLETE': await complete(message.payload); return state;
    case 'UI_UNDO': await undo(message.payload); return state;
    case 'UI_SELECT_ACCOUNT': await selectAccount(message.payload); return state;
    case 'UI_ACCOUNTS': return accounts();
    case 'UI_OPTIONS_GET': return {config:await config(), products:await discoverCatalog()};
    case 'UI_OPTIONS_SAVE': {
      if (!validConfig(message.payload) || !message.payload.catalog.length) throw new Error('INVALID_CATALOG');
      const authority = new Map((await discoverCatalog()).map(p => [p.productId, p]));
      for (const item of message.payload.catalog) {
        const known = authority.get(item.productId);
        if (!known || ['productName','mapId','mapName','placeId'].some(key => item[key] !== known[key])) throw new Error('INVALID_CATALOG');
      }
      const previousConfig=await config();
      const protectedOperatorUserIds=[...new Set([...protectedIds(previousConfig),...protectedIds(message.payload)])];
      const nextConfig={...message.payload,protectedOperatorUserIds};
      if (!validConfig(nextConfig)) throw new Error('INVALID_CATALOG');
      await chrome.storage.local.set({config:nextConfig}); await config();
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
