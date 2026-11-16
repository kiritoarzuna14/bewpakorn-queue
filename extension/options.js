import {operatorPool} from './queue.js';

const $=id=>document.getElementById(id);
const send=(type,payload)=>chrome.runtime.sendMessage({type,payload});
const groups=[];
function text(tag,value,className=''){const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;return el;}
function accountName(account){return [account.username,account.alias,account.description,account.placeId?`Place ที่บันทึกไว้ ${account.placeId}`:''].filter(Boolean).join(' · ');}
function privatePlace(account){return String(account.privatePlaceId ?? account.placeId ?? '');}
function setMapEnabled(group,enabled){
  group.enabled.checked=enabled;
  if(enabled&&!group.rows.some(row=>row.enabled.checked))group.rows.forEach(row=>{row.enabled.checked=true;});
  group.source.disabled=!enabled;
  group.poolField.disabled=!enabled;
  group.rows.forEach(row=>{row.enabled.disabled=!enabled;});
  group.card.classList.toggle('map-disabled',!enabled);
}
function renderPool(group){
  group.poolList.replaceChildren();
  const selected=new Set(group.pool);
  const ordered=[...group.pool,...group.accounts.map(a=>String(a.userId)).filter(id=>!selected.has(id))];
  for(const id of ordered){
    const account=group.accounts.find(a=>String(a.userId)===id)||{username:`บัญชีที่บันทึกไว้ ${id}`};
    const row=document.createElement('div');row.className='operator-choice';row.dataset.userId=id;
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(id);check.value=id;
    const position=group.pool.indexOf(id);
    label.append(check,text('span',`${position>=0?`${position+1}. `:''}${accountName(account)}`));row.append(label);
    check.addEventListener('change',()=>{if(check.checked&&group.pool.length>=20){check.checked=false;$('result').textContent='เลือกบัญชีหมุนเวียนได้ไม่เกิน 20 บัญชี';return;}group.pool=check.checked?[...group.pool,id]:group.pool.filter(value=>value!==id);renderPool(group);group.poolList.querySelector(`input[value="${id}"]`)?.focus();});
    if(position>=0){
      const controls=document.createElement('div');controls.className='pool-order';
      for(const [offset,name,glyph] of [[-1,'เลื่อนขึ้น','↑'],[1,'เลื่อนลง','↓']]){
        const button=text('button',glyph);button.type='button';button.disabled=position+offset<0||position+offset>=group.pool.length;button.setAttribute('aria-label',`${name} ${account.username}`);
        button.addEventListener('click',()=>{[group.pool[position],group.pool[position+offset]]=[group.pool[position+offset],group.pool[position]];renderPool(group);group.poolList.querySelector(`input[value="${id}"]`)?.focus();});controls.append(button);
      }
      row.append(controls);
    }
    group.poolList.append(row);
  }
}
async function init(){
  const [settings,accountsReply]=await Promise.all([send('UI_OPTIONS_GET'),send('UI_ACCOUNTS').catch(()=>null)]);
  if(!settings.ok)throw new Error(settings.error.code);
  const config=settings.payload.config,products=settings.payload.products;
  if(!Array.isArray(products))throw new Error('CATALOG_INVALID');
  const saved=new Map((config.catalog||[]).map(p=>[p.productId,p]));
  const accounts=accountsReply?.ok&&Array.isArray(accountsReply.payload.accounts)?accountsReply.payload.accounts.filter(a=>/^[1-9][0-9]{0,19}$/.test(String(a.userId))):[];
  if(!accounts.length)$('result').textContent='ยังอ่านบัญชี RAM ไม่ได้ กรุณาเปิด RAM แล้วโหลดหน้านี้ใหม่';
  if(!products.length)$('result').textContent='ยังไม่พบสินค้า กรุณาตรวจการเข้าสู่ระบบร้านแล้วเปิดตั้งค่าอีกครั้ง';
  const byMap=new Map();
  for(const product of products){if(!byMap.has(product.mapId))byMap.set(product.mapId,[]);byMap.get(product.mapId).push(product);}
  for(const items of byMap.values()){
    const map=items[0],card=document.createElement('section');card.className='card map-group';card.dataset.mapId=map.mapId;
    card.append(text('h2',map.mapName),text('p',`รหัสแมพ ${map.mapId} · Place ID ${map.placeId}`,'muted'));
    const actions=document.createElement('div');actions.className='map-actions';
    const mapChoice=document.createElement('label');mapChoice.className='map-choice';const mapEnabled=document.createElement('input');mapEnabled.type='checkbox';mapChoice.append(mapEnabled,document.createTextNode('ทำแมพนี้'));
    const only=text('button','เลือกเฉพาะแมพนี้','map-only');only.type='button';actions.append(mapChoice,only);card.append(actions);
    const oldItems=items.map(p=>saved.get(p.productId)).filter(Boolean),first=oldItems[0];
    let pool=first?operatorPool(first):[];
    const fnth=['BewFNTH1','BewFNTH2','BewFNTH3'].map(name=>accounts.find(a=>a.username===name));
    if(map.mapId==='cameraman'&&first&&first.operatorUserIds===undefined&&fnth.every(Boolean)&&first.operatorUserId===String(fnth[1].userId))pool=fnth.map(a=>String(a.userId));
    const poolField=document.createElement('fieldset');poolField.className='operator-pool';poolField.append(text('legend','บัญชีหมุนเวียนตามลำดับ'));
    const hint=text('p','เลือกได้ทุกบัญชี แมพที่บันทึกไว้เป็นข้อมูลอ้างอิงเท่านั้น ใช้ลูกศรจัดลำดับหมุนเวียน','muted pool-hint');poolField.append(hint);
    const poolList=document.createElement('div');poolList.className='operator-list';poolField.append(poolList);card.append(poolField);
    const caption=document.createElement('label');caption.textContent='เซิร์ฟเวอร์ส่วนตัวร่วมกันสำหรับแมพนี้';const source=document.createElement('select');source.className='private-source';
    const blank=text('option','เลือกบัญชีที่บันทึกเซิร์ฟเวอร์ส่วนตัว');blank.value='';source.append(blank);
    for(const account of accounts.filter(a=>a.hasPrivateDestination===true&&privatePlace(a)===String(map.placeId))){const option=text('option',accountName(account));option.value=String(account.userId);source.append(option);}
    const sourceId=first?.privateServerSourceUserId??first?.operatorUserId??'';
    if([...source.options].some(option=>option.value===sourceId))source.value=sourceId;
    caption.append(source);card.append(caption,text('p','ทั้งบัญชีลูกค้าและบัญชีที่ถึงรอบจะเข้าเซิร์ฟเวอร์ส่วนตัวเดียวกัน','muted pool-hint'));
    const details=document.createElement('details');details.open=true;details.append(text('summary',`สินค้าของแมพนี้ (${items.length})`));const rows=[];
    for(const item of items){const label=document.createElement('label');label.className='product-choice';const enabled=document.createElement('input');enabled.type='checkbox';const old=saved.get(item.productId);enabled.checked=Boolean(old&&['productName','mapId','mapName','placeId'].every(key=>old[key]===item[key]));label.append(enabled,document.createTextNode(`${item.productName} · ${item.productId}`));details.append(label);rows.push({item,enabled});}
    card.append(details);$('products').append(card);
    const group={card,enabled:mapEnabled,poolField,poolList,pool,accounts,source,rows};groups.push(group);renderPool(group);setMapEnabled(group,rows.some(row=>row.enabled.checked));
    mapEnabled.addEventListener('change',()=>setMapEnabled(group,mapEnabled.checked));
    only.addEventListener('click',()=>groups.forEach(candidate=>setMapEnabled(candidate,candidate===group)));
  }
}
$('form').addEventListener('submit',async e=>{
  e.preventDefault();const active=groups.filter(g=>g.enabled.checked&&g.rows.some(r=>r.enabled.checked));
  if(!active.length){$('result').textContent='กรุณาเลือกอย่างน้อยหนึ่งแมพและหนึ่งสินค้า';return;}
  if(active.some(g=>!g.pool.length||!g.source.value)){$('result').textContent='กรุณาเลือกบัญชีหมุนเวียนและเซิร์ฟเวอร์ส่วนตัวสำหรับทุกแมพที่เปิดไว้';return;}
  const catalog=active.flatMap(g=>g.rows.filter(r=>r.enabled.checked).map(r=>({...r.item,operatorUserId:g.pool[0],operatorUserIds:[...g.pool],privateServerSourceUserId:g.source.value})));
  try{const reply=await send('UI_OPTIONS_SAVE',{version:1,shopOrigin:'https://bewpakorn.rdcw.xyz',catalog});$('result').textContent=reply.ok?'บันทึกแล้ว':'ข้อมูลสินค้าหรือแมพเปลี่ยน กรุณาโหลดหน้านี้ใหม่';}catch{$('result').textContent='บันทึกไม่ได้ กรุณาลองอีกครั้ง';}
});
init().catch(()=>{$('result').textContent='โหลดการตั้งค่าไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วเปิดหน้านี้ใหม่';});
