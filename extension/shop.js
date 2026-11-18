import {SHOP_ORIGIN, MAPS, validateCatalog, normalizeOrder, readCredentialForm, fault} from './queue.js';

// Reads and explicit order navigation share one existing shop tab. GET requests
// never refresh the page or touch its form. Serialize access so a simultaneous
// scan/detail request cannot create another tab or run during our navigation.
let shopTabId;
let tabWork = Promise.resolve();
const orderPath = /^\/manager\/orders(?:\/[a-z0-9]{10,80}(?:\/edit)?)?\/?$/;
function allowedShopUrl(value) {
  try {const url = new URL(value); return url.origin === SHOP_ORIGIN && !url.username && !url.password && orderPath.test(url.pathname);} catch {return false;}
}
function allowedShopTab(tab) {
  return tab && Number.isInteger(tab.id) && allowedShopUrl(tab.pendingUrl || tab.url) && (!tab.url || allowedShopUrl(tab.url));
}
function changedShopTabCode(tab) {
  if (allowedShopTab(tab)) return null;
  try {
    const url = new URL(tab?.pendingUrl || tab?.url);
    if (url.origin !== SHOP_ORIGIN) return null;
    return /(?:^|\/)(?:login|sign-?in|auth|authentication)(?:\/|$)/i.test(url.pathname) ? 'SHOP_LOGIN_REQUIRED' : 'SHOP_TAB_CHANGED';
  } catch {return null;}
}
async function findTab(id) {
  if (!Number.isInteger(id)) return null;
  try {return await chrome.tabs.get(id);} catch (error) {
    // Only a missing tab permits replacement. Other browser failures must not
    // turn into duplicate editor tabs.
    if (/no tab with id|invalid tab id|tab (?:was |has been )?closed|missing/i.test(error?.message || '')) return null;
    throw fault('SHOP_READ_FAILED');
  }
}
async function waitForTab(id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const tab = await findTab(id);
    if (!tab) throw fault('SHOP_READ_FAILED');
    if (!allowedShopTab(tab)) throw fault('SHOP_LOGIN_REQUIRED');
    if (tab.status === 'complete') return tab;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw fault('SHOP_LOAD_TIMEOUT');
}
async function rememberTab(tab) {
  shopTabId = tab.id;
  // Local storage survives extension Reload; IDs are validated again on use
  // because Chrome may assign different IDs after a browser restart.
  await chrome.storage.local.set({shopTabId});
  return waitForTab(shopTabId);
}
async function getShopTab() {
  const remembered = await findTab(shopTabId);
  if (allowedShopTab(remembered)) return waitForTab(remembered.id);
  shopTabId = undefined;
  const [saved, legacyEditor, legacyReader] = await Promise.all([
    chrome.storage.local.get('shopTabId'),
    chrome.storage.session.get('shopEditorTabId'),
    chrome.storage.session.get('shopReaderTabId')
  ]);
  let windowId;
  try {const win = await chrome.windows.getLastFocused({windowTypes:['normal']}); if (Number.isInteger(win?.id) && win.id >= 0) windowId = win.id;} catch {}
  let tabs;
  try {tabs = await chrome.tabs.query({url:`${SHOP_ORIGIN}/manager/orders*`});} catch {throw fault('SHOP_READ_FAILED');}
  const savedIds = [saved.shopTabId, legacyEditor.shopEditorTabId, legacyReader.shopReaderTabId];
  const previousTabs = [remembered,...await Promise.all([...new Set(savedIds.filter(Number.isInteger))].map(findTab))];
  const rank = tab => {
    const currentWindow = windowId !== undefined && tab.windowId === windowId;
    const savedIndex = savedIds.indexOf(tab.id);
    if (currentWindow && tab.active) return 0;
    if (currentWindow) return savedIndex >= 0 ? 1 : 2;
    return savedIndex >= 0 ? 3 + savedIndex : tab.active ? 6 : 7;
  };
  const candidates = tabs.filter(allowedShopTab).sort((a,b) => rank(a)-rank(b) || (b.lastAccessed || 0)-(a.lastAccessed || 0) || a.id-b.id);
  for (const candidate of candidates) {
    const tab = await findTab(candidate.id);
    if (allowedShopTab(tab)) return rememberTab(tab);
  }
  // A shop login redirect or a page the user deliberately opened is still the
  // remembered tab. Preserve it and stop; retrying must not spawn extra pages.
  const changedCode = previousTabs.map(changedShopTabCode).find(Boolean);
  if (changedCode) throw fault(changedCode);
  const options = {url:`${SHOP_ORIGIN}/manager/orders?ps=50`,active:false};
  if (windowId !== undefined) options.windowId = windowId;
  return rememberTab(await chrome.tabs.create(options));
}
function withShopTab(work) {
  const result = tabWork.then(async () => work(await getShopTab()));
  tabWork = result.catch(() => {});
  return result;
}

