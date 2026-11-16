const $ = id => document.getElementById(id);
const labels = {waiting:'รอเตรียม',preparing:'กำลังเตรียม',ready:'ล็อกอินแล้ว',blocked:'ต้องตรวจสอบ'};
const problems = {SETUP_REQUIRED:'กรุณาตั้งค่าและจับคู่บัญชีก่อนเริ่ม',NATIVE_DISCONNECTED:'ยังเชื่อมต่อตัวเชื่อมในเครื่องไม่ได้',NATIVE_TIMEOUT:'ตัวเชื่อมตอบกลับช้า กรุณาตรวจสอบการเชื่อมต่อ',ORDER_CREDENTIALS_MISSING:'อ่านข้อมูลบัญชีลูกค้าไม่ครบ กรุณาตรวจหน้าออเดอร์',RECOVERY_REQUIRED:'งานเดิมต้องตรวจสอบหลังเปิดระบบใหม่',UNKNOWN_ERROR:'ตรวจสอบรายละเอียดงานและลองอีกครั้ง'};
let visible = null, locked = false, armedAt = 0, previous = '', latestState = null;
const send = (type,payload) => chrome.runtime.sendMessage({type,payload});
function render(s) {
  latestState=s;
  const j=s.native?.current; const identity=j ? `${j.jobId}:${j.generation}:${j.completionToken}` : '';
  if (identity !== previous) { previous=identity; armedAt=Date.now()+800; setTimeout(()=> { if (previous===identity && latestState) render(latestState); }, 810); }
  visible=j ? {jobId:j.jobId, orderId:j.order.orderId,generation:j.generation,completionToken:j.completionToken} : null;
  $('connection').textContent=s.connection==='connected'?'เชื่อมต่อแล้ว':'ยังไม่เชื่อมต่อ';
  $('order-id').textContent=j ? `#${j.order.orderId}` : '';
  const details=$('order-details'); details.replaceChildren();
  if (j) { const strong=document.createElement('strong'); strong.textContent=j.order.mapName || 'แมพ'; details.append(strong,document.createElement('br'),document.createTextNode(`${j.order.productName || 'สินค้า'} · จำนวน ${j.order.quantity ?? '—'}`),document.createElement('br'),document.createTextNode(j.order.createdAt || '')); }
  else details.textContent=s.phase==='empty'?'คิวครบแล้ว':s.phase==='scanning'?'กำลังอ่านคิว':s.configured?'กดไอคอนส่วนขยายเพื่อเริ่มรอบงาน':'เริ่มจากตั้งค่าและจับคู่บัญชี';
  for (const role of ['customer','operator']) { const r=j?.[role]; $(`${role}-name`).textContent=r?.username || (role==='customer'?j?.order.customerUsername:'') || '—'; $(`${role}-state`).textContent=labels[r?.state] || 'รอออเดอร์'; }
  const code=s.issue || j?.code || j?.customer?.code || j?.operator?.code; $('issue').hidden=!code; $('issue').textContent=code ? `${problems[code] || 'งานนี้ต้องตรวจสอบ'} (${code})` : '';
  $('complete').disabled=!j || locked || s.connection!=='connected' || Date.now()<armedAt;
  $('queue-count').textContent=s.queue?.length ? `รออีก ${s.queue.length}` : '';
  $('queue-list').replaceChildren(...(s.queue || []).slice(0,5).map(o=>{const li=document.createElement('li');li.textContent=`${o.mapName || 'แมพ'} · ${o.productName || 'สินค้า'}`;return li;}));
}
$('complete').addEventListener('keydown',e=>{if(e.repeat && (e.key==='Enter'||e.key===' ')) e.preventDefault();});
$('complete').addEventListener('click',async e=>{if(locked || !visible || Date.now()<armedAt || e.detail>1) return; locked=true; $('complete').disabled=true; const identity={...visible}; try { const r=await send('UI_COMPLETE',identity); if(r.ok) render(r.payload); else { $('issue').hidden=false; $('issue').textContent=`ไม่สามารถจบงานได้ (${r.error.code})`; } } catch { $('issue').hidden=false; $('issue').textContent='ขาดการเชื่อมต่อ กำลังรอผลคำสั่งเดิม'; } finally { locked=false; setTimeout(()=>send('UI_GET').then(r=>r.ok&&render(r.payload)).catch(()=>{}),850); }});
chrome.runtime.onMessage.addListener(m=>{if(m.type==='UI_STATE') render(m.payload);});
send('UI_GET').then(r=>{if(r.ok) render(r.payload);}).catch(()=>{ $('connection').textContent='ยังไม่เชื่อมต่อ'; });
