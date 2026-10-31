// Copies backups off the server: to any S3-compatible storage (Amazon S3, Backblaze B2, Cloudflare R2, Wasabi,
// MinIO…) or to a WebDAV folder (Nextcloud, ownCloud, Synology, Koofr…), keeping the newest few there.
// GoatMediaStackarr, Copyright (C) 2026 bdlnaredi, GPL-3.0-or-later. No dependencies.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), { Readable } = require('node:stream');

const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
/** The saved settings, cleaned. Secrets are kept when the page sends them empty. */
function clean(b = {}, o = {}) {
  const type = ['s3', 'webdav'].includes(b.type) ? b.type : o.type || 's3', g = (k, n = 300) => b[k] != null && cut(b[k], n) !== '' ? cut(b[k], n) : o[k] || '';
  return { on: 'on' in b ? !!b.on : !!o.on, type, endpoint: g('endpoint').replace(/\/+$/, ''), region: g('region', 40) || 'us-east-1', bucket: g('bucket', 100), access: g('access', 200), secret: g('secret', 200),
    url: g('url').replace(/\/+$/, ''), user: g('user', 200), pass: g('pass', 200), prefix: cut(b.prefix != null ? b.prefix : o.prefix || 'goatmediastackarr', 100).replace(/^\/+|\/+$/g, ''),
    keep: Math.min(60, Math.max(1, Math.round(+(b.keep != null ? b.keep : o.keep || 7)) || 7)), last: o.last || null };
}
function problem(c) {
  if (c.type === 's3') { if (!/^https?:\/\/[^\s/]+/.test(c.endpoint)) return 'Enter the storage address (like https://s3.us-west-002.backblazeb2.com)'; if (!c.bucket) return 'Enter the bucket name'; if (!c.access || !c.secret) return 'Enter the access key and secret'; }
  else { if (!/^https?:\/\/\S+/.test(c.url)) return 'Enter the WebDAV folder address (like https://cloud.example.com/remote.php/dav/files/you)'; }
  return '';
}

// ---------- S3: Signature Version 4, path-style addresses (works with every S3-compatible service) ----------
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest(), hash = s => crypto.createHash('sha256').update(s).digest('hex');
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function s3sign(c, method, key, query = {}, body = null, extra = {}, now = new Date()) {
  const u = new URL(c.endpoint), host = u.host, amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const path = '/' + enc(c.bucket) + (key ? '/' + key.split('/').map(enc).join('/') : '');
  const qs = Object.keys(query).sort().map(k => enc(k) + '=' + enc(query[k])).join('&');
  const ph = body == null ? hash('') : 'UNSIGNED-PAYLOAD';
  const headers = { host, 'x-amz-content-sha256': ph, 'x-amz-date': amz, ...extra };
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const canon = [method, path, qs, names.map(h => h + ':' + String(headers[Object.keys(headers).find(k => k.toLowerCase() === h)]).trim()).join('\n') + '\n', names.join(';'), ph].join('\n');
  const scope = `${day}/${c.region}/s3/aws4_request`, sts = ['AWS4-HMAC-SHA256', amz, scope, hash(canon)].join('\n');
  const key2 = ['aws4_request'].reduce((k, s) => hmac(k, s), hmac(hmac(hmac('AWS4' + c.secret, day), c.region), 's3'));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.access}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', key2).update(sts).digest('hex')}`;
  delete headers.host;
  return { url: `${u.protocol}//${host}${path}${qs ? '?' + qs : ''}`, headers };
}
function s3req(c, method, key, query = {}, body = null, extra = {}) {
  const { url, headers } = s3sign(c, method, key, query, body, extra);
  return fetch(url, { method, headers, body, duplex: body ? 'half' : undefined, signal: AbortSignal.timeout(+process.env.CLOUD_TIMEOUT_MS || 6 * 3600e3) });
}
const why = async (r, what) => { const t = await r.text().catch(() => ''); const m = /<Message>([^<]*)/.exec(t) || /<Code>([^<]*)/.exec(t); return new Error(`${what} failed (${r.status}${m ? ': ' + m[1] : ''})`); };

