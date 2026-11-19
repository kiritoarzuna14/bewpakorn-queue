import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../native/LoginFormScripts.cs',import.meta.url),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse(`"${m[2]}"`)]));
function fixture({legacy=false,sync=false,form=true,ambiguous=false}={}){
 const events=[];let clicks=0,modal=false;
 class Input{disabled=false;readOnly=false;_value='';get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(e){events.push(e.type);if(sync&&u.value&&p.value)b.disabled=false;}}
 const u=new Input(),p=new Input(),b={type:'submit',textContent:'Sign in',disabled:true,getAttribute:()=>null,click(){clicks++;}};
 if(form)p.form={querySelectorAll:()=>[b]};
 const search={type:'submit',textContent:'',disabled:false,click(){throw Error('search must not be clicked');}};
 const document={querySelector:s=>s==='#login-username'?u:s==='#login-password'?p:s==='#login-button'&&legacy?b:null,querySelectorAll:s=>s==='button'?[search,b,...(ambiguous?[{...b}]:[])]:s==='[role=dialog],[aria-modal=true]'&&modal?[{getBoundingClientRect:()=>({width:100,height:100})}]:[]};
 const context={document,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}}};
 const run=body=>vm.runInNewContext(`(()=>{${scripts.Resolver}${body}})()`,context);
 return {b,p,u,events,get clicks(){return clicks;},ready:()=>run(scripts.ReadyBody),fill:()=>vm.runInNewContext(`((username,password)=>{${scripts.Resolver}${scripts.FillBody}})`,context)('fake_user','FAKE_PASSWORD'),submit:()=>run(scripts.SubmitBody),challenge:()=>{modal=true;}};
}
test('empty legacy and modern forms are fillable while Sign in is disabled',()=>{for(const legacy of [true,false])assert.equal(fixture({legacy}).ready(),true);});
test('fill dispatches input/change without clicking; delayed button can then submit',()=>{
 const f=fixture();assert.equal(f.fill(),true);assert.equal(f.clicks,0);assert.deepEqual(f.events,['input','change','input','change']);assert.equal(f.submit(),'PENDING');assert.equal(f.clicks,0);f.b.disabled=false;assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});
test('synchronous enabling and semantic fallback work without legacy ID',()=>{const f=fixture({form:false,sync:true});assert.equal(f.ready(),true);f.fill();assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);});
test('visible challenge prevents clicking and ambiguous controls fail closed',()=>{const f=fixture({sync:true});f.fill();f.challenge();assert.equal(f.submit(),'CHALLENGE');assert.equal(f.clicks,0);assert.equal(fixture({form:false,ambiguous:true}).ready(),false);});
