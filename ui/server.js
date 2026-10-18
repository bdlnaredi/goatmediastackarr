// GoatMediaStackarr: a self-hosted dashboard for your media apps.
// Copyright (C) 2026 bdlnaredi
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
// This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details: see the LICENSE file.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const DATA = process.env.DATA_DIR || '/data', FILE = path.join(DATA, 'db.json');
fs.mkdirSync(DATA, { recursive: true });
const totp = require('./lib/totp'), channels = require('./lib/channels'), listsLib = require('./lib/lists');
const PORT = +process.env.PORT || 5080, DEMO = /^(1|true|yes)$/i.test(process.env.DEMO || ''), DAY = 864e5;
const demo = DEMO ? require('./lib/demo').create({ streams: 2 }) : null;
// Inside the container the release number comes from the image (GOAT_VERSION); otherwise from package.json.
const VERSION = (() => { const g = String(process.env.GOAT_VERSION || '').replace(/^v/, ''); if (g && g !== 'dev') return g; try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'))).version; } catch { return 'dev'; } })();
const TRUST = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''), SETUP_TOKEN = process.env.SETUP_TOKEN || '';
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const PUB = path.join(__dirname, 'public'), KEYF = path.join(DATA, 'secret.key');
let KEY; try { KEY = fs.readFileSync(KEYF); } catch { KEY = crypto.randomBytes(32); fs.writeFileSync(KEYF, KEY, { mode: 0o600 }); }
const enc = v => {
  if (!v) return v;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), ct = Buffer.concat([c.update(String(v), 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
};
const dec = v => {
  if (!v || !String(v).startsWith('enc:')) return v;
  try {
    const b = Buffer.from(v.slice(4), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
};
let db = { users: [], services: [], requests: [], alerts: null };
if (fs.existsSync(FILE)) {
  try { db = JSON.parse(fs.readFileSync(FILE)); }
  catch (e) {
    try { db = JSON.parse(fs.readFileSync(FILE + '.bak')); console.error('db.json could not be read, so the last automatic copy (db.json.bak) was loaded instead.'); }
    catch { console.error('db.json is damaged and there is no usable db.json.bak. Refusing to start so nothing is overwritten. Restore it from a backup in ' + DATA); process.exit(1); }
  }
}
const defaults = d => {
  d.users = d.users || []; d.services = d.services || []; d.requests = d.requests || []; d.log = d.log || []; d.history = d.history || [];
  d.seedRules = d.seedRules || []; d.reports = d.reports || []; d.statusLinks = d.statusLinks || []; d.settings = d.settings || {};
  return d;
};
// Turns the on-disk form (secrets encrypted) into the in-memory form, and upgrades the old single alert channel.
const decryptAll = d => {
  d.services.forEach(s => { s.apiKey = dec(s.apiKey); s.pass = dec(s.pass); });
  if (d.alerts) {
    if (!d.alerts.channels) {
      const a = d.alerts;
      d.alerts.channels = (a.target || (a.type === 'telegram' && a.token)) ? [{ id: crypto.randomBytes(6).toString('hex'), type: a.type || 'ntfy', target: a.target || '', token: dec(a.token) || '', chat: a.chat || '' }] : [];
    } else d.alerts.channels.forEach(c => { c.token = dec(c.token); c.pass = dec(c.pass); });
    delete d.alerts.type; delete d.alerts.target; delete d.alerts.token; delete d.alerts.chat;
  }
  d.users.forEach(u => { if (u.totp && u.totp.secret) u.totp.secret = dec(u.totp.secret); });
  return d;
};
const dehydrate = d => JSON.stringify({ ...d,
  services: d.services.map(s => ({ ...s, apiKey: enc(s.apiKey), pass: enc(s.pass) })),
  alerts: d.alerts && { ...d.alerts, channels: (d.alerts.channels || []).map(c => ({ ...c, token: enc(c.token), pass: enc(c.pass) })) },
  users: d.users.map(u => u.totp ? { ...u, totp: { ...u.totp, secret: enc(u.totp.secret) } } : u) }, null, 1);
db = decryptAll(defaults(db));
let lastBak = 0;
const save = () => {
  if (DEMO) return;
  const data = dehydrate(db);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try { if (fs.existsSync(FILE) && Date.now() - lastBak > 36e5) { fs.copyFileSync(FILE, FILE + '.bak'); lastBak = Date.now(); } } catch {}
  fs.renameSync(tmp, FILE);
};
if (DEMO) {
  // Demo: everything lives in memory, points at built-in pretend apps, and nothing is written to the data folder.
  const base = 'http://127.0.0.1:' + PORT + '/__demo/', mk = (n, k) => ({ id: crypto.randomBytes(6).toString('hex'), type: k, name: n, url: base + k, apiKey: 'demo', user: 'demo', pass: 'demo' });
  const salt = a => crypto.randomBytes(6).toString('hex'), mkU = (name, pw, role, extra = {}) => { const sl = salt(); return { id: crypto.randomBytes(6).toString('hex'), name, role, salt: sl, hash: crypto.scryptSync(pw, sl, 32).toString('hex'), access: [], ...extra }; };
  db = defaults({ users: [mkU('demo', 'demo-mediahub', 'admin'), mkU('guest', 'guest-mediahub', 'user')], alerts: { channels: [], reports: true }, requests: [],
    services: [['Sonarr', 'sonarr'], ['Radarr', 'radarr'], ['qBittorrent', 'qbittorrent'], ['Plex', 'plex'], ['Jellyfin', 'jellyfin'], ['Seerr', 'seerr'], ['Jackett', 'jackett'], ['Prowlarr', 'prowlarr'], ['Lidarr', 'lidarr'], ['Readarr', 'readarr'], ['Bazarr', 'bazarr'], ['SABnzbd', 'sabnzbd'], ['Tautulli', 'tautulli'], ['Unraid', 'unraid']].map(x => mk(x[0], x[1])) });
  db.users[1].access = db.services.map(x => x.id);
  db.settings.plexLogin = { on: true, sid: db.services.find(x => x.type === 'plex').id, auto: true };
  db.settings.lists = { trakt: { id: 'demo' }, tmdb: { key: 'demo' }, tvdb: { key: 'demo' } };
  db.requests.push({ id: 'r1', sid: db.services.find(x => x.type === 'seerr').id, uid: db.users[1].id, user: 'guest', mediaType: 'movie', mediaId: 801, title: 'Hidden Harbor', year: '2024', poster: '', status: 'pending', at: Date.now() - 3600e3 * 5 });
}
if (db.users.length) save();
const uid = () => crypto.randomBytes(6).toString('hex');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const audit = (who, action, detail) => { db.log.push({ at: Date.now(), user: who, action, detail: String(detail == null ? '' : detail).slice(0, 200) }); if (db.log.length > 500) db.log.splice(0, db.log.length - 500); save(); };
const histKeys = new Set(db.history.map(h => h.hash + ':' + Math.round(h.at / 1000))), health = {};
const userOf = id => db.users.find(u => u.id === id);
const devLabel = ua => { ua = ua || ''; const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''; return o ? b + ' on ' + o : b; };
async function pushTo(url, title, body) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  const go = async (u, opt) => { const r = await fetch(u, { method: 'POST', signal: AbortSignal.timeout(8000), ...opt }); if (!r.ok) throw new Error('Notification service returned ' + r.status); };
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) await go(url, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${body}` }) });
  else await go(url, { headers: { Title: title }, body });
  return true;
}
const notifyUser = (u, title, body) => u && u.notify ? pushTo(u.notify, title, body) : Promise.resolve(false);
const KINDS = ['sonarr', 'radarr', 'prowlarr', 'jackett', 'qbittorrent', 'seerr', 'unraid', 'plex', 'jellyfin', 'tautulli', 'sabnzbd', 'bazarr', 'lidarr', 'readarr'];
const SESSF = path.join(DATA, 'sessions.json'), th = t => crypto.createHash('sha256').update(String(t || '')).digest('hex');
let sessions; try { sessions = new Map(Object.entries(JSON.parse(fs.readFileSync(SESSF))).map(([k, v]) => [k, typeof v === 'string' ? { uid: v, at: 0, seen: 0, ua: '', ip: '' } : v])); } catch { sessions = new Map(); }
const saveSess = () => DEMO || fs.writeFileSync(SESSF, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
const qbCookie = {}, fails = {};
const ipOf = req => TRUST ? String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress).trim() : String(req.socket.remoteAddress || '');

const mkUser = (name, pw, role) => { const salt = uid(); return { id: uid(), name, role, salt, hash: hash(pw, salt), access: [] }; };
// Trending / popular / anticipated lists. The keys are the admin's own, kept in settings; the sites can be moved with TRAKT_URL, TMDB_URL and TVDB_URL.
const listKeys = () => { const l = (db.settings || {}).lists || {}; return { trakt: String((l.trakt || {}).id || ''), tmdb: String((l.tmdb || {}).key || ''), tvdb: String((l.tvdb || {}).key || '') }; };
const lists = listsLib.create({ keys: listKeys,
  urls: new Proxy({}, { get: (_, k) => String(process.env[k.toUpperCase() + '_URL'] || (DEMO ? `http://127.0.0.1:${PORT}/__demo/${k}` : { trakt: 'https://api.trakt.tv', tmdb: 'https://api.themoviedb.org/3', tvdb: 'https://api4.thetvdb.com/v4' }[k])).replace(/\/+$/, '') }),
  seerrPoster: async (kind, id) => { const s = db.services.find(x => x.type === 'seerr'); if (!s) return ''; const r = await fetch(`${s.url.replace(/\/+$/, '')}/api/v1/${kind === 'tv' ? 'tv' : 'movie'}/${id}`, { signal: AbortSignal.timeout(8000), headers: { 'X-Api-Key': s.apiKey } }); return r.ok ? ((await r.json()).posterPath || '') : ''; } });
const pubUser = u => ({ email: u.email || '', twofa: !!(u.totp && u.totp.on), id: u.id, name: u.name, role: u.role, access: u.access, perms: u.perms || null, notify: u.notify || '', dash: u.dash || null, reqLimit: u.reqLimit || null, autoApprove: !!u.autoApprove, plex: u.plex ? { name: u.plex.name } : null, hide: cleanHide(u.hide), restr: u.plexRules ? Object.fromEntries(['contentRating', 'contentRating!', 'label', 'label!'].filter(k => (u.plexRules[k] || []).length).map(k => [k, u.plexRules[k]])) : null, libs: u.plex ? { n: ((u.plexLibs || {}).mine || []).length, of: ((u.plexLibs || {}).all || []).length, limited: libLimited(u) } : null, plexName: u.plexName || '', lists: lists.enabled(), avatar: u.avatar ? `/api/avatar/${u.id}?v=${u.avatar.v}` : '', dataLimit: u.dataLimit || 0, streamLimit: u.streamLimit == null ? null : u.streamLimit });
// What the folders the apps report mean, in words (these are the container's own folders).
const DISK_NAMES = { '/media': 'Media library', '/data': 'Media library', '/downloads': 'Downloads', '/config': 'App data', '/': 'Container (Docker image)' };
const DISK_ORDER = ['Media library', 'Downloads', '', 'App data', 'Container (Docker image)'];
const pubSvc = s => ({ id: s.id, type: s.type, name: s.name, url: s.url, managed: !!s.managed });

// ---------- What each person uses: the space their requests take on the disks, and what they watched ----------
// A profile picture is kept as one small file per person; the record only says its type and when it changed.
const AVD = path.join(DATA, 'avatars'), AVTYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const avFile = u => path.join(AVD, String(u.id).replace(/\W/g, '') + '.img');
const arrGet = async (s, p) => { const r = await fetch(s.url.replace(/\/+$/, '') + p, { signal: AbortSignal.timeout(20000), headers: { 'X-Api-Key': s.apiKey || '' } }); if (!r.ok) throw new Error(s.name + ' returned ' + r.status); return r.json(); };
// Every movie and show in Sonarr and Radarr by its TMDB number, with its size on disk. Kept for five minutes.
let libIdx = { t: 0, v: null, p: null };
const libIndex = () => {
  if (libIdx.v && Date.now() - libIdx.t < 300000) return Promise.resolve(libIdx.v);
  if (!libIdx.p) libIdx.p = (async () => {
    const out = { movie: new Map(), tv: new Map() };
    await Promise.all(db.services.filter(s => s.type === 'radarr' || s.type === 'sonarr').map(async s => { try {
      const l = await arrGet(s, s.type === 'radarr' ? '/api/v3/movie' : '/api/v3/series'), k = s.type === 'radarr' ? 'movie' : 'tv';
      for (const x of Array.isArray(l) ? l : []) if (+x.tmdbId > 0) {
        const size = k === 'movie' ? +x.sizeOnDisk || 0 : +(x.statistics || {}).sizeOnDisk || 0, e = out[k].get(+x.tmdbId);
        if (e) e.size += size; else out[k].set(+x.tmdbId, { size, sid: s.id, id: x.id });
      }
    } catch {} }));
    libIdx = { t: Date.now(), v: out, p: null }; return out;
  })().finally(() => { libIdx.p = null; });
  return libIdx.p;
};
// The space taken by what this person asked for (each title counted once, even if asked for twice).
const usedSpace = async u => {
  const idx = await libIndex(), seen = new Set(), items = []; let bytes = 0;
  for (const r of db.requests.filter(x => x.uid === u.id && x.status === 'approved')) {
    const k = r.mediaType + ':' + r.mediaId; if (seen.has(k)) continue; seen.add(k);
    const e = idx[r.mediaType === 'tv' ? 'tv' : 'movie'].get(+r.mediaId), size = e ? e.size : 0; bytes += size;
    items.push({ title: r.title, year: r.year, mediaType: r.mediaType, mediaId: r.mediaId, poster: r.poster, size });
  }
  return { bytes, items: items.sort((a, b) => b.size - a.size) };
};
const gbText = b => (b / 1e9 >= 100 ? Math.round(b / 1e9) : Math.round(b / 1e8) / 10) + ' GB';
// Watch time from Tautulli, for a person who signs in with Plex (or whose Plex name an admin entered).
const watchOf = async u => {
  const s = db.services.find(x => x.type === 'tautulli'), names = [u.plex && u.plex.name, u.plexName].filter(Boolean).map(x => String(x).trim().toLowerCase());
  if (!s || !names.length) return null;
  const t = async (cmd, extra = '') => { const r = await fetch(`${s.url.replace(/\/+$/, '')}/api/v2?apikey=${encodeURIComponent(s.apiKey || '')}&cmd=${cmd}${extra}`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json().catch(() => null); if (!r.ok || !d || !d.response || d.response.result !== 'success') throw new Error('Tautulli'); return d.response.data; };
  const who = ((await t('get_users')) || []).find(x => names.includes(String(x.username || '').trim().toLowerCase()) || names.includes(String(x.friendly_name || '').trim().toLowerCase()));
  if (!who || !who.user_id) return [];
  const l = await t('get_user_watch_time_stats', '&query_days=1,7,30,0&user_id=' + encodeURIComponent(who.user_id));
  return (Array.isArray(l) ? l : []).map(x => ({ days: +x.query_days || 0, plays: +x.total_plays || 0, seconds: +x.total_time || 0 }));
};
const usageOf = async u => {
  const now = Date.now(), mine = db.requests.filter(r => r.uid === u.id), n = st => mine.filter(r => r.status === st).length;
  const [space, watch] = await Promise.all([usedSpace(u).catch(() => null), watchOf(u).catch(() => null)]);
  return { id: u.id, name: u.name, requests: { total: mine.length, month: mine.filter(r => r.at > now - 30 * DAY).length, approved: n('approved'), pending: n('pending'), declined: n('declined') },
    reqLimit: u.reqLimit || null, space: space ? { bytes: space.bytes, items: space.items.slice(0, 12) } : null, limitGb: u.dataLimit || 0, watch, stream: streamSummary(u),
    devices: [...sessions.values()].filter(v => v.uid === u.id).length };
};

// ---------- GoatMediaStackarr: apps that live inside this container ----------
// The container writes managed.json with each built-in engine's address and keys. Those engines are kept in
// sync here automatically, so nobody has to type an address or API key. Apps added by hand are never touched.
const GOAT_MANAGED = process.env.GOAT_MANAGED || '', GOAT_RUN = process.env.GOAT_RUN || '/run/goat', GOAT_WIRED = process.env.GOAT_WIRED || '';
let goatMtime = 0;
const goatSync = () => {
  // Demo mode with GOAT_MANAGED set (used for screenshots): treat the pretend apps as built-in ones.
  if (DEMO && GOAT_MANAGED) { for (const x of db.services) if (!x.managed && !['unraid', 'jackett', 'readarr', 'plex'].includes(x.type)) x.managed = x.type; return; }
  if (!GOAT_MANAGED || DEMO) return;
  let st; try { st = fs.statSync(GOAT_MANAGED); } catch { return; }
  if (st.mtimeMs === goatMtime) return;
  let m; try { m = JSON.parse(fs.readFileSync(GOAT_MANAGED, 'utf8')); } catch { return; }
  goatMtime = st.mtimeMs;
  const want = (m.services || []).filter(x => x && x.key && KINDS.includes(x.type));
  let changed = false;
  for (const w of want) {
    const s = db.services.find(x => x.managed === w.key);
    const fields = { type: w.type, url: w.url, apiKey: w.apiKey || '', user: w.user || '', pass: w.pass || '' };
    if (!s) { db.services.push({ id: uid(), name: w.name, managed: w.key, ...fields }); changed = true; continue; }
    for (const [k, v] of Object.entries(fields)) if (s[k] !== v) { s[k] = v; changed = true; }
  }
  const keep = new Set(want.map(w => w.key)), gone = db.services.filter(x => x.managed && !keep.has(x.managed)).map(x => x.id);
  if (gone.length) { db.services = db.services.filter(x => !gone.includes(x.id)); db.users.forEach(u => u.access = (u.access || []).filter(a => !gone.includes(a))); changed = true; }
  if (changed) save();
};
const GOAT_CONFIG = process.env.GOAT_CONFIG_DIR || '/config', GOAT_SOCK = process.env.GOAT_CONTROL_SOCK || path.join(GOAT_RUN, 'control.sock');
// The container's settings helper (goat/settings.js). Missing when the interface runs on its own, as plain MediaHub.
const goatSettings = (() => { for (const p of [process.env.GOAT_BIN && path.join(process.env.GOAT_BIN, 'settings.js'), path.join(__dirname, '..', 'bin', 'settings.js'), path.join(__dirname, '..', 'goat', 'settings.js')]) { try { if (p && fs.existsSync(p)) return require(p); } catch {} } return null; })();
const goatRead = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const goatVpnFiles = () => { try { return fs.readdirSync(path.join(GOAT_CONFIG, 'vpn')).filter(f => /\.(conf|ovpn)$/i.test(f) && f !== 'credentials.conf'); } catch { return []; } };
const goatStatus = () => {
  const sec = goatRead(path.join(GOAT_CONFIG, 'goat', 'secrets.json')) || {};
  return { vpn: goatRead(path.join(GOAT_RUN, 'vpn.json')) || { enabled: false, state: 'off' }, wired: GOAT_WIRED ? goatRead(GOAT_WIRED) : null,
    engines: [...db.services.filter(x => x.managed).map(x => ({ id: x.id, key: x.managed, name: x.name, ok: health[x.id] ? health[x.id].ok : null })),
      ...((GOAT_MANAGED && (goatRead(GOAT_MANAGED) || {}).extras) || []).map(x => ({ key: x.key, name: x.name, ok: null }))],
    settings: goatSettings ? goatSettings.view() : null, vpnFiles: goatVpnFiles(), container: !!GOAT_MANAGED,
    logins: { jellyfin: sec.jellyfinUser ? { user: sec.jellyfinUser, pass: sec.jellyfinPass } : null, qbittorrent: sec.qbitUser ? { user: sec.qbitUser, pass: sec.qbitPass } : null } };
};
// For the setup checklist: how many indexers the built-in Prowlarr has and how many news servers SABnzbd has.
// null when that app is off or not answering.
const goatCounts = async () => {
  const pr = db.services.find(x => x.managed === 'prowlarr'), sb = db.services.find(x => x.managed === 'sabnzbd');
  const [indexers, newsServers] = await Promise.all([
    pr ? fetch(`${pr.url.replace(/\/+$/, '')}/api/v1/indexer`, { headers: { 'X-Api-Key': pr.apiKey || '' }, signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null).then(l => Array.isArray(l) ? l.length : null).catch(() => null) : null,
    sb ? sabGet(sb, 'mode=get_config&section=servers').then(j => (((j || {}).config || {}).servers || []).length).catch(() => null) : null]);
  return { indexers, newsServers };
};
// Talks to the container's control service (goat/control.js) over its private socket.
const goatControl = msg => new Promise(resolve => {
  const sock = require('net').connect(GOAT_SOCK); let buf = '';
  const done = r => { try { sock.destroy(); } catch {} resolve(r); };
  sock.setTimeout(150000, () => done({ ok: false, error: 'The control service did not answer in time' }));
  sock.on('connect', () => sock.write(JSON.stringify(msg) + '\n'));
  sock.on('data', d => { buf += d; const nl = buf.indexOf('\n'); if (nl !== -1) { try { done(JSON.parse(buf.slice(0, nl))); } catch { done({ ok: false, error: 'Bad reply' }); } } });
  sock.on('error', e => done({ ok: false, error: 'The control service is not running (' + e.code + ')' }));
});
// Importing from an existing stack: one job at a time, run in the background, polled by the Stack page.
const importer = require('./lib/importer');
let goatImport = null;
const goatTarget2 = kind => { const t = db.services.find(x => x.managed === kind); return t ? { url: t.url, apiKey: t.apiKey } : null; };
// This server's own public address, to compare with the VPN's for the leak test.
const goatPublicIp = async () => {
  const t = await (await fetch(process.env.GOAT_IPCHECK_URL || 'https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(8000) })).text();
  const g = k => ((t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '');
  return { ip: g('ip'), country: g('loc') };
};
// No media server inside the container: Seerr signs in through the Plex server added under Settings, then Apps
// (the one used for Plex sign-in if there are several). Its address and token are passed on, and the apps connected again.
const goatOwnPlex = () => {
  if (!goatSettings || !GOAT_MANAGED || DEMO) return;
  if (db.services.some(x => x.managed === 'jellyfin' || x.managed === 'plex')) return;
  const own = db.services.filter(x => x.type === 'plex' && !x.managed && x.url && x.apiKey);
  const c = db.settings.plexLogin || {}, p = own.find(x => x.id === c.sid) || own[0];
  if (!p) return;
  const url = p.url.replace(/\/+$/, ''), cur = goatSettings.read().plex || {};
  if (cur.url === url && cur.token === p.apiKey) return;
  try { goatSettings.update({ plex: { url, token: p.apiKey } }); } catch (e) { console.log('[goat] could not pass your Plex server on to Seerr:', e.message); return; }
  console.log(`[goat] Seerr and Tautulli will use your Plex server at ${url}; connecting the apps again.`);
  goatControl({ cmd: 'rewire' }).then(() => db.services.some(x => x.managed === 'tautulli') && goatControl({ cmd: 'restart', engine: 'tautulli' }));
};
goatSync(); goatOwnPlex();
if (GOAT_MANAGED) setInterval(() => { goatSync(); goatOwnPlex(); }, Number(process.env.GOAT_SYNC_MS) || 15000).unref();
// Admins can open each built-in engine's own page at /engines/<name>/ (the "Advanced" pages), signed in through
// GoatMediaStackarr. The engines themselves listen only inside the container, so this is the only way in.
// Seerr has no setting for living under a sub-path, and Jellyfin has its own port, so they are not proxied.
const GOAT_PROXIED = ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'bazarr', 'qbittorrent', 'sabnzbd', 'tautulli'];
const goatTarget = rawUrl => {
  const m = String(rawUrl || '').match(/^\/engines\/([a-z]+)(\/.*)?$/); if (!m || !GOAT_PROXIED.includes(m[1])) return null;
  const s = db.services.find(x => x.managed === m[1]); if (!s) return null;
  let u; try { u = new URL(s.url); } catch { return null; }
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
  const base = u.pathname.replace(/\/+$/, ''), rest = m[2] || '/';
  return { key: m[1], name: s.name, port: +u.port || 80, path: base === '/engines/' + m[1] ? '/engines/' + m[1] + rest : (base + rest) || '/', bare: !m[2] };
};
const goatAdmin = req => {
  const token = ((req.headers.cookie || '').match(/sid=(\w+)/) || [])[1];
  const sess = token && sessions.get(th(token)), me = sess && db.users.find(u => u.id === sess.uid);
  return !!(me && me.role === 'admin');
};
const goatHeaders = (req, t) => {
  const h = { ...req.headers, host: '127.0.0.1:' + t.port };
  delete h['x-forwarded-for']; delete h['x-forwarded-host']; delete h['x-forwarded-proto'];
  h.cookie = String(h.cookie || '').split(/;\s*/).filter(c => c && !/^sid=/.test(c)).join('; '); if (!h.cookie) delete h.cookie;
  return h;
};
const goatProxy = (req, res, t) => {
  for (const k of ['Content-Security-Policy', 'X-Frame-Options', 'Permissions-Policy']) res.removeHeader(k);
  const up = http.request({ host: '127.0.0.1', port: t.port, method: req.method, path: t.path, headers: goatHeaders(req, t) }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '10' }); res.end(`<!doctype html><meta http-equiv="refresh" content="10"><title>${t.name}</title><p style="font:16px system-ui;margin:2rem">${t.name} is starting or restarting. This page tries again every 10 seconds.</p>`); } else res.destroy(); });
  req.pipe(up);
};

// Checks that a service answers with the details you saved.
async function test(s) {
  const u = s.url.replace(/\/+$/, ''), t = { signal: AbortSignal.timeout(8000) };
  if (s.type === 'qbittorrent') {
    const r = await fetch(u + '/api/v2/auth/login', { ...t, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: u },
      body: new URLSearchParams({ username: s.user || '', password: s.pass || '' }) });
    return r.ok && !!(r.headers.get('set-cookie') || '');
  }
  if (s.type === 'unraid') {
    const r = await fetch(u + '/graphql', { ...t, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey || '' },
      body: JSON.stringify({ query: '{ online }' }) });
    return r.ok;
  }
  if (s.type === 'jackett')
    return (await fetch(u + '/api/v2.0/indexers/all/results/torznab/api?t=caps&apikey=' + encodeURIComponent(s.apiKey || ''), t)).ok;
  if (s.type === 'jellyfin') return (await fetch(u + (s.apiKey ? '/System/Info' : '/System/Info/Public'), { ...t, headers: { 'X-Emby-Token': s.apiKey || '' } })).ok;
  if (s.type === 'plex') return (await fetch(u + '/library/sections', { ...t, headers: { 'X-Plex-Token': s.apiKey || '' } })).ok;
  if (s.type === 'sabnzbd') { const r = await fetch(`${u}/api?mode=version&output=json&apikey=${encodeURIComponent(s.apiKey || '')}`, t); return r.ok && !!((await r.json().catch(() => ({}))).version); }
  if (s.type === 'tautulli') { const r = await fetch(`${u}/api/v2?apikey=${encodeURIComponent(s.apiKey || '')}&cmd=arnold`, t); return r.ok && ((await r.json().catch(() => ({}))).response || {}).result === 'success'; }
  if (s.type === 'bazarr') return (await fetch(u + '/api/system/status', { ...t, headers: { 'X-API-KEY': s.apiKey || '' } })).ok;
  const p = { sonarr: '/api/v3/system/status', radarr: '/api/v3/system/status', lidarr: '/api/v1/system/status', readarr: '/api/v1/system/status',
    prowlarr: '/api/v1/system/status', seerr: '/api/v1/status' }[s.type];
  return (await fetch(u + p, { ...t, headers: { 'X-Api-Key': s.apiKey || '' } })).ok;
}

const readBody = req => new Promise(ok => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 12e6) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});
const send = (res, code, obj, headers = {}) => {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...headers });
  res.end(JSON.stringify(obj));
};
const login = (res, user) => {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(th(token), { uid: user.id, at: Date.now(), seen: Date.now(), ...res.info }); saveSess();
  send(res, 200, { user: pubUser(user) }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${res.secure ? '; Secure' : ''}` });
};

    const gql = async (s, query) => {
      const x = await fetch(s.url.replace(/\/+$/, '') + '/graphql', { method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey }, body: JSON.stringify({ query }) });
      const d = await x.json().catch(() => ({}));
      if (!x.ok || d.errors) throw new Error((d.errors && d.errors[0].message) || 'Unraid returned ' + x.status);
      return d.data;
    };
    const qb = async (s, path, form) => {
      const u = s.url.replace(/\/+$/, ''), F = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: u };
      for (let i = 0; i < 2; i++) {
        if (!qbCookie[s.id]) {
          const x = await fetch(u + '/api/v2/auth/login', { method: 'POST', signal: AbortSignal.timeout(8000), headers: F,
            body: new URLSearchParams({ username: s.user || '', password: s.pass || '' }) });
          qbCookie[s.id] = (x.headers.get('set-cookie') || '').split(';')[0];
          if (!qbCookie[s.id]) throw new Error('qBittorrent sign-in failed');
        }
        const x = await fetch(u + path, { method: form ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
          headers: { ...F, Cookie: qbCookie[s.id] }, body: form ? new URLSearchParams(form) : undefined });
        if (x.status === 403) { delete qbCookie[s.id]; continue; }
        if (x.status === 404) throw Object.assign(new Error('Not supported'), { nf: true });
        const t = await x.text(); if (!x.ok) throw new Error(t || 'qBittorrent returned ' + x.status);
        try { return JSON.parse(t); } catch { return t; }
      }
      throw new Error('qBittorrent refused the request');
    };

const tickets = new Map(), pending2fa = new Map(), fails2 = {}, failsPub = {}, pubCache = {}, qbListCache = {}, grabCache = new Map(), vpnCache = {}, mon = { idle: {}, up: {}, done: {}, seeded: {}, disk: {}, vpn: {}, share: {}, reqT: 0, n: 0, busy: false };
let homeIp = { v: '', t: 0 };
const cut = (v, n = 200) => String(v == null ? '' : v).slice(0, n);

// ---- Live data: one shared snapshot, pushed to every open dashboard over server-sent events ----
const pad2 = n => String(n || 0).padStart(2, '0');
function plexMap(x) {
  const ep = x.type === 'episode', md = (x.Media || [])[0] || {}, ts = x.TranscodeSession, ss = x.Session || {}, pl = x.Player || {};
  const dec = ts ? (ts.videoDecision === 'transcode' || ts.audioDecision === 'transcode' ? 'transcode' : 'stream') : 'direct';
  const rs = String(md.videoResolution || ''), res = /^\d+$/.test(rs) ? rs + 'p' : rs.toUpperCase();
  return { id: ss.id || '', sid: ss.id || '', user: (x.User || {}).title || '', player: pl.title || '', device: pl.product || pl.platform || '', state: pl.state || '',
    title: ep ? x.grandparentTitle : x.title, sub: ep ? `S${pad2(x.parentIndex)}E${pad2(x.index)} ${x.title}` : String(x.year || ''), kind: ep ? 'episode' : x.type === 'track' ? 'track' : 'movie',
    progress: x.duration ? Math.min(1, (x.viewOffset || 0) / x.duration) : 0, offset: x.viewOffset || 0, duration: x.duration || 0,
    thumb: x.grandparentThumb || x.parentThumb || x.thumb || '', decision: dec, res, kbps: +ss.bandwidth || 0, where: ss.location || '' };
}
// Jellyfin (and Emby) report sessions in their own shape; this turns one into the same shape Plex sessions use, so every page treats them alike.
const jfTicks = t => Math.round((+t || 0) / 1e4);
function jfMap(x) {
  const n = x.NowPlayingItem, ps = x.PlayState || {}, ti = x.TranscodingInfo, ep = n.Type === 'Episode', dur = jfTicks(n.RunTimeTicks), off = jfTicks(ps.PositionTicks);
  const h = (ti && ti.Height) || ((n.MediaStreams || []).find(m => m.Type === 'Video') || {}).Height || 0, res = h >= 2000 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h ? 'SD' : '';
  return { id: x.Id, sid: x.Id, user: cut(x.UserName, 60), player: cut(x.DeviceName, 60), device: cut(x.Client, 60), state: ps.IsPaused ? 'paused' : 'playing',
    title: cut(ep ? n.SeriesName : n.Name, 120), sub: ep ? `S${pad2(n.ParentIndexNumber)}E${pad2(n.IndexNumber)} ${cut(n.Name, 100)}` : String(n.ProductionYear || ''),
    kind: ep ? 'episode' : n.Type === 'Audio' ? 'track' : 'movie', progress: dur ? Math.min(1, off / dur) : 0, offset: off, duration: dur, thumb: (ep && n.SeriesId) || n.Id || '',
    decision: ps.PlayMethod === 'Transcode' ? 'transcode' : ps.PlayMethod === 'DirectStream' ? 'stream' : 'direct', res,
    kbps: Math.round(((ti && ti.Bitrate) || n.Bitrate || 0) / 1000), where: x.RemoteEndPoint && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fe80|fd)/i.test(x.RemoteEndPoint) ? 'wan' : 'lan' };
}
const jfGet = async (s, pth, opt = {}) => {
  const x = await fetch(s.url.replace(/\/+$/, '') + pth, { signal: AbortSignal.timeout(8000), ...opt, headers: { 'X-Emby-Token': s.apiKey || '', Accept: 'application/json', ...(opt.headers || {}) } });
  if (!x.ok) throw new Error('Jellyfin returned ' + x.status); return x;
};
const jfSessions = async s => ((await (await jfGet(s, '/Sessions')).json()) || []).filter(x => x && x.NowPlayingItem).map(jfMap);
const isMS = s => s.type === 'plex' || s.type === 'jellyfin';
const mediaSessions = s => s.type === 'jellyfin' ? jfSessions(s) : plexSessions(s);
const plexSessions = async s => (((await plexGet(s, '/status/sessions')).MediaContainer || {}).Metadata || []).map(plexMap);
const sabGet = async (s, q) => {
  const x = await fetch(`${s.url.replace(/\/+$/, '')}/api?output=json&apikey=${encodeURIComponent(s.apiKey)}&${q}`, { signal: AbortSignal.timeout(8000) });
  if (!x.ok) throw new Error('SABnzbd returned ' + x.status); return x.json();
};
const live = { snap: null, busy: false, timer: null, hist: {}, arr: {}, okAt: {}, run: {}, cur: { qb: {}, unraid: {}, plex: {}, sab: {} } }, liveClients = new Set(), HISTN = 120, DL_STATES = /^(downloading|forcedDL|metaDL|forcedMetaDL)$/;
const quick = (pr, ms = 3500) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
// CPU per thread, memory and swap in real amounts. Older Unraid versions may not offer them, so the plain percentages are the fallback.
const urx = {}, num = v => { const x = +v; return Number.isFinite(x) ? x : 0; };
async function unraidMetrics(s) {
  const f = urx[s.id];
  if (!f || f.ok || Date.now() - f.t > 3e5) {
    try {
      const m = (await quick(gql(s, '{ metrics { cpu { percentTotal cpus { percentIdle percentUser percentSystem } } memory { percentTotal total used free available swapTotal swapUsed } } }'))).metrics;
      urx[s.id] = { ok: true, t: Date.now() };
      return { cpu: num(m.cpu.percentTotal), mem: num(m.memory.percentTotal),
        cores: (m.cpu.cpus || []).slice(0, 256).map(c => c.percentIdle != null ? Math.max(0, Math.min(100, 100 - num(c.percentIdle))) : Math.min(100, num(c.percentUser) + num(c.percentSystem))),
        memTotal: num(m.memory.total), memUsed: num(m.memory.used), memFree: num(m.memory.free), memAvail: num(m.memory.available), swapTotal: num(m.memory.swapTotal), swapUsed: num(m.memory.swapUsed) };
    } catch (e) { if (/field|cannot query|unknown|validation|400/i.test(e.message)) urx[s.id] = { ok: false, t: Date.now() }; else throw e; }
  }
  const d = await quick(gql(s, '{ metrics { cpu { percentTotal } memory { percentTotal } } }'));
  return { cpu: num(d.metrics.cpu.percentTotal), mem: num(d.metrics.memory.percentTotal) };
}
// Every app is polled on its own, so a slow one never holds the others back; the snapshot is just whatever each one last answered.
async function liveSvc(s, slot) {
  const cur = live.cur;
  try {
      if (s.type === 'qbittorrent') {
        const [ti, l] = await quick(Promise.all([qb(s, '/api/v2/transfer/info'), qb(s, '/api/v2/torrents/info?filter=downloading')]));
        const h = live.hist[s.id] || (live.hist[s.id] = { dl: [], ul: [] });
        h.dl.push(ti.dl_info_speed || 0); h.ul.push(ti.up_info_speed || 0); if (h.dl.length > HISTN) { h.dl.shift(); h.ul.shift(); }
        const act = (Array.isArray(l) ? l : []).filter(x => DL_STATES.test(x.state));
        cur.qb[s.id] = { dl: ti.dl_info_speed || 0, ul: ti.up_info_speed || 0, active: act.length, conn: ti.connection_status || '',
          top: act.sort((a, b) => b.dlspeed - a.dlspeed).slice(0, 6).map(x => ({ hash: x.hash, name: x.name, progress: x.progress, speed: x.dlspeed, eta: x.eta, size: x.size })) };
      } else if (s.type === 'unraid') {
        const o = await unraidMetrics(s);
        let a = live.arr[s.id];
        if (!a || Date.now() - a.t > 30000) { a = live.arr[s.id] = { t: Date.now() }; try { const k = (await quick(gql(s, '{ array { capacity { kilobytes { used total } } } }'))).array.capacity.kilobytes; a.used = +k.used * 1024; a.total = +k.total * 1024; } catch {} }
        if (a.total) { o.used = a.used; o.total = a.total; }
        cur.unraid[s.id] = o;
      } else if (isMS(s)) cur.plex[s.id] = await quick(mediaSessions(s));
      else {
        const d = (await quick(sabGet(s, 'mode=queue&limit=5'))).queue || {};
        cur.sab[s.id] = { speed: (+d.kbpersec || 0) * 1024, paused: !!d.paused, slots: +d.noofslots_total || +d.noofslots || 0, left: d.sizeleft || '', timeleft: d.timeleft || '',
          jobs: (d.slots || []).slice(0, 4).map(j => ({ name: j.filename, pct: +j.percentage || 0 })) };
      }
      live.okAt[s.id] = Date.now();
  } catch { if (Date.now() - (live.okAt[s.id] || 0) > 15000) delete cur[slot][s.id]; }
}
async function liveBuild() {
  const jobs = [];
  for (const s of db.services) {
    const slot = { qbittorrent: 'qb', unraid: 'unraid', plex: 'plex', jellyfin: 'plex', sabnzbd: 'sab' }[s.type]; if (!slot) continue;
    if (!live.run[s.id]) jobs.push(live.run[s.id] = liveSvc(s, slot).finally(() => { delete live.run[s.id]; }));
  }
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 800))]);
  const out = { t: Date.now(), qb: { ...live.cur.qb }, unraid: { ...live.cur.unraid }, plex: { ...live.cur.plex }, sab: { ...live.cur.sab }, health: {} };
  for (const s of db.services) if (health[s.id]) out.health[s.id] = health[s.id].ok;
  return out;
}
// A profile that signs in with Plex only ever sees its own viewing: its own streams and its own history.
const ownNames = u => u && u.role !== 'admin' && u.plex ? [u.plex.name, u.plexName].filter(Boolean).map(x => String(x).trim().toLowerCase()) : null;
const mineOnly = (u, l) => { const n = ownNames(u); return n ? (Array.isArray(l) ? l : []).filter(x => n.includes(String(x.user || '').trim().toLowerCase())) : l; };
// Apps that list the whole library: a Plex profile with a library hidden from it never gets them.
const LIBAPPS = ['sonarr', 'radarr', 'lidarr', 'readarr', 'qbittorrent', 'sabnzbd', 'bazarr', 'prowlarr', 'jackett'];
const libLimited = u => !!ownNames(u) && !(u.plexLibs && u.plexLibs.all && u.plexLibs.all.length && u.plexLibs.all.every(k => (u.plexLibs.mine || []).includes(k)));
const svcOk = (u, s) => u.role === 'admin' || ((u.access || []).includes(s.id) && !(libLimited(u) && LIBAPPS.includes(s.type)));
// "Recently added": everything from the last 7 days, or the newest 10 when there is less than that (never more than 40).
const pickRecent = (l, at) => { const t = x => +at(x) || 0, srt = [...l].sort((a, b) => t(b) - t(a)), wk = srt.filter(x => t(x) >= Date.now() - 7 * 864e5); return wk.length >= 10 ? wk.slice(0, 40) : srt.slice(0, 10); };
// Pictures a Plex profile may load: only those belonging to things it was shown.
const imgOk = new Map();
const grant = (u, svc, paths) => { if (!ownNames(u)) return; const k = u.id + '|' + svc; let e = imgOk.get(k); if (!e) { if (imgOk.size > 400) imgOk.delete(imgOk.keys().next().value); e = new Set(); imgOk.set(k, e); }
  for (const p of paths) if (p) { if (e.size > 600) e.delete(e.values().next().value); e.add(String(p)); } };
const mayImg = (u, svc, p) => !ownNames(u) || (imgOk.get(u.id + '|' + svc) || new Set()).has(p);
// Things you do not want a Plex profile to see inside a library: by genre, by label or collection (tag), or by content rating.
const hideList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(x => cut(String(x).trim(), 40)).filter(Boolean))].slice(0, 30);
const cleanHide = h => ({ genre: hideList((h || {}).genre), label: hideList((h || {}).label), rating: hideList((h || {}).rating) });
const lc = a => (a || []).map(x => String(x).toLowerCase());
const hideRules = u => { const g = (db.settings.plexLogin || {}).hide || {}, p = u.hide || {}, m = k => [...new Set([...lc(g[k]), ...lc(p[k])])]; return { genre: m('genre'), label: m('label'), rating: m('rating') }; };
const plexMetaCache = new Map();
async function plexTags(s, key) {
  const ck = s.id + ':' + key, hit = plexMetaCache.get(ck); if (hit && Date.now() - hit.at < 600000) return hit.t;
  const md = (((await plexGet(s, '/library/metadata/' + encodeURIComponent(key))).MediaContainer || {}).Metadata || [])[0] || {}, tg = l => lc((l || []).map(x => x.tag));
  const t = { genres: tg(md.Genre), tags: [...tg(md.Label), ...tg(md.Collection)], rating: String(md.contentRating || '').toLowerCase() };
  if (plexMetaCache.size > 2000) plexMetaCache.delete(plexMetaCache.keys().next().value); plexMetaCache.set(ck, { at: Date.now(), t }); return t;
}
const ratingIn = (r, list) => !!r && (list.includes(r) || list.includes(r.split('/').pop()));
function isHidden(u, t) {
  const r = hideRules(u);
  if (t.genres.some(x => r.genre.includes(x)) || t.tags.some(x => r.label.includes(x)) || ratingIn(t.rating, r.rating)) return true;
  const x = u.plexRules; if (!x) return false;
  const L = k => lc(x[k]);
  if (L('label!').some(v => t.tags.includes(v)) || ratingIn(t.rating, L('contentRating!'))) return true;
  if (L('label').length && !L('label').some(v => t.tags.includes(v))) return true;
  if (L('contentRating').length && !ratingIn(t.rating, L('contentRating'))) return true;
  return false;
}
// The restrictions the server owner set on this person inside Plex itself (labels and content ratings), read from plex.tv.
async function plexRestrict(s, pid, pname) {
  try {
    const x = await fetch(PLEXTV() + '/api/users', { signal: AbortSignal.timeout(8000), headers: { 'X-Plex-Token': s.apiKey || '', Accept: 'application/xml' } }); if (!x.ok) return null;
    const xml = await x.text(), un = (v) => String(v || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    for (const m of xml.matchAll(/<User\b[^>]*>/g)) {
      const at = n => { const v = m[0].match(new RegExp('\\b' + n + '="([^"]*)"')); return v ? un(v[1]) : ''; };
      if (at('id') !== String(pid) && at('username').toLowerCase() !== pname.toLowerCase() && at('title').toLowerCase() !== pname.toLowerCase()) continue;
      const out = { contentRating: [], 'contentRating!': [], label: [], 'label!': [], at: Date.now() };
      for (const f of ['filterAll', 'filterMovies', 'filterTelevision']) { let v = at(f); try { v = decodeURIComponent(v); } catch {} for (const part of v.split('|')) { const i = part.indexOf('='); if (i < 1) continue; const k = part.slice(0, i); if (k in out) out[k].push(...hideList(part.slice(i + 1))); } }
      for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [...new Set(out[k])];
      return out;
    }
    return { contentRating: [], 'contentRating!': [], label: [], 'label!': [], at: Date.now() };
  } catch { return null; }
}
// Which Plex libraries exist, and which of them this person's own Plex account can open.
async function plexLibs(s, tok) {
  const get = async t => { const x = await fetch(s.url.replace(/\/+$/, '') + '/library/sections', { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'X-Plex-Token': t } }); if (!x.ok) throw new Error('Plex ' + x.status); return ((await x.json()).MediaContainer || {}).Directory || []; };
  const keys = l => l.map(d => String(d.key)).filter(k => /^\d{1,9}$/.test(k));
  try { const all = keys(await get(s.apiKey || '')); let mine = []; if (tok) { try { mine = keys(await get(tok)).filter(k => all.includes(k)); } catch {} } return { all, mine, at: Date.now() }; }
  catch { return { all: [], mine: [], at: Date.now() }; }
}
function liveView(u, snap, first) {
  const o = { t: snap.t, qb: {}, unraid: {}, plex: {}, sab: {}, health: {} }; if (first) o.hist = {};
  for (const s of db.services) {
    if (!svcOk(u, s)) continue;
    for (const k of ['qb', 'unraid', 'plex', 'sab']) if (snap[k][s.id]) { o[k][s.id] = k === 'plex' ? mineOnly(u, snap[k][s.id]) : snap[k][s.id]; if (k === 'plex' && ownNames(u)) grant(u, s.id, o[k][s.id].map(x => x.thumb)); }
    if (s.id in snap.health) o.health[s.id] = snap.health[s.id];
    if (first && live.hist[s.id]) o.hist[s.id] = live.hist[s.id];
  }
  return o;
}
function liveSend(c) {
  const u = db.users.find(x => x.id === c.uid);
  if (!u || !sessions.has(c.th)) { try { c.res.end(); } catch {} liveStop(c); return; }
  if (c.res.writableLength > 65536 || !live.snap) return;
  c.res.write(`data: ${JSON.stringify(liveView(u, live.snap, !c.sent))}\n\n`); c.sent = true;
}
async function liveTick() {
  if (live.busy || !liveClients.size) return; live.busy = true;
  try { live.snap = await liveBuild(); for (const c of [...liveClients]) liveSend(c); } catch {} finally { live.busy = false; }
}
function liveStop(c) { liveClients.delete(c); if (!liveClients.size && live.timer) { clearInterval(live.timer); live.timer = null; } }
function liveAdd(c) {
  liveClients.add(c); if (!live.timer) live.timer = setInterval(liveTick, +process.env.LIVE_MS || 1000);
  if (live.snap && Date.now() - live.snap.t < 3000) liveSend(c); else liveTick();
}

// ---- Uptime history (hourly buckets, kept for 48 hours) ----
const UPF = path.join(DATA, 'uptime.json'), UPB = 3600000, UPN = 48; let uptime = {}; try { uptime = JSON.parse(fs.readFileSync(UPF, 'utf8')); } catch {}
function uptNote(id, ok) {
  const b = Math.floor(Date.now() / UPB) * UPB, a = uptime[id] || (uptime[id] = []); let e = a[a.length - 1];
  if (!e || e.b !== b) { e = { b, ok: 0, n: 0 }; a.push(e); while (a.length > UPN) a.shift(); }
  e.n++; if (ok) e.ok++;
}
const uptBars = id => { const now = Math.floor(Date.now() / UPB) * UPB, m = new Map((uptime[id] || []).map(e => [e.b, e]));
  return Array.from({ length: UPN }, (_, i) => { const e = m.get(now - (UPN - 1 - i) * UPB); return e && e.n ? +(e.ok / e.n).toFixed(3) : null; }); };
const uptPct = id => { const a = uptime[id] || [], n = a.reduce((s, e) => s + e.n, 0); return n ? +(a.reduce((s, e) => s + e.ok, 0) / n * 100).toFixed(1) : null; };
function uptSave() { if (DEMO) return; try { fs.writeFileSync(UPF + '.tmp', JSON.stringify(uptime)); fs.renameSync(UPF + '.tmp', UPF); } catch {} }
if (DEMO) for (const x of db.services) uptime[x.id] = Array.from({ length: UPN }, (_, i) => ({ b: Math.floor(Date.now() / UPB) * UPB - (UPN - 1 - i) * UPB, n: 12, ok: (x.type === 'prowlarr' && i > 30 && i < 34) || (x.type === 'readarr' && i === 12) ? 5 : 12 }));
if (DEMO) db.statusLinks.push({ id: 'demo-link', name: 'Living room tablet', hash: th('demo-status-page-token-0001'), at: Date.now(), used: 0, scopes: { apps: true, traffic: true, downloads: true, upcoming: true, watching: true } });
async function qbUpload(s, fields, files) {
  await qb(s, '/api/v2/app/version');
  const u = s.url.replace(/\/+$/, ''), fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('torrents', new Blob([f.buf], { type: 'application/x-bittorrent' }), f.name);
  const x = await fetch(u + '/api/v2/torrents/add', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Cookie: qbCookie[s.id], Referer: u }, body: fd });
  const r = (await x.text()).trim();
  if (!x.ok || r === 'Fails.') throw new Error(r || 'qBittorrent refused the file');
}
const rssFlat = (node, base, out) => {
  for (const [k, v] of Object.entries(node || {})) {
    const pth = base ? base + '\\' + k : k;
    if (v && typeof v === 'object' && (typeof v.url === 'string' || 'uid' in v)) out.push({ path: pth, name: k, url: v.url, error: v.hasError, articles: v.articles || [] });
    else if (v && typeof v === 'object') rssFlat(v, pth, out);
  }
  return out;
};
const rssItems = async s => rssFlat(await qb(s, '/api/v2/rss/items?withData=true'), '', []);
const ruleDef = x => ({ enabled: !!x.enabled, mustContain: cut(x.mustContain, 500), mustNotContain: cut(x.mustNotContain, 500), useRegex: !!x.useRegex,
  episodeFilter: cut(x.episodeFilter, 200), smartFilter: !!x.smartFilter, affectedFeeds: (Array.isArray(x.affectedFeeds) ? x.affectedFeeds : []).filter(u => typeof u === 'string').slice(0, 100),
  savePath: cut(x.savePath, 500), assignedCategory: cut(x.assignedCategory, 200), ignoreDays: Math.max(0, +x.ignoreDays || 0), addPaused: x.addPaused === true ? true : null,
  ...(x.torrentContentLayout ? { torrentContentLayout: cut(x.torrentContentLayout, 40) } : {}), ...(x.lastMatch ? { lastMatch: cut(x.lastMatch, 60) } : {}),
  ...(Array.isArray(x.previouslyMatchedEpisodes) ? { previouslyMatchedEpisodes: x.previouslyMatchedEpisodes.slice(0, 2000).map(e => cut(e, 60)) } : {}) });
async function notify(title, body, html) {
  const list = ((db.alerts || {}).channels || []).filter(c => !channels.problem(c));
  if (!list.length) return false;
  const res = await Promise.allSettled(list.map(c => channels.send(c, title, body, html)));
  const bad = res.filter(x => x.status === 'rejected');
  if (bad.length === res.length) throw bad[0].reason;
  return true;
}
async function ext(s, path, opt = {}) {
  const r = await fetch(s.url.replace(/\/+$/, '') + path, { signal: AbortSignal.timeout(15000), ...opt, headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((Array.isArray(d) && d[0] && d[0].errorMessage) || (d && d.message) || 'Request failed (' + r.status + ')');
  return d;
}
const plexGet = async (s, pth) => {
  const x = await fetch(s.url.replace(/\/+$/, '') + pth, { signal: AbortSignal.timeout(8000), headers: { 'X-Plex-Token': s.apiKey, Accept: 'application/json' } });
  if (!x.ok) throw new Error('Plex returned ' + x.status); return x.json();
};
const streamsOf = async s => (await mediaSessions(s)).filter(x => ['playing', 'buffering'].includes(x.state));
const bz = async (s, pth, opt = {}) => {
  const x = await fetch(s.url.replace(/\/+$/, '') + pth, { signal: AbortSignal.timeout(60000), ...opt, headers: { 'X-API-KEY': s.apiKey, ...(opt.headers || {}) } });
  const t = await x.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!x.ok) throw new Error((d && (d.message || d.error)) || 'Bazarr returned ' + x.status); return d;
};
// Jackett's own settings API. It answers to the same API key that the searches use.
const jkCookies = new Map();
// Jackett's settings door wants either no password at all, or a login. With an admin password saved for the app, GoatMediaStackarr signs in like the browser does.
async function jkSession(s, force) {
  if (!s.pass) return '';
  const c = jkCookies.get(s.id);
  if (!force && c && c.pw === s.pass && Date.now() - c.at < 20 * 60e3) return c.v;
  const r = await fetch(s.url.replace(/\/+$/, '') + '/UI/Dashboard', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: s.pass }) });
  const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).find(x => /^Jackett=./i.test(x));
  if (!ck) throw Object.assign(new Error('Jackett did not accept the admin password saved in Settings, Apps.'), { plain: true });
  jkCookies.set(s.id, { v: ck, pw: s.pass, at: Date.now() }); return ck;
}
const jk = async (s, path, opt = {}, retry = true) => {
  const cookie = await jkSession(s, !retry), url = s.url.replace(/\/+$/, '') + '/api/v2.0/indexers' + path;
  const r = await fetch(cookie || opt.noKey ? url : url + (path.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(s.apiKey || ''),
    { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: opt.body, signal: AbortSignal.timeout(opt.timeout || 30000) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!r.ok) {
    if (retry && cookie && (r.status === 401 || r.status === 403 || r.status === 302)) return jk(s, path, opt, false);
    if (!cookie && !opt.noKey && [400, 401, 403].includes(r.status)) { try { return await jk(s, path, { ...opt, noKey: true }, false); } catch {} }   // a Jackett with no admin password lets its settings door open without the key
    throw Object.assign(new Error((d && (d.error || d.message)) || 'Jackett returned ' + r.status), { plain: true, code: r.status });
  }
  return d;
};
// Jackett only has two doors that answer to the API key alone: the torznab address (list of indexers, searches) and,
// on some versions, its settings API. The list tries the settings API first and falls back to the torznab list.
const xmlAttr = (t, n) => (new RegExp('\\b' + n + '="([^"]*)"').exec(t) || [])[1] || '';
const xmlText = (b, n) => { const m = new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>').exec(b); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim() : ''; };
const jkTorznab = async (s, id, query) => {
  const r = await fetch(`${s.url.replace(/\/+$/, '')}/api/v2.0/indexers/${encodeURIComponent(id)}/results/torznab/api?apikey=${encodeURIComponent(s.apiKey || '')}&${query}`, { signal: AbortSignal.timeout(45000) });
  const t = await r.text();
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Jackett did not accept the API key.'), { plain: true });
  return { ok: r.ok, text: t };
};
async function jkList(s, configured) {
  try { const l = await jk(s, '?configured=true'.replace('true', String(configured))); if (Array.isArray(l)) return configured ? l.filter(x => x.configured !== false) : l.filter(x => !x.configured); } catch {}
  const x = await jkTorznab(s, 'all', `t=indexers&configured=${configured}`);
  if (!x.ok || !/<indexers/i.test(x.text)) throw Object.assign(new Error('Jackett did not give its list of indexers. Check the address and API key of Jackett in Settings, Apps.'), { plain: true });
  return [...x.text.matchAll(/<indexer\b([^>]*)>([\s\S]*?)<\/indexer>/g)].map(m => ({ id: xmlAttr(m[1], 'id'), name: xmlText(m[2], 'title'), description: xmlText(m[2], 'description'), type: xmlText(m[2], 'type'), language: xmlText(m[2], 'language'),
    site_link: xmlText(m[2], 'link'), configured: xmlAttr(m[1], 'configured') === 'true', last_error: '' })).filter(i => i.id);
}
const JK_EDIT = ['inputstring', 'inputtext', 'inputbool', 'inputcheckbox', 'inputselect', 'inputtags'], JK_BOOL = ['inputbool', 'inputcheckbox'];
const jkField = f => {
  const t = String(f.type || ''), base = { id: String(f.id), type: t, name: String(f.name || f.id).slice(0, 200) };
  if (t === 'displayinfo') return { ...base, text: String(f.value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) };
  if (!JK_EDIT.includes(t)) return null;
  if (JK_BOOL.includes(t)) return { ...base, value: !!f.value };
  if (t === 'inputselect') return { ...base, value: String(f.value == null ? '' : f.value), options: Object.entries(f.options || {}).map(([k, v]) => [String(k), String(v)]) };
  return { ...base, value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value == null ? '' : f.value).slice(0, 2000) };
};
const jkCoerce = (f, v) => JK_BOOL.includes(f.type) ? v === true : f.type === 'inputtags' ? String(v).split(',').map(x => x.trim()).filter(Boolean).slice(0, 50) : String(v == null ? '' : v).slice(0, 2000);
const GB = n => (n / 1073741824).toFixed(n > 1e11 ? 0 : 1) + ' GB';
const hx = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Gathers everything the weekly newsletter talks about. Each part is optional: an app that is down just leaves its part out.
async function newsData() {
  const wk = Date.now() - 7 * DAY, hist = db.history.filter(h => h.at >= wk), rq = db.requests.filter(r => r.at >= wk), arr = db.services.filter(s => ['sonarr', 'radarr'].includes(s.type));
  const added = (await Promise.all(arr.map(s => artItems(s).catch(() => [])))).flat().filter(x => x.added && Date.parse(x.added) >= wk).sort((a, b) => Date.parse(b.added) - Date.parse(a.added)).slice(0, 8);
  const soon = [], from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  await Promise.all(arr.map(async s => { try {
    const tv = s.type === 'sonarr', d = await ext(s, `/api/v3/calendar?start=${from}&end=${to}&unmonitored=false` + (tv ? '&includeSeries=true' : ''));
    for (const x of Array.isArray(d) ? d : []) soon.push(tv ? { at: x.airDateUtc || x.airDate, title: cut((x.series || {}).title, 80), sub: `S${String(x.seasonNumber).padStart(2, '0')}E${String(x.episodeNumber).padStart(2, '0')}` }
      : { at: x.digitalRelease || x.physicalRelease || x.inCinemas, title: cut(x.title, 80), sub: 'Movie' });
  } catch {} }));
  soon.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const arrays = [];
  for (const u of db.services.filter(x => x.type === 'unraid')) try { const k = (await gql(u, '{ array { capacity { kilobytes { used total } } } }')).array.capacity.kilobytes; arrays.push({ name: u.name, pct: Math.round(+k.used / +k.total * 100) }); } catch {}
  return { added, soon: soon.slice(0, 8), hist: hist.length, size: hist.reduce((a, h) => a + (h.size || 0), 0), made: rq.length, approved: rq.filter(r => r.status === 'approved').length, ready: rq.filter(r => r.stage === 'available').length,
    waiting: db.requests.filter(r => r.status === 'pending').length, reports: db.reports.filter(r => r.status === 'open').length, off: db.services.filter(x => health[x.id] && !health[x.id].ok).map(x => x.name), arrays };
}
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }); };
function newsText(n) {
  const l = ['GoatMediaStackarr weekly newsletter', ''];
  if (n.added.length) { l.push('Added this week'); n.added.forEach(x => l.push(`  ${x.title}${x.year ? ' (' + x.year + ')' : ''}`)); l.push(''); }
  if (n.soon.length) { l.push('Coming up'); n.soon.forEach(x => l.push(`  ${when(x.at)}  ${x.title} ${x.sub}`)); l.push(''); }
  l.push(`Downloads finished: ${n.hist}${n.hist ? ' (' + GB(n.size) + ')' : ''}`);
  l.push(`Requests this week: ${n.made} made, ${n.approved} approved, ${n.ready} ready to watch`);
  if (n.waiting) l.push(`Waiting for approval: ${n.waiting}`);
  if (n.reports) l.push(`Open problem reports: ${n.reports}`);
  l.push(n.off.length ? 'Apps not responding: ' + n.off.join(', ') : 'All apps are responding');
  n.arrays.forEach(a => l.push(`${a.name} array: ${a.pct}% used`));
  return l.join('\n');
}
// The email version. Inline styles only and a single column, so it reads the same in Gmail, Outlook and on a phone.
function newsHtml(n, link) {
  const F = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif', h = t => `<h2 style="${F};font-size:15px;margin:26px 0 10px;color:#111">${hx(t)}</h2>`;
  const tile = x => { const img = /^https:\/\//.test(x.poster) ? `<img src="${hx(x.poster)}" width="104" height="156" alt="" style="display:block;width:104px;height:156px;object-fit:cover;border-radius:6px;background:#ddd">` : `<div style="width:104px;height:156px;border-radius:6px;background:#2b3245;color:#fff;${F};font-size:12px;text-align:center;line-height:156px">${x.tv ? 'TV' : 'Film'}</div>`;
    return `<td width="112" valign="top" style="padding:0 8px 12px 0">${img}<div style="${F};font-size:12px;font-weight:600;margin-top:6px;color:#111;width:104px">${hx(x.title)}</div><div style="${F};font-size:11px;color:#667">${x.year || ''}</div></td>`; };
  let rows = ''; for (let i = 0; i < n.added.length; i += 4) rows += '<tr>' + n.added.slice(i, i + 4).map(tile).join('') + '</tr>';
  const stat = (v, t) => `<td align="center" style="padding:12px 4px;background:#f2f4f8;border-radius:8px"><div style="${F};font-size:22px;font-weight:700;color:#111">${hx(v)}</div><div style="${F};font-size:11px;color:#667">${hx(t)}</div></td>`;
  const li = t => `<li style="${F};font-size:13px;color:#222;margin:4px 0">${t}</li>`;
  return `<!doctype html><html><body style="margin:0;background:#e9ecf2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px"><tr><td style="padding:26px 26px 8px">
<div style="${F};font-size:12px;color:#667">${hx(when(Date.now()))}</div><div style="${F};font-size:24px;font-weight:700;color:#111;margin-top:2px">Your week on GoatMediaStackarr</div>
${n.added.length ? h('Added this week') + `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>` : ''}
${n.soon.length ? h('Coming up') + `<ul style="margin:0;padding-left:18px">${n.soon.map(x => li(`<b>${hx(when(x.at))}</b> &nbsp;${hx(x.title)} <span style="color:#667">${hx(x.sub)}</span>`)).join('')}</ul>` : ''}
${h('This week in numbers')}<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${stat(n.hist, 'downloads finished')}${stat(n.made, 'requests made')}${stat(n.ready, 'ready to watch')}</tr></table>
<ul style="margin:12px 0 0;padding-left:18px">${n.waiting ? li(`${n.waiting} request${n.waiting > 1 ? 's' : ''} waiting for approval`) : ''}${n.reports ? li(`${n.reports} open problem report${n.reports > 1 ? 's' : ''}`) : ''}${li(n.off.length ? 'Not responding: ' + hx(n.off.join(', ')) : 'All apps are responding')}${n.arrays.map(a => li(`${hx(a.name)} array is ${a.pct}% full`)).join('')}</ul>
${link ? `<p style="margin:26px 0 0"><a href="${hx(link)}" style="${F};display:inline-block;background:#4f7cff;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open GoatMediaStackarr</a></p>` : ''}
</td></tr><tr><td style="padding:22px 26px;${F};font-size:11px;color:#889">You get this because the weekly newsletter is on in GoatMediaStackarr, under Settings, Alerts.</td></tr></table></td></tr></table></body></html>`;
}
const sendNews = async () => { const n = await newsData(); return notify('GoatMediaStackarr weekly newsletter', newsText(n), newsHtml(n, baseUrl())); };
const BK = path.join(DATA, 'backups'), BKRE = /^(auto|pre-restore)-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;
function backupNow(kind = 'auto') {
  fs.mkdirSync(BK, { recursive: true, mode: 0o700 });
  const d = new Date().toISOString(), name = `${kind}-${d.slice(0, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}.json`;
  fs.writeFileSync(path.join(BK, name), dehydrate(db), { mode: 0o600 });
  const keep = (db.settings.backup && db.settings.backup.keep) || 7, all = fs.readdirSync(BK).filter(f => BKRE.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep - 3))) try { fs.unlinkSync(path.join(BK, f)); } catch {}
  db.settings.backup = { ...(db.settings.backup || {}), last: Date.now() }; save();
  return name;
}
async function vpnStatus(s) {
  const c = vpnCache[s.id]; if (c && Date.now() - c.t < 60000) return c.r;
  const md = await qb(s, '/api/v2/sync/maindata?rid=0'), st = (md && md.server_state) || {}, ip = st.last_external_address_v4 || '';
  if (Date.now() - homeIp.t > 300000) {
    try { homeIp = { v: (await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(6000) })).text()).trim(), t: Date.now() }; }
    catch { homeIp = { v: homeIp.v, t: Date.now() }; }
  }
  const r = { ip, conn: st.connection_status, vpn: ip && homeIp.v ? ip !== homeIp.v : null };
  vpnCache[s.id] = { t: Date.now(), r }; return r;
}
// ---------- Where each request really is ----------
// requested (pending) → approved → searching → downloading (with progress) → importing (copied or hardlinked into
// the library) → library (the files are there, Plex or Jellyfin has not found them yet) → available.
// Read straight from Radarr or Sonarr (queue and files) and from Plex and Jellyfin, so it does not wait on Seerr.
async function onMediaServer(x) {
  const tv = x.mediaType === 'tv', id = String(x.mediaId), title = String(x.title || '').trim().toLowerCase(), yr = +x.year || 0;
  const same = (t, y) => String(t || '').trim().toLowerCase() === title && (!yr || !y || Math.abs(+y - yr) <= 1);
  for (const s of db.services.filter(isMS)) { try {
    if (s.type === 'plex') {
      const d = await plexGet(s, `/hubs/search?query=${encodeURIComponent(x.title)}&includeGuids=1&limit=20`);
      const items = (((d.MediaContainer || {}).Hub) || []).flatMap(h => h.Metadata || []).filter(m => m.type === (tv ? 'show' : 'movie'));
      if (items.some(m => (m.Guid || []).some(g => g.id === 'tmdb://' + id) || same(m.title, m.year))) return s.name;
    } else {
      const d = await (await jfGet(s, `/Items?Recursive=true&IncludeItemTypes=${tv ? 'Series' : 'Movie'}&searchTerm=${encodeURIComponent(x.title)}&Fields=ProviderIds&Limit=20`)).json();
      if (((d && d.Items) || []).some(m => String((m.ProviderIds || {}).Tmdb || '') === id || same(m.Name, m.ProductionYear))) return s.name;
    }
  } catch {} }
  return '';
}
// Ask the media servers to look for new files (once per request), so "available" does not wait for their next scan.
async function askScan() {
  for (const s of db.services.filter(isMS)) {
    if (s.type === 'jellyfin') await jfGet(s, '/Library/Refresh', { method: 'POST' }).catch(() => {});
    else await fetch(s.url.replace(/\/+$/, '') + '/library/sections/all/refresh', { signal: AbortSignal.timeout(8000), headers: { 'X-Plex-Token': s.apiKey || '' } }).catch(() => {});
  }
}
async function stageOf(x, cache) {
  const tv = x.mediaType === 'tv', kind = tv ? 'sonarr' : 'radarr', want = Array.isArray(x.seasons) && x.seasons.length ? x.seasons : null;
  let item = null, svc = null;
  for (const s of db.services.filter(y => y.type === kind)) { try {
    if (tv) { const l = cache[s.id] || (cache[s.id] = await arrGet(s, '/api/v3/series')); item = (Array.isArray(l) ? l : []).find(y => +y.tmdbId === +x.mediaId) || null; }
    else { const l = await arrGet(s, '/api/v3/movie?tmdbId=' + encodeURIComponent(x.mediaId)); item = Array.isArray(l) && l[0] || null; }
    if (item) { svc = s; break; }
  } catch {} }
  if (!item) return { stage: 'approved' };
  const q = await arrGet(svc, tv ? `/api/v3/queue/details?seriesId=${item.id}` : `/api/v3/queue/details?movieId=${item.id}`).catch(() => []);
  const recs = (Array.isArray(q) ? q : (q && q.records) || []).filter(r => !want || want.includes(r.seasonNumber != null ? r.seasonNumber : (r.episode || {}).seasonNumber));
  let have = 0, total = 0;
  if (tv) {
    const full = await arrGet(svc, `/api/v3/series/${item.id}`).catch(() => item);
    for (const se of (full.seasons || [])) if (se.seasonNumber > 0 && (!want || want.includes(se.seasonNumber))) { const st = se.statistics || {}; have += +st.episodeFileCount || 0; total += +st.episodeCount || 0; }
  } else { have = item.hasFile ? 1 : 0; total = 1; }
  const imp = r => /^import/i.test(r.trackedDownloadState || '') || (r.status === 'completed' && r.trackedDownloadState !== 'imported' && !/fail/i.test(r.trackedDownloadState || ''));
  const bad = r => /fail/i.test(r.trackedDownloadState || '') || r.status === 'failed';
  const dl = recs.filter(r => !imp(r) && !bad(r));
  if (total > 0 && have >= total) {
    if (!db.services.some(isMS)) return { stage: 'available' };
    const where = await onMediaServer(x);
    if (where) return { stage: 'available', where };
    if (!x.scanAsked) { x.scanAsked = Date.now(); askScan(); }
    return { stage: 'library' };
  }
  if (recs.some(imp)) return { stage: 'importing' };
  if (dl.length) {
    const size = dl.reduce((a, r) => a + (+r.size || 0), 0), left = dl.reduce((a, r) => a + (+r.sizeleft || 0), 0);
    return { stage: 'downloading', progress: size > 0 ? Math.max(0, Math.min(1, 1 - left / size)) : 0, eta: cut(dl.map(r => r.timeleft).filter(Boolean).sort().pop() || '', 20), paused: dl.every(r => r.status === 'paused') };
  }
  if (recs.length && recs.every(bad)) return { stage: 'failed' };
  if (have > 0) return { stage: (await onMediaServer(x)) ? 'partial' : 'library' };
  return { stage: 'searching' };
}
async function refreshRequests() {
  const open = db.requests.filter(x => x.status === 'approved' && x.stage !== 'available' && x.stage !== 'declined').slice(-40); let changed = false;
  const cache = {};
  if (open.some(x => x.mediaType === 'tv')) await Promise.all(db.services.filter(y => y.type === 'sonarr').map(async y => { cache[y.id] = await arrGet(y, '/api/v3/series').catch(() => []); }));
  await Promise.all(open.map(async x => { try {
    // Seerr still has the last word on a declined request.
    const sv = x.seerrId && db.services.find(y => y.id === x.sid);
    if (sv) { const r = await fetch(sv.url.replace(/\/+$/, '') + '/api/v1/request/' + x.seerrId, { signal: AbortSignal.timeout(8000), headers: { 'X-Api-Key': sv.apiKey } }).catch(() => null);
      const d = r && r.ok ? await r.json().catch(() => null) : null; if (d && d.status === 3) { x.stage = 'declined'; changed = true; return; }
      if (d && (d.media || {}).status === 5 && !db.services.some(y => y.type === (x.mediaType === 'tv' ? 'sonarr' : 'radarr'))) { x.stage = 'available'; changed = true; return; } }
    const st = await stageOf(x, cache);
    const before = JSON.stringify([x.stage, x.progress, x.eta, x.where]);
    x.stage = st.stage; x.progress = st.progress; x.eta = st.eta || undefined; x.where = st.where || undefined; x.paused = st.paused || undefined; x.checked = Date.now();
    if (JSON.stringify([x.stage, x.progress, x.eta, x.where]) !== before) changed = true;
    if (st.stage === 'available' && !x.toldReady) { x.toldReady = Date.now(); await notifyUser(userOf(x.uid), 'Ready to watch', `${x.title} is now available${st.where ? ' on ' + st.where : ''}.`).catch(() => {}); }
  } catch {} }));
  if (changed) save();
}
// ---------- Streaming data: how much each person streams from Plex and Jellyfin, per calendar month ----------
// Every check (MONITOR_MS, 30 seconds) adds bitrate × time for each stream that is playing. A person over their monthly
// limit has their streams stopped with a message saying why; it starts again on the 1st. Admins are never limited,
// and a media-server account that matches no profile here is counted but not limited.
const monthKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const streamCfg = () => { const c = db.settings.stream || {}; return { defaultGb: c.defaultGb == null ? 100 : +c.defaultGb, wanOnly: !!c.wanOnly }; };
const limitGb = v => { const n = Math.round((+v || 0) * 1000) / 1000; return n > 0 ? Math.min(n, 1e6) : 0; };
const streamLimitOf = u => !u || u.role === 'admin' ? 0 : u.streamLimit != null ? +u.streamLimit : streamCfg().defaultGb;
const streamOwner = name => {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  const is = x => x && String(x).trim().toLowerCase() === n;
  return db.users.find(u => is(u.plex && u.plex.name) || is(u.plexName)) || db.users.find(u => is(u.name)) || null;
};
const streamUsed = (e, cfg = streamCfg()) => e ? (cfg.wanOnly ? e.w : e.b) || 0 : 0;
const streamOf = (u, month = monthKey()) => ((db.streamUse || {})[month] || {})[u.id] || null;
const nextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };
const streamSeen = {}, streamStopped = {};
let streamSavedAt = 0;
async function stopStream(s, x, why) {
  if (s.type === 'jellyfin') {
    await jfGet(s, `/Sessions/${x.id}/Message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Header: 'Streaming limit reached', Text: why, TimeoutMs: 15000 }) }).catch(() => {});
    await jfGet(s, `/Sessions/${x.id}/Playing/Stop`, { method: 'POST' });
  } else {
    const r = await fetch(s.url.replace(/\/+$/, '') + `/status/sessions/terminate?sessionId=${encodeURIComponent(x.id)}&reason=${encodeURIComponent(why)}`, { signal: AbortSignal.timeout(8000), headers: { 'X-Plex-Token': s.apiKey || '' } });
    if (!r.ok) throw new Error('Plex returned ' + r.status + (r.status === 401 || r.status === 403 ? ' (stopping streams needs Plex Pass on the server account)' : ''));
  }
}
async function streamTick() {
  const now = Date.now(), mk = monthKey(now), cfg = streamCfg(), use = db.streamUse || (db.streamUse = {}), month = use[mk] || (use[mk] = {});
  let changed = false;
  for (const s of db.services.filter(isMS)) {
    let list; try { list = await mediaSessions(s); } catch { continue; }
    const alive = new Set();
    for (const x of list) {
      if (!x.id) continue;
      const k = s.id + ':' + x.id, last = streamSeen[k], playing = ['playing', 'buffering'].includes(x.state); alive.add(k); streamSeen[k] = now;
      const u = streamOwner(x.user), key = u ? u.id : '@' + cut(String(x.user || '?').toLowerCase(), 60);
      const e = month[key] || (month[key] = { b: 0, w: 0, n: u ? u.name : cut(x.user || '?', 60) });
      if (last && playing && x.kbps > 0) {
        const bytes = Math.round(x.kbps * 125 * Math.min(now - last, MON_MS * 3) / 1000);
        e.b += bytes; if (x.where === 'wan') e.w += bytes; changed = true;
      }
      const lim = streamLimitOf(u); if (!u || !(lim > 0) || !playing) continue;
      const used = streamUsed(e, cfg), pct = used / (lim * 1e9) * 100, gbs = gbText(used);
      if (pct >= 80 && !(e.warn >= 80)) { e.warn = 80; changed = true; notifyUser(u, 'Streaming: 80% used', `You have streamed ${gbs} of your ${lim} GB for this month.`).catch(() => {}); }
      if (pct < 100 || (cfg.wanOnly && x.where !== 'wan')) continue;
      if (streamStopped[k] && now - streamStopped[k] < 60000) continue;
      streamStopped[k] = now;
      const why = `You have streamed your ${lim} GB for this month. It starts again on ${new Date(nextMonth()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Ask the server owner if you need more.`;
      try { await stopStream(s, x, why); audit('GoatMediaStackarr', 'Stopped a stream', `${u.name}: monthly streaming limit of ${lim} GB reached (${s.name})`); }
      catch (err) { if (!e.stopErr) { e.stopErr = 1; audit('GoatMediaStackarr', 'Could not stop a stream', `${u.name} is over the streaming limit, but ${s.name} refused: ${cut(err.message, 160)}`); } }
      if (!(e.warn >= 100)) { e.warn = 100; changed = true; notifyUser(u, 'Streaming limit reached', why).catch(() => {}); if ((db.alerts || {}).streamLimit !== false) notify('Streaming limit reached', `${u.name} has streamed ${gbs} of ${lim} GB this month. Their streams are stopped until the 1st.`).catch(() => {}); }
    }
    for (const k of Object.keys(streamSeen)) if (k.startsWith(s.id + ':') && !alive.has(k)) { delete streamSeen[k]; delete streamStopped[k]; }
  }
  // Keep a year of months.
  for (const m of Object.keys(use).sort().slice(0, -12)) { delete use[m]; changed = true; }
  if (changed && now - streamSavedAt > 60000) { streamSavedAt = now; save(); }
}
const streamSummary = u => {
  const cfg = streamCfg(), e = streamOf(u), lim = streamLimitOf(u), months = Object.keys(db.streamUse || {}).sort().slice(-6);
  return { month: monthKey(), bytes: streamUsed(e, cfg), all: e ? e.b : 0, wan: e ? e.w : 0, limitGb: lim, custom: u.streamLimit != null, defaultGb: cfg.defaultGb, wanOnly: cfg.wanOnly, resets: nextMonth(),
    history: months.map(m => ({ month: m, bytes: streamUsed(((db.streamUse || {})[m] || {})[u.id], cfg) })) };
};

