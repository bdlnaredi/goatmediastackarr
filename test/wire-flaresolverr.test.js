// FlareSolverr: added to Prowlarr once as a tagged proxy, and it follows Prowlarr onto the VPN.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
// A spare port, never the same one twice in a run (the system can hand a just-closed port out again).
const used = new Set();
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => used.has(p) ? free().then(r) : (used.add(p), r(p))); }); });

test('FlareSolverr becomes a tagged Prowlarr proxy, once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-fs-'));
  const ports = { prowlarr: await free(), flaresolverr: await free() };
  Object.assign(process.env, { GOAT_PORT_PROWLARR: String(ports.prowlarr), GOAT_PORT_FLARESOLVERR: String(ports.flaresolverr),
    GOAT_CONFIG_DIR: path.join(root, 'config'), MEDIA_DIR: path.join(root, 'm'), DOWNLOADS_DIR: path.join(root, 'd'),
    GOAT_ENGINES: 'prowlarr,flaresolverr', GOAT_WIRE_PAUSE: '10' });
  const init = require('../goat/init');
  const a = init.run(process.env);
  assert.deepEqual(a.managed.extras, [{ key: 'flaresolverr', name: 'FlareSolverr' }]);
  const st = { tags: [], proxies: [] };
  const fsSrv = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{"msg":"FlareSolverr is ready!"}'); });
  const pr = http.createServer(async (req, res) => {
    const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers['x-api-key'] !== a.keys.prowlarr) return json(401, {});
    const p = new URL(req.url, 'http://x').pathname.replace('/engines/prowlarr', '');
    let b = null; if (req.method === 'POST') { let d = ''; for await (const c of req) d += c; b = JSON.parse(d); }
    if (p === '/api') return json(200, { current: 'v1' });
    if (p === '/api/v1/system/status') return json(200, {});
    if (p === '/api/v1/tag') { if (b) { const t = { id: st.tags.length + 1, label: b.label }; st.tags.push(t); return json(201, t); } return json(200, st.tags); }
    if (p === '/api/v1/indexerproxy/schema') return json(200, [{ implementation: 'FlareSolverr', fields: [{ name: 'host', value: '' }, { name: 'requestTimeout', value: 30 }] }, { implementation: 'Http', fields: [] }]);
    if (p === '/api/v1/indexerproxy') { if (b) { st.proxies.push(b); return json(201, b); } return json(200, st.proxies); }
    json(404, {});
  });
  await Promise.all([new Promise(r => fsSrv.listen(ports.flaresolverr, '127.0.0.1', r)), new Promise(r => pr.listen(ports.prowlarr, '127.0.0.1', r))]);
  try {
    const wire = require('../goat/wire');
    const s1 = await wire.run();
    assert.ok(s1.steps.flaresolverr.ok, s1.steps.flaresolverr.error);
    assert.equal(st.proxies.length, 1);
    assert.equal(st.proxies[0].implementation, 'FlareSolverr');
    assert.equal(st.proxies[0].fields.find(f => f.name === 'host').value, `http://127.0.0.1:${ports.flaresolverr}/`);
    assert.equal(st.proxies[0].fields.find(f => f.name === 'requestTimeout').value, 60);
    assert.deepEqual(st.proxies[0].tags, [st.tags.find(t => t.label === 'flaresolverr').id]);
    await wire.run();
    assert.equal(st.proxies.length, 1, 'not added twice'); assert.equal(st.tags.length, 1);
  } finally { fsSrv.close(); pr.close(); }
});

test('FlareSolverr uses the VPN whenever Prowlarr does', () => {
  const E = require('../goat/engines');
  assert.deepEqual(E.vpnApps({ VPN_ENABLED: 'true', VPN_APPS: 'qbittorrent,prowlarr', GOAT_ENGINES: 'prowlarr,flaresolverr' }), ['qbittorrent', 'prowlarr', 'flaresolverr']);
  assert.deepEqual(E.vpnApps({ VPN_ENABLED: 'true', VPN_APPS: 'qbittorrent', GOAT_ENGINES: 'prowlarr,flaresolverr' }), ['qbittorrent']);
  assert.deepEqual(E.vpnApps({ VPN_ENABLED: 'true', VPN_APPS: 'prowlarr', GOAT_ENGINES: 'prowlarr' }), ['prowlarr'], 'not added when it is off');
  assert.ok(!E.DEFAULT_ENGINES.includes('flaresolverr'));
});
