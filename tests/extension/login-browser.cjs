// Synthetic HTML only: no website requests, profile, customer account, or challenge interaction.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../native/LoginFormScripts.cs'),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse(`"${m[2]}"`)]));
const credentials=['fixture_user','FIXTURE_PASSWORD'];
const form=({legacy=false,disabled=true}={})=>`<form onsubmit="event.preventDefault()"><input id="login-username"><input id="login-password" type="password"><button ${legacy?'id="login-button"':''} type="submit" ${disabled?'disabled':''}>Sign in</button></form><script>window.clicks=0;document.querySelector('button').addEventListener('click',()=>window.clicks++);window.events=[];for(const e of document.querySelectorAll('input'))for(const type of ['input','change'])e.addEventListener(type,()=>window.events.push(type));</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 let networkRequests=0;
 try{
  const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>{networkRequests++;return route.abort();});await context.setOffline(true);
  const page=await context.newPage();
  const run=async(name,args)=>page.evaluate(({resolver,body,args})=>args?new Function('username','password',resolver+body)(...args):new Function(resolver+body)(),{resolver:['IssueBody','ChallengeVisibleBody'].includes(name)?'':scripts.Resolver,body:scripts[name],args});
  const fill=()=>run('FillBody',credentials),check=()=>run('CheckFilledBody',credentials),submit=()=>run('SubmitBody',credentials);
  for(const legacy of [false,true]){
   await page.setContent(form({legacy}));assert.equal(await run('ReadyBody'),true);assert.equal(await fill(),true);assert.deepEqual(await page.evaluate(()=>window.events),['input','change','input','change']);assert.equal(await check(),'MATCHED');assert.equal(await submit(),'PENDING');assert.equal(await page.evaluate(()=>window.clicks),0);await page.evaluate(()=>document.querySelector('button').disabled=false);assert.equal(await submit(),'CLICKED');assert.equal(await page.evaluate(()=>window.clicks),1);
  }
  await page.setContent(form({disabled:false}));await page.evaluate(()=>document.querySelector('#login-password').value='different_fixture_value');assert.equal(await fill(),false);assert.equal(await page.inputValue('#login-username'),'');assert.equal(await check(),'MISMATCH');assert.equal(await submit(),'MISMATCH');assert.equal(await page.evaluate(()=>window.clicks),0);
  await page.setContent(form({disabled:false}));await fill();await page.evaluate(()=>document.querySelector('#login-password').value='');assert.equal(await check(),'EMPTY');assert.equal(await submit(),'EMPTY');assert.equal(await page.evaluate(()=>window.clicks),0);
  await page.setContent(`<input id="login-username" style="display:none"><input id="login-password" style="visibility:hidden"><button id="login-button" style="display:none">Sign in</button>${form({legacy:true,disabled:false})}`);assert.equal(await run('ReadyBody'),true);assert.equal(await fill(),true);assert.equal(await check(),'MATCHED');assert.equal(await submit(),'CLICKED');
  for(const extra of ['<input id="login-username">','<input id="login-password">','<button id="login-button">Sign in</button>']){await page.setContent(form({legacy:true,disabled:false})+extra);assert.equal(await run('ReadyBody'),false);assert.equal(await fill(),false);assert.equal(await check(),'MISSING');assert.equal(await submit(),'MISSING');assert.equal(await page.evaluate(()=>window.clicks),0);}
  await page.setContent(form({disabled:false}));await page.evaluate(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<button type="submit">Continue</button>'));assert.equal(await run('ReadyBody'),false);assert.equal(await fill(),false);assert.equal(await submit(),'MISSING');
  for(const caption of ["Verify you're human",'Verify you’re human','Verify you are human','Hold the button to confirm you are human. Press and hold']){
   await page.setContent(form({disabled:false})+`<div role="dialog">${caption}</div>`);assert.equal(await run('IssueBody'),'CUSTOMER_CAPTCHA_REQUIRED');assert.equal(await run('ChallengeVisibleBody'),true);assert.equal(await fill(),false);assert.equal(await check(),'CHALLENGE');assert.equal(await submit(),'CHALLENGE');assert.equal(await page.evaluate(()=>window.clicks),0);await page.evaluate(()=>document.querySelector('form').remove());assert.equal(await check(),'CHALLENGE');assert.equal(await submit(),'CHALLENGE');
  }
  await page.setContent(form({disabled:false})+`<div style="display:none" role="dialog">Verify you're human. Hold the button. Press and hold</div><iframe style="display:none" src="about:blank#captcha"></iframe>`);assert.equal(await run('IssueBody'),'');assert.equal(await fill(),true);assert.equal(await submit(),'CLICKED');
  await page.setContent(form({disabled:false})+'<p>Press and hold to reveal your password</p>');assert.equal(await run('IssueBody'),'');
  for(const html of ['<div role="dialog">Continue</div>','<div aria-modal="true">Continue</div>']){await page.setContent(html);assert.equal(await run('IssueBody'),'');assert.equal(await run('ChallengeVisibleBody'),true);assert.equal(await check(),'CHALLENGE');assert.equal(await submit(),'CHALLENGE');}
  for(const html of ['<iframe title="ordinary page" src="about:blank"></iframe>','<div class="grecaptcha-badge"><iframe title="captcha badge" src="about:blank#captcha"></iframe></div>','<div hidden role="dialog">Continue</div>']){await page.setContent(html);assert.equal(await run('IssueBody'),'');assert.equal(await run('ChallengeVisibleBody'),false);}
  for(const attributes of ['src="about:blank#captcha"','src="about:blank#arkose"','title="captcha"','title="challenge"']){await page.setContent(`<iframe ${attributes}></iframe>`);assert.equal(await run('IssueBody'),'CUSTOMER_CAPTCHA_REQUIRED');assert.equal(await run('ChallengeVisibleBody'),true);}
  await page.setContent(form({disabled:false}));await page.evaluate(()=>document.querySelector('#login-password').addEventListener('input',e=>e.target.value=''));assert.equal(await fill(),true);assert.equal(await check(),'EMPTY');assert.equal(await submit(),'EMPTY');assert.equal(await page.evaluate(()=>window.clicks),0);
  // Dialog layout: the password stays disabled until the username is committed.
  const dialogHtml='<div role="dialog" aria-modal="true"><h1>Login to Roblox</h1><input placeholder="Username, email, or phone" autocomplete="username"><input type="password" autocomplete="current-password" disabled><button type="button">Log In</button><button type="button">Email Me a One-Time Code</button></div><script>window.clicks=0;window.events=[];const u=document.querySelector(\'input:not([type=password])\');const p=document.querySelector(\'input[type=password]\');document.querySelectorAll(\'button\').forEach(b=>b.addEventListener(\'click\',()=>window.clicks++));u.addEventListener(\'input\',()=>{if(u.value)p.disabled=false;});for(const e of [u,p])for(const type of [\'input\',\'change\'])e.addEventListener(type,()=>window.events.push(type));</script>';
  await page.setContent(dialogHtml);
  assert.equal(await run('ReadyBody'),false);assert.equal(await run('ChallengeVisibleBody'),false);assert.equal(await run('IssueBody'),'');
  assert.equal(await run('ReadyUserBody'),true);assert.equal(await run('FillUserBody',[credentials[0]]),true);
  assert.equal(await page.evaluate(()=>document.querySelector('input[type=password]').disabled),false);
  assert.equal(await run('ReadyPasswordBody',[credentials[0]]),true);assert.equal(await run('FillPasswordBody',credentials),true);
  assert.equal(await run('StageBody',credentials),'READY');assert.equal(await run('SubmitBody',credentials),'CLICKED');
  assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(await page.evaluate(()=>window.events.length),4);
  assert.equal(networkRequests,0);console.log('Local offline login fixture passed: legacy + modern forms, exact fill/submit guard, hidden/duplicate controls, reactive clearing, visible manual CAPTCHA classification; zero network requests and no challenge interaction.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
