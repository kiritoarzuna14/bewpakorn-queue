import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const event=()=>{const listeners=[];return {addListener:f=>listeners.push(f),emit:(...args)=>listeners.map(f=>f(...args))};};
const identity=j=>j?{jobId:j.jobId,generation:j.generation,completionToken:j.completionToken,orderId:j.order.orderId}:{};
async function harness({legacy=false,status="PROCESSING",empty=false,metadataGate=null}={}) {
 const folder=await mkdtemp(join(tmpdir(),'queue-selection-'));const calls=[],reads=[],metadata=[],storage={config:{version:1,catalog:[{operatorUserId:'11'}]}},commands=new Set();
 for(const file of ['worker.js','native.js','notifications.js','messages.js','package.json'])await copyFile(new URL(`../../extension/${file}`,import.meta.url),join(folder,file));
 globalThis.__selectionReads=reads;globalThis.__metadataReads=metadata;globalThis.__metadataStatus=status;globalThis.__metadataGate=metadataGate;
 await writeFile(join(folder,'shop.js'),`export const defaultCatalog=async()=>[];export const discoverCatalog=async()=>[{productId:"p",productName:"Product",mapId:"m",mapName:"Map",placeId:"1"}];export const scanOrders=async()=>[];export const readOrderMetadata=async id=>{globalThis.__metadataReads.push(id);if(globalThis.__metadataGate)await globalThis.__metadataGate;return {shopId:'shop',orderId:id,revisit:true,status:globalThis.__metadataStatus,customerUsername:'original'};};export const openAndReadOrder=async o=>{globalThis.__selectionReads.push(o.orderId);return {username:'original',password:'SYNTHETIC_PASSWORD'};};`);
 await writeFile(join(folder,'queue.js'),`export const operatorPool=p=>p.operatorUserIds||[p.operatorUserId];export const validateCatalog=()=>true;export const selectPending=x=>x;`);
 let current={jobId:'current',generation:1,completionToken:'initial',order:{shopId:'shop',orderId:'current',customerUsername:'original'},customer:{source:'order',state:'preparing',username:'original'},operator:{source:'ram',state:'ready',userId:'11',username:'operator'},state:'preparing'},revision=1,applied=0,loseReply=false,rejectCode='';
 if(empty)current=null;
 const handled=[{shopId:'shop',orderId:'older',order:{shopId:'shop',orderId:'older'}},{shopId:'shop',orderId:'previous',...(legacy?{}:{order:{shopId:'shop',orderId:'previous'}})}];
 const snapshot=()=>({revision,current:structuredClone(current),handled:structuredClone(handled),canUndo:handled.length>0,historyTarget:handled.length?{shopId:'shop',orderId:handled.at(-1).orderId,needsRestoreOrder:!handled.at(-1).order}:null});
 const messages=event(),port={onMessage:event(),onDisconnect:event(),postMessage(m){calls.push(structuredClone(m));queueMicrotask(()=>{
  let payload,error;const mutation=['SELECT_ACCOUNT','UNDO_LAST'].includes(m.type);
  if(mutation){assert.equal(storage.mutationIntent.payload.commandId,m.payload.commandId);if(rejectCode){error=rejectCode;rejectCode='';}else if(!commands.has(m.payload.commandId)){
   commands.add(m.payload.commandId);applied++;
   if(m.type==='UNDO_LAST'){assert.equal(m.payload.expectedJobId,current?.jobId??null);assert.equal(m.payload.expectedGeneration,current?.generation??null);assert.equal(m.payload.expectedLastOrderId,handled.at(-1).orderId);const old=handled.pop();current={jobId:'restored-'+old.orderId,generation:1,completionToken:'back-token',order:{...(old.order||m.payload.restoreOrder),revisit:true},customer:{source:'order',state:'waiting'},operator:{source:'ram',state:'ready',userId:'11'}};}
   else {const p=m.payload;assert.equal(p.jobId,current.jobId);assert.equal(p.generation,current.generation);current[p.role]=p.source==='order'?{source:'order',state:'waiting'}:{source:'ram',state:'ready',userId:p.userId,username:'saved-'+p.userId};if(p.role==='customer')current.generation++;current.completionToken='token-'+applied;}
   revision++;
  }}
  if(m.type==='PREPARE_CUSTOMER'){assert.equal(m.payload.username,'original');current.customer={source:'order',state:'ready',username:'original',userId:'22'};revision++;}
  if(m.type==='GET_CAPABILITIES')payload={loginOnly:true,accountSelection:true,undoLast:true,ramImportSupported:true};
  else if(m.type==='GET_ACCOUNT_METADATA')payload={accounts:[{userId:'11',username:'operator',cookie:'NEVER_EXPOSE'},{userId:'22',username:'customer',password:'NEVER_EXPOSE'},{userId:'33',username:'other'}]};
  else payload=snapshot();
  if(mutation && loseReply && !error){loseReply=false;port.onDisconnect.emit();return;}
  port.onMessage.emit(structuredClone(error?{v:1,id:m.id,type:'RESULT',ok:false,error:{code:error}}:{v:1,id:m.id,type:'RESULT',ok:true,payload}));
 });}};
 globalThis.chrome={runtime:{id:'test',getURL:()=> 'chrome-extension://test/',connectNative:()=>port,onMessage:messages,sendMessage:async()=>{}},storage:{local:{get:async key=>({[key]:storage[key]}),set:async data=>Object.assign(storage,structuredClone(data)),remove:async key=>delete storage[key]}},notifications:{create:async()=>{}},action:{setBadgeText:async()=>{},onClicked:event()},sidePanel:{open:async()=>{}}};
 await import(pathToFileURL(join(folder,'worker.js')));await new Promise(r=>setTimeout(r,10));
 return {calls,reads,metadata,storage,handled,get current(){return current;},get applied(){return applied;},move(){current={...current,jobId:'changed',completionToken:'changed'};revision++;port.onMessage.emit({v:1,type:'SNAPSHOT',payload:snapshot()});},lose(){loseReply=true;},reject(code){rejectCode=code;},send:(type,payload)=>new Promise(resolve=>messages.emit({type,payload},{id:'test',url:'chrome-extension://test/panel.html'},resolve)),async cleanup(){delete globalThis.chrome;delete globalThis.__selectionReads;delete globalThis.__metadataReads;delete globalThis.__metadataStatus;delete globalThis.__metadataGate;await rm(folder,{recursive:true,force:true});}};
}
test('both role selectors use only safe RAM metadata; operator choice preserves customer login and order choice freshly prepares',async()=>{
 const h=await harness();try{
  const cfg=structuredClone(h.storage.config);const accounts=await h.send('UI_ACCOUNTS');assert.deepEqual(Object.keys(accounts.payload.accounts[0]).sort(),['userId','username']);
  const customer=structuredClone(h.current.customer),generation=h.current.generation;
  const operator=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'operator',source:'ram',userId:'33'});assert.equal(operator.ok,true);assert.equal(h.current.generation,generation);assert.deepEqual(h.current.customer,customer);assert.equal(h.reads.length,0);
  const stale=await h.send('UI_SELECT_ACCOUNT',{jobId:'current',generation:1,completionToken:'initial',orderId:'current',role:'customer',source:'ram',userId:'22'});assert.equal(stale.error.code,'STALE_JOB');
  const ram=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'customer',source:'ram',userId:'22'});assert.equal(ram.ok,true);assert.equal(h.current.customer.source,'ram');assert.equal(h.current.order.customerUsername,'original');assert.equal(h.reads.length,0);assert.ok(!h.calls.some(c=>c.type==='PREPARE_CUSTOMER'));
  const order=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'customer',source:'order'});assert.equal(order.ok,true);assert.deepEqual(h.reads,['current']);assert.equal(h.calls.filter(c=>c.type==='PREPARE_CUSTOMER').length,1);assert.deepEqual(h.storage.config,cfg);assert.equal(h.storage.mutationIntent,undefined);assert.ok(!JSON.stringify(h.storage).includes('SYNTHETIC_PASSWORD'));assert.ok(!h.calls.some(c=>/LAUNCH|CLOSE|PAIR/.test(c.type)));
 }finally{await h.cleanup();}
});
test('Back fences duplicates and restores old metadata; lost ACK replays one command and pops only once',async()=>{
 const h=await harness({legacy:true});try{
  const payload={...identity(h.current),expectedLastOrderId:'previous'};h.lose();
  const [first,duplicate]=await Promise.all([h.send('UI_UNDO',payload),h.send('UI_UNDO',payload)]);assert.equal(first.ok,false);assert.equal(duplicate.error.code,'BUSY');assert.equal(h.applied,1);assert.equal(h.handled.length,1);assert.equal(h.reads.length,0);assert.deepEqual(h.metadata,['previous']);
  const command=h.storage.mutationIntent.payload.commandId;const replay=await h.send('UI_GET');assert.equal(replay.ok,true);assert.equal(h.applied,1);assert.equal(h.handled.length,1);assert.equal(h.storage.mutationIntent,undefined);assert.equal(replay.payload.mutationPending,false);assert.deepEqual(h.reads,['previous']);assert.equal(h.current.order.revisit,true);assert.equal(h.current.order.status,'PROCESSING');assert.equal(new Set(h.calls.filter(c=>c.type==='UNDO_LAST').map(c=>c.payload.commandId)).size,1);assert.equal(h.calls.filter(c=>c.type==='UNDO_LAST')[1].payload.commandId,command);
  const stale=await h.send('UI_UNDO',payload);assert.equal(stale.error.code,'STALE_JOB');assert.equal(h.applied,1);assert.ok(!h.calls.some(c=>c.type==='CLAIM_ORDER'));
 }finally{await h.cleanup();}
});
test('a rejected choice unlocks controls, while a lost selection reply remains durable and replays without rereading credentials',async()=>{
 const h=await harness();try{
  h.reject('ROLE_CONFLICT');const bad=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'customer',source:'ram',userId:'11'});assert.equal(bad.error.code,'ROLE_CONFLICT');assert.equal(h.storage.mutationIntent,undefined);
  h.lose();const lost=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'customer',source:'ram',userId:'22'});assert.equal(lost.ok,false);assert.ok(h.storage.mutationIntent);const recovered=await h.send('UI_GET');assert.equal(recovered.ok,true);assert.equal(h.applied,1);assert.equal(h.reads.length,0);assert.equal(h.storage.mutationIntent,undefined);
 }finally{await h.cleanup();}
});

