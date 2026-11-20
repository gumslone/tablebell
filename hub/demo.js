'use strict';
// Seeds believable restaurant activity so the UIs can be shown without any hardware.
function seed(hub) {
  const st = hub.state();
  const now = Date.now();
  const order = (t, items, agoSec, by = 'guest', note = '') => {
    const r = hub._place(t, items, note, by);
    r.order.at = now - agoSec * 1000;
    return r.order;
  };
  const set = (o, sts) => sts.forEach((s, i) => { if (o.items[i]) o.items[i].st = s; });

  set(order(2, [{ id: 'm1', qty: 1 }, { id: 'm3', qty: 1 }, { id: 'b2', qty: 2 }], 1500), ['served', 'served', 'served']);
  set(order(3, [{ id: 's1', qty: 2 }, { id: 'b3', qty: 2 }], 900), ['served', 'served']);
  set(order(3, [{ id: 'm2', qty: 1 }, { id: 'm4', qty: 1 }], 420), ['prep', 'prep']);
  set(order(5, [{ id: 'm1', qty: 2 }, { id: 'b1', qty: 1 }, { id: 'b4', qty: 2 }], 600), ['ready', 'ready', 'served', 'served']);
  set(order(6, [{ id: 's2', qty: 1 }, { id: 'b5', qty: 2 }], 180, 'guest', 'No garlic please'), ['new', 'new']);
  set(order(8, [{ id: 'm3', qty: 2 }, { id: 'd1', qty: 1 }, { id: 'b3', qty: 1 }], 2400), ['served', 'served', 'served', 'served']);
  set(order(10, [{ id: 'm2', qty: 1 }, { id: 'b2', qty: 1 }], 60, 'waiter'), ['new', 'new']);

  hub._raise(4, 'call', 'node'); st.tables[4].call.since = now - 95000;
  hub._raise(8, 'bill', 'node'); st.tables[8].call.since = now - 140000; st.tables[8].payReq = 'card';
  hub._raise(2, 'call', 'guest'); st.tables[2].call.since = now - 220000; st.tables[2].call.ackAt = now - 190000;
  hub._raise(11, 'call', 'node'); st.tables[11].call.since = now - 20000;
  st.history.push({ t: 1, type: 'call', since: now - 3000000, ackAt: now - 2970000, end: now - 2900000, reason: 'done' });
  st.history.push({ t: 7, type: 'call', since: now - 2000000, ackAt: now - 1950000, end: now - 1900000, reason: 'done' });
  st.closed.push({ t: 9, at: now - 1800000, total: 54.5, method: 'card', orders: 2 });
  st.closed.push({ t: 12, at: now - 900000, total: 31.0, method: 'cash', orders: 1 });
  st.avail.m4 = false;

  st.tables[7].node = { seen: now - 600000, rssi: -80, vcc: 3.1, fw: '1.0' };
  const beat = () => { for (let t = 1; t <= hub.cfg.tables; t++) if (t !== 7) hub._touchNode(t, -45 - ((t * 7) % 30)); };
  beat(); setInterval(beat, 10000).unref();
}
module.exports = { seed };
