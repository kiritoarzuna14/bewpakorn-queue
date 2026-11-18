import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../native/LoginFormScripts.cs',import.meta.url),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse(`"${m[2]}"`)]));
function fixture({legacy=false,sync=false,form=true,ambiguous=false,hiddenLegacy=false,hiddenInputs=false,detachedInputs=false,ambiguousInputs=false}={}){
 const events=[];let clicks=0,modal=false;
 class Input{disabled=false;readOnly=false;isConnected=true;_value='';get value(){return this._value;}set value(v){this._value=v;}getBoundingClientRect(){return {width:100,height:30};}dispatchEvent(e){events.push(e.type);if(sync&&u.value&&p.value)b.disabled=false;}}
 const u=new Input(),p=new Input(),b={type:'submit',textContent:'Sign in',disabled:true,getAttribute:()=>null,getBoundingClientRect:()=>({width:100,height:30}),click(){clicks++;}};
 const stale={...b,disabled:true,getBoundingClientRect:()=>({width:0,height:0}),click(){throw Error('hidden stale button must not be clicked');}};
 const staleU=new Input(),staleP=new Input();if(hiddenInputs){staleU.getBoundingClientRect=staleP.getBoundingClientRect=()=>({width:0,height:0});}if(detachedInputs){staleU.isConnected=staleP.isConnected=false;}
 if(form)p.form={querySelectorAll:()=>[b]};
 staleP.form=p.form;
 const search={type:'submit',textContent:'',disabled:false,click(){throw Error('search must not be clicked');}};
 const oldInputs=hiddenInputs||detachedInputs;
 const document={querySelector:s=>s==='#login-username'?(oldInputs?staleU:u):s==='#login-password'?(oldInputs?staleP:p):s==='#login-button'?(hiddenLegacy?stale:legacy?b:null):null,querySelectorAll:s=>s==='#login-username'?[...(oldInputs?[staleU]:[]),u,...(ambiguousInputs?[new Input()]:[])]:s==='#login-password'?[...(oldInputs?[staleP]:[]),p]:s==='button'?[search,b,...(ambiguous?[{...b}]:[])]:s==='[role=dialog],[aria-modal=true]'&&modal?[{getBoundingClientRect:()=>({width:100,height:100})}]:[]};
 const context={document,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}}};
 const run=body=>vm.runInNewContext(`(()=>{${scripts.Resolver}${body}})()`,context);
 const withCredentials=body=>vm.runInNewContext(`((username,password)=>{${scripts.Resolver}${body}})`,context)('fake_user','FAKE_PASSWORD');
 return {b,p,u,staleU,staleP,events,get clicks(){return clicks;},ready:()=>run(scripts.ReadyBody),fill:()=>withCredentials(scripts.FillBody),submit:()=>run(scripts.SubmitBody),submitChecked:()=>withCredentials(scripts.SubmitBody),checkFilled:()=>withCredentials(scripts.CheckFilledBody),challenge:()=>{modal=true;}};
}
test('empty legacy and modern forms are fillable while Sign in is disabled',()=>{for(const legacy of [true,false])assert.equal(fixture({legacy}).ready(),true);});
test('fill dispatches input/change without clicking; delayed button can then submit',()=>{
 const f=fixture();assert.equal(f.fill(),true);assert.equal(f.clicks,0);assert.deepEqual(f.events,['input','change','input','change']);assert.equal(f.submit(),'PENDING');assert.equal(f.clicks,0);f.b.disabled=false;assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});
test('synchronous enabling and semantic fallback work without legacy ID',()=>{const f=fixture({form:false,sync:true});assert.equal(f.ready(),true);f.fill();assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);});
test('visible challenge prevents clicking and ambiguous controls fail closed',()=>{const f=fixture({sync:true});f.fill();f.challenge();assert.equal(f.submit(),'CHALLENGE');assert.equal(f.clicks,0);assert.equal(fixture({form:false,ambiguous:true}).ready(),false);});

test('a hidden leftover legacy button cannot shadow the visible enabled modern button',()=>{
 const f=fixture({hiddenLegacy:true,sync:true});assert.equal(f.fill(),true);assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('a form cleared by hydration is not submitted just because its button is enabled',()=>{
 const f=fixture({sync:true});f.fill();f.p.value='';assert.equal(f.submit(),'EMPTY');assert.equal(f.clicks,0);
});

test('changed nonempty credentials pause without a click instead of overwriting a manual edit',()=>{
 const f=fixture({sync:true});f.fill();f.u.value='manually_changed_user';assert.equal(f.submitChecked(),'MISMATCH');assert.equal(f.clicks,0);assert.equal(f.u.value,'manually_changed_user');
});

test('filled inspection returns only field status and distinguishes empty from manual mismatch',()=>{
 const f=fixture({sync:true});assert.equal(f.checkFilled(),'EMPTY');f.fill();assert.equal(f.checkFilled(),'MATCHED');f.p.value='';assert.equal(f.checkFilled(),'EMPTY');f.u.value='manual_user';assert.equal(f.checkFilled(),'MISMATCH');assert.equal(f.clicks,0);
});

test('checked submit revalidates expected password immediately before clicking',()=>{
 const f=fixture({sync:true});f.fill();assert.equal(f.checkFilled(),'MATCHED');f.p.value='manual_password';assert.equal(f.submitChecked(),'MISMATCH');assert.equal(f.clicks,0);assert.equal(f.p.value,'manual_password');
});

test('hidden or detached stale inputs are ignored in favor of unique visible fields',()=>{
 for(const option of ['hiddenInputs','detachedInputs']){const f=fixture({[option]:true,sync:true});assert.equal(f.ready(),true);assert.equal(f.fill(),true);assert.equal(f.u.value,'fake_user');assert.equal(f.p.value,'FAKE_PASSWORD');assert.equal(f.staleU.value,'');assert.equal(f.staleP.value,'');assert.equal(f.checkFilled(),'MATCHED');assert.equal(f.submitChecked(),'CLICKED');assert.equal(f.clicks,1);}
});

test('multiple visible username fields fail closed before filling or submitting',()=>{
 const f=fixture({ambiguousInputs:true,sync:true});assert.equal(f.ready(),false);assert.equal(f.fill(),false);assert.equal(f.checkFilled(),'MISSING');assert.equal(f.submitChecked(),'MISSING');assert.equal(f.u.value,'');assert.equal(f.p.value,'');assert.equal(f.clicks,0);
});

test('manual input changed after an empty inspection is not overwritten by Fill',()=>{
 const f=fixture({sync:true});assert.equal(f.checkFilled(),'EMPTY');f.u.value='manual_user';assert.equal(f.fill(),false);assert.equal(f.u.value,'manual_user');assert.equal(f.p.value,'');assert.equal(f.events.length,0);
});
