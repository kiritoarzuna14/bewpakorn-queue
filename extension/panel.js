import {problems} from './messages.js';
const $ = id => document.getElementById(id);
const labels = {waiting: 'รอเตรียม', preparing: 'กำลังล็อกอิน', ready: 'พร้อมใช้งานใน RAM', blocked: 'ต้องตรวจสอบ'};
let visible = null, locked = false, armedAt = 0, previous = '', latestState = null, savedAccounts = [];
const selectionIdentity = {};
const send = (type, payload) => chrome.runtime.sendMessage({type, payload});
const legacyCode = code => /^(PAIR_|PRIVATE_TARGET_)/.test(code || '');

function displayDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short'}).format(date) : 'ไม่ทราบเวลา';
}

function selector(role, job, disabled) {
  const select = $(`${role}-account`), data = job?.[role];
  select.replaceChildren();
  const add = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  };
  if (role === 'customer') add('order', `บัญชีในออเดอร์${job?.order.customerUsername ? ` · ${job.order.customerUsername}` : ''}`);
  else add('', 'เลือกบัญชีใน RAM');
  for (const account of savedAccounts) add(`ram:${account.userId}`, `${account.username || 'บัญชี RAM'} · ${account.userId}`);
  const selected = data?.source === 'ram' || role === 'operator' ? (data?.userId ? `ram:${data.userId}` : '') : 'order';
  if (selected.startsWith('ram:') && !savedAccounts.some(a => `ram:${a.userId}` === selected)) add(selected, `${data.username || 'บัญชี RAM'} · ${data.userId}`);
  select.value = selected;
  select.disabled = disabled || !job;
}

function customerStatusLabel(data) {
  if (!data) return 'รอออเดอร์';
  if (data.state === 'preparing' && data.loginMode === 'browser') return 'รอล็อกอินใน Chrome';
  if (data.state === 'ready' && data.game?.state === 'launching') return 'นำเข้า RAM แล้ว · กำลังเข้าเกม...';
  if (data.state === 'ready' && data.game?.state === 'launched') return data.game.mode === 'private' ? 'เข้าเกมแล้ว (VIP Server)' : 'เข้าเกมแล้ว (Public Server)';
  return labels[data.state] || 'รอออเดอร์';
}

