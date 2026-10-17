#!/usr/bin/env node
'use strict';
// Connects the engines to each other once they are running. Safe to run at every start:
// each step first checks whether its connection already exists and skips it if so.
//
//   Sonarr / Radarr / Lidarr  -> library folders, qBittorrent and SABnzbd as download clients
//   Prowlarr                  -> pushes indexers to Sonarr, Radarr and Lidarr; knows qBittorrent
//   Jellyfin                  -> first-run setup, admin user, Movies / TV / Music libraries, API key
//   Seerr                     -> signs in through Jellyfin, picks libraries, connects Sonarr and Radarr
//
// Results go to /config/goat/wired.json so the UI can show what is connected.

const fs = require('fs');
const E = require('./engines');

const C = E.CONFIG;
const log = (...a) => console.log('[goat-wire]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };

async function http(method, url, { headers = {}, body, timeout = 20000 } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) { opts.body = typeof body === 'string' ? body : JSON.stringify(body); opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json'; }
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = text; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) { const e = new Error(`${method} ${url.replace(/apikey=[^&]+/i, 'apikey=…')} -> ${r.status} ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300)}`); e.status = r.status; throw e; }
  return { data, headers: r.headers };
}

async function waitFor(name, check, minutes = 10) {
  const until = Date.now() + minutes * 60000;
  let last;
  while (Date.now() < until) {
    try { return await check(); } catch (e) { last = e; }
    await sleep(3000);
  }
  throw new Error(`${name} did not come up in ${minutes} minutes: ${last && last.message}`);
}

// ---------- Sonarr / Radarr / Lidarr / Prowlarr ----------
function arr(key, apiKey) {
  const base = E.url(key);
  let ver = E.ENGINES[key].api;
  const h = { 'X-Api-Key': apiKey };
  const api = {
    async ready() {
      const { data } = await http('GET', `${base}/api`, { headers: h });
      if (data && data.current) ver = data.current;
      await http('GET', `${base}/api/${ver}/system/status`, { headers: h });
      return api;
    },
    get: p => http('GET', `${base}/api/${ver}/${p}`, { headers: h }).then(r => r.data),
    post: (p, b) => http('POST', `${base}/api/${ver}/${p}`, { headers: h, body: b }).then(r => r.data),
    get ver() { return ver; },
  };
  return api;
}

// Creates a download client / application from the engine's own template, so field names always match its version.
async function addFromSchema(api, resource, impl, name, values, extra = {}) {
  const have = await api.get(resource);
  if (have.some(x => x.name === name || (x.implementation === impl && resource === 'downloadclient'))) return 'already there';
  const schema = await api.get(`${resource}/schema`);
  const t = schema.find(x => x.implementation === impl);
  if (!t) throw new Error(`${impl} is not offered by this version`);
  t.name = name; t.enable = true;
  for (const f of t.fields || []) {
    for (const [k, v] of Object.entries(values)) {
      if (k instanceof RegExp ? k.test(f.name) : (k.startsWith('/') ? new RegExp(k.slice(1, -1)).test(f.name) : f.name === k)) f.value = v;
    }
  }
  Object.assign(t, extra);
  delete t.id;
  await api.post(`${resource}?forceSave=true`, t);
  return 'added';
}

const qbitValues = (s, cat) => ({ host: '127.0.0.1', port: E.ENGINES.qbittorrent.port, useSsl: false, urlBase: '', username: s.qbitUser, password: s.qbitPass, '/^(tv|movie|music)Category$/': cat, category: cat });
const sabValues = (s, cat) => ({ host: '127.0.0.1', port: E.ENGINES.sabnzbd.port, useSsl: false, urlBase: E.ENGINES.sabnzbd.base, apiKey: s.sabnzbd, '/^(tv|movie|music)Category$/': cat, category: cat });

async function wireArr(key, keys, s, on, folder, cat) {
  const api = await waitFor(E.ENGINES[key].name, () => arr(key, keys[key]).ready());
  const out = {};
  const roots = await api.get('rootfolder');
  if (roots.some(r => r.path.replace(/\/+$/, '') === folder)) out.folder = 'already there';
  else if (key === 'lidarr') {
    const [qp] = await api.get('qualityprofile'); const [mp] = await api.get('metadataprofile');
    await api.post('rootfolder', { name: 'Music', path: folder, defaultQualityProfileId: qp && qp.id, defaultMetadataProfileId: mp && mp.id, defaultMonitorOption: 'all', defaultNewItemMonitorOption: 'all', defaultTags: [] });
    out.folder = 'added';
  } else { await api.post('rootfolder', { path: folder }); out.folder = 'added'; }
  if (on.includes('qbittorrent')) out.qbittorrent = await addFromSchema(api, 'downloadclient', 'QBittorrent', 'qBittorrent', qbitValues(s, cat), { protocol: 'torrent', priority: 1 });
  if (on.includes('sabnzbd')) out.sabnzbd = await addFromSchema(api, 'downloadclient', 'Sabnzbd', 'SABnzbd', sabValues(s, cat), { protocol: 'usenet', priority: 1 });
  return out;
}

