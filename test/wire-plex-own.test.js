// Plex in its own container (no media server inside this one): Seerr signs in through it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || 'null')); } catch { r(d); } }); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };

test("Seerr signs in through a Plex server outside the container", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-ownplex-'));
  const ports = {};
  for (const k of ['seerr', 'sonarr', 'radarr']) { ports[k] = await free(); process.env[`GOAT_PORT_${k.toUpperCase()}`] = String(ports[k]); }
  const own = await free();
  Object.assign(process.env, {
    GOAT_CONFIG_DIR: path.join(root, 'config'), MEDIA_DIR: path.join(root, 'media'), DOWNLOADS_DIR: path.join(root, 'downloads'),
    GOAT_ENGINES: 'sonarr,radarr,seerr', GOAT_WIRE_PAUSE: '10', GOAT_WIRE_ROUNDS: '1',
  });
  const E = require('../goat/engines');
  const settings = require('../goat/settings');
  assert.equal(E.seerrServer(process.env), '', 'nothing to sign in through yet');
  // What the interface does when your Plex server is added under Settings, then Apps.
  settings.update({ plex: { url: `http://127.0.0.1:${own}/`, token: 'owntok' } });
  assert.equal(settings.view().plex.token, '••••', 'the token is not shown in the interface');
  Object.assign(process.env, settings.effectiveEnv());
  assert.equal(E.seerrServer(process.env), 'plex');
  const init = require('../goat/init');
  const a = init.run(process.env);
  fs.mkdirSync(path.join(root, 'config/seerr'), { recursive: true });

  const seerr = { initialized: false, plex: null, dvr: {}, libs: [{ id: '1', enabled: false }] };
  const seerrSrv = http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname, b = ['POST', 'PUT'].includes(req.method) ? await body(req) : null;
    if (p === '/api/v1/settings/public') return json(res, 200, { initialized: seerr.initialized });
    if (p === '/api/v1/auth/plex') {
      if (b.authToken !== 'owntok') return json(res, 403, {});
      fs.writeFileSync(path.join(root, 'config/seerr/settings.json'), JSON.stringify({ main: { apiKey: 'seerrkey' } }));
      res.setHeader('Set-Cookie', 'connect.sid=p; Path=/'); return json(res, 200, { id: 1 });
    }
    if (req.headers.cookie !== 'connect.sid=p') return json(res, 403, {});
    if (p === '/api/v1/settings/plex' && req.method === 'POST') { seerr.plex = b; return json(res, 200, b); }
    if (p === '/api/v1/settings/plex/library/sync') return json(res, 200, seerr.libs);
    if (/^\/api\/v1\/settings\/plex\/library\/\w+$/.test(p)) { seerr.libs[0].enabled = true; return json(res, 200, {}); }
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
  const servers = [[seerrSrv, ports.seerr], [arrSrv('/engines/sonarr', a.keys.sonarr), ports.sonarr], [arrSrv('/engines/radarr', a.keys.radarr), ports.radarr]];
  await Promise.all(servers.map(([s, p]) => new Promise(r => s.listen(p, '127.0.0.1', r))));
  try {
    const st = await require('../goat/wire').run();
    assert.ok(st.steps.seerr.ok, st.steps.seerr.error);
    assert.equal(st.steps.plex, undefined, 'no built-in Plex step');
    assert.deepEqual(seerr.plex, { ip: '127.0.0.1', port: own, useSsl: false });
    assert.ok(seerr.libs[0].enabled);
    assert.deepEqual(Object.keys(seerr.dvr).sort(), ['radarr', 'sonarr']);
    assert.match(st.steps.seerr.result.via, /your Plex at http:\/\/127\.0\.0\.1/);
  } finally {
    await Promise.all(servers.map(([s]) => new Promise(r => s.close(r))));
  }
});

test('an address with https or no port still works out', () => {
  const E = require('../goat/engines');
  assert.deepEqual(E.externalPlex({ PLEX_URL: 'https://plex.example.com', PLEX_TOKEN: 't' }), { ip: 'plex.example.com', port: 443, useSsl: true, token: 't', url: 'https://plex.example.com' });
  assert.equal(E.externalPlex({ PLEX_URL: 'http://192.168.1.10', PLEX_TOKEN: 't' }).port, 32400);
  assert.equal(E.externalPlex({ PLEX_URL: 'http://192.168.1.10:32400' }), null, 'needs a token too');
});
