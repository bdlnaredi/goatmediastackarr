// ruTorrent and Deluge as download clients: the Downloads pages work with them like with qBittorrent, and they can be
// added to Sonarr as download clients. ruTorrent, Deluge and Sonarr are pretend servers speaking their real protocols
// (XML-RPC through ruTorrent's httprpc plugin, Deluge's Web UI JSON-RPC), so these prove GoatMediaStackarr's side.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const { xmlParse } = require('../lib/torrentclients');

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40), H3 = 'c'.repeat(40);
const body = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => r(b)); });
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));

// ---------- pretend ruTorrent ----------
function fakeRutorrent() {
  const st = { calls: [], t: {
    [H1.toUpperCase()]: { name: 'Ubuntu.ISO', size: 1000, done: 500, down: 50, up: 0, label: 'linux%20isos', state: 1, active: 1, complete: 0, dir: '/downloads/linux', added: 1700000000 },
    [H2.toUpperCase()]: { name: 'Film.2024', size: 2000, done: 2000, down: 0, up: 10, label: '', state: 1, active: 1, complete: 1, dir: '/downloads', added: 1700000100 },
  } };
  const v = x => Array.isArray(x) ? `<value><array><data>${x.map(v).join('')}</data></array></value>` : typeof x === 'number' ? `<value><i8>${x}</i8></value>` : `<value><string>${String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string></value>`;
  const ok = x => `<?xml version="1.0"?><methodResponse><params><param>${v(x)}</param></params></methodResponse>`;
  const field = (h, x, f) => ({ 'd.hash=': h, 'd.name=': x.name, 'd.size_bytes=': x.size, 'd.completed_bytes=': x.done, 'd.down.rate=': x.down, 'd.up.rate=': x.up, 'd.ratio=': 1500,
    'd.state=': x.state, 'd.is_active=': x.active, 'd.complete=': x.complete, 'd.custom1=': x.label, 'd.directory=': x.dir, 'd.peers_complete=': 3, 'd.peers_accounted=': 1, 'd.message=': '',
    'd.hashing=': 0, 'd.left_bytes=': x.size - x.done, 'd.custom=addtime': x.added, 'd.priority=': 2, 'd.free_diskspace=': 9e9 })[f];
  const srv = http.createServer(async (req, res) => {
    if (req.url !== '/plugins/httprpc/action.php') { res.writeHead(404); return res.end('no'); }
    if (req.headers.authorization !== 'Basic ' + Buffer.from('ann:pw').toString('base64')) { res.writeHead(401); return res.end(); }
    const x = await body(req);
    // ruTorrent's named actions (form posts), which it runs as trusted: what its own page and GoatMediaStackarr use.
    if (/^mode=/.test(x)) {
      const q = new URLSearchParams(x), mode = q.get('mode'), hs = q.getAll('hash'), v = q.get('v');
      st.calls.push(['form', mode, ...hs, ...(v != null ? [v] : [])]);
      for (const h of hs) { const t = st.t[h]; if (!t) continue;
        if (mode === 'stop') t.state = 0; if (mode === 'start') t.state = 1;
        if (mode === 'setlabel') t.label = v;   // URLSearchParams decoded it once, like PHP's rawurldecode
        if (mode === 'remove' || mode === 'removewithdata') delete st.t[h]; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('[]');
    }
    // Raw XML-RPC through the plugin: newer ruTorrent marks it untrusted, so rTorrent refuses what changes torrents.
    const method = /<methodName>([^<]+)<\/methodName>/.exec(x)[1];
    if (/^d\.(start|stop|erase|custom1\.set|custom5\.set|open|close)$/.test(method)) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(`<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><i8>-501</i8></value></member><member><name>faultString</name><value><string>Command "${method}" is not allowed for untrusted connections.</string></value></member></struct></value></fault></methodResponse>`);
    }
    const params = [...x.matchAll(/<param>([\s\S]*?)<\/param>/g)].map(m => xmlParse(`<methodResponse><params><param>${m[1]}</param></params></methodResponse>`));
    st.calls.push([method, ...params.map(p => Buffer.isBuffer(p) ? 'base64:' + p.length : p)]);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    const T = st.t, h = params[0];
    if (method === 'system.client_version') return res.end(ok('0.9.8'));
    if (method === 'd.multicall2') return res.end(ok(Object.entries(T).map(([hh, t]) => params.slice(2).map(f => field(hh, t, f)))));
    if (method === 'throttle.global_down.rate') return res.end(ok(50)); if (method === 'throttle.global_up.rate') return res.end(ok(10));
    if (method === 'd.stop') { T[h].state = 0; return res.end(ok(0)); } if (method === 'd.start') { T[h].state = 1; return res.end(ok(0)); }
    if (method === 'd.custom1.set') { T[h].label = params[1]; return res.end(ok(0)); }
    if (method === 'd.erase') { delete T[h]; return res.end(ok(0)); }
    if (method === 'load.start' || method === 'load.raw_start') {
      T[H3.toUpperCase()] = { name: 'New.One', size: 10, done: 0, down: 0, up: 0, label: String(params[2] || '').replace('d.custom1.set=', ''), state: 1, active: 1, complete: 0, dir: '/downloads', added: 1 };
      return res.end(ok(0));
    }
    if (method === 'f.multicall') return res.end(ok([['a.iso', 1000, 5, 10, 1]]));
    if (method === 't.multicall') return res.end(ok([['udp://tracker.example:80', 20, 3, 1], ['dht://', 0, 0, 1]]));
    if (method === 'p.multicall') return res.end(ok([['10.0.0.5', 'qBittorrent 5.0', 50, 1000, 0]]));
    if (/^d\./.test(method)) return res.end(ok(method === 'd.directory' ? '/downloads/linux' : 7));
    res.end(ok(0));
  });
  return { srv, st };
}

