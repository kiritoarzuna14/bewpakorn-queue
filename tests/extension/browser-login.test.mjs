import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, copyFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const event = () => {
  const listeners = [];
  return {
    addListener: f => listeners.push(f),
    emit: (...args) => listeners.map(f => f(...args))
  };
};

test('browser login flow: opens Chrome login tab, keeps password transient, detects mismatch, captures matching cookie, clears Chrome cookie, and supports game launch', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'queue-browser-login-'));
  try {
    for (const file of ['worker.js', 'native.js', 'notifications.js', 'messages.js', 'package.json']) {
      await copyFile(new URL(`../../extension/${file}`, import.meta.url), join(folder, file));
    }
    await writeFile(join(folder, 'shop.js'), `
      export const readOrderMetadata = async () => ({});
      export const defaultCatalog = async () => [];
      export const discoverCatalog = async () => [];
      export const scanOrders = async () => [{shopId:'bewpakorn.rdcw.xyz',orderId:'ord1',productId:'p1',productName:'Unit',mapId:'cameraman',mapName:'Cameraman',placeId:'132929771812494',operatorUserId:'999',createdAt:'2026-11-20T00:00:00Z'}];
      export const openAndReadOrder = async () => ({username:'cust_demo',password:'TOP_SECRET_PW'});
    `);
    await writeFile(join(folder, 'queue.js'), `
      export const operatorPool = p => p.operatorUserIds || (p.operatorUserId ? [p.operatorUserId] : []);
      export const validateCatalog = () => true;
      export const selectPending = x => x;
    `);

    const calls = [];
    const broadcasts = [];
    const tabs = new Map();
    let nextTabId = 10;
    let activeCookie = null;
    const removedCookies = [];
    const cookieChanged = event();
    const messages = event();
    const storage = {config: {version: 1, shopOrigin: 'https://bewpakorn.rdcw.xyz', catalog: [{operatorUserId: '999'}]}};
    let current = null, revision = 1;

    const port = {
      onMessage: event(),
      onDisconnect: event(),
      postMessage(m) {
        calls.push(structuredClone(m));
        queueMicrotask(() => {
          let payload;
          if (m.type === 'GET_CAPABILITIES') {
            payload = {loginOnly: true, accountSelection: true, undoLast: true, ramImportSupported: true, browserLogin: true, customerGameLaunch: true};
          } else if (m.type === 'CLAIM_ORDER') {
            current = {
              jobId: 'job1', generation: 1, completionToken: 'tok1', state: 'preparing',
              order: m.payload.order,
              customer: {source: 'order', username: '', state: 'waiting'},
              operator: {source: 'ram', userId: '999', username: 'BewFNTH2', state: 'ready'}
            };
            revision++;
            payload = {revision, current, handled: []};
          } else if (m.type === 'PREPARE_CUSTOMER') {
            assert.equal(m.payload.mode, 'browser');
            assert.equal(m.payload.password, undefined);
            current.order.customerUsername = m.payload.username;
            current.customer = {source: 'order', username: m.payload.username, state: 'preparing', loginMode: 'browser'};
            revision++;
            payload = {revision, current, handled: []};
          } else if (m.type === 'IMPORT_BROWSER_SESSION') {
            if (m.payload.cookie === 'WRONG_ACCOUNT_COOKIE') {
              payload = {matched: false, imported: false, canClearBrowserCookie: false, code: 'CUSTOMER_ID_MISMATCH', actualUsername: 'other_user', snapshot: {revision, current, handled: []}};
            } else if (m.payload.cookie === 'GOOD_CUSTOMER_COOKIE') {
              current.customer = {source: 'order', username: 'cust_demo', userId: '555', state: 'ready', loginMode: 'browser', game: {state: 'launched', placeId: '132929771812494', mode: 'private'}};
              current.state = 'ready';
              revision++;
              payload = {matched: true, imported: true, canClearBrowserCookie: true, userId: '555', username: 'cust_demo', snapshot: {revision, current, handled: []}};
            }
          } else if (m.type === 'SYNC_RAM_CUSTOMER') {
            payload = {synced: false, snapshot: {revision, current, handled: []}};
          } else if (m.type === 'LAUNCH_CUSTOMER_GAME') {
            current.customer.game = {state: 'launched', placeId: '132929771812494', mode: m.payload.mode};
            revision++;
            payload = {revision, current, handled: []};
          } else if (m.type === 'GET_ACCOUNT_METADATA') {
            payload = {accounts: [{userId: '999', username: 'BewFNTH2'}, {userId: '555', username: 'cust_demo'}]};
          } else {
            payload = {revision, current, handled: []};
          }
          port.onMessage.emit(structuredClone({v: 1, id: m.id, type: 'RESULT', ok: true, payload}));
        });
      }
    };

    globalThis.chrome = {
      runtime: {
        id: 'test',
        getURL: p => `chrome-extension://test/${p}`,
        connectNative: () => port,
        onMessage: messages,
        sendMessage: async msg => { broadcasts.push(structuredClone(msg)); }
      },
      storage: {
        local: {
          get: async k => ({[k]: storage[k]}),
          set: async x => Object.assign(storage, x),
          remove: async k => { delete storage[k]; }
        }
      },
      notifications: {create: async () => {}},
      action: {setBadgeText: async () => {}, onClicked: event()},
      sidePanel: {open: async () => {}},
      tabs: {
        create: async opts => { const t = {id: nextTabId++, windowId: 1, active: Boolean(opts.active), url: opts.url}; tabs.set(t.id, t); return t; },
        get: async id => { if (!tabs.has(id)) throw Error('missing'); return tabs.get(id); },
        query: async () => [...tabs.values()],
        update: async (id, patch) => { const t = tabs.get(id); Object.assign(t, patch); return t; }
      },
      windows: {update: async () => {}},
      cookies: {
        onChanged: cookieChanged,
        get: async () => activeCookie ? structuredClone(activeCookie) : null,
        getAll: async () => activeCookie ? [structuredClone(activeCookie)] : [],
        remove: async details => { removedCookies.push(details); activeCookie = null; return details; }
      }
    };

    await import(pathToFileURL(join(folder, 'worker.js')));
    await new Promise(r => setTimeout(r, 20));
    const send = (type, payload) => new Promise(resolve => messages.emit({type, payload}, {id: 'test', url: 'chrome-extension://test/panel.html'}, resolve));

    // 1. Start order -> enters browser login mode and opens https://www.roblox.com/login
    const started = await send('UI_START');
    assert.equal(started.ok, true);
    assert.equal(started.payload.native.current.customer.loginMode, 'browser');
    assert.equal(tabs.size, 1);
    const loginTab = [...tabs.values()][0];
    assert.equal(loginTab.url, 'https://www.roblox.com/login');
    assert.equal(loginTab.active, true);
    // Password must never leak into broadcasts or storage
    assert.equal(JSON.stringify(broadcasts).includes('TOP_SECRET_PW'), false);
    assert.equal(JSON.stringify(storage).includes('TOP_SECRET_PW'), false);

    // 2. Side Panel can explicitly request credentials for 1-click Copy
    const creds = await send('UI_COPY_CREDENTIALS', {jobId: 'job1', generation: 1});
    assert.equal(creds.ok, true);
    assert.deepEqual(creds.payload, {username: 'cust_demo', password: 'TOP_SECRET_PW'});

    // 3. Wrong account cookie sets browserNotice and does NOT delete Chrome's cookie
    activeCookie = {name: '.ROBLOSECURITY', value: 'WRONG_ACCOUNT_COOKIE', domain: '.roblox.com', path: '/', storeId: '0'};
    cookieChanged.emit({removed: false, cookie: activeCookie});
    await new Promise(r => setTimeout(r, 220));
    const afterWrong = await send('UI_GET');
    assert.equal(afterWrong.payload.browserNotice?.code, 'CUSTOMER_ID_MISMATCH');
    assert.equal(afterWrong.payload.browserNotice?.actualUsername, 'other_user');
    assert.equal(removedCookies.length, 0);

    // 4. User clicks Clear Chrome Cookie -> removes cookie & clears notice
    const cleared = await send('UI_CLEAR_ROBLOX_COOKIE');
    assert.equal(cleared.ok, true);
    assert.equal(removedCookies.length, 1);
    assert.equal(cleared.payload.browserNotice, null);

    // 5. User signs into the matching customer account in Chrome -> imports, auto-launches game, clears Chrome cookie, resets tab to /login
    loginTab.url = 'https://www.roblox.com/home';
    activeCookie = {name: '.ROBLOSECURITY', value: 'GOOD_CUSTOMER_COOKIE', domain: '.roblox.com', path: '/', storeId: '0'};
    cookieChanged.emit({removed: false, cookie: activeCookie});
    await new Promise(r => setTimeout(r, 220));
    const afterGood = await send('UI_GET');
    assert.equal(afterGood.payload.native.current.customer.state, 'ready');
    assert.equal(afterGood.payload.native.current.customer.game.state, 'launched');
    assert.equal(afterGood.payload.native.current.customer.game.mode, 'private');
    assert.equal(removedCookies.length, 2);
    assert.equal(loginTab.url, 'https://www.roblox.com/login');

    // 6. Manual relaunch in public mode forwards cleanly to native host
    const relaunched = await send('UI_LAUNCH_GAME', {jobId: 'job1', generation: 1, mode: 'public'});
    assert.equal(relaunched.ok, true);
    assert.equal(relaunched.payload.native.current.customer.game.mode, 'public');
    assert.ok(calls.some(c => c.type === 'LAUNCH_CUSTOMER_GAME' && c.payload.mode === 'public'));
  } finally {
    delete globalThis.chrome;
    await rm(folder, {recursive: true, force: true});
  }
});
