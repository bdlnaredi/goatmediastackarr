// Built-in Plex: linked with a claim code, libraries made, Seerr set up on Plex, Tautulli pointed at it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

// A spare port, never the same one twice in a run (the system can hand a just-closed port out again).
const used = new Set();
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => used.has(p) ? free().then(r) : (used.add(p), r(p))); }); });
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || 'null')); } catch { r(d); } }); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };

test('Plex is linked, gets libraries, and Seerr and Tautulli use it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-plex-'));
  const ports = {};
  for (const k of ['plex', 'seerr', 'sonarr', 'radarr']) { ports[k] = await free(); process.env[`GOAT_PORT_${k.toUpperCase()}`] = String(ports[k]); }
  Object.assign(process.env, {
    GOAT_CONFIG_DIR: path.join(root, 'config'), MEDIA_DIR: path.join(root, 'media'), DOWNLOADS_DIR: path.join(root, 'downloads'),
    GOAT_ENGINES: 'sonarr,radarr,plex,seerr,tautulli', PLEX_CLAIM: 'claim-abc', GOAT_WIRE_PAUSE: '10',
  });
  const E = require('../goat/engines');
  const init = require('../goat/init');
  const a = init.run(process.env);
  fs.mkdirSync(path.join(root, 'config/seerr'), { recursive: true });

  const plex = { libs: [], claims: 0 };
  const prefs = E.PLEX_PREFS();
  const plexSrv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/identity') return json(res, 200, { MediaContainer: { machineIdentifier: 'mid-1' } });
    if (p === '/myplex/claim' && req.method === 'POST') {
      if (u.searchParams.get('token') !== 'claim-abc' || req.headers['x-plex-client-identifier'] !== 'mid-1') return json(res, 400, {});
      plex.claims++;
      fs.mkdirSync(path.dirname(prefs), { recursive: true });
      fs.writeFileSync(prefs, '<?xml version="1.0"?>\n<Preferences ProcessedMachineIdentifier="mid-1" PlexOnlineToken="plextok" />\n');
      return json(res, 200, {});
    }
    if (req.headers['x-plex-token'] !== 'plextok') return json(res, 401, {});
    if (p === '/library/sections' && req.method === 'GET') return json(res, 200, { MediaContainer: { Directory: plex.libs } });
    if (p === '/library/sections' && req.method === 'POST') {
      plex.libs.push({ title: u.searchParams.get('name'), type: u.searchParams.get('type'), agent: u.searchParams.get('agent'), Location: [{ path: u.searchParams.get('location') }] });
      return json(res, 201, {});
    }
    json(res, 404, {});
  });

  const seerr = { initialized: false, plex: null, dvr: {}, enabled: '', libs: [{ id: '1', enabled: false }, { id: '2', enabled: false }] };
  const seerrSrv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, b = ['POST', 'PUT'].includes(req.method) ? await body(req) : null;
    if (p === '/api/v1/settings/public') return json(res, 200, { initialized: seerr.initialized });
    if (p === '/api/v1/auth/plex') {
      if (b.authToken !== 'plextok') return json(res, 403, {});
      fs.writeFileSync(path.join(root, 'config/seerr/settings.json'), JSON.stringify({ main: { apiKey: 'seerrkey' } }));
      res.setHeader('Set-Cookie', 'connect.sid=p; Path=/'); return json(res, 200, { id: 1 });
    }
    if (req.headers.cookie !== 'connect.sid=p') return json(res, 403, {});
    if (p === '/api/v1/settings/plex' && req.method === 'POST') { seerr.plex = b; return json(res, 200, b); }
    if (p === '/api/v1/settings/plex/library/sync' && req.method === 'POST') return json(res, 200, seerr.libs);
    const lm = p.match(/^\/api\/v1\/settings\/plex\/library\/(\w+)$/);
    if (lm && req.method === 'PUT') { seerr.libs.find(l => l.id === lm[1]).enabled = b.enabled; seerr.enabled = seerr.libs.filter(l => l.enabled).map(l => l.id).join(','); return json(res, 200, {}); }
    const m = p.match(/^\/api\/v1\/settings\/(sonarr|radarr)$/); if (m) { seerr.dvr[m[1]] = b; return json(res, 201, b); }
    if (p === '/api/v1/settings/initialize') { seerr.initialized = true; return json(res, 200, {}); }
    json(res, 404, {});
  });

  const arrSrv = (base, key) => http.createServer((req, res) => {
    if (req.headers['x-api-key'] !== key) return json(res, 401, {});
    const p = new URL(req.url, 'http://x').pathname.slice(base.length);
    if (p === '/api') return json(res, 200, { current: 'v3' });
    if (p === '/api/v3/system/status') return json(res, 200, {});
    if (p === '/api/v3/qualityprofile') return json(res, 200, [{ id: 7, name: 'Any' }]);
    if (/\/(rootfolder|downloadclient)$/.test(p)) return json(res, 200, req.method === 'GET' ? [] : {});
    if (/\/downloadclient\/schema$/.test(p)) return json(res, 200, []);
    json(res, 404, {});
  });
  const servers = [[plexSrv, ports.plex], [seerrSrv, ports.seerr], [arrSrv('/engines/sonarr', a.keys.sonarr), ports.sonarr], [arrSrv('/engines/radarr', a.keys.radarr), ports.radarr]];
  await Promise.all(servers.map(([s, p]) => new Promise(r => s.listen(p, '127.0.0.1', r))));
  try {
    const wire = require('../goat/wire');
    const st = await wire.run();
    assert.ok(st.steps.plex.ok, st.steps.plex.error);
    assert.ok(st.steps.seerr.ok, st.steps.seerr.error);
    assert.equal(plex.claims, 1);
    assert.deepEqual(plex.libs.map(l => [l.type, l.agent, l.Location[0].path]).sort(), [
      ['movie', 'tv.plex.agents.movie', path.join(root, 'media/movies')],
      ['show', 'tv.plex.agents.series', path.join(root, 'media/tv')]]);
    assert.equal(seerr.plex.ip, '127.0.0.1');
    assert.equal(seerr.plex.port, ports.plex);
    assert.equal(seerr.enabled, '1,2');
    assert.equal(st.steps.seerr.result.mediaServer, 'plex');
    const managed = JSON.parse(fs.readFileSync(path.join(root, 'config/goat/managed.json'), 'utf8'));
    assert.equal(managed.services.find(x => x.key === 'plex').apiKey, 'plextok');

    // Next start: no second claim, no duplicate libraries; Tautulli is pointed at Plex.
    const st2 = await wire.run();
    assert.ok(st2.steps.plex.ok);
    assert.equal(plex.claims, 1);
    assert.equal(plex.libs.length, 2);
    init.run(process.env);
    const t = fs.readFileSync(path.join(root, 'config/tautulli/config.ini'), 'utf8');
    assert.match(t, /pms_token = plextok/); assert.match(t, /pms_identifier = mid-1/); assert.match(t, /first_run_complete = 1/);
  } finally {
    await Promise.all(servers.map(([s]) => new Promise(r => s.close(r))));
  }
});

test('Seerr picks the right media server, and Plex is off unless turned on', async () => {
  const E = require('../goat/engines');
  assert.equal(E.seerrServer({ GOAT_ENGINES: 'jellyfin,plex,seerr' }), 'jellyfin', 'Jellyfin stays the default for Seerr');
  assert.equal(E.seerrServer({ GOAT_ENGINES: 'jellyfin,plex,seerr', SEERR_MEDIA_SERVER: 'plex' }), 'plex');
  assert.equal(E.seerrServer({ GOAT_ENGINES: 'sonarr,seerr' }), '');
  assert.ok(!E.DEFAULT_ENGINES.split(',').includes('plex'), 'Plex is off unless turned on');
});
