'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dur = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const money = (v, cur) => cur + (Math.round(v * 100) / 100).toFixed(2);
let clockOffset = 0; // server time minus browser time, so timers are right even if the phone clock is off
const syncClock = (serverNow) => { clockOffset = serverNow - Date.now(); };
const nowMs = () => Date.now() + clockOffset;
function toast(msg) {
  const e = document.createElement('div'); e.className = 'toast'; e.textContent = msg; document.body.appendChild(e);
  setTimeout(() => e.remove(), 2200);
}
async function req(method, url, body, headers = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, ok: r.ok, json: j };
}
let audio;
function beep(times = 2) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      const t0 = audio.currentTime + i * 0.25; g.gain.setValueAtTime(0.2, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      o.start(t0); o.stop(t0 + 0.2);
    }
  } catch { /* no audio available */ }
}
// Staff pages: PIN login, token kept in localStorage.
const Staff = {
  token: () => { try { return localStorage.getItem('tc_token') || ''; } catch { return ''; } },
  headers() { return { 'X-Token': this.token() }; },
  async get(p) { return req('GET', p, null, this.headers()); },
  async post(p, b) { return req('POST', p, b, this.headers()); },
  async login(pin) {
    const r = await req('POST', '/api/staff/login', { pin });
    if (r.ok) { try { localStorage.setItem('tc_token', r.json.token); } catch { /* private mode */ } }
    return r;
  },
};
// Shows a PIN prompt when the hub answers 401; resolves when the user got in.
function pinGate(onReady) {
  const box = document.createElement('div'); box.className = 'sheet';
  box.innerHTML = '<div><h2>' + tt('pinTitle') + '</h2><input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><p id="pe" class="mut"></p><button class="pri" id="pg" style="width:100%">' + tt('enter') + '</button></div>';
  document.body.appendChild(box);
  const go = async () => {
    const r = await Staff.login($('#pin', box).value);
    if (r.ok) { box.remove(); onReady(); } else $('#pe', box).textContent = r.status === 429 ? tt('pinLocked') : tt('pinWrong');
  };
  $('#pg', box).onclick = go; $('#pin', box).onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#pin', box).focus();
}

