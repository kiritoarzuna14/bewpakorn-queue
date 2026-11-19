import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../native/LoginFormScripts.cs',import.meta.url),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse(`"${m[2]}"`)]));
const username='fixture_user',password='FIXTURE_PASSWORD';

function fixture({legacy=false,sync=false,form=true,ambiguous=false,noIds=false,dialog=false,enablesPassword=false}={}){
 const events=[];let clicks=0;
 const node=(extra={},attrs={})=>({isConnected:true,hidden:false,style:{display:'block',visibility:'visible'},getBoundingClientRect(){return {width:this.hidden?0:100,height:this.hidden?0:20};},getAttribute(k){return k in attrs?attrs[k]:null;},...extra});
 class Input{constructor(attrs={}){Object.assign(this,node({},attrs));this.type=attrs.type||'text';this.disabled=!!attrs.disabled;this.readOnly=false;this._value='';}
  get value(){return this._value;}set value(v){this._value=v;}
  dispatchEvent(e){events.push(e.type);if(sync&&u.value&&p.value)b.disabled=false;if(enablesPassword&&this===u&&u.value)p.disabled=false;if(this.onEvent)this.onEvent(e);}}
 const u=new Input({placeholder:'Username, email, or phone'}),p=new Input({type:'password',disabled:enablesPassword});
 const b=node({type:dialog?'button':'submit',textContent:dialog?'Log In':'Sign in',innerText:dialog?'Log In':'Sign in',disabled:sync||dialog?false:true,click(){clicks++;}});
 const search=node({type:'submit',textContent:'',disabled:false,click(){throw Error('search must not be clicked');}});
 const otp=node({type:'button',textContent:'Email Me a One-Time Code',innerText:'Email Me a One-Time Code',disabled:false,click(){throw Error('one-time code must not be clicked');}});
 const modal=dialog?node({role:'dialog',innerText:'Login to Roblox',querySelectorAll:()=>[b],contains:e=>[u,p,b].includes(e)}):null;
 const controls={user:[u],password:[p],legacy:legacy?[b]:[],form:[b],buttons:dialog?[search,otp,b]:[search,b,...(ambiguous?[node({...b})]:[])],modals:modal?[modal]:[],captchas:[]};
 if(form)p.form={querySelectorAll:()=>controls.form};
 const document={body:{innerText:''},querySelector:s=>document.querySelectorAll(s)[0]||null,querySelectorAll:s=>{
  if(s==='#login-username')return noIds?[]:controls.user;
  if(s==='#login-password')return noIds?[]:controls.password;
  if(s==='#login-button')return controls.legacy;
  if(s==='input')return controls.user.concat(controls.password);
  if(s==='input[type=password]')return controls.password;
  if(s==='button')return controls.buttons;
  if(s.startsWith('[role=dialog]'))return controls.modals;
  if(s.includes('iframe'))return controls.captchas;
  if(s.includes('button'))return controls.modals.concat(controls.buttons);
  return [];
 }};
 const context={document,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},getComputedStyle:e=>e.style};
 const run=(body,args=false)=>args?vm.runInNewContext(`((username,password)=>{${scripts.Resolver}${body}})`,context):vm.runInNewContext(`(()=>{${scripts.Resolver}${body}})()`,context);
 return {b,p,u,events,controls,document,node,get clicks(){return clicks;},ready:()=>run(scripts.ReadyBody),readyUser:()=>run(scripts.ReadyUserBody),readyPassword:()=>run(scripts.ReadyPasswordBody,true)(username),fill:()=>run(scripts.FillBody,true)(username,password),fillUser:()=>run(scripts.FillUserBody,true)(username),fillPassword:()=>run(scripts.FillPasswordBody,true)(username,password),stage:()=>run(scripts.StageBody,true)(username,password),check:()=>run(scripts.CheckFilledBody,true)(username,password),submit:()=>run(scripts.SubmitBody,true)(username,password),challenge:()=>controls.modals.push(node({innerText:'Verify you are human'})),clearUser:()=>run(scripts.ClearUserBody),clearPassword:()=>run(scripts.ClearPasswordBody),userValue:()=>run(scripts.UserValueBody),passwordValue:()=>run(scripts.PasswordValueBody)};
}

test('empty legacy and modern forms are fillable while Sign in is disabled',()=>{
 for(const legacy of [true,false])assert.equal(fixture({legacy}).ready(),true);
});

