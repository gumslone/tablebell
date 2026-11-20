// Minimal QR code encoder: byte mode, error correction level M, versions 1-6 (up to 106 bytes).
// Enough for a Wi-Fi join code or a short URL. No dependencies. Works in Node and browsers.
'use strict';
(function (root) {
  // GF(256) arithmetic for Reed-Solomon (polynomial 0x11D)
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsRemainder(data, deg) {
    let g = [1];                                    // generator polynomial, highest term first
    for (let i = 0; i < deg; i++) {
      const n = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); }
      g = n;
    }
    const r = new Array(deg).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < deg; i++) r[i] ^= mul(g[i + 1], f);
    }
    return r;
  }

  // Level M tables, index = version (1..6)
  const TOTAL = [0, 26, 44, 70, 100, 134, 172];   // total codewords
  const ECB = [0, 10, 16, 26, 18, 24, 16];        // EC codewords per block
  const NBLK = [0, 1, 1, 1, 2, 2, 4];             // blocks
  const dataWords = (v) => TOTAL[v] - ECB[v] * NBLK[v];
  const capacity = (v) => Math.floor((dataWords(v) * 8 - 12) / 8);

  const bit = (n, i) => ((n >>> i) & 1) !== 0;

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    return Array.from(Buffer.from(str, 'utf8'));
  }

  function makeCodewords(bytes, v) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0x4, 4); push(bytes.length, 8);
    for (const b of bytes) push(b, 8);
    const cap = dataWords(v) * 8;
    push(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    const per = data.length / NBLK[v];
    const blocks = [], ecs = [];
    for (let i = 0; i < NBLK[v]; i++) {
      const blk = data.slice(i * per, (i + 1) * per);
      blocks.push(blk); ecs.push(rsRemainder(blk, ECB[v]));
    }
    const out = [];
    for (let i = 0; i < per; i++) for (const b of blocks) out.push(b[i]);
    for (let i = 0; i < ECB[v]; i++) for (const e of ecs) out.push(e[i]);
    return out;
  }

  function encode(text, opts) {
    opts = opts || {};
    const bytes = utf8(text);
    let v = 1;
    while (v <= 6 && bytes.length > capacity(v)) v++;
    if (v > 6) throw new Error('QR text too long (' + bytes.length + ' bytes, max ' + capacity(6) + ')');
    const size = 17 + 4 * v;
    const mk = () => Array.from({ length: size }, () => new Array(size).fill(false));
    const base = mk(), fn = mk();
    const setFn = (x, y, dark) => { base[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v >= 2) {
      const c = size - 7;                              // single alignment pattern for v2..v6
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setFn(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    const drawFormat = (m, mask) => {
      const data = (0 << 3) | mask;                    // level M = 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) { m[i][8] = bit(bits, i); }
      m[7][8] = bit(bits, 6); m[8][8] = bit(bits, 7); m[8][7] = bit(bits, 8);
      for (let i = 9; i < 15; i++) m[8][14 - i] = bit(bits, i);
      for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(bits, i);
      for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(bits, i);
      m[size - 8][8] = true;                           // always-dark module
    };
    // reserve the format areas so data placement skips them
    const probe = mk(); drawFormat(probe, 0);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const inFormat = (y === 8 && (x <= 8 || x >= size - 8)) || (x === 8 && (y <= 8 || y >= size - 8));
      if (inFormat && !fn[y][x]) fn[y][x] = true;
    }

    // place data bits in the zigzag order
    const cw = makeCodewords(bytes, v);
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < cw.length * 8) { base[y][x] = bit(cw[bi >>> 3], 7 - (bi & 7)); bi++; }
        }
      }
    }

    const maskFns = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const build = (mask) => {
      const m = base.map((r) => r.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFns[mask](x, y)) m[y][x] = !m[y][x];
      drawFormat(m, mask);
      return m;
    };
    const penalty = (m) => {
      let p = 0, dark = 0;
      const line = (get) => {
        let run = 1;
        for (let i = 1; i < size; i++) {
          if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
        const s = []; for (let i = 0; i < size; i++) s.push(get(i) ? 1 : 0);
        const str = s.join('');
        for (const pat of ['10111010000', '00001011101']) {
          for (let i = str.indexOf(pat); i >= 0; i = str.indexOf(pat, i + 1)) p += 40;
        }
      };
      for (let y = 0; y < size; y++) line((i) => m[y][i]);
      for (let x = 0; x < size; x++) line((i) => m[i][x]);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      p += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
      return p;
    };

    let best = null, bestMask = 0, bestP = Infinity;
    if (opts.mask !== undefined) { best = build(opts.mask); bestMask = opts.mask; }
    else for (let k = 0; k < 8; k++) { const m = build(k), p = penalty(m); if (p < bestP) { bestP = p; best = m; bestMask = k; } }
    return { size, version: v, mask: bestMask, modules: best, get: (x, y) => best[y][x] };
  }

  // SVG string with a 4-module quiet zone
  function svg(text, opts) {
    opts = opts || {};
    const q = encode(text, opts), n = q.size + 8;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  const api = { encode, svg, capacity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QR = api;
})(this);
