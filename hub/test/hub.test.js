'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHub } = require('../server');

async function start(config = {}, dataDir) {
  let now = 1_700_000_000_000;
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
  const hub = createHub({ dataDir: dir, config: { tables: 4, staffPin: '1234', nodeKey: 'nk', portalUrl: '', ...config }, clock: () => now });
  const port = await hub.listen(0, '127.0.0.1');
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const node = (p, body, key = 'nk') => call('POST', p, body, { 'x-key': key });
  const login = (await call('POST', '/api/staff/login', { pin: '1234' })).json.token;
  const staff = (p, body) => (body ? call('POST', p, body, { 'x-token': login }) : call('GET', p, null, { 'x-token': login }));
  return { hub, dir, call, node, staff, tick: (ms) => { now += ms; }, close: () => hub.close() };
}

test('button call: idempotent retries, ack, clear, response time recorded', async (t) => {
  const s = await start(); t.after(s.close);
  assert.equal((await s.node('/api/node/event', { t: 2, ev: 'call', id: 7 }, 'wrong')).status, 401);
  let r = await s.node('/api/node/event', { t: 2, ev: 'call', id: 7, rssi: -50, vcc: 3.3 });
  assert.deepEqual([r.json.ok, r.json.dup, r.json.st], [1, 0, 'call']);
  s.tick(5000);
  r = await s.node('/api/node/event', { t: 2, ev: 'call', id: 7 }); // retry after lost response
  assert.equal(r.json.dup, 1);
  const since = s.hub.state().tables[2].call.since;
  s.tick(20000);
  await s.staff('/api/staff/ack', { t: 2 });
  assert.equal((await s.node('/api/node/hb', { t: 2 })).json.st, 'ack');
  await s.staff('/api/staff/clear', { t: 2 });
  assert.equal((await s.node('/api/node/hb', { t: 2 })).json.st, 'idle');
  const h = s.hub.state().history.at(-1);
  assert.equal(h.ackAt - since, 25000);
});

test('bill upgrades a pending call and keeps the original wait time', async (t) => {
  const s = await start(); t.after(s.close);
  await s.node('/api/node/event', { t: 1, ev: 'call', id: 1 });
  const since = s.hub.state().tables[1].call.since;
  s.tick(8000);
  await s.node('/api/node/event', { t: 1, ev: 'bill', id: 2 });
  const c = s.hub.state().tables[1].call;
  assert.equal(c.type, 'bill'); assert.equal(c.since, since);
  await s.node('/api/node/event', { t: 1, ev: 'cancel', id: 3 });
  assert.equal(s.hub.state().tables[1].call, null);
});

test('guest needs the table key; orders use server prices; unavailable items are refused', async (t) => {
  const s = await start(); t.after(s.close);
  const k = s.hub.tableKey(3);
  assert.equal((await s.call('GET', '/api/table?t=3&k=zzzzzz')).status, 403);
  assert.equal((await s.call('GET', `/api/table?t=4&k=${k}`)).status, 403); // key of another table
  const o = await s.call('POST', '/api/guest/order', { t: 3, k, items: [{ id: 'm1', qty: 2, price: 0.01 }, { id: 'b2', qty: 1 }] });
  assert.equal(o.status, 200);
  const tv = (await s.call('GET', `/api/table?t=3&k=${k}`)).json;
  assert.equal(tv.total, 24); // 2 x 10.5 + 3.0
  assert.equal((await s.call('POST', '/api/guest/order', { t: 3, k, items: [{ id: 'nope', qty: 1 }] })).status, 400);
  assert.equal((await s.call('POST', '/api/guest/order', { t: 3, k, items: [{ id: 'm1', qty: 999 }] })).status, 400);
  await s.staff('/api/staff/avail', { id: 'm4', avail: false });
  const bad = await s.call('POST', '/api/guest/order', { t: 3, k, items: [{ id: 'm4', qty: 1 }] });
  assert.equal(bad.status, 409); assert.deepEqual(bad.json.unavailable, ['m4']);
});

