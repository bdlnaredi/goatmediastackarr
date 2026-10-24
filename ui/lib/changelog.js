// Reads CHANGELOG.md into versions for the "What's new" page (web page and app).
// Sections look like "## v0.7.1 — 2026-10-25"; "## Unreleased" holds what is new since the last version.
const fs = require('fs'), path = require('path');

function parse(text, current = '') {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const m = h[1].match(/^v?(\d+\.\d+\.\d+[\w.-]*)\s*(?:[—–-]+\s*(\d{4}-\d{2}-\d{2}))?/i);
      cur = { version: m ? m[1] : '', date: m && m[2] || '', items: [] };
      if (m || /unreleased/i.test(h[1])) out.push(cur); else cur = null;
      continue;
    }
    if (!cur) continue;
    const b = line.match(/^\s{0,1}[-*]\s+(.*)$/);
    if (b) cur.items.push(b[1].trim());
    else if (line.trim() && cur.items.length && /^\s{2,}\S/.test(line)) cur.items[cur.items.length - 1] += ' ' + line.trim();
  }
  const cv = String(current || '').replace(/^v/, '');
  const listed = out.some(x => x.version && x.version === cv);
  const res = [];
  for (const x of out) {
    if (!x.version) {
      if (!x.items.length) continue;
      // The running version was built before its section got its number: these are its changes.
      if (cv && !listed && /^\d+\.\d+\.\d+$/.test(cv)) res.push({ ...x, version: cv, current: true });
      else res.push({ ...x, next: true });
      continue;
    }
    res.push({ ...x, current: x.version === cv });
  }
  return res.slice(0, 40);
}

function file() {
  for (const f of [process.env.GOAT_CHANGELOG, path.join(__dirname, '..', '..', 'CHANGELOG.md'), path.join(__dirname, '..', 'CHANGELOG.md')]) {
    try { if (f && fs.statSync(f).isFile()) return f; } catch {}
  }
  return '';
}
let cache = { f: '', t: 0, v: null };
function read(current) {
  const f = file(); if (!f) return [];
  const t = fs.statSync(f).mtimeMs;
  if (cache.f !== f || cache.t !== t || cache.cv !== current) cache = { f, t, cv: current, v: parse(fs.readFileSync(f, 'utf8'), current) };
  return cache.v;
}

module.exports = { parse, read };