async function wireProwlarr(keys, s, on) {
  const api = await waitFor('Prowlarr', () => arr('prowlarr', keys.prowlarr).ready());
  const out = {};
  for (const k of ['sonarr', 'radarr', 'lidarr'].filter(x => on.includes(x))) {
    out[k] = await addFromSchema(api, 'applications', E.ENGINES[k].name, E.ENGINES[k].name,
      { prowlarrUrl: E.url('prowlarr'), baseUrl: E.url(k), apiKey: keys[k] }, { syncLevel: 'fullSync' });
  }
  if (on.includes('qbittorrent')) out.qbittorrent = await addFromSchema(api, 'downloadclient', 'QBittorrent', 'qBittorrent', qbitValues(s, 'prowlarr'), { protocol: 'torrent', priority: 1 });
  return out;
}

// ---------- Jellyfin ----------
const JF = E.url('jellyfin');
const jfAuth = token => `MediaBrowser Client="GoatMediaStackarr", Device="Container", DeviceId="goat-wire", Version="1.0"${token ? `, Token="${token}"` : ''}`;

async function wireJellyfin(s, on) {
  const info = await waitFor('Jellyfin', async () => (await http('GET', `${JF}/System/Info/Public`)).data);
  const out = {};
  const h = { Authorization: jfAuth() };
  if (!info.StartupWizardCompleted) {
    await http('POST', `${JF}/Startup/Configuration`, { headers: h, body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' } });
    await http('GET', `${JF}/Startup/User`, { headers: h });
    await http('POST', `${JF}/Startup/User`, { headers: h, body: { Name: s.jellyfinUser, Password: s.jellyfinPass } });
    await http('POST', `${JF}/Startup/RemoteAccess`, { headers: h, body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false } });
    await http('POST', `${JF}/Startup/Complete`, { headers: h });
    out.setup = 'done';
  } else out.setup = 'already done';
  const login = await waitFor('Jellyfin sign-in', async () => (await http('POST', `${JF}/Users/AuthenticateByName`, { headers: h, body: { Username: s.jellyfinUser, Pw: s.jellyfinPass } })).data, 2);
  const th = { Authorization: jfAuth(login.AccessToken) };

  const libs = (await http('GET', `${JF}/Library/VirtualFolders`, { headers: th })).data || [];
  const want = [['Movies', 'movies', E.DIRS.movies, 'radarr'], ['TV Shows', 'tvshows', E.DIRS.tv, 'sonarr'], ['Music', 'music', E.DIRS.music, 'lidarr']];
  for (const [name, type, dir, needs] of want) {
    if (!on.includes(needs)) continue;
    if (libs.some(l => (l.Locations || []).includes(dir) || l.Name === name)) { out[name] = 'already there'; continue; }
    const q = new URLSearchParams({ name, collectionType: type, refreshLibrary: 'false', paths: dir });
    await http('POST', `${JF}/Library/VirtualFolders?${q}`, { headers: th, body: { LibraryOptions: {} } });
    out[name] = 'added';
  }

  let keys = (await http('GET', `${JF}/Auth/Keys`, { headers: th })).data;
  let k = (keys.Items || []).find(x => x.AppName === 'GoatMediaStackarr');
  if (!k) {
    await http('POST', `${JF}/Auth/Keys?app=GoatMediaStackarr`, { headers: th });
    keys = (await http('GET', `${JF}/Auth/Keys`, { headers: th })).data;
    k = (keys.Items || []).find(x => x.AppName === 'GoatMediaStackarr');
  }
  out.apiKey = k ? 'ready' : 'missing';
  return { out, apiKey: k && k.AccessToken };
}

// ---------- Seerr ----------
const SEERR = E.url('seerr');

async function wireSeerr(s, keys, on) {
  const pub = await waitFor('Seerr', async () => (await http('GET', `${SEERR}/api/v1/settings/public`)).data);
  const out = {};
  const settingsFile = `${C}/seerr/settings.json`;
  if (!pub.initialized) {
    if (!on.includes('jellyfin')) throw new Error('Seerr setup needs Jellyfin turned on');
    const r = await http('POST', `${SEERR}/api/v1/auth/jellyfin`, { body: {
      username: s.jellyfinUser, password: s.jellyfinPass, hostname: '127.0.0.1', port: E.ENGINES.jellyfin.port,
      useSsl: false, urlBase: '', email: 'admin@goatmediastackarr.local', serverType: 2 } });
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    const ch = { Cookie: cookie };
    const libs = (await http('GET', `${SEERR}/api/v1/settings/jellyfin/library?sync=true`, { headers: ch })).data || [];
    if (libs.length) await http('GET', `${SEERR}/api/v1/settings/jellyfin/library?enable=${libs.map(l => l.id).join(',')}`, { headers: ch });
    for (const [k, dir, extra] of [
      ['sonarr', E.DIRS.tv, { seriesType: 'standard', animeSeriesType: 'anime', enableSeasonFolders: true, monitorNewItems: 'all' }],
      ['radarr', E.DIRS.movies, { minimumAvailability: 'released' }]]) {
      if (!on.includes(k)) continue;
      const api = arr(k, keys[k]); await api.ready();
      const [p] = await api.get('qualityprofile');
      await http('POST', `${SEERR}/api/v1/settings/${k}`, { headers: ch, body: {
        name: E.ENGINES[k].name, hostname: '127.0.0.1', port: E.ENGINES[k].port, apiKey: keys[k], useSsl: false,
        baseUrl: E.ENGINES[k].base, activeProfileId: p.id, activeProfileName: p.name, activeDirectory: dir,
        tags: [], is4k: false, isDefault: true, syncEnabled: true, preventSearch: false, tagRequests: false, overrideRule: [], ...extra } });
      out[k] = 'connected';
    }
    await http('POST', `${SEERR}/api/v1/settings/initialize`, { headers: ch });
    out.setup = 'done';
  } else out.setup = 'already done';
  const apiKey = (readJSON(settingsFile).main || {}).apiKey || '';
  return { out, apiKey };
}

// ---------- main ----------
async function run() {
  const s = readJSON(`${C}/goat/secrets.json`);
  const mf = `${C}/goat/managed.json`;
  const on = E.enabled();
  const keys = {};
  for (const x of readJSON(mf).services || []) if (x.apiKey) keys[x.key] = x.apiKey;
  const state = { at: Date.now(), steps: {} };
  const step = async (name, fn) => {
    try { state.steps[name] = { ok: true, result: await fn() }; log(`${name}: ok`, JSON.stringify(state.steps[name].result)); }
    catch (e) { state.steps[name] = { ok: false, error: e.message }; log(`${name}: FAILED - ${e.message}`); }
    writeJSON(`${C}/goat/wired.json`, state);
  };
  const setKey = (k, v) => {
    if (!v) return;
    const m = readJSON(mf, { services: [] });
    const x = (m.services || []).find(y => y.key === k);
    if (x && x.apiKey !== v) { x.apiKey = v; writeJSON(mf, m); }
  };

  if (on.includes('sonarr')) await step('sonarr', () => wireArr('sonarr', keys, s, on, E.DIRS.tv, 'tv'));
  if (on.includes('radarr')) await step('radarr', () => wireArr('radarr', keys, s, on, E.DIRS.movies, 'movies'));
  if (on.includes('lidarr')) await step('lidarr', () => wireArr('lidarr', keys, s, on, E.DIRS.music, 'music'));
  if (on.includes('prowlarr')) await step('prowlarr', () => wireProwlarr(keys, s, on));
  if (on.includes('jellyfin')) await step('jellyfin', async () => { const r = await wireJellyfin(s, on); setKey('jellyfin', r.apiKey); return r.out; });
  if (on.includes('seerr')) await step('seerr', async () => { const r = await wireSeerr(s, keys, on); setKey('seerr', r.apiKey); return r.out; });
  const bad = Object.entries(state.steps).filter(([, v]) => !v.ok).map(([k]) => k);
  log(bad.length ? `finished with problems in: ${bad.join(', ')}. These are retried at the next container start.` : 'all engines connected.');
  return state;
}

if (require.main === module) run().catch(e => { log('stopped:', e && e.stack || e); process.exitCode = 1; });

module.exports = { run, addFromSchema, arr, http };