// ---------- WebDAV ----------
const davAuth = c => c.user ? { Authorization: 'Basic ' + Buffer.from(c.user + ':' + c.pass).toString('base64') } : {};
const davUrl = (c, name = '') => c.url + '/' + [c.prefix, name].filter(Boolean).map(p => p.split('/').map(encodeURIComponent).join('/')).join('/') + (name ? '' : '/');
const dav = (c, method, url, body, extra = {}) => fetch(url, { method, headers: { ...davAuth(c), ...extra }, body, duplex: body ? 'half' : undefined, signal: AbortSignal.timeout(+process.env.CLOUD_TIMEOUT_MS || 6 * 3600e3) });

/** Uploads one local file under its own name. */
async function put(c, file, name) {
  const size = fs.statSync(file).size, body = () => Readable.toWeb(fs.createReadStream(file));
  if (c.type === 's3') { const r = await s3req(c, 'PUT', [c.prefix, name].filter(Boolean).join('/'), {}, body(), { 'content-length': String(size), 'content-type': 'application/octet-stream' }); if (!r.ok) throw await why(r, 'Upload'); return; }
  // Each folder of the prefix is made first (an error there just means it is already there).
  let acc = c.url; for (const part of c.prefix.split('/').filter(Boolean)) { acc += '/' + encodeURIComponent(part); await dav(c, 'MKCOL', acc + '/').catch(() => {}); }
  const r = await dav(c, 'PUT', davUrl(c, name), body(), { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' });
  if (!r.ok) throw await why(r, 'Upload');
}
/** The names of the backups that are there. */
async function list(c) {
  if (c.type === 's3') {
    const r = await s3req(c, 'GET', '', { 'list-type': '2', prefix: c.prefix ? c.prefix + '/' : '' }); if (!r.ok) throw await why(r, 'Listing');
    return [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1].replace(/&amp;/g, '&').split('/').pop()).filter(Boolean);
  }
  const r = await dav(c, 'PROPFIND', davUrl(c), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1', 'Content-Type': 'application/xml' });
  if (r.status === 404) return [];
  if (!r.ok && r.status !== 207) throw await why(r, 'Listing');
  return [...(await r.text()).matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)].map(m => decodeURIComponent(m[1].replace(/\/+$/, '').split('/').pop())).filter(n => /\.(json|tar\.gz)$/.test(n));
}
async function del(c, name) {
  const r = c.type === 's3' ? await s3req(c, 'DELETE', [c.prefix, name].filter(Boolean).join('/')) : await dav(c, 'DELETE', davUrl(c, name));
  if (!r.ok && r.status !== 404) throw await why(r, 'Removing');
}
/** Uploads, then keeps only the newest `keep` of the same kind (settings backups and stack backups are counted apart). */
async function send(c, file, name) {
  await put(c, file, name);
  const kind = n => /^stack-/.test(n) ? 'stack' : 'settings', mine = (await list(c)).filter(n => kind(n) === kind(name) && /^(stack-|auto-|manual-|pre-restore-)/.test(n)).sort();
  for (const n of mine.slice(0, Math.max(0, mine.length - c.keep))) await del(c, n).catch(() => {});
  return { name, kept: Math.min(mine.length, c.keep) };
}
/** Writes, lists and removes a small file, so a wrong address, key or folder shows up at once. */
async function test(c) {
  const tmp = require('node:path').join(require('node:os').tmpdir(), 'goat-cloud-test-' + process.pid + '.txt');
  fs.writeFileSync(tmp, 'GoatMediaStackarr can write here.\n');
  try { await put(c, tmp, 'goat-test.txt'); await list(c); await del(c, 'goat-test.txt'); } finally { try { fs.unlinkSync(tmp); } catch {} }
  return true;
}

module.exports = { clean, problem, put, list, del, send, test, s3sign };
