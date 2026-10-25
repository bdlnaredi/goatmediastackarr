// The control service only runs its fixed commands, in a fixed order.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-ctl-'));
process.env.GOAT_CONFIG_DIR = path.join(root, 'config');
const { handle } = require('../goat/control');
const settings = require('../goat/settings');

const fake = () => {
  const calls = [];
  return { calls, run: async (f, a) => { calls.push(['run', path.basename(a[0])]); return { ok: true, out: '' }; }, restart: async n => { calls.push(['restart', n]); return { ok: true }; },
    svc: async (n, up) => { calls.push([up ? 'start' : 'stop', n]); return { ok: true }; }, markStopped: (n, on) => calls.push(['mark', n, on]) };
};

test('restart only accepts known apps', async () => {
  const x = fake();
  assert.deepEqual(await handle({ cmd: 'restart', engine: 'sonarr' }, x), { ok: true });
  assert.equal((await handle({ cmd: 'restart', engine: '../../etc' }, x)).ok, false);
  assert.equal((await handle({ cmd: 'restart', engine: 'goat-vpn' }, x)).ok, false);
  assert.equal((await handle({ cmd: 'rm -rf /' }, x)).ok, false);
  assert.deepEqual(x.calls, [['restart', 'sonarr'], ['mark', 'sonarr', false]], 'a restarted app no longer counts as stopped');
});

test('applying the VPN rewrites settings, rebuilds the kill switch, then restarts the tunnel and its apps', async () => {
  const x = fake();
  assert.equal((await handle({ cmd: 'apply-vpn' }, x)).ok, true);
  assert.deepEqual(x.calls, [['run', 'init.js'], ['run', 'vpn-init.sh'], ['restart', 'goat-vpn'], ['restart', 'qbittorrent'], ['restart', 'rutorrent'], ['restart', 'rutorrent-web'], ['restart', 'deluge'], ['restart', 'deluge-web'], ['restart', 'sabnzbd'], ['restart', 'prowlarr'], ['restart', 'flaresolverr'], ['restart', 'sitefetch']]);
  const bad = { ...fake(), run: async (f, a) => ({ ok: !a[0].endsWith('vpn-init.sh'), err: 'no NET_ADMIN' }) };
  const r = await handle({ cmd: 'apply-vpn' }, bad);
  assert.equal(r.ok, false); assert.match(r.error, /kill switch/);
});

test('rewire writes settings and runs the wiring again', async () => {
  const x = fake();
  assert.equal((await handle({ cmd: 'rewire' }, x)).ok, true);
  assert.deepEqual(x.calls, [['run', 'init.js'], ['restart', 'goat-wire']]);
});

