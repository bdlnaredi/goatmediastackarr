// A small QR code generator (byte mode, versions 1 to 40, all four error correction levels). No dependencies.
// Used to show the two-step sign-in setup code as a picture that an authenticator app can scan.
(function () {
  const ECC = { L: [0, 1], M: [1, 0], Q: [2, 3], H: [3, 2] };               // index into tables, and the 2-bit format value
  const EPB = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
  const NB = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];
  const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataWords = (v, e) => Math.floor(rawModules(v) / 8) - EPB[e][v] * NB[e][v];
  const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  const rsDiv = d => { const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 2); } return r; };
  const rsRem = (data, div) => { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); } return r; };
  const bits = (o, val, n) => { for (let i = n - 1; i >= 0; i--) o.push((val >>> i) & 1); };

  function encode(text, level) {
    const e = ECC[level || 'M'][0], fmt = ECC[level || 'M'][1], data = Array.from(new TextEncoder().encode(String(text)));
    let ver = 1; for (;; ver++) { if (ver > 40) throw new Error('Too much text for a QR code'); const cc = ver <= 9 ? 8 : 16; if (4 + cc + data.length * 8 <= dataWords(ver, e) * 8) break; }
    const bb = []; bits(bb, 4, 4); bits(bb, data.length, ver <= 9 ? 8 : 16); data.forEach(b => bits(bb, b, 8));
    const cap = dataWords(ver, e) * 8; bits(bb, 0, Math.min(4, cap - bb.length)); bits(bb, 0, (8 - bb.length % 8) % 8);
    for (let p = 0xec; bb.length < cap; p ^= 0xec ^ 0x11) bits(bb, p, 8);
    const cw = []; for (let i = 0; i < bb.length; i += 8) cw.push(parseInt(bb.slice(i, i + 8).join(''), 2));
    // split into blocks, add error correction, then interleave
    const nb = NB[e][ver], epb = EPB[e][ver], raw = Math.floor(rawModules(ver) / 8), short = nb - raw % nb, sl = Math.floor(raw / nb), div = rsDiv(epb), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = cw.slice(k, k + sl - epb + (i < short ? 0 : 1)); k += d.length; const ec = rsRem(d, div); if (i < short) d.push(0); blocks.push(d.concat(ec)); }
    const all = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sl - epb || j >= short) all.push(b[i]); });
    const n = ver * 4 + 17, M = Array.from({ length: n }, () => new Array(n).fill(false)), F = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2, pos = ver === 1 ? [] : [6];
    for (let p = n - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) { if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const drawFmt = mask => {
      const d = (fmt << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) set(8, n - 15 + i, g(i)); set(8, n - 8, true);
    };
    drawFmt(0);
    if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (ver << 12) | r; for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) !== 0, a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); } }
    let k = 0; for (let right = n - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) { const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - v : v; if (!F[y][x] && k < all.length * 8) { M[y][x] = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0; k++; } } }
    const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const apply = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!F[y][x] && maskFn[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let s = 0; const run = line => { let c = 1; for (let i = 1; i <= n; i++) { if (i < n && line[i] === line[i - 1]) c++; else { if (c >= 5) s += 3 + c - 5; c = 1; } } };
      const pat = [1, 0, 1, 1, 1, 0, 1], look = line => { for (let i = 0; i + 7 <= n; i++) { if (pat.every((v, j) => (line[i + j] ? 1 : 0) === v)) { const w = (a, b) => { for (let t = a; t < b; t++) if (t >= 0 && t < n && line[t]) return false; return true; }; if (w(i - 4, i) || w(i + 7, i + 11)) s += 40; } } };
      for (let y = 0; y < n; y++) { run(M[y]); look(M[y]); } for (let x = 0; x < n; x++) { const col = M.map(r => r[x]); run(col); look(col); }
      for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) s += 3;
      let dark = 0; M.forEach(r => r.forEach(v => { if (v) dark++; })); s += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10; return s;
    };
    let best = 0, bs = Infinity; for (let m = 0; m < 8; m++) { apply(m); drawFmt(m); const p = penalty(); if (p < bs) { bs = p; best = m; } apply(m); }
    apply(best); drawFmt(best);
    return M;
  }
  // Black squares on a white card with the required quiet border, drawn as one path so it stays sharp at any size.
  function svg(text, o = {}) {
    const M = encode(text, o.ecc || 'M'), n = M.length, q = 4; let d = '';
    M.forEach((r, y) => { let x = 0; while (x < n) { if (r[x]) { let w = 1; while (x + w < n && r[x + w]) w++; d += `M${x + q} ${y + q}h${w}v1h-${w}z`; x += w; } else x++; } });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${o.size || 220}" height="${o.size || 220}" role="img" aria-label="${(o.label || 'QR code').replace(/"/g, '')}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  const api = { encode, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.QR = api;
})();
