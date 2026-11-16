import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
function event(){const listeners=[];return {addListener:f=>listeners.push(f),emit(...args){return listeners.map(f=>f(...args));}};}
test('ChromeMock: startup reconciles without claiming; completion is durable and tied to visible job',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'queue-test-'));try{
    for(const file of ['worker.js','native.js','package.json']) await copyFile(new URL(`../../extension/${file}`,import.meta.url),join(dir,file));
    await writeFile(join(dir,'shop.js'),`export const defaultCatalog=async()=>[]; export const discoverCatalog=async()=>[]; export const scanOrders=async()=>[]; export const openAndReadOrder=async()=>({username:'u',password:'secret'});`);
    await writeFile(join(dir,'queue.js'),`export const validateCatalog=()=>true; export const selectPending=x=>x;`);
    const job={jobId:'job1',generation:1,completionToken:'token',order:{orderId:'1'},state:'blocked',customer:{state:'blocked'},operator:{state:'ready'}};
    let current=job,revision=1;const calls=[],storage={config:{version:1,catalog:[],shopOrigin:'https://bewpakorn.rdcw.xyz'}};const message=event();const port={onMessage:event(),onDisconnect:event(),postMessage(m){calls.push(m.type);if(m.type==='COMPLETE_CURRENT'){assert.equal(storage.completionIntent.jobId,'job1');current=null;revision++;}queueMicrotask(()=>port.onMessage.emit({v:1,type:'RESULT',id:m.id,ok:true,payload:{revision,current,handled:[]}}));}};
    globalThis.chrome={runtime:{id:'test',getURL:()=> 'chrome-extension://test/',connectNative:()=>port,onMessage:message,sendMessage:async()=>{}},storage:{local:{get:async key=>({[key]:storage[key]}),set:async values=>Object.assign(storage,values),remove:async key=>{delete storage[key];}}},notifications:{create:async()=>{}},action:{setBadgeText:async()=>{},onClicked:event()},sidePanel:{open:async()=>{}}};
    await import(pathToFileURL(join(dir,'worker.js')));await new Promise(r=>setTimeout(r,10));assert.deepEqual(calls,['GET_SNAPSHOT']);
    const send=(type,payload)=>new Promise(resolve=>message.emit({type,payload},{id:'test',url:'chrome-extension://test/panel.html'},resolve));
    const stale=await send('UI_COMPLETE',{jobId:'job2',orderId:'1',generation:1,completionToken:'token'});assert.equal(stale.error.code,'STALE_JOB');assert.equal(calls.includes('COMPLETE_CURRENT'),false);
    const identity={jobId:'job1',orderId:'1',generation:1,completionToken:'token'};const [ok,duplicate]=await Promise.all([send('UI_COMPLETE',identity),send('UI_COMPLETE',identity)]);assert.equal(ok.ok,true);assert.equal(duplicate.error.code,'BUSY');assert.equal(calls.filter(x=>x==='COMPLETE_CURRENT').length,1);assert.equal(storage.completionIntent,undefined);assert.equal(ok.payload.phase,'empty');
  } finally {delete globalThis.chrome;await rm(dir,{recursive:true,force:true});}
});
