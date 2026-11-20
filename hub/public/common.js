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
  box.innerHTML = '<div><h2>Staff PIN</h2><input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><p id="pe" class="mut"></p><button class="pri" id="pg" style="width:100%">Enter</button></div>';
  document.body.appendChild(box);
  const go = async () => {
    const r = await Staff.login($('#pin', box).value);
    if (r.ok) { box.remove(); onReady(); } else $('#pe', box).textContent = r.status === 429 ? 'Too many attempts, wait a minute.' : 'Wrong PIN';
  };
  $('#pg', box).onclick = go; $('#pin', box).onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#pin', box).focus();
}
