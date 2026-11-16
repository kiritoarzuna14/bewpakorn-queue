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
      const p=(id,map,mapName,place)=>({productId:id,productName:'สินค้าทดสอบ '+id,mapId:map,mapName,placeId:place,operatorUserId:''});
      const products=[p('other000001','mm2','Murder Mystery 2','142823291'),p('other000002','mm2','Murder Mystery 2','142823291'),p('camera00001','cameraman','Cameraman Tower Defense','132929771812494'),p('camera00002','cameraman','Cameraman Tower Defense','132929771812494')];
      const accounts=[
        {userId:'101',username:'BewFNTH1',description:'GAG',placeId:'126884695634066',hasPrivateDestination:true,privatePlaceId:'126884695634066'},
        {userId:'102',username:'BewFNTH2',placeId:'132929771812494',hasPrivateDestination:true,privatePlaceId:'132929771812494'},
        {userId:'103',username:'BewFNTH3',placeId:'8304191830',hasPrivateDestination:true,privatePlaceId:'8304191830'},
        // Old metadata format is still supported for source selection.
        {userId:'104',username:'OtherOperator',placeId:'142823291',hasPrivateDestination:true},
        {userId:'105',username:'NoPrivate',placeId:'132929771812494',hasPrivateDestination:false},
        {userId:'106',username:'PrivatePlaceWins',placeId:'132929771812494',hasPrivateDestination:true,privatePlaceId:'8304191830'}
      ];
      window.chrome={runtime:{sendMessage:async m=>{
        if(m.type==='UI_OPTIONS_GET')return {ok:true,payload:{config:window.reloadConfig||{catalog:[{...products[0],operatorUserId:'104'},{...products[2],operatorUserId:'102'},{...products[3],operatorUserId:'102'}]},products}};
        if(m.type==='UI_ACCOUNTS')return {ok:true,payload:{accounts}};
        window.saved=m.payload;window.saveCount=(window.saveCount||0)+1;return {ok:true,payload:{}};
      }}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/options.html`);await page.waitForSelector('.map-group');
    const other=page.locator('[data-map-id="mm2"]'),camera=page.locator('[data-map-id="cameraman"]');
    const selected=group=>group.locator('.operator-choice input:checked').evaluateAll(inputs=>inputs.map(input=>input.value));
    const cameraProducts=camera.locator('.product-choice input'),otherProducts=other.locator('.product-choice input');
    assert.equal(await page.locator('.map-group').count(),2);assert.equal(await page.locator('input[type=text]').count(),0);
    assert.deepEqual(await selected(other),['104']);assert.deepEqual(await selected(camera),['101','102','103']);
    assert.equal(await camera.locator('.operator-choice').count(),6,'saved map must not filter operator eligibility');
    assert.deepEqual(await camera.locator('.private-source option').evaluateAll(options=>options.map(option=>option.value)),['','102']);
    assert.equal(await camera.locator('.private-source').inputValue(),'102');assert.equal(await other.locator('.private-source').inputValue(),'104');
    assert.equal(await page.evaluate(()=>window.saved),undefined,'migration remains a suggestion until explicit Save');

    await camera.getByRole('button',{name:'เลือกเฉพาะแมพนี้',exact:true}).click();
    assert.equal(await other.locator('.map-choice input').isChecked(),false);assert.equal(await other.locator('.private-source').isDisabled(),true);assert.equal(await other.locator('.operator-choice input').first().isDisabled(),true);
    assert.equal(await otherProducts.nth(0).isChecked(),true);assert.equal(await otherProducts.nth(1).isChecked(),false);
    await page.locator('button[type=submit]').click();
    let saved=await page.evaluate(()=>window.saved);assert.equal(saved.version,1);assert.equal(saved.catalog.length,2);
    for(const item of saved.catalog){assert.equal(item.mapId,'cameraman');assert.deepEqual(item.operatorUserIds,['101','102','103']);assert.equal(item.operatorUserId,'101');assert.equal(item.privateServerSourceUserId,'102');}

    await camera.getByRole('button',{name:'เลื่อนขึ้น BewFNTH3',exact:true}).click();
    assert.deepEqual(await selected(camera),['101','103','102']);
    await camera.locator('input[value="101"]').uncheck();await camera.locator('input[value="101"]').check();
    assert.deepEqual(await selected(camera),['103','102','101']);
    await camera.locator('input[value="104"]').check();assert.deepEqual(await selected(camera),['103','102','101','104']);
    await camera.locator('input[value="104"]').uncheck();
    await page.locator('button[type=submit]').click();saved=await page.evaluate(()=>window.saved);
    for(const item of saved.catalog){assert.deepEqual(item.operatorUserIds,['103','102','101']);assert.equal(item.operatorUserId,'103');assert.equal(item.privateServerSourceUserId,'102');}

    await other.locator('.map-choice input').check();assert.deepEqual(await selected(other),['104']);assert.equal(await otherProducts.nth(0).isChecked(),true);assert.equal(await otherProducts.nth(1).isChecked(),false);
    await page.locator('button[type=submit]').click();saved=await page.evaluate(()=>window.saved);assert.equal(saved.catalog.length,3);assert.deepEqual(saved.catalog[0].operatorUserIds,['104']);
    await cameraProducts.nth(1).uncheck();await other.getByRole('button',{name:'เลือกเฉพาะแมพนี้',exact:true}).click();await camera.locator('.map-choice input').check();
    assert.equal(await cameraProducts.nth(0).isChecked(),true);assert.equal(await cameraProducts.nth(1).isChecked(),false);assert.deepEqual(await selected(camera),['103','102','101']);
    await cameraProducts.nth(0).uncheck();await camera.locator('.map-choice input').uncheck();await camera.locator('.map-choice input').check();assert.equal(await cameraProducts.nth(0).isChecked(),true);assert.equal(await cameraProducts.nth(1).isChecked(),true);
    await camera.locator('.private-source').selectOption('');const count=await page.evaluate(()=>window.saveCount);await page.locator('button[type=submit]').click();assert.equal(await page.evaluate(()=>window.saveCount),count,'missing destination prevents save');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    assert.equal(await camera.locator('fieldset legend').textContent(),'บัญชีหมุนเวียนตามลำดับ');

    // An explicitly saved pool is restored without applying the legacy suggestion again.
    await page.addInitScript(()=>{window.reloadConfig={catalog:[{productId:'camera00001',productName:'สินค้าทดสอบ camera00001',mapId:'cameraman',mapName:'Cameraman Tower Defense',placeId:'132929771812494',operatorUserId:'103',operatorUserIds:['103','101'],privateServerSourceUserId:'102'}]};});
    await page.reload();await page.waitForSelector('.map-group');assert.deepEqual(await selected(camera),['103','101']);assert.equal(await camera.locator('.private-source').inputValue(),'102');
    console.log('320px options: ordered rotation, legacy and explicit pools, all-account eligibility, shared private source, map-only saves, product selection restoration, validation, no overflow');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