async function monitor() {
  if (mon.busy) return; mon.busy = true;
  try {
    const a = db.alerts || {}, safe = async f => { try { await f(); } catch {} }, now = Date.now() / 1000, sigOf = r => `${r.category}|${r.ratio}|${r.minutes}`;
    for (const s of db.services.filter(x => x.type === 'qbittorrent')) await safe(async () => {
      const list = await qb(s, '/api/v2/torrents/info'), first = !mon.seeded[s.id]; mon.seeded[s.id] = 1; let added = false;
      for (const x of list) {
        if (x.progress >= 1 && x.completion_on > 0 && x.completion_on < 4e9 && now - x.completion_on < 2592000) {
          const key = x.hash + ':' + x.completion_on;
          if (!histKeys.has(key)) {
            histKeys.add(key); added = true;
            db.history.push({ hash: x.hash, name: x.name, size: x.size, at: x.completion_on * 1000, cat: x.category || '', svc: s.id });
            if (!first && a.finished) await notify('Download finished', x.name).catch(() => {});
          }
        }
      }
      if (added) { db.history.sort((p, q) => p.at - q.at); if (db.history.length > 1000) db.history.splice(0, db.history.length - 1000); save(); }
      const rules = db.seedRules.filter(r => r.sid === s.id).sort((p, q) => (p.category === '*') - (q.category === '*')), groups = new Map();
      for (const x of list) {
        const r = rules.find(r => r.category === '*' || r.category === (x.category || '')); if (!r || mon.share[x.hash] === sigOf(r)) continue;
        if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x.hash);
      }
      for (const [r, hl] of groups) {
        await qb(s, '/api/v2/torrents/setShareLimits', { hashes: hl.join('|'), ratioLimit: r.ratio > 0 ? r.ratio : -2, seedingTimeLimit: r.minutes > 0 ? r.minutes : -2, inactiveSeedingTimeLimit: -2 });
        hl.forEach(h => { mon.share[h] = sigOf(r); });
      }
    });
    await Promise.all(db.services.map(async s => {
      let ok = false; try { ok = await test(s); } catch {}
      health[s.id] = { ok, t: Date.now() };
      uptNote(s.id, ok);
      if (!a.offline) return;
      const st = mon.up[s.id] || (mon.up[s.id] = { ok: true, n: 0 });
      if (ok) { if (!st.ok) await notify('App back online', s.name + ' is reachable again').catch(() => {}); st.ok = true; st.n = 0; }
      else if (++st.n >= 2 && st.ok) { st.ok = false; await notify('App offline', s.name + ' is not responding').catch(() => {}); }
    }));
    if (a.disk) for (const s of db.services.filter(x => x.type === 'unraid')) await safe(async () => {
      const k = (await gql(s, '{ array { capacity { kilobytes { used total } } } }')).array.capacity.kilobytes, pct = +k.used / +k.total * 100;
      if (pct >= a.diskPct && !mon.disk[s.id]) { mon.disk[s.id] = 1; await notify('Array almost full', pct.toFixed(0) + '% of the array is used'); }
      else if (pct < a.diskPct - 3) mon.disk[s.id] = 0;
    });
    if (a.vpn) for (const s of db.services.filter(x => x.type === 'qbittorrent')) await safe(async () => {
      const v = await vpnStatus(s);
      if (v.vpn === false && !mon.vpn[s.id]) { mon.vpn[s.id] = 1; await notify('VPN not active', s.name + ' is not using the VPN'); }
      else if (v.vpn === true) mon.vpn[s.id] = 0;
    });
    const th0 = db.settings.throttle || {}, held = th0.held || {};
    if (th0.on || Object.keys(held).length) await safe(async () => {
      let streams = 0; if (th0.on) for (const pl of db.services.filter(isMS)) streams += (await streamsOf(pl)).length;
      for (const s of db.services.filter(x => x.type === 'qbittorrent')) {
        const slow = Number(await qb(s, '/api/v2/transfer/speedLimitsMode')) === 1, ours = !!held[s.id];
        if (th0.on && streams > 0) { mon.idle[s.id] = 0; if (!slow && !ours) { await qb(s, '/api/v2/transfer/toggleSpeedLimitsMode', {}); db.settings.throttle.held = { ...held, [s.id]: 1 }; held[s.id] = 1; save(); audit('GoatMediaStackarr', 'Slowed downloads', `${streams} stream${streams === 1 ? '' : 's'} playing`); } }
        else if (ours && (!th0.on || (mon.idle[s.id] = (mon.idle[s.id] || 0) + 1) >= 2)) {
          if (slow) await qb(s, '/api/v2/transfer/toggleSpeedLimitsMode', {});
          delete held[s.id]; db.settings.throttle.held = { ...held }; save(); audit('GoatMediaStackarr', 'Restored download speed', 'No one is streaming');
        }
      }
    });
    const wk = db.settings.weekly;
    if (wk && wk.on) await safe(async () => {
      const d = new Date(); d.setHours(wk.hour ?? 9, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() - (wk.day ?? 0) + 7) % 7)); if (d.getTime() > Date.now()) d.setDate(d.getDate() - 7);
      if ((wk.last || 0) < d.getTime()) { wk.last = Date.now(); save(); await sendNews(); }
    });
    const bc = db.settings.backup || {};
    if (bc.on && new Date(bc.last || 0).toDateString() !== new Date().toDateString() && new Date().getHours() >= (bc.hour ?? 3)) await safe(async () => { backupNow(); });
    for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
    if (mon.n % 10 === 0) uptSave();
    await safe(streamTick);
    if (++mon.n % 2 === 0) await safe(refreshRequests);
  } finally { mon.busy = false; }
}


