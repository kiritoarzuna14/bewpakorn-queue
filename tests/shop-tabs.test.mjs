import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS, normalizeOrder} from '../extension/queue.js';

const origin = 'https://bewpakorn.rdcw.xyz';
const catalog = MAPS.map((map,index) => ({productId:`product0000${index}`,productName:map.mapName,mapId:map.mapId,mapName:map.mapName,placeId:map.placeId,operatorUserId:''}));
const config = {version:1,shopOrigin:origin,catalog};
const row = id => ({id,status:'PROCESSING',createdAt:'2026-11-16T10:00:00.000Z',variant:{id:catalog[0].productId,productGroup:{category:{id:MAPS[0].categoryId}}}});
const order = id => normalizeOrder(row(id),catalog);
const editUrl = id => `${origin}/manager/orders/${id}/edit`;
let moduleId = 0;

async function harness(initialTabs, run, options = {}) {
  const tabs = new Map(initialTabs.map(tab => [tab.id,{status:'complete',...tab}]));
  const local = {...options.local}, session = {...options.session};
  const created = [], updated = [], executed = [], requests = [], queries = [];
  const storage = values => ({get:async key => ({[key]:structuredClone(values[key])}),set:async value => Object.assign(values,structuredClone(value))});
  let nextId = 1000;
  const env = {tabs,local,session,created,updated,executed,requests,queries,updateHook:null};
  globalThis.chrome = {
    storage:{local:storage(local),session:storage(session)},
    windows:{getLastFocused:async () => {if(options.windowError) throw Error('window closed'); return {id:options.windowId ?? 1};}},
    tabs:{
      query:async query => {queries.push(query); return [...tabs.values()].map(tab => ({...tab}));},
      get:async id => {if(!tabs.has(id)) throw Error(`No tab with id: ${id}.`); return {...tabs.get(id)};},
      create:async props => {
        assert.equal(props.active,false);
        assert.ok(Object.keys(props).every(key => ['url','active','windowId'].includes(key)));
        await Promise.resolve();
        const tab = {id:nextId++,status:'complete',...props};
        created.push({...tab});tabs.set(tab.id,tab);return {...tab};
      },
      update:async (id,props) => {
        assert.deepEqual(Object.keys(props),['url']);
        updated.push({id,...props});
        if(env.updateHook) await env.updateHook(id,props);
        if(!tabs.has(id)) throw Error(`No tab with id: ${id}.`);
        Object.assign(tabs.get(id),props,{status:'complete',form:null});
        return {...tabs.get(id)};
      }
    },
    scripting:{executeScript:async ({target,func,args}) => {
      const tab = tabs.get(target.tabId);assert.ok(tab);
      executed.push({id:target.tabId,kind:args[0]});
      globalThis.location = {origin:new URL(tab.url).origin};
      return [{result:await func(...args)}];
    }}
  };
  // Any DOM access would touch the user's pending form. The read function must
  // use only the allowlisted GET endpoints, even while an editor is open.
  globalThis.document = new Proxy({}, {get(){throw Error('Shop reads must not touch the form');}});
  globalThis.fetch = async (value,init) => {
    const url = new URL(value), input = JSON.parse(url.searchParams.get('input'))[0].json;
    assert.equal(url.origin,origin);assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');
    requests.push({url:url.href,input,method:init.method});
    let json;
    if(url.pathname.endsWith('getOrdersServerTable')) json = {data:[row('order000001')],nextCursor:null,countEstimate:1,countIsExact:true};
    else if(url.pathname.endsWith('getOrder')) json = {id:input,status:'PROCESSING',createdAt:row(input).createdAt,variantId:catalog[0].productId,deletedAt:null,form:[{type:'text',placeholder:'ID/ชื่อผู้ใช้',required:true,value:'customer_demo'},{type:'password',placeholder:'รหัสผ่าน',required:true,value:'FAKE_PASSWORD_ONLY'}]};
    else if(url.pathname.endsWith('getCategoryProducts')) {
      const index = MAPS.findIndex(map => map.categoryId === input.id);
      json = {items:[{id:`categoryitem${index}`,name:catalog[index].productName,categoryId:input.id,variants:[{id:catalog[index].productId,name:'',type:'ORDER'}]}],nextCursor:null};
    } else throw Error('Unexpected endpoint');
    return {ok:true,headers:{get:() => 'application/json'},text:async () => JSON.stringify([{result:{data:{json}}}])};
  };
  env.load = () => import(`../extension/shop.js?shopTabs=${++moduleId}`);
  try {await run(await env.load(),env);}
  finally {delete globalThis.chrome;delete globalThis.fetch;delete globalThis.location;delete globalThis.document;}
}