// ---------- pretend Deluge Web UI ----------
function fakeDeluge() {
  const st = { calls: [], connected: false, labels: ['tv'], t: {
    [H1]: { name: 'Show.S01E01', state: 'Downloading', progress: 40, download_payload_rate: 1000, upload_payload_rate: 0, total_wanted: 500, time_added: 1700000000.5, eta: 30, ratio: 0.1, num_seeds: 4, num_peers: 2, label: 'tv', save_path: '/downloads/tv', queue: 0 },
    [H2]: { name: 'Album', state: 'Paused', progress: 100, download_payload_rate: 0, upload_payload_rate: 0, total_wanted: 300, time_added: 1700000001, eta: 0, ratio: 2, num_seeds: 0, num_peers: 0, label: '', save_path: '/downloads', queue: 1 },
  } };
  const srv = http.createServer(async (req, res) => {
    if (req.url !== '/json') { res.writeHead(404); return res.end(); }
    const j = JSON.parse(await body(req)), out = (result, extra = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify({ id: j.id, result, error: null })); };
    st.calls.push([j.method, ...j.params]);
    if (j.method === 'auth.login') return j.params[0] === 'delugepw' ? out(true, { 'Set-Cookie': '_session_id=s1; Path=/json' }) : out(false);
    if (!/_session_id=s1/.test(req.headers.cookie || '')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: j.id, result: null, error: { message: 'Not authenticated', code: 1 } })); }
    if (j.method === 'web.connected') return out(st.connected);
    if (j.method === 'web.get_hosts') return out([['host1', '127.0.0.1', 58846, 'Online']]);
    if (j.method === 'web.connect') { st.connected = j.params[0] === 'host1'; return out([]); }
    if (!st.connected) return out(null);
    if (j.method === 'web.update_ui') return out({ torrents: st.t, stats: { download_rate: 1000, upload_rate: 5, free_space: 7e9 } });
    if (j.method === 'core.pause_torrents') { for (const id of j.params[0]) st.t[id].state = 'Paused'; return out(null); }
    if (j.method === 'label.get_labels') return out(st.labels);
    if (j.method === 'label.add') { st.labels.push(j.params[0]); return out(null); }
    if (j.method === 'label.set_torrent') { if (!st.labels.includes(j.params[1]) && j.params[1]) { res.writeHead(200); return res.end(JSON.stringify({ id: j.id, result: null, error: { message: 'Unknown Label' } })); } st.t[j.params[0]].label = j.params[1]; return out(null); }
    if (j.method === 'core.add_torrent_magnet') { st.t[H3] = { name: 'Magnet.One', state: 'Downloading', progress: 0, total_wanted: 0, label: '' }; return out(H3); }
    if (j.method === 'core.remove_torrents') { for (const id of j.params[0]) delete st.t[id]; return out([]); }
    if (j.method === 'core.get_torrent_status') return out({ save_path: '/downloads/tv', total_size: 500, time_added: 1700000000, ratio: 0.1, total_done: 200, total_uploaded: 20, files: [{ index: 0, path: 'Show/ep1.mkv', size: 500 }], file_progress: [0.4], file_priorities: [1], trackers: [{ url: 'https://tracker.example/announce' }], peers: [{ ip: '10.0.0.9:6881', client: 'Deluge 2', progress: 0.5, down_speed: 10, up_speed: 0 }] });
    if (j.method === 'daemon.info') return out('2.1.1');
    res.writeHead(200); res.end(JSON.stringify({ id: j.id, result: null, error: { message: 'Unknown method' } }));
  });
  return { srv, st };
}

