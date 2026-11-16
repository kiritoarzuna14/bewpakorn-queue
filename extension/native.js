export class NativeClient {
  constructor(chromeApi, onSnapshot, onDisconnect, timeoutMs = 30000) {
    this.chrome = chromeApi; this.onSnapshot = onSnapshot; this.onDisconnect = onDisconnect;
    this.timeoutMs = timeoutMs; this.pending = new Map(); this.port = null; this.serial = 0;
  }
  connect() {
    if (this.port) return;
    const port = this.chrome.runtime.connectNative('com.bewpakorn.queue');
    this.port = port;
    port.onMessage.addListener(message => {
      if (message?.v !== 1) return;
      if (message.type === 'SNAPSHOT') { this.onSnapshot(message.payload); return; }
      if (message.type !== 'RESULT' || !this.pending.has(message.id)) return;
      const request = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(request.timer);
      if (message.ok === true) request.resolve(message.payload);
      else request.reject(Object.assign(new Error(message.error?.code || 'NATIVE_ERROR'), {kind:'application'}));
    });
    port.onDisconnect.addListener(() => this.close(port));
  }
  close(port) {
    if (this.port !== port) return;
    this.port = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('NATIVE_DISCONNECTED')); }
    this.pending.clear(); this.onDisconnect();
    try { port.disconnect?.(); } catch { /* already disconnected */ }
  }
  request(type, payload = {}) {
    this.connect();
    const id = `${Date.now()}-${++this.serial}`;
    return new Promise((resolve, reject) => {
      const port = this.port;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('NATIVE_TIMEOUT')); this.close(port); }, this.timeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      try { this.port.postMessage({v: 1, id, type, payload}); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('NATIVE_DISCONNECTED')); }
    });
  }
}