test('active existing editor supplies every GET and Success reuses its tab without focus or form submission',async () => {
  const pendingForm = {notes:'unsaved operator note',status:'pending manual change'};
  await harness([
    {id:7,windowId:1,active:true,url:editUrl('order000001'),form:pendingForm},
    {id:8,windowId:2,active:true,url:editUrl('order000003')},
    {id:9,windowId:1,active:false,url:`${origin}/manager/orders?ps=50`}
  ],async (shop,env) => {
    await shop.scanOrders(config);
    await shop.readOrderMetadata('order000001',config);
    await shop.discoverCatalog();
    const first = await shop.openAndReadOrder(order('order000001'));
    assert.equal(first.tabId,7);assert.equal(first.username,'customer_demo');
    assert.deepEqual(env.tabs.get(7).form,pendingForm);
    assert.equal(env.updated.length,0);
    const next = await shop.openAndReadOrder(order('order000002'));
    assert.equal(next.tabId,7);
    assert.deepEqual(env.updated,[{id:7,url:editUrl('order000002')}]);
    assert.equal(env.created.length,0);
    assert.ok(env.executed.every(call => call.id === 7));
    assert.equal(env.tabs.get(8).url,editUrl('order000003'));
    assert.equal(env.local.shopTabId,7);
    assert.ok(!JSON.stringify({local:env.local,session:env.session}).includes('FAKE_PASSWORD_ONLY'));
  },{local:{shopTabId:8},session:{shopReaderTabId:9}});
});

test('extension Reload with cleared session keys reuses the durable editor without reloading its form',async () => {
  await harness([{id:17,windowId:2,active:false,url:editUrl('order000001'),form:{notes:'still pending'}}],async (shop,env) => {
    await shop.scanOrders(config);
    assert.equal(env.local.shopTabId,17);
    for(const key of Object.keys(env.session)) delete env.session[key];
    const reloaded = await env.load();
    assert.equal((await reloaded.openAndReadOrder(order('order000001'))).tabId,17);
    assert.equal(env.created.length,0);assert.equal(env.updated.length,0);
    assert.deepEqual(env.tabs.get(17).form,{notes:'still pending'});
  });
});

test('browser restart rediscovers a changed tab ID and never navigates the unrelated saved ID',async () => {
  await harness([
    {id:20,windowId:1,active:false,url:'https://example.com/notes',form:{notes:'unrelated'}},
    {id:21,windowId:1,active:true,url:editUrl('order000001')}
  ],async (shop,env) => {
    assert.equal((await shop.openAndReadOrder(order('order000002'))).tabId,21);
    assert.equal(env.created.length,0);assert.equal(env.local.shopTabId,21);
    assert.deepEqual(env.updated,[{id:21,url:editUrl('order000002')}]);
    assert.equal(env.tabs.get(20).url,'https://example.com/notes');
  },{local:{shopTabId:20}});
});

test('parallel scans, details and metadata create only one shared background tab when none exists',async () => {
  await harness([],async (shop,env) => {
    const [scan,detail,metadata] = await Promise.all([
      shop.scanOrders(config),shop.openAndReadOrder(order('order000001')),shop.readOrderMetadata('order000001',config)
    ]);
    assert.equal(scan.length,1);assert.equal(detail.tabId,env.created[0].id);assert.equal(metadata.orderId,'order000001');
    assert.equal(env.created.length,1);assert.equal(env.updated.length,1);
    assert.ok(env.executed.every(call => call.id === detail.tabId));
    assert.ok(env.requests.every(call => call.method === 'GET'));
  });
});

test('closed remembered tab first rediscovers another editor, then creates only one fallback after all close',async () => {
  await harness([{id:31,windowId:1,active:false,url:editUrl('order000001')}],async (shop,env) => {
    await shop.scanOrders(config);assert.equal(env.created.length,0);
    env.tabs.delete(31);
    await Promise.all([shop.scanOrders(config),shop.readOrderMetadata('order000001',config)]);
    assert.equal(env.created.length,1);
    const fallback = env.created[0].id;
    assert.equal((await shop.openAndReadOrder(order('order000002'))).tabId,fallback);
    assert.ok(env.executed.slice(1).every(call => call.id === fallback));
    assert.equal(env.created.length,1);
  },{local:{shopTabId:30}});
});

