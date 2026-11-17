const {chromium}=require('playwright');
const http=require('http');
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');

(async()=>{
  const root=path.resolve(__dirname,'../../extension');
  const server=http.createServer((req,res)=>{
    const name=path.basename(req.url.split('?')[0])||'options.html',file=path.join(root,name);
    if(!fs.existsSync(file)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:720}});
    await page.addInitScript(()=>{
      const p=(id,map,mapName,place)=>({productId:id,productName:'สินค้าทดสอบ '+id,mapId:map,mapName,placeId:place});
      const products=[p('other000001','mm2','Murder Mystery 2','142823291'),p('other000002','mm2','Murder Mystery 2','142823291'),p('camera00001','cameraman','Cameraman Tower Defense','132929771812494'),p('camera00002','cameraman','Cameraman Tower Defense','132929771812494')];
      window.chrome={runtime:{sendMessage:async m=>{
        if(m.type==='UI_OPTIONS_GET')return {ok:true,payload:{config:window.reloadConfig||{catalog:[products[0],products[2]]},products}};
        window.saved=m.payload;window.saveCount=(window.saveCount||0)+1;return {ok:true,payload:{}};
      }}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/options.html`);await page.waitForSelector('.map-group');
    const other=page.locator('[data-map-id="mm2"]'),camera=page.locator('[data-map-id="cameraman"]');
    const cameraProducts=camera.locator('.product-choice input'),otherProducts=other.locator('.product-choice input');
    assert.equal(await page.locator('.map-group').count(),2);
    assert.equal(await page.locator('.operator-choice, .private-source, fieldset').count(),0,'launch settings are gone');
    assert.equal(await cameraProducts.nth(0).isChecked(),true);assert.equal(await cameraProducts.nth(1).isChecked(),false);
    assert.equal(await otherProducts.nth(0).isChecked(),true);assert.equal(await otherProducts.nth(1).isChecked(),false);
    assert.equal(await page.evaluate(()=>window.saved),undefined,'nothing saves before the button');

    await camera.getByRole('button',{name:'เลือกเฉพาะแมพนี้',exact:true}).click();
    assert.equal(await other.locator('.map-choice input').isChecked(),false);
    assert.equal(await otherProducts.nth(0).isDisabled(),true);
    await page.locator('button[type=submit]').click();
    let saved=await page.evaluate(()=>window.saved);
    assert.equal(saved.version,1);assert.equal(saved.catalog.length,1);
    assert.equal(saved.catalog[0].productId,'camera00001');assert.equal('operatorUserIds' in saved.catalog[0],false);

    await other.locator('.map-choice input').check();
    assert.equal(await otherProducts.nth(0).isChecked(),true);
    await cameraProducts.nth(1).check();
    await page.locator('button[type=submit]').click();
    saved=await page.evaluate(()=>window.saved);assert.equal(saved.catalog.length,3);

    await cameraProducts.nth(0).uncheck();
    const count=await page.evaluate(()=>window.saveCount);await page.locator('button[type=submit]').click();
    assert.equal(await page.evaluate(()=>window.saveCount),count+1);
    assert.equal((await page.evaluate(()=>window.saved)).catalog.length,2);

    await page.addInitScript(()=>{window.reloadConfig={protectedOperatorUserIds:['103'],catalog:[{productId:'camera00002',productName:'สินค้าทดสอบ camera00002',mapId:'cameraman',mapName:'Cameraman Tower Defense',placeId:'132929771812494',operatorUserId:'102',operatorUserIds:['102','104']}]};});
    await page.reload();await page.waitForSelector('.map-group');
    assert.equal(await page.locator('[data-map-id="cameraman"] .product-choice input').nth(1).isChecked(),true,'legacy saved product is restored');
    assert.equal(await page.locator('[data-map-id="mm2"] .map-choice input').isChecked(),false,'map without a saved product stays off');
    await page.locator('button[type=submit]').click();
    saved=await page.evaluate(()=>window.saved);assert.deepEqual(saved.catalog[0].operatorUserIds,['102','104']);assert.deepEqual(saved.protectedOperatorUserIds.sort(),['102','103','104']);
    await page.locator('[data-map-id="mm2"] .map-only').click();await page.locator('[data-map-id="mm2"] .product-choice input').nth(0).check();await page.locator('button[type=submit]').click();
    saved=await page.evaluate(()=>window.saved);assert.ok(saved.catalog.every(p=>p.mapId==='mm2'));assert.deepEqual(saved.protectedOperatorUserIds.sort(),['102','103','104'],'disabled-map accounts remain protected');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    console.log('320px options: map toggles, legacy mappings and disabled-map account protection retained, no launch settings, no overflow');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
