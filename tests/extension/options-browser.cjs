const {chromium}=require('playwright');
const http=require('http');
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');

(async()=>{
  const root=path.resolve(__dirname,'../../extension');
  const server=http.createServer((req,res)=>{
    const name=path.basename(req.url.split('?')[0])||'options.html';
    const file=path.join(root,name);
    if(!fs.existsSync(file)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720}});
    await page.addInitScript(()=>{
      const p=(id,map,mapName,place)=>({productId:id,productName:'สินค้าทดสอบ '+id,mapId:map,mapName,placeId:place,operatorUserId:''});
      const products=[p('one','map1','แมพทดสอบอื่น','11'),p('two','map1','แมพทดสอบอื่น','11'),p('camera-one','camera','Cameraman Tower Defense','22'),p('camera-two','camera','Cameraman Tower Defense','22')];
      window.chrome={runtime:{sendMessage:async m=>{
        if(m.type==='UI_OPTIONS_GET')return {ok:true,payload:{config:{catalog:[{...products[0],operatorUserId:'1'}]},products}};
        if(m.type==='UI_ACCOUNTS')return {ok:true,payload:{accounts:[{userId:'1',username:'one',description:'account',placeId:'11'},{userId:'2',username:'two',placeId:'22'}]}};
        window.saved=m.payload;
        return {ok:true,payload:{}};
      }}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/options.html`);
    await page.waitForSelector('.map-group');
    const other=page.locator('.map-group').nth(0);
    const camera=page.locator('.map-group').nth(1);
    const otherToggle=other.locator('.map-choice input');
    const cameraToggle=camera.locator('.map-choice input');
    const otherProducts=other.locator('.product-choice input');
    const cameraProducts=camera.locator('.product-choice input');
    assert.equal(await page.locator('.map-group').count(),2);
    assert.equal(await page.locator('input[type=text]').count(),0);
    assert.equal(await other.locator('select option').count(),2);
    assert.equal(await other.locator('select').inputValue(),'1');
    assert.equal(await otherToggle.isChecked(),true);
    assert.equal(await cameraToggle.isChecked(),false);
    assert.equal(await camera.locator('select').isDisabled(),true);
    assert.equal(await cameraProducts.nth(0).isDisabled(),true);

    await camera.getByRole('button',{name:'เลือกเฉพาะแมพนี้',exact:true}).click();
    assert.equal(await cameraToggle.isChecked(),true);
    assert.equal(await cameraProducts.nth(0).isChecked(),true);
    assert.equal(await cameraProducts.nth(1).isChecked(),true);
    assert.equal(await otherToggle.isChecked(),false);
    assert.equal(await other.locator('select').isDisabled(),true);
    assert.equal(await otherProducts.nth(0).isDisabled(),true);
    assert.equal(await otherProducts.nth(0).isChecked(),true);
    assert.equal(await otherProducts.nth(1).isChecked(),false);
    await camera.locator('select').selectOption('2');
    await page.locator('button[type=submit]').click();
    let saved=await page.evaluate(()=>window.saved);
    assert.deepEqual(saved.catalog.map(x=>[x.productId,x.mapId,x.operatorUserId]),[['camera-one','camera','2'],['camera-two','camera','2']]);

    await otherToggle.check();
    assert.equal(await otherProducts.nth(0).isEnabled(),true);
    assert.equal(await otherProducts.nth(0).isChecked(),true);
    assert.equal(await otherProducts.nth(1).isChecked(),false);
    assert.equal(await other.locator('select').inputValue(),'1');
    await page.locator('button[type=submit]').click();
    saved=await page.evaluate(()=>window.saved);
    assert.deepEqual(saved.catalog.map(x=>[x.productId,x.operatorUserId]),[['one','1'],['camera-one','2'],['camera-two','2']]);

    await cameraProducts.nth(1).uncheck();
    await other.getByRole('button',{name:'เลือกเฉพาะแมพนี้',exact:true}).click();
    await cameraToggle.check();
    assert.equal(await cameraProducts.nth(0).isChecked(),true);
    assert.equal(await cameraProducts.nth(1).isChecked(),false);
    assert.equal(await camera.locator('select').inputValue(),'2');
    await cameraProducts.nth(0).uncheck();
    await cameraToggle.uncheck();
    await cameraToggle.check();
    assert.equal(await cameraProducts.nth(0).isChecked(),true);
    assert.equal(await cameraProducts.nth(1).isChecked(),true);
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    console.log('320px options: one-map save, inactive map exclusion, restored product selection and account mappings, no overflow');
  }finally{
    await browser.close();
    server.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
