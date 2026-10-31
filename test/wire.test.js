// Runs goat/wire.js against small fake engines and checks every connection is made once, and only once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

// A spare port, never the same one twice in a run (the system can hand a just-closed port out again).
const used = new Set();
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => used.has(p) ? free().then(r) : (used.add(p), r(p))); }); });
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || 'null')); } catch { r(d); } }); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };

function fakeArr(base, key, ver, kind) {
  const st = { rootfolder: [], downloadclient: [], applications: [], posts: [] };
  const f = names => names.map(n => ({ name: n, value: '' }));
  const schema = {
    downloadclient: kind === 'prowlarr'
      ? [{ implementation: 'QBittorrent', fields: f(['host', 'port', 'username', 'password', 'category']) },
         { implementation: 'RTorrent', fields: f(['host', 'port', 'useSsl', 'urlBase', 'username', 'password', 'category']) },
         { implementation: 'Deluge', fields: f(['host', 'port', 'useSsl', 'urlBase', 'password', 'category']) }]
      : [{ implementation: 'QBittorrent', fields: f(['host', 'port', 'useSsl', 'urlBase', 'username', 'password', kind === 'radarr' ? 'movieCategory' : 'tvCategory']) },
         { implementation: 'Sabnzbd', fields: f(['host', 'port', 'apiKey', 'urlBase', kind === 'radarr' ? 'movieCategory' : 'tvCategory']) },
         { implementation: 'RTorrent', fields: f(['host', 'port', 'useSsl', 'urlBase', 'username', 'password', kind === 'radarr' ? 'movieCategory' : 'tvCategory']) },
         { implementation: 'Deluge', fields: f(['host', 'port', 'useSsl', 'urlBase', 'password', kind === 'radarr' ? 'movieCategory' : 'tvCategory']) }],
    applications: ['Sonarr', 'Radarr', 'Lidarr'].map(n => ({ implementation: n, fields: f(['prowlarrUrl', 'baseUrl', 'apiKey', 'syncCategories']) })),
  };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith(base)) return json(res, 404, {});
    const p = u.pathname.slice(base.length);
    if (req.headers['x-api-key'] !== key) return json(res, 401, { error: 'bad key' });
    if (p === '/api') return json(res, 200, { current: ver });
    if (p === `/api/${ver}/system/status`) return json(res, 200, { version: '9' });
    if (p === `/api/${ver}/qualityprofile`) return json(res, 200, [{ id: 4, name: 'HD-1080p' }]);
    if (p === `/api/${ver}/metadataprofile`) return json(res, 200, [{ id: 1, name: 'Standard' }]);
    const pm = p.match(new RegExp(`^/api/${ver}/(downloadclient|applications)/(\\d+)$`));
    if (pm && req.method === 'PUT') { const b = await body(req); st.puts = (st.puts || 0) + 1; st.putQuery = u.search; const i = st[pm[1]].findIndex(x => x.id === +pm[2]); st[pm[1]][i] = b; return json(res, 202, b); }
    const m = p.match(new RegExp(`^/api/${ver}/(rootfolder|downloadclient|applications)(/schema)?$`));
    if (!m) return json(res, 404, {});
    if (m[2]) return json(res, 200, JSON.parse(JSON.stringify(schema[m[1]])));
    if (req.method === 'GET') return json(res, 200, st[m[1]]);
    const b = await body(req); st.posts.push(m[1]); st[m[1]].push({ id: st[m[1]].length + 1, ...b });
    json(res, 201, b);
  });
  return { srv, st };
}

function fakeJellyfin(user, pass, { drops = 0 } = {}) {
  const st = { done: false, user: null, libs: [], keys: [], dropped: 0 };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    // Like Jellyfin 10.11 swapping its "starting up" server for the real one: a few connections are cut.
    if (p.startsWith('/Startup/') && st.dropped < drops) { st.dropped++; return req.socket.destroy(); }
    const b = req.method === 'POST' ? await body(req) : null;
    if (p === '/System/Info/Public') return json(res, 200, { Version: '10.11.0', StartupWizardCompleted: st.done });
    const authed = /Token="tok"/.test(req.headers.authorization || '');
    if (p.startsWith('/Startup/')) {
      if (st.done) return json(res, 401, {});
      if (p === '/Startup/User' && b) st.user = b;
      if (p === '/Startup/Complete') st.done = true;
      return json(res, 204);
    }
    if (p === '/Users/AuthenticateByName') return b.Username === user && b.Pw === pass && st.user ? json(res, 200, { AccessToken: 'tok' }) : json(res, 401, {});
    if (!authed) return json(res, 401, {});
    if (p === '/Library/VirtualFolders' && req.method === 'GET') return json(res, 200, st.libs);
    if (p === '/Library/VirtualFolders') { st.libs.push({ Name: u.searchParams.get('name'), Locations: [u.searchParams.get('paths')], CollectionType: u.searchParams.get('collectionType') }); return json(res, 204); }
    if (p === '/Auth/Keys' && req.method === 'GET') return json(res, 200, { Items: st.keys });
    if (p === '/Auth/Keys') { st.keys.push({ AppName: u.searchParams.get('app'), AccessToken: 'jfkey' }); return json(res, 204); }
    json(res, 404, {});
  });
  return { srv, st };
}