test('fill dispatches input/change without clicking; delayed button can then submit',()=>{
 const f=fixture();assert.equal(f.fill(),true);assert.equal(f.clicks,0);assert.deepEqual(f.events,['input','change','input','change']);
 assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'PENDING');assert.equal(f.clicks,0);f.b.disabled=false;assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('synchronous enabling and semantic fallback work without legacy ID',()=>{
 const f=fixture({form:false,sync:true});assert.equal(f.ready(),true);f.fill();assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
});

test('fill checks both existing values before changing either input',()=>{
 for(const field of ['u','p']){const f=fixture();f[field].value='different_fixture_value';assert.equal(f.fill(),false);assert.equal(f[field==='u'?'p':'u'].value,'');assert.deepEqual(f.events,[]);}
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
 for(const key of ['user','password','legacy','form']){const f=fixture({legacy:key==='legacy'||key==='form',sync:true});f.controls[key].push(f.node({...f[key==='user'?'u':key==='password'?'p':'b']}));assert.equal(f.ready(),false,key);assert.equal(f.fill(),false,key);assert.equal(f.submit(),'MISSING',key);assert.equal(f.clicks,0,key);}
 assert.equal(fixture({form:false,ambiguous:true}).ready(),false);
});

test('visible challenges block fill and submit even after the login form disappears',()=>{
 const f=fixture({sync:true});f.challenge();assert.equal(f.ready(),false);assert.equal(f.fill(),false);assert.equal(f.check(),'CHALLENGE');assert.equal(f.submit(),'CHALLENGE');assert.equal(f.clicks,0);f.controls.user=[];assert.equal(f.check(),'CHALLENGE');assert.equal(f.submit(),'CHALLENGE');
});

test('hidden challenge does not block a visible usable form',()=>{
 const f=fixture({sync:true});f.controls.modals.push(f.node({hidden:true,innerText:"Verify you're human"}));assert.equal(f.fill(),true);assert.equal(f.check(),'MATCHED');assert.equal(f.submit(),'CLICKED');
});

test('a reactive page clearing a filled value cannot receive a submit click',()=>{
 const f=fixture({sync:true});f.p.onEvent=()=>{f.p.value='';};assert.equal(f.fill(),true);assert.equal(f.submit(),'EMPTY');assert.equal(f.clicks,0);
});

test('ChallengeVisible is independent of form fields and does not label a login dialog as a challenge',()=>{
 const f=fixture();const shown=()=>new Function('document','getComputedStyle',scripts.ChallengeVisibleBody)(f.document,e=>e.style);
 assert.equal(shown(),false);
 // A benign dialog over a usable form is not a human check.
 f.controls.modals.push(f.node({innerText:'Continue'}));assert.equal(shown(),false);assert.equal(f.fill(),true,'a benign dialog still allows filling');
 f.controls.modals.push(f.node({innerText:"Verify you're human"}));assert.equal(shown(),true,'verification captions are a human check');
 f.controls.modals.length=0;f.controls.modals.push(f.node({innerText:'Continue'}));f.controls.user=[];f.controls.password=[];assert.equal(shown(),true,'a dialog that replaced the form is a pause signal');assert.equal(new Function('document','getComputedStyle',scripts.IssueBody)(f.document,e=>e.style),'');f.controls.modals[0].hidden=true;assert.equal(shown(),false);
 const dialog=fixture({dialog:true});const dialogShown=()=>new Function('document','getComputedStyle',scripts.ChallengeVisibleBody)(dialog.document,e=>e.style);
 assert.equal(dialogShown(),false,'a dialog hosting the password field is the login form');
 assert.match(source,/static string ChallengeVisible/);
});

test('the dialog layout fills the left field first, then the right, then submits',()=>{
 const f=fixture({dialog:true,noIds:true,enablesPassword:true});
 assert.equal(f.p.disabled,true);
 assert.equal(f.stage(),'USER');assert.equal(f.ready(),false);
 assert.equal(f.fillUser(),true);assert.equal(f.p.disabled,false);assert.equal(f.clicks,0);
 assert.equal(f.stage(),'PASSWORD');assert.equal(f.readyPassword(),true);
 assert.equal(f.fillPassword(),true);assert.equal(f.clicks,0);
 assert.equal(f.stage(),'READY');assert.equal(f.submit(),'CLICKED');assert.equal(f.clicks,1);
 assert.equal(f.events.length,4);
});

test('both fields fill in one pass, username first, when the password is already usable',()=>{
 const f=fixture({dialog:true,noIds:true});
 assert.equal(f.p.disabled,false);
 assert.equal(f.stage(),'FILL_BOTH');
 assert.equal(f.fill(),true);assert.equal(f.clicks,0);
 assert.equal(f.u.value,username);assert.equal(f.p.value,password);
 assert.deepEqual(f.events,['input','change','input','change']);
 assert.equal(f.stage(),'READY');
});

test('a half-typed value can be cleared before retyping, leaving other fields alone',()=>{
 const f=fixture({sync:true});
 f.u.value='fixture_us';assert.equal(f.clearUser(),true);assert.equal(f.userValue(),'');
 assert.equal(f.fillUser(),true);assert.equal(f.userValue(),username);
 f.p.value='FIXT';f.u.value='kept';assert.equal(f.clearPassword(),true);assert.equal(f.passwordValue(),'');assert.equal(f.u.value,'kept');
});