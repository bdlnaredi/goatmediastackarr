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
  return { calls, run: async (f, a) => { calls.push(['run', path.basename(a[0])]); return { ok: true, out: '' }; }, restart: async n => { calls.push(['restart', n]); return { ok: true }; } };
};

test('restart only accepts known apps', async () => {
  const x = fake();
  assert.deepEqual(await handle({ cmd: 'restart', engine: 'sonarr' }, x), { ok: true });
  assert.equal((await handle({ cmd: 'restart', engine: '../../etc' }, x)).ok, false);
  assert.equal((await handle({ cmd: 'restart', engine: 'goat-vpn' }, x)).ok, false);
  assert.equal((await handle({ cmd: 'rm -rf /' }, x)).ok, false);
  assert.deepEqual(x.calls, [['restart', 'sonarr']]);
});

test('applying the VPN rewrites settings, rebuilds the kill switch, then restarts the tunnel and its apps', async () => {
  const x = fake();
  assert.equal((await handle({ cmd: 'apply-vpn' }, x)).ok, true);
  assert.deepEqual(x.calls, [['run', 'init.js'], ['run', 'vpn-init.sh'], ['restart', 'goat-vpn'], ['restart', 'qbittorrent'], ['restart', 'sabnzbd'], ['restart', 'prowlarr'], ['restart', 'flaresolverr']]);
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
