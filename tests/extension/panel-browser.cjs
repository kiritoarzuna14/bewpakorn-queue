const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../../extension');const server=http.createServer((req,res)=>{const name=path.basename(req.url.split('?')[0])||'panel.html',file=path.join(root,name);if(!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:850}});
  await page.addInitScript(()=>{
   const listeners=[];window.requests=[];
   const job={jobId:'j',generation:1,completionToken:'t',state:'blocked',order:{orderId:'synthetic-1',mapName:'แมพทดสอบ',productName:'สินค้าทดสอบ',customerUsername:'original_order_user',quantity:2,createdAt:'2026-01-01'},customer:{source:'order',username:'original_order_user',state:'blocked',code:'RECOVERY_REQUIRED'},operator:{source:'ram',userId:'11',username:'my_operator',state:'ready'}};
   window.state={connection:'connected',phase:'blocked',configured:true,accounts:[],native:{current:job,canUndo:true,historyTarget:{orderId:'synthetic-previous'}},queue:[]};
   window.chrome={runtime:{onMessage:{addListener(f){listeners.push(f);}},sendMessage:async message=>{
    if(message.type==='UI_ACCOUNTS'){window.state.accounts=[{userId:'11',username:'my_operator'},{userId:'22',username:'synthetic_saved_customer_with_long_name'}];return {ok:true,payload:{accounts:window.state.accounts}};}
    if(['UI_SELECT_ACCOUNT','UI_COMPLETE','UI_UNDO'].includes(message.type)){window.requests.push(message);return new Promise(resolve=>{window.resolveMutation=()=>{window.state.native.current.completionToken='changed';resolve({ok:true,payload:window.state});};});}
    return {ok:true,payload:window.state};
   }}};
   window.emitState=()=>listeners.forEach(f=>f({type:'UI_STATE',payload:window.state}));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/panel.html`);await page.waitForTimeout(950);
  assert.equal(await page.locator('#complete').isEnabled(),true);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.roles .card').count(),2);assert.equal(await page.locator('label[for="customer-account"]').count(),1);assert.equal(await page.locator('label[for="operator-account"]').count(),1);
  assert.equal(await page.locator('#customer-account option').count(),3);assert.equal(await page.locator('#operator-account option').count(),3);assert.equal(await page.locator('#operator-account').inputValue(),'ram:11');assert.match(await page.locator('#customer-account option[value="order"]').textContent(),/original_order_user/);
  await page.selectOption('#operator-account','ram:22');
  for(const id of ['customer-account','operator-account','complete','undo']) assert.equal(await page.locator('#'+id).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.requests[0]),{type:'UI_SELECT_ACCOUNT',payload:{jobId:'j',orderId:'synthetic-1',generation:1,completionToken:'t',role:'operator',source:'ram',userId:'22'}});
  await page.evaluate(()=>window.resolveMutation());await page.waitForTimeout(950);
  await page.selectOption('#customer-account','ram:22');assert.equal(await page.evaluate(()=>window.requests[1].payload.source),'ram');assert.equal(await page.evaluate(()=>window.requests[1].payload.completionToken),'changed');await page.evaluate(()=>window.resolveMutation());await page.waitForTimeout(950);
  await page.locator('#undo').click();assert.equal(await page.evaluate(()=>window.requests[2].payload.expectedLastOrderId),'synthetic-previous');for(const id of ['customer-account','operator-account','complete','undo']) assert.equal(await page.locator('#'+id).isDisabled(),true);await page.evaluate(()=>window.resolveMutation());await page.waitForTimeout(100);
  await page.evaluate(()=>{const select=document.getElementById('customer-account');select.dispatchEvent(new PointerEvent('pointerdown'));window.state.native.current.jobId='j-next';window.state.native.current.completionToken='next-job-token';window.emitState();select.value='ram:22';select.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.requests[3].payload.jobId),'j');assert.equal(await page.evaluate(()=>window.requests[3].payload.completionToken),'changed');await page.evaluate(()=>window.resolveMutation());await page.waitForTimeout(100);
  await page.evaluate(()=>{window.state.native.current.customer.code='PAIR_CLOSE_PENDING';window.state.native.current.code='PAIR_CLOSE_PENDING';window.emitState();});assert.equal(await page.locator('#issue').isHidden(),true);
  await page.evaluate(()=>{window.state.native.canUndo=false;window.state.native.historyTarget=null;window.emitState();});assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{const job=window.state.native.current;job.state='preparing';job.code=null;job.customer.state='preparing';job.customer.code=null;job.customer.loginPhase='chrome';window.emitState();});
  assert.equal(await page.locator('#customer-state').textContent(),'กำลังล็อกอินใน Chrome');assert.equal(await page.locator('#issue').isHidden(),true);
  assert.match(await page.locator('.roles .card').first().locator('.hint').textContent(),/Chrome → ตรวจใน Queue → เข้า Bewpakorn RAM/);
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{window.state.native.current.customer.loginPhase='queue';window.emitState();});
  assert.equal(await page.locator('#customer-state').textContent(),'Chrome ผ่านแล้ว · กำลังตรวจใน Queue');assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{window.state.native.current.customer.loginPhase='ram';window.emitState();});assert.equal(await page.locator('#customer-state').textContent(),'กำลังนำเข้าบัญชีไป RAM');
  await page.evaluate(()=>{window.state.native.current.customer.state='ready';window.emitState();});assert.equal(await page.locator('#customer-state').textContent(),'พร้อมใช้งานใน RAM');
  for(const phase of ['chrome','queue']) {
   await page.evaluate(phase=>{const job=window.state.native.current;job.state='blocked';job.customer.state='blocked';job.customer.loginPhase=phase;job.customer.code='CUSTOMER_CAPTCHA_REQUIRED';job.customer.canResume=true;window.emitState();},phase);
   assert.equal(await page.locator('#customer-state').textContent(),'ต้องตรวจสอบ');assert.match(await page.locator('#issue').textContent(),/CAPTCHA.*กรุณาจัดการเองในหน้าต่างล็อกอิน/);assert.match(await page.locator('#issue').textContent(),/ออเดอร์เดิมยังอยู่/);assert.doesNotMatch(await page.locator('#customer-state').textContent(),/พร้อมใช้งาน|Chrome ผ่านแล้ว/);
  }
  for(const code of ['CHROME_UNAVAILABLE','CHROME_START_FAILED','CHROME_DEBUG_UNAVAILABLE','CHROME_SESSION_CLOSED','CHROME_NAVIGATION_DENIED','CHROME_SESSION_TRANSFER_FAILED','CHROME_LOGIN_TIMEOUT']) {
   await page.evaluate(code=>{window.state.native.current.customer.loginPhase='chrome';window.state.native.current.customer.code=code;window.emitState();},code);
   assert.match(await page.locator('#issue').textContent(),/Chrome/);assert.match(await page.locator('#issue').textContent(),/กรุณา/);assert.doesNotMatch(await page.locator('#issue').textContent(),/งานนี้ต้องตรวจสอบ|พร้อมใช้งาน|Chrome ผ่านแล้ว/);assert.equal(await page.locator('#customer-state').textContent(),'ต้องตรวจสอบ');
  }
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.resolve(__dirname,'../../docs/login-only-panel-320.png'),fullPage:true});
  console.log('320px synthetic panel: labeled account selectors, identity-bound mutations, Chrome → Queue → RAM phase hints, manual verification stays blocked, actionable Chrome errors, no horizontal overflow');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