test('interface settings take priority over the template, and bad values are refused', () => {
  settings.update({ vpn: { enabled: true, apps: ['qbittorrent'], user: 'me', pass: "p'w" }, plex: { claim: 'claim-AbC123xyz' } });
  const e = settings.effectiveEnv({ VPN_ENABLED: 'false', VPN_APPS: 'qbittorrent,sabnzbd', TZ: 'x' });
  assert.equal(e.VPN_ENABLED, 'true'); assert.equal(e.VPN_APPS, 'qbittorrent'); assert.equal(e.PLEX_CLAIM, 'claim-AbC123xyz'); assert.equal(e.TZ, 'x');
  assert.throws(() => settings.update({ vpn: { type: 'pptp' } }), /Invalid/);
  assert.throws(() => settings.update({ vpn: { user: 'a\nexport X=1' } }), /Invalid/);
  assert.throws(() => settings.update({ evil: { x: 1 } }), /Unknown/);
  assert.throws(() => settings.update({ plex: { claim: 'claim-$(reboot)' } }), /Invalid/);
  assert.equal(settings.view().vpn.pass, '••••');
  const sh = settings.shellExports({});
  assert.match(sh, /export VPN_PASS='p'\\''w'/);
  settings.update({ plex: { claim: null } });
  assert.equal(settings.effectiveEnv({}).PLEX_CLAIM, undefined);
  assert.equal((fs.statSync(settings.FILE()).mode & 0o777).toString(8), '600');
});

test('ruTorrent and Deluge are restarted, stopped and started with their web pages', async () => {
  const x = fake();
  assert.deepEqual(await handle({ cmd: 'stop', engine: 'deluge' }, x), { ok: true });
  assert.deepEqual(await handle({ cmd: 'restart', engine: 'rutorrent' }, x), { ok: true });
  assert.deepEqual(x.calls, [['stop', 'deluge'], ['stop', 'deluge-web'], ['mark', 'deluge', true], ['restart', 'rutorrent'], ['restart', 'rutorrent-web'], ['mark', 'rutorrent', false]]);
});

test('stop and start only accept known apps, and remember what was stopped', async () => {
  const x = fake();
  assert.deepEqual(await handle({ cmd: 'stop', engine: 'radarr' }, x), { ok: true });
  assert.deepEqual(await handle({ cmd: 'start', engine: 'radarr' }, x), { ok: true });
  assert.equal((await handle({ cmd: 'stop', engine: 'goat-vpn' }, x)).ok, false, 'the VPN and the interface cannot be stopped from here');
  assert.deepEqual(x.calls, [['stop', 'radarr'], ['mark', 'radarr', true], ['start', 'radarr'], ['mark', 'radarr', false]]);
});

test('changing a login password: checked, given to the running app, saved, then written and wired', async () => {
  const sec = path.join(root, 'secrets.json'), conf = path.join(root, 'qBittorrent.conf');
  process.env.GOAT_SECRETS = sec; process.env.GOAT_QBIT_CONF = conf;
  process.env.GOAT_ENGINES = 'sonarr,qbittorrent,rutorrent,jellyfin';
  fs.writeFileSync(sec, JSON.stringify({ qbitUser: 'goat', qbitPass: 'old-qbit-pass', rutorrentPass: 'old-ru-pass', delugePass: 'old-de-pass', jellyfinUser: 'goat-admin', jellyfinPass: 'old-jf-pass' }));
  const x = fake(), hits = [];
  x.fetch = async (u, o) => { hits.push([u.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), o.body]);
    if (u.endsWith('/AuthenticateByName')) return { ok: JSON.parse(o.body).Pw === 'old-jf-pass', status: 401, json: async () => ({ AccessToken: 'tok', User: { Id: 'u1' } }) };
    return { ok: true, status: 204 }; };
  assert.equal((await handle({ cmd: 'set-login', app: 'sonarr', password: 'abcdefgh1' }, x)).error, 'Unknown login');
  assert.match((await handle({ cmd: 'set-login', app: 'qbittorrent', password: 'short' }, x)).error, /8 to 128/);
  assert.match((await handle({ cmd: 'set-login', app: 'qbittorrent', password: 'has a space' }, x)).error, /no spaces/);
  assert.deepEqual(x.calls, [], 'nothing happens for a bad request');

  assert.deepEqual(await handle({ cmd: 'set-login', app: 'qbittorrent', password: 'New-Qbit-9' }, x), { ok: true });
  assert.equal(hits[0][0], '/api/v2/app/setPreferences'); assert.match(decodeURIComponent(hits[0][1]), /"web_ui_password":"New-Qbit-9"/);
  assert.equal(JSON.parse(fs.readFileSync(sec, 'utf8')).qbitPass, 'New-Qbit-9');
  assert.equal(fs.statSync(sec).mode & 0o777, 0o600);
  assert.deepEqual(x.calls, [['run', 'init.js'], ['restart', 'goat-wire']]);

  // ruTorrent reads it when its page starts, so that page is restarted.
  x.calls.length = 0;
  assert.deepEqual(await handle({ cmd: 'set-login', app: 'rutorrent', password: 'New-Ru-pass' }, x), { ok: true });
  assert.deepEqual(x.calls, [['run', 'init.js'], ['restart', 'rutorrent-web'], ['restart', 'goat-wire']]);

  // Jellyfin: signs in with the old password, then changes it.
  hits.length = 0;
  assert.deepEqual(await handle({ cmd: 'set-login', app: 'jellyfin', password: 'New-Jf-pass' }, x), { ok: true });
  assert.deepEqual(hits.map(h => h[0]), ['/Users/AuthenticateByName', '/Users/u1/Password']);
  assert.deepEqual(JSON.parse(hits[1][1]), { CurrentPw: 'old-jf-pass', NewPw: 'New-Jf-pass' });
  // A wrong stored password is reported and nothing is saved.
  const s = JSON.parse(fs.readFileSync(sec, 'utf8')); s.jellyfinPass = 'not-it-anymore'; fs.writeFileSync(sec, JSON.stringify(s));
  assert.match((await handle({ cmd: 'set-login', app: 'jellyfin', password: 'Another-pass' }, x)).error, /current password/);
  assert.equal(JSON.parse(fs.readFileSync(sec, 'utf8')).jellyfinPass, 'not-it-anymore');

  // qBittorrent not running: its stored password is dropped, so the new one is written before it starts.
  fs.writeFileSync(conf, '[Preferences]\nWebUI\\Username=goat\nWebUI\\Password_PBKDF2="@ByteArray(x:y)"\nWebUI\\Port=8080\n');
  x.fetch = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  assert.deepEqual(await handle({ cmd: 'set-login', app: 'qbittorrent', password: 'Offline-pass' }, x), { ok: true });
  const saved = fs.readFileSync(conf, 'utf8'), m = saved.match(/^WebUI\\Password_PBKDF2="@ByteArray\(([^:]+):([^)]+)\)"$/m);
  assert.ok(m, 'the new password is stored'); assert.match(saved, /WebUI\\Port=8080/);
  assert.equal(require('node:crypto').pbkdf2Sync('Offline-pass', Buffer.from(m[1], 'base64'), 100000, 64, 'sha512').toString('base64'), m[2]);
  delete process.env.GOAT_ENGINES;
});

