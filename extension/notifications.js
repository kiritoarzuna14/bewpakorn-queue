// Serialize read/modify/write so simultaneous blockers cannot erase each other.
export function createNotifier(chromeApi) {
  let chain = Promise.resolve();
  return (key, job, role, code) => {
    const task = chain.then(async () => {
      const stored = await chromeApi.storage.local.get('notifiedBlockers');
      const previous = stored.notifiedBlockers || [];
      if (previous.includes(key)) return;
      const roleName = role === 'customer' ? 'บัญชีลูกค้า' : role === 'operator' ? 'บัญชีของคุณ' : 'ออเดอร์';
      const username = role === 'customer' ? job.customer?.username : role === 'operator' ? job.operator?.username : '';
      await chromeApi.notifications.create(`block-${encodeURIComponent(key)}`, {type:'basic', iconUrl:'icon.png', title:'ออเดอร์ต้องตรวจสอบ', message:`#${job.order.orderId} · ${roleName} ${username || ''} · ${job.order.mapName || ''} · ${code}`});
      await chromeApi.storage.local.set({notifiedBlockers:[...previous, key]});
    });
    chain = task.catch(() => {});
    return task;
  };
}
