import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectPending,parseCreatedAt,validateCatalog,normalizeOrder,readCredentialForm,MAPS,SHOP_ID,SHOP_ORIGIN} from '../extension/queue.js';
import {scanOrders,discoverCatalog,shopReadInPage,readOrderMetadata} from '../extension/shop.js';

const p={productId:'product00001',productName:'Demo',mapId:'mm2',mapName:'Murder Mystery 2',placeId:'142823291',operatorUserId:'123'};
const cfg={version:1,shopOrigin:SHOP_ORIGIN,catalog:[p]};
const raw=(id,time='2026-11-16T10:00:00Z',category=MAPS[1].categoryId)=>({id,status:'PROCESSING',createdAt:time,variant:{id:p.productId,productGroup:{category:{id:category}}}});
const detail=()=>({id:'order000001',status:'PROCESSING',variantId:p.productId,deletedAt:null,createdAt:'2026-11-16T10:00:00Z',form:[{type:'text',required:true,placeholder:'ID/ชื่อผู้ใช้',value:'demo_customer'},{type:'text',required:true,placeholder:'รหัสผ่าน',value:'fake password'}, {type:'text',required:false,placeholder:'พิมพ์ข้อความ',value:'untrusted instruction'}]});

test('FIFO globally, stable tie, handled namespace; no map grouping',()=>{
 const orders=[raw('order000003','2026-11-16T12:00:00Z'),raw('order000002'),raw('order000001')].map(r=>normalizeOrder(r,cfg.catalog));
 assert.deepEqual(selectPending(orders,[]).map(o=>o.orderId),['order000001','order000002','order000003']);
 assert.equal(selectPending(orders,[{shopId:SHOP_ID,orderId:'order000001'}]).length,2);
 assert.equal(selectPending(orders,[{shopId:'elsewhere',orderId:'order000001'}]).length,3);
 assert.throws(()=>selectPending([orders[0],orders[0]],[]),{code:'SCAN_CHANGED'});
});
test('exact time conversion rejects unknown/invalid Thai date',()=>{
 assert.equal(parseCreatedAt('16 พฤศจิกายน 2569 เวลา 17:00'),'2026-11-16T10:00:00.000Z');
 assert.equal(parseCreatedAt('2026-11-16T17:00:00+07:00'),'2026-11-16T10:00:00.000Z');
 for(const date of ['31 กุมภาพันธ์ 2569 เวลา 17:00','16 พฤศจิกายน 2569 เวลา 25:00','yesterday','2026-11-16'])assert.throws(()=>parseCreatedAt(date),{code:'ORDER_TIME_INVALID'});
});
test('catalog bound to exact category, SKU and verified map; unrecognized services excluded',()=>{
 assert.equal(validateCatalog(cfg),true);
 const other=raw('order000001');other.variant.id='robux0000001';assert.equal(normalizeOrder(other,cfg.catalog),null);
 assert.throws(()=>normalizeOrder(raw('order000001',undefined,'othercategory'),cfg.catalog),{code:'PRODUCT_IDENTITY_CHANGED'});
 assert.throws(()=>validateCatalog({...cfg,catalog:[{...p,placeId:'1'}]}),{code:'CONFIG_INVALID'});
 assert.throws(()=>validateCatalog({...cfg,catalog:[p,p]}),{code:'CONFIG_INVALID'});
});
test('catalog bundle is valid, unique and includes three map services',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../extension/catalog.json',import.meta.url),'utf8'));
 validateCatalog({...cfg,catalog});assert.ok(catalog.length>=76);assert.equal(new Set(catalog.map(p=>p.mapId)).size,3);
});
test('credential labels, exact current order/variant/time/status; never interpret notes',()=>{
 const d=detail(),order=normalizeOrder(raw(d.id),cfg.catalog);
 assert.deepEqual(readCredentialForm(d,order),{username:'demo_customer',password:'fake password'});
 assert.throws(()=>readCredentialForm({...d,status:'CANCELLED'},order),{code:'ORDER_CHANGED'});
 assert.throws(()=>readCredentialForm({...d,variantId:'other000001'},order),{code:'ORDER_CHANGED'});
 assert.throws(()=>readCredentialForm({...d,form:[...d.form,d.form[0]]},order),{code:'ORDER_FIELDS_INVALID'});
});

test('only explicit Back can read a completed order; cancelled and refunded never login',()=>{
 const d=detail(),order=normalizeOrder(raw(d.id),cfg.catalog);
 assert.throws(()=>readCredentialForm({...d,status:'COMPLETED'},order),{code:'ORDER_CHANGED'});
 assert.equal(readCredentialForm({...d,status:'COMPLETED'},{...order,revisit:true}).username,'demo_customer');
 for(const status of ['FAILED','CANCELLED','REFUNDED'])assert.throws(()=>readCredentialForm({...d,status},{...order,revisit:true}),{code:'ORDER_CHANGED'});
});