function fakeSeerr(settingsFile) {
  const st = { initialized: false, dvr: {}, enabled: '', configured: false, logins: 0, libs: [{ id: 'a', name: 'Movies', enabled: false }, { id: 'b', name: 'TV Shows', enabled: false }] };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, b = ['POST', 'PUT'].includes(req.method) ? await body(req) : null;
    const ok = (req.headers.cookie || '') === 'connect.sid=abc' || req.headers['x-api-key'] === 'seerrkey';
    if (p === '/api/v1/settings/public') return json(res, 200, { initialized: st.initialized });
    if (p === '/api/v1/auth/jellyfin') {
      st.logins++;
      // Like Seerr: the address may only be sent once; later sign-ins must leave it out.
      if (st.configured && b.hostname) return json(res, 500, { error: 'Jellyfin hostname already configured' });
      if (!st.configured && (b.hostname !== '127.0.0.1' || b.serverType !== 2)) return json(res, 400, {});
      st.configured = true;
      if (st.logins === 1) return json(res, 502, { error: 'pretend the first attempt broke off after saving the address' });
      fs.writeFileSync(settingsFile, JSON.stringify({ main: { apiKey: 'seerrkey' } }));
      res.setHeader('Set-Cookie', 'connect.sid=abc; Path=/; HttpOnly'); return json(res, 200, { id: 1 });
    }
    if (!ok) return json(res, 403, {});
    if (p === '/api/v1/settings/jellyfin/library/sync' && req.method === 'POST') return json(res, 200, st.libs);
    if (p === '/api/v1/settings/jellyfin' && req.method === 'GET') return json(res, 200, st.jf || (st.jf = { ip: '127.0.0.1', port: 8096, externalHostname: '' }));
    if (p === '/api/v1/settings/jellyfin' && req.method === 'POST') { st.jf = b; return json(res, 200, b); }
    const lm = p.match(/^\/api\/v1\/settings\/jellyfin\/library\/(\w+)$/);
    if (lm && req.method === 'PUT') { st.libs.find(l => l.id === lm[1]).enabled = b.enabled; st.enabled = st.libs.filter(l => l.enabled).map(l => l.id).join(','); return json(res, 200, {}); }
    const m = p.match(/^\/api\/v1\/settings\/(sonarr|radarr)$/);
    if (m && req.method === 'GET') return json(res, 200, st.dvr[m[1]] ? [st.dvr[m[1]]] : []);
    if (m) { st.dvr[m[1]] = { ...b, id: 0 }; return json(res, 201, b); }
    const mi = p.match(/^\/api\/v1\/settings\/(sonarr|radarr)\/(\d+)$/);
    if (mi && req.method === 'PUT') { st.puts = (st.puts || 0) + 1; st.dvr[mi[1]] = { ...b, id: +mi[2] }; return json(res, 200, b); }
    if (p === '/api/v1/settings/initialize') { st.initialized = true; return json(res, 200, {}); }
    json(res, 404, {});
  });
  return { srv, st };
}

