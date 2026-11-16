const $=id=>document.getElementById(id);
const send=(type,payload)=>chrome.runtime.sendMessage({type,payload});
const field=(label,value)=>{const wrap=document.createElement('div');const caption=document.createElement('label');caption.textContent=label;const input=document.createElement('input');input.value=value ?? '';caption.append(input);wrap.append(caption);return {wrap,input};};
let rows=[];
async function init(){
  const [settings,accountsReply]=await Promise.all([send('UI_OPTIONS_GET'),send('UI_ACCOUNTS').catch(()=>null)]);
  if(!settings.ok) throw new Error(settings.error.code);
  const config=settings.payload.config; const discovered=settings.payload.products;
  const products=Array.isArray(discovered)?discovered:(discovered?.products || discovered?.catalog || []);
  const merged=new Map((config.catalog || []).map(x=>[String(x.productId),x]));
  for(const product of products) if(product.productId && !merged.has(String(product.productId))) merged.set(String(product.productId),product);
  const accounts=accountsReply?.ok ? accountsReply.payload.accounts || [] : [];
  if(!accounts.length) $('result').textContent='ยังอ่านบัญชี RAM ไม่ได้ คุณสามารถกรอก User ID ของบัญชีเองได้';
  if(!merged.size) $('result').textContent='ยังไม่พบสินค้าที่อ่านได้ กรุณาตรวจการเข้าสู่ระบบร้านแล้วเปิดตั้งค่าอีกครั้ง';
  for(const item of merged.values()){
    const card=document.createElement('section');card.className='card';const heading=document.createElement('h2');heading.textContent=item.productName || item.productId;card.append(heading);
    const label=document.createElement('label');const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=(config.catalog || []).some(x=>String(x.productId)===String(item.productId));label.append(enabled,document.createTextNode('เปิดใช้งานสินค้านี้'));card.append(label);
    const productId=field('รหัสสินค้า',item.productId), productName=field('ชื่อสินค้า',item.productName), mapId=field('รหัสแมพ',item.mapId), mapName=field('ชื่อแมพ',item.mapName), placeId=field('Place ID',item.placeId);
    for(const f of [productId,productName,mapId,mapName,placeId]) card.append(f.wrap);
    const operator=field('User ID บัญชีของคุณใน RAM',item.operatorUserId);operator.input.setAttribute('list',`accounts-${rows.length}`);const list=document.createElement('datalist');list.id=`accounts-${rows.length}`;for(const account of accounts){const option=document.createElement('option');option.value=String(account.userId);option.label=[account.username,account.alias].filter(Boolean).join(' · ');list.append(option);}card.append(operator.wrap,list);
    $('products').append(card);rows.push({enabled,productId,productName,mapId,mapName,placeId,operator});
  }
}
$('form').addEventListener('submit',async e=>{e.preventDefault();const catalog=rows.filter(r=>r.enabled.checked).map(r=>({productId:r.productId.input.value.trim(),productName:r.productName.input.value.trim(),mapId:r.mapId.input.value.trim(),mapName:r.mapName.input.value.trim(),placeId:r.placeId.input.value.trim(),operatorUserId:r.operator.input.value.trim()}));if(!catalog.length){$('result').textContent='กรุณาเลือกอย่างน้อยหนึ่งสินค้า';return;}try{const reply=await send('UI_OPTIONS_SAVE',{version:1,shopOrigin:'https://bewpakorn.rdcw.xyz',catalog});$('result').textContent=reply.ok?'บันทึกแล้ว':'ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจทุกช่อง';}catch{$('result').textContent='บันทึกไม่ได้ กรุณาลองอีกครั้ง';}});
init().catch(()=>{$('result').textContent='โหลดการตั้งค่าไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วเปิดหน้านี้ใหม่';});