// ---- language (shared by every page; menu items may carry an "i18n" block in menu.json) ----
const LANGS = ['en', 'de', 'uk'];
let LANG = (() => { try { return localStorage.getItem('lang'); } catch { return null; } })() || (navigator.language || 'en').slice(0, 2);
if (!LANGS.includes(LANG)) LANG = 'en';
const STR = {
  en: { waiter: 'Waiter', soundOff: '🔇 Sound off', soundOn: '🔔 Sound on', tables: 'Tables', menuAvail: 'Menu availability', openCalls: 'Open calls', avgResp: 'Avg response today', salesToday: 'Sales today', nTables: 'tables',
    readyServe: '🍽 Ready to serve:', CALL: 'CALL', BILL: 'BILL', acked: 'ON THE WAY', ready: 'FOOD READY', occupied: 'SEATED', free: 'free', btnOffline: 'button offline', needsConfirm: 'needs confirm',
    coming: 'I’m coming', done: 'Done', paid: 'Paid', lCall: 'call', lBill: 'bill', lAcked: 'waiter on the way', lReady: 'food ready', lSeated: 'seated', lFree: 'free',
    table: 'Table', order: 'Order', confirm: 'Confirm', served: 'Served', btnOnline: 'Button online', btnOff: 'Button offline', noNode: 'No button node seen yet', guestKey: 'guest link key', noOrders: 'No orders.', total: 'Total',
    addItems: '+ Add items', flagCall: 'Flag: call', flagBill: 'Flag: bill', close: 'Close', addTo: 'Add to table', back: 'Back', sendKb: 'Send to kitchen/bar', available: 'available', soldOut: 'sold out',
    markSold: 'Mark sold out', markAvail: 'Mark available', confirmPaid: 'paid? This closes the bill.', sendFail: 'Could not send', pinTitle: 'Staff PIN', pinWrong: 'Wrong PIN', pinLocked: 'Too many attempts, wait a minute.', enter: 'Enter',
    kitchen: 'Kitchen', bar: 'Bar', all: 'All', tickets: 'tickets', soldOutBtn: 'Sold out…', restore: 'SOLD OUT · tap to restore', allReady: 'All ready ✓', noTickets: 'No open tickets. 🎉',
    cash: 'cash', card: 'card', guest: 'guest', waiterBy: 'waiter', s_held: 'held', s_new: 'new', s_prep: 'cooking', s_ready: 'ready', s_served: 'served', s_cancelled: 'cancelled' },
  de: { waiter: 'Kellner', soundOff: '🔇 Ton aus', soundOn: '🔔 Ton an', tables: 'Tische', menuAvail: 'Verfügbarkeit', openCalls: 'Offene Rufe', avgResp: 'Ø Reaktionszeit heute', salesToday: 'Umsatz heute', nTables: 'Tische',
    readyServe: '🍽 Abholbereit:', CALL: 'RUF', BILL: 'RECHNUNG', acked: 'UNTERWEGS', ready: 'ESSEN FERTIG', occupied: 'BESETZT', free: 'frei', btnOffline: 'Taster offline', needsConfirm: 'Bestätigung nötig',
    coming: 'Ich komme', done: 'Erledigt', paid: 'Bezahlt', lCall: 'Ruf', lBill: 'Rechnung', lAcked: 'Kellner unterwegs', lReady: 'Essen fertig', lSeated: 'besetzt', lFree: 'frei',
    table: 'Tisch', order: 'Bestellung', confirm: 'Bestätigen', served: 'Serviert', btnOnline: 'Taster online', btnOff: 'Taster offline', noNode: 'Noch kein Taster gesehen', guestKey: 'Gäste-Link-Schlüssel', noOrders: 'Keine Bestellungen.', total: 'Summe',
    addItems: '+ Artikel hinzufügen', flagCall: 'Markieren: Ruf', flagBill: 'Markieren: Rechnung', close: 'Schließen', addTo: 'Hinzufügen zu Tisch', back: 'Zurück', sendKb: 'An Küche/Bar senden', available: 'verfügbar', soldOut: 'ausverkauft',
    markSold: 'Ausverkauft setzen', markAvail: 'Wieder verfügbar', confirmPaid: 'bezahlt? Die Rechnung wird geschlossen.', sendFail: 'Senden fehlgeschlagen', pinTitle: 'Personal-PIN', pinWrong: 'Falsche PIN', pinLocked: 'Zu viele Versuche, bitte eine Minute warten.', enter: 'Weiter',
    kitchen: 'Küche', bar: 'Bar', all: 'Alle', tickets: 'Bons', soldOutBtn: 'Ausverkauft…', restore: 'AUSVERKAUFT · tippen zum Zurücksetzen', allReady: 'Alles fertig ✓', noTickets: 'Keine offenen Bons. 🎉',
    cash: 'bar', card: 'Karte', guest: 'Gast', waiterBy: 'Kellner', s_held: 'wartet', s_new: 'neu', s_prep: 'in Arbeit', s_ready: 'fertig', s_served: 'serviert', s_cancelled: 'storniert' },
  uk: { waiter: 'Офіціант', soundOff: '🔇 Звук вимк.', soundOn: '🔔 Звук увімк.', tables: 'Столики', menuAvail: 'Наявність страв', openCalls: 'Відкриті виклики', avgResp: 'Сер. реакція сьогодні', salesToday: 'Виторг сьогодні', nTables: 'столиків',
    readyServe: '🍽 Готово до подачі:', CALL: 'ВИКЛИК', BILL: 'РАХУНОК', acked: 'ІДЕ', ready: 'СТРАВА ГОТОВА', occupied: 'ЗАЙНЯТО', free: 'вільно', btnOffline: 'кнопка офлайн', needsConfirm: 'потрібне підтвердження',
    coming: 'Іду', done: 'Готово', paid: 'Сплачено', lCall: 'виклик', lBill: 'рахунок', lAcked: 'офіціант іде', lReady: 'страва готова', lSeated: 'зайнято', lFree: 'вільно',
    table: 'Столик', order: 'Замовлення', confirm: 'Підтвердити', served: 'Подано', btnOnline: 'Кнопка онлайн', btnOff: 'Кнопка офлайн', noNode: 'Кнопку ще не бачили', guestKey: 'ключ гостьового посилання', noOrders: 'Немає замовлень.', total: 'Разом',
    addItems: '+ Додати позиції', flagCall: 'Позначити: виклик', flagBill: 'Позначити: рахунок', close: 'Закрити', addTo: 'Додати до столика', back: 'Назад', sendKb: 'Надіслати на кухню/бар', available: 'є в наявності', soldOut: 'немає',
    markSold: 'Позначити «немає»', markAvail: 'Знову є', confirmPaid: 'сплачено? Рахунок буде закрито.', sendFail: 'Не вдалося надіслати', pinTitle: 'PIN персоналу', pinWrong: 'Невірний PIN', pinLocked: 'Забагато спроб, зачекайте хвилину.', enter: 'Увійти',
    kitchen: 'Кухня', bar: 'Бар', all: 'Усе', tickets: 'тікетів', soldOutBtn: 'Немає в наявності…', restore: 'НЕМАЄ · торкніться, щоб повернути', allReady: 'Усе готово ✓', noTickets: 'Немає відкритих тікетів. 🎉',
    cash: 'готівка', card: 'картка', guest: 'гість', waiterBy: 'офіціант', s_held: 'очікує', s_new: 'нове', s_prep: 'готується', s_ready: 'готово', s_served: 'подано', s_cancelled: 'скасовано' },
};
const tt = (k) => (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
// Menu names: menu.json items/categories may carry i18n; unknown languages fall back to the base text.
const mItem = (m, lang) => { const x = m && m.i18n && m.i18n[lang || LANG]; return { name: (x && x.name) || (m && m.name) || '', desc: (x && x.desc) || (m && m.desc) || '' }; };
const mCat = (c, lang) => (c && c.i18n && c.i18n[lang || LANG]) || (c && c.name) || '';
// Order lines store the English name; show the viewer's language by looking the item up in the menu.
const lineName = (menuItems, id, fallback, lang) => { const m = (menuItems || []).find((x) => x.id === id); return m ? mItem(m, lang).name : fallback; };
// Renders EN/DE/UK buttons into #langs; calls onChange after switching.
function langSwitch(onChange) {
  const box = document.getElementById('langs'); if (!box) return;
  box.innerHTML = LANGS.map((l) => `<button class="lang ${l === LANG ? 'on' : ''}" data-l="${l}">${l.toUpperCase()}</button>`).join(' ');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => { LANG = b.dataset.l; try { localStorage.setItem('lang', LANG); } catch { /* private mode */ } document.documentElement.lang = LANG; langSwitch(onChange); onChange(); }; });
}
document.documentElement.lang = LANG;
