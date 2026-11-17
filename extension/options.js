const $=id=>document.getElementById(id);
const send=(type,payload)=>chrome.runtime.sendMessage({type,payload});
const groups=[];
let protectedOperatorUserIds=[];
function text(tag,value,className=''){const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;return el;}
function setMapEnabled(group,enabled){
  group.enabled.checked=enabled;
  group.rows.forEach(row=>{row.enabled.disabled=!enabled;});
  group.card.classList.toggle('map-disabled',!enabled);
}
async function init(){
  const settings=await send('UI_OPTIONS_GET');
  if(!settings.ok)throw new Error(settings.error.code);
  const config=settings.payload.config,products=settings.payload.products;
  protectedOperatorUserIds=[...new Set([...(config.protectedOperatorUserIds||[]),...(config.catalog||[]).flatMap(p=>[p.operatorUserId,...(p.operatorUserIds||[]),p.privateServerSourceUserId]).filter(Boolean)])];
  if(!Array.isArray(products))throw new Error('CATALOG_INVALID');
  const saved=new Set((config.catalog||[]).map(p=>p.productId));
  const previous=new Map((config.catalog||[]).map(p=>[p.productId,p]));
  if(!products.length)$('result').textContent='ยังไม่พบสินค้า กรุณาตรวจการเข้าสู่ระบบร้านแล้วเปิดตั้งค่าอีกครั้ง';
  const byMap=new Map();
  for(const product of products){if(!byMap.has(product.mapId))byMap.set(product.mapId,[]);byMap.get(product.mapId).push(product);}
  for(const items of byMap.values()){
    const map=items[0],card=document.createElement('section');card.className='card map-group';card.dataset.mapId=map.mapId;
    card.append(text('h2',map.mapName),text('p',`รหัสแมพ ${map.mapId} · Place ID ${map.placeId}`,'muted'));
    const actions=document.createElement('div');actions.className='map-actions';
    const mapChoice=document.createElement('label');mapChoice.className='map-choice';const mapEnabled=document.createElement('input');mapEnabled.type='checkbox';mapChoice.append(mapEnabled,document.createTextNode('ทำแมพนี้'));
    const only=text('button','เลือกเฉพาะแมพนี้','map-only');only.type='button';actions.append(mapChoice,only);card.append(actions);
    const details=document.createElement('details');details.open=true;details.append(text('summary',`สินค้าของแมพนี้ (${items.length})`));const rows=[];
    for(const item of items){const label=document.createElement('label');label.className='product-choice';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=saved.has(item.productId);label.append(enabled,document.createTextNode(`${item.productName} · ${item.productId}`));details.append(label);const restored={...item},old=previous.get(item.productId);for(const key of ['operatorUserId','operatorUserIds','privateServerSourceUserId'])if(old?.[key]!==undefined)restored[key]=old[key];rows.push({item:restored,enabled});}
    card.append(details);$('products').append(card);
    const group={card,enabled:mapEnabled,rows};groups.push(group);setMapEnabled(group,rows.some(row=>row.enabled.checked));
    mapEnabled.addEventListener('change',()=>setMapEnabled(group,mapEnabled.checked));
    only.addEventListener('click',()=>groups.forEach(candidate=>setMapEnabled(candidate,candidate===group)));
  }
}
$('form').addEventListener('submit',async e=>{
  e.preventDefault();const active=groups.filter(g=>g.enabled.checked&&g.rows.some(r=>r.enabled.checked));
  if(!active.length){$('result').textContent='กรุณาเลือกอย่างน้อยหนึ่งแมพและหนึ่งสินค้า';return;}
  const catalog=active.flatMap(g=>g.rows.filter(r=>r.enabled.checked).map(r=>({...r.item})));
  try{const reply=await send('UI_OPTIONS_SAVE',{version:1,shopOrigin:'https://bewpakorn.rdcw.xyz',catalog,protectedOperatorUserIds});$('result').textContent=reply.ok?'บันทึกแล้ว':'ข้อมูลสินค้าหรือแมพเปลี่ยน กรุณาโหลดหน้านี้ใหม่';}catch{$('result').textContent='บันทึกไม่ได้ กรุณาลองอีกครั้ง';}
});
init().catch(()=>{$('result').textContent='โหลดการตั้งค่าไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วเปิดหน้านี้ใหม่';});
