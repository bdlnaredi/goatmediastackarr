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
const { plexPrefs } = require('./init');

const C = E.CONFIG;
const log = (...a) => console.log('[goat-wire]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };

// `retries` covers dropped connections only (an engine restarting), never HTTP error answers.
async function http(method, url, { headers = {}, body, timeout = 20000, retries = 0 } = {}) {
  for (let i = 0; ; i++) {
    try { return await once(method, url, { headers, body, timeout }); }
    catch (e) { if (e.status || i >= retries) throw e; await sleep(3000); }
  }
}

async function once(method, url, { headers, body, timeout }) {
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
// Jellyfin 10.11+ first serves a temporary "starting up" server, then swaps to the real one and briefly drops
// connections, so every Jellyfin call rides through up to a minute of that.
const jf = (method, path, opts = {}) => http(method, `${JF}${path}`, { retries: 20, ...opts });
const jfAuth = token => `MediaBrowser Client="GoatMediaStackarr", Device="Container", DeviceId="goat-wire", Version="1.0"${token ? `, Token="${token}"` : ''}`;

async function wireJellyfin(s, on) {
  const info = await waitFor('Jellyfin', async () => {
    const d = (await http('GET', `${JF}/System/Info/Public`)).data;
    if (!d || !d.Version || !('StartupWizardCompleted' in d)) throw new Error('Jellyfin is still starting');
    return d;
  });
  const out = {};
  const h = { Authorization: jfAuth() };
  if (!info.StartupWizardCompleted) {
    await jf('POST', `/Startup/Configuration`, { headers: h, body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' } });
    await jf('GET', `/Startup/User`, { headers: h });
    await jf('POST', `/Startup/User`, { headers: h, body: { Name: s.jellyfinUser, Password: s.jellyfinPass } });
    await jf('POST', `/Startup/RemoteAccess`, { headers: h, body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false } });
    await jf('POST', `/Startup/Complete`, { headers: h });
    out.setup = 'done';
  } else out.setup = 'already done';
  const login = await waitFor('Jellyfin sign-in', async () => (await jf('POST', `/Users/AuthenticateByName`, { headers: h, body: { Username: s.jellyfinUser, Pw: s.jellyfinPass } })).data, 2);
  const th = { Authorization: jfAuth(login.AccessToken) };

  const libs = (await jf('GET', `/Library/VirtualFolders`, { headers: th })).data || [];
  const want = [['Movies', 'movies', E.DIRS.movies, 'radarr'], ['TV Shows', 'tvshows', E.DIRS.tv, 'sonarr'], ['Music', 'music', E.DIRS.music, 'lidarr']];
  for (const [name, type, dir, needs] of want) {
    if (!on.includes(needs)) continue;
    if (libs.some(l => (l.Locations || []).includes(dir) || l.Name === name)) { out[name] = 'already there'; continue; }
    const q = new URLSearchParams({ name, collectionType: type, refreshLibrary: 'false', paths: dir });
    await jf('POST', `/Library/VirtualFolders?${q}`, { headers: th, body: { LibraryOptions: {} } });
    out[name] = 'added';
  }

  let keys = (await jf('GET', `/Auth/Keys`, { headers: th })).data;
  let k = (keys.Items || []).find(x => x.AppName === 'GoatMediaStackarr');
  if (!k) {
    await jf('POST', `/Auth/Keys?app=GoatMediaStackarr`, { headers: th });
    keys = (await jf('GET', `/Auth/Keys`, { headers: th })).data;
    k = (keys.Items || []).find(x => x.AppName === 'GoatMediaStackarr');
  }
  out.apiKey = k ? 'ready' : 'missing';
  return { out, apiKey: k && k.AccessToken };
}

// ---------- FlareSolverr (optional) ----------
// Added to Prowlarr as its FlareSolverr proxy, linked to a "flaresolverr" tag: indexers given that tag are fetched
// through it, which gets them past Cloudflare's "checking your browser" page.
async function wireFlareSolverr(keys) {
  const FS = E.url('flaresolverr');
  // The first start downloads FlareSolverr and its browser libraries, so allow plenty of time.
  await waitFor('FlareSolverr', async () => (await http('GET', `${FS}/`)).data, 15);
  const api = await waitFor('Prowlarr', () => arr('prowlarr', keys.prowlarr).ready());
  const tags = await api.get('tag');
  let tag = tags.find(t => t.label === 'flaresolverr');
  if (!tag) tag = await api.post('tag', { label: 'flaresolverr' });
  const out = { tag: tag.label };
  const have = await api.get('indexerproxy');
  if (have.some(x => x.implementation === 'FlareSolverr')) { out.proxy = 'already there'; return out; }
  const schema = await api.get('indexerproxy/schema');
  const t = schema.find(x => x.implementation === 'FlareSolverr');
  if (!t) throw new Error('this Prowlarr version offers no FlareSolverr proxy');
  t.name = 'FlareSolverr'; t.tags = [tag.id]; delete t.id;
  for (const f of t.fields || []) { if (f.name === 'host') f.value = `${FS}/`; if (f.name === 'requestTimeout') f.value = 60; }
  await api.post('indexerproxy?forceSave=true', t);
  out.proxy = 'added';
  return out;
}

// ---------- Plex (optional) ----------
const PLEX = E.url('plex');

async function wirePlex(on) {
  // The first start downloads Plex from plex.tv, so allow plenty of time.
  const ident = await waitFor('Plex', async () => (await http('GET', `${PLEX}/identity`, { headers: { Accept: 'application/json' } })).data, 15);
  const id = ident && ident.MediaContainer && ident.MediaContainer.machineIdentifier;
  if (!id) throw new Error('Plex answered without a server ID');
  const out = {};
  let p = plexPrefs();
  if (!p.token) {
    const claim = String(process.env.PLEX_CLAIM || '').trim();
    if (!claim) throw new Error('Plex is not linked to your Plex account yet: get a code from https://plex.tv/claim, put it in PLEX_CLAIM and restart within 4 minutes');
    await http('POST', `${PLEX}/myplex/claim?token=${encodeURIComponent(claim)}`, { headers: { 'X-Plex-Client-Identifier': id, Accept: 'application/json' } });
    p = await waitFor('Plex account link', async () => { const q = plexPrefs(); if (!q.token) throw new Error('not linked yet'); return q; }, 2);
    out.account = 'linked';
  } else out.account = 'already linked';
  const h = { 'X-Plex-Token': p.token, Accept: 'application/json' };
  const secs = ((await http('GET', `${PLEX}/library/sections`, { headers: h })).data.MediaContainer || {}).Directory || [];
  const want = [
    ['Movies', 'movie', 'tv.plex.agents.movie', 'Plex Movie', E.DIRS.movies, 'radarr'],
    ['TV Shows', 'show', 'tv.plex.agents.series', 'Plex TV Series', E.DIRS.tv, 'sonarr'],
    ['Music', 'artist', 'tv.plex.agents.music', 'Plex Music', E.DIRS.music, 'lidarr']];
  for (const [name, type, agent, scanner, dir, needs] of want) {
    if (!on.includes(needs)) continue;
    if (secs.some(d => (d.Location || []).some(l => l.path === dir) || d.title === name)) { out[name] = 'already there'; continue; }
    const q = new URLSearchParams({ name, type, agent, scanner, language: 'en-US', location: dir });
    await http('POST', `${PLEX}/library/sections?${q}`, { headers: h });
    out[name] = 'added';
  }
  return { out, token: p.token };
}

// ---------- Seerr ----------
const SEERR = E.url('seerr');

async function wireSeerr(s, keys, on) {
  const pub = await waitFor('Seerr', async () => (await http('GET', `${SEERR}/api/v1/settings/public`)).data);
  const out = {};
  const settingsFile = `${C}/seerr/settings.json`;
  if (!pub.initialized) {
    const server = E.seerrServer(process.env, on);
    if (!server) throw new Error('Seerr needs a media server: turn on Jellyfin or Plex in this container, or add your own Plex server under Settings, then Apps');
    // Plex outside this container (its own container, say): its address and token come from the interface.
    const ext = server === 'plex' && !on.includes('plex') ? E.externalPlex() : null;
    let r;
    if (server === 'plex') {
      const token = ext ? ext.token : plexPrefs().token;
      if (!token) throw new Error('Plex is not linked to a Plex account yet');
      r = await http('POST', `${SEERR}/api/v1/auth/plex`, { body: { authToken: token } });
    } else {
      const who = { username: s.jellyfinUser, password: s.jellyfinPass, email: 'admin@goatmediastackarr.local' };
      try {
        r = await http('POST', `${SEERR}/api/v1/auth/jellyfin`, { body: {
          ...who, hostname: '127.0.0.1', port: E.ENGINES.jellyfin.port, useSsl: false, urlBase: '', serverType: 2 } });
      } catch (e) {
        // A setup that stopped half way already saved Jellyfin's address; Seerr then wants a plain sign-in.
        if (!/already configured/i.test(e.message)) throw e;
        r = await http('POST', `${SEERR}/api/v1/auth/jellyfin`, { body: who });
      }
    }
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    const ch = { Cookie: cookie };
    if (server === 'plex') await http('POST', `${SEERR}/api/v1/settings/plex`, { headers: ch,
      body: ext ? { ip: ext.ip, port: ext.port, useSsl: ext.useSsl } : { ip: '127.0.0.1', port: E.ENGINES.plex.port, useSsl: false } });
    out.via = ext ? `your Plex at ${ext.url}` : server;
    // Seerr 3.5+: read the server's libraries with a sync call, then turn each one on.
    const libs = (await http('POST', `${SEERR}/api/v1/settings/${server}/library/sync`, { headers: ch })).data || [];
    for (const l of libs) {
      if (!l.enabled) await http('PUT', `${SEERR}/api/v1/settings/${server}/library/${encodeURIComponent(l.id)}`, { headers: ch, body: { enabled: true } });
    }
    out.libraries = libs.length;
    out.mediaServer = server;
    for (const k of ['sonarr', 'radarr']) if (on.includes(k)) { await seerrAddArr(k, keys, ch); out[k] = 'connected'; }
    await http('POST', `${SEERR}/api/v1/settings/initialize`, { headers: ch });
    out.setup = 'done';
  } else {
    out.setup = 'already done';
    // Every start: Seerr must still reach the built-in Sonarr and Radarr with their current API keys. A key that
    // changed since setup (a reset or a new key) otherwise breaks requests and the download tracker
    // ("Unable to get queue from Radarr server") without anything saying why.
    const own = (readJSON(settingsFile).main || {}).apiKey;
    if (own) {
      const ch = { 'X-Api-Key': own };
      for (const k of ['sonarr', 'radarr']) {
        if (!on.includes(k)) continue;
        const list = (await http('GET', `${SEERR}/api/v1/settings/${k}`, { headers: ch })).data || [];
        const mine = list.find(x => ['127.0.0.1', 'localhost'].includes(String(x.hostname)) && +x.port === E.ENGINES[k].port);
        if (!mine) { await seerrAddArr(k, keys, ch, !list.some(x => x.isDefault && !x.is4k)); out[k] = 'added again'; continue; }
        if (mine.apiKey === keys[k] && (mine.baseUrl || '') === E.ENGINES[k].base && !mine.useSsl) { out[k] = 'ok'; continue; }
        await http('PUT', `${SEERR}/api/v1/settings/${k}/${mine.id}`, { headers: ch, body: { ...mine, apiKey: keys[k], baseUrl: E.ENGINES[k].base, useSsl: false } });
        out[k] = 'updated';
      }
    }
  }
  const apiKey = (readJSON(settingsFile).main || {}).apiKey || '';
  return { out, apiKey };
}

// Adds the built-in Sonarr or Radarr to Seerr, with its first quality profile and the library folder.
async function seerrAddArr(k, keys, headers, isDefault = true) {
  const dir = k === 'sonarr' ? E.DIRS.tv : E.DIRS.movies;
  const extra = k === 'sonarr' ? { seriesType: 'standard', animeSeriesType: 'anime', enableSeasonFolders: true, monitorNewItems: 'all' } : { minimumAvailability: 'released' };
  const api = arr(k, keys[k]); await api.ready();
  const [p] = await api.get('qualityprofile');
  await http('POST', `${SEERR}/api/v1/settings/${k}`, { headers, body: {
    name: E.ENGINES[k].name, hostname: '127.0.0.1', port: E.ENGINES[k].port, apiKey: keys[k], useSsl: false,
    baseUrl: E.ENGINES[k].base, activeProfileId: p.id, activeProfileName: p.name, activeDirectory: dir,
    tags: [], is4k: false, isDefault, syncEnabled: true, preventSearch: false, tagRequests: false, overrideRule: [], ...extra } });
}

// ---------- main ----------
async function run() {
  const s = readJSON(`${C}/goat/secrets.json`);
  const mf = `${C}/goat/managed.json`;
  const on = E.enabled();
  const keys = {};
  for (const x of readJSON(mf).services || []) if (x.apiKey) keys[x.key] = x.apiKey;
  // `running` lets the Stack page show that connecting is still going on and refresh itself until it ends.
  const state = { at: Date.now(), running: true, steps: {} };
  writeJSON(`${C}/goat/wired.json`, state);
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

  const steps = [
    ['sonarr', () => wireArr('sonarr', keys, s, on, E.DIRS.tv, 'tv')],
    ['radarr', () => wireArr('radarr', keys, s, on, E.DIRS.movies, 'movies')],
    ['lidarr', () => wireArr('lidarr', keys, s, on, E.DIRS.music, 'music')],
    ['prowlarr', () => wireProwlarr(keys, s, on)],
    ['jellyfin', async () => { const r = await wireJellyfin(s, on); setKey('jellyfin', r.apiKey); return r.out; }],
    ['plex', async () => { const r = await wirePlex(on); setKey('plex', r.token); return r.out; }],
    ['flaresolverr', async () => { if (!on.includes('prowlarr')) return { proxy: 'Prowlarr is off' }; return wireFlareSolverr(keys); }],
    ['seerr', async () => {
      // Seerr signs in through its media server, so it can only be set up once that server is.
      const ms = E.seerrServer(process.env, on);
      if (ms && on.includes(ms) && !(state.steps[ms] && state.steps[ms].ok)) throw new Error(`waiting for ${E.ENGINES[ms].name} to be set up first`);
      const r = await wireSeerr(s, keys, on); setKey('seerr', r.apiKey); return r.out;
    }],
  ].filter(([k]) => on.includes(k));
  // A step that fails (an engine still busy with its first start, say) is tried again a few times.
  const rounds = Number(process.env.GOAT_WIRE_ROUNDS || 4), pause = Number(process.env.GOAT_WIRE_PAUSE || 30000);
  for (let round = 1; round <= rounds; round++) {
    const todo = steps.filter(([k]) => !(state.steps[k] && state.steps[k].ok));
    if (!todo.length) break;
    if (round > 1) { log(`trying again in ${pause / 1000}s: ${todo.map(([k]) => k).join(', ')}`); await sleep(pause); }
    for (const [k, fn] of todo) await step(k, fn);
  }
  state.running = false; state.finished = Date.now();
  writeJSON(`${C}/goat/wired.json`, state);
  const bad = Object.entries(state.steps).filter(([, v]) => !v.ok).map(([k]) => k);
  log(bad.length ? `finished with problems in: ${bad.join(', ')}. These are retried at the next container start.` : 'all engines connected.');
  return state;
}

if (require.main === module) {
  // Settings changed in the interface (PLEX_CLAIM, SEERR_MEDIA_SERVER, ...) take priority over the template.
  Object.assign(process.env, require('./settings').effectiveEnv());
}
if (require.main === module) run().catch(e => { log('stopped:', e && e.stack || e); process.exitCode = 1; });

module.exports = { run, addFromSchema, arr, http };