// Self-contained because Chrome serializes the function into an isolated world.
// Fixed endpoint allowlist, GET only, strict projection: descriptions, customer
// notes, images and tokens never leave the shop page context.
export async function shopReadInPage(kind, input) {
  if (location.origin !== 'https://bewpakorn.rdcw.xyz') return {ok:false,code:'SHOP_ORIGIN_INVALID'};
  const paths = {orders:'manager.order.getOrdersServerTable', detail:'manager.order.getOrder', metadata:'manager.order.getOrder', catalog:'public.category.getCategoryProducts'};
  if (!paths[kind]) return {ok:false,code:'SHOP_REQUEST_INVALID'};
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = new URL('/api/trpc/' + paths[kind], location.origin);
    url.searchParams.set('batch','1'); url.searchParams.set('input',JSON.stringify({0:{json:input}}));
    const response = await fetch(url.href, {method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    if (!response.ok) return {ok:false,code:response.status===401||response.status===403?'SHOP_LOGIN_REQUIRED':'SHOP_READ_FAILED'};
    const type = response.headers.get('content-type') || '';
    if (!type.includes('json')) return {ok:false,code:'SHOP_LOGIN_REQUIRED'};
    const text = await response.text();
    if (text.length > 4000000) return {ok:false,code:'SHOP_RESPONSE_TOO_LARGE'};
    const packet = JSON.parse(text);
    if (!Array.isArray(packet) || packet.length !== 1 || packet[0].error) return {ok:false,code:'SHOP_API_CHANGED'};
    const d = packet[0].result?.data?.json;
    if (!d || typeof d !== 'object') return {ok:false,code:'SHOP_API_CHANGED'};
    if (kind === 'orders') {
      if (!Array.isArray(d.data) || !Object.hasOwn(d,'nextCursor') || typeof d.countIsExact !== 'boolean' || !Number.isInteger(d.countEstimate) || d.countEstimate < 0) return {ok:false,code:'SHOP_API_CHANGED'};
      return {ok:true,data:{data:d.data.map(o=>({id:o.id,status:o.status,createdAt:o.createdAt,variant:{id:o.variant?.id,productGroup:{category:{id:o.variant?.productGroup?.category?.id}}}})),nextCursor:d.nextCursor,countEstimate:d.countEstimate,countIsExact:d.countIsExact}};
    }
    if (kind === 'catalog') {
      if (!Array.isArray(d.items) || !Object.hasOwn(d,'nextCursor')) return {ok:false,code:'SHOP_API_CHANGED'};
      return {ok:true,data:{items:d.items.map(p=>({id:p.id,name:p.name,categoryId:p.categoryId,variants:Array.isArray(p.variants)?p.variants.map(v=>({id:v.id,name:v.name,type:v.type})):null})),nextCursor:d.nextCursor}};
    }
    if (kind === 'metadata') {
      // History recovery never returns passwords, notes or the form itself.
      const users = Array.isArray(d.form) ? d.form.filter(f => f.type === 'text' && f.placeholder === 'ID/ชื่อผู้ใช้' && f.required === true) : [];
      const username = users.length === 1 && typeof users[0].value === 'string' ? users[0].value.trim() : '';
      return {ok:true,data:{id:d.id,status:d.status,createdAt:d.createdAt,variantId:d.variantId,deletedAt:d.deletedAt,customerUsername:/^[A-Za-z0-9_]{3,20}$/.test(username)?username:''}};
    }
    // Details contain credentials. Only expected credential field values are
    // returned; all other customer-entered values are intentionally discarded.
    if (!Array.isArray(d.form)) return {ok:false,code:'ORDER_FIELDS_INVALID'};
    return {ok:true,data:{id:d.id,status:d.status,createdAt:d.createdAt,variantId:d.variantId,deletedAt:d.deletedAt,form:d.form.map(f=>({type:f.type,placeholder:f.placeholder,required:f.required,value:f.placeholder==='ID/ชื่อผู้ใช้'||f.placeholder==='รหัสผ่าน'?f.value:undefined}))}};
  } catch { return {ok:false,code:'SHOP_READ_FAILED'}; }
  finally {clearTimeout(timer);}
}

async function requestInTab(tabId, kind, input) {
  let results;
  try {results = await chrome.scripting.executeScript({target:{tabId},func:shopReadInPage,args:[kind,input]});} catch {throw fault('SHOP_READ_FAILED');}
  if (results.length !== 1 || !results[0].result?.ok) throw fault(results[0]?.result?.code || 'SHOP_READ_FAILED');
  return results[0].result.data;
}
async function request(kind, input) {
  return withShopTab(tab => requestInTab(tab.id,kind,input));
}

export async function scanOrders(config, rpc = request) {
  validateCatalog(config);
  let cursor = null, scanned = 0, firstCount, firstExact;
  const cursors = new Set(), ids = new Set(), result = [];
  for (let page = 0; page < 200; page++) {
    const d = await rpc('orders',{cursor,pageSize:50,sorting:[{id:'createdAt',desc:false}],filtering:[],globalFiltering:'',showFinished:false});
    if (!d || !Array.isArray(d.data) || !Object.hasOwn(d,'nextCursor') || d.data.length > 50 || typeof d.countIsExact!=='boolean' || !Number.isInteger(d.countEstimate) || d.countEstimate<0) throw fault('SHOP_API_CHANGED');
    if (page === 0) {firstCount=d.countEstimate;firstExact=d.countIsExact;}
    if (d.countIsExact && firstExact && d.countEstimate !== firstCount) throw fault('SCAN_CHANGED');
    for (const row of d.data) {
      if (typeof row.id !== 'string' || ids.has(row.id)) throw fault('SCAN_CHANGED');
      ids.add(row.id);scanned++;
      const normalized=normalizeOrder(row,config.catalog);if(normalized)result.push(normalized);
    }
    if (d.nextCursor === null) {
      if (firstExact && scanned !== firstCount) throw fault('SCAN_CHANGED');
      // A multi-page scan must have stable head/count, otherwise we cannot
      // assert global FIFO while another operator is changing the list.
      if (page > 0) {
        const head=await rpc('orders',{cursor:null,pageSize:50,sorting:[{id:'createdAt',desc:false}],filtering:[],globalFiltering:'',showFinished:false});
        if (firstExact && head.countEstimate !== firstCount) throw fault('SCAN_CHANGED');
        const known=Array.from(ids).slice(0,50);
        if (head.data.map(r=>r.id).join('|')!==known.join('|')) throw fault('SCAN_CHANGED');
      }
      return result;
    }
    if (!d.data.length || typeof d.nextCursor !== 'string' || d.nextCursor.length > 4096 || cursors.has(d.nextCursor)) throw fault('SCAN_INCOMPLETE');
    cursors.add(d.nextCursor);cursor=d.nextCursor;
  }
  throw fault('SCAN_INCOMPLETE');
}

async function navigateEditor(tab, order, canReplace = true) {
  const url = `${SHOP_ORIGIN}/manager/orders/${order.orderId}/edit`;
  if (new URL(tab.url).pathname.replace(/\/$/,'') === new URL(url).pathname) return tab;
  try {await chrome.tabs.update(tab.id,{url});} catch {
    if (!canReplace || await findTab(tab.id)) throw fault('SHOP_READ_FAILED');
    // It closed after acquisition. Rediscover before creating a replacement,
    // and keep the replacement shared with all following reads.
    shopTabId = undefined;
    return navigateEditor(await getShopTab(),order,false);
  }
  return waitForTab(tab.id);
}

export async function openAndReadOrder(order) {
  if (order.shopId !== 'bewpakorn.rdcw.xyz' || !/^[a-z0-9]{10,80}$/.test(order.orderId)) throw fault('ORDER_ID_INVALID');
  // Open even when credential validation fails: the user must be able to
  // inspect/fix this order while Success remains the only advance signal.
  return withShopTab(async tab => {
    const editor = await navigateEditor(tab,order);
    const detail = await requestInTab(editor.id,'detail',order.orderId);
    return {tabId:editor.id,...readCredentialForm(detail,order)};
  });
}

export async function readOrderMetadata(orderId, config, rpc=request, loadCatalog=defaultCatalog) {
  if (!/^[a-z0-9]{10,80}$/.test(orderId)) throw fault('ORDER_ID_INVALID');
  validateCatalog(config);
  const d = await rpc('metadata', orderId);
  if (!d || d.id !== orderId || d.deletedAt !== null || !['PROCESSING','COMPLETED','FAILED','CANCELLED','REFUNDED'].includes(d.status)) throw fault('ORDER_CHANGED');
  // Back is explicit: an older order may belong to a map no longer selected.
  let catalog = config.catalog;
  if (!catalog.some(p => p.productId === d.variantId)) {
    catalog = await loadCatalog();
    validateCatalog({version:1,shopOrigin:SHOP_ORIGIN,catalog});
  }
  const p = catalog.find(p => p.productId === d.variantId);
  if (!p) throw fault('PRODUCT_IDENTITY_CHANGED');
  const map = MAPS.find(m => m.mapId === p.mapId);
  const order = normalizeOrder({id:d.id,status:'PROCESSING',createdAt:d.createdAt,variant:{id:d.variantId,productGroup:{category:{id:map.categoryId}}}},catalog);
  return {...order,status:d.status,revisit:true,customerUsername:typeof d.customerUsername === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(d.customerUsername)?d.customerUsername:''};
}

export async function defaultCatalog() {
  const response=await fetch(chrome.runtime.getURL('catalog.json'));
  if(!response.ok)throw fault('CATALOG_UNAVAILABLE');return response.json();
}
export async function discoverCatalog(rpc=request) {
  const catalog=[];
  for(const map of MAPS) {
    let cursor=null;const seen=new Set();
    for(let page=0;page<100;page++) {
      const d=await rpc('catalog',{id:map.categoryId,limit:50,...(cursor?{cursor}:{})});
      if(!Array.isArray(d.items)||!Object.hasOwn(d,'nextCursor'))throw fault('SHOP_API_CHANGED');
      for(const p of d.items) {
        if(p.categoryId!==map.categoryId||!Array.isArray(p.variants))throw fault('CATALOG_INVALID');
        for(const v of p.variants)if(v.type==='ORDER')catalog.push({productId:v.id,productName:[p.name,v.name].filter(Boolean).join(' · '),mapId:map.mapId,mapName:map.mapName,placeId:map.placeId,operatorUserId:''});
      }
      if(d.nextCursor===null)break;
      const key=JSON.stringify(d.nextCursor);
      const validCursor=typeof d.nextCursor==='string'||(d.nextCursor && Number.isInteger(d.nextCursor.bucket) && Number.isInteger(d.nextCursor.normalOrder) && typeof d.nextCursor.id==='string');
      if(!d.items.length||!validCursor||key.length>4096||seen.has(key)||page===99)throw fault('SCAN_INCOMPLETE');
      seen.add(key);cursor=d.nextCursor;
    }
  }
  validateCatalog({version:1,shopOrigin:SHOP_ORIGIN,catalog});return catalog;
}