test('an update failure with a live tab stops without opening a duplicate',async () => {
  await harness([{id:40,windowId:1,active:true,url:editUrl('order000001')}],async (shop,env) => {
    env.updateHook = async () => {throw Error('Tabs cannot be edited right now');};
    await assert.rejects(shop.openAndReadOrder(order('order000002')),{code:'SHOP_READ_FAILED'});
    assert.equal(env.created.length,0);assert.equal(env.executed.length,0);
    env.updateHook = null;
    assert.equal((await shop.openAndReadOrder(order('order000002'))).tabId,40);
    assert.equal(env.created.length,0);
  });
});

test('a tab closed during navigation gets one shared replacement',async () => {
  await harness([{id:50,windowId:1,active:true,url:editUrl('order000001')}],async (shop,env) => {
    env.updateHook = async id => {if(id === 50) {env.tabs.delete(id);throw Error('No tab with id: 50.');}};
    const detail = await shop.openAndReadOrder(order('order000002'));
    assert.equal(env.created.length,1);assert.equal(detail.tabId,env.created[0].id);
    await shop.readOrderMetadata('order000002',config);
    assert.ok(env.executed.every(call => call.id === detail.tabId));
    assert.equal(env.created.length,1);
  });
});

test('same-origin non-order pages, lookalike paths, foreign origins and outgoing tabs are never reused',async () => {
  const unrelated = [
    {id:60,url:`${origin}/manager/products`},
    {id:61,url:`${origin}/manager/orders-fake`},
    {id:62,url:'https://example.com/manager/orders/order000001/edit'},
    {id:63,url:editUrl('order000001'),pendingUrl:'https://example.com/'}
  ].map(tab => ({windowId:1,active:true,...tab}));
  await harness(unrelated,async (shop,env) => {
    const detail = await shop.openAndReadOrder(order('order000002'));
    assert.equal(env.created.length,1);assert.equal(detail.tabId,env.created[0].id);
    assert.ok(env.updated.every(call => call.id === detail.tabId));
    assert.ok(env.executed.every(call => call.id === detail.tabId));
    for(const tab of unrelated) assert.equal(env.tabs.get(tab.id).url,tab.url);
  },{local:{shopTabId:62}});
});

test('closed last-focused window reuses another existing order tab without requesting focus',async () => {
  await harness([{id:70,windowId:2,active:false,url:`${origin}/manager/orders/order000001`}],async (shop,env) => {
    await shop.scanOrders(config);
    assert.equal((await shop.openAndReadOrder(order('order000001'))).tabId,70);
    assert.equal(env.created.length,0);
    assert.deepEqual(env.updated,[{id:70,url:editUrl('order000001')}]);
  },{windowError:true});
});

test('remembered shop login redirects stop repeated reads without opening extra tabs',async () => {
  await harness([{id:80,windowId:1,active:true,url:editUrl('order000001')}],async (shop,env) => {
    await shop.scanOrders(config);
    env.tabs.get(80).url = `${origin}/auth/sign-in?returnTo=/manager/orders`;
    for(let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(shop.scanOrders(config),{code:'SHOP_LOGIN_REQUIRED'});
    }
    const reloaded = await env.load();
    await assert.rejects(reloaded.openAndReadOrder(order('order000002')),{code:'SHOP_LOGIN_REQUIRED'});
    assert.equal(env.created.length,0);assert.equal(env.updated.length,0);
    assert.equal(env.executed.length,1);
  });
});

test('remembered same-origin product forms are preserved until the user reopens an order page',async () => {
  await harness([{id:90,windowId:1,active:true,url:`${origin}/manager/products`,form:{name:'unsaved product'}}],async (shop,env) => {
    for(let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(shop.scanOrders(config),{code:'SHOP_TAB_CHANGED'});
    }
    const reloaded = await env.load();
    await assert.rejects(reloaded.openAndReadOrder(order('order000002')),{code:'SHOP_TAB_CHANGED'});
    assert.equal(env.created.length,0);assert.equal(env.updated.length,0);assert.equal(env.executed.length,0);
    assert.deepEqual(env.tabs.get(90).form,{name:'unsaved product'});
    env.tabs.get(90).url = editUrl('order000001');
    await reloaded.scanOrders(config);
    assert.equal(env.executed[0].id,90);assert.equal(env.created.length,0);
  },{local:{shopTabId:90}});
});
