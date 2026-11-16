import {SHOP_ORIGIN, MAPS, validateCatalog, normalizeOrder, readCredentialForm, fault} from './queue.js';

// All reads run in an owned same-origin reader tab, using the user's existing
// shop session. We never refresh an editor tab or execute fetched page scripts.
let readerId;
let pendingReader;
async function waitForTab(id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(id);
    if (t.status === 'complete') {
      if (!t.url || new URL(t.url).origin !== SHOP_ORIGIN) throw fault('SHOP_LOGIN_REQUIRED');
      return t;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw fault('SHOP_LOAD_TIMEOUT');
}
async function getReader() {
  if (pendingReader) return pendingReader;
  pendingReader = (async () => {
    if (readerId) { try { const t = await chrome.tabs.get(readerId); if (new URL(t.url).origin === SHOP_ORIGIN && new URL(t.url).pathname === '/manager/orders') return readerId; } catch {} }
    const owned = await chrome.storage.session.get('shopReaderTabId');
    if (owned.shopReaderTabId) { try { const t = await chrome.tabs.get(owned.shopReaderTabId); if (new URL(t.url).origin === SHOP_ORIGIN && new URL(t.url).pathname === '/manager/orders') {readerId = t.id; return readerId;} } catch {} }
    const tab = await chrome.tabs.create({url: `${SHOP_ORIGIN}/manager/orders?ps=50`, active: false});
    readerId = tab.id;
    await chrome.storage.session.set({shopReaderTabId: readerId});
    await waitForTab(readerId);
    return readerId;
  })();
  try { return await pendingReader; } finally { pendingReader = null; }
}

// Self-contained because Chrome serializes the function into an isolated world.
// Fixed endpoint allowlist, GET only, strict projection: descriptions, customer
// notes, images and tokens never leave the reader context.
export async function shopReadInPage(kind, input) {
  if (location.origin !== 'https://bewpakorn.rdcw.xyz') return {ok:false,code:'SHOP_ORIGIN_INVALID'};
  const paths = {orders:'manager.order.getOrdersServerTable', detail:'manager.order.getOrder', catalog:'public.category.getCategoryProducts'};
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
    // Details contain credentials. Only expected credential field values are
    // returned; all other customer-entered values are intentionally discarded.
    if (!Array.isArray(d.form)) return {ok:false,code:'ORDER_FIELDS_INVALID'};
    return {ok:true,data:{id:d.id,status:d.status,createdAt:d.createdAt,variantId:d.variantId,deletedAt:d.deletedAt,form:d.form.map(f=>({type:f.type,placeholder:f.placeholder,required:f.required,value:f.placeholder==='ID/ชื่อผู้ใช้'||f.placeholder==='รหัสผ่าน'?f.value:undefined}))}};
  } catch { return {ok:false,code:'SHOP_READ_FAILED'}; }
  finally {clearTimeout(timer);}
}

async function request(kind, input) {
  const tabId = await getReader();
  let results;
  try {results = await chrome.scripting.executeScript({target:{tabId},func:shopReadInPage,args:[kind,input]});} catch {throw fault('SHOP_READ_FAILED');}
  if (results.length !== 1 || !results[0].result?.ok) throw fault(results[0]?.result?.code || 'SHOP_READ_FAILED');
  return results[0].result.data;
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

export async function openAndReadOrder(order) {
  if (order.shopId !== 'bewpakorn.rdcw.xyz' || !/^[a-z0-9]{10,80}$/.test(order.orderId)) throw fault('ORDER_ID_INVALID');
  // Open even when credential validation fails: the user must be able to
  // inspect/fix this order while Success remains the only advance signal.
  const tab = await chrome.tabs.create({url:`${SHOP_ORIGIN}/manager/orders/${order.orderId}/edit`,active:true});
  const detail = await request('detail',order.orderId);
  const credentials = readCredentialForm(detail,order);
  return {tabId:tab.id,...credentials};
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