function render(s) {
  latestState = s;
  if (Array.isArray(s.accounts)) savedAccounts = s.accounts;
  const j = s.native?.current, target = s.native?.historyTarget || s.native?.handled?.at(-1);
  const identity = j ? `${j.jobId}:${j.generation}:${j.completionToken}` : '';
  if (identity !== previous) {
    previous = identity;
    armedAt = Date.now() + 800;
    setTimeout(() => { if (previous === identity && latestState) render(latestState); }, 810);
  }
  visible = j ? {jobId: j.jobId, orderId: j.order.orderId, generation: j.generation, completionToken: j.completionToken} : null;
  $('connection').textContent = s.connection === 'connected' ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ';
  $('order-id').textContent = j ? `#${j.order.orderId}` : '';
  const details = $('order-details');
  details.replaceChildren();
  if (j) {
    const strong = document.createElement('strong');
    strong.textContent = j.order.mapName || 'แมพ';
    details.append(strong, document.createElement('br'), document.createTextNode(`${j.order.productName || 'สินค้า'} · จำนวน ${j.order.quantity ?? 'ดูในออเดอร์'}`), document.createElement('br'), document.createTextNode(displayDate(j.order.createdAt)));
  } else {
    details.textContent = s.phase === 'empty' ? 'คิวครบแล้ว' : s.phase === 'scanning' ? 'กำลังอ่านคิว' : s.configured ? 'กดไอคอนส่วนขยายเพื่อเริ่มรอบงาน' : 'เริ่มจากตั้งค่าและจับคู่บัญชี';
  }
  const disabled = locked || s.completionPending || s.mutationPending || s.connection !== 'connected';
  for (const role of ['customer', 'operator']) {
    const data = j?.[role];
    $(`${role}-name`).textContent = data?.username || (role === 'customer' ? j?.order.customerUsername : '') || '—';
    $(`${role}-state`).textContent = role === 'customer' ? customerStatusLabel(data) : (labels[data?.state] || 'รอออเดอร์');
    selector(role, j, disabled);
  }

  // Browser login controls
  const cust = j?.customer;
  const showBrowserTools = Boolean(j && cust?.source !== 'ram' && cust?.state === 'preparing' && cust?.loginMode === 'browser');
  $('browser-tools').hidden = !showBrowserTools;
  for (const id of ['auto-fill', 'open-roblox', 'copy-user', 'copy-pass', 'check-login']) {
    $(id).disabled = disabled || !showBrowserTools;
  }

  // Wrong browser account notice
  const notice = s.browserNotice;
  const showNotice = Boolean(showBrowserTools && notice?.code === 'CUSTOMER_ID_MISMATCH');
  $('browser-notice').hidden = !showNotice;
  if (showNotice) {
    $('browser-notice-text').textContent = `ใน Chrome ล็อกอินเป็น "${notice.actualUsername || 'บัญชีอื่น'}" ไม่ตรงกับออเดอร์ (${notice.expectedUsername || cust?.username || ''}) — กดปุ่มด้านล่างเพื่อล้างคุกกี้ Chrome แล้วล็อกอินใหม่`;
    $('clear-cookie').disabled = disabled;
  }

  // Game launch box (shown once customer is ready in RAM)
  const showGameBox = Boolean(j && cust?.state === 'ready');
  const gameBox = $('game-box');
  gameBox.hidden = !showGameBox;
  if (showGameBox) {
    const g = cust.game;
    const failed = g?.state === 'failed';
    gameBox.classList.toggle('failed', failed);
    if (g?.state === 'launching') {
      $('game-status').textContent = `กำลังเปิดเกม Roblox (Place ${g.placeId || j.order.placeId || ''})...`;
    } else if (g?.state === 'launched') {
      const serverLabel = g.mode === 'private' ? 'VIP Private Server' : 'Public Server';
      $('game-status').textContent = `เด้งเปิดเกมแล้ว · ${serverLabel} (Place ${g.placeId || j.order.placeId || ''})`;
    } else if (failed) {
      $('game-status').textContent = `${problems[g.code] || 'เปิดเกมไม่สำเร็จ'} (${g.code || 'GAME_LAUNCH_UNAVAILABLE'})`;
    } else {
      $('game-status').textContent = `บัญชีลูกค้าพร้อมใน RAM แล้ว · Place ${j.order.placeId || '-'}`;
    }
    const launching = g?.state === 'launching';
    $('launch-game').textContent = g?.state === 'launched' ? 'เปิดเกมอีกครั้ง' : 'เปิดเกมเข้าแมพเลย';
    $('launch-game').disabled = disabled || launching;
    const showPublicFallback = Boolean(failed && g?.mode === 'private');
    $('launch-public').hidden = !showPublicFallback;
    $('launch-public').disabled = disabled || launching;
  }

  const code = [s.issue, j?.code, j?.customer?.code, j?.operator?.code].find(c => c && !legacyCode(c));
  $('issue').hidden = !code;
  $('issue').textContent = j?.customer?.canResume ? 'ออเดอร์เดิมยังอยู่ กดไอคอนส่วนขยายเพื่อเตรียมงานนี้ต่อได้' : code ? `${problems[code] || 'งานนี้ต้องตรวจสอบ'} (${code})` : '';
  $('complete').disabled = !j || disabled || Date.now() < armedAt;
  $('undo').disabled = !(s.native?.canUndo ?? Boolean(target)) || disabled;
  $('undo').dataset.target = target?.orderId || '';
  $('queue-count').textContent = s.queue?.length ? `รออีก ${s.queue.length}` : '';
  $('queue-list').replaceChildren(...(s.queue || []).slice(0, 5).map(o => {
    const li = document.createElement('li');
    li.textContent = `${o.mapName || 'แมพ'} · ${o.productName || 'สินค้า'}`;
    return li;
  }));
}

async function mutate(type, payload) {
  if (locked) return;
  locked = true;
  let failure = '';
  if (latestState) render(latestState);
  try {
    const r = await send(type, payload);
    if (r.ok) render(r.payload);
    else failure = problems[r.error.code] || `ทำรายการไม่ได้ (${r.error.code})`;
  } catch {
    failure = 'ขาดการเชื่อมต่อ กำลังรอผลคำสั่งเดิม';
  } finally {
    locked = false;
    if (latestState) render(latestState);
    if (failure) {
      $('issue').hidden = false;
      $('issue').textContent = failure;
    }
    setTimeout(() => send('UI_GET').then(r => r.ok && render(r.payload)).catch(() => {}), 850);
  }
}

