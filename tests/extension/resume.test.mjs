import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const event=()=>{const callbacks=[];return {addListener:f=>callbacks.push(f),emit:(...a)=>callbacks.map(f=>f(...a))};};
test('only an intentional toolbar start resumes the unsubmitted current order',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'queue-resume-'));
 try{
  for(const file of ['worker.js','native.js','notifications.js','messages.js','package.json'])await copyFile(new URL(`../../extension/${file}`,import.meta.url),join(folder,file));
  await writeFile(join(folder,'shop.js'),`export const readOrderMetadata=async()=>({});export const defaultCatalog=async()=>[];export const discoverCatalog=async()=>[];export const scanOrders=async()=>{throw Error('must not scan next order');};export const openAndReadOrder=async o=>{if(o.orderId!=='old')throw Error('wrong order');return {username:'demo_user',password:'FAKE'};};`);
  await writeFile(join(folder,'queue.js'),`export const operatorPool=p=>p.operatorUserIds||(p.operatorUserId?[p.operatorUserId]:[]);export const validateCatalog=()=>true;export const selectPending=x=>x;`);
  const storage={config:{version:1,catalog:[]}},calls=[];let revision=1;
  const job={jobId:'same-job',generation:1,completionToken:'old-token',order:{orderId:'old'},customer:{canResume:true,state:'blocked'},operator:{state:'blocked'},state:'blocked'};
  const messages=event(),port={onMessage:event(),onDisconnect:event(),postMessage(m){calls.push(m);queueMicrotask(()=>{if(m.type==='RESUME_UNSUBMITTED'){assert.equal(m.payload.jobId,'same-job');job.generation=2;job.completionToken='new-token';job.customer={state:'waiting',canResume:false};revision++;}if(m.type==='PREPARE_CUSTOMER'){assert.equal(m.payload.generation,2);job.customer.state='ready';revision++;}port.onMessage.emit(structuredClone({v:1,id:m.id,type:'RESULT',ok:true,payload:m.type==='GET_CAPABILITIES'?{loginOnly:true,accountSelection:true,undoLast:true,ramImportSupported:true,chromeFirstLogin:true}:{revision,current:job,handled:[]}}));});}};
  globalThis.chrome={runtime:{id:'test',getURL:()=> 'chrome-extension://test/',connectNative:()=>port,onMessage:messages,sendMessage:async()=>{}},storage:{local:{get:async k=>({[k]:storage[k]}),set:async x=>Object.assign(storage,x),remove:async k=>delete storage[k]}},notifications:{create:async()=>{}},action:{setBadgeText:async()=>{},onClicked:event()},sidePanel:{open:async()=>{}}};
  await import(pathToFileURL(join(folder,'worker.js')));await new Promise(r=>setTimeout(r,20));assert.deepEqual(calls.map(m=>m.type),['GET_SNAPSHOT']);
  const result=await new Promise(resolve=>messages.emit({type:'UI_START'},{id:'test',url:'chrome-extension://test/panel.html'},resolve));
  assert.equal(result.ok,true);assert.deepEqual(calls.map(m=>m.type),['GET_SNAPSHOT','GET_SNAPSHOT','GET_CAPABILITIES','RESUME_UNSUBMITTED','PREPARE_CUSTOMER','GET_ACCOUNT_METADATA']);assert.equal(result.payload.native.current.order.orderId,'old');assert.equal(result.payload.native.handled.length,0);assert.equal(result.payload.native.current.generation,2);
 }finally{delete globalThis.chrome;await rm(folder,{recursive:true,force:true});}
});
