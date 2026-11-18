const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

// Local synthetic page only: no Roblox account, network, RAM or real secrets.
// Run with the same Playwright NODE_PATH as the other Chrome smoke tests.
const source=fs.readFileSync(require('node:path').join(__dirname,'../../native/LoginFormScripts.cs'),'utf8');
const scripts=Object.fromEntries([...source.matchAll(/const string (\w+)="((?:\\.|[^"\\])*)";/g)].map(m=>[m[1],JSON.parse('"'+m[2]+'"')]));
const run=body=>'((username,password)=>{'+scripts.Resolver+body+'})("fixture_user","FIXTURE_PASSWORD")';

(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<div style="display:none"><input id="login-username"><input id="login-password"><button id="login-button" disabled>Log In</button></div><form><input id="login-username"><input id="login-password" type="password"><button type="submit" disabled>Sign in</button></form>');
  await page.evaluate(()=>{
   window.submissions=0;
   const form=document.querySelector('form');
   form.addEventListener('input',()=>{form.querySelector('button').disabled=false;});
   form.addEventListener('submit',event=>{event.preventDefault();window.submissions++;});
  });
  const evaluate=body=>page.evaluate(run(body));
  assert.equal(await evaluate(scripts.ReadyBody),true);
  assert.equal(await evaluate(scripts.CheckFilledBody),'EMPTY');
  // A manual edit between the check and Fill must survive the async boundary.
  await page.evaluate(()=>document.querySelector('form #login-username').value='manual_user');
  assert.equal(await evaluate(scripts.FillBody),false);
  assert.equal(await page.locator('form #login-username').inputValue(),'manual_user');
  await page.evaluate(()=>document.querySelector('form #login-username').value='');
  assert.equal(await evaluate(scripts.FillBody),true);
  assert.deepEqual(await page.locator('div input').evaluateAll(inputs=>inputs.map(input=>input.value)),['','']);
  assert.equal(await evaluate(scripts.CheckFilledBody),'MATCHED');
  // Replacing a controlled input after filling models SPA hydration/remount.
  await page.evaluate(()=>{const old=document.querySelector('form #login-password'),next=old.cloneNode();next.value='';old.replaceWith(next);});
  assert.equal(await evaluate(scripts.CheckFilledBody),'EMPTY');
  assert.equal(await evaluate(scripts.SubmitBody),'EMPTY');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  assert.equal(await evaluate(scripts.FillBody),true);
  assert.equal(await evaluate(scripts.CheckFilledBody),'MATCHED');
  await page.evaluate(()=>document.querySelector('form #login-password').value='manual_password');
  assert.equal(await evaluate(scripts.FillBody),false);
  assert.equal(await evaluate(scripts.SubmitBody),'MISMATCH');
  assert.equal(await page.locator('form #login-password').inputValue(),'manual_password');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  await page.evaluate(()=>document.querySelector('form #login-password').value='');
  assert.equal(await evaluate(scripts.FillBody),true);
  // Two visible inputs with the same identity must not resolve arbitrarily.
  await page.evaluate(()=>{const duplicate=document.querySelector('form #login-username').cloneNode();duplicate.dataset.fixtureDuplicate='true';document.querySelector('form').append(duplicate);});
  assert.equal(await evaluate(scripts.ReadyBody),false);
  assert.equal(await evaluate(scripts.FillBody),false);
  assert.equal(await evaluate(scripts.CheckFilledBody),'MISSING');
  assert.equal(await evaluate(scripts.SubmitBody),'MISSING');
  await page.locator('[data-fixture-duplicate]').evaluate(element=>element.remove());
  await page.evaluate(()=>{const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.textContent='Synthetic challenge';document.body.append(modal);});
  assert.equal(await evaluate(scripts.CheckFilledBody),'CHALLENGE');
  assert.equal(await evaluate(scripts.FillBody),false);
  assert.equal(await evaluate(scripts.SubmitBody),'CHALLENGE');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  await page.locator('[role=dialog]').evaluate(element=>element.remove());
  assert.equal(await evaluate(scripts.CheckFilledBody),'MATCHED');
  assert.equal(await evaluate(scripts.SubmitBody),'CLICKED');
  assert.equal(await page.evaluate(()=>window.submissions),1);
  console.log('Local Chrome login smoke passed: visible controls, hidden duplicates, hydration reset, atomic manual-edit protection, challenge pause, one verified submit; no network/account/RAM.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
