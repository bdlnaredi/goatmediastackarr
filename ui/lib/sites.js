// The site browser: tracker websites (IPTorrents, TorrentDay, TorrentLeech and the like) shown through
// GoatMediaStackarr, optionally through the VPN. Every page, picture and form goes through the server, which keeps
// the site's sign-in cookies, rewrites links so they stay inside the browser, and catches torrent downloads and magnet
// links so they go straight to qBittorrent.
//
// A page's address inside the browser is   /site/<token>/~/<http|https>/<host>/<path>?<query>
// The token stands for one admin and one site; it is the only key, as these pages run in a sandbox without the
// GoatMediaStackarr sign-in (so a site's own scripts can never act as you inside GoatMediaStackarr).
'use strict';

const enc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const unent = s => String(s).replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

/** The proxied address for [u] (relative to [base]), or [u] itself when it should stay as it is. */
function prox(u, base, pre) {
  const t = unent(String(u || '')).trim();
  if (!t || /^(#|javascript:|data:|blob:|about:|mailto:|tel:)/i.test(t)) return u;
  if (/^magnet:/i.test(t)) return `${pre}/_grab?m=${encodeURIComponent(t)}`;
  // Relative addresses ("details.php?id=1") already work: the browser resolves them against the proxied page.
  if (!/^(https?:)?\/\//i.test(t) && !t.startsWith('/')) return u;
  let a; try { a = new URL(t, base); } catch { return u; }
  if (!/^https?:$/.test(a.protocol)) return u;
  return `${pre}/~/${a.protocol.slice(0, -1)}/${a.host}${a.pathname}${a.search}${a.hash}`;
}

/** The real address behind a proxied path ("~/https/host/path?q"), or null. */
function real(rest, search = '') {
  const m = /^~\/(https?)\/([^/]+)(\/.*)?$/.exec(rest); if (!m) return null;
  try { return new URL(`${m[1]}://${m[2]}${m[3] || '/'}${search}`); } catch { return null; }
}

const rwCss = (css, base, pre) => String(css)
  .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, q, u) => `url(${q}${prox(u, base, pre)}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/gi, (all, q, u) => `@import ${q}${prox(u, base, pre)}${q}`);

/** The script added to every page: keeps links, forms, fetch() and XMLHttpRequest inside the browser. */
function shim(base, pre, label) {
  return `<script>(function(){var B=${JSON.stringify(String(base))},P=${JSON.stringify(pre)};
function rw(u){try{if(u==null)return u;var t=String(u).trim();if(!t||/^(#|javascript:|data:|blob:|about:|mailto:|tel:)/i.test(t))return u;
if(/^magnet:/i.test(t))return P+'/_grab?m='+encodeURIComponent(t);if(t.indexOf(P+'/')===0)return u;
if(!/^(https?:)?\\/\\//i.test(t)&&t.charAt(0)!=='/')return u;var a=new URL(t,B);if(!/^https?:$/.test(a.protocol))return u;
return P+'/~/'+a.protocol.slice(0,-1)+'/'+a.host+a.pathname+a.search+a.hash}catch(e){return u}}
var f=window.fetch;if(f)window.fetch=function(i,o){if(typeof i==='string'||i instanceof URL)i=rw(String(i));else if(i&&i.url)i=new Request(rw(i.url),i);return f.call(this,i,o)};
var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=rw(u);return x.apply(this,arguments)};
var w=window.open;window.open=function(u){if(u)arguments[0]=rw(u);return w.apply(this,arguments)};
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a){var h=a.getAttribute('href'),n=rw(h);if(n!==h)a.setAttribute('href',n)}},true);
document.addEventListener('submit',function(e){var t=e.target,h=t.getAttribute('action');if(h){var n=rw(h);if(n!==h)t.setAttribute('action',n)}},true);
addEventListener('DOMContentLoaded',function(){var d=document.createElement('div');d.textContent=${JSON.stringify(label)};
d.style.cssText='position:fixed;right:10px;bottom:10px;z-index:2147483647;background:rgba(10,12,28,.82);color:#ffd36b;font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:999px;pointer-events:none';document.body&&document.body.appendChild(d)});
})();</script>`;
}

/** Rewrites one HTML page so every link, picture, form and style stays inside the browser. */
function rwHtml(html, base, pre, label) {
  let h = String(html);
  // A <base href> moves where relative links point: follow it, and point it into the browser too.
  const bm = /<base\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(h);
  if (bm) { try { base = new URL(unent(bm[1]), base).href; } catch {} }
  h = h.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '')
    .replace(/\s(integrity|nonce)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\b(href|src|action|formaction|poster|background|data-src|data-original|data-lazy-src|data-url)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
      (all, attr, v, d, s, b) => { const u = d != null ? d : s != null ? s : b; const n = prox(u, base, pre); return n === u ? all : `${attr}="${enc(n)}"`; })
    .replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, v, d, s) => `srcset="${enc(String(d != null ? d : s).split(',').map(p => { const [u, ...r] = p.trim().split(/\s+/); return [prox(u, base, pre), ...r].join(' '); }).join(', '))}"`)
    .replace(/(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url\s*=\s*)([^"'>]+)/gi, (all, a, u) => a + enc(prox(u.trim(), base, pre)))
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, a, css, z) => a + rwCss(css, base, pre) + z)
    .replace(/\bstyle\s*=\s*"([^"]*)"/gi, (all, css) => `style="${rwCss(css, base, pre)}"`);
  const s = shim(base, pre, label);
  return /<head\b[^>]*>/i.test(h) ? h.replace(/<head\b[^>]*>/i, m => m + s) : s + h;
}

// ---------- Cookies: kept on the server, per site, so you sign in to a tracker once ----------
// jar: { "<domain>": { "<name>": { v: value, exp: ms or 0, p: path } } }
function store(jar, host, setCookies) {
  let changed = false;
  for (const line of setCookies || []) {
    const parts = String(line).split(';').map(x => x.trim()), i = parts[0].indexOf('=');
    if (i < 1) continue;
    const name = parts[0].slice(0, i).trim(), v = parts[0].slice(i + 1);
    let dom = host, exp = 0, path = '/';
    for (const a of parts.slice(1)) {
      const [k, ...rest] = a.split('='), val = rest.join('=').trim(), key = k.trim().toLowerCase();
      if (key === 'domain' && val) { const d = val.replace(/^\./, '').toLowerCase(); if (host === d || host.endsWith('.' + d)) dom = d; }
      else if (key === 'max-age') exp = Date.now() + (+val || 0) * 1000;
      else if (key === 'expires' && !exp) { const t = Date.parse(val); if (!isNaN(t)) exp = t; }
      else if (key === 'path' && val.startsWith('/')) path = val;
    }
    jar[dom] = jar[dom] || {};
    if (exp && exp <= Date.now()) { if (jar[dom][name]) { delete jar[dom][name]; changed = true; } }
    else { jar[dom][name] = { v, exp, p: path }; changed = true; }
  }
  return changed;
}
function cookieHeader(jar, host, path = '/') {
  const out = [], now = Date.now();
  for (const [dom, c] of Object.entries(jar || {})) {
    if (!(host === dom || host.endsWith('.' + dom))) continue;
    for (const [name, x] of Object.entries(c)) if ((!x.exp || x.exp > now) && path.startsWith(x.p || '/')) out.push(`${name}=${x.v}`);
  }
  return out.join('; ');
}

/** Is this answer a .torrent file? */
const isTorrent = (headers, url, buf) => /bittorrent/i.test(headers['content-type'] || '') || /filename\*?=[^;]*\.torrent/i.test(headers['content-disposition'] || '')
  || (/\.torrent(\?|$)/i.test(url) && buf && buf[0] === 0x64);

/** A plain little page shown inside the browser after something was sent to qBittorrent. */
const donePage = (ok, title, text) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${enc(title)}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d1c;color:#eef;font:16px system-ui,sans-serif">
<div style="max-width:420px;padding:28px;border-radius:20px;background:#15183a;text-align:center"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div>
<h2 style="margin:8px 0">${enc(title)}</h2><p style="color:#b8bad8">${enc(text)}</p>
<button onclick="history.back()" style="font:inherit;padding:10px 18px;border-radius:12px;border:0;background:#ffb938;color:#1d1400;font-weight:600">Back to the site</button></div>`;

module.exports = { prox, real, rwHtml, rwCss, store, cookieHeader, isTorrent, donePage };
