// Checks the first-start settings that goat/init.js writes for each engine.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-init-'));
process.env.GOAT_CONFIG_DIR = path.join(root, 'config');
process.env.MEDIA_DIR = path.join(root, 'media');
process.env.DOWNLOADS_DIR = path.join(root, 'downloads');
const init = require('../goat/init');
const read = f => fs.readFileSync(path.join(root, 'config', f), 'utf8');

test('iniSet adds, replaces and keeps other lines', () => {
  let x = '';
  x = init.iniSet(x, 'Preferences', 'WebUI\\Port', '8080');
  x = init.iniSet(x, 'Preferences', 'Other', 'keep');
  x = init.iniSet(x, 'BitTorrent', 'Session\\Port', '1');
  x = init.iniSet(x, 'Preferences', 'WebUI\\Port', '9090');
  assert.match(x, /\[Preferences\]\nWebUI\\Port=9090\nOther=keep/);
  assert.match(x, /\[BitTorrent\]\nSession\\Port=1/);
  assert.equal((x.match(/WebUI\\Port/g) || []).length, 1);
  let y = init.iniSet('', 'misc', 'port', '8085', ' = ');
  y = init.iniSet(y, 'misc', 'port', '9000', ' = ');
  assert.match(y, /\[misc\]\nport = 9000/);
});

test('qBittorrent password hash matches its PBKDF2 format', () => {
  const h = init.qbitHash('secret');
  const [, salt, key] = h.match(/^@ByteArray\(([^:]+):([^)]+)\)$/);
  const again = crypto.pbkdf2Sync('secret', Buffer.from(salt, 'base64'), 100000, 64, 'sha512').toString('base64');
  assert.equal(key, again);
});

test('first start writes every engine, later starts keep keys and personal changes', () => {
  const env = { PUID: '99', PGID: '100', GOAT_ENGINES: 'sonarr,radarr,lidarr,prowlarr,bazarr,qbittorrent,sabnzbd,jellyfin,seerr', VPN_ENABLED: 'true', VPN_APPS: 'qbittorrent,sabnzbd,prowlarr' };
  const a = init.run(env);
  const sonarr = read('sonarr/config.xml');
  assert.match(sonarr, /<BindAddress>127\.0\.0\.1<\/BindAddress>/);
  assert.match(sonarr, /<UrlBase>\/engines\/sonarr<\/UrlBase>/);
  assert.match(sonarr, new RegExp(`<ApiKey>${a.keys.sonarr}</ApiKey>`));
  assert.match(sonarr, /<AuthenticationMethod>External<\/AuthenticationMethod>/);
  assert.match(read('qbittorrent/qBittorrent/config/qBittorrent.conf'), /Session\\Interface=goatvpn/);
  assert.match(read('qbittorrent/qBittorrent/config/qBittorrent.conf'), /WebUI\\Address=127\.0\.0\.1/);
  assert.match(read('sabnzbd/sabnzbd.ini'), new RegExp(`api_key = ${a.secrets.sabnzbd}`));
  assert.match(read('sabnzbd/sabnzbd.ini'), /\[\[tv\]\]\nname = tv/);
  const baz = read('bazarr/config/config.yaml');
  assert.match(baz, new RegExp(`apikey: '${a.keys.radarr}'`));
  assert.match(baz, /use_sonarr: true/);
  assert.ok(fs.existsSync(path.join(root, 'media/tv')));
  assert.ok(fs.existsSync(path.join(root, 'downloads/torrents/incomplete')));
  const m = JSON.parse(read('goat/managed.json'));
  assert.deepEqual(m.services.map(x => x.key), ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'bazarr', 'qbittorrent', 'sabnzbd', 'jellyfin', 'seerr']);
  assert.deepEqual(m.vpn, { enabled: true, apps: ['qbittorrent', 'sabnzbd', 'prowlarr'] });
  assert.equal(m.services.find(x => x.key === 'sonarr').url, 'http://127.0.0.1:8989/engines/sonarr');
  assert.equal((fs.statSync(path.join(root, 'config/goat/secrets.json')).mode & 0o777).toString(8), '600');

  // Someone changes a setting inside Sonarr, a later start must keep it; turning the VPN off unbinds qBittorrent.
  fs.writeFileSync(path.join(root, 'config/sonarr/config.xml'), sonarr.replace('</Config>', '  <Branch>develop</Branch>\n</Config>'));
  const qconf = read('qbittorrent/qBittorrent/config/qBittorrent.conf');
  const b = init.run({ ...env, VPN_ENABLED: 'false', GOAT_ENGINES: 'sonarr,radarr' });
  assert.equal(b.keys.sonarr, a.keys.sonarr);
  assert.equal(b.secrets.qbitPass, a.secrets.qbitPass);
  assert.match(read('sonarr/config.xml'), /<Branch>develop<\/Branch>/);
  const q2 = read('qbittorrent/qBittorrent/config/qBittorrent.conf');
  assert.match(q2, /Session\\Interface=\n/);
  assert.equal(q2.match(/Password_PBKDF2=.*/)[0], qconf.match(/Password_PBKDF2=.*/)[0], 'password hash is not regenerated');
  assert.deepEqual(JSON.parse(read('goat/managed.json')).services.map(x => x.key), ['sonarr', 'radarr']);
});