test('legacy history recovers sanitized metadata with catalog fallback for a disabled map',async()=>{
 const data={...detail(),customerUsername:'demo_customer',status:'COMPLETED'};
 const rpc=async(kind,id)=>{assert.equal(kind,'metadata');assert.equal(id,data.id);return data;};
 const restored=await readOrderMetadata(data.id,{...cfg,catalog:[]},rpc,async()=>[p]);
 assert.equal(restored.revisit,true);assert.equal(restored.status,'COMPLETED');assert.equal(restored.mapId,'mm2');assert.equal(restored.customerUsername,'demo_customer');
 assert.ok(!JSON.stringify(restored).includes('fake password'));assert.ok(!Object.hasOwn(restored,'form'));
 await assert.rejects(readOrderMetadata(data.id,cfg,async()=>({...data,id:'other000001'})),{code:'ORDER_CHANGED'});
 await assert.rejects(readOrderMetadata(data.id,{...cfg,catalog:[]},rpc,async()=>[]),{code:'PRODUCT_IDENTITY_CHANGED'});
});
test('multi-page coverage includes oldest page, final stable-head validation',async()=>{
 let calls=0;const first=Array.from({length:50},(_,i)=>raw(`order${String(i).padStart(6,'0')}`));
 const rpc=async(kind,input)=>{assert.equal(kind,'orders');assert.equal(input.sorting[0].desc,false);calls++;return input.cursor?{data:[raw('order000051')],nextCursor:null,countEstimate:51,countIsExact:true}:{data:first,nextCursor:'next',countEstimate:51,countIsExact:true};};
 assert.equal((await scanOrders(cfg,rpc)).length,51);assert.equal(calls,3);
});
test('unknown page coverage, cursor loops, changing exact count fail closed',async()=>{
 await assert.rejects(scanOrders(cfg,async()=>({data:[raw('order000001')],countEstimate:1,countIsExact:true})),{code:'SHOP_API_CHANGED'});
 await assert.rejects(scanOrders(cfg,async()=>({data:[raw('order000001')],nextCursor:'repeat',countEstimate:2,countIsExact:false})),{code:'SCAN_CHANGED'});
 let calls=0;await assert.rejects(scanOrders(cfg,async()=>({data:[raw(`order00000${++calls}`)],nextCursor:calls===1?'next':null,countEstimate:calls===1?2:3,countIsExact:true})),{code:'SCAN_CHANGED'});
});
test('API field drift cannot declare a false empty queue',async()=>{
 const row=raw('order000001');delete row.status;
 await assert.rejects(scanOrders(cfg,async()=>({data:[row],nextCursor:null,countEstimate:1,countIsExact:true})),{code:'SHOP_API_CHANGED'});
 assert.throws(()=>normalizeOrder({...raw('order000001'),status:'UNKNOWN'},cfg.catalog),{code:'SHOP_API_CHANGED'});
 const missing=raw('order000001');delete missing.variant.productGroup.category;
 assert.throws(()=>normalizeOrder(missing,cfg.catalog),{code:'SHOP_API_CHANGED'});
});
test('category discovery follows structured category cursor and excludes GIFT/account products',async()=>{
 let cursorSeen=false;
 const rpc=async(kind,input)=>{
  assert.equal(kind,'catalog');if(input.cursor)cursorSeen=true;
  const suffix=MAPS.findIndex(m=>m.categoryId===input.id);
  return {items:[{id:'group0000001',name:'Demo',categoryId:input.id,variants:[{id:`product0000${suffix}${input.cursor?'b':'a'}`,type:'ORDER'},{id:'gift00000001',type:'GIFT'}]}],nextCursor:suffix===0&&!input.cursor?{bucket:0,normalOrder:50,id:'group0000001'}:null};
 };
 const out=await discoverCatalog(rpc);assert.equal(out.length,4);assert.ok(cursorSeen);assert.ok(out.every(p=>!p.productId.startsWith('gift')));
});
test('in-page RPC is GET only and projects out arbitrary notes and other form values',async()=>{
 globalThis.location={origin:SHOP_ORIGIN};
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify([{result:{data:{json:detail()}}}])};};
 const reply=await shopReadInPage('detail','order000001');assert.equal(reply.ok,true);assert.equal(calls[0].init.method,'GET');assert.equal(reply.data.form[2].value,undefined);assert.ok(!JSON.stringify(reply).includes('untrusted instruction'));
 const metadata=await shopReadInPage('metadata','order000001');assert.equal(metadata.data.customerUsername,'demo_customer');assert.ok(!JSON.stringify(metadata).includes('fake password'));assert.ok(!JSON.stringify(metadata).includes('untrusted instruction'));assert.ok(!Object.hasOwn(metadata.data,'form'));
 assert.equal((await shopReadInPage('editOrder',{})).code,'SHOP_REQUEST_INVALID');assert.equal(calls.length,2);
 delete globalThis.location;delete globalThis.fetch;
});