test('backups of the stack run as a job in the background, one at a time', async () => {
  const cfg = process.env.GOAT_CONFIG_DIR;
  process.env.GOAT_BACKUP_DIR = path.join(root, 'sb'); process.env.GOAT_BACKUP_JOB = path.join(root, 'sbjob.json');
  fs.mkdirSync(path.join(cfg, 'sonarr'), { recursive: true }); fs.writeFileSync(path.join(cfg, 'sonarr', 'config.xml'), '<Config/>');
  const x = fake();
  assert.deepEqual(await handle({ cmd: 'stack-job' }, x), { ok: true, job: null });
  assert.equal((await handle({ cmd: 'stack-restore', name: '../x' }, x)).error, 'Not a backup');
  assert.equal((await handle({ cmd: 'stack-remove', name: 'nope.tar.gz' }, x)).ok, false);
  assert.deepEqual(await handle({ cmd: 'stack-backup', auto: true, keep: 3 }, x), { ok: true, started: true });
  assert.match((await handle({ cmd: 'stack-backup' }, x)).error, /already running/);
  let j; for (let i = 0; i < 100; i++) { j = (await handle({ cmd: 'stack-job' }, x)).job; if (!j.running) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(j.ok, true, j.error); assert.equal(j.auto, true); assert.match(j.result.name, /^stack-auto-/);
  assert.equal(JSON.parse(fs.readFileSync(process.env.GOAT_BACKUP_JOB, 'utf8')).ok, true, 'the interface can read how it went');
  // Putting it back: the app is stopped, the settings are written, the app starts again, then the wiring.
  fs.writeFileSync(path.join(cfg, 'sonarr', 'config.xml'), '<Config>changed</Config>');
  process.env.GOAT_RESTORE_WAIT = '1';
  assert.equal((await handle({ cmd: 'stack-restore', name: j.result.name, only: ['sonarr'] }, x)).ok, true);
  for (let i = 0; i < 100; i++) { j = (await handle({ cmd: 'stack-job' }, x)).job; if (!j.running) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(j.ok, true, j.error); assert.deepEqual(j.result.restored, ['sonarr']);
  assert.equal(fs.readFileSync(path.join(cfg, 'sonarr', 'config.xml'), 'utf8'), '<Config/>');
  assert.deepEqual(x.calls.filter(c => c[0] !== 'mark'), [['stop', 'sonarr'], ['run', 'init.js'], ['start', 'sonarr'], ['restart', 'goat-wire']]);
});
