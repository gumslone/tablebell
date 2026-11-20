// Prints one card per table with a Wi-Fi QR and a "your table" QR (table number + secret key).
//   node tools/table-sheet/make_sheet.js [--host 192.168.50.1] [--ssid Tablebell-Guest] [--password SECRET]
//        [--config hub/config.json] [--data hub/data] [--out out]
// Uses the hub's own key derivation, so the codes only work with the data dir you pass.
// Writes tables.html and, if Google Chrome is found, tables.pdf. Needs Node 18+, no npm packages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const QR = require('./qr.js');
const { createHub } = require('../../hub/server');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const HOST = args.host || '192.168.50.1';
const SSID = args.ssid || 'Tablebell-Guest';
const PASSWORD = args.password || '';
const OUT = path.resolve(args.out || 'out');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wifiEsc = (s) => s.replace(/([\;,:"])/g, '\\$1');
const wifi = PASSWORD ? `WIFI:T:WPA;S:${wifiEsc(SSID)};P:${wifiEsc(PASSWORD)};;` : `WIFI:T:nopass;S:${wifiEsc(SSID)};;`;

const hub = createHub({ configPath: path.resolve(args.config || path.join(__dirname, '../../hub/config.json')), dataDir: args.data ? path.resolve(args.data) : undefined });
hub.flush();
const n = hub.cfg.tables;
const cards = [];
for (let t = 1; t <= n; t++) {
  const url = `http://${HOST}/?t=${t}&k=${hub.tableKey(t)}`;
  cards.push(`<section><div class="no">Table ${t}</div>
    <div class="qrs"><figure>${QR.svg(wifi)}<figcaption>1. Join Wi-Fi<br><b>${esc(SSID)}</b></figcaption></figure>
    <figure>${QR.svg(url)}<figcaption>2. Call waiter, order, pay</figcaption></figure></div></section>`);
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Table cards</title><style>
@page{size:A4;margin:10mm}body{font-family:system-ui,Arial,sans-serif;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
section{border:1.5px dashed #888;border-radius:6mm;padding:5mm;break-inside:avoid;text-align:center}
.no{font-size:26pt;font-weight:800;margin-bottom:3mm}.qrs{display:flex;gap:4mm;justify-content:center}
figure{margin:0;width:38mm}figure svg{width:100%;height:auto}figcaption{font-size:8.5pt;margin-top:1mm}
</style></head><body><div class="grid">${cards.join('')}</div></body></html>`;
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'tables.html');
fs.writeFileSync(file, html);
console.log('wrote', file);
if (fs.existsSync(CHROME)) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pdf-'));
  const pdf = path.join(OUT, 'tables.pdf');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, 'file://' + file], { stdio: 'ignore', timeout: 60000 });
  if (r.status === 0 && fs.existsSync(pdf)) console.log('wrote', pdf);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