test('wire connects every engine and running it again changes nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-wire-'));
  const ports = {};
  for (const k of ['sonarr', 'radarr', 'prowlarr', 'jellyfin', 'seerr', 'rutorrent', 'deluge']) { ports[k] = await free(); process.env[`GOAT_PORT_${k.toUpperCase()}`] = String(ports[k]); }
  process.env.GOAT_CONFIG_DIR = path.join(root, 'config');
  process.env.MEDIA_DIR = path.join(root, 'media');
  process.env.DOWNLOADS_DIR = path.join(root, 'downloads');
  process.env.GOAT_ENGINES = 'sonarr,radarr,prowlarr,qbittorrent,rutorrent,deluge,sabnzbd,jellyfin,seerr';
  process.env.GOAT_WIRE_PAUSE = '10';
  const init = require('../goat/init');
  const a = init.run(process.env);
  fs.mkdirSync(path.join(root, 'config/seerr'), { recursive: true });
  // The address people use in the browser, written by the page: the apps' own links use it, never 127.0.0.1.
  fs.mkdirSync(path.join(root, 'config/ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/ui/links.json'), JSON.stringify({ base: 'http://192.168.1.10:2806', jellyfin: 'http://192.168.1.10:8096' }));

  const sonarr = fakeArr('/engines/sonarr', a.keys.sonarr, 'v3', 'sonarr');
  const radarr = fakeArr('/engines/radarr', a.keys.radarr, 'v3', 'radarr');
  const prowlarr = fakeArr('/engines/prowlarr', a.keys.prowlarr, 'v1', 'prowlarr');
  const jf = fakeJellyfin(a.secrets.jellyfinUser, a.secrets.jellyfinPass, { drops: 3 });
  const seerr = fakeSeerr(path.join(root, 'config/seerr/settings.json'));
  // Pretend ruTorrent (rTorrent through /RPC2, with the login made for you) and Deluge's Web UI, so wiring waits for them.
  const ru = { srv: http.createServer((req, res) => { const ok = req.url === '/RPC2' && req.headers.authorization === 'Basic ' + Buffer.from(`goat:${a.secrets.rutorrentPass}`).toString('base64');
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'text/xml' }); res.end(ok ? '<?xml version="1.0"?><methodResponse><params><param><value><string>0.16.26</string></value></param></params></methodResponse>' : ''); }) };
  const de = { srv: http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Deluge</title>'); }) };
  const all = [[sonarr, 'sonarr'], [radarr, 'radarr'], [prowlarr, 'prowlarr'], [jf, 'jellyfin'], [seerr, 'seerr'], [ru, 'rutorrent'], [de, 'deluge']];
  await Promise.all(all.map(([f, k]) => new Promise(r => f.srv.listen(ports[k], '127.0.0.1', r))));
  try {
    const wire = require('../goat/wire');
    const s1 = await wire.run();
    for (const [k, v] of Object.entries(s1.steps)) assert.ok(v.ok, `${k}: ${v.error}`);

    assert.equal(sonarr.st.rootfolder[0].path, path.join(root, 'media/tv'));
    const q = sonarr.st.downloadclient.find(x => x.implementation === 'QBittorrent');
    const field = (x, n) => x.fields.find(f => f.name === n).value;
    assert.equal(field(q, 'tvCategory'), 'tv');
    assert.equal(field(q, 'password'), a.secrets.qbitPass);
    // ruTorrent and Deluge come after qBittorrent: used only when the one before them is not available.
    const rt = sonarr.st.downloadclient.find(x => x.implementation === 'RTorrent'), dl = sonarr.st.downloadclient.find(x => x.implementation === 'Deluge');
    assert.deepEqual([q.priority, rt.priority, dl.priority], [1, 2, 3]);
    assert.deepEqual([field(rt, 'port'), field(rt, 'urlBase'), field(rt, 'username'), field(rt, 'password'), field(rt, 'tvCategory')], [ports.rutorrent, 'RPC2', 'goat', a.secrets.rutorrentPass, 'tv']);
    assert.deepEqual([field(dl, 'port'), field(dl, 'password'), field(dl, 'tvCategory')], [ports.deluge, a.secrets.delugePass, 'tv']);
    assert.ok(prowlarr.st.downloadclient.some(x => x.implementation === 'RTorrent') && prowlarr.st.downloadclient.some(x => x.implementation === 'Deluge'));
    assert.equal(field(radarr.st.downloadclient.find(x => x.implementation === 'Sabnzbd'), 'movieCategory'), 'movies');
    assert.equal(field(radarr.st.downloadclient.find(x => x.implementation === 'Sabnzbd'), 'apiKey'), a.secrets.sabnzbd);
    assert.deepEqual(prowlarr.st.applications.map(x => x.implementation).sort(), ['Radarr', 'Sonarr']);
    assert.equal(field(prowlarr.st.applications.find(x => x.implementation === 'Sonarr'), 'apiKey'), a.keys.sonarr);
    assert.equal(prowlarr.st.applications[0].syncLevel, 'fullSync');

    assert.equal(jf.st.dropped, 3, 'dropped connections were retried');
    assert.equal(jf.st.user.Name, a.secrets.jellyfinUser);
    assert.deepEqual(jf.st.libs.map(l => l.CollectionType).sort(), ['movies', 'tvshows']);
    assert.equal(seerr.st.initialized, true);
    assert.equal(seerr.st.enabled, 'a,b');
    assert.equal(seerr.st.dvr.sonarr.apiKey, a.keys.sonarr);
    assert.equal(seerr.st.dvr.sonarr.activeDirectory, path.join(root, 'media/tv'));
    assert.equal(seerr.st.dvr.radarr.baseUrl, '/engines/radarr');
    assert.equal(seerr.st.dvr.sonarr.externalUrl, 'http://192.168.1.10:2806/engines/sonarr', "Seerr's Open in Sonarr uses the server's address");
    assert.equal(seerr.st.jf.externalHostname, 'http://192.168.1.10:8096', "and Play on Jellyfin too");
    assert.equal(seerr.st.dvr.radarr.activeProfileId, 4);

    const managed = JSON.parse(fs.readFileSync(path.join(root, 'config/goat/managed.json'), 'utf8'));
    assert.equal(managed.services.find(x => x.key === 'jellyfin').apiKey, 'jfkey');
    assert.equal(managed.services.find(x => x.key === 'seerr').apiKey, 'seerrkey');

    // Second start: everything already exists.
    const before = [sonarr, radarr, prowlarr].map(f => f.st.posts.length);
    const s2 = await wire.run();
    for (const [k, v] of Object.entries(s2.steps)) assert.ok(v.ok, `${k}: ${v.error}`);
    assert.deepEqual([sonarr, radarr, prowlarr].map(f => f.st.posts.length), before);
    assert.equal(jf.st.libs.length, 2);
    assert.equal(jf.st.keys.length, 1);
    assert.equal(seerr.st.puts, undefined, 'nothing to change in Seerr when the keys still match');
    assert.equal(prowlarr.st.puts, undefined, 'Prowlarr is left alone while the keys match');
    // Radarr restored from an old backup brings back another API key: Prowlarr gets the current one.
    const papp = prowlarr.st.applications.find(x => x.implementation === 'Radarr');
    papp.fields.find(x => x.name === 'apiKey').value = 'an-old-key';
    // Radarr got a new API key after Seerr was set up: the next start gives Seerr the new one.
    seerr.st.dvr.radarr.apiKey = 'an-old-key';
    const s3 = await wire.run();
    assert.ok(s3.steps.seerr.ok, s3.steps.seerr.error);
    assert.equal(seerr.st.dvr.radarr.apiKey, a.keys.radarr); assert.equal(seerr.st.puts, 1);
    assert.equal(s3.steps.prowlarr.ok, true); assert.equal(prowlarr.st.puts, 1); assert.equal(prowlarr.st.putQuery, '?forceSave=true');
    assert.equal(field(prowlarr.st.applications.find(x => x.implementation === 'Radarr'), 'apiKey'), a.keys.radarr);
    assert.equal(seerr.st.dvr.radarr.activeDirectory, path.join(root, 'media/movies'), 'the rest of its settings are kept');
    // Keys found by the second run survive a restart of init.
    const again = init.run(process.env);
    assert.equal(again.managed.services.find(x => x.key === 'seerr').apiKey, 'seerrkey');
    // A new qBittorrent password (set on the Stack page): Sonarr, Radarr and Prowlarr get it, once.
    const sf = path.join(root, 'config/goat/secrets.json'), sec = JSON.parse(fs.readFileSync(sf, 'utf8'));
    sec.qbitPass = 'A-new-qbit-pass'; fs.writeFileSync(sf, JSON.stringify(sec));
    const puts = [sonarr, radarr, prowlarr].map(f => f.st.puts || 0);
    const s4 = await wire.run();
    for (const [k, v] of Object.entries(s4.steps)) assert.ok(v.ok, `${k}: ${v.error}`);
    assert.deepEqual([sonarr, radarr, prowlarr].map((f, i) => (f.st.puts || 0) - puts[i]), [1, 1, 1]);
    assert.equal(field(sonarr.st.downloadclient.find(x => x.implementation === 'QBittorrent'), 'password'), 'A-new-qbit-pass');
    assert.equal(s4.steps.sonarr.result.qbittorrent, 'new password given');
    await wire.run();
    assert.deepEqual([sonarr, radarr, prowlarr].map((f, i) => (f.st.puts || 0) - puts[i]), [1, 1, 1], 'not again once they have it');
    // Changed in Seerr by hand: an address and a link of your own are kept, and no second Sonarr is added.
    seerr.st.dvr.sonarr = { ...seerr.st.dvr.sonarr, hostname: '192.168.1.10', externalUrl: 'https://sonarr.example.com' };
    seerr.st.jf.externalHostname = 'https://jf.example.com';
    const s5 = await wire.run(); assert.ok(s5.steps.seerr.ok, s5.steps.seerr.error);
    assert.equal(seerr.st.dvr.sonarr.hostname, '192.168.1.10'); assert.equal(seerr.st.dvr.sonarr.externalUrl, 'https://sonarr.example.com');
    assert.equal(seerr.st.jf.externalHostname, 'https://jf.example.com');
  } finally {
    await Promise.all(all.map(([f]) => new Promise(r => f.srv.close(r))));
  }
});
