import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const event=()=>{const listeners=[];return {addListener:f=>listeners.push(f),emit:(...a)=>listeners.map(f=>f(...a))};};
async function harness({oldNative=false}={}){
 const folder=await mkdtemp(join(tmpdir(),'queue-pair-worker-'));
 for(const file of ['worker.js','native.js','notifications.js','messages.js','package.json'])await copyFile(new URL(`../../extension/${file}`,import.meta.url),join(folder,file));
 await writeFile(join(folder,'shop.js'),`export const readOrderMetadata=async()=>({});export const defaultCatalog=async()=>[];export const discoverCatalog=async()=>[];export const scanOrders=async()=>[{shopId:'shop',orderId:'next',operatorUserId:'11'}];export const openAndReadOrder=async()=>({username:'demo_user',password:'FAKE'});`);
 await writeFile(join(folder,'queue.js'),`export const validateCatalog=()=>true;export const operatorPool=p=>p.operatorUserIds||(p.operatorUserId?[p.operatorUserId]:[]);export const selectPending=(a,done)=>a.filter(x=>!done.some(y=>x.orderId===y.orderId));`);
 const calls=[],storage={config:{version:1,catalog:[{operatorUserId:'11'}]}},handled=[];let current={jobId:'old',generation:1,completionToken:'token',order:{orderId:'old'},customer:{userId:'22',state:'ready'},operator:{state:'ready'},state:'ready'},revision=1,closeReady=false;
 const messages=event(),port={onMessage:event(),onDisconnect:event(),postMessage(m){calls.push(m);queueMicrotask(()=>{
  let payload,error;
  if(m.type==='GET_CAPABILITIES')payload={loginOnly:!oldNative,accountSelection:!oldNative,undoLast:!oldNative,ramImportSupported:true,browserLogin:!oldNative,customerGameLaunch:!oldNative};
  else{
   if(m.type==='COMPLETE_CURRENT'){
    if(!closeReady)error='RAM_IMPORT_UNCERTAIN';
    else if(!handled.some(x=>x.orderId==='old')){handled.push({orderId:'old'});current=null;revision++;}
   }
   if(m.type==='CLAIM_ORDER'){current={jobId:'next',generation:1,completionToken:'next-token',order:m.payload.order,customer:{state:'waiting'},operator:{state:'ready'},state:'preparing'};revision++;}
   payload={revision,current,handled};
  }
  port.onMessage.emit(structuredClone(error?{v:1,id:m.id,type:'RESULT',ok:false,error:{code:error}}:{v:1,id:m.id,type:'RESULT',ok:true,payload}));
 });}};
 globalThis.chrome={runtime:{id:'test',getURL:()=> 'chrome-extension://test/',connectNative:()=>port,onMessage:messages,sendMessage:async()=>{}},storage:{local:{get:async k=>({[k]:storage[k]}),set:async x=>Object.assign(storage,x),remove:async k=>delete storage[k]}},notifications:{create:async()=>{}},action:{setBadgeText:async()=>{},onClicked:event()},sidePanel:{open:async()=>{}}};
 await import(pathToFileURL(join(folder,'worker.js')));await new Promise(r=>setTimeout(r,15));
 return {calls,storage,handled,ready(){closeReady=true;},send:(type,payload)=>new Promise(resolve=>messages.emit({type,payload},{id:'test',url:'chrome-extension://test/panel.html'},resolve)),async cleanup(){delete globalThis.chrome;await rm(folder,{recursive:true,force:true});}};
}
test('an old native host cannot claim or prepare a customer',async()=>{const h=await harness({oldNative:true});try{const result=await h.send('UI_START');assert.equal(result.error.code,'NATIVE_UPDATE_REQUIRED');assert.ok(!h.calls.some(c=>['CLAIM_ORDER','PREPARE_CUSTOMER','LAUNCH_PAIR'].includes(c.type)));}finally{await h.cleanup();}});
test('one Success waits for import settlement then automatically advances exactly once',async()=>{const h=await harness();try{
 const result=await h.send('UI_COMPLETE',{jobId:'old',generation:1,completionToken:'token',orderId:'old'});assert.equal(result.error.code,'RAM_IMPORT_UNCERTAIN');const command=h.storage.completionIntent.commandId;assert.equal(h.storage.completionIntent.advanceAfterAck,true);assert.equal(h.calls.some(c=>c.type==='CLAIM_ORDER'),false);
 await h.send('UI_GET');assert.equal(h.storage.completionIntent.commandId,command);h.ready();const after=await h.send('UI_GET');assert.equal(after.payload.native.current.order.orderId,'next');assert.equal(h.storage.completionIntent,undefined);assert.equal(h.handled.length,1);assert.equal(h.calls.filter(c=>c.type==='CLAIM_ORDER').length,1);assert.equal(new Set(h.calls.filter(c=>c.type==='COMPLETE_CURRENT').map(c=>c.payload.commandId)).size,1);
}finally{await h.cleanup();}});
