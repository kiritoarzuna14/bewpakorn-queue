import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../native/LoginFormScripts.cs',import.meta.url),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse(`"${m[2]}"`)]));
const username='fixture_user',password='FIXTURE_PASSWORD';

function fixture({legacy=false,sync=false,form=true,ambiguous=false}={}){
 const events=[];let clicks=0;
 const node=extra=>({isConnected:true,hidden:false,style:{display:'block',visibility:'visible'},getBoundingClientRect(){return {width:this.hidden?0:100,height:this.hidden?0:20};},getAttribute(){return null;},...extra});
 class Input{constructor(){Object.assign(this,node());}disabled=false;readOnly=false;_value='';get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(e){events.push(e.type);if(sync&&u.value&&p.value)b.disabled=false;if(this.onEvent)this.onEvent(e);}}
 const u=new Input(),p=new Input(),b=node({type:'submit',textContent:'Sign in',innerText:'Sign in',disabled:true,click(){clicks++;}});
 const search=node({type:'submit',textContent:'',disabled:false,click(){throw Error('search must not be clicked');}});
 const controls={user:[u],password:[p],legacy:legacy?[b]:[],form:[b],buttons:[search,b,...(ambiguous?[node({...b})]:[])],modals:[],captchas:[]};
 if(form)p.form={querySelectorAll:()=>controls.form};
 const document={body:{innerText:''},querySelector:s=>document.querySelectorAll(s)[0]||null,querySelectorAll:s=>s==='#login-username'?controls.user:s==='#login-password'?controls.password:s==='#login-button'?controls.legacy:s==='button'?controls.buttons:s==='[role=dialog],[aria-modal=true]'?controls.modals:s.includes('iframe')?controls.captchas.concat(s.includes('[role=dialog]')?controls.modals:[]):s.includes('button')?controls.modals.concat(controls.buttons):[]};
 const context={document,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},getComputedStyle:e=>e.style};
 const run=(body,args=false)=>vm.runInNewContext(args?`((username,password)=>{${scripts.Resolver}${body}})`:`(()=>{${scripts.Resolver}${body}})()`,context);
 return {b,p,u,events,controls,document,node,get clicks(){return clicks;},ready:()=>run(scripts.ReadyBody),fill:()=>run(scripts.FillBody,true)(username,password),check:()=>run(scripts.CheckFilledBody,true)(username,password),submit:()=>run(scripts.SubmitBody,true)(username,password),challenge:()=>controls.modals.push(node({innerText:'Verify you are human'}))};
}

test('empty legacy and modern forms are fillable while Sign in is disabled',()=>{
 for(const legacy of [true,false])assert.equal(fixture({legacy}).ready(),true);
});

test('fill dispatches input/change without clicking; delayed button can then submit',()=>{
 const f=fixture();assert.equal(f.fill(),true);assert.equal(f.clicks,0);assert.deepEqual(f.events,['input','change','input','change']);
 assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'PENDING');assert.equal(f.clicks,0);f.b.disabled=false;assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('synchronous enabling and semantic fallback work without legacy ID',()=>{
 const f=fixture({form:false,sync:true});assert.equal(f.ready(),true);f.fill();assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('fill checks both existing values before changing either input',()=>{
 for(const field of ['u','p']){const f=fixture();f[field].value='different_fixture_value';assert.equal(f.fill(),false);assert.equal(f[field==='u'?'p':'u'].value,'');assert.deepEqual(f.events,[]);assert.equal(f.check(),'MISMATCH');assert.equal(f.submit(),'MISMATCH');assert.equal(f.clicks,0);}
});

test('checked submit rejects a cleared or changed field without returning credentials',()=>{
 const f=fixture({sync:true});assert.equal(f.check(),'EMPTY');assert.equal(f.submit(),'EMPTY');f.fill();f.p.value='';assert.equal(f.check(),'EMPTY');assert.equal(f.submit(),'EMPTY');f.p.value='different_fixture_value';assert.equal(f.check(),'MISMATCH');assert.equal(f.submit(),'MISMATCH');assert.equal(f.clicks,0);
 assert.match(source,/CheckFilled\(string usernameJson,string passwordJson\)/);assert.match(source,/SubmitChecked\(string usernameJson,string passwordJson\)/);
});

test('hidden and disconnected duplicate controls are ignored',()=>{
 const f=fixture({legacy:true,sync:true});for(const key of ['user','password','legacy']){f.controls[key].unshift(f.node({hidden:true}));f.controls[key].push(f.node({isConnected:false}));}
 assert.equal(f.ready(),true);assert.equal(f.fill(),true);assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('multiple visible candidates fail closed, including legacy and same-form buttons',()=>{
 for(const key of ['user','password','legacy','form']){const f=fixture({legacy:key==='legacy',sync:true});f.controls[key].push(f.node({...f[key==='user'?'u':key==='password'?'p':'b']}));assert.equal(f.ready(),false,key);assert.equal(f.fill(),false,key);assert.equal(f.check(),'MISSING',key);assert.equal(f.submit(),'MISSING',key);assert.equal(f.clicks,0,key);}
 assert.equal(fixture({form:false,ambiguous:true}).ready(),false);
});

test('visible challenges block fill and submit even after the login form disappears',()=>{
 const f=fixture({sync:true});f.challenge();assert.equal(f.ready(),false);assert.equal(f.fill(),false);assert.equal(f.check(),'CHALLENGE');assert.equal(f.submit(),'CHALLENGE');assert.equal(f.clicks,0);f.controls.user=[];assert.equal(f.check(),'CHALLENGE');assert.equal(f.submit(),'CHALLENGE');
});

test('hidden challenge does not block a visible usable form',()=>{
 const f=fixture({sync:true});f.controls.modals.push(f.node({hidden:true,innerText:"Verify you're human"}));assert.equal(f.fill(),true);assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'CLICKED');
});

test('a reactive page clearing a filled value cannot receive a submit click',()=>{
 const f=fixture({sync:true});f.p.onEvent=()=>{f.p.value='';};assert.equal(f.fill(),true);assert.equal(f.check(),'EMPTY');assert.equal(f.submit(),'EMPTY');assert.equal(f.clicks,0);
});

test('ChallengeVisible is independent of form fields and does not label generic dialogs as CAPTCHA',()=>{
 const f=fixture();const shown=()=>new Function('document','getComputedStyle',scripts.ChallengeVisibleBody)(f.document,e=>e.style);
 assert.equal(shown(),false);f.controls.modals.push(f.node({innerText:'Continue'}));assert.equal(shown(),true);f.controls.user=[];f.controls.password=[];assert.equal(shown(),true);assert.equal(new Function('document','getComputedStyle',scripts.IssueBody)(f.document,e=>e.style),'');f.controls.modals[0].hidden=true;assert.equal(shown(),false);
 assert.match(source,/static string ChallengeVisible/);
});
