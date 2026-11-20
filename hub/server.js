'use strict';
// Tablebell hub: waiter calls, bills, orders, kitchen/bar tickets. Node 18+, no npm packages.
//   node hub/server.js [--config hub/config.json] [--data hub/data] [--port 8080] [--demo]
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  restaurantName: 'Restaurant', port: 8080, tables: 12, currency: '€', staffPin: '',
  nodeKey: 'change-me-node-key', requireTableKey: true, confirmOrders: false,
  nodeOfflineSec: 45, portalUrl: 'http://192.168.50.1',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const PROBES = new Set(['/generate_204', '/gen_204', '/hotspot-detect.html', '/library/test/success.html', '/ncsi.txt', '/connecttest.txt', '/redirect', '/canonical.html', '/success.txt']);
const ITEM_NEXT = { held: 'new', new: 'prep', prep: 'ready', ready: 'served' };

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const isIp = (h) => /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h === 'localhost' || h.startsWith('[');

function createHub(opts = {}) {
  const clock = opts.clock || Date.now;
  const publicDir = opts.publicDir || path.join(__dirname, 'public');
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  let fileCfg = {};
  if (opts.configPath && fs.existsSync(opts.configPath)) fileCfg = JSON.parse(fs.readFileSync(opts.configPath, 'utf8'));
  const cfg = { ...DEFAULTS, ...fileCfg, ...(opts.config || {}) };
  const menu = JSON.parse(fs.readFileSync(opts.menuPath || path.join(__dirname, 'menu.json'), 'utf8'));
  const menuById = new Map(menu.items.map((i) => [i.id, i]));
  fs.mkdirSync(dataDir, { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');

  let state = { salt: '', tables: {}, orders: [], history: [], closed: [], avail: {}, nextOrder: 1 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { /* first run or damaged file: start fresh */ }
  if (!state.salt) state.salt = crypto.randomBytes(16).toString('hex');
  for (let t = 1; t <= cfg.tables; t++) state.tables[t] = state.tables[t] || { call: null, payReq: null, node: null };

  // ---- persistence: debounced atomic write ----
  let dirty = false, timer = null;
  const flush = () => {
    clearTimeout(timer); timer = null;
    if (!dirty) return;
    dirty = false;
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateFile);
  };
  const save = () => { dirty = true; if (!timer) { timer = setTimeout(flush, 400); timer.unref?.(); } };
  save();

  // ---- identity ----
  const hmac = (s) => crypto.createHmac('sha256', state.salt).update(s).digest('hex');
  const tableKey = (t) => hmac('table:' + t).slice(0, 6);
  const staffToken = () => hmac('staff:' + cfg.staffPin).slice(0, 32);
  const validTable = (t) => Number.isInteger(t) && state.tables[t];
  const guestOk = (t, k) => validTable(t) && (!cfg.requireTableKey || safeEq(k || '', tableKey(t)));

  // ---- domain ----
  const openOrders = (t) => state.orders.filter((o) => o.t === t);
  const liveItems = (o) => o.items.filter((i) => i.st !== 'cancelled');
  const lines = (t) => {
    const m = new Map();
    for (const o of openOrders(t)) for (const i of liveItems(o)) {
      const e = m.get(i.id) || { id: i.id, name: i.name, price: i.price, qty: 0 };
      e.qty += i.qty; m.set(i.id, e);
    }
    return [...m.values()];
  };
  const total = (t) => Math.round(lines(t).reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;

  function statusOf(t) {
    const T = state.tables[t];
    if (T.call) return T.call.ackAt ? 'acked' : T.call.type;
    const items = openOrders(t).flatMap(liveItems);
    if (items.some((i) => i.st === 'ready')) return 'ready';
    return items.length ? 'occupied' : 'free';
  }
  function nodeView(T) {
    if (!T.node) return null;
    return { online: clock() - T.node.seen < cfg.nodeOfflineSec * 1000, seen: T.node.seen, rssi: T.node.rssi, vcc: T.node.vcc, fw: T.node.fw };
  }
  const tableView = (t, forStaff) => {
    const T = state.tables[t];
    const v = {
      t, status: statusOf(t), call: T.call, payReq: T.payReq, total: total(t), lines: lines(t),
      orders: openOrders(t).map((o) => ({ id: o.id, at: o.at, by: o.by, note: o.note, items: o.items })),
    };
    if (forStaff) { v.node = nodeView(T); v.key = tableKey(t); }
    return v;
  };

  // Node LED state: what the button should show.
  const nodeState = (t) => {
    const c = state.tables[t].call;
    return !c ? 'idle' : c.ackAt ? 'ack' : c.type;
  };

  function raise(t, type, src) {
    const T = state.tables[t];
    const now = clock();
    if (!T.call || T.call.ackAt) { T.call = { type, since: now, ackAt: null, src }; }
    else if (type === 'bill' && T.call.type !== 'bill') { T.call.type = 'bill'; T.call.src = src; }
    save();
  }
  function endCall(t, reason) {
    const T = state.tables[t];
    const c = T.call;
    if (!c) return;
    state.history.push({ t, type: c.type, since: c.since, ackAt: c.ackAt, end: clock(), reason });
    if (state.history.length > 500) state.history.splice(0, state.history.length - 500);
    T.call = null; save();
  }

  function buildItems(list, by) {
    if (!Array.isArray(list) || !list.length || list.length > 30) return { err: 'bad_items' };
    const merged = new Map();
    for (const r of list) {
      const m = menuById.get(String(r && r.id));
      const qty = Number(r && r.qty);
      if (!m || !Number.isInteger(qty) || qty < 1 || qty > 20) return { err: 'bad_items' };
      merged.set(m.id, (merged.get(m.id) || 0) + qty);
    }
    const unavailable = [...merged.keys()].filter((id) => state.avail[id] === false);
    if (unavailable.length) return { err: 'unavailable', unavailable };
    const st = by === 'guest' && cfg.confirmOrders ? 'held' : 'new';
    return { items: [...merged].map(([id, qty]) => { const m = menuById.get(id); return { id, name: m.name, price: m.price, qty, station: m.station, st }; }) };
  }
  function placeOrder(t, list, note, by) {
    const r = buildItems(list, by);
    if (r.err) return r;
    const o = { id: state.nextOrder++, t, at: clock(), by, note: String(note || '').slice(0, 140), items: r.items };
    state.orders.push(o); save();
    return { order: o };
  }

  // ---- rate limits (in memory) ----
  const buckets = new Map();
  const limited = (key, max, windowMs) => {
    const now = clock();
    const b = (buckets.get(key) || []).filter((x) => now - x < windowMs);
    if (b.length >= max) { buckets.set(key, b); return true; }
    b.push(now); buckets.set(key, b); return false;
  };
  const seenIds = new Map(); // table -> recent node event ids

  // ---- http ----
  const send = (res, code, body, headers = {}) => {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    res.writeHead(code, { 'Cache-Control': 'no-store', 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > 16384) { reject(Object.assign(new Error('too_large'), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad_json'), { code: 400 })); } });
    req.on('error', reject);
  });
  const staffOk = (req) => !cfg.staffPin || safeEq(req.headers['x-token'] || '', staffToken());
  const failures = new Map();

  function staffState() {
    const now = clock();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const answered = state.history.filter((h) => h.ackAt && h.since >= todayStart);
    const avg = answered.length ? Math.round(answered.reduce((s, h) => s + (h.ackAt - h.since), 0) / answered.length / 1000) : null;
    const sold = state.closed.filter((c) => c.at >= todayStart);
    return {
      now, restaurant: cfg.restaurantName, currency: cfg.currency, confirmOrders: cfg.confirmOrders,
      tables: Object.keys(state.tables).map((t) => tableView(Number(t), true)),
      menu: menu.items.map((i) => ({ ...i, avail: state.avail[i.id] !== false })), categories: menu.categories,
      stats: { callsToday: answered.length, avgResponseSec: avg, salesToday: Math.round(sold.reduce((s, c) => s + c.total, 0) * 100) / 100, tablesPaid: sold.length },
    };
  }

  async function api(req, res, url) {
    const p = url.pathname, q = url.searchParams, M = req.method;
    const body = M === 'POST' ? await readJson(req) : {};
    const tNum = Number(body.t ?? q.get('t'));

    // --- table button nodes ---
    if (p.startsWith('/api/node/')) {
      if (!safeEq(req.headers['x-key'] || '', cfg.nodeKey)) return send(res, 401, { ok: 0, err: 'key' });
      if (M !== 'POST' || !validTable(tNum)) return send(res, 400, { ok: 0, err: 'table' });
      const T = state.tables[tNum];
      T.node = { seen: clock(), rssi: Number(body.rssi) || 0, vcc: Number(body.vcc) || 0, fw: String(body.fw || '').slice(0, 16) };
      if (p === '/api/node/event') {
        const ids = seenIds.get(tNum) || [];
        const dup = body.id !== undefined && ids.includes(body.id);
        if (!dup) {
          if (body.id !== undefined) { ids.push(body.id); if (ids.length > 64) ids.shift(); seenIds.set(tNum, ids); }
          if (body.ev === 'call' || body.ev === 'bill') raise(tNum, body.ev, 'node');
          else if (body.ev === 'cancel' && T.call && !T.call.ackAt) endCall(tNum, 'cancel');
          else if (body.ev !== 'cancel') return send(res, 400, { ok: 0, err: 'ev' });
        }
        save();
        return send(res, 200, { ok: 1, dup: dup ? 1 : 0, st: nodeState(tNum) });
      }
      if (p === '/api/node/hb') { save(); return send(res, 200, { ok: 1, st: nodeState(tNum), now: Math.floor(clock() / 1000) }); }
      return send(res, 404, { ok: 0 });
    }

    // --- guests (table number + key from the QR code) ---
    if (p.startsWith('/api/guest/') || p === '/api/table' || p === '/api/menu') {
      if (p === '/api/menu') {
        return send(res, 200, { restaurant: cfg.restaurantName, currency: cfg.currency, categories: menu.categories, items: menu.items.map((i) => ({ ...i, avail: state.avail[i.id] !== false })) });
      }
      const k = body.k ?? q.get('k');
      if (!guestOk(tNum, k)) return send(res, 403, { ok: 0, err: 'table' });
      if (p === '/api/table') {
        const v = tableView(tNum, false);
        return send(res, 200, { ...v, now: clock(), restaurant: cfg.restaurantName, currency: cfg.currency });
      }
      if (M !== 'POST') return send(res, 405, { ok: 0 });
      if (limited('g' + tNum, 30, 60000)) return send(res, 429, { ok: 0, err: 'slow_down' });
      const T = state.tables[tNum];
      if (p === '/api/guest/call') {
        if (body.type === 'call' || body.type === 'bill') raise(tNum, body.type, 'guest');
        else if (body.type === 'cancel' && T.call && !T.call.ackAt) endCall(tNum, 'cancel');
        else return send(res, 400, { ok: 0, err: 'type' });
        return send(res, 200, { ok: 1, table: tableView(tNum, false) });
      }
      if (p === '/api/guest/order') {
        const r = placeOrder(tNum, body.items, body.note, 'guest');
        if (r.err) return send(res, r.err === 'unavailable' ? 409 : 400, { ok: 0, ...r });
        return send(res, 200, { ok: 1, id: r.order.id, table: tableView(tNum, false) });
      }
      if (p === '/api/guest/order/cancel') {
        const o = openOrders(tNum).find((x) => x.id === Number(body.oid));
        if (!o || o.items.some((i) => i.st !== 'held' && i.st !== 'new' && i.st !== 'cancelled')) return send(res, 409, { ok: 0, err: 'in_progress' });
        o.items.forEach((i) => { i.st = 'cancelled'; }); save();
        return send(res, 200, { ok: 1, table: tableView(tNum, false) });
      }
      if (p === '/api/guest/order/qty') { // change quantity until the kitchen has started the item
        const o = openOrders(tNum).find((x) => x.id === Number(body.oid));
        const it = o && o.items[Number(body.idx)];
        const qty = Number(body.qty);
        if (!it || !Number.isInteger(qty) || qty < 0 || qty > 20) return send(res, 400, { ok: 0, err: 'bad_qty' });
        if (it.st !== 'held' && it.st !== 'new') return send(res, 409, { ok: 0, err: 'in_progress' });
        if (qty === 0) it.st = 'cancelled'; else it.qty = qty;
        save();
        return send(res, 200, { ok: 1, table: tableView(tNum, false) });
      }
      if (p === '/api/guest/pay') {
        if (!['cash', 'card', null].includes(body.method ?? null)) return send(res, 400, { ok: 0, err: 'method' });
        T.payReq = body.method ?? null;
        if (T.payReq) raise(tNum, 'bill', 'guest');
        save();
        return send(res, 200, { ok: 1, table: tableView(tNum, false) });
      }
      return send(res, 404, { ok: 0 });
    }

    // --- staff ---
    if (p === '/api/staff/login') {
      const ip = req.socket.remoteAddress;
      const f = failures.get(ip);
      if (f && f.until > clock()) return send(res, 429, { ok: 0, err: 'locked' });
      if (!cfg.staffPin || safeEq(body.pin || '', cfg.staffPin)) { failures.delete(ip); return send(res, 200, { ok: 1, token: cfg.staffPin ? staffToken() : '' }); }
      const n = (f ? f.n : 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? clock() + 60000 : 0 });
      return send(res, 401, { ok: 0, err: 'pin' });
    }
    if (p.startsWith('/api/staff/')) {
      if (!staffOk(req)) return send(res, 401, { ok: 0, err: 'auth' });
      if (p === '/api/staff/state') return send(res, 200, staffState());
      if (M !== 'POST') return send(res, 405, { ok: 0 });
      const needTable = () => { if (!validTable(tNum)) { send(res, 400, { ok: 0, err: 'table' }); return false; } return true; };
      const T = validTable(tNum) ? state.tables[tNum] : null;
      switch (p) {
        case '/api/staff/ack':
          if (!needTable()) return;
          if (T.call && !T.call.ackAt) { T.call.ackAt = clock(); save(); }
          break;
        case '/api/staff/clear':
          if (!needTable()) return;
          endCall(tNum, 'done');
          break;
        case '/api/staff/call': // waiter flags a table manually (e.g. guest waved)
          if (!needTable()) return;
          raise(tNum, body.type === 'bill' ? 'bill' : 'call', 'staff');
          break;
        case '/api/staff/order': {
          if (!needTable()) return;
          const r = placeOrder(tNum, body.items, body.note, 'waiter');
          if (r.err) return send(res, r.err === 'unavailable' ? 409 : 400, { ok: 0, ...r });
          break;
        }
        case '/api/staff/confirm': {
          const o = state.orders.find((x) => x.id === Number(body.oid));
          if (!o) return send(res, 404, { ok: 0 });
          o.items.forEach((i) => { if (i.st === 'held') i.st = 'new'; }); save();
          break;
        }
        case '/api/staff/item': { // advance (or set) one item's status
          const o = state.orders.find((x) => x.id === Number(body.oid));
          const it = o && o.items[Number(body.idx)];
          if (!it) return send(res, 404, { ok: 0 });
          const to = body.to || ITEM_NEXT[it.st];
          if (!['held', 'new', 'prep', 'ready', 'served', 'cancelled'].includes(to)) return send(res, 400, { ok: 0, err: 'status' });
          it.st = to; save();
          break;
        }
        case '/api/staff/qty': { // waiter: change quantity of a live item at any stage (0 = remove)
          const o = state.orders.find((x) => x.id === Number(body.oid));
          const it = o && o.items[Number(body.idx)];
          const qty = Number(body.qty);
          if (!it || it.st === 'cancelled') return send(res, 404, { ok: 0 });
          if (!Number.isInteger(qty) || qty < 0 || qty > 20) return send(res, 400, { ok: 0, err: 'bad_qty' });
          if (qty === 0) it.st = 'cancelled'; else it.qty = qty;
          save();
          break;
        }
        case '/api/staff/bump': { // set every live item of an order (optionally one station) to a status
          const o = state.orders.find((x) => x.id === Number(body.oid));
          if (!o) return send(res, 404, { ok: 0 });
          const to = body.to || 'ready';
          o.items.forEach((i) => { if (i.st !== 'cancelled' && i.st !== 'served' && (!body.station || i.station === body.station)) i.st = to; }); save();
          break;
        }
        case '/api/staff/paid': {
          if (!needTable()) return;
          const mine = openOrders(tNum);
          const sum = total(tNum);
          if (mine.length || T.payReq) state.closed.push({ t: tNum, at: clock(), total: sum, method: T.payReq || 'n/a', orders: mine.length });
          if (state.closed.length > 500) state.closed.splice(0, state.closed.length - 500);
          state.orders = state.orders.filter((o) => o.t !== tNum);
          T.payReq = null; endCall(tNum, 'paid'); save();
          break;
        }
        case '/api/staff/avail':
          if (!menuById.has(String(body.id))) return send(res, 404, { ok: 0 });
          state.avail[body.id] = body.avail !== false; save();
          break;
        default: return send(res, 404, { ok: 0 });
      }
      return send(res, 200, { ok: 1, state: staffState() });
    }
    return send(res, 404, { ok: 0 });
  }

  const PAGES = { '/': 'index.html', '/waiter': 'waiter.html', '/kitchen': 'kitchen.html', '/bar': 'kitchen.html' };
  function serveStatic(req, res, url) {
    const hostName = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!isIp(hostName) && hostName !== 'tablebell.local' && cfg.portalUrl) {
      // Captive-portal DNS sends every name here: bounce probes and strangers to the portal page.
      res.writeHead(302, { Location: cfg.portalUrl + (url.search || ''), 'Cache-Control': 'no-store' }); return res.end();
    }
    if (PROBES.has(url.pathname)) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end(); }
    const rel = PAGES[url.pathname] || url.pathname.slice(1);
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(302, { Location: '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch((e) => { if (!res.headersSent) send(res, e.code || 500, { ok: 0, err: e.message }); });
    } else serveStatic(req, res, url);
  });
  server.requestTimeout = 10000;

  return {
    server, cfg, state: () => state, tableKey, staffToken, flush,
    close: () => new Promise((r) => { flush(); server.close(r); server.closeAllConnections?.(); }),
    listen: (port = cfg.port, host = '0.0.0.0') => new Promise((r) => server.listen(port, host, () => r(server.address().port))),
    // Demo helpers (used for screenshots only)
    _raise: raise, _place: placeOrder, _touchNode: (t, rssi) => { state.tables[t].node = { seen: clock(), rssi, vcc: 3.28, fw: '1.0' }; },
  };
}

module.exports = { createHub };

if (require.main === module) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : undefined; };
  const demo = a.includes('--demo');
  const config = {};
  if (arg('port')) config.port = Number(arg('port'));
  if (demo) Object.assign(config, { requireTableKey: false, staffPin: '', restaurantName: 'Trattoria Demo', portalUrl: '' });
  const cfgPath = arg('config') || path.join(__dirname, 'config.json');
  const hub = createHub({ configPath: cfgPath, dataDir: arg('data'), config });
  if (demo) require('./demo').seed(hub);
  hub.listen().then((port) => {
    console.log(`Tablebell hub on :${port}  tables=${hub.cfg.tables}${demo ? '  (demo data)' : ''}`);
    if (!demo && hub.cfg.nodeKey === DEFAULTS.nodeKey) console.warn('WARNING: nodeKey is still the default; set it in hub/config.json');
    if (!demo && !hub.cfg.staffPin) console.warn('WARNING: staffPin is empty; the waiter dashboard is open to every guest on the Wi-Fi');
  });
  const stop = () => { hub.flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