// ---- What a status page shows (shared by the public link and the admin preview)
async function statusData(x) {
  const out = { name: x.name, at: Date.now(), note: x.note || '', look: x.look || 'auto' }, qs = db.services.filter(s => s.type === 'qbittorrent');
  if (x.scopes.apps) out.apps = db.services.map(s => ({ name: s.name, type: s.type, ok: health[s.id] ? health[s.id].ok : null, bars: uptBars(s.id), pct: uptPct(s.id) }));
  if (x.scopes.watching) { out.watching = { count: 0, kbps: 0, items: [] }; for (const s of db.services.filter(isMS)) { try {
    const l = (await mediaSessions(s)).filter(y => ['playing', 'buffering', 'paused'].includes(y.state)); out.watching.count += l.length; out.watching.kbps += l.reduce((a, y) => a + y.kbps, 0);
    out.watching.items.push(...l.slice(0, 6).map(y => ({ title: y.title, sub: y.sub, state: y.state, progress: y.progress }))); } catch {} } }
  if (x.scopes.traffic || x.scopes.downloads) for (const q of qs.slice(0, 1)) { try {
    const [ti, l] = await Promise.all([qb(q, '/api/v2/transfer/info'), x.scopes.downloads ? qb(q, '/api/v2/torrents/info') : Promise.resolve([])]);
    if (x.scopes.traffic) out.traffic = { dl: ti.dl_info_speed || 0, ul: ti.up_info_speed || 0 };
    if (x.scopes.downloads) out.downloads = l.filter(y => y.progress < 1).slice(0, 10).map(y => ({ name: y.name, progress: y.progress, state: y.state }));
  } catch {} }
  if (x.scopes.upcoming) { out.upcoming = []; const today = new Date().toISOString().slice(0, 10), end = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    for (const s of db.services.filter(y => y.type === 'sonarr' || y.type === 'radarr')) { try {
      const cal = await ext(s, `/api/v3/calendar?start=${today}&end=${end}${s.type === 'sonarr' ? '&includeSeries=true' : ''}`);
      for (const e of cal) out.upcoming.push({ title: s.type === 'sonarr' ? (e.series || {}).title : e.title, sub: s.type === 'sonarr' ? `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}` : 'Movie', date: e.airDateUtc || e.digitalRelease || e.physicalRelease || e.inCinemas });
    } catch {} }
    out.upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date))); out.upcoming = out.upcoming.slice(0, 12); }
  return out;
}

// ---- Sign-in wallpapers: pictures you drop in <data folder>/wallpapers replace the built-in scenes ----
const WPD = path.join(DATA, 'wallpapers'), WPX = /^[\w][\w .()-]{0,80}\.(jpe?g|png|webp)$/i, WPM = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const wpList = () => { try { return fs.readdirSync(WPD).filter(f => WPX.test(f) && fs.statSync(path.join(WPD, f)).size < 12e6).sort().slice(0, 56); } catch { return []; } };
const wpMode = () => (db.settings || {}).loginArt === 'scenes' ? 'scenes' : 'library';

