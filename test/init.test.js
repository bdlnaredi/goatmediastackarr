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
