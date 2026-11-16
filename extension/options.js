const $=id=>document.getElementById(id);
const send=(type,payload)=>chrome.runtime.sendMessage({type,payload});
const groups=[];
function text(tag, value, className='') { const el=document.createElement(tag); el.textContent=value; if(className) el.className=className; return el; }
function setMapEnabled(group, enabled){
  group.enabled.checked=enabled;
  if(enabled && !group.rows.some(row=>row.enabled.checked)) group.rows.forEach(row=>{row.enabled.checked=true;});
  group.select.disabled=!enabled;
  group.rows.forEach(row=>{row.enabled.disabled=!enabled;});
  group.card.classList.toggle('map-disabled',!enabled);
}
async function init(){
  const [settings,accountsReply]=await Promise.all([send('UI_OPTIONS_GET'),send('UI_ACCOUNTS').catch(()=>null)]);
  if(!settings.ok) throw new Error(settings.error.code);
  const config=settings.payload.config; const products=settings.payload.products;
  if(!Array.isArray(products)) throw new Error('CATALOG_INVALID');
  const saved=new Map((config.catalog || []).map(p=>[p.productId,p]));
  const accounts=accountsReply?.ok && Array.isArray(accountsReply.payload.accounts) ? accountsReply.payload.accounts : [];
  if(!accounts.length) $('result').textContent='ยังอ่านบัญชี RAM ไม่ได้ กรุณาเปิด RAM แล้วโหลดหน้านี้ใหม่';
  if(!products.length) $('result').textContent='ยังไม่พบสินค้า กรุณาตรวจการเข้าสู่ระบบร้านแล้วเปิดตั้งค่าอีกครั้ง';
  const byMap=new Map();
  for(const product of products){if(!byMap.has(product.mapId)) byMap.set(product.mapId,[]);byMap.get(product.mapId).push(product);}
  for(const items of byMap.values()){
    const map=items[0], card=document.createElement('section');card.className='card map-group';
    card.append(text('h2',map.mapName),text('p',`รหัสแมพ ${map.mapId} · Place ID ${map.placeId}`,'muted'));
    const actions=document.createElement('div');actions.className='map-actions';
    const mapChoice=document.createElement('label');mapChoice.className='map-choice';const mapEnabled=document.createElement('input');mapEnabled.type='checkbox';mapChoice.append(mapEnabled,document.createTextNode('ทำแมพนี้'));
    const only=document.createElement('button');only.type='button';only.className='map-only';only.textContent='เลือกเฉพาะแมพนี้';actions.append(mapChoice,only);card.append(actions);
    const caption=document.createElement('label');caption.textContent='บัญชีของคุณสำหรับแมพนี้';const select=document.createElement('select');
    const blank=document.createElement('option');blank.value='';blank.textContent='ยังไม่จับคู่บัญชี';select.append(blank);
    for(const account of accounts.filter(a=>String(a.placeId || '')===String(map.placeId))){const option=document.createElement('option');option.value=String(account.userId);option.textContent=[account.username,account.alias,account.description,`Place ${account.placeId}`].filter(Boolean).join(' · ');select.append(option);}
    const values=new Set(items.map(p=>saved.get(p.productId)?.operatorUserId).filter(Boolean));if(values.size===1){const userId=[...values][0];if(![...select.options].some(o=>o.value===userId)){const option=document.createElement('option');option.value=userId;option.textContent=`บัญชีที่บันทึกไว้ · ${userId}`;select.append(option);}select.value=userId;}
    caption.append(select);card.append(caption);
    const details=document.createElement('details');details.open=true;details.append(text('summary',`สินค้าของแมพนี้ (${items.length})`));const rows=[];
    for(const item of items){const label=document.createElement('label');label.className='product-choice';const enabled=document.createElement('input');enabled.type='checkbox';const old=saved.get(item.productId);enabled.checked=Boolean(old && ['productName','mapId','mapName','placeId'].every(key=>old[key]===item[key]));label.append(enabled,document.createTextNode(`${item.productName} · ${item.productId}`));details.append(label);rows.push({item,enabled});}
    card.append(details);$('products').append(card);const group={card,enabled:mapEnabled,select,rows};groups.push(group);
    setMapEnabled(group,rows.some(row=>row.enabled.checked));
    mapEnabled.addEventListener('change',()=>setMapEnabled(group,mapEnabled.checked));
    only.addEventListener('click',()=>groups.forEach(candidate=>setMapEnabled(candidate,candidate===group)));
  }
}
$('form').addEventListener('submit',async e=>{e.preventDefault();const catalog=groups.filter(g=>g.enabled.checked).flatMap(g=>g.rows.filter(r=>r.enabled.checked).map(r=>({...r.item,operatorUserId:g.select.value})));if(!catalog.length){$('result').textContent='กรุณาเลือกอย่างน้อยหนึ่งแมพและหนึ่งสินค้า';return;}try{const reply=await send('UI_OPTIONS_SAVE',{version:1,shopOrigin:'https://bewpakorn.rdcw.xyz',catalog});$('result').textContent=reply.ok?'บันทึกแล้ว':'ข้อมูลสินค้าหรือแมพเปลี่ยน กรุณาโหลดหน้านี้ใหม่';}catch{$('result').textContent='บันทึกไม่ได้ กรุณาลองอีกครั้ง';}});
init().catch(()=>{$('result').textContent='โหลดการตั้งค่าไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วเปิดหน้านี้ใหม่';});
