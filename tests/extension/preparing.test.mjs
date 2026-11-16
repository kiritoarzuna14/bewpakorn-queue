import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const event=()=>{const listeners=[];return {addListener:f=>listeners.push(f),emit:(...a)=>listeners.map(f=>f(...a))};};
test('Success during credential read cancels the old preparation without blocking next job',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'queue-preparing-'));let release;
 try{
  for(const name of ['worker.js','native.js','notifications.js','messages.js','package.json'])await copyFile(new URL(`../../extension/${name}`,import.meta.url),join(folder,name));
  globalThis.__oldRead=new Promise(r=>{release=r;});
  await writeFile(join(folder,'shop.js'),`export const defaultCatalog=async()=>[];export const discoverCatalog=async()=>[];export const scanOrders=async()=>[{shopId:'shop',orderId:'one'},{shopId:'shop',orderId:'two'}];export const openAndReadOrder=async o=>o.orderId==='one'?globalThis.__oldRead:{username:'second',password:'FAKE'};`);
  await writeFile(join(folder,'queue.js'),`export const validateCatalog=()=>true;export const selectPending=(orders,done)=>orders.filter(o=>!done.some(h=>h.orderId===o.orderId));`);
  const local={config:{version:1,shopOrigin:'shop',catalog:[]}},calls=[],done=[];let current=null,revision=0;
  const message=event(),port={onMessage:event(),onDisconnect:event(),postMessage(m){calls.push(m);queueMicrotask(()=>{
   if(m.type==='CLAIM_ORDER'){current={jobId:m.payload.order.orderId,generation:1,completionToken:'token',order:m.payload.order,customer:{state:'waiting'},operator:{state:'ready'},state:'preparing'};revision++;}
   if(m.type==='COMPLETE_CURRENT'){done.push({orderId:current.order.orderId});current=null;revision++;}
   if(m.type==='PREPARE_CUSTOMER'){assert.equal(m.payload.jobId,'two');current.customer.state='ready';revision++;}
   port.onMessage.emit(structuredClone({v:1,id:m.id,type:'RESULT',ok:true,payload:{revision,current,handled:done}}));
  });}};
  globalThis.chrome={runtime:{id:'test',getURL:()=> 'chrome-extension://test/',connectNative:()=>port,onMessage:message,sendMessage:async()=>{}},storage:{local:{get:async k=>({[k]:local[k]}),set:async obj=>Object.assign(local,obj),remove:async k=>{delete local[k];}}},notifications:{create:async()=>{}},action:{setBadgeText:async()=>{},onClicked:event()},sidePanel:{open:async()=>{}}};
  await import(pathToFileURL(join(folder,'worker.js')));await new Promise(r=>setTimeout(r,10));
  const send=(type,payload)=>new Promise(resolve=>message.emit({type,payload},{id:'test',url:'chrome-extension://test/panel.html'},resolve));
  const start=send('UI_START');for(let i=0;i<100&&!current;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(current.order.orderId,'one');const first=current;
  const result=await send('UI_COMPLETE',{jobId:first.jobId,generation:1,completionToken:'token',orderId:'one'});
  assert.equal(result.ok,true);assert.equal(result.payload.native.current.order.orderId,'two');
  release({username:'first',password:'FAKE'});await start;
  assert.equal(calls.filter(m=>m.type==='PREPARE_CUSTOMER').length,1);
  assert.equal((await send('UI_GET')).payload.native.current.order.orderId,'two');
 }finally{release?.({username:'first',password:'FAKE'});delete globalThis.chrome;delete globalThis.__oldRead;await rm(folder,{recursive:true,force:true});}
});
