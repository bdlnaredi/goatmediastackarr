// Before an update: the settings of each app whose version changed are backed up before the apps start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp } = require('./helpers');

const script = path.join(__dirname, '..', '..', 'goat', 'preupdate.js');
const run = env => spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });

test('an app whose version changed is backed up first, once', () => {
  const cfg = tmp(), bk = tmp(), vf = path.join(tmp(), 'versions.json');
  fs.mkdirSync(path.join(cfg, 'sonarr'), { recursive: true }); fs.writeFileSync(path.join(cfg, 'sonarr', 'config.xml'), '<Config><Port>8989</Port></Config>');
  fs.mkdirSync(path.join(cfg, 'radarr'), { recursive: true }); fs.writeFileSync(path.join(cfg, 'radarr', 'config.xml'), '<Config/>');
  const env = { GOAT_CONFIG_DIR: cfg, GOAT_BACKUP_DIR: bk, GOAT_VERSIONS: vf };
  const list = () => fs.readdirSync(bk).filter(n => /^stack-before-update-.*\.tar\.gz$/.test(n));

  // The first start only remembers the versions.
  fs.writeFileSync(vf, JSON.stringify({ apps: { sonarr: '4.0.1', radarr: '5.0.0' } }));
  run(env); assert.equal(list().length, 0);
  // Sonarr is updated: only Sonarr's settings are backed up, with a note of what changed.
  fs.writeFileSync(vf, JSON.stringify({ apps: { sonarr: '4.0.2', radarr: '5.0.0' } }));
  const r = run(env);
  assert.match(r.stdout, /Sonarr 4\.0\.1 → 4\.0\.2/);
  assert.equal(list().length, 1);
  const meta = JSON.parse(fs.readFileSync(path.join(bk, list()[0] + '.json'), 'utf8'));
  assert.deepEqual(meta.parts, ['sonarr']); assert.equal(meta.note, 'Sonarr 4.0.1 → 4.0.2');
  // Started again with the same versions: nothing new.
  run(env); assert.equal(list().length, 1);
});
