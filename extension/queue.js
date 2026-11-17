export const SHOP_ID = 'bewpakorn.rdcw.xyz';
export const SHOP_ORIGIN = `https://${SHOP_ID}`;
export const MAPS = Object.freeze([
  {mapId: 'cameraman', mapName: 'Cameraman Tower Defense', categoryId: 'cmv3w3yc802ha01nv1rbvsl9t', placeId: '132929771812494'},
  {mapId: 'mm2', mapName: 'Murder Mystery 2', categoryId: 'cmp8nyhvu06vr49d4p6i3i9is', placeId: '142823291'},
  {mapId: 'skibidi', mapName: 'Skibidi Tower Defense', categoryId: 'clvsc0q6s029918ackscshlwi', placeId: '15444929588'}
]);

export function fault(code) { return Object.assign(new Error(code), {code}); }
const validId = v => typeof v === 'string' && /^[a-z0-9]{10,80}$/.test(v);
const validUserId = v => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v);
export function operatorPool(item) {
  if (!item || typeof item !== 'object') throw fault('CONFIG_INVALID');
  if (item.operatorUserIds !== undefined) {
    const pool = item.operatorUserIds;
    if (!Array.isArray(pool) || pool.length > 20 || pool.some(id => !validUserId(id)) || new Set(pool).size !== pool.length) throw fault('CONFIG_INVALID');
    return [...pool];
  }
  if (item.operatorUserId === '' || item.operatorUserId === undefined) return [];
  if (!validUserId(item.operatorUserId)) throw fault('CONFIG_INVALID');
  return [item.operatorUserId];
}
export function validateCatalog(config) {
  if (!config || config.version !== 1 || config.shopOrigin !== SHOP_ORIGIN || !Array.isArray(config.catalog) || config.catalog.length > 2000) throw fault('CONFIG_INVALID');
  if (config.protectedOperatorUserIds !== undefined && (!Array.isArray(config.protectedOperatorUserIds) || config.protectedOperatorUserIds.length > 2000 || config.protectedOperatorUserIds.some(id => !validUserId(id)) || new Set(config.protectedOperatorUserIds).size !== config.protectedOperatorUserIds.length)) throw fault('CONFIG_INVALID');
  const ids = new Set();
  for (const p of config.catalog) {
    const map = MAPS.find(m => m.mapId === p.mapId);
    if (!map || !validId(p.productId) || ids.has(p.productId) || p.placeId !== map.placeId || typeof p.productName !== 'string' || !p.productName.trim() || p.productName.length > 300) throw fault('CONFIG_INVALID');
    // Older configurations still carry shop-account metadata. It is read only to
    // keep those accounts out of the customer role; nothing rotates or launches.
    if (p.operatorUserId !== undefined && p.operatorUserId !== '' && !validUserId(p.operatorUserId)) throw fault('CONFIG_INVALID');
    if (p.operatorUserIds !== undefined) operatorPool(p);
    if (p.privateServerSourceUserId !== undefined && !validUserId(p.privateServerSourceUserId)) throw fault('CONFIG_INVALID');
    ids.add(p.productId);
  }
  return true;
}

export function parseCreatedAt(value) {
  if (typeof value !== 'string') throw fault('ORDER_TIME_INVALID');
  // Server returns ISO UTC; the Thai fallback must carry an exact +07:00 zone.
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    const d = new Date(value);
    const date=value.slice(0,10), calendar=new Date(`${date}T00:00:00Z`);
    if (Number.isFinite(d.getTime()) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0,10)===date) return d.toISOString();
  }
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const match = /^(\d{1,2})\s+(\S+)\s+(\d{4})\s+เวลา\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (match) {
    const [, day, month, year, hour, minute] = match, mi = months.indexOf(month), y = Number(year) - 543;
    const stamp = Date.UTC(y, mi, Number(day), Number(hour) - 7, Number(minute));
    const check = new Date(stamp + 7 * 3600000);
    if (mi >= 0 && y >= 2000 && Number(hour) < 24 && Number(minute) < 60 && check.getUTCFullYear() === y && check.getUTCMonth() === mi && check.getUTCDate() === Number(day)) return new Date(stamp).toISOString();
  }
  throw fault('ORDER_TIME_INVALID');
}

export function compareOrders(a, b) { return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.orderId.localeCompare(b.orderId, 'en'); }
export function selectPending(orders, handled = []) {
  if (!Array.isArray(orders) || !Array.isArray(handled)) throw fault('QUEUE_INVALID');
  const done = new Set(handled.map(o => `${o.shopId}:${o.orderId}`));
  const seen = new Set();
  return orders.filter(o => {
    if (o.shopId !== SHOP_ID || !validId(o.orderId) || !validId(o.productId)) throw fault('QUEUE_INVALID');
    parseCreatedAt(o.createdAt);
    const key = `${o.shopId}:${o.orderId}`;
    if (seen.has(key)) throw fault('SCAN_CHANGED');
    seen.add(key);
    return !done.has(key) && (o.status === undefined || o.status === 'PROCESSING');
  }).sort(compareOrders);
}

export function normalizeOrder(row, catalog) {
  if (!row || !validId(row.id) || !['PROCESSING','COMPLETED','FAILED','CANCELLED','REFUNDED'].includes(row.status) || !validId(row.variant?.id) || !validId(row.variant?.productGroup?.category?.id)) throw fault('SHOP_API_CHANGED');
  const p = catalog.find(p => p.productId === row.variant?.id);
  if (!p || row.status !== 'PROCESSING') return null;
  const map = MAPS.find(m => m.mapId === p.mapId);
  if (row.variant?.productGroup?.category?.id !== map.categoryId || !validId(row.id)) throw fault('PRODUCT_IDENTITY_CHANGED');
  return {shopId: SHOP_ID, orderId: row.id, productId: p.productId, productName: p.productName, mapId: map.mapId, mapName: map.mapName, placeId: map.placeId, operatorUserId: p.operatorUserId, ...(p.operatorUserIds !== undefined ? {operatorUserIds: operatorPool(p)} : {}), ...(p.privateServerSourceUserId !== undefined ? {privateServerSourceUserId: p.privateServerSourceUserId} : {}), createdAt: parseCreatedAt(row.createdAt), customerUsername: '', quantity: null, status: 'PROCESSING', editUrl: `${SHOP_ORIGIN}/manager/orders/${row.id}/edit`};
}

export function readCredentialForm(detail, order) {
  const loginAllowed = detail && (detail.status === 'PROCESSING' || (order.revisit === true && detail.status === 'COMPLETED'));
  if (!detail || detail.id !== order.orderId || detail.variantId !== order.productId || !loginAllowed || detail.deletedAt !== null || parseCreatedAt(detail.createdAt) !== parseCreatedAt(order.createdAt) || !Array.isArray(detail.form)) throw fault('ORDER_CHANGED');
  const users = detail.form.filter(f => f.type === 'text' && f.placeholder === 'ID/ชื่อผู้ใช้' && f.required === true);
  const passes = detail.form.filter(f => (f.type === 'text' || f.type === 'password') && f.placeholder === 'รหัสผ่าน' && f.required === true);
  if (users.length !== 1 || passes.length !== 1 || typeof users[0].value !== 'string' || typeof passes[0].value !== 'string') throw fault('ORDER_FIELDS_INVALID');
  const username = users[0].value.trim(), password = passes[0].value;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || !password || password.length > 1024) throw fault('ORDER_FIELDS_INVALID');
  return {username, password};
}