test('an existing Sonarr key is kept when migrating a config folder', () => {
  const r = init.arrConfig('<Config>\n  <ApiKey>oldkey123</ApiKey>\n  <Port>1234</Port>\n</Config>\n', { port: 8989, base: '/engines/sonarr', name: 'Sonarr' }, 'newkey');
  assert.equal(r.apiKey, 'oldkey123');
  assert.match(r.text, /<Port>8989<\/Port>/);
  assert.equal((r.text.match(/<ApiKey>/g) || []).length, 1);
});

test('torrent port: 50413 by default, the old blocked 6881 is moved, a port picked by hand is kept', () => {
  const init = require('../goat/init');
  const s = { qbitUser: 'goat', qbitPass: 'pw' };
  const port = x => (x.match(/^Session\\Port=(\d+)$/m) || [])[1];
  assert.equal(port(init.qbitConfig('', s, '', {})), '50413', 'new install');
  const old = init.iniSet('[Preferences]\nWebUI\\Port=8080\n', 'BitTorrent', 'Session\\Port', '6881');
  assert.equal(port(init.qbitConfig(old, s, '', {})), '50413', 'the old default is moved');
  const mine = init.iniSet('[Preferences]\nWebUI\\Port=8080\n', 'BitTorrent', 'Session\\Port', '7000');
  assert.equal(port(init.qbitConfig(mine, s, '', {})), '7000', 'a hand-picked port is kept');
  assert.equal(port(init.qbitConfig(mine, s, '', { TORRENT_PORT: '40000' })), '40000', 'TORRENT_PORT wins');
  assert.equal(port(init.qbitConfig('', s, '', { TORRENT_PORT: '80' })), '50413', 'a port below 1024 is not used');
});

test('ruTorrent and Deluge: settings written when turned on, logins made, and they follow qBittorrent onto the VPN', () => {
  const cfg = path.join(root, 'config');
  const env = { PUID: '99', PGID: '100', GOAT_ENGINES: 'sonarr,radarr,qbittorrent,rutorrent,deluge', VPN_ENABLED: 'true', VPN_APPS: 'qbittorrent' };
  const r = init.run(env);
  assert.ok(r.secrets.rutorrentPass && r.secrets.delugePass && r.secrets.rutorrentUser === 'goat');
  assert.deepEqual(r.managed.vpn.apps.sort(), ['deluge', 'qbittorrent', 'rutorrent'], 'they use the VPN whenever qBittorrent does');
  const ru = r.managed.services.find(x => x.key === 'rutorrent'), de = r.managed.services.find(x => x.key === 'deluge');
  assert.equal(ru.url, 'http://127.0.0.1:8090'); assert.equal(ru.pass, r.secrets.rutorrentPass); assert.equal(de.url, 'http://127.0.0.1:8112'); assert.equal(de.pass, r.secrets.delugePass);

  const rc = fs.readFileSync(path.join(cfg, 'rutorrent/rtorrent.rc'), 'utf8');
  assert.match(rc, /^network\.scgi\.open_port = 127\.0\.0\.1:5000$/m, 'XML-RPC only inside the container');
  assert.match(rc, /^network\.listen\.port\.range\.set = 50414-50414$/m, 'rTorrent 0.16 names');
  assert.match(rc, /^directory\.default\.set = .*\/torrents\/complete$/m);
  assert.match(rc, /^try_import = .*rutorrent\/rtorrent\.local\.rc$/m, 'changes of your own are read last');
  for (const d of ['session', 'share', 'tmp']) assert.ok(fs.existsSync(path.join(cfg, 'rutorrent', d)));

  const core = init.delugeRead(fs.readFileSync(path.join(cfg, 'deluge/core.conf'), 'utf8'));
  assert.equal(core.allow_remote, false); assert.deepEqual(core.listen_ports, [50415, 50415]); assert.ok(core.enabled_plugins.includes('Label'));
  assert.match(core.move_completed_path, /torrents\/complete$/);
  const webText = fs.readFileSync(path.join(cfg, 'deluge/web.conf'), 'utf8'), web = init.delugeRead(webText);
  assert.match(webText, /^\{\s*"file": 2,\s*"format": 1\s*\}\{/, 'Deluge\'s own file layout: a version header, then the settings');
  assert.equal(web.port, 8112); assert.equal(web.first_login, false);
  assert.equal(crypto.createHash('sha1').update(web.pwd_salt + r.secrets.delugePass).digest('hex'), web.pwd_sha1, 'the Web UI takes the password made for you');

  // Your own Deluge settings survive a restart; the password salt stays when the password is unchanged.
  fs.writeFileSync(path.join(cfg, 'deluge/core.conf'), init.delugeCore(fs.readFileSync(path.join(cfg, 'deluge/core.conf'), 'utf8')).replace('"move_completed": true', '"move_completed": false'));
  init.run(env);
  assert.equal(init.delugeRead(fs.readFileSync(path.join(cfg, 'deluge/core.conf'), 'utf8')).move_completed, false);
  assert.equal(init.delugeRead(fs.readFileSync(path.join(cfg, 'deluge/web.conf'), 'utf8')).pwd_salt, web.pwd_salt);

  assert.deepEqual(init.run({ ...env, VPN_ENABLED: 'false' }).managed.vpn.apps, []);
  assert.deepEqual(init.run({ ...env, VPN_APPS: 'sabnzbd' }).managed.vpn.apps, ['sabnzbd'], 'not on the VPN when qBittorrent is not');
});