// ---------- pretend Sonarr (download clients only) ----------
function fakeSonarr() {
  const st = { clients: [] };
  const srv = http.createServer(async (req, res) => {
    const j = x => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.headers['x-api-key'] !== 'sk') { res.writeHead(401); return res.end('[]'); }
    if (req.url === '/api/v3/downloadclient/schema') return j(['RTorrent', 'Deluge'].map(i => ({ implementation: i, protocol: 'torrent',
      fields: ['host', 'port', 'useSsl', 'urlBase', ...(i === 'RTorrent' ? ['username'] : []), 'password', 'tvCategory'].map(n => ({ name: n, value: n === 'tvCategory' ? 'tv-sonarr' : '' })) })));
    if (req.url === '/api/v3/downloadclient' && req.method === 'GET') return j(st.clients);
    if (req.url === '/api/v3/downloadclient' && req.method === 'POST') { const b = JSON.parse(await body(req)); st.clients.push(b); return j(b); }
    res.writeHead(404); res.end('{}');
  });
  return { srv, st };
}

test('ruTorrent: list, pause, labels, add, details, remove, and added to Sonarr', async () => {
  const ru = fakeRutorrent(), so = fakeSonarr(), ruUrl = await listen(ru.srv), soUrl = await listen(so.srv);
  const s = await boot({ MONITOR_MS: '60000' }), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'rutorrent', name: 'Seedbox', url: ruUrl, user: 'ann', pass: 'pw' })).data.id;
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: soUrl, apiKey: 'sk' });
    assert.equal((await a.get('/api/status/' + sid)).data.ok, true, 'finds the httprpc address and signs in');

    const l = (await a.get(`/api/qb/${sid}/list`)).data;
    assert.equal(l.dl, 50); assert.equal(l.torrents.length, 2);
    const u = l.torrents.find(x => x.name === 'Ubuntu.ISO');
    assert.deepEqual({ hash: u.hash, state: u.state, progress: u.progress, category: u.category, ratio: u.ratio, eta: u.eta, seeds: u.seeds },
      { hash: H1, state: 'downloading', progress: 0.5, category: 'linux isos', ratio: 1.5, eta: 10, seeds: 3 }, 'labels are read the way ruTorrent stores them (URL-encoded)');
    assert.equal(l.torrents.find(x => x.name === 'Film.2024').state, 'uploading');

    assert.equal((await a.post(`/api/qb/${sid}/act`, { action: 'pause', hashes: [H1] })).status, 200);
    assert.ok(ru.st.calls.some(c => c[0] === 'form' && c[1] === 'stop' && c[2] === H1.toUpperCase()), 'through ruTorrent\'s own trusted action');
    const l2 = (await a.get(`/api/qb/${sid}/list`)).data; // the list is cached for under a second
    await new Promise(r => setTimeout(r, 900));
    assert.equal((await a.get(`/api/qb/${sid}/list`)).data.torrents.find(x => x.hash === H1).state, 'pausedDL'); void l2;
    await a.post(`/api/qb/${sid}/act`, { action: 'category', hashes: [H2], value: 'films & tv' });
    assert.equal(ru.st.t[H2.toUpperCase()].label, 'films%20%26%20tv');
    assert.equal((await a.post(`/api/qb/${sid}/act`, { action: 'top', hashes: [H2] })).status >= 400, true, 'what ruTorrent cannot do says so');

    assert.equal((await a.post('/api/torrent/add', { sid, url: 'magnet:?xt=urn:btih:' + H3, category: 'linux isos' })).status, 200);
    assert.deepEqual(ru.st.calls.find(c => c[0] === 'load.start'), ['load.start', '', 'magnet:?xt=urn:btih:' + H3, 'd.custom1.set=linux%20isos']);
    const torrent = Buffer.concat([Buffer.from('d8:announce'), Buffer.alloc(40, 0x61), Buffer.from('e')]).toString('base64');
    assert.equal((await a.post('/api/torrent/upload', { sid, files: [{ name: 'x.torrent', data: torrent }] })).status, 200);
    assert.ok(ru.st.calls.some(c => c[0] === 'load.raw_start' && /^base64:\d+/.test(c[2])), 'a .torrent file is sent as data');

    const meta = (await a.get(`/api/qb/${sid}/meta`)).data;
    assert.ok(meta.categories.some(c => c.name === 'linux isos')); assert.equal(meta.free, 9e9); assert.equal(meta.client, 'rutorrent');
    const info = (await a.get(`/api/qb/${sid}/info?hash=${H1}`)).data;
    assert.equal(info.files[0].name, 'a.iso'); assert.equal(info.files[0].progress, 0.5);
    assert.deepEqual(info.trackers.map(t => t.url), ['udp://tracker.example:80']); assert.equal(info.peers[0].client, 'qBittorrent 5.0');

    await a.post(`/api/qb/${sid}/act`, { action: 'delete', hashes: [H2], files: true });
    assert.ok(ru.st.calls.some(c => c[0] === 'form' && c[1] === 'removewithdata' && c[2] === H2.toUpperCase()), 'files are removed through ruTorrent\'s erasedata action');
    assert.equal(ru.st.t[H2.toUpperCase()], undefined);

    const r = (await a.post(`/api/clients/${sid}/arr`, {})).data;
    assert.deepEqual(r.results, [{ app: 'Sonarr', result: 'added' }]);
    const c = so.st.clients[0], f = n => c.fields.find(x => x.name === n).value;
    assert.equal(c.implementation, 'RTorrent'); assert.equal(c.name, 'ruTorrent (Seedbox)');
    assert.equal(f('host'), '127.0.0.1'); assert.equal(f('urlBase'), 'plugins/httprpc/action.php'); assert.equal(f('username'), 'ann'); assert.equal(f('password'), 'pw');
    assert.equal(f('tvCategory'), 'tv-sonarr', 'the app\'s own default category is kept');
    assert.deepEqual((await a.post(`/api/clients/${sid}/arr`, {})).data.results, [{ app: 'Sonarr', result: 'already there' }]);

    const bad = (await a.post('/api/services', { type: 'rutorrent', name: 'Bad', url: ruUrl, user: 'ann', pass: 'nope' })).data.id;
    assert.equal((await a.get('/api/status/' + bad)).data.ok, false);
  } finally { await s.stop(); ru.srv.close(); so.srv.close(); }
});

