import test from 'node:test';
import assert from 'node:assert/strict';
const event=()=>{const listeners=[];return {addListener:f=>listeners.push(f),emit:(...a)=>listeners.map(f=>f(...a))};};
const origin='https://bewpakorn.rdcw.xyz';
const catalog=[{productId:'product00001',productName:'First',mapId:'mm2',mapName:'Murder Mystery 2',placeId:'142823291',operatorUserId:'123'},{productId:'product00002',productName:'Second',mapId:'cameraman',mapName:'Cameraman Tower Defense',placeId:'132929771812494',operatorUserId:'456'}];
const orders=[{id:'order000002',status:'PROCESSING',createdAt:'2026-11-16T12:00:00.000Z',variant:{id:'product00002',productGroup:{category:{id:'cmv3w3yc802ha01nv1rbvsl9t'}}}},{id:'order000001',status:'PROCESSING',createdAt:'2026-11-16T10:00:00.000Z',variant:{id:'product00001',productGroup:{category:{id:'cmp8nyhvu06vr49d4p6i3i9is'}}}},{id:'orderrobux01',status:'PROCESSING',createdAt:'2026-11-15T00:00:00.000Z',variant:{id:'robux0000001',productGroup:{category:{id:'cm1ax636h1cqtbhxmrkx1bd0p'}}}}];
test('real worker + shop + queue: oldest first, background editor, RAM hand-off, durable completion, undo, no secrets',async()=>{
 let current=null,revision=0,serial=0;const handled=[],nativeCalls=[],httpCalls=[],tabs=new Map();
 const local={config:{version:1,shopOrigin:origin,catalog}},session={};
 const storage=values=>({get:async k=>({[k]:structuredClone(values[k])}),set:async obj=>{assert.ok(!JSON.stringify(obj).includes('FAKE_PASSWORD_ONLY'));Object.assign(values,structuredClone(obj));},remove:async k=>{delete values[k];}});
 const runtimeMessage=event(),action=event();
 const port={onMessage:event(),onDisconnect:event(),postMessage(m){nativeCalls.push(m);queueMicrotask(()=>{
  let payload;
  if(m.type==='GET_CAPABILITIES')payload={loginOnly:true,accountSelection:true,undoLast:true,ramImportSupported:true,browserLogin:true,customerGameLaunch:true};else if(m.type==='GET_SNAPSHOT')payload={revision,current,handled};
  else if(m.type==='GET_ACCOUNT_METADATA')payload={accounts:[{userId:'999',username:'customer_demo'}]};
  else if(m.type==='CLAIM_ORDER'){
   assert.deepEqual(m.payload.protectedOperatorUserIds?.slice().sort(),['123','456']);
   assert.equal(current,null);const order=m.payload.order;current={jobId:`job${++serial}`,generation:1,completionToken:`token${serial}`,order,state:'preparing',customer:{state:'waiting',username:''}};revision++;payload={revision,current,handled};
  }else if(m.type==='PREPARE_CUSTOMER'){
   assert.equal(m.payload.jobId,current.jobId);assert.equal(m.payload.mode,'browser');assert.equal(m.payload.password,undefined);current.customer={state:'ready',username:m.payload.username,userId:'999'};current.state='ready';revision++;payload={revision,current,handled};
  }else if(m.type==='COMPLETE_CURRENT'){
   assert.equal(local.completionIntent.commandId,m.payload.commandId);assert.equal(m.payload.jobId,current.jobId);handled.push({shopId:current.order.shopId,orderId:current.order.orderId,completedAt:'2026-11-16T12:00:00Z',order:current.order});current=null;revision++;payload={revision,current,handled};
  }else if(m.type==='UNDO_LAST'){
   if(!handled.length){port.onMessage.emit({v:1,id:m.id,type:'RESULT',ok:false,error:{code:'NOTHING_TO_UNDO'}});return;}
   const last=handled.pop();current={jobId:`job${++serial}`,generation:1,completionToken:`token${serial}`,order:last.order,state:'preparing',customer:{state:'waiting',username:''}};revision++;payload={revision,current,handled};
  }else throw Error(`unexpected ${m.type}`);
  port.onMessage.emit(structuredClone({v:1,id:m.id,type:'RESULT',ok:true,payload}));
 });}};
 globalThis.location={origin};
 globalThis.fetch=async(url,init)=>{
  const u=new URL(url);httpCalls.push({pathname:u.pathname,method:init.method});assert.equal(init.method,'GET');
  const input=JSON.parse(u.searchParams.get('input'))[0].json;let json;
  if(u.pathname.endsWith('getOrdersServerTable'))json={data:orders,nextCursor:null,countEstimate:3,countIsExact:true};
  else if(u.pathname.endsWith('getOrder')){const o=orders.find(o=>o.id===input);json={id:o.id,status:o.status,createdAt:o.createdAt,variantId:o.variant.id,deletedAt:null,form:[{type:'text',placeholder:'ID/ชื่อผู้ใช้',required:true,value:'customer_demo'},{type:'text',placeholder:'รหัสผ่าน',required:true,value:'FAKE_PASSWORD_ONLY'}]};}
  else throw Error('unexpected endpoint');
  return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify([{result:{data:{json}}}])};
 };
 globalThis.chrome={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:runtimeMessage,sendMessage:async()=>{},connectNative:()=>port},storage:{local:storage(local),session:storage(session)},notifications:{create:async()=>{}},action:{onClicked:action,setBadgeText:async()=>{}},sidePanel:{open:async()=>{}},tabs:{create:async options=>{const tab={id:tabs.size+1,status:'complete',...options};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},update:async(id,props)=>{const tab=tabs.get(id);Object.assign(tab,props);tab.status='complete';return tab;}},windows:{getLastFocused:async()=>({id:1})},scripting:{executeScript:async({func,args})=>[{result:await func(...args)}]}};
 try {
  await import('../extension/worker.js');await new Promise(r=>setTimeout(r,30));assert.deepEqual(nativeCalls.map(m=>m.type),['GET_SNAPSHOT']);assert.equal(httpCalls.length,0);
  const send=(type,payload)=>new Promise(resolve=>runtimeMessage.emit({type,payload},{id:'test',url:'chrome-extension://test/panel.html'},resolve));
  let reply=await send('UI_START');assert.equal(reply.ok,true);assert.equal(reply.payload.native.current.order.orderId,'order000001');assert.equal(reply.payload.native.current.state,'ready');
  assert.ok([...tabs.values()].every(t=>t.active!==true));assert.ok([...tabs.values()].some(t=>t.url===`${origin}/manager/orders/order000001/edit`));
  const first=reply.payload.native.current;const identity={jobId:first.jobId,orderId:first.order.orderId,generation:first.generation,completionToken:first.completionToken};
  reply=await send('UI_COMPLETE',identity);assert.equal(reply.ok,true);assert.equal(reply.payload.native.current.order.orderId,'order000002');
  assert.equal((await send('UI_COMPLETE',identity)).error.code,'STALE_JOB');
  assert.equal(nativeCalls.some(m=>m.type==='LAUNCH_PAIR'),false);
  const second=reply.payload.native.current;reply=await send('UI_COMPLETE',{jobId:second.jobId,orderId:second.order.orderId,generation:second.generation,completionToken:second.completionToken});assert.equal(reply.payload.phase,'empty');
  assert.deepEqual(handled.map(o=>o.orderId),['order000001','order000002']);assert.ok(httpCalls.every(c=>c.method==='GET'));assert.equal(local.completionIntent,undefined);
  reply=await send('UI_UNDO',{expectedLastOrderId:'order000002'});assert.equal(reply.ok,true);assert.equal(reply.payload.native.current.order.orderId,'order000002');assert.equal(reply.payload.native.current.state,'ready');assert.deepEqual(handled.map(o=>o.orderId),['order000001']);
  const restored=reply.payload.native.current;
  reply=await send('UI_UNDO',{jobId:restored.jobId,orderId:restored.order.orderId,generation:restored.generation,completionToken:restored.completionToken,expectedLastOrderId:'order000001'});assert.equal(reply.payload.native.current.order.orderId,'order000001');assert.equal(handled.length,0);
  assert.ok(!nativeCalls.some(m=>m.type==='LAUNCH_PAIR'));
  assert.ok(!JSON.stringify({local,session}).includes('FAKE_PASSWORD_ONLY'));
  await new Promise(resolve=>setTimeout(resolve,30));
 }finally{delete globalThis.chrome;delete globalThis.fetch;delete globalThis.location;}
});