test('Back from no current uses explicit null identity and cancelled history remains viewable without reading credentials',async()=>{
 const h=await harness({legacy:true,status:'CANCELLED',empty:true});try{h.storage.config.protectedOperatorUserIds=['44'];
  const result=await h.send('UI_UNDO',{expectedLastOrderId:'previous'});assert.equal(result.ok,true);assert.equal(h.current.order.status,'CANCELLED');assert.equal(h.current.order.orderId,'previous');assert.equal(result.payload.issue,'ORDER_CHANGED');assert.equal(h.reads.length,0);const back=h.calls.find(c=>c.type==='UNDO_LAST');assert.equal(back.payload.expectedJobId,null);assert.equal(back.payload.expectedGeneration,null);assert.deepEqual(back.payload.protectedOperatorUserIds,['44','11']);assert.ok(!h.calls.some(c=>c.type==='PREPARE_CUSTOMER'));
 }finally{await h.cleanup();}
});
test('Back captures current and target before metadata await and refuses a changed job; completion cannot overlap',async()=>{
 let release;const metadataGate=new Promise(r=>release=r);const h=await harness({legacy:true,metadataGate});try{
  const back=h.send('UI_UNDO',{...identity(h.current),expectedLastOrderId:'previous'});while(!h.metadata.length)await new Promise(r=>setTimeout(r,2));
  const complete=await h.send('UI_COMPLETE',identity(h.current));assert.equal(complete.error.code,'BUSY');h.move();release();const stale=await back;assert.equal(stale.error.code,'STALE_JOB');assert.ok(!h.calls.some(c=>c.type==='UNDO_LAST'));assert.equal(h.storage.mutationIntent,undefined);
 }finally{release();await h.cleanup();}
});
test('Back cannot reconcile and auto-advance an outstanding Success; unsettled selection replays the same command',async()=>{
 const h=await harness();try{
  h.storage.completionIntent={commandId:'pending',...identity(h.current),advanceAfterAck:true};const result=await h.send('UI_UNDO',{...identity(h.current),expectedLastOrderId:'previous'});assert.equal(result.error.code,'COMPLETION_PENDING');assert.ok(!h.calls.some(c=>['COMPLETE_CURRENT','CLAIM_ORDER','UNDO_LAST'].includes(c.type)));delete h.storage.completionIntent;
  h.reject('RAM_IMPORT_UNCERTAIN');const waiting=await h.send('UI_SELECT_ACCOUNT',{...identity(h.current),role:'customer',source:'ram',userId:'22'});assert.equal(waiting.error.code,'RAM_IMPORT_UNCERTAIN');const command=h.storage.mutationIntent.payload.commandId;await h.send('UI_GET');assert.equal(h.storage.mutationIntent,undefined);assert.equal(h.applied,1);assert.equal(new Set(h.calls.filter(c=>c.type==='SELECT_ACCOUNT').map(c=>c.payload.commandId)).size,1);assert.equal(h.calls.filter(c=>c.type==='SELECT_ACCOUNT')[1].payload.commandId,command);
 }finally{await h.cleanup();}
});

test('saving catalog retains protected IDs from disabled maps and previous global protection',async()=>{
 const h=await harness();try{
  h.storage.config.protectedOperatorUserIds=['44'];const saved=await h.send('UI_OPTIONS_SAVE',{version:1,catalog:[{productId:'p',productName:'Product',mapId:'m',mapName:'Map',placeId:'1',operatorUserId:'33'}]});assert.equal(saved.ok,true);assert.deepEqual(h.storage.config.protectedOperatorUserIds.sort(),['11','33','44']);
 }finally{await h.cleanup();}
});
