// Which apps run: a switch per app in the template (GOAT_APP_<NAME>), or the older list (GOAT_ENGINES).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const E = require('../goat/engines');
const DEF = E.DEFAULT_ENGINES;

test('the switches turn each app on or off', () => {
  assert.deepEqual(E.enabled({}), DEF.split(','), 'nothing set: the default apps');
  const on = E.enabled({ GOAT_ENGINES: '', GOAT_APP_JELLYFIN: 'false', GOAT_APP_CROSS_SEED: 'true', GOAT_APP_AUTOBRR: 'yes', GOAT_APP_PLEX: 'false' });
  assert.ok(!on.includes('jellyfin') && on.includes('cross-seed') && on.includes('autobrr') && !on.includes('plex'));
  assert.ok(on.includes('sonarr'), 'an app without its switch keeps its default');
  assert.deepEqual(E.enabled({ GOAT_ENGINES: DEF, GOAT_APP_PLEX: 'true' }).slice(-1), ['plex'], 'the default list counts as no list of your own');
});

test('a list of your own decides, so a template update cannot turn apps on or off by itself', () => {
  const env = { GOAT_ENGINES: 'sonarr,radarr,plex,tautulli', GOAT_APP_JELLYFIN: 'true', GOAT_APP_TAUTULLI: 'false' };
  assert.equal(E.ownList(env), true);
  assert.deepEqual(E.enabled(env), ['sonarr', 'radarr', 'tautulli', 'plex']);
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'goat', 'engines.js'), 'enabled'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  assert.equal(out, 'sonarr,radarr,tautulli,plex');
});

test('the Unraid template has a switch for every app, named the way the image reads it', () => {
  const xml = fs.readFileSync(path.join(__dirname, '..', 'unraid', 'goatmediastackarr.xml'), 'utf8');
  for (const k of Object.keys(E.ENGINES)) {
    const target = k === 'filebrowser' ? 'GOAT_FILEBROWSER' : E.switchName(k);
    const m = new RegExp(`<Config Name="App: [^"]+" Target="${target}" Default="(true\\|false|false\\|true)"[^>]*>(true|false)</Config>`).exec(xml);
    assert.ok(m, `no switch for ${k} (${target})`);
    const on = k === 'filebrowser' || DEF.split(',').includes(k);
    assert.equal(m[2], String(on), `${k} is ${on ? 'on' : 'off'} by default`);
  }
  assert.match(xml, /Target="GOAT_ENGINES" Default=""/, 'the old list is empty for new installs, so the switches decide');
});