test('kitchen flow, guest cancel window, bill and payment close the table', async (t) => {
  const s = await start(); t.after(s.close);
  const k = s.hub.tableKey(1);
  const o = (await s.call('POST', '/api/guest/order', { t: 1, k, items: [{ id: 'm2', qty: 1 }, { id: 'b3', qty: 1 }] })).json;
  assert.equal((await s.call('POST', '/api/guest/order/cancel', { t: 1, k, oid: o.id })).status, 200); // still 'new'
  const o2 = (await s.call('POST', '/api/guest/order', { t: 1, k, items: [{ id: 'm2', qty: 1 }, { id: 'b3', qty: 2 }] })).json;
  await s.staff('/api/staff/item', { oid: o2.id, idx: 0 });           // new -> prep
  assert.equal((await s.call('POST', '/api/guest/order/cancel', { t: 1, k, oid: o2.id })).status, 409);
  await s.staff('/api/staff/item', { oid: o2.id, idx: 0 });           // prep -> ready
  let st = (await s.staff('/api/staff/state')).json;
  assert.equal(st.tables.find((x) => x.t === 1).status, 'ready');
  await s.staff('/api/staff/bump', { oid: o2.id, to: 'served' });
  assert.equal((await s.call('POST', '/api/guest/pay', { t: 1, k, method: 'card' })).status, 200);
  st = (await s.staff('/api/staff/state')).json;
  const tv = st.tables.find((x) => x.t === 1);
  assert.equal(tv.status, 'bill'); assert.equal(tv.payReq, 'card'); assert.equal(tv.total, 13.5 + 9);
  await s.staff('/api/staff/paid', { t: 1 });
  st = (await s.staff('/api/staff/state')).json;
  assert.equal(st.tables.find((x) => x.t === 1).status, 'free');
  assert.equal(st.stats.salesToday, 22.5);
});

test('confirmOrders holds guest orders until a waiter confirms', async (t) => {
  const s = await start({ confirmOrders: true }); t.after(s.close);
  const k = s.hub.tableKey(2);
  const o = (await s.call('POST', '/api/guest/order', { t: 2, k, items: [{ id: 'b1', qty: 1 }] })).json;
  assert.equal(s.hub.state().orders[0].items[0].st, 'held');
  await s.staff('/api/staff/confirm', { oid: o.id });
  assert.equal(s.hub.state().orders[0].items[0].st, 'new');
});

test('staff endpoints need the PIN token; login is throttled', async (t) => {
  const s = await start(); t.after(s.close);
  assert.equal((await s.call('GET', '/api/staff/state')).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/api/staff/login', { pin: 'x' })).status, 401);
  assert.equal((await s.call('POST', '/api/staff/login', { pin: '1234' })).status, 429);
});

test('state survives a restart: a pending call is not lost', async (t) => {
  const a = await start();
  await a.node('/api/node/event', { t: 3, ev: 'call', id: 1 });
  await a.close();
  const b = await start({}, a.dir); t.after(b.close);
  assert.equal(b.hub.state().tables[3].call.type, 'call');
  assert.equal((await b.node('/api/node/hb', { t: 3 })).json.st, 'call');
});

test('node offline detection and captive-portal redirect', async (t) => {
  const s = await start({ nodeOfflineSec: 30 }); t.after(s.close);
  await s.node('/api/node/hb', { t: 1 });
  assert.equal((await s.staff('/api/staff/state')).json.tables[0].node.online, true);
  s.tick(31000);
  assert.equal((await s.staff('/api/staff/state')).json.tables[0].node.online, false);
  const s2 = await start({ portalUrl: 'http://192.168.50.1' }); t.after(s2.close);
  const r = await new Promise((resolve) => require('http').get({ host: '127.0.0.1', port: s2.hub.server.address().port, path: '/generate_204', headers: { host: 'connectivitycheck.gstatic.com' } }, resolve));
  assert.equal(r.statusCode, 302); assert.equal(r.headers.location, 'http://192.168.50.1');
  r.resume();
});