async function copyField(field, buttonId, defaultLabel) {
  if (!visible) return;
  const btn = $(buttonId);
  btn.disabled = true;
  try {
    let value = field === 'username' ? (latestState?.native?.current?.customer?.username || latestState?.native?.current?.order?.customerUsername || '') : '';
    if (!value) {
      const res = await send('UI_COPY_CREDENTIALS', {jobId: visible.jobId, generation: visible.generation});
      if (!res?.ok || !res.payload?.[field]) {
        $('issue').hidden = false;
        $('issue').textContent = problems[res?.error?.code] || 'คัดลอกข้อมูลไม่ได้';
        return;
      }
      value = res.payload[field];
    }
    await navigator.clipboard.writeText(value);
    btn.textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => { btn.textContent = defaultLabel; }, 1500);
  } catch {
    $('issue').hidden = false;
    $('issue').textContent = 'คัดลอกไปยังคลิปบอร์ดไม่สำเร็จ กรุณาคลิกในแผงแล้วลองใหม่';
  } finally {
    btn.disabled = false;
  }
}

$('auto-fill').addEventListener('click', () => { if (!locked) mutate('UI_AUTO_FILL_LOGIN', {}); });
$('open-roblox').addEventListener('click', () => { send('UI_OPEN_ROBLOX_LOGIN').catch(() => {}); });
$('copy-user').addEventListener('click', () => { copyField('username', 'copy-user', 'คัดลอกชื่อ'); });
$('copy-pass').addEventListener('click', () => { copyField('password', 'copy-pass', 'คัดลอกรหัส'); });
$('check-login').addEventListener('click', () => { if (!locked) mutate('UI_CHECK_BROWSER_LOGIN', {}); });
$('clear-cookie').addEventListener('click', () => { if (!locked) mutate('UI_CLEAR_ROBLOX_COOKIE', {}); });
$('launch-game').addEventListener('click', () => { if (!locked && visible) mutate('UI_LAUNCH_GAME', {jobId: visible.jobId, generation: visible.generation, mode: 'auto'}); });
$('launch-public').addEventListener('click', () => { if (!locked && visible) mutate('UI_LAUNCH_GAME', {jobId: visible.jobId, generation: visible.generation, mode: 'public'}); });

$('complete').addEventListener('keydown', e => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
$('complete').addEventListener('click', e => { if (locked || !visible || Date.now() < armedAt || e.detail > 1) return; mutate('UI_COMPLETE', {...visible}); });
$('undo').addEventListener('click', e => { if (locked || e.detail > 1 || $('undo').disabled) return; mutate('UI_UNDO', {...visible, expectedLastOrderId: $('undo').dataset.target}); });
for (const role of ['customer', 'operator']) {
  const select = $(`${role}-account`);
  for (const event of ['pointerdown', 'focus', 'keydown']) select.addEventListener(event, () => { selectionIdentity[role] = visible ? {...visible} : null; });
  select.addEventListener('change', e => {
    if (locked || !visible || e.target.disabled) return;
    const value = e.target.value;
    if (!value) return;
    const identity = selectionIdentity[role] || {...visible};
    delete selectionIdentity[role];
    mutate('UI_SELECT_ACCOUNT', {...identity, role, source: value === 'order' ? 'order' : 'ram', ...(value.startsWith('ram:') ? {userId: value.slice(4)} : {})});
  });
}

chrome.runtime.onMessage.addListener(m => { if (m.type === 'UI_STATE') render(m.payload); });
send('UI_GET').then(r => { if (r.ok) render(r.payload); }).catch(() => { $('connection').textContent = 'ยังไม่เชื่อมต่อ'; });
send('UI_ACCOUNTS').then(r => { if (r.ok) { savedAccounts = r.payload.accounts || []; if (latestState) render({...latestState, accounts: savedAccounts}); } }).catch(() => {});
// The open panel reconciles existing commands without starting a new round.
setInterval(() => send('UI_GET').then(r => { if (r.ok) render(r.payload); }).catch(() => {}), 5000);