test('Deluge: signs in, connects the Web UI, list, pause, labels, add, details, remove', async () => {
  const de = fakeDeluge(), url = await listen(de.srv);
  const s = await boot({ MONITOR_MS: '60000' }), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'deluge', name: 'Deluge', url, pass: 'delugepw' })).data.id;
    assert.equal((await a.get('/api/status/' + sid)).data.ok, true);
    assert.ok(de.st.calls.some(c => c[0] === 'web.connect' && c[1] === 'host1'), 'the Web UI was connected to its daemon');
    const l = (await a.get(`/api/qb/${sid}/list`)).data;
    assert.equal(l.dl, 1000);
    const t = l.torrents.find(x => x.hash === H1);
    assert.deepEqual({ state: t.state, progress: t.progress, category: t.category, added: t.added, eta: t.eta }, { state: 'downloading', progress: 0.4, category: 'tv', added: 1700000001, eta: 30 });
    assert.equal(l.torrents.find(x => x.hash === H2).state, 'pausedUP');

    await a.post(`/api/qb/${sid}/act`, { action: 'pause', hashes: [H1] });
    assert.equal(de.st.t[H1].state, 'Paused');
    await a.post(`/api/qb/${sid}/act`, { action: 'category', hashes: [H2], value: 'Music' });
    assert.ok(de.st.labels.includes('music'), 'a missing label is made first (Deluge keeps them in lower case)'); assert.equal(de.st.t[H2].label, 'music');

    assert.equal((await a.post('/api/torrent/add', { sid, url: 'magnet:?xt=urn:btih:' + H3, category: 'tv', paused: true })).status, 200);
    assert.deepEqual(de.st.calls.find(c => c[0] === 'core.add_torrent_magnet'), ['core.add_torrent_magnet', 'magnet:?xt=urn:btih:' + H3, { add_paused: true }]);
    assert.equal(de.st.t[H3].label, 'tv');

    const info = (await a.get(`/api/qb/${sid}/info?hash=${H1}`)).data;
    assert.equal(info.files[0].name, 'Show/ep1.mkv'); assert.equal(info.peers[0].client, 'Deluge 2'); assert.equal(info.props.path, '/downloads/tv');
    assert.deepEqual((await a.get(`/api/qb/${sid}/meta`)).data.categories.map(c => c.name).sort(), ['music', 'tv']);

    await a.post(`/api/qb/${sid}/act`, { action: 'delete', hashes: [H2], files: true });
    assert.deepEqual(de.st.calls.find(c => c[0] === 'core.remove_torrents'), ['core.remove_torrents', [H2], true]);
    assert.equal((await a.get(`/api/qb/${sid}/prefs`)).status >= 400, true, 'qBittorrent-only pages refuse Deluge');

    const bad = (await a.post('/api/services', { type: 'deluge', name: 'Bad', url, pass: 'wrong' })).data.id;
    assert.equal((await a.get('/api/status/' + bad)).data.ok, false);
  } finally { await s.stop(); de.srv.close(); }
});
