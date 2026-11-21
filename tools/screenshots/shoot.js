// Regenerates docs/screenshots/*.png from the real hub in --demo mode using headless Chrome.
//   node tools/screenshots/shoot.js
// Needs Node 18+ and Google Chrome (set CHROME=/path/to/chrome to override). No npm deps.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '../../docs/screenshots');
const PORT = 8098;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-demo-'));
  const hub = spawn('node', [path.join(__dirname, '../../hub/server.js'), '--demo', '--port', String(PORT), '--data', data], { stdio: 'inherit' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-shot-'));
  let chrome, targets;
  for (let attempt = 0; attempt < 4 && !targets; attempt++) {
    chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--lang=en-US', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !targets; i++) {
      try {
        const p = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        targets = await (await fetch(`http://127.0.0.1:${p}/json`)).json();
      } catch { await sleep(300); }
    }
    if (!targets) { chrome.kill('SIGKILL'); await sleep(1500); }
  }
  try {
    if (!targets) throw new Error('Chrome remote debugging port did not come up');
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const js = (expr) => cdp('Runtime.evaluate', { expression: expr, awaitPromise: true });
    const shot = async (name, full = false) => {
      await sleep(900);
      const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
      console.log('wrote', name + '.png');
    };
    const go = async (p) => { await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` }); await sleep(1500); };
    await sleep(800);
    await cdp('Page.enable');
    await cdp('Emulation.setLocaleOverride', { locale: 'en-US' });
    await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', acceptLanguage: 'en-US' });

    const phone = () => cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    const desk = (h = 800) => cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: h, deviceScaleFactor: 1, mobile: false });

    await phone();
    await go('/?t=4');                       // waiting for a waiter
    await shot('guest-call');
    await js("document.querySelector('#tabs button:nth-child(2)').click();document.querySelector('[data-p=m1]').click();document.querySelector('[data-p=m1]').click();document.querySelector('[data-p=m2]').click()");
    await js("document.querySelector('[data-c=drinks]')?.click()");
    await sleep(300);
    await js("document.querySelector('[data-c=mains]').click()");
    await shot('guest-menu');
    await js("document.getElementById('cartBtn').click()");
    await shot('guest-cart');
    await go('/?t=3');                       // seated, orders in progress, bill
    await js("window.scrollTo(0, document.body.scrollHeight)");
    await shot('guest-bill');
    await go('/?t=8');
    await js("localStorage.setItem('lang','de')"); await go('/?t=8');
    await shot('guest-de');
    await js("localStorage.setItem('lang','uk')"); await go('/?t=3');
    await shot('guest-uk');

    await desk(780);
    await js("localStorage.removeItem('lang')");
    await go('/waiter');
    await shot('waiter');
    await js("localStorage.setItem('lang','de')"); await go('/waiter');
    await shot('waiter-de');
    await js("localStorage.setItem('lang','en')"); await go('/waiter');
    await js("document.querySelector('.card[data-t=\"3\"]').click()");
    await desk(900);
    await shot('waiter-table');
    await desk(780);
    await go('/kitchen');
    await shot('kitchen');
    await js("localStorage.setItem('lang','uk')"); await go('/kitchen');
    await shot('kitchen-uk');
    await js("localStorage.setItem('lang','en')");
    await go('/bar');
    await shot('bar');
    ws.close();
  } finally {
    chrome.kill(); hub.kill();
    await sleep(800);
    for (const d of [profile, data]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