// ---- Library artwork: posters and backdrops for the dashboard, and cached backdrops for the sign-in page ----
const artCache = new Map();                       // service id -> { at, p }
const mediaUrl = (s, o, type) => {
  const i = (o.images || []).find(x => x.coverType === type); if (!i) return { url: '', local: '' };
  const lm = String(i.url || '').split('?')[0].match(/\/(MediaCover\/[\w./%-]+)$/), local = lm && !lm[1].includes('..') ? '/' + lm[1] : '';
  const remote = i.remoteUrl && /^(https:\/\/|data:image\/)/.test(i.remoteUrl) ? i.remoteUrl : '';
  return { url: remote || (local ? '/api/artimg?sid=' + s.id + '&p=' + encodeURIComponent(local) : ''), local };
};
function artItems(s) {
  const c = artCache.get(s.id); if (c && Date.now() - c.at < 6e5) return c.p;
  const tv = s.type === 'sonarr';
  const pr = ext(s, tv ? '/api/v3/series' : '/api/v3/movie', { signal: AbortSignal.timeout(60000) }).then(d => (Array.isArray(d) ? d : []).map(x => {
    const rt = x.ratings || {}, po = mediaUrl(s, x, 'poster'), fa = mediaUrl(s, x, 'fanart');
    return { sid: s.id, id: x.id, tv, title: cut(x.title, 120), year: x.year || 0, poster: po.url, fanart: fa.url, fl: fa.local, overview: cut(x.overview, 280),
      genres: (x.genres || []).slice(0, 3), rating: tv ? +rt.value || 0 : +((rt.imdb || {}).value || (rt.tmdb || {}).value || rt.value) || 0, added: x.added || '',
      status: x.status || '', maker: cut((tv ? x.network : x.studio) || '', 60), runtime: x.runtime || 0, cert: cut(x.certification, 12),
      have: tv ? (x.statistics || {}).episodeFileCount || 0 : (x.hasFile ? 1 : 0) };
  }).filter(x => x.poster || x.fanart));
  artCache.set(s.id, { at: Date.now(), p: pr }); pr.catch(() => artCache.delete(s.id)); return pr;
}
const shuffled = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const imgKind = b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'png' : b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : '';
// Gets one backdrop. Tries the app itself first (no internet needed; the key is sent as a header, then as a query for builds that only accept that), then the public address.
async function artBytes(s, x) {
  const tries = [];
  if (x.fl) { const u = s.url.replace(/\/+$/, '') + x.fl; tries.push([u, { headers: { 'X-Api-Key': s.apiKey } }], [u + '?apikey=' + encodeURIComponent(s.apiKey), {}]); }
  try { const u = new URL(x.fanart); if (u.protocol === 'https:' && !/^(localhost$|\[|\d+\.\d+\.\d+\.\d+$)/.test(u.hostname)) tries.push([u.href, {}]); } catch {}
  let last = 'no usable address';
  for (const [target, opt] of tries) {
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(25000), redirect: 'follow', ...opt });
      if (!r.ok) throw new Error('answered ' + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length < 4e3 || b.length > 9e6 || !imgKind(b)) throw new Error('not a usable picture');
      return { b, ext: imgKind(b) };
    } catch (e) { last = (e.name === 'TimeoutError' ? 'took too long' : e.message === 'fetch failed' ? 'could not connect' + (e.cause && e.cause.code ? ' (' + e.cause.code + ')' : '') : e.message); }
  }
  throw new Error(last);
}
const LIBWP = /^lib-[0-9a-f]{10}\.(jpg|png|webp)$/;
let wpBusy = false, wpKicked = 0, wpState = { at: 0, running: false, ok: false, count: 0, saved: 0, errors: [] };
async function wpSync(force) {
  if (DEMO || wpBusy || (wpMode() === 'scenes' && !force)) return wpState;
  wpBusy = true; wpState = { ...wpState, running: true };
  const st = { at: Date.now(), running: false, ok: false, count: 0, saved: 0, errors: [] }, note = m => { if (st.errors.length < 4 && !st.errors.includes(m)) st.errors.push(m); };
  try {
    const svcs = db.services.filter(s => ['sonarr', 'radarr'].includes(s.type)), by = Object.fromEntries(svcs.map(s => [s.id, s]));
    if (!svcs.length) note('Add Sonarr or Radarr in Settings, then Apps.');
    const items = (await Promise.all(svcs.map(s => artItems(s).catch(e => { note(`${s.name}: ${e.message}`); return []; })))).flat().filter(x => x.fanart || x.fl);
    if (svcs.length && !items.length && !st.errors.length) note('Your library has no backdrops yet.');
    if (items.length) {
      fs.mkdirSync(WPD, { recursive: true });
      const have = fs.readdirSync(WPD).filter(f => LIBWP.test(f)), keep = new Set(), queue = shuffled(items).slice(0, 48); let tried = 0;
      const worker = async () => {
        while (queue.length && keep.size < 16 && tried < 40) {
          const x = queue.shift(), h = th(x.sid + ':' + x.id).slice(0, 10), old = have.find(f => f.startsWith('lib-' + h + '.')); tried++;
          if (old) { keep.add(old); continue; }
          try { const { b, ext: e } = await artBytes(by[x.sid], x), n = `lib-${h}.${e}`; fs.writeFileSync(path.join(WPD, n), b); keep.add(n); st.saved++; }
          catch (e) { note(`${x.title}: ${e.message}`); }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (keep.size >= 4) for (const f of have) if (!keep.has(f)) { try { fs.unlinkSync(path.join(WPD, f)); } catch {} }   // rotate: drop old ones only once enough new ones are saved
      st.count = keep.size;
    }
    st.ok = wpList().some(f => LIBWP.test(f));
  } catch (e) { note(e.message); } finally { wpBusy = false; wpState = st; console.log(`[wallpapers] ${st.ok ? 'ready' : 'no pictures yet'}: saved ${st.saved}, using ${st.count}` + (st.errors.length ? '. ' + st.errors[0] : '')); }
  return wpState;
}
const wpKick = () => { if (Date.now() - wpKicked > 6e4) { wpKicked = Date.now(); wpSync(); } };

// ---- Password recovery by email ----
const RESET_MS = 30 * 60e3, failsRst = {}, askRst = {};
const mailer = () => ((db.alerts || {}).channels || []).find(c => c.type === 'email' && !channels.problem(c));
const baseUrl = () => String(process.env.PUBLIC_URL || (db.settings || {}).publicUrl || '').replace(/\/+$/, '');
const sendRecovery = (c, to, subject, text) => require('./lib/smtp').sendMail({ host: c.host, port: c.port, secure: c.secure, user: c.user, pass: c.pass, from: c.from, insecure: !!c.insecure, to, subject, text });

// ---- Sign in with Plex: people open Plex's own sign-in window (so GoatMediaStackarr never sees their password and keeps no Plex token),
// then GoatMediaStackarr checks that their Plex account can reach YOUR Plex server and signs them in to a regular (never admin) profile. ----
const PLEXTV = () => String(process.env.PLEX_TV_URL || (DEMO ? `http://127.0.0.1:${PORT}/__demo/plextv` : 'https://plex.tv')).replace(/\/+$/, '');
const PLEXAUTH = () => process.env.PLEX_AUTH_URL || (DEMO ? '/__demo/plextv/auth' : 'https://app.plex.tv/auth');
function plexCid() { if (!db.settings.plexClientId) { db.settings.plexClientId = crypto.randomBytes(16).toString('hex'); save(); } return db.settings.plexClientId; }
async function ptv(pth, opt = {}) {
  const r = await fetch(PLEXTV() + pth, { signal: AbortSignal.timeout(10000), ...opt, headers: { Accept: 'application/json', 'X-Plex-Product': 'GoatMediaStackarr', 'X-Plex-Version': VERSION, 'X-Plex-Client-Identifier': plexCid(), 'X-Plex-Device-Name': 'GoatMediaStackarr', 'X-Plex-Platform': 'Web', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error('plex.tv answered ' + r.status);
  return r.json();
}
const PLEX_PERMS = { add: false, control: false, remove: false, request: true };
function plexCfg() {
  const c = db.settings.plexLogin || {}, s = db.services.find(x => x.id === c.sid && x.type === 'plex') || db.services.find(x => x.type === 'plex');
  return { on: !!c.on && !!s, sid: s ? s.id : '', s, auto: c.auto !== false,
    access: (Array.isArray(c.access) ? c.access : db.services.filter(x => x.type === 'seerr').map(x => x.id)).filter(a => db.services.some(x => x.id === a)),
    perms: { ...PLEX_PERMS, ...(c.perms || {}) }, hide: cleanHide(c.hide) };
}
const plexPend = new Map(), plexAsk = {}, plexBad = {};
class PlexDeny extends Error { constructor(m, code = 403) { super(m); this.code = code; } }
// Turns a Plex token into a GoatMediaStackarr profile (found, linked or created). The token is thrown away afterwards.
async function plexProfile(token) {
  const cfg = plexCfg(); if (!cfg.on) throw new PlexDeny('Sign in with Plex is turned off.');
  const h = { 'X-Plex-Token': token }, who = await ptv('/api/v2/user', { headers: h });
  const pid = String(who.uuid || who.id || ''), pname = cut(who.username || who.title || '', 60).trim();
  if (!pid || !pname) throw new PlexDeny('Plex did not say who you are. Please try again.', 502);
  let mid = ''; try { mid = ((await (await fetch(cfg.s.url.replace(/\/+$/, '') + '/identity', { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'X-Plex-Token': cfg.s.apiKey || '' } })).json()).MediaContainer || {}).machineIdentifier || ''; } catch {}
  if (!mid) throw new PlexDeny('GoatMediaStackarr could not reach the Plex server to check your access. Ask the server owner.', 502);
  const res = await ptv('/api/v2/resources?includeHttps=1&includeRelay=1', { headers: h });
  const srvRes = (Array.isArray(res) ? res : []).find(x => x.clientIdentifier === mid && /server/.test(x.provides || ''));
  if (!srvRes) throw new PlexDeny('This Plex account does not have access to this Plex server.');
  let u = db.users.find(x => x.plex && x.plex.id === pid);
  if (!u) { u = db.users.find(x => !x.plex && x.role === 'user' && x.plexName && x.plexName.toLowerCase() === pname.toLowerCase()); if (u) u.plex = { id: pid, name: pname }; }
  if (!u) {
    if (!cfg.auto) throw new PlexDeny(`The server owner has not added you yet. Ask them to add the Plex name "${pname}".`);
    let name = pname, n = 1; while (db.users.some(x => x.name.trim().toLowerCase() === name.toLowerCase())) name = `${pname} (Plex${n > 1 ? ' ' + n : ''})`, n++;
    u = mkUser(name, crypto.randomBytes(24).toString('hex'), 'user'); u.access = cfg.access; u.perms = cfg.perms; u.plex = { id: pid, name: pname };
    db.users.push(u); audit('GoatMediaStackarr', 'Created a profile from Plex', name);
  }
  if (u.role === 'admin') throw new PlexDeny('Admins sign in with their GoatMediaStackarr password.');
  u.plex.name = pname; u.plexLibs = await plexLibs(cfg.s, srvRes.accessToken || ''); { const rr = await plexRestrict(cfg.s, who.id, pname); if (rr) u.plexRules = rr; } save();
  return u;
}

const goatServer = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname, m = req.method;
  res.secure = !!req.socket.encrypted || (TRUST && req.headers['x-forwarded-proto'] === 'https');
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (res.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.info = { ua: cut(req.headers['user-agent'], 200), ip: ipOf(req) };
  if (DEMO && p.startsWith('/__demo/')) return demo.handle(req, res, req.url.slice(7));
  if (p.startsWith('/wallpapers/') && (m === 'GET' || m === 'HEAD')) {
    let n = ''; try { n = decodeURIComponent(p.slice(12)); } catch {}
    if (!n || !wpList().includes(n)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': WPM[n.split('.').pop().toLowerCase()], 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(path.join(WPD, n)).pipe(res);
  }
  if (p.startsWith('/engines/')) {
    const t = goatTarget(req.url);
    if (!t) return send(res, 404, { error: 'Not found' });
    if (!goatAdmin(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (t.bare) { res.writeHead(301, { Location: '/engines/' + t.key + '/' }); return res.end(); }
    return goatProxy(req, res, t);
  }
  if (!p.startsWith('/api/')) {
    if (/^\/s\/[\w-]{20,64}$/.test(p)) { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end(fs.readFileSync(path.join(PUB, 'status.html'))); }
    const fp = path.join(PUB, p), mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(fp)];
    if (p !== '/' && mime && fp.startsWith(PUB + path.sep) && fs.existsSync(fp)) {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(fp));
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  if (m !== 'GET' && m !== 'HEAD' && req.headers.origin) {
    let ok = false;
    try { const o = new URL(req.headers.origin).host, host = (TRUST && req.headers['x-forwarded-host']) || req.headers.host; ok = o === host || (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean).includes(req.headers.origin); } catch {}
    if (!ok) return send(res, 403, { error: 'Blocked a request from another website' });
  }
  try {
    const token = ((req.headers.cookie || '').match(/sid=(\w+)/) || [])[1];
    const sess = sessions.get(th(token)), me = db.users.find(u => sess && u.id === sess.uid);
    if (me && Date.now() - sess.seen > 60000) sess.seen = Date.now();
    const setup = !db.users.length;
    if (p === '/api/health') return send(res, 200, { ok: true, version: VERSION });
    if (p === '/api/wallpapers' && m === 'GET') { if (!DEMO && wpMode() === 'library' && !wpList().some(f => LIBWP.test(f)) && !wpBusy) wpKick(); return send(res, 200, wpMode() === 'scenes' ? [] : DEMO ? demo.fanarts() : wpList()); }
    if (p === '/api/me') return send(res, 200, { setup, setupCode: setup && !!SETUP_TOKEN, version: VERSION, demo: DEMO, goat: !!GOAT_MANAGED, plexLogin: plexCfg().on, iconBase: String(process.env.ICON_BASE == null ? 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/' : process.env.ICON_BASE).replace(/[^\w:/.@-]/g, ''), recovery: !DEMO && !!(mailer() && baseUrl()), user: me ? pubUser(me) : null });

    if (p === '/api/setup' && m === 'POST') {
      if (!setup) return send(res, 403, { error: 'Already set up' });
      const b = await readBody(req);
      if (SETUP_TOKEN && !same(b.token, SETUP_TOKEN)) return send(res, 403, { error: 'That setup code is not right' });
      if (!b.name || (b.password || '').length < 8) return send(res, 400, { error: 'Enter a name and a password of 8+ characters' });
      const u = mkUser(b.name, b.password, 'admin'); db.users.push(u); save(); return login(res, u);
    }
    if (p === '/api/plexlogin/start' && m === 'POST') {
      if (!plexCfg().on) return send(res, 403, { error: 'Sign in with Plex is turned off.' });
      const ip = ipOf(req), now = Date.now(), a = plexAsk[ip] = (plexAsk[ip] || []).filter(t => now - t < 600000);
      if (a.length >= 15) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      a.push(now); for (const [k, v] of plexPend) if (now - v.at > 600000) plexPend.delete(k);
      if (plexPend.size > 300) return send(res, 429, { error: 'Busy. Try again in a minute.' });
      let pin; try { pin = await ptv('/api/v2/pins?strong=true', { method: 'POST' }); } catch (e) { return send(res, 502, { error: 'Could not reach plex.tv: ' + e.message }); }
      if (!pin || !pin.id || !pin.code) return send(res, 502, { error: 'plex.tv gave an unexpected answer.' });
      const ticket = crypto.randomBytes(18).toString('hex'); plexPend.set(ticket, { id: String(Math.round(+pin.id)), at: now });
      return send(res, 200, { ticket, url: `${PLEXAUTH()}#?clientID=${encodeURIComponent(plexCid())}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=GoatMediaStackarr` });
    }
    if (p === '/api/plexlogin/poll' && m === 'GET') {
      const tk = String(new URL(req.url, 'http://x').searchParams.get('t') || ''), e = plexPend.get(tk);
      if (!e || Date.now() - e.at > 600000) { plexPend.delete(tk); return send(res, 410, { error: 'That sign-in timed out. Please start again.' }); }
      const ip = ipOf(req);
      try {
        const pin = await ptv('/api/v2/pins/' + e.id);
        if (!pin || !pin.authToken) return send(res, 200, { pending: true });
        plexPend.delete(tk);
        const u = await plexProfile(String(pin.authToken));
        audit(u.name, 'Signed in with Plex', res.info.ip); return login(res, u);
      } catch (x) {
        if (x instanceof PlexDeny) { plexPend.delete(tk); const f = plexBad[ip] = plexBad[ip] || { n: 0, t: 0 }; f.n++; f.t = Date.now(); audit('?', 'Plex sign-in refused', cut(x.message, 80) + ' ' + ip); return send(res, x.code, { error: x.message }); }
        return send(res, 502, { error: 'Could not check with Plex: ' + cut(x.message, 120) });
      }
    }
    if (p === '/api/forgot' && m === 'POST') {
      const ip = ipOf(req), now = Date.now(), a = askRst[ip] = (askRst[ip] || []).filter(t => now - t < 900000);
      if (a.length >= 5) return send(res, 429, { error: 'Too many requests. Try again in 15 minutes.' });
      a.push(now);
      const b = await readBody(req), who = cut(b.who, 120).trim().toLowerCase();
      send(res, 200, { ok: true });                    // always the same answer, so nobody can find out which names exist
      if (DEMO || !who) return;
      const u = db.users.find(x => x.name.trim().toLowerCase() === who || (x.email && x.email.toLowerCase() === who)), mc = mailer(), base = baseUrl();
      if (!u || !u.email || !mc || !base || (u.reset && now - (u.reset.at || 0) < 60000)) return;
      const token = crypto.randomBytes(32).toString('base64url');
      u.reset = { h: th(token), exp: now + RESET_MS, at: now }; save(); audit(u.name, 'Asked for a password reset email', res.info.ip);
      sendRecovery(mc, u.email, 'Reset your GoatMediaStackarr password', `Hi ${u.name},\n\nSomeone asked to reset the GoatMediaStackarr password for this profile. To choose a new password, open this link within 30 minutes:\n\n${base}/#reset=${token}\n\nIf this was not you, ignore this message. Nothing changes until the link is used.\n`)
        .catch(e => audit(u.name, 'Could not send the reset email', cut(e.message, 120)));
      return;
    }
    if (p === '/api/reset' && m === 'POST') {
      if (DEMO) return send(res, 403, { error: 'This is turned off in the demo' });
      const ip = ipOf(req), now = Date.now(), fl = failsRst[ip] || { n: 0, t: 0 }; if (now - fl.t > 600000) fl.n = 0;
      if (fl.n >= 10) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
      const b = await readBody(req), t = th(b.token || ''), u = db.users.find(x => x.reset && same(x.reset.h, t));
      if (!u || u.reset.exp < now) { fl.n++; fl.t = now; failsRst[ip] = fl; return send(res, 400, { error: 'This reset link is not valid or has expired. Ask for a new one.' }); }
      if ((b.password || '').length < 8) return send(res, 400, { error: 'Password must be 8+ characters' });
      u.salt = uid(); u.hash = hash(b.password, u.salt); delete u.reset; save();
      for (const [k, v] of [...sessions]) if (v.uid === u.id) sessions.delete(k);
      saveSess(); audit(u.name, 'Reset the password by email', res.info.ip);
      return send(res, 200, { ok: true, twofa: !!(u.totp && u.totp.on) });
    }
    if (p === '/api/login' && m === 'POST') {
      const ip = ipOf(req), fl = fails[ip] || { n: 0, t: 0 };
      if (Date.now() - fl.t > 600000) fl.n = 0;
      if (fl.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
      const b = await readBody(req), u = db.users.find(x => x.name.trim().toLowerCase() === (b.name || '').trim().toLowerCase());
      if (!(u ? crypto.timingSafeEqual(Buffer.from(hash(b.password || '', u.salt)), Buffer.from(u.hash)) : (hash(b.password || '', 'x'), false)))
        { fl.n++; fl.t = Date.now(); fails[ip] = fl; audit(cut(b.name, 40) || '?', 'Failed sign-in', ip); return send(res, 401, { error: 'Wrong name or password' }); }
      delete fails[ip];
      if (u.totp && u.totp.on) { const tk = crypto.randomBytes(16).toString('hex'); tickets.set(tk, { uid: u.id, exp: Date.now() + 300000, n: 0 }); return send(res, 200, { twofa: true, ticket: tk }); }
      audit(u.name, 'Signed in', res.info.ip);
      return login(res, u);
    }
    if (p === '/api/login/2fa' && m === 'POST') {
      const b = await readBody(req), tk = tickets.get(String(b.ticket || ''));
      if (!tk || tk.exp < Date.now()) return send(res, 401, { error: 'That sign-in timed out. Please start again.' });
      const u = userOf(tk.uid), f = fails2[tk.uid] || { n: 0, t: 0 };
      if (!u || !u.totp || !u.totp.on) return send(res, 401, { error: 'Please start again.' });
      if (Date.now() - f.t > 600000) f.n = 0;
      if (f.n >= 10) return send(res, 429, { error: 'Too many wrong codes. Try again in 10 minutes.' });
      const code = String(b.code || '').trim(), step = totp.verify(u.totp.secret, code, Date.now(), u.totp.last || 0);
      let ok = false;
      if (step) { u.totp.last = step; ok = true; }
      else { const i = (u.totp.recovery || []).indexOf(th(code.toLowerCase())); if (i >= 0) { u.totp.recovery.splice(i, 1); ok = true; audit(u.name, 'Used a recovery code', (u.totp.recovery.length) + ' left'); } }
      if (!ok) { f.n++; f.t = Date.now(); fails2[tk.uid] = f; if (++tk.n >= 5) tickets.delete(String(b.ticket)); audit(u.name, 'Wrong two-step code', res.info.ip); return send(res, 401, { error: 'That code is not right' }); }
      tickets.delete(String(b.ticket)); delete fails2[tk.uid]; save(); audit(u.name, 'Signed in', res.info.ip + ' (two-step)');
      return login(res, u);
    }
    const pubm = p.match(/^\/api\/public\/([\w-]{20,64})$/);
    if (pubm && m === 'GET') {
      const ip = ipOf(req), fl = failsPub[ip] || { n: 0, t: 0 };
      if (Date.now() - fl.t > 600000) fl.n = 0;
      if (fl.n >= 30) return send(res, 429, { error: 'Too many attempts' });
      const hh = th(pubm[1]), x = db.statusLinks.find(l => same(l.hash, hh));
      if (!x) { fl.n++; fl.t = Date.now(); failsPub[ip] = fl; return send(res, 404, { error: 'This link is not valid' }); }
      const c = pubCache[hh]; if (c && Date.now() - c.t < 3000) return send(res, 200, c.d);
      const out = await statusData(x);
      pubCache[hh] = { t: Date.now(), d: out }; x.used = (x.used || 0) + 1; x.lastUsed = Date.now();
      return send(res, 200, out);
    }
    if (p === '/api/logout') { sessions.delete(th(token)); saveSess(); return send(res, 200, {}, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' }); }
    if (!me) return send(res, 401, { error: 'Sign in first' });
    if (DEMO && m !== 'GET' && /^\/api\/(users|password|2fa|backups?|restore|alerts|statuslinks|signin|services|weekly|throttle|me\/notify|me\/email|me\/avatar|plexsettings|listsettings)/.test(p)) return send(res, 403, { error: 'This is turned off in the demo' });

    if (p === '/api/2fa/start' && m === 'POST') {
      if (me.totp && me.totp.on) return send(res, 400, { error: 'Two-step sign-in is already on' });
      const secret = totp.newSecret(); pending2fa.set(me.id, { secret, exp: Date.now() + 600000 });
      return send(res, 200, { secret, uri: totp.uri(secret, me.name) });
    }
    if (p === '/api/2fa/enable' && m === 'POST') {
      const b = await readBody(req), pe = pending2fa.get(me.id);
      if (!pe || pe.exp < Date.now()) return send(res, 400, { error: 'Please start again' });
      const step = totp.verify(pe.secret, b.code); if (!step) return send(res, 400, { error: 'That code is not right. Check the time on your phone and try again.' });
      const codes = totp.recoveryCodes(); me.totp = { on: true, secret: pe.secret, last: step, recovery: codes.map(c => th(c)) }; pending2fa.delete(me.id);
      save(); audit(me.name, 'Turned on two-step sign-in', ''); return send(res, 200, { recovery: codes });
    }
    if (p === '/api/2fa/disable' && m === 'POST') {
      const b = await readBody(req);
      if (!me.totp || !me.totp.on) return send(res, 400, { error: 'Two-step sign-in is not on' });
      if (hash(b.password || '', me.salt) !== me.hash) return send(res, 400, { error: 'Your password is wrong' });
      const code = String(b.code || '').trim(), ok = totp.verify(me.totp.secret, code, Date.now(), 0) || (me.totp.recovery || []).includes(th(code.toLowerCase()));
      if (!ok) return send(res, 400, { error: 'That code is not right' });
      me.totp = undefined; save(); audit(me.name, 'Turned off two-step sign-in', ''); return send(res, 200, {});
    }
    if (p === '/api/me/email' && m === 'PUT') {
      const b = await readBody(req), e = cut(b.email, 120).trim();
      if (hash(b.password || '', me.salt) !== me.hash) return send(res, 400, { error: 'Your current password is wrong' });
      if (e && !require('./lib/smtp').ADDR.test(e)) return send(res, 400, { error: 'Enter a valid email address' });
      if (e && db.users.some(u => u.id !== me.id && u.email && u.email.toLowerCase() === e.toLowerCase())) return send(res, 400, { error: 'That email is already used by another profile' });
      me.email = e; delete me.reset; save(); audit(me.name, e ? 'Set a recovery email' : 'Removed the recovery email', ''); return send(res, 200, { email: me.email });
    }
    if (p === '/api/password' && m === 'POST') {
      const b = await readBody(req);
      if (hash(b.old || '', me.salt) !== me.hash) return send(res, 400, { error: 'Your current password is wrong' });
      if ((b.new || '').length < 8) return send(res, 400, { error: 'New password must be 8+ characters' });
      me.salt = uid(); me.hash = hash(b.new, me.salt); delete me.reset; save();
      for (const [k, v] of sessions) if (v.uid === me.id && k !== th(token)) sessions.delete(k);
      saveSess();
      return send(res, 200, {});
    }
    if (me.role === 'admin' && !process.env.PUBLIC_URL && !db.settings.publicUrl && !DEMO && req.headers.host) {
      const host = (TRUST && req.headers['x-forwarded-host']) || req.headers.host; db.settings.publicUrl = (res.secure ? 'https://' : 'http://') + String(host).split(',')[0].trim(); save();
    }
    const allowed = s => svcOk(me, s);
    const can = k => me.role === 'admin' || !me.perms || me.perms[k] !== false;
    const deny = (k, what) => can(k) ? false : (send(res, 403, { error: `Your profile cannot ${what}.` }), true);
    if (p === '/api/live' && m === 'GET') {
      if (liveClients.size >= 60) return send(res, 503, { error: 'Too many open live views' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const c = { res, uid: me.id, th: th(token), sent: false };
      req.on('close', () => liveStop(c)); liveAdd(c);
      return;
    }
    if (p === '/api/uptime' && m === 'GET') {
      const o = {}; for (const s of db.services.filter(allowed)) o[s.id] = { bars: uptBars(s.id), pct: uptPct(s.id) };
      return send(res, 200, o);
    }
    if (p === '/api/services' && m === 'GET') return send(res, 200, db.services.filter(allowed).map(pubSvc));
    let r;
    if ((r = p.match(/^\/api\/status\/(\w+)$/))) {
      const s = db.services.find(x => x.id === r[1]);
      if (!s || !allowed(s)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ok: await test(s).catch(() => false) });
    }

    const arr = s => s && allowed(s) && ['sonarr', 'radarr'].includes(s.type) ? s : null;
    const call = async (s, path, opt = {}) => {
      const r = await fetch(s.url.replace(/\/+$/, '') + path, { signal: AbortSignal.timeout(20000), ...opt,
        headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' } });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((Array.isArray(d) && d[0] && d[0].errorMessage) || (d && d.message) || 'Request failed (' + r.status + ')');
      return d;
    };
    if (p === '/api/search' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = arr(db.services.find(x => x.id === q.get('sid')));
      if (!s) return send(res, 404, { error: 'Pick a Sonarr or Radarr service' });
      const look = (s.type === 'sonarr' ? '/api/v3/series/lookup?term=' : '/api/v3/movie/lookup?term=') + encodeURIComponent(q.get('term') || '');
      const [found, folders, profiles] = await Promise.all([call(s, look), call(s, '/api/v3/rootfolder'), call(s, '/api/v3/qualityprofile')]);
      const results = found.slice(0, 12).map(x => ({ title: x.title, year: x.year, overview: x.overview, added: !!x.id,
        poster: x.remotePoster || ((x.images || []).find(i => i.coverType === 'poster') || {}).remoteUrl, raw: x }));
      return send(res, 200, { results, folders: folders.map(f => ({ path: f.path })), profiles: profiles.map(f => ({ id: f.id, name: f.name })) });
    }
    if (p === '/api/add' && m === 'POST') {
      if (deny('add', 'add shows or movies')) return;
      const b = await readBody(req), s = arr(db.services.find(x => x.id === b.sid));
      if (!s || !b.item) return send(res, 404, { error: 'Not found' });
      const base = { ...b.item, rootFolderPath: b.rootFolderPath, qualityProfileId: +b.qualityProfileId, monitored: true };
      const body = s.type === 'sonarr' ? { ...base, seasonFolder: true, addOptions: { searchForMissingEpisodes: true } }
        : { ...base, minimumAvailability: 'released', addOptions: { searchForMovie: true } };
      await call(s, '/api/v3/' + (s.type === 'sonarr' ? 'series' : 'movie'), { method: 'POST', body: JSON.stringify(body) });
      return send(res, 200, {});
    }
    const svcOf = (id, t) => { const s = db.services.find(x => x.id === id); return s && allowed(s) && s.type === t ? s : null; };
    const addOpts = b => ({ ...(b.category ? { category: cut(b.category) } : {}),
      ...(b.savepath && me.role === 'admin' && !/[\r\n]/.test(b.savepath) ? { savepath: cut(b.savepath, 500) } : {}), ...(b.paused ? { paused: 'true', stopped: 'true' } : {}) });
    const hs = v => { const a = Array.isArray(v) ? v : [v]; return a.length && a.length <= 500 && a.every(x => /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(x)) ? a.join('|') : null; };
    const adminOnly = () => me.role === 'admin' ? false : (send(res, 403, { error: 'Admins only' }), true);
    if (p === '/api/goat/status' && m === 'GET') { if (adminOnly()) return; return send(res, 200, { ...goatStatus(), counts: await goatCounts() }); }
    if (p === '/api/goat/import' && m === 'GET') { if (adminOnly()) return; return send(res, 200, goatImport || { state: 'idle' }); }
    if (p.startsWith('/api/goat/') && m === 'POST') {
      if (adminOnly()) return;
      if (DEMO) return send(res, 403, { error: 'This is turned off in the demo' });
      if (p === '/api/goat/settings') {
        if (!goatSettings) return send(res, 404, { error: 'Not running inside GoatMediaStackarr' });
        const b = await readBody(req);
        try { goatSettings.update(b); } catch (e) { return send(res, 400, { error: e.message }); }
        audit(me.name, 'Changed container settings', Object.keys(b).join(', ')); return send(res, 200, goatStatus());
      }
      if (p === '/api/goat/vpn-file') {
        const b = await readBody(req), name = String(b.name || ''), text = String(b.content || '');
        const ext = (name.match(/\.(conf|ovpn)$/i) || [])[1];
        if (!ext) return send(res, 400, { error: 'Choose a WireGuard .conf or OpenVPN .ovpn file from your VPN provider' });
        if (!text.trim() || text.length > 200000) return send(res, 400, { error: 'That file is empty or too large' });
        if (ext.toLowerCase() === 'conf' && !/\[Interface\]/i.test(text)) return send(res, 400, { error: 'That does not look like a WireGuard file (no [Interface] section)' });
        if (ext.toLowerCase() === 'ovpn' && !/^\s*remote\s/im.test(text)) return send(res, 400, { error: 'That does not look like an OpenVPN file (no "remote" line)' });
        const dir = path.join(GOAT_CONFIG, 'vpn'); fs.mkdirSync(dir, { recursive: true });
        // One provider file at a time: the VPN uses the first file it finds.
        for (const f of goatVpnFiles()) fs.unlinkSync(path.join(dir, f));
        const safe = path.basename(name.replace(/\\/g, '/')).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'vpn.' + ext.toLowerCase();
        const file = safe.toLowerCase().endsWith('.' + ext.toLowerCase()) ? safe : safe + '.' + ext.toLowerCase();
        fs.writeFileSync(path.join(dir, file), text, { mode: 0o600 });
        if (goatSettings) goatSettings.update({ vpn: { type: ext.toLowerCase() === 'ovpn' ? 'openvpn' : 'wireguard' } });
        audit(me.name, 'Uploaded a VPN file', file); return send(res, 200, goatStatus());
      }
      if (p === '/api/goat/apply-vpn') { const r = await goatControl({ cmd: 'apply-vpn' }); audit(me.name, 'Applied VPN settings', r.ok ? '' : r.error); return send(res, r.ok ? 200 : 500, r.ok ? goatStatus() : { error: r.error }); }
      if (p === '/api/goat/rewire') { const r = await goatControl({ cmd: 'rewire' }); return send(res, r.ok ? 200 : 500, r.ok ? {} : { error: r.error }); }
      if (p === '/api/goat/restart') {
        const b = await readBody(req), r = await goatControl({ cmd: 'restart', engine: String(b.engine || '') });
        audit(me.name, 'Restarted an app', String(b.engine || '')); return send(res, r.ok ? 200 : 500, r.ok ? {} : { error: r.error });
      }
      if (p === '/api/goat/import/check' || p === '/api/goat/import/start') {
        const b = await readBody(req), kind = String(b.kind || '');
        if (!importer.KINDS[kind]) return send(res, 400, { error: 'Pick Sonarr, Radarr, Lidarr or Prowlarr' });
        if (!/^https?:\/\/[^\s]+$/.test(String(b.url || ''))) return send(res, 400, { error: 'Enter the old app\'s address, like http://192.168.1.10:8989' });
        if (!/^[\w-]{8,100}$/.test(String(b.apiKey || ''))) return send(res, 400, { error: 'Enter the old app\'s API key (Settings → General in that app)' });
        const to = goatTarget2(kind); if (!to) return send(res, 400, { error: `The built-in ${kind} is not running` });
        const from = { url: String(b.url), apiKey: String(b.apiKey) };
        if (p.endsWith('/check')) {
          let pl; try { pl = await importer.plan(kind, from, to); } catch (e) { return send(res, 502, { error: e.message }); }
          const suggest = kind === 'prowlarr' ? [] : pl.roots.map(r => [r, pl.newRoots[0] || '']);
          return send(res, 200, { kind, total: pl.total, already: pl.already, todo: pl.todo, roots: pl.roots, newRoots: pl.newRoots, profiles: pl.profiles, settings: pl.settings || null, suggest });
        }
        if (goatImport && goatImport.state === 'running') return send(res, 409, { error: 'An import is already running' });
        const map = Array.isArray(b.map) ? b.map.filter(x => Array.isArray(x) && x.length === 2).map(([a, c]) => [String(a), String(c)]).slice(0, 50) : [];
        if (kind !== 'prowlarr' && !map.length) return send(res, 400, { error: 'Say where each old folder is inside GoatMediaStackarr' });
        goatImport = { state: 'running', kind, done: 0, total: 0, added: 0, skipped: 0, failed: [], at: Date.now() };
        audit(me.name, 'Started an import', kind + ' from ' + from.url);
        importer.run(kind, from, to, map, pr => { Object.assign(goatImport, pr); }, { settings: b.settings === true })
          .then(r => { Object.assign(goatImport, r, { state: 'done', finished: Date.now() }); audit('GoatMediaStackarr', 'Import finished', `${kind}: ${r.added} added, ${r.skipped} already there, ${r.failed.length} failed${r.settings ? `; profiles ${r.settings.profiles.added} added, ${r.settings.profiles.updated} replaced; custom formats ${r.settings.formats.added} added, ${r.settings.formats.updated} replaced` : ''}`); })
          .catch(e => { Object.assign(goatImport, { state: 'error', error: e.message }); });
        return send(res, 200, goatImport);
      }
      if (p === '/api/goat/leaktest') {
        const vpn = goatRead(path.join(GOAT_RUN, 'vpn.json')) || {};
        let home; try { home = await goatPublicIp(); } catch { return send(res, 502, { error: 'Could not look up this server\'s own address' }); }
        const up = vpn.state === 'up' && !!vpn.ip;
        return send(res, 200, { vpn: { ip: vpn.ip || '', country: vpn.country || '', state: vpn.state || 'off' }, home,
          safe: up && vpn.ip !== home.ip, verdict: !up ? 'The VPN is not connected, so the VPN apps are offline.' : vpn.ip !== home.ip ? 'The VPN apps use the VPN address, not yours.' : 'The VPN apps show your own address: the VPN is not hiding it.' });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/list$/))) {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const hit = qbListCache[s.id]; if (hit && Date.now() - hit.t < 800) return send(res, 200, hit.d);
      const [t, ti, alt] = await Promise.all([qb(s, '/api/v2/torrents/info'), qb(s, '/api/v2/transfer/info'), qb(s, '/api/v2/transfer/speedLimitsMode').catch(() => 0)]);
      const out = { dl: ti.dl_info_speed || 0, ul: ti.up_info_speed || 0, alt: +alt === 1, torrents: t.map(x => ({ hash: x.hash, name: x.name, state: x.state, progress: x.progress,
        dlspeed: x.dlspeed, upspeed: x.upspeed, size: x.size, added: x.added_on, eta: x.eta, ratio: x.ratio, seeds: x.num_seeds, peers: x.num_leechs, category: x.category || '',
        tags: x.tags || '', path: x.save_path, prio: x.priority })) };
      qbListCache[s.id] = { t: Date.now(), d: out }; return send(res, 200, out);
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/act$/)) && m === 'POST') {
      delete qbListCache[r[1]];
      const b = await readBody(req), s = svcOf(r[1], 'qbittorrent'), act = b.action;
      if (deny(act === 'delete' ? 'remove' : 'control', act === 'delete' ? 'remove downloads' : 'control downloads')) return;
      const hashes = b.hashes === 'all' ? 'all' : hs(b.hashes || b.hash);
      if (!s || !hashes) return send(res, 400, { error: 'Bad request' });
      if (hashes === 'all' && !['pause', 'resume'].includes(act)) return send(res, 400, { error: 'Bad request' });
      const either = async (n, f) => { try { await qb(s, '/api/v2/torrents/' + n[0], f); } catch (e) { if (!e.nf) throw e; await qb(s, '/api/v2/torrents/' + n[1], f); } };
      const f = { hashes };
      if (act === 'pause') await either(['stop', 'pause'], f);
      else if (act === 'resume') await either(['start', 'resume'], f);
      else if (act === 'force') await qb(s, '/api/v2/torrents/setForceStart', { ...f, value: 'true' });
      else if (act === 'recheck') await qb(s, '/api/v2/torrents/recheck', f);
      else if (act === 'reannounce') await qb(s, '/api/v2/torrents/reannounce', f);
      else if (act === 'delete') { await qb(s, '/api/v2/torrents/delete', { ...f, deleteFiles: b.files ? 'true' : 'false' }); audit(me.name, 'Removed downloads', hashes.split('|').length + ' torrent(s)' + (b.files ? ' with files' : '')); }
      else if (['top', 'up', 'down', 'bottom'].includes(act)) await qb(s, '/api/v2/torrents/' + { top: 'topPrio', up: 'increasePrio', down: 'decreasePrio', bottom: 'bottomPrio' }[act], f);
      else if (act === 'category') await qb(s, '/api/v2/torrents/setCategory', { ...f, category: cut(b.value) });
      else if (act === 'addtag' || act === 'rmtag') await qb(s, '/api/v2/torrents/' + (act === 'addtag' ? 'addTags' : 'removeTags'), { ...f, tags: cut(b.value) });
      else if (act === 'location') { if (adminOnly()) return; await qb(s, '/api/v2/torrents/setLocation', { ...f, location: cut(b.value, 500) }); }
      else if (act === 'rename' && !hashes.includes('|')) await qb(s, '/api/v2/torrents/rename', { hash: hashes, name: cut(b.value) });
      else return send(res, 400, { error: 'Unknown action' });
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/info$/))) {
      const s = svcOf(r[1], 'qbittorrent'), h = new URL(req.url, 'http://x').searchParams.get('hash') || '';
      if (!s || !hs(h) || h.includes('|')) return send(res, 400, { error: 'Bad request' });
      const [pr, files, trk, pe] = await Promise.all([qb(s, '/api/v2/torrents/properties?hash=' + h), qb(s, '/api/v2/torrents/files?hash=' + h),
        qb(s, '/api/v2/torrents/trackers?hash=' + h), qb(s, '/api/v2/sync/torrentPeers?hash=' + h + '&rid=0').catch(() => ({}))]);
      return send(res, 200, {
        props: { path: pr.save_path, size: pr.total_size, added: pr.addition_date, done: pr.completion_date, ratio: pr.share_ratio, down: pr.total_downloaded, up: pr.total_uploaded,
          seedTime: pr.seeding_time, comment: pr.comment, conns: pr.nb_connections },
        files: files.map((x, i) => ({ i: x.index != null ? x.index : i, name: x.name, size: x.size, progress: x.progress, prio: x.priority })),
        trackers: trk.filter(x => /^(https?|udp):/.test(x.url)).map(x => ({ url: x.url, status: x.status, seeds: x.num_seeds, peers: x.num_peers, msg: x.msg })),
        peers: Object.values(pe.peers || {}).slice(0, 100).map(x => ({ ip: x.ip, client: x.client, progress: x.progress, dl: x.dl_speed, up: x.up_speed })) });
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/meta$/))) {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const md = await qb(s, '/api/v2/sync/maindata?rid=0');
      return send(res, 200, { free: (md.server_state || {}).free_space_on_disk, categories: Object.values(md.categories || {}).map(c => ({ name: c.name, path: c.savePath })), tags: md.tags || [] });
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/prefs$/))) {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      if (m === 'GET') { const a = await qb(s, '/api/v2/app/preferences'), k = v => Math.round((v || 0) / 1024);
        return send(res, 200, { dl: k(a.dl_limit), up: k(a.up_limit), altDl: k(a.alt_dl_limit), altUp: k(a.alt_up_limit) }); }
      if (adminOnly()) return;
      const b = await readBody(req), kb = v => Math.max(0, Math.round(+v || 0)) * 1024;
      await qb(s, '/api/v2/app/setPreferences', { json: JSON.stringify({ dl_limit: kb(b.dl), up_limit: kb(b.up), alt_dl_limit: kb(b.altDl), alt_up_limit: kb(b.altUp) }) });
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/alt$/)) && m === 'POST') {
      if (deny('control', 'change speed limits')) return;
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      await qb(s, '/api/v2/transfer/toggleSpeedLimitsMode', {}); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/(cat|tag)$/)) && m === 'POST') {
      if (adminOnly()) return;
      const b = await readBody(req), s = svcOf(r[1], 'qbittorrent'), n = cut(b.name, 100).trim(); if (!s || !n) return send(res, 400, { error: 'Enter a name' });
      if (r[2] === 'cat') {
        if (b.op === 'create') {
          if (/^[\/\\]|[\/\\]$|\/\/|\\/.test(n)) return send(res, 400, { error: 'A category name cannot start or end with a slash. Use "tv/kids" for a category inside another.' });
          const have = Object.keys((await qb(s, '/api/v2/torrents/categories').catch(() => ({}))) || {});
          if (have.some(x => x.toLowerCase() === n.toLowerCase())) return send(res, 400, { error: `There is already a category called ${n}.` });
          try { await qb(s, '/api/v2/torrents/createCategory', { category: n, savePath: cut(b.path, 500).trim() }); }
          catch (e) { return send(res, 400, { error: 'qBittorrent did not accept that category' + (e.message && !/returned \d+/.test(e.message) ? ': ' + cut(e.message, 200) : '') + '. Use letters, numbers, spaces and dashes.' }); }
          audit(me.name, 'Added a download category', n);
        }
        else if (b.op === 'remove') await qb(s, '/api/v2/torrents/removeCategories', { categories: n });
        else return send(res, 400, { error: 'Bad request' });
      } else if (b.op === 'create') await qb(s, '/api/v2/torrents/createTags', { tags: n });
      else if (b.op === 'remove') await qb(s, '/api/v2/torrents/deleteTags', { tags: n });
      else return send(res, 400, { error: 'Bad request' });
      return send(res, 200, {});
    }
    const rssOf = id => svcOf(id, 'qbittorrent');
    if ((r = p.match(/^\/api\/rss\/(\w+)\/feeds$/))) {
      const s = rssOf(r[1]); if (!s) return send(res, 404, { error: 'Not found' });
      return send(res, 200, (await rssItems(s)).map(f => ({ path: f.path, name: f.name, url: f.url, unread: f.articles.filter(a => !a.isRead).length, total: f.articles.length, error: !!f.error })));
    }
    if ((r = p.match(/^\/api\/rss\/(\w+)\/articles$/))) {
      const s = rssOf(r[1]), feed = new URL(req.url, 'http://x').searchParams.get('feed') || ''; if (!s) return send(res, 404, { error: 'Not found' });
      const out = [];
      for (const f of await rssItems(s)) if (!feed || f.path === feed) for (const a of f.articles) out.push({ id: a.id, title: a.title, date: a.date, feed: f.path, read: !!a.isRead });
      out.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      return send(res, 200, out.slice(0, 300));
    }
    if ((r = p.match(/^\/api\/rss\/(\w+)\/(refresh|read)$/)) && m === 'POST') {
      const s = rssOf(r[1]), b = await readBody(req); if (!s) return send(res, 404, { error: 'Not found' });
      if (r[2] === 'refresh') await qb(s, '/api/v2/rss/refreshItem', { itemPath: cut(b.path, 300) });
      else await qb(s, '/api/v2/rss/markAsRead', { itemPath: cut(b.path, 300), ...(b.id ? { articleId: cut(b.id, 300) } : {}) });
      return send(res, 200, {});
    }
    if (p === '/api/rss/download' && m === 'POST') {
      if (deny('add', 'add downloads')) return;
      const b = await readBody(req), s = rssOf(b.sid); if (!s) return send(res, 404, { error: 'Not found' });
      const f = (await rssItems(s)).find(x => x.path === b.feed), a = f && f.articles.find(x => x.id === b.id), url = a && (a.torrentURL || a.link);
      if (!url || !/^(magnet:\?|https?:\/\/)/i.test(url)) return send(res, 400, { error: 'This article has no download link' });
      const out = await qb(s, '/api/v2/torrents/add', { urls: url, ...addOpts(b) });
      if (String(out).trim() === 'Fails.') return send(res, 400, { error: 'qBittorrent could not add that link' });
      qb(s, '/api/v2/rss/markAsRead', { itemPath: f.path, articleId: a.id }).catch(() => {});
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/rss\/(\w+)\/rules$/)) && m === 'GET') {
      const s = rssOf(r[1]); if (!s) return send(res, 404, { error: 'Not found' });
      const rules = await qb(s, '/api/v2/rss/rules');
      return send(res, 200, { rules: Object.entries(rules || {}).filter(([n]) => n !== '__mh_preview__').map(([name, v]) => ({ name, ...v })),
        feeds: (await rssItems(s)).map(f => ({ path: f.path, url: f.url })) });
    }
    if ((r = p.match(/^\/api\/rss\/(\w+)\/matches$/))) {
      const s = rssOf(r[1]); if (!s) return send(res, 404, { error: 'Not found' });
      return send(res, 200, await qb(s, '/api/v2/rss/matchingArticles?ruleName=' + encodeURIComponent(new URL(req.url, 'http://x').searchParams.get('name') || '')));
    }
    if ((r = p.match(/^\/api\/rss\/(\w+)\/(feed|rule)$/)) && m === 'POST') {
      if (adminOnly()) return;
      const s = rssOf(r[1]), b = await readBody(req); if (!s) return send(res, 404, { error: 'Not found' });
      if (r[2] === 'feed') {
        if (b.op === 'add') {
          if (!/^https?:\/\//i.test(b.url || '')) return send(res, 400, { error: 'Enter the feed web address (starts with http)' });
          await qb(s, '/api/v2/rss/addFeed', { url: cut(b.url, 1000), ...(b.path ? { path: cut(b.path, 300) } : {}) });
        } else if (b.op === 'remove') await qb(s, '/api/v2/rss/removeItem', { path: cut(b.path, 300) });
        else return send(res, 400, { error: 'Bad request' });
        return send(res, 200, {});
      }
      const name = cut(b.name, 120).trim();
      if (b.op === 'set') {
        if (!name || name === '__mh_preview__') return send(res, 400, { error: 'Give the rule a name' });
        await qb(s, '/api/v2/rss/setRule', { ruleName: name, ruleDef: JSON.stringify(ruleDef(b.rule || {})) }); return send(res, 200, {});
      }
      if (b.op === 'remove') { await qb(s, '/api/v2/rss/removeRule', { ruleName: name }); return send(res, 200, {}); }
      if (b.op === 'preview') {
        await qb(s, '/api/v2/rss/setRule', { ruleName: '__mh_preview__', ruleDef: JSON.stringify({ ...ruleDef(b.rule || {}), enabled: false }) });
        try { return send(res, 200, await qb(s, '/api/v2/rss/matchingArticles?ruleName=__mh_preview__')); }
        finally { await qb(s, '/api/v2/rss/removeRule', { ruleName: '__mh_preview__' }).catch(() => {}); }
      }
      return send(res, 400, { error: 'Bad request' });
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)\/indexers$/)) && m === 'GET') {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      const l = await jkList(s, true);
      return send(res, 200, (Array.isArray(l) ? l : []).map(x => ({ id: String(x.id), name: String(x.name || x.id), type: String(x.type || ''), language: String(x.language || ''),
        site: /^https?:\/\//.test(x.site_link || '') ? x.site_link : '', error: String(x.last_error || '').slice(0, 300) })));
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)\/indexers\/([\w.-]+|all)\/test$/)) && m === 'POST') {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      const one = async id => { try { const x = await jkTorznab(s, id, 't=search&q=test&limit=1'); if (x.ok && !/<error\b/i.test(x.text)) return { id, ok: true, error: '' };
        return { id, ok: false, error: (/<error\b[^>]*description="([^"]*)"/i.exec(x.text) || [])[1] || 'Jackett answered with an error (' + (x.ok ? 'in its reply' : 'not found') + ')' }; } catch (e) { return { id, ok: false, error: e.name === 'TimeoutError' ? 'The indexer took too long to answer' : e.message }; } };
      if (r[2] !== 'all') return send(res, 200, await one(r[2]));
      const ids = (await jkList(s, true)).map(x => String(x.id)), out = [];
      for (let i = 0; i < ids.length; i += 4) out.push(...await Promise.all(ids.slice(i, i + 4).map(one)));
      return send(res, 200, out);
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)$/))) {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      const term = new URL(req.url, 'http://x').searchParams.get('term') || '';
      const x = await fetch(`${s.url.replace(/\/+$/, '')}/api/v2.0/indexers/all/results?apikey=${encodeURIComponent(s.apiKey)}&Query=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(40000) });
      if (!x.ok) throw new Error('Jackett returned ' + x.status);
      const d = await x.json();
      return send(res, 200, (d.Results || []).sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0)).slice(0, 30)
        .map(i => { if (grabCache.size > 300) grabCache.clear(); const id = uid(); grabCache.set(id, { u: i.MagnetUri || i.Link });
          return { id, title: i.Title, size: i.Size, seeders: i.Seeders || 0, tracker: i.Tracker }; }));
    }
    if ((r = p.match(/^\/api\/unraid\/(\w+)$/)) && m === 'GET') {
      const s = svcOf(r[1], 'unraid'); if (!s) return send(res, 404, { error: 'Not found' });
      const out = { containers: [], errors: [], notes: [] };
      const part = async (q, f, soft) => { try { f(await gql(s, q)); } catch (e) { (soft ? out.notes : out.errors).push(e.message); } };
      if (new URL(req.url, 'http://x').searchParams.get('fast')) {
        try { Object.assign(out, await unraidMetrics(s)); } catch (e) { out.errors.push(e.message); }
        return send(res, 200, out);
      }
      await Promise.all([
        part('{ info { os { hostname } } array { state capacity { kilobytes { used total } } } }', d => {
          out.host = d.info.os.hostname; out.arrayState = d.array.state;
          out.used = +d.array.capacity.kilobytes.used; out.total = +d.array.capacity.kilobytes.total; }),
        unraidMetrics(s).then(o => Object.assign(out, o)).catch(e => out.errors.push(e.message)),
        part('{ docker { containers { id names state } } }', d => { out.containers = d.docker.containers.map(c => ({ id: c.id, name: (c.names[0] || '').replace(/^\//, ''), state: c.state })); }),
        part('{ array { parityCheckStatus { status progress errors running } disks { name temp status } parities { name temp status } caches { name temp status } } }', d => {
          const a = d.array, tag = (l, r) => (l || []).map(x => ({ name: x.name, role: r, temp: x.temp, status: x.status }));
          out.disks = [...tag(a.parities, 'Parity'), ...tag(a.disks, 'Data'), ...tag(a.caches, 'Cache')]; out.parity = a.parityCheckStatus || null;
        }, true),
        part('{ shares { name free used size } }', d => { out.shares = (d.shares || []).map(x => ({ name: x.name, free: +x.free, used: +x.used, size: +x.size })); }, true),
        (async () => {
          const cpuOut = d => { out.uptime = d.info.os && d.info.os.uptime || ''; const c = d.info.cpu; if (!c) { out.cpuInfo = null; return; }
            const nm = String(c.brand || '').replace(/\((R|TM)\)|\u00ae|\u2122/gi, '').replace(/\s+/g, ' ').trim(), mf = String(c.manufacturer || '').replace(/\((R|TM)\)|\u00ae|\u2122/gi, '').replace(/\s+/g, ' ').trim();
            out.cpuInfo = { brand: cut(mf && !nm.toLowerCase().startsWith(mf.toLowerCase()) ? mf + ' ' + nm : nm, 120), cores: c.cores || 0, threads: c.threads || 0, ghz: +c.speed > 0 ? +(+c.speed).toFixed(1) : 0 }; };
          await part('{ info { os { uptime } cpu { manufacturer brand cores threads speed } } }', cpuOut, true);
          if (!out.cpuInfo) { out.notes.pop(); await part('{ info { os { uptime } cpu { brand cores threads } } }', cpuOut, true); }
        })(),
        part('{ docker { containers { id image status } } }', d => { out.meta = {}; for (const c of d.docker.containers) out.meta[c.id] = { image: cut(c.image, 100), status: cut(c.status, 60) }; }, true),
        part('{ docker { containers { id labels } } }', d => {
          out.icons = {};
          for (const c of d.docker.containers) {
            let l = c.labels; if (typeof l === 'string') { try { l = JSON.parse(l); } catch { l = null; } }
            const v = l && typeof l === 'object' ? l['net.unraid.docker.icon'] : '';
            try { const u = new URL(String(v || '')); if (u.protocol === 'https:' && !u.username && !u.password && !/(api_?key|token|passkey|secret)=/i.test(u.search)) out.icons[c.id] = u.href.slice(0, 400); } catch {}
          }
        }, true),
        part('{ docker { containers { id isUpdateAvailable } } }', d => { out.updates = {}; for (const c of d.docker.containers) if (c.isUpdateAvailable) out.updates[c.id] = true; }, true)
      ]);
      return send(res, 200, out);
    }
    if (p === '/api/torrent/add' && m === 'POST') {
      if (deny('add', 'add downloads')) return;
      const b = await readBody(req), s = svcOf(b.sid, 'qbittorrent');
      const urls = (b.jid ? [(grabCache.get(b.jid) || {}).u] : String(b.url || '').split(/\r?\n/).map(x => x.trim())).filter(Boolean).slice(0, 50);
      const ok = u => /^magnet:\?/i.test(u) || (/^https?:\/\//i.test(u) && (b.jid || me.role === 'admin'));
      if (!s || !urls.length || !urls.every(ok)) return send(res, 400, { error: 'Paste magnet links, one per line (admins can also paste torrent web addresses)' });
      const out = await qb(s, '/api/v2/torrents/add', { urls: urls.join('\n'), ...addOpts(b) });
      if (String(out).trim() === 'Fails.') return send(res, 400, { error: 'qBittorrent could not add that link' });
      return send(res, 200, {});
    }
    if (p === '/api/torrent/upload' && m === 'POST') {
      if (deny('add', 'add downloads')) return;
      const b = await readBody(req), s = svcOf(b.sid, 'qbittorrent');
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 5).map(f => ({ name: cut(f.name || 'file.torrent', 120).replace(/[^\w.\- ]/g, '_'), buf: Buffer.from(String(f.data || ''), 'base64') }));
      if (!s || !files.length || !files.every(f => f.buf.length > 20 && f.buf.length < 2e6 && f.buf[0] === 0x64)) return send(res, 400, { error: 'Choose valid .torrent files (up to 5, each under 2 MB)' });
      await qbUpload(s, addOpts(b), files);
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/vpn\/(\w+)$/))) {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const v = await vpnStatus(s);
      return send(res, 200, { vpn: v.vpn, conn: v.conn, ip: v.ip ? v.ip.replace(/\.\d+$/, '.x') : '' });
    }
    if (p === '/api/discover' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      try { return send(res, 200, await lists.list(q.get('src'), q.get('list'), q.get('kind'))); }
      catch (e) { if (e.status) return send(res, e.status, { error: e.message }); throw e; }
    }
    if (p === '/api/seerr/search' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = svcOf(q.get('sid'), 'seerr');
      if (!s) return send(res, 404, { error: 'Pick a Seerr service' });
      const d = await call(s, '/api/v1/search?page=1&language=en&query=' + encodeURIComponent(q.get('term') || ''));
      if (!d || !Array.isArray(d.results)) throw new Error('Seerr gave an unexpected reply: ' + JSON.stringify(d).slice(0, 160));
      const kind = x => x.mediaType || (x.firstAirDate || x.name ? 'tv' : x.releaseDate || x.title ? 'movie' : '');
      return send(res, 200, d.results.filter(x => ['movie', 'tv'].includes(kind(x))).slice(0, 20).map(x => ({
        mediaType: kind(x), id: x.id, title: x.title || x.name, year: String(x.releaseDate || x.firstAirDate || '').slice(0, 4), overview: x.overview,
        poster: x.posterPath ? 'https://image.tmdb.org/t/p/w342' + x.posterPath : '', status: (x.mediaInfo || {}).status || 0 })));
    }
    const seerrAdd = (s, x) => call(s, '/api/v1/request', { method: 'POST',
      body: JSON.stringify({ mediaType: x.mediaType, mediaId: +x.mediaId, ...(x.mediaType === 'tv' ? { seasons: x.seasons && x.seasons.length ? x.seasons : 'all' } : {}) }) });
    const researchRequest = async x => {
      const kind = x.mediaType === 'movie' ? 'radarr' : 'sonarr';
      for (const sv of db.services.filter(y => y.type === kind)) try {
        const cmd = b => ext(sv, '/api/v3/command', { method: 'POST', body: JSON.stringify(b) });
        if (kind === 'radarr') { const l = await ext(sv, '/api/v3/movie?tmdbId=' + encodeURIComponent(x.mediaId)); if (Array.isArray(l) && l[0]) { await cmd({ name: 'MoviesSearch', movieIds: [l[0].id] }); return 'Searching again in ' + sv.name; } }
        else { const l = await ext(sv, '/api/v3/series'), sr = (Array.isArray(l) ? l : []).find(y => y.tmdbId && y.tmdbId === +x.mediaId) || (Array.isArray(l) ? l : []).find(y => String(y.title).toLowerCase() === String(x.title).toLowerCase());
          if (sr) { await cmd({ name: 'SeriesSearch', seriesId: sr.id }); return 'Searching again in ' + sv.name; } }
      } catch {}
      return '';
    };
    if (p === '/api/requests' && m === 'POST') {
      if (deny('request', 'make requests')) return;
      const b = await readBody(req), s = svcOf(b.sid, 'seerr');
      if (!s || !+b.mediaId || !['movie', 'tv'].includes(b.mediaType)) return send(res, 400, { error: 'Bad request' });
      const lim = me.reqLimit;
      if (me.role !== 'admin' && lim && lim.n > 0) {
        const used = db.requests.filter(r => r.uid === me.id && r.status !== 'declined' && r.at > Date.now() - lim.days * DAY).length;
        if (used >= lim.n) return send(res, 429, { error: `You have used your ${lim.n} request${lim.n === 1 ? '' : 's'} for the last ${lim.days} day${lim.days === 1 ? '' : 's'}. Ask an admin if you need more.` });
      }
      if (me.role !== 'admin' && me.dataLimit > 0) {
        const sp = await usedSpace(me).catch(() => null);
        if (sp && sp.bytes >= me.dataLimit * 1e9) return send(res, 429, { error: `What you asked for already takes ${gbText(sp.bytes)} of the ${me.dataLimit} GB an admin gave you. Ask an admin for more space.` });
      }
      const seasons = b.mediaType === 'tv' && Array.isArray(b.seasons) ? [...new Set(b.seasons.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 200))].slice(0, 100) : [];
      const x = { id: uid(), sid: s.id, uid: me.id, user: me.name, mediaType: b.mediaType, mediaId: +b.mediaId, title: String(b.title || '').slice(0, 200),
        year: String(b.year || '').slice(0, 4), poster: String(b.poster || '').slice(0, 300), status: 'pending', at: Date.now(), ...(seasons.length ? { seasons } : {}) };
      if (me.role === 'admin' || me.autoApprove) { const sr = await seerrAdd(s, x); x.seerrId = sr && sr.id; x.status = 'approved'; x.stage = 'approved'; }
      else if (db.alerts && db.alerts.requests) notify('New request', `${me.name} requested ${x.title}`).catch(() => {});
      db.requests.push(x); save(); audit(me.name, me.role !== 'admin' && me.autoApprove ? 'Requested (auto-approved)' : 'Requested', x.title); return send(res, 200, x);
    }
    if (p === '/api/seerr/tv' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, sv = svcOf(q.get('sid'), 'seerr'); if (!sv || !+q.get('id')) return send(res, 404, { error: 'Not found' });
      const d = await call(sv, '/api/v1/tv/' + +q.get('id'));
      return send(res, 200, { seasons: ((d && d.seasons) || []).filter(x => x.seasonNumber > 0).map(x => ({ n: x.seasonNumber, episodes: x.episodeCount || 0 })) });
    }
    // One movie or show, in full: for the title page in the phone app. From Seerr, or from TMDB when there is no Seerr.
    if (p === '/api/title' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, type = q.get('type') === 'tv' ? 'tv' : 'movie', id = Math.round(+q.get('id'));
      if (!(id > 0)) return send(res, 400, { error: 'Bad request' });
      const sv = db.services.filter(allowed).find(x => x.type === 'seerr');
      let d = null;
      if (sv) d = await call(sv, `/api/v1/${type}/${id}`).catch(() => null);
      if (!d && listKeys().tmdb) d = await lists.details(type, id).catch(() => null);
      if (!d || !(d.title || d.name)) return send(res, 404, { error: sv ? 'Seerr does not know this title.' : 'This page needs Seerr, or a TMDB key under Settings → Discover lists.' });
      const pk = (o, a, b) => o[a] != null ? o[a] : o[b], v = (a, b) => pk(d, a, b), img = (x, w) => !x ? '' : /^https?:\/\//.test(x) ? String(x).slice(0, 600) : /^\/[\w./-]+$/.test(x) ? 'https://image.tmdb.org/t/p/' + w + x : '';
      const credits = d.credits || {}, vids = (d.relatedVideos || ((d.videos || {}).results || []).map(x => ({ type: x.type, site: x.site, key: x.key, name: x.name })));
      const trailer = (Array.isArray(vids) ? vids : []).find(x => /^trailer$/i.test(x.type || '') && /youtube/i.test(x.site || '') && /^[\w-]{6,20}$/.test(x.key || ''));
      const idx = await libIndex().catch(() => null), inLib = idx && idx[type].get(id), libSvc = inLib && db.services.find(x => x.id === inLib.sid && allowed(x));
      const reqs = db.requests.filter(x => x.mediaType === type && +x.mediaId === id && (me.role === 'admin' || x.uid === me.id));
      const date = String(v('releaseDate', 'release_date') || v('firstAirDate', 'first_air_date') || '');
      const rt = +v('runtime', 'runtime') || +((v('episodeRunTime', 'episode_run_time') || [])[0]) || 0;
      return send(res, 200, { type, id, title: cut(d.title || d.name, 200), year: date.slice(0, 4), date: date.slice(0, 10), tagline: cut(d.tagline, 300), overview: cut(d.overview, 4000),
        poster: img(v('posterPath', 'poster_path'), 'w342'), backdrop: img(v('backdropPath', 'backdrop_path'), 'w780'), rating: Math.round((+v('voteAverage', 'vote_average') || 0) * 10) / 10, runtime: rt,
        genres: (d.genres || []).map(g => cut(g.name, 40)).filter(Boolean).slice(0, 6), status: cut(d.status, 40),
        studio: cut(((type === 'tv' ? d.networks : d.productionCompanies || d.production_companies) || [])[0] && ((type === 'tv' ? d.networks : d.productionCompanies || d.production_companies)[0].name), 80),
        cast: (credits.cast || []).slice(0, 15).map(c => ({ name: cut(c.name, 80), role: cut(c.character, 80), photo: img(pk(c, 'profilePath', 'profile_path'), 'w185') })),
        seasons: type === 'tv' ? (d.seasons || []).filter(x => +pk(x, 'seasonNumber', 'season_number') > 0).map(x => ({ n: +pk(x, 'seasonNumber', 'season_number'), episodes: +pk(x, 'episodeCount', 'episode_count') || 0, name: cut(x.name, 80), date: String(pk(x, 'airDate', 'air_date') || '').slice(0, 10) })) : [],
        trailer: trailer ? trailer.key : '', seerr: sv ? sv.id : '', available: +((d.mediaInfo || {}).status) || 0,
        library: libSvc ? { sid: libSvc.id, id: inLib.id, kind: type } : null, request: reqs.length ? { status: reqs[reqs.length - 1].status, stage: reqs[reqs.length - 1].stage || reqs[reqs.length - 1].status } : null });
    }
    if ((r = p.match(/^\/api\/requests\/(\w+)\/report$/)) && m === 'POST') {
      const x = db.requests.find(y => y.id === r[1]); if (!x || (me.role !== 'admin' && x.uid !== me.id)) return send(res, 404, { error: 'Not found' });
      const b = await readBody(req), text = String(b.text || '').trim().slice(0, 500); if (!text) return send(res, 400, { error: 'Please say what is wrong' });
      if (db.reports.some(y => y.rid === x.id && y.uid === me.id && y.status === 'open')) return send(res, 400, { error: 'You already reported this. An admin will take a look.' });
      let result = ''; if (x.status === 'approved' && Date.now() - (x.researched || 0) > 600000) { result = await researchRequest(x); if (result) x.researched = Date.now(); }
      const rp = { id: uid(), rid: x.id, uid: me.id, user: me.name, title: x.title, text, at: Date.now(), status: 'open', result };
      db.reports.push(rp); if (db.reports.length > 300) db.reports.splice(0, db.reports.length - 300); save(); audit(me.name, 'Reported a problem', x.title);
      if ((db.alerts || {}).reports !== false) notify('Problem report', `${me.name} reported a problem with ${x.title}: ${text}${result ? ' (' + result + ')' : ''}`).catch(() => {});
      return send(res, 200, { ok: true, result });
    }
    if (p === '/api/reports' && m === 'GET') return send(res, 200, db.reports.filter(x => me.role === 'admin' || x.uid === me.id).slice(-100).reverse());
    if (p === '/api/requests' && m === 'GET') {
      if (Date.now() - mon.reqT > REQ_MS) { mon.reqT = Date.now(); await refreshRequests().catch(() => {}); }
      return send(res, 200, db.requests.filter(x => me.role === 'admin' || x.uid === me.id).slice(-100).reverse().map(x => ({ ...x, stage: x.stage || x.status })));
    }
    if (p === '/api/library' && m === 'GET') {
      const s = arr(db.services.find(x => x.id === new URL(req.url, 'http://x').searchParams.get('sid')));
      if (!s) return send(res, 404, { error: 'Pick a Sonarr or Radarr service' });
      const [d, profs] = await Promise.all([call(s, s.type === 'sonarr' ? '/api/v3/series' : '/api/v3/movie', { signal: AbortSignal.timeout(60000) }), call(s, '/api/v3/qualityprofile').catch(() => [])]);
      const prof = {}; (Array.isArray(profs) ? profs : []).forEach(q => { prof[q.id] = q.name; });
      return send(res, 200, d.map(x => {
        const st = x.statistics || {}, img = (x.images || []).find(i => i.coverType === 'poster') || {}, tv = s.type === 'sonarr', rt = x.ratings || {};
        const rating = tv ? +rt.value || 0 : +((rt.imdb || {}).value || (rt.tmdb || {}).value || rt.value) || 0;
        return { id: x.id, title: x.title, year: x.year, poster: img.remoteUrl || x.remotePoster, fanart: mediaUrl(s, x, 'fanart').url, overview: (x.overview || '').slice(0, 600),
          size: tv ? st.sizeOnDisk || 0 : x.sizeOnDisk || 0, missing: tv ? Math.max(0, (st.episodeCount || 0) - (st.episodeFileCount || 0)) : (x.monitored && !x.hasFile ? 1 : 0),
          monitored: !!x.monitored, status: x.status || '', genres: (x.genres || []).slice(0, 6), maker: (tv ? x.network : x.studio) || '', profile: prof[x.qualityProfileId] || '',
          added: x.added || '', rating, runtime: x.runtime || 0, cert: x.certification || '',
          seasons: tv ? st.seasonCount || 0 : 0, have: tv ? st.episodeFileCount || 0 : (x.hasFile ? 1 : 0), total: tv ? st.episodeCount || 0 : 1, next: tv ? x.nextAiring || '' : '' };
      }));
    }
    const idsOf = (x, type) => ({ type, imdb: /^tt\d{1,10}$/.test(x.imdbId || '') ? x.imdbId : '', tmdb: Number.isInteger(+x.tmdbId) && +x.tmdbId > 0 ? +x.tmdbId : 0, tvdb: type === 'tv' && Number.isInteger(+x.tvdbId) && +x.tvdbId > 0 ? +x.tvdbId : 0 });
    if (p === '/api/filestatus' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = arr(db.services.find(x => x.id === q.get('sid'))), id = +q.get('id');
      if (!s || !Number.isInteger(id) || id < 1) return send(res, 404, { error: 'Not found' });
      const fileOf = f => f ? { name: cut(String(f.relativePath || f.path || '').split(/[\\/]/).pop(), 200), size: +f.size || 0, quality: cut(((f.quality || {}).quality || {}).name, 40), langs: (f.languages || []).map(l => cut(l && l.name, 30)).filter(Boolean).slice(0, 6),
        codec: cut(((f.mediaInfo || {}).videoCodec) || '', 20), added: f.dateAdded || '' } : null;
      if (s.type === 'radarr') {
        const x = await call(s, '/api/v3/movie/' + id);
        return send(res, 200, { ids: idsOf(x, 'movie'), kind: 'movie', have: !!x.hasFile, monitored: !!x.monitored, released: x.isAvailable !== false, file: x.hasFile ? fileOf(x.movieFile) : null });
      }
      const x = await call(s, '/api/v3/episode/' + id); let f = x.hasFile ? x.episodeFile : null;
      if (x.hasFile && !f && x.episodeFileId) f = await call(s, '/api/v3/episodefile/' + x.episodeFileId).catch(() => null);
      const dt = x.airDateUtc || x.airDate || '', sr = x.seriesId ? await call(s, '/api/v3/series/' + x.seriesId).catch(() => null) : null;
      return send(res, 200, { ids: idsOf(sr || {}, 'tv'), kind: 'episode', have: !!x.hasFile, monitored: !!x.monitored, released: !dt || Date.parse(dt) <= Date.now(), file: x.hasFile ? fileOf(f) || {} : null });
    }
    if (p === '/api/artwork' && m === 'GET') {
      const svcs = db.services.filter(arr);
      const all = (await Promise.all(svcs.map(s => artItems(s).catch(() => [])))).flat().map(({ fl, ...x }) => x);
      wpKick();
      const newest = [...all].sort((a, b) => String(b.added).localeCompare(String(a.added))), top = [...all].sort((a, b) => b.rating - a.rating);
      const hero = [], seen = new Set(), add = x => { const k = x.sid + ':' + x.id; if (!seen.has(k) && x.fanart && x.overview && hero.length < 8) { seen.add(k); hero.push(x); } };
      newest.slice(0, 40).forEach(x => hero.length < 4 && add(x)); top.slice(0, 40).forEach(add); newest.forEach(add);
      return send(res, 200, { hero, recent: newest.filter(x => x.poster).slice(0, 24), top: top.filter(x => x.poster).slice(0, 24),
        wall: shuffled(all.filter(x => x.poster)).slice(0, 40), shows: all.filter(x => x.tv).length, movies: all.filter(x => !x.tv).length });
    }
    if (p === '/api/artimg' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = arr(db.services.find(x => x.id === q.get('sid'))), pth = q.get('p') || '';
      if (!s || !/^\/MediaCover\/[\w./%-]+$/.test(pth) || pth.includes('..')) return send(res, 404, { error: 'Not found' });
      const x = await fetch(s.url.replace(/\/+$/, '') + pth, { signal: AbortSignal.timeout(15000), headers: { 'X-Api-Key': s.apiKey } });
      const b = Buffer.from(await x.arrayBuffer()), k = imgKind(b);
      if (!x.ok || !k || b.length > 9e6) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': WPM[k], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); return res.end(b);
    }
    if ((r = p.match(/^\/api\/series\/(\w+)\/(\d+)$/)) && m === 'GET') {
      const s = arr(db.services.find(x => x.id === r[1])); if (!s || s.type !== 'sonarr') return send(res, 404, { error: 'Not found' });
      const [sr, eps, files] = await Promise.all([call(s, `/api/v3/series/${r[2]}`), call(s, `/api/v3/episode?seriesId=${r[2]}`), call(s, `/api/v3/episodefile?seriesId=${r[2]}`).catch(() => [])]);
      const fmap = {}; (Array.isArray(files) ? files : []).forEach(f => { fmap[f.id] = { q: ((f.quality || {}).quality || {}).name || '', size: f.size || 0 }; });
      const now = Date.now();
      return send(res, 200, { ids: idsOf(sr, 'tv'), id: sr.id, title: sr.title, monitored: !!sr.monitored, seasons: (sr.seasons || []).map(x => ({ n: x.seasonNumber, monitored: !!x.monitored })),
        episodes: (Array.isArray(eps) ? eps : []).map(e => { const dt = e.airDateUtc || e.airDate || '', f = fmap[e.episodeFileId] || {};
          return { id: e.id, season: e.seasonNumber, num: e.episodeNumber, title: e.title || '', overview: cut(e.overview, 2000), runtime: +e.runtime || 0, date: dt, monitored: !!e.monitored, has: !!e.hasFile, quality: f.q || '', size: f.size || 0, aired: !!dt && Date.parse(dt) <= now }; })
          .sort((a, b) => a.season - b.season || a.num - b.num) });
    }
    if (p === '/api/monitor' && m === 'POST') {
      if (deny('add', 'change what is monitored')) return;
      const b = await readBody(req), s = arr(db.services.find(x => x.id === b.sid)), mon = !!b.monitored, id = +b.id;
      if (!s) return send(res, 404, { error: 'Not found' });
      const put = (path, obj) => call(s, path, { method: 'PUT', body: JSON.stringify(obj) });
      if (b.kind === 'movie' && s.type === 'radarr' && id > 0) { const mv = await call(s, `/api/v3/movie/${id}`); mv.monitored = mon; await put(`/api/v3/movie/${id}`, mv); }
      else if (b.kind === 'series' && s.type === 'sonarr' && id > 0) { const sr = await call(s, `/api/v3/series/${id}`); sr.monitored = mon; await put(`/api/v3/series/${id}`, sr); }
      else if (b.kind === 'season' && s.type === 'sonarr' && id > 0 && Number.isInteger(+b.season)) {
        const sr = await call(s, `/api/v3/series/${id}`), se = (sr.seasons || []).find(x => x.seasonNumber === +b.season);
        if (!se) return send(res, 404, { error: 'That season was not found' });
        se.monitored = mon; await put(`/api/v3/series/${id}`, sr);
        const ids = (await call(s, `/api/v3/episode?seriesId=${id}`)).filter(e => e.seasonNumber === +b.season).map(e => e.id);
        if (ids.length) await put('/api/v3/episode/monitor', { episodeIds: ids, monitored: mon });
      } else if (b.kind === 'episodes' && s.type === 'sonarr') {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
        if (!ids.length) return send(res, 400, { error: 'Bad request' });
        await put('/api/v3/episode/monitor', { episodeIds: ids, monitored: mon });
      } else return send(res, 400, { error: 'Bad request' });
      audit(me.name, mon ? 'Started monitoring' : 'Stopped monitoring', `${s.name} ${b.kind}${id > 0 ? ' ' + id : ''}${b.season != null ? ' season ' + b.season : ''}${b.kind === 'episodes' ? ' (' + b.ids.length + ')' : ''}`);
      return send(res, 200, {});
    }
    const plex = async (s, pth) => {
      const x = await fetch(s.url.replace(/\/+$/, '') + pth, { signal: AbortSignal.timeout(8000), headers: { 'X-Plex-Token': s.apiKey, Accept: 'application/json' } });
      if (!x.ok) throw new Error('Plex returned ' + x.status); return x;
    };
    if ((r = p.match(/^\/api\/plex\/(\w+)\/now$/))) {
      const s = svcOf(r[1], 'plex'); if (!s) return send(res, 404, { error: 'Not found' });
      const lim = libLimited(me), recentRaw = async () => lim
        ? (await Promise.all(((me.plexLibs || {}).mine || []).map(k => plex(s, `/library/sections/${k}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=60`).then(x => x.json()).then(j => (j.MediaContainer || {}).Metadata || []).catch(() => [])))).flat()
        : ((await plex(s, '/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=60').then(x => x.json())).MediaContainer || {}).Metadata || [];
      const [sessions, raw0] = await Promise.all([plexSessions(s), recentRaw()]);
      let raw = raw0;
      if (ownNames(me)) { const keep = await Promise.all(raw0.map(async x => { try { return !isHidden(me, await plexTags(s, String(x.type === 'episode' ? x.grandparentRatingKey : x.type === 'season' ? x.parentRatingKey : x.ratingKey || ''))); } catch { return false; } })); raw = raw0.filter((_, i) => keep[i]); }
      raw = pickRecent(raw, x => (x.addedAt || 0) * 1000);
      const th2 = x => x.grandparentThumb || x.parentThumb || x.thumb || '';
      const nm = x => x.type === 'episode' ? { title: x.grandparentTitle, sub: `S${pad2(x.parentIndex)}E${pad2(x.index)} ${x.title}` } : { title: x.title, sub: String(x.year || '') };
      const mineS = mineOnly(me, sessions), recent = raw.map(x => ({ ...nm(x), thumb: th2(x) }));
      grant(me, s.id, [...mineS.map(x => x.thumb), ...recent.map(x => x.thumb)]);
      return send(res, 200, { sessions: mineS, recent });
    }
    if ((r = p.match(/^\/api\/plex\/(\w+)\/img$/))) {
      const s = svcOf(r[1], 'plex'), pth = new URL(req.url, 'http://x').searchParams.get('p') || '';
      if (!s || !/^\/library\/[\w\/.-]+$/.test(pth) || pth.includes('..')) return send(res, 400, { error: 'Bad request' });
      if (!mayImg(me, s.id, pth)) return send(res, 403, { error: 'Not available to your profile' });
      const x = await plex(s, pth);
      res.writeHead(200, { 'Content-Type': x.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
      return res.end(Buffer.from(await x.arrayBuffer()));
    }
    if ((r = p.match(/^\/api\/jellyfin\/(\w+)\/now$/))) {
      const s = svcOf(r[1], 'jellyfin'); if (!s) return send(res, 404, { error: 'Not found' });
      const [sessions, b] = await Promise.all([jfSessions(s), jfGet(s, '/Items?SortBy=DateCreated&SortOrder=Descending&Recursive=true&IncludeItemTypes=Movie,Series&Fields=DateCreated&Limit=60').then(x => x.json())]);
      const mineJ = mineOnly(me, sessions); grant(me, s.id, mineJ.map(x => x.thumb)); return send(res, 200, { sessions: mineJ, recent: ownNames(me) ? [] : pickRecent(b.Items || [], x => Date.parse(x.DateCreated)).map(x => ({ title: cut(x.Name, 120), sub: String(x.ProductionYear || ''), thumb: x.Id })) });
    }
    if ((r = p.match(/^\/api\/jellyfin\/(\w+)\/img$/))) {
      const s = svcOf(r[1], 'jellyfin'), id = new URL(req.url, 'http://x').searchParams.get('p') || '';
      if (!s || !/^[0-9a-fA-F-]{32,36}$/.test(id)) return send(res, 400, { error: 'Bad request' });
      if (!mayImg(me, s.id, id)) return send(res, 403, { error: 'Not available to your profile' });
      const x = await jfGet(s, `/Items/${id}/Images/Primary?maxHeight=450&quality=85`);
      res.writeHead(200, { 'Content-Type': x.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
      return res.end(Buffer.from(await x.arrayBuffer()));
    }
    if ((r = p.match(/^\/api\/jellyfin\/(\w+)\/terminate$/)) && m === 'POST') {
      const s = svcOf(r[1], 'jellyfin'), b = await readBody(req); if (!s || !/^[0-9a-fA-F-]{8,64}$/.test(b.session || '')) return send(res, 400, { error: 'Bad request' });
      await jfGet(s, `/Sessions/${b.session}/Playing/Stop`, { method: 'POST' });
      audit(me.name, 'Ended a Jellyfin stream', s.name); return send(res, 200, {});
    }
    const taut = async (s, cmd, extra = '') => {
      const x = await fetch(`${s.url.replace(/\/+$/, '')}/api/v2?apikey=${encodeURIComponent(s.apiKey)}&cmd=${cmd}${extra}`, { signal: AbortSignal.timeout(10000) });
      const d = await x.json().catch(() => null);
      if (!x.ok || !d || !d.response || d.response.result !== 'success') throw new Error((d && d.response && d.response.message) || 'Tautulli returned ' + x.status);
      return d.response.data;
    };
    const sab = sabGet;
    if (p === '/api/attention' && m === 'GET') {
      const items = [], add = (level, text, tab) => items.push({ level, text, tab }), mine = db.services.filter(allowed), plural = (n, a, b) => n === 1 ? a : b;
      for (const s of mine) { const h = health[s.id]; if (h && !h.ok) add('bad', `${s.name} is not responding`, 'st:apps'); }
      await Promise.all(mine.map(async s => { try {
        if (s.type === 'qbittorrent') {
          const l = await qb(s, '/api/v2/torrents/info'), now = Date.now() / 1000;
          const err = l.filter(x => x.state === 'error' || x.state === 'missingFiles'); if (err.length) add('bad', `${err.length} ${plural(err.length, 'download has an error', 'downloads have errors')} in ${s.name}`, 'dl');
          const stuck = l.filter(x => x.progress < 1 && !/^(paused|stopped|queued|error|missing)/.test(x.state) && x.last_activity > 0 && now - x.last_activity > 86400);
          if (stuck.length) add('warn', `${stuck.length} ${plural(stuck.length, 'download has', 'downloads have')} made no progress for a day`, 'dl');
          const v = await vpnStatus(s).catch(() => null); if (v && v.vpn === false) add('bad', `${s.name} is not using the VPN`, 'dl');
        } else if (s.type === 'unraid') {
          const k = (await gql(s, '{ array { capacity { kilobytes { used total } } } }')).array.capacity.kilobytes, pct = +k.used / +k.total * 100, lim = (db.alerts && db.alerts.diskPct) || 90;
          if (pct >= lim) add(pct >= 95 ? 'bad' : 'warn', `The Unraid array is ${pct.toFixed(0)}% full`, 'ur');
        } else if (s.type === 'sonarr' || s.type === 'radarr') {
          const q = await call(s, '/api/v3/queue?page=1&pageSize=100'), bad = (q.records || []).filter(x => ['warning', 'error'].includes(x.trackedDownloadStatus) || x.status === 'failed');
          if (bad.length) add('warn', `${bad.length} ${plural(bad.length, 'item', 'items')} in ${s.name}'s queue ${plural(bad.length, 'needs', 'need')} attention`, 'up');
        }
      } catch {} }));
      if (me.role === 'admin') { const n = db.requests.filter(x => x.status === 'pending').length; if (n) add('warn', `${n} ${plural(n, 'request is', 'requests are')} waiting for approval`, 'rq'); }
      return send(res, 200, items);
    }
    if (p === '/api/history' && m === 'GET') {
      const ids = new Set(db.services.filter(allowed).map(s => s.id)), now = Date.now(), mine = db.history.filter(h => ids.has(h.svc));
      const tot = ms => { const l = mine.filter(h => now - h.at < ms); return { count: l.length, bytes: l.reduce((a, h) => a + (h.size || 0), 0) }; };
      return send(res, 200, { items: mine.slice(-200).reverse(), day: tot(864e5), week: tot(7 * 864e5), month: tot(30 * 864e5) });
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/match$/))) {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const out = {};
      await Promise.all(db.services.filter(x => arr(x)).map(async x => { try {
        const q = await call(x, '/api/v3/queue?page=1&pageSize=200&' + (x.type === 'sonarr' ? 'includeSeries=true' : 'includeMovie=true'));
        for (const rec of q.records || []) if (rec.downloadId) out[String(rec.downloadId).toLowerCase()] = (x.type === 'sonarr' ? (rec.series || {}).title : (rec.movie || {}).title) || rec.title;
      } catch {} }));
      return send(res, 200, out);
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/files$/)) && m === 'POST') {
      if (deny('control', 'change downloads')) return;
      const b = await readBody(req), s = svcOf(r[1], 'qbittorrent');
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n >= 0).slice(0, 3000);
      if (!s || !hs(b.hash) || String(b.hash).includes('|') || !ids.length || ![0, 1].includes(+b.priority)) return send(res, 400, { error: 'Bad request' });
      await qb(s, '/api/v2/torrents/filePrio', { hash: b.hash, id: ids.join('|'), priority: String(+b.priority) });
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/schedule$/)) && m === 'GET') {
      const s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const a = await qb(s, '/api/v2/app/preferences'), z = n => String(n || 0).padStart(2, '0');
      return send(res, 200, { on: !!a.scheduler_enabled, from: z(a.schedule_from_hour) + ':' + z(a.schedule_from_min), to: z(a.schedule_to_hour) + ':' + z(a.schedule_to_min), days: a.scheduler_days || 0, action: a.max_ratio_act || 0 });
    }
    if (p === '/api/wanted' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = arr(db.services.find(x => x.id === q.get('sid')));
      if (!s) return send(res, 404, { error: 'Pick a Sonarr or Radarr service' });
      const kind = q.get('kind') === 'cutoff' ? 'cutoff' : 'missing', page = Math.max(1, +q.get('page') || 1), tv = s.type === 'sonarr', z = n => String(n || 0).padStart(2, '0');
      const d = await call(s, `/api/v3/wanted/${kind}?page=${page}&pageSize=30${tv ? '&sortKey=airDateUtc&sortDirection=descending&includeSeries=true' : ''}`);
      const poster = o => ((o.images || []).find(i => i.coverType === 'poster') || {}).remoteUrl || o.remotePoster;
      return send(res, 200, { total: d.totalRecords || 0, items: (d.records || []).map(x => tv
        ? { id: x.id, title: (x.series || {}).title || x.title, sub: `S${z(x.seasonNumber)}E${z(x.episodeNumber)} ${x.title}`, date: x.airDateUtc, poster: poster(x.series || {}), overview: x.overview || '', about: (x.series || {}).overview || '' }
        : { id: x.id, title: x.title, sub: String(x.year || ''), date: x.digitalRelease || x.physicalRelease || x.inCinemas, poster: poster(x), overview: x.overview || '', about: '' }) });
    }
    if ((r = p.match(/^\/api\/tautulli\/(\w+)\/stats$/))) {
      const s = svcOf(r[1], 'tautulli'); if (!s) return send(res, 404, { error: 'Not found' });
      const days = [7, 30, 90].includes(+new URL(req.url, 'http://x').searchParams.get('days')) ? +new URL(req.url, 'http://x').searchParams.get('days') : 30;
      const ob = ownNames(me);
      if (ob) {
        let who = null; try { who = ((await taut(s, 'get_users')) || []).find(x => ob.includes(String(x.username || '').trim().toLowerCase()) || ob.includes(String(x.friendly_name || '').trim().toLowerCase())); } catch {}
        const none = { days, own: true, movies: [], tv: [], users: [], totals: { plays: 0, seconds: 0 }, byDate: null, byHour: null, byPlatform: null, history: [] };
        if (!who || !who.user_id) return send(res, 200, none);
        const U = '&user_id=' + encodeURIComponent(who.user_id), sf = pr => pr.catch(() => null), im = x => { const v = x && (x.grandparent_thumb || x.thumb); return /^\/library\/[\w\/.-]+$/.test(v || '') && !v.includes('..') ? v : ''; };
        const [hist, byDate, byDur, byHour, byPlat] = await Promise.all([sf(taut(s, 'get_history', '&length=300' + U)), sf(taut(s, 'get_plays_by_date', `&time_range=${days}&y_axis=plays` + U)), sf(taut(s, 'get_plays_by_date', `&time_range=${days}&y_axis=duration` + U)),
          sf(taut(s, 'get_plays_by_hourofday', `&time_range=${days}&y_axis=plays` + U)), sf(taut(s, 'get_plays_by_top_10_platforms', `&time_range=${days}&y_axis=plays` + U))]);
        const ch = (c, n = 6) => c && Array.isArray(c.categories) ? { categories: c.categories.map(x => cut(x, 40)), series: (c.series || []).slice(0, n).map(z => ({ name: cut(z.name, 30), data: (z.data || []).map(v => +v || 0) })) } : null;
        const sm = c => c ? c.series.reduce((a, z) => a + z.data.reduce((q, v) => q + v, 0), 0) : 0, dur = ch(byDur), plays = ch(byDate), rows = ((hist || {}).data || []).filter(x => (x.date || 0) * 1000 >= Date.now() - days * 864e5);
        const top = (type, key) => { const g = new Map(); for (const x of rows.filter(y => y.media_type === type)) { const t = cut(x[key] || x.title, 120), e = g.get(t) || { title: t, plays: 0, thumb: im(x), year: x.year || '' }; e.plays++; g.set(t, e); } return [...g.values()].sort((a, b) => b.plays - a.plays).slice(0, 10); };
        const outS = { days, own: true, movies: top('movie', 'title'), tv: top('episode', 'grandparent_title'), users: [{ title: cut(who.friendly_name || who.username, 60), plays: rows.length, seconds: rows.reduce((a, x) => a + (+x.duration || 0), 0) }],
          totals: { plays: sm(plays), seconds: sm(dur) }, byDate: plays, byHour: ch(byHour), byPlatform: ch(byPlat),
          history: ((hist || {}).data || []).slice(0, 14).map(x => ({ user: x.friendly_name || x.user, title: x.full_title || x.title, type: x.media_type, at: (x.date || 0) * 1000, player: x.player, pct: x.percent_complete, thumb: im(x) })) };
        grant(me, s.id, [...outS.movies, ...outS.tv, ...outS.history].map(x => x.thumb)); return send(res, 200, outS);
      }
      const soft = pr => pr.catch(() => null), img = x => { const v = x && (x.grandparent_thumb || x.thumb); return /^\/library\/[\w\/.-]+$/.test(v || '') && !v.includes('..') ? v : ''; };
      const [home, hist, byDate, byDur, byHour, byPlat] = await Promise.all([taut(s, 'get_home_stats', `&time_range=${days}&stats_count=10`), taut(s, 'get_history', '&length=14'),
        soft(taut(s, 'get_plays_by_date', `&time_range=${days}&y_axis=plays`)), soft(taut(s, 'get_plays_by_date', `&time_range=${days}&y_axis=duration`)),
        soft(taut(s, 'get_plays_by_hourofday', `&time_range=${days}&y_axis=plays`)), soft(taut(s, 'get_plays_by_top_10_platforms', `&time_range=${days}&y_axis=plays`))]);
      const pick = id => ((home || []).find(x => x.stat_id === id) || {}).rows || [];
      const chart = (c, n = 6) => c && Array.isArray(c.categories) ? { categories: c.categories.map(x => cut(x, 40)), series: (c.series || []).slice(0, n).map(z => ({ name: cut(z.name, 30), data: (z.data || []).map(v => +v || 0) })) } : null;
      const sum = c => c ? c.series.reduce((a, z) => a + z.data.reduce((q, v) => q + v, 0), 0) : 0, dur = chart(byDur), plays = chart(byDate);
      return send(res, 200, { days, movies: pick('top_movies').map(x => ({ title: x.title, plays: x.total_plays, thumb: img(x), year: x.year || '' })),
        tv: pick('top_tv').map(x => ({ title: x.title, plays: x.total_plays, thumb: img(x) })), users: pick('top_users').map(x => ({ title: x.friendly_name || x.user, plays: x.total_plays, seconds: x.total_duration || 0 })),
        totals: { plays: sum(plays), seconds: sum(dur) }, byDate: plays, byHour: chart(byHour), byPlatform: chart(byPlat),
        history: ((hist || {}).data || []).map(x => ({ user: x.friendly_name || x.user, title: x.full_title || x.title, type: x.media_type, at: (x.date || 0) * 1000, player: x.player, pct: x.percent_complete, thumb: img(x) })) });
    }
    if ((r = p.match(/^\/api\/tautulli\/(\w+)\/img$/))) {
      const s = svcOf(r[1], 'tautulli'), pth = new URL(req.url, 'http://x').searchParams.get('p') || '';
      if (!s || !/^\/library\/[\w\/.-]+$/.test(pth) || pth.includes('..')) return send(res, 400, { error: 'Bad request' });
      if (!mayImg(me, s.id, pth)) return send(res, 403, { error: 'Not available to your profile' });
      const x = await fetch(`${s.url.replace(/\/+$/, '')}/api/v2?apikey=${encodeURIComponent(s.apiKey)}&cmd=pms_image_proxy&img=${encodeURIComponent(pth)}&width=300&height=450&fallback=poster`, { signal: AbortSignal.timeout(10000) });
      const ct = x.headers.get('content-type') || '';
      if (!x.ok || !/^image\//.test(ct)) return send(res, 404, { error: 'No image' });
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'private, max-age=86400' });
      return res.end(Buffer.from(await x.arrayBuffer()));
    }
    // ---- SABnzbd news servers (admins): list, add or change, test, remove.
    if ((r = p.match(/^\/api\/sab\/(\w+)\/servers(?:\/(test)|\/([\w.-]{1,80}))?$/))) {
      if (adminOnly()) return;
      const s = svcOf(r[1], 'sabnzbd'); if (!s) return send(res, 404, { error: 'Not found' });
      const pub = x => ({ name: x.name, displayname: x.displayname || x.name, host: x.host, port: +x.port || 0, ssl: !!+x.ssl, username: x.username || '',
        hasPassword: !!x.password, connections: +x.connections || 0, enable: !!+x.enable, priority: +x.priority || 0 });
      const list = async () => (((await sab(s, 'mode=get_config&section=servers')).config || {}).servers || []).map(pub);
      if (!r[2] && !r[3] && m === 'GET') return send(res, 200, await list());
      if (r[3] && m === 'DELETE') {
        if (DEMO) return send(res, 403, { error: 'This is turned off in the demo' });
        await sab(s, 'mode=del_config&section=servers&keyword=' + encodeURIComponent(r[3]));
        audit(me.name, 'Removed a usenet server', r[3]); return send(res, 200, await list());
      }
      if (m !== 'POST') return send(res, 404, { error: 'Not found' });
      const b = await readBody(req), host = String(b.host || '').trim(), port = +b.port || (b.ssl ? 563 : 119), conns = +b.connections || 8;
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return send(res, 400, { error: 'Enter the server address, like news.example.com' });
      if (!(port >= 1 && port <= 65535)) return send(res, 400, { error: 'The port must be between 1 and 65535' });
      if (!(conns >= 1 && conns <= 100)) return send(res, 400, { error: 'Connections must be between 1 and 100' });
      if (/[\r\n]/.test(String(b.username || '') + String(b.password || ''))) return send(res, 400, { error: 'Bad sign-in details' });
      const name = String(b.name || host).replace(/[^\w.-]+/g, '_').slice(0, 80);
      const q = new URLSearchParams({ host, port: String(port), ssl: b.ssl ? '1' : '0', username: String(b.username || ''), connections: String(conns) });
      // A blank password keeps the one already saved (SABnzbd reads ***** as "the stored password").
      q.set('password', b.password ? String(b.password) : '*****');
      if (r[2] === 'test') {
        q.set('mode', 'config'); q.set('name', 'test_server'); q.set('server', String(b.name || ''));
        const t = ((await sab(s, q.toString())).value) || {};
        return send(res, 200, { ok: !!t.result, message: String(t.message || (t.result ? 'Connected' : 'Could not connect')) });
      }
      if (DEMO) return send(res, 403, { error: 'This is turned off in the demo' });
      if (!b.password && !b.name) return send(res, 400, { error: 'Enter the password for this server' });
      q.set('mode', 'set_config'); q.set('section', 'servers'); q.set('keyword', name); q.set('name', name);
      q.set('displayname', String(b.displayname || host).slice(0, 80)); q.set('enable', b.enable === false ? '0' : '1');
      if (!b.password) q.delete('password');
      await sab(s, q.toString());
      audit(me.name, b.name ? 'Changed a usenet server' : 'Added a usenet server', host); return send(res, 200, await list());
    }
    if ((r = p.match(/^\/api\/sab\/(\w+)\/queue$/))) {
      const s = svcOf(r[1], 'sabnzbd'); if (!s) return send(res, 404, { error: 'Not found' });
      const d = (await sab(s, 'mode=queue&limit=8')).queue || {};
      return send(res, 200, { paused: !!d.paused, status: d.status, speed: (+d.kbpersec || 0) * 1024, slots: +d.noofslots_total || +d.noofslots || 0, left: d.sizeleft, timeleft: d.timeleft,
        jobs: (d.slots || []).map(j => ({ name: j.filename, pct: +j.percentage || 0, size: j.size, left: j.timeleft })) });
    }
    if ((r = p.match(/^\/api\/sab\/(\w+)\/act$/)) && m === 'POST') {
      if (deny('control', 'control downloads')) return;
      const s = svcOf(r[1], 'sabnzbd'), b = await readBody(req); if (!s || !['pause', 'resume'].includes(b.op)) return send(res, 400, { error: 'Bad request' });
      await sab(s, 'mode=' + b.op); return send(res, 200, {});
    }
    if (p === '/api/sessions' && m === 'GET') {
      const all = me.role === 'admin' && new URL(req.url, 'http://x').searchParams.get('all') === '1';
      return send(res, 200, [...sessions].filter(([, v]) => all || v.uid === me.id).map(([k, v]) => ({ id: k.slice(0, 16), user: (userOf(v.uid) || {}).name || '?', device: devLabel(v.ua), ip: v.ip, at: v.at, seen: v.seen, current: k === th(token) })).sort((a, b) => b.seen - a.seen));
    }
    if (p === '/api/sessions/revoke' && m === 'POST') {
      const b = await readBody(req);
      for (const [k, v] of [...sessions]) {
        if (k === th(token) || !(v.uid === me.id || me.role === 'admin')) continue;
        if (b.others ? v.uid === me.id : k.slice(0, 16) === b.id) sessions.delete(k);
      }
      saveSess(); audit(me.name, 'Signed out devices', b.others ? 'all other devices' : cut(b.id, 16)); return send(res, 200, {});
    }
    if (p === '/api/me/notify' && m === 'PUT') {
      const v = String((await readBody(req)).url || '').trim();
      if (v && !/^https?:\/\//i.test(v)) return send(res, 400, { error: 'Enter a web address starting with https://' });
      me.notify = v.slice(0, 500); save(); return send(res, 200, {});
    }
    if (p === '/api/me/notify/test' && m === 'POST') {
      try { if (!(await pushTo(me.notify, 'GoatMediaStackarr test', 'Phone messages are working.'))) return send(res, 400, { error: 'Save an address first' }); }
      catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, {});
    }
    // Profile pictures: any signed-in person may see them (they show next to names); each person sets their own.
    if ((r = p.match(/^\/api\/avatar\/(\w+)$/)) && m === 'GET') {
      const u = userOf(r[1]); if (!u || !u.avatar) return send(res, 404, { error: 'Not found' });
      let buf; try { buf = fs.readFileSync(avFile(u)); } catch { return send(res, 404, { error: 'Not found' }); }
      res.writeHead(200, { 'Content-Type': u.avatar.t, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return res.end(buf);
    }
    if (p === '/api/me/avatar' && m === 'PUT') {
      const b = await readBody(req), t = String(b.type || ''), magic = AVTYPES[t];
      let buf; try { buf = Buffer.from(String(b.data || '').replace(/^data:[\w/+.-]+;base64,/, ''), 'base64'); } catch { buf = Buffer.alloc(0); }
      if (!magic || buf.length < 64 || !magic.every((v, i) => buf[i] === v) || (t === 'image/webp' && buf.toString('latin1', 8, 12) !== 'WEBP')) return send(res, 400, { error: 'Pick a JPEG, PNG or WebP picture' });
      if (buf.length > 2e6) return send(res, 400, { error: 'That picture is too big. Pick one under 2 MB.' });
      fs.mkdirSync(AVD, { recursive: true }); fs.writeFileSync(avFile(me), buf, { mode: 0o600 });
      me.avatar = { t, v: Date.now() }; save(); audit(me.name, 'Changed their picture', ''); return send(res, 200, pubUser(me));
    }
    if (p === '/api/me/avatar' && m === 'DELETE') {
      try { fs.unlinkSync(avFile(me)); } catch {}
      delete me.avatar; save(); return send(res, 200, pubUser(me));
    }
    if (p === '/api/usage' && m === 'GET') return send(res, 200, await usageOf(me));
    if (p === '/api/me/dash' && m === 'PUT') {
      const b = await readBody(req), ok = a => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && /^\w{1,20}$/.test(x)).slice(0, 20);
      me.dash = { order: ok(b.order), hidden: ok(b.hidden) }; save(); return send(res, 200, {});
    }
    if (p === '/api/auto' && m === 'POST') {
      if (deny('add', 'start searches')) return;
      const b = await readBody(req), s = arr(db.services.find(x => x.id === b.sid));
      if (!s || !+b.id || (b.scope === 'season' && !Number.isInteger(+b.season))) return send(res, 400, { error: 'Bad request' });
      await call(s, '/api/v3/command', { method: 'POST', body: JSON.stringify(s.type === 'sonarr'
        ? (b.scope === 'season' ? { name: 'SeasonSearch', seriesId: +b.id, seasonNumber: +b.season } : b.scope === 'series' ? { name: 'SeriesSearch', seriesId: +b.id } : { name: 'EpisodeSearch', episodeIds: [+b.id] }) : { name: 'MoviesSearch', movieIds: [+b.id] }) });
      return send(res, 200, {});
    }
    if (p === '/api/releases' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, s = arr(db.services.find(x => x.id === q.get('sid')));
      if (!s || !+q.get('id')) return send(res, 400, { error: 'Bad request' });
      const rel = await call(s, `/api/v3/release?${s.type === 'sonarr' ? 'episodeId' : 'movieId'}=${+q.get('id')}`, { signal: AbortSignal.timeout(90000) });
      // A page about the release, if the indexer gives one. Links that carry a key or passkey are left out, so no secret ever reaches the browser.
      const page = x => { for (const v of [x.infoUrl, x.guid]) { try { const u = new URL(String(v || '')); if (/^https?:$/.test(u.protocol) && !/(api_?key|passkey|token|secret|pass|auth|rsskey|key)=/i.test(u.search) && !u.username && !u.password) return u.href.slice(0, 600); } catch {} } return ''; };
      return send(res, 200, rel.map(x => ({ guid: x.guid, indexerId: x.indexerId, title: x.title, size: x.size, seeders: x.seeders || 0, leechers: x.leechers || 0,
        indexer: x.indexer, quality: ((x.quality || {}).quality || {}).name, age: x.age, rejected: !!x.rejected, why: (x.rejections || []).slice(0, 2).join('; '),
        langs: (x.languages || []).map(l => cut(l && l.name, 30)).filter(Boolean).slice(0, 6), link: page(x), protocol: x.protocol === 'usenet' ? 'usenet' : x.protocol === 'torrent' ? 'torrent' : '', group: cut(x.releaseGroup, 40) }))
        .sort((a, b) => a.rejected - b.rejected || b.seeders - a.seeders).slice(0, 40));
    }
    if (p === '/api/grab' && m === 'POST') {
      if (deny('add', 'grab releases')) return;
      const b = await readBody(req), s = arr(db.services.find(x => x.id === b.sid));
      if (!s || !b.guid) return send(res, 400, { error: 'Bad request' });
      await call(s, '/api/v3/release', { method: 'POST', body: JSON.stringify({ guid: b.guid, indexerId: b.indexerId }) });
      return send(res, 200, {});
    }
    if (p === '/api/upcoming' && m === 'GET') {
      const qs = new URL(req.url, 'http://x').searchParams, pd = v => { const d = new Date(v); return v && !isNaN(d) ? d : null; };
      const from = pd(qs.get('from')) || new Date(); let to = pd(qs.get('to')) || new Date(+from + 14 * 864e5);
      if (to < from || to - from > 70 * 864e5) to = new Date(+from + 14 * 864e5);
      const cal = [], queue = [], errors = [];
      const day = d => d.toISOString().slice(0, 10), z = n => String(n).padStart(2, '0');
      await Promise.all(db.services.filter(s => allowed(s) && (s.type === 'sonarr' || s.type === 'radarr')).map(async s => {
        const tv = s.type === 'sonarr';
        try {
          const [c, q] = await Promise.all([
            call(s, `/api/v3/calendar?start=${day(from)}&end=${day(to)}${tv ? '&includeSeries=true' : ''}`),
            call(s, `/api/v3/queue?page=1&pageSize=50&${tv ? 'includeSeries=true&includeEpisode=true' : 'includeMovie=true'}`)]);
          c.forEach(x => {
            const d = tv ? x.airDateUtc : [x.digitalRelease, x.physicalRelease, x.inCinemas].filter(v => v && v >= day(from)).sort()[0];
            if (d) {
              const o = tv ? x.series || {} : x, img = (o.images || []).find(i => i.coverType === 'poster') || {};
              cal.push({ date: d, sid: s.id, id: x.id, title: tv ? o.title : x.title,
                sub: tv ? `S${z(x.seasonNumber)}E${z(x.episodeNumber)} · ${x.title}` : 'Movie release',
                poster: img.remoteUrl || o.remotePoster, overview: x.overview || '', about: tv ? o.overview || '' : '' });
            }
          });
          (q.records || []).forEach(x => {
            const o = tv ? x.series || {} : x.movie || {}, img = (o.images || []).find(i => i.coverType === 'poster') || {};
            queue.push({ title: o.title || x.title, sub: x.title, status: x.status, timeleft: x.timeleft,
              progress: x.size ? 1 - x.sizeleft / x.size : 0, poster: img.remoteUrl || o.remotePoster,
              overview: tv ? (x.episode || {}).overview || '' : o.overview || '', about: tv ? o.overview || '' : '',
              meta: [x.protocol, x.indexer, x.downloadClient].filter(Boolean).join(' · ') });
          });
        } catch (e) { errors.push(s.name + ': ' + e.message); }
      }));
      return send(res, 200, { calendar: cal.sort((a, b) => a.date.localeCompare(b.date)), queue, errors });
    }
    const mbSvc = id => { const sv = db.services.find(x => x.id === id); return sv && allowed(sv) && ['lidarr', 'readarr'].includes(sv.type) ? sv : null; };
    const MB = { lidarr: { ent: 'artist', name: 'artistName', cmd: 'ArtistSearch', key: 'artistId', add: { monitor: 'all', searchForMissingAlbums: true } }, readarr: { ent: 'author', name: 'authorName', cmd: 'AuthorSearch', key: 'authorId', add: { monitor: 'all', searchForMissingBooks: true } } };
    const mbPoster = x => ((x.images || []).find(i => i.coverType === 'poster') || (x.images || [])[0] || {}).remoteUrl || '';
    if ((r = p.match(/^\/api\/media\/(\w+)\/library$/)) && m === 'GET') {
      const sv = mbSvc(r[1]); if (!sv) return send(res, 404, { error: 'Not found' }); const c = MB[sv.type];
      const [d, miss] = await Promise.all([call(sv, `/api/v1/${c.ent}`, { signal: AbortSignal.timeout(60000) }), call(sv, '/api/v1/wanted/missing?pageSize=1').catch(() => ({}))]);
      return send(res, 200, { missing: (miss && miss.totalRecords) || 0, items: (Array.isArray(d) ? d : []).map(x => { const t = x.statistics || {}, lidarr = sv.type === 'lidarr';
        return { id: x.id, title: x[c.name], overview: (x.overview || '').slice(0, 400), poster: mbPoster(x), monitored: !!x.monitored, genres: (x.genres || []).slice(0, 4), added: x.added || '',
          size: t.sizeOnDisk || 0, have: lidarr ? t.trackFileCount || 0 : t.bookFileCount || 0, total: lidarr ? t.trackCount || 0 : t.totalBookCount || t.bookCount || 0, count: lidarr ? t.albumCount || 0 : t.bookCount || 0 }; }) });
    }
    if ((r = p.match(/^\/api\/media\/(\w+)\/search$/)) && m === 'GET') {
      const sv = mbSvc(r[1]); if (!sv) return send(res, 404, { error: 'Not found' }); const c = MB[sv.type], term = new URL(req.url, 'http://x').searchParams.get('term') || '';
      const [found, folders, profiles, meta] = await Promise.all([call(sv, `/api/v1/${c.ent}/lookup?term=` + encodeURIComponent(term)), call(sv, '/api/v1/rootfolder'), call(sv, '/api/v1/qualityprofile'), call(sv, '/api/v1/metadataprofile').catch(() => [])]);
      return send(res, 200, { results: (Array.isArray(found) ? found : []).slice(0, 12).map(x => ({ title: x[c.name], overview: (x.overview || '').slice(0, 300), poster: mbPoster(x), added: !!x.id, raw: x })),
        folders: folders.map(x => ({ path: x.path })), profiles: profiles.map(x => ({ id: x.id, name: x.name })), meta: (Array.isArray(meta) ? meta : []).map(x => ({ id: x.id, name: x.name })) });
    }
    if ((r = p.match(/^\/api\/media\/(\w+)\/add$/)) && m === 'POST') {
      if (deny('add', 'add music or books')) return;
      const sv = mbSvc(r[1]), b = await readBody(req); if (!sv || !b.item) return send(res, 404, { error: 'Not found' }); const c = MB[sv.type];
      await call(sv, `/api/v1/${c.ent}`, { method: 'POST', body: JSON.stringify({ ...b.item, rootFolderPath: b.rootFolderPath, qualityProfileId: +b.qualityProfileId, metadataProfileId: +b.metadataProfileId || 1, monitored: true, addOptions: c.add }) });
      audit(me.name, 'Added', (b.item[c.name] || '') + ' to ' + sv.name); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/media\/(\w+)\/(monitor|find)$/)) && m === 'POST') {
      if (deny('add', 'change this library')) return;
      const sv = mbSvc(r[1]), b = await readBody(req), id = +b.id; if (!sv || !(id > 0)) return send(res, 400, { error: 'Bad request' }); const c = MB[sv.type];
      if (r[2] === 'find') await call(sv, '/api/v1/command', { method: 'POST', body: JSON.stringify({ name: c.cmd, [c.key]: id }) });
      else { const it = await call(sv, `/api/v1/${c.ent}/${id}`); it.monitored = !!b.monitored; await call(sv, `/api/v1/${c.ent}/${id}`, { method: 'PUT', body: JSON.stringify(it) }); }
      return send(res, 200, {});
    }
    const bzSvc = id => svcOf(id, 'bazarr');
    if ((r = p.match(/^\/api\/bazarr\/(\w+)\/wanted$/)) && m === 'GET') {
      const sv = bzSvc(r[1]); if (!sv) return send(res, 404, { error: 'Not found' });
      const [e, mv] = await Promise.all([bz(sv, '/api/episodes/wanted?start=0&length=100').catch(x => ({ error: x.message })), bz(sv, '/api/movies/wanted?start=0&length=100').catch(x => ({ error: x.message }))]);
      if (e.error && mv.error) throw new Error(e.error);
      const miss = a => (a || []).map(l => ({ code: l.code2, name: l.name, forced: !!l.forced, hi: !!l.hi }));
      return send(res, 200, { episodes: ((e && e.data) || []).map(x => ({ id: x.sonarrEpisodeId, seriesId: x.sonarrSeriesId, title: x.seriesTitle, ep: x.episode_number, name: x.episodeTitle, missing: miss(x.missing_subtitles) })),
        movies: ((mv && mv.data) || []).map(x => ({ id: x.radarrId, title: x.title, missing: miss(x.missing_subtitles) })), total: ((e && e.total) || 0) + ((mv && mv.total) || 0) });
    }
    if ((r = p.match(/^\/api\/bazarr\/(\w+)\/search$/)) && m === 'POST') {
      if (deny('control', 'search for subtitles')) return;
      const sv = bzSvc(r[1]), b = await readBody(req); if (!sv || !(+b.id > 0) || !['episode', 'movie'].includes(b.kind)) return send(res, 400, { error: 'Bad request' });
      const langs = (Array.isArray(b.langs) ? b.langs : []).filter(l => /^[a-z]{2,3}$/i.test(l.code)).slice(0, 10); if (!langs.length) return send(res, 400, { error: 'No language to search for' });
      let ok = 0, bad = '';
      for (const l of langs) try {
        const form = new URLSearchParams(b.kind === 'episode' ? { seriesid: String(+b.seriesId), episodeid: String(+b.id), language: l.code, forced: String(!!l.forced), hi: String(!!l.hi) } : { radarrid: String(+b.id), language: l.code, forced: String(!!l.forced), hi: String(!!l.hi) });
        await bz(sv, b.kind === 'episode' ? '/api/episodes/subtitles' : '/api/movies/subtitles', { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }); ok++;
      } catch (e) { bad = e.message; }
      return send(res, ok ? 200 : 502, ok ? { found: ok, of: langs.length } : { error: bad || 'No subtitle was found' });
    }
    if ((r = p.match(/^\/api\/sab\/(\w+)\/history$/)) && m === 'GET') {
      const sv = svcOf(r[1], 'sabnzbd'); if (!sv) return send(res, 404, { error: 'Not found' });
      const d = (await sab(sv, 'mode=history&limit=30')).history || {};
      return send(res, 200, (d.slots || []).map(h => ({ id: h.nzo_id, name: h.name, size: h.size, status: h.status, error: h.fail_message || '', cat: h.category || '', at: (+h.completed || 0) * 1000 })));
    }
    if ((r = p.match(/^\/api\/sab\/(\w+)\/history\/act$/)) && m === 'POST') {
      if (deny('control', 'control downloads')) return;
      const sv = svcOf(r[1], 'sabnzbd'), b = await readBody(req); if (!sv || !/^[\w-]{3,60}$/.test(b.id || '') || !['retry', 'delete'].includes(b.op)) return send(res, 400, { error: 'Bad request' });
      await sab(sv, b.op === 'retry' ? 'mode=retry&value=' + b.id : 'mode=history&name=delete&value=' + b.id); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/sab\/(\w+)\/add$/)) && m === 'POST') {
      if (deny('add', 'add downloads')) return;
      const sv = svcOf(r[1], 'sabnzbd'), b = await readBody(req); if (!sv) return send(res, 404, { error: 'Not found' });
      const base = sv.url.replace(/\/+$/, '') + '/api?output=json&apikey=' + encodeURIComponent(sv.apiKey) + (b.category ? '&cat=' + encodeURIComponent(cut(b.category, 60)) : '');
      let x;
      if (b.url) { if (!/^https?:\/\//i.test(b.url)) return send(res, 400, { error: 'Enter a web address starting with http' }); x = await fetch(base + '&mode=addurl&name=' + encodeURIComponent(b.url), { signal: AbortSignal.timeout(20000) }); }
      else if (b.nzb) {
        const buf = Buffer.from(String(b.nzb), 'base64'); if (!buf.length || buf.length > 8e6) return send(res, 400, { error: 'That file is empty or too large' });
        const fd = new FormData(); fd.append('name', new Blob([buf], { type: 'application/x-nzb' }), cut(String(b.name || 'upload.nzb').replace(/[^\w.\- ]/g, '_'), 120));
        x = await fetch(base + '&mode=addfile', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
      } else return send(res, 400, { error: 'Choose an NZB file or enter an address' });
      const d = await x.json().catch(() => ({})); if (!x.ok || d.status === false) throw new Error(d.error || 'SABnzbd refused it');
      audit(me.name, 'Added an NZB', b.name || b.url || ''); return send(res, 200, {});
    }
    const presetSeries = async (sv, id, preset) => {
      const sr = await call(sv, `/api/v3/series/${id}`), eps = await call(sv, `/api/v3/episode?seriesId=${id}`), now = Date.now();
      const last = Math.max(0, ...(sr.seasons || []).map(z => z.seasonNumber).filter(n => n > 0));
      const want = e => preset === 'all' ? e.seasonNumber > 0 : preset === 'latest' ? e.seasonNumber === last : preset === 'future' ? Date.parse(e.airDateUtc || e.airDate || '') > now : false;
      const on = new Set(eps.filter(want).map(e => e.id));
      (sr.seasons || []).forEach(z => { z.monitored = eps.some(e => e.seasonNumber === z.seasonNumber && on.has(e.id)); });
      sr.monitored = preset !== 'none';
      await call(sv, `/api/v3/series/${id}`, { method: 'PUT', body: JSON.stringify(sr) });
      const yes = eps.filter(e => on.has(e.id)).map(e => e.id), no = eps.filter(e => !on.has(e.id)).map(e => e.id);
      if (yes.length) await call(sv, '/api/v3/episode/monitor', { method: 'PUT', body: JSON.stringify({ episodeIds: yes, monitored: true }) });
      if (no.length) await call(sv, '/api/v3/episode/monitor', { method: 'PUT', body: JSON.stringify({ episodeIds: no, monitored: false }) });
    };
    if (p === '/api/profiles' && m === 'GET') {
      const sv = arr(db.services.find(x => x.id === new URL(req.url, 'http://x').searchParams.get('sid'))); if (!sv) return send(res, 404, { error: 'Not found' });
      return send(res, 200, (await call(sv, '/api/v3/qualityprofile')).map(x => ({ id: x.id, name: x.name })));
    }
    if (p === '/api/bulk' && m === 'POST') {
      const b = await readBody(req), sv = arr(db.services.find(x => x.id === b.sid)), op = b.action, tv = sv && sv.type === 'sonarr';
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 300);
      if (!sv || !ids.length || !['monitor', 'unmonitor', 'profile', 'search', 'remove', 'preset'].includes(op)) return send(res, 400, { error: 'Bad request' });
      const key = tv ? 'seriesIds' : 'movieIds', edit = '/api/v3/' + (tv ? 'series' : 'movie') + '/editor', put = (o, method = 'PUT') => call(sv, edit, { method, body: JSON.stringify(o) });
      if (op === 'remove') { if (adminOnly()) return; await put({ [key]: ids, deleteFiles: !!b.deleteFiles, addImportExclusion: false }, 'DELETE'); }
      else {
        if (deny('add', 'change the library')) return;
        if (op === 'monitor' || op === 'unmonitor') await put({ [key]: ids, monitored: op === 'monitor' });
        else if (op === 'profile') { if (!(+b.qualityProfileId > 0)) return send(res, 400, { error: 'Pick a quality profile' }); await put({ [key]: ids, qualityProfileId: +b.qualityProfileId }); }
        else if (op === 'search') { if (tv) for (const id of ids.slice(0, 50)) await call(sv, '/api/v3/command', { method: 'POST', body: JSON.stringify({ name: 'SeriesSearch', seriesId: id }) });
          else await call(sv, '/api/v3/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: ids }) }); }
        else if (op === 'preset') { if (!tv || !['all', 'latest', 'future', 'none'].includes(b.preset)) return send(res, 400, { error: 'Bad request' }); for (const id of ids.slice(0, 100)) await presetSeries(sv, id, b.preset); }
      }
      audit(me.name, 'Bulk change', `${sv.name}: ${op}${op === 'preset' ? ' ' + b.preset : ''} on ${ids.length}`); return send(res, 200, { n: ids.length });
    }
    if (me.role !== 'admin') return send(res, 403, { error: 'Admins only' });
    if (p === '/api/throttle' && m === 'GET') { const t = db.settings.throttle || {}; return send(res, 200, { on: !!t.on, active: Object.keys(t.held || {}).length > 0 }); }
    if (p === '/api/throttle' && m === 'PUT') { const b = await readBody(req); db.settings.throttle = { ...(db.settings.throttle || {}), on: !!b.on }; save(); audit(me.name, b.on ? 'Turned on slowing downloads during streams' : 'Turned off slowing downloads during streams', ''); return send(res, 200, {}); }
    if (p === '/api/weekly' && m === 'GET') { const w = db.settings.weekly || {}; return send(res, 200, { on: !!w.on, day: w.day ?? 0, hour: w.hour ?? 9, last: w.last || 0 }); }
    if (p === '/api/weekly' && m === 'PUT') {
      const b = await readBody(req), o = db.settings.weekly || {}; db.settings.weekly = { on: !!b.on, day: Math.min(6, Math.max(0, Math.round(+b.day) || 0)), hour: Math.min(23, Math.max(0, Math.round(+b.hour) || 0)), last: o.on || !b.on ? o.last : Date.now() };
      save(); audit(me.name, 'Changed the weekly newsletter', b.on ? 'on' : 'off'); return send(res, 200, {});
    }
    if (p === '/api/weekly/send' && m === 'POST') { if (!((db.alerts || {}).channels || []).length) return send(res, 400, { error: 'Add an alert channel first' }); await sendNews(); return send(res, 200, {}); }
    if (p === '/api/weekly/preview' && m === 'GET') { const n = await newsData(); return send(res, 200, { text: newsText(n), html: newsHtml(n, baseUrl()) }); }
    if ((r = p.match(/^\/api\/reports\/(\w+)\/resolve$/)) && m === 'POST') {
      const x = db.reports.find(y => y.id === r[1]); if (!x) return send(res, 404, { error: 'Not found' }); x.status = 'done'; save(); return send(res, 200, {});
    }
    if (p === '/api/libhealth' && m === 'GET') {
      const out = await Promise.all(db.services.filter(x => ['sonarr', 'radarr', 'lidarr', 'readarr', 'prowlarr'].includes(x.type)).map(async sv => {
        const v = ['sonarr', 'radarr'].includes(sv.type) ? 'v3' : 'v1', o = { id: sv.id, name: sv.name, type: sv.type, issues: [], disks: [], queue: [], missing: null };
        try {
          const [h, d, q, w] = await Promise.all([ext(sv, `/api/${v}/health`), v === 'v3' ? ext(sv, '/api/v3/diskspace').catch(() => []) : [], v === 'v3' ? ext(sv, '/api/v3/queue?page=1&pageSize=50').catch(() => null) : null,
            sv.type === 'prowlarr' ? null : ext(sv, `/api/${v}/wanted/missing?pageSize=1`).catch(() => null)]);
          o.issues = (Array.isArray(h) ? h : []).map(x => ({ level: x.type === 'error' ? 'bad' : 'warn', text: x.message || x.source }));
          o.disks = (Array.isArray(d) ? d : []).filter(x => x.totalSpace > 0).map(x => ({ path: x.path, label: DISK_NAMES[String(x.path).replace(/\/+$/, '') || '/'] || '', free: x.freeSpace, total: x.totalSpace }))
            .sort((p, q) => DISK_ORDER.indexOf(p.label) - DISK_ORDER.indexOf(q.label));
          o.queue = ((q && q.records) || []).filter(x => ['warning', 'error'].includes(x.trackedDownloadStatus) || x.status === 'warning').slice(0, 10).map(x => ({ title: x.title, message: ((x.statusMessages || [])[0] || {}).messages ? x.statusMessages[0].messages[0] : x.errorMessage || 'Needs attention' }));
          o.missing = w && w.totalRecords != null ? w.totalRecords : null; o.ok = true;
        } catch (e) { o.ok = false; o.error = e.message; }
        return o;
      }));
      return send(res, 200, out);
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)\/catalog$/)) && m === 'GET') {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      const l = await jkList(s, false);
      return send(res, 200, (Array.isArray(l) ? l : []).map(x => ({ id: String(x.id), name: String(x.name || x.id), type: String(x.type || ''), language: String(x.language || ''), desc: String(x.description || '').slice(0, 200) }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)\/indexers\/([\w.-]+)\/config$/))) {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      const path = '/' + encodeURIComponent(r[2]) + '/config'; let cur;
      try { cur = await jk(s, path); } catch (e) { return send(res, 502, { error: [400, 401, 403, 404].includes(e.code) ? (s.pass ? 'Jackett would not open this indexer\'s settings (' + e.code + '). Check the admin password saved in Settings, Apps, Jackett.'
        : 'Jackett would not open this indexer\'s settings for GoatMediaStackarr (' + e.code + '). If Jackett has an admin password, add it in Settings, Apps, Jackett, then try again. Otherwise add this one in Jackett\'s own page.') : e.message }); }
      if (m === 'GET') return send(res, 200, (Array.isArray(cur) ? cur : []).map(jkField).filter(Boolean));
      if (m === 'POST') {
        const b = await readBody(req), vals = b.values && typeof b.values === 'object' ? b.values : {};
        const merged = (Array.isArray(cur) ? cur : []).map(f => JK_EDIT.includes(f.type) && Object.prototype.hasOwnProperty.call(vals, f.id) ? { ...f, value: jkCoerce(f, vals[f.id]) } : f);
        await jk(s, path, { method: 'POST', body: JSON.stringify(merged), timeout: 60000 });
        audit(me.name, 'Added indexer to Jackett', r[2]); return send(res, 200, { ok: true });
      }
    }
    if ((r = p.match(/^\/api\/jackett\/(\w+)\/indexers\/([\w.-]+)$/)) && m === 'DELETE') {
      const s = svcOf(r[1], 'jackett'); if (!s) return send(res, 404, { error: 'Not found' });
      await jk(s, '/' + encodeURIComponent(r[2]), { method: 'DELETE' }); audit(me.name, 'Removed indexer from Jackett', r[2]); return send(res, 200, {});
    }
    const prowSchema = async sv => { const l = await ext(sv, '/api/v1/indexer/schema'); return Array.isArray(l) ? l : []; };
    const prowKey = x => String(x.definitionName || x.name || '');
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/catalog$/)) && m === 'GET') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      return send(res, 200, (await prowSchema(sv)).map(x => ({ id: prowKey(x), name: String(x.name || x.definitionName || ''), type: String(x.privacy || ''), protocol: String(x.protocol || ''), language: String(x.language || ''), desc: String(x.description || '').slice(0, 200) }))
        .filter(x => x.id).sort((a, b) => a.name.localeCompare(b.name)));
    }
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/catalog\/([^/]+)\/fields$/)) && m === 'GET') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      const it = (await prowSchema(sv)).find(x => prowKey(x) === decodeURIComponent(r[2])); if (!it) return send(res, 404, { error: 'That indexer is not in Prowlarr\'s list' });
      return send(res, 200, { name: String(it.name || ''), fields: (it.fields || []).filter(f => !f.advanced && f.hidden !== 'hidden' && f.type !== 'info' && f.name && f.name !== 'definitionFile')
        .map(f => ({ id: String(f.name), type: ['password', 'checkbox', 'select', 'number'].includes(f.type) ? f.type : 'textbox', name: String(f.label || f.name).slice(0, 200), help: String(f.helpText || '').replace(/<[^>]*>/g, ' ').slice(0, 300),
          value: f.type === 'checkbox' ? !!f.value : Array.isArray(f.value) ? f.value.join(', ') : String(f.value == null ? '' : f.value).slice(0, 2000),
          options: f.type === 'select' ? (f.selectOptions || []).map(o => [String(o.value), String(o.name)]) : undefined })) });
    }
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/indexers$/)) && m === 'POST') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      const b = await readBody(req), it = (await prowSchema(sv)).find(x => prowKey(x) === String(b.def));
      if (!it) return send(res, 404, { error: 'That indexer is not in Prowlarr\'s list' });
      const vals = b.values && typeof b.values === 'object' ? b.values : {}, prof = await ext(sv, '/api/v1/appprofile').catch(() => []);
      it.name = String(b.name || it.name || '').trim().slice(0, 100) || it.name; it.enable = true; it.priority = 25; it.tags = [];
      it.appProfileId = Array.isArray(prof) && prof[0] ? prof[0].id : 1;
      it.fields = (it.fields || []).map(f => !Object.prototype.hasOwnProperty.call(vals, f.name) || f.hidden === 'hidden' ? f
        : { ...f, value: f.type === 'checkbox' ? vals[f.name] === true : f.type === 'number' ? (+vals[f.name] || 0) : String(vals[f.name] == null ? '' : vals[f.name]).slice(0, 2000) });
      let out; try { out = await ext(sv, '/api/v1/indexer' + (b.force === true ? '?forceSave=true' : ''), { method: 'POST', body: JSON.stringify(it), signal: AbortSignal.timeout(90000) }); } catch (e) { return send(res, 502, { error: e.message }); }
      audit(me.name, 'Added indexer to Prowlarr', it.name); return send(res, 200, { id: out && out.id });
    }
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/indexers\/(\d+)$/)) && m === 'DELETE') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      await ext(sv, '/api/v1/indexer/' + r[2], { method: 'DELETE' }); audit(me.name, 'Removed indexer from Prowlarr', 'number ' + r[2]); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/indexers$/)) && m === 'GET') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      const [ix, stt, h] = await Promise.all([ext(sv, '/api/v1/indexer'), ext(sv, '/api/v1/indexerstatus').catch(() => []), ext(sv, '/api/v1/health').catch(() => [])]), bad = {}; (Array.isArray(stt) ? stt : []).forEach(x => { bad[x.indexerId] = x; });
      return send(res, 200, { health: (Array.isArray(h) ? h : []).map(x => x.message), indexers: ix.map(x => { const b = bad[x.id], blocked = b && b.disabledTill && Date.parse(b.disabledTill) > Date.now();
        return { id: x.id, name: x.name, protocol: x.protocol, enabled: !!x.enable, priority: x.priority, status: !x.enable ? 'disabled' : blocked ? 'failing' : 'ok', until: blocked ? b.disabledTill : '' }; }) });
    }
    if ((r = p.match(/^\/api\/prowlarr\/(\w+)\/indexers\/(\d+|all)\/test$/)) && m === 'POST') {
      const sv = svcOf(r[1], 'prowlarr'); if (!sv) return send(res, 404, { error: 'Not found' });
      if (r[2] === 'all') { const l = await ext(sv, '/api/v1/indexer/testall', { method: 'POST', signal: AbortSignal.timeout(120000) }); return send(res, 200, (Array.isArray(l) ? l : []).map(x => ({ id: x.id, ok: !!x.isValid, error: ((x.validationFailures || [])[0] || {}).errorMessage || '' }))); }
      const ix = await ext(sv, '/api/v1/indexer/' + r[2]);
      try { await ext(sv, '/api/v1/indexer/test', { method: 'POST', body: JSON.stringify(ix), signal: AbortSignal.timeout(60000) }); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if ((r = p.match(/^\/api\/media\/(\w+)\/(\d+)$/)) && m === 'DELETE') {
      const sv = mbSvc(r[1]); if (!sv) return send(res, 404, { error: 'Not found' }); const c = MB[sv.type];
      await call(sv, `/api/v1/${c.ent}/${r[2]}?deleteFiles=${new URL(req.url, 'http://x').searchParams.get('files') === '1'}`, { method: 'DELETE' }); audit(me.name, 'Removed from library', sv.name + ' item ' + r[2]); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/unraid\/(\w+)\/docker$/)) && m === 'POST') {
      const b = await readBody(req), s = svcOf(r[1], 'unraid');
      if (!s || !/^[\w:.\-]+$/.test(b.id || '') || !['start', 'stop', 'restart'].includes(b.action)) return send(res, 400, { error: 'Bad request' });
      const run = a => gql(s, `mutation { docker { ${a}(id: ${JSON.stringify(b.id)}) { id } } }`);
      if (b.action === 'restart') { await run('stop'); await run('start'); } else await run(b.action);
      return send(res, 200, {});
    }
    if (p === '/api/services' && m === 'POST') {
      const b = await readBody(req);
      if (!b.name || !/^https?:\/\//.test(b.url || '')) return send(res, 400, { error: 'Enter a name and an address starting with http:// or https://' });
      if (!KINDS.includes(b.type)) return send(res, 400, { error: 'Pick an app type' });
      const s = { id: uid(), type: b.type, name: b.name, url: b.url, apiKey: b.apiKey || '', user: b.user || '', pass: b.pass || '' };
      db.services.push(s); save(); audit(me.name, 'Added an app', s.name); return send(res, 200, pubSvc(s));
    }
    if ((r = p.match(/^\/api\/services\/(\w+)$/)) && m === 'DELETE') {
      const gone = db.services.find(s => s.id === r[1]); if (gone) audit(me.name, 'Removed an app', gone.name);
      db.services = db.services.filter(s => s.id !== r[1]);
      db.users.forEach(u => u.access = u.access.filter(a => a !== r[1])); save(); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/users\/(\w+)\/password$/)) && m === 'POST') {
      const u = db.users.find(x => x.id === r[1]), b = await readBody(req);
      if (!u) return send(res, 404, { error: 'Not found' });
      if ((b.password || '').length < 8) return send(res, 400, { error: 'Password must be 8+ characters' });
      u.salt = uid(); u.hash = hash(b.password, u.salt); delete u.reset; save(); audit(me.name, 'Reset a password', u.name);
      for (const [k, v] of sessions) if (v.uid === u.id && k !== th(token)) sessions.delete(k);
      saveSess(); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/requests\/(\w+)\/(approve|decline)$/)) && m === 'POST') {
      const x = db.requests.find(y => y.id === r[1]);
      if (!x || x.status !== 'pending') return send(res, 404, { error: 'Request not found' });
      if (r[2] === 'approve') {
        const s = db.services.find(y => y.id === x.sid); if (!s) return send(res, 400, { error: 'That Seerr service was removed' });
        const sr = await seerrAdd(s, x); x.seerrId = sr && sr.id; x.status = 'approved'; x.stage = 'approved';
      } else { x.status = 'declined'; x.stage = 'declined'; }
      save(); audit(me.name, r[2] === 'approve' ? 'Approved a request' : 'Declined a request', x.title + ' (' + x.user + ')');
      notifyUser(userOf(x.uid), r[2] === 'approve' ? 'Request approved' : 'Request declined', x.title).catch(() => {});
      mon.reqT = 0;
      return send(res, 200, x);
    }
    if (p === '/api/alerts' && m === 'GET') {
      const a = db.alerts || {}, pub = c => ({ id: c.id, type: c.type, where: c.target ? (() => { try { return new URL(c.target).origin + '/…'; } catch { return '…'; } })() : '', chat: c.type === 'telegram' || c.type === 'pushover' ? c.chat : '',
        host: c.host || '', port: c.port || '', secure: c.secure || '', user: c.user || '', from: c.from || '', to: c.to || '', hasSecret: !!(c.token || c.pass) });
      return send(res, 200, { finished: !!a.finished, offline: !!a.offline, disk: !!a.disk, vpn: !!a.vpn, requests: !!a.requests, reports: a.reports !== false, diskPct: a.diskPct || 90, channels: (a.channels || []).map(pub) });
    }
    if (p === '/api/alerts' && m === 'PUT') {
      const b = await readBody(req), o = db.alerts || { channels: [] };
      db.alerts = { ...o, finished: !!b.finished, offline: !!b.offline, disk: !!b.disk, vpn: !!b.vpn, requests: !!b.requests, reports: b.reports !== false, diskPct: Math.min(99, Math.max(50, +b.diskPct || 90)) };
      save(); audit(me.name, 'Changed alert settings', ''); return send(res, 200, {});
    }
    const chanFields = (b, o = {}) => { const g = k => b[k] != null && String(b[k]).trim() !== '' ? String(b[k]).trim().slice(0, 500) : o[k];
      return { id: o.id || uid(), type: b.type || o.type, target: g('target'), token: g('token'), chat: g('chat'), host: g('host'), port: g('port'), secure: ['ssl', 'starttls', 'none'].includes(b.secure) ? b.secure : o.secure || 'starttls', user: g('user'), pass: g('pass'), from: g('from'), to: g('to') }; };
    if (p === '/api/alerts/channels' && m === 'POST') {
      const c = chanFields(await readBody(req)), why = channels.problem(c); if (why) return send(res, 400, { error: why });
      db.alerts = db.alerts || {}; (db.alerts.channels = db.alerts.channels || []).push(c); save(); audit(me.name, 'Added an alert channel', c.type); return send(res, 200, { id: c.id });
    }
    if ((r = p.match(/^\/api\/alerts\/channels\/(\w+)$/)) && (m === 'PUT' || m === 'DELETE')) {
      const list = (db.alerts || {}).channels || [], i = list.findIndex(c => c.id === r[1]); if (i < 0) return send(res, 404, { error: 'Not found' });
      if (m === 'DELETE') { list.splice(i, 1); save(); audit(me.name, 'Removed an alert channel', ''); return send(res, 200, {}); }
      const c = chanFields(await readBody(req), list[i]), why = channels.problem(c); if (why) return send(res, 400, { error: why });
      list[i] = c; save(); audit(me.name, 'Edited an alert channel', c.type); return send(res, 200, {});
    }
    if (p === '/api/alerts/test' && m === 'POST') {
      const b = await readBody(req), list = ((db.alerts || {}).channels || []).filter(c => !b.id || c.id === b.id);
      if (!list.length) return send(res, 400, { error: 'Add a channel first' });
      const results = await Promise.all(list.map(async c => { try { await channels.send(c, 'GoatMediaStackarr test', 'Alerts are working.'); return { id: c.id, ok: true }; } catch (e) { return { id: c.id, ok: false, error: String(e.message).slice(0, 200) }; } }));
      return send(res, 200, { results });
    }
    const SCOPES = ['apps', 'traffic', 'downloads', 'upcoming', 'watching'], LOOKS = ['auto', 'dark', 'light'];
    const linkScopes = b => Object.fromEntries(SCOPES.map(k => [k, k === 'apps' ? b[k] !== false : !!b[k]]));
    if (p === '/api/listsettings' && m === 'GET') {
      const k = listKeys(), hint = v => v ? '\u2022\u2022\u2022\u2022' + v.slice(-4) : '';
      return send(res, 200, { trakt: { on: !!k.trakt, hint: hint(k.trakt) }, tmdb: { on: !!k.tmdb, hint: hint(k.tmdb) }, tvdb: { on: !!k.tvdb, hint: hint(k.tvdb) } });
    }
    if (p === '/api/listsettings' && m === 'PUT') {
      const b = await readBody(req), cur = (db.settings.lists = db.settings.lists || {}), field = { trakt: 'id', tmdb: 'key', tvdb: 'key' }, changed = [];
      for (const src of Object.keys(field)) {
        if (typeof b[src] !== 'string') continue;   // left out: keep what is saved
        const v = b[src].trim();
        if (v && !/^[\w.\-]{8,2000}$/.test(v)) return send(res, 400, { error: `That does not look like a ${listsLib.NAMES[src]} key. Copy it again without spaces.` });
        if (v) cur[src] = { [field[src]]: v }; else delete cur[src];
        changed.push(listsLib.NAMES[src] + (v ? ' saved' : ' removed'));
      }
      save(); audit(me.name, 'Changed Discover list keys', changed.join(', ')); return send(res, 200, lists.enabled());
    }
    if (p === '/api/plexsettings' && m === 'GET') {
      const c = plexCfg();
      return send(res, 200, { on: c.on || !!(db.settings.plexLogin || {}).on, auto: c.auto, sid: c.sid, servers: db.services.filter(x => x.type === 'plex').map(x => ({ id: x.id, name: x.name })), access: c.access, perms: c.perms, hide: c.hide, linked: db.users.filter(x => x.plex).length });
    }
    if (p === '/api/plexsettings' && m === 'PUT') {
      const b = await readBody(req), o = db.settings.plexLogin || {}, srv = db.services.find(x => x.id === b.sid && x.type === 'plex');
      if (b.on && !srv && !db.services.some(x => x.type === 'plex')) return send(res, 400, { error: 'Add your Plex server under Settings, then Apps, first.' });
      db.settings.plexLogin = { on: !!b.on, sid: srv ? srv.id : (o.sid || ''), auto: b.auto !== false,
        access: Array.isArray(b.access) ? b.access.filter(a => db.services.some(x => x.id === a)) : o.access,
        perms: b.perms ? Object.fromEntries(['add', 'control', 'remove', 'request'].map(k => [k, b.perms[k] === true])) : o.perms, hide: 'hide' in b ? cleanHide(b.hide) : o.hide };
      save(); audit(me.name, 'Changed Sign in with Plex', b.on ? 'on' : 'off'); return send(res, 200, {});
    }
    if (p === '/api/signin' && m === 'GET') {
      const mc = mailer();
      return send(res, 200, { mail: !!mc, mailFrom: mc ? mc.from : '', publicUrl: baseUrl(), urlFromEnv: !!process.env.PUBLIC_URL, loginArt: wpMode(), cached: wpList().filter(f => LIBWP.test(f)).length, own: wpList().filter(f => !LIBWP.test(f)).length, wp: { at: wpState.at, running: wpBusy, errors: wpState.errors } });
    }
    if (p === '/api/signin/refresh' && m === 'POST') { const r0 = await wpSync(true); return send(res, 200, { ok: r0.ok, count: r0.count, saved: r0.saved, errors: r0.errors }); }
    if (p === '/api/signin' && m === 'PUT') {
      const b = await readBody(req);
      if (b.loginArt != null) { db.settings.loginArt = b.loginArt === 'scenes' ? 'scenes' : 'library'; if (wpMode() === 'library') wpKick(); }
      if (b.publicUrl != null && !process.env.PUBLIC_URL) {
        const v = cut(b.publicUrl, 200).trim().replace(/\/+$/, '');
        if (v && !/^https?:\/\/[^\s/]+$/i.test(v)) return send(res, 400, { error: 'Enter the address like https://media.example.com or http://192.168.1.10:5080' });
        db.settings.publicUrl = v;
      }
      save(); audit(me.name, 'Changed sign-in options', ''); return send(res, 200, {});
    }
    if (p === '/api/signin/test' && m === 'POST') {
      const mc = mailer(); if (!mc) return send(res, 400, { error: 'Add an email alert channel first (Settings, then Alerts)' });
      if (!me.email) return send(res, 400, { error: 'Save your own email address first (Settings, then Account)' });
      await sendRecovery(mc, me.email, 'GoatMediaStackarr test email', 'Password recovery emails will arrive like this one.'); return send(res, 200, {});
    }
    if (p === '/api/statuslinks' && m === 'GET') return send(res, 200, db.statusLinks.map(x => ({ id: x.id, name: x.name, scopes: x.scopes, note: x.note || '', look: x.look || 'auto', at: x.at, used: x.used || 0, lastUsed: x.lastUsed || 0 })));
    if (p === '/api/statuslinks/preview' && m === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams, sc = Object.fromEntries(SCOPES.map(k => [k, q.get(k) === '1']));
      return send(res, 200, await statusData({ name: cut(q.get('name'), 60).trim() || 'Status page', note: cut(q.get('note'), 160).trim(), look: LOOKS.includes(q.get('look')) ? q.get('look') : 'auto', scopes: sc }));
    }
    if (p === '/api/statuslinks' && m === 'POST') {
      const b = await readBody(req), token = crypto.randomBytes(24).toString('base64url');
      const x = { id: uid(), name: cut(b.name, 60).trim() || 'Status page', note: cut(b.note, 160).trim(), look: LOOKS.includes(b.look) ? b.look : 'auto', hash: th(token), at: Date.now(), used: 0, scopes: linkScopes(b) };
      db.statusLinks.push(x); save(); audit(me.name, 'Created a status link', x.name); return send(res, 200, { id: x.id, token });
    }
    if ((r = p.match(/^\/api\/statuslinks\/(\w+)$/)) && m === 'PUT') {
      const x = db.statusLinks.find(l => l.id === r[1]); if (!x) return send(res, 404, { error: 'Not found' });
      const b = await readBody(req);
      if (b.name != null) x.name = cut(b.name, 60).trim() || x.name;
      if (b.note != null) x.note = cut(b.note, 160).trim();
      if (LOOKS.includes(b.look)) x.look = b.look;
      if (b.scopes && typeof b.scopes === 'object') x.scopes = linkScopes(b.scopes);
      delete pubCache[x.hash]; save(); audit(me.name, 'Changed a status link', x.name);
      return send(res, 200, { id: x.id, name: x.name, scopes: x.scopes, note: x.note || '', look: x.look || 'auto' });
    }
    if ((r = p.match(/^\/api\/statuslinks\/(\w+)\/regenerate$/)) && m === 'POST') {
      const x = db.statusLinks.find(l => l.id === r[1]); if (!x) return send(res, 404, { error: 'Not found' });
      const token = crypto.randomBytes(24).toString('base64url'); delete pubCache[x.hash]; x.hash = th(token); x.used = 0; x.lastUsed = 0;
      save(); audit(me.name, 'Made a new address for a status link', x.name); return send(res, 200, { id: x.id, token });
    }
    if ((r = p.match(/^\/api\/statuslinks\/(\w+)$/)) && m === 'DELETE') {
      const x = db.statusLinks.find(l => l.id === r[1]); if (!x) return send(res, 404, { error: 'Not found' });
      db.statusLinks = db.statusLinks.filter(l => l !== x); delete pubCache[x.hash]; save(); audit(me.name, 'Removed a status link', x.name); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/users\/(\w+)\/2fa\/reset$/)) && m === 'POST') {
      const u = userOf(r[1]); if (!u) return send(res, 404, { error: 'Not found' });
      u.totp = undefined; save(); audit(me.name, 'Turned off two-step sign-in for', u.name); return send(res, 200, {});
    }
    if (p === '/api/backups' && m === 'GET') {
      const files = fs.existsSync(BK) ? fs.readdirSync(BK).filter(f => BKRE.test(f)).sort().reverse().map(f => { const st = fs.statSync(path.join(BK, f)); return { name: f, size: st.size, at: st.mtimeMs }; }) : [];
      return send(res, 200, { cfg: { on: !!db.settings.backup?.on, keep: db.settings.backup?.keep || 7, hour: db.settings.backup?.hour ?? 3 }, files });
    }
    if (p === '/api/backups/config' && m === 'PUT') {
      const b = await readBody(req); db.settings.backup = { ...(db.settings.backup || {}), on: !!b.on, keep: Math.min(60, Math.max(1, Math.round(+b.keep) || 7)), hour: Math.min(23, Math.max(0, Math.round(+b.hour) || 0)) };
      save(); audit(me.name, 'Changed automatic backups', db.settings.backup.on ? 'on' : 'off'); return send(res, 200, {});
    }
    if (p === '/api/backups/run' && m === 'POST') { const f = backupNow(); audit(me.name, 'Made a backup copy', f); return send(res, 200, { name: f }); }
    if (p === '/api/backups/restore' && m === 'POST') {
      const b = await readBody(req); if (!BKRE.test(String(b.name || ''))) return send(res, 400, { error: 'Bad file name' });
      let obj; try { obj = JSON.parse(fs.readFileSync(path.join(BK, b.name), 'utf8')); } catch { return send(res, 404, { error: 'That copy could not be read' }); }
      if (!obj || !Array.isArray(obj.users) || !obj.users.some(u => u.role === 'admin') || !Array.isArray(obj.services)) return send(res, 400, { error: 'That copy looks incomplete' });
      backupNow('pre-restore');
      db = decryptAll(defaults(obj)); histKeys.clear(); db.history.forEach(h => histKeys.add(h.hash + ':' + Math.round(h.at / 1000)));
      sessions.clear(); saveSess(); save(); audit('System', 'Restored a backup copy', b.name + ' (started by ' + me.name + ')'); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/backups\/([\w.-]+)$/)) && m === 'DELETE') {
      if (!BKRE.test(r[1])) return send(res, 400, { error: 'Bad file name' });
      try { fs.unlinkSync(path.join(BK, r[1])); } catch {} return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/library\/(\w+)\/(\d+)$/)) && m === 'DELETE') {
      const s = arr(db.services.find(x => x.id === r[1])); if (!s) return send(res, 404, { error: 'Not found' });
      const files = new URL(req.url, 'http://x').searchParams.get('files') === '1';
      await call(s, `/api/v3/${s.type === 'sonarr' ? 'series' : 'movie'}/${r[2]}?deleteFiles=${files}`, { method: 'DELETE' }); audit(me.name, 'Removed from library', s.name + ' item ' + r[2] + (files ? ' with files' : ''));
      return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/unraid\/(\w+)\/logs$/))) {
      const s = svcOf(r[1], 'unraid'), id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      if (!s || !/^[\w:.\-]+$/.test(id)) return send(res, 400, { error: 'Bad request' });
      // The log query differs between Unraid versions, so try the richer one first and fall back; say plainly if none work.
      let lines = null, why = '';
      for (const q of [`{ docker { logs(id: ${JSON.stringify(id)}, tail: 300) { lines { timestamp message } } } }`, `{ docker { logs(id: ${JSON.stringify(id)}, tail: 300) { lines { message } } } }`, `{ docker { logs(id: ${JSON.stringify(id)}) { lines { message } } } }`]) {
        try { const d = await gql(s, q), l = (((d.docker || {}).logs || {}).lines); if (Array.isArray(l)) { lines = l; break; } } catch (e) { why = e.message; }
      }
      if (!lines) return send(res, 502, { error: 'Unraid would not give the log' + (why ? ': ' + cut(why, 200) : '. This Unraid version may not offer container logs through its API.') });
      const text = lines.map(l => (l.timestamp ? String(l.timestamp).replace('T', ' ').replace(/\.\d+Z?$/, '') + '  ' : '') + String(l.message == null ? '' : l.message).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).join('\n');
      return send(res, 200, { text, empty: !text.trim() });
    }
    if (p === '/api/audit' && m === 'GET') return send(res, 200, db.log.slice(-200).reverse());
    if (p === '/api/services/test' && m === 'POST') {
      const b = await readBody(req), o = db.services.find(x => x.id === b.id) || {};
      const s = { ...o, type: b.type || o.type, url: String(b.url || o.url || '').trim(), apiKey: b.apiKey || o.apiKey || '', user: b.user != null ? b.user : o.user, pass: b.pass || o.pass || '' };
      if (!KINDS.includes(s.type) || !/^https?:\/\//.test(s.url)) return send(res, 400, { error: 'Enter an address starting with http:// or https://' });
      try { const ok = await test(s); return send(res, 200, { ok, message: ok ? 'Connected' : 'It answered, but the key or password was refused, or the address is a different app.' }); }
      catch (e) { return send(res, 200, { ok: false, message: 'Could not reach it (' + ((e.cause && e.cause.code) || e.message) + '). Check the address and port.' }); }
    }
    if ((r = p.match(/^\/api\/services\/(\w+)$/)) && m === 'PUT') {
      const s = db.services.find(x => x.id === r[1]), b = await readBody(req); if (!s) return send(res, 404, { error: 'Not found' });
      if (b.url != null) { if (!/^https?:\/\//.test(b.url)) return send(res, 400, { error: 'The address must start with http:// or https://' }); s.url = b.url.trim(); }
      if (b.name) s.name = cut(b.name, 80); if (b.apiKey) s.apiKey = b.apiKey; if (b.user != null) s.user = cut(b.user, 120); if (b.pass) s.pass = b.pass;
      delete qbCookie[s.id]; save(); audit(me.name, 'Edited an app', s.name); return send(res, 200, pubSvc(s));
    }
    if ((r = p.match(/^\/api\/users\/(\w+)$/)) && m === 'PUT') {
      const u = userOf(r[1]), b = await readBody(req); if (!u) return send(res, 404, { error: 'Not found' });
      if (b.role && ['admin', 'user'].includes(b.role) && b.role !== u.role) {
        if (u.role === 'admin' && db.users.filter(x => x.role === 'admin').length < 2) return send(res, 400, { error: 'There must be at least one admin' });
        u.role = b.role;
      }
      if ('hide' in b) u.hide = cleanHide(b.hide);
      if ('perms' in b) u.perms = b.perms ? Object.fromEntries(['add', 'control', 'remove', 'request'].map(k => [k, b.perms[k] !== false])) : undefined;
      if ('reqLimit' in b) { const n = Math.round(+(b.reqLimit || {}).n), d = Math.round(+(b.reqLimit || {}).days); u.reqLimit = n > 0 ? { n: Math.min(n, 1000), days: Math.min(Math.max(d || 7, 1), 365) } : undefined; }
      if ('autoApprove' in b) u.autoApprove = !!b.autoApprove;
      if ('dataLimit' in b) { const gb = Math.round(+b.dataLimit || 0); u.dataLimit = gb > 0 ? Math.min(gb, 1e6) : undefined; }
      if ('streamLimit' in b) { u.streamLimit = b.streamLimit == null || b.streamLimit === '' ? undefined : limitGb(b.streamLimit); const e = streamOf(u); if (e) { delete e.warn; delete e.stopErr; } }
      if ('plexName' in b) { const v = cut(b.plexName, 60).trim(); if (v && u.role === 'admin') return send(res, 400, { error: 'Admins sign in with their GoatMediaStackarr password.' }); u.plexName = v || undefined; if (!v) delete u.plex; }
      if ('notify' in b) { const v = String(b.notify || '').trim(); if (v && !/^https?:\/\//i.test(v)) return send(res, 400, { error: 'Enter a web address starting with https://' }); u.notify = v.slice(0, 500); }
      save(); audit(me.name, 'Changed a profile', u.name); return send(res, 200, pubUser(u));
    }
    if (p === '/api/backup' && m === 'POST') {
      const b = await readBody(req); if (String(b.passphrase || '').length < 8) return send(res, 400, { error: 'Choose a passphrase of 8 or more characters' });
      const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(String(b.passphrase), salt, 32), iv);
      const ct = Buffer.concat([c.update(JSON.stringify({ v: 1, at: Date.now(), db }), 'utf8'), c.final()]);
      audit(me.name, 'Exported a backup', '');
      return send(res, 200, { v: 1, app: 'mediahub', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: ct.toString('base64') });
    }
    if (p === '/api/restore' && m === 'POST') {
      const b = await readBody(req), k = b.backup || {}; let obj;
      try { const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(String(b.passphrase || ''), Buffer.from(k.salt, 'base64'), 32), Buffer.from(k.iv, 'base64'));
        d.setAuthTag(Buffer.from(k.tag, 'base64')); obj = JSON.parse(Buffer.concat([d.update(Buffer.from(k.data, 'base64')), d.final()]).toString('utf8')); }
      catch { return send(res, 400, { error: 'Wrong passphrase, or this is not a GoatMediaStackarr backup' }); }
      const n = obj && obj.db;
      if (!n || !Array.isArray(n.users) || !n.users.some(u => u.role === 'admin') || !Array.isArray(n.services)) return send(res, 400, { error: 'That backup looks incomplete' });
      db = defaults({ alerts: null, ...n });
      histKeys.clear(); db.history.forEach(h => histKeys.add(h.hash + ':' + Math.round(h.at / 1000)));
      sessions.clear(); saveSess(); save(); audit('System', 'Restored a backup', 'started by ' + me.name);
      return send(res, 200, {});
    }
    if (p === '/api/seedrules' && m === 'GET') return send(res, 200, db.seedRules);
    if (p === '/api/seedrules' && m === 'PUT') {
      const b = await readBody(req), ok = x => db.services.some(s => s.id === x.sid && s.type === 'qbittorrent');
      db.seedRules = (Array.isArray(b.rules) ? b.rules : []).filter(ok).slice(0, 50).map(x => ({ sid: x.sid, category: cut(x.category === '' ? '' : x.category || '*', 100), ratio: Math.max(0, +x.ratio || 0), minutes: Math.max(0, Math.round(+x.minutes || 0)) }));
      mon.share = {}; save(); audit(me.name, 'Changed seeding rules', db.seedRules.length + ' rules'); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/qb\/(\w+)\/schedule$/)) && m === 'POST') {
      const b = await readBody(req), s = svcOf(r[1], 'qbittorrent'); if (!s) return send(res, 404, { error: 'Not found' });
      const hm = v => { const q = /^(\d{1,2}):(\d{2})$/.exec(String(v)); return q && +q[1] < 24 && +q[2] < 60 ? [+q[1], +q[2]] : [0, 0]; }, f = hm(b.from), to = hm(b.to);
      await qb(s, '/api/v2/app/setPreferences', { json: JSON.stringify({ scheduler_enabled: !!b.on, schedule_from_hour: f[0], schedule_from_min: f[1], schedule_to_hour: to[0], schedule_to_min: to[1],
        scheduler_days: Math.min(9, Math.max(0, +b.days || 0)), max_ratio_act: [0, 1, 2, 3].includes(+b.action) ? +b.action : 0 }) });
      audit(me.name, 'Changed the speed schedule', s.name); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/unraid\/(\w+)\/parity$/)) && m === 'POST') {
      const s = svcOf(r[1], 'unraid'), b = await readBody(req), ops = { start: 'start(correct: false)', cancel: 'cancel', pause: 'pause', resume: 'resume' };
      if (!s || !ops[b.op]) return send(res, 400, { error: 'Bad request' });
      await gql(s, `mutation { parityCheck { ${ops[b.op]} } }`); audit(me.name, 'Parity check: ' + b.op, s.name); return send(res, 200, {});
    }
    if ((r = p.match(/^\/api\/plex\/(\w+)\/terminate$/)) && m === 'POST') {
      const s = svcOf(r[1], 'plex'), b = await readBody(req); if (!s || !/^[\w-]{1,80}$/.test(b.session || '')) return send(res, 400, { error: 'Bad request' });
      await plex(s, `/status/sessions/terminate?sessionId=${encodeURIComponent(b.session)}&reason=${encodeURIComponent(cut(b.reason || 'Stopped by the server owner', 200))}`);
      audit(me.name, 'Ended a Plex stream', s.name); return send(res, 200, {});
    }
    if (p === '/api/users' && m === 'GET') return send(res, 200, db.users.map(pubUser));
    // Streaming this month for everyone (profiles and media-server accounts that match no profile), and the defaults.
    if (p === '/api/streaming' && m === 'GET') {
      const cfg = streamCfg(), mk = new URL(req.url, 'http://x').searchParams.get('month') || monthKey(), month = (db.streamUse || {})[mk] || {};
      const rows = Object.entries(month).map(([k, e]) => { const u = k.startsWith('@') ? null : userOf(k); return { id: u ? u.id : '', name: u ? u.name : e.n, profile: !!u, bytes: streamUsed(e, cfg), all: e.b, wan: e.w, limitGb: u ? streamLimitOf(u) : 0 }; });
      for (const u of db.users) if (!month[u.id]) rows.push({ id: u.id, name: u.name, profile: true, bytes: 0, all: 0, wan: 0, limitGb: streamLimitOf(u) });
      return send(res, 200, { month: mk, months: Object.keys(db.streamUse || {}).sort(), ...cfg, resets: nextMonth(), users: rows.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)) });
    }
    if (p === '/api/streaming' && m === 'PUT') {
      const b = await readBody(req), c = { ...streamCfg() };
      if ('defaultGb' in b) c.defaultGb = limitGb(b.defaultGb);
      if ('wanOnly' in b) c.wanOnly = !!b.wanOnly;
      db.settings.stream = c; for (const e of Object.values((db.streamUse || {})[monthKey()] || {})) { delete e.warn; delete e.stopErr; }
      save(); audit(me.name, 'Changed streaming limits', `${c.defaultGb ? c.defaultGb + ' GB a month' : 'no limit'}${c.wanOnly ? ', outside the home only' : ''}`); return send(res, 200, c);
    }
    if ((r = p.match(/^\/api\/users\/(\w+)\/usage$/)) && m === 'GET') { const u = userOf(r[1]); if (!u) return send(res, 404, { error: 'Not found' }); return send(res, 200, await usageOf(u)); }
    if (p === '/api/users' && m === 'POST') {
      const b = await readBody(req);
      if (!b.name || (b.password || '').length < 8) return send(res, 400, { error: 'Enter a name and a password of 8+ characters' });
      if (db.users.some(u => u.name.toLowerCase() === b.name.toLowerCase())) return send(res, 400, { error: 'That name is taken' });
      const u = mkUser(b.name, b.password, b.role === 'admin' ? 'admin' : 'user'); if (b.email && require('./lib/smtp').ADDR.test(String(b.email).trim())) u.email = cut(b.email, 120).trim(); db.users.push(u); save(); audit(me.name, 'Added a profile', u.name); return send(res, 200, pubUser(u));
    }
    if ((r = p.match(/^\/api\/users\/(\w+)\/access$/)) && m === 'PUT') {
      const u = db.users.find(x => x.id === r[1]); if (!u) return send(res, 404, { error: 'Not found' });
      u.access = ((await readBody(req)).access || []).filter(a => db.services.some(s => s.id === a)); save(); return send(res, 200, pubUser(u));
    }
    if ((r = p.match(/^\/api\/users\/(\w+)$/)) && m === 'DELETE') {
      if (r[1] === me.id) return send(res, 400, { error: "You can't delete yourself" });
      const gone = userOf(r[1]); db.users = db.users.filter(u => u.id !== r[1]); for (const [k, v] of [...sessions]) if (v.uid === r[1]) sessions.delete(k);
      if (gone) try { fs.unlinkSync(avFile(gone)); } catch {}
      saveSess(); save(); if (gone) audit(me.name, 'Deleted a profile', gone.name); return send(res, 200, {});
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { if (e && e.plain) return send(res, 502, { error: e.message }); console.error(req.method, p, e); send(res, 500, { error: 'Server error: ' + e.message }); }
}).listen(PORT, () => console.log('GoatMediaStackarr running' + (DEMO ? ' in demo mode' : '') + ' on port ' + PORT));
// Live updates in the engines' own pages (Sonarr and Radarr use WebSockets) go through the same sign-in check.
goatServer.on('upgrade', (req, sock, head) => {
  const t = goatTarget(req.url);
  if (!t || !goatAdmin(req)) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const up = require('net').connect(t.port, '127.0.0.1', () => {
    const h = goatHeaders(req, t);
    up.write(`${req.method} ${t.path} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  const done = () => { up.destroy(); sock.destroy(); };
  up.on('error', done); sock.on('error', done);
});
const MON_MS = Math.max(500, +process.env.MONITOR_MS || 30000), REQ_MS = process.env.REQ_REFRESH_MS != null ? +process.env.REQ_REFRESH_MS : 15000;
setInterval(() => monitor().catch(() => {}), MON_MS);
setInterval(() => { for (const k in fails) if (Date.now() - fails[k].t > 600000) delete fails[k]; }, 600000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log('GoatMediaStackarr stopping'); process.exit(0); });
setTimeout(() => monitor().catch(() => {}), Math.min(3000, MON_MS));
setTimeout(() => wpSync(), +process.env.WP_DELAY_MS || 20000).unref();
setInterval(() => wpSync(), 6 * 3600e3).unref();
setInterval(() => { if (!DEMO && wpMode() === 'library' && db.services.some(x => ['sonarr', 'radarr'].includes(x.type)) && !wpList().some(f => LIBWP.test(f)) && Date.now() - wpState.at > 12e4) wpSync(); }, 6e4).unref();   // until the first pictures are saved, try again every couple of minutes
