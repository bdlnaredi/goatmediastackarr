// The .NET dedupe hardlinks identical files only, and keeps every app's files byte-for-byte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');

test('identical files become one, different files stay separate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-dd-'));
  const same = crypto.randomBytes(50000), diff = crypto.randomBytes(50000), small = Buffer.from('tiny');
  for (const app of ['sonarr', 'radarr', 'lidarr']) {
    fs.mkdirSync(path.join(root, app, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, app, 'lib', 'System.Private.CoreLib.dll'), same);
    fs.writeFileSync(path.join(root, app, 'lib', 'App.dll'), app === 'lidarr' ? diff : crypto.randomBytes(50000));
    fs.writeFileSync(path.join(root, app, 'small.txt'), small);
  }
  fs.writeFileSync(path.join(root, 'sonarr', 'run.sh'), same); fs.chmodSync(path.join(root, 'sonarr', 'run.sh'), 0o755);
  const before = Object.fromEntries(['sonarr', 'radarr', 'lidarr'].map(a => [a, fs.readFileSync(path.join(root, a, 'lib', 'App.dll'))]));
  const out = execFileSync('python3', [path.join(__dirname, '../goat/dedupe.py'), ...['sonarr', 'radarr', 'lidarr'].map(a => path.join(root, a))], { encoding: 'utf8' });
  assert.match(out, /2 duplicate files hardlinked/);
  const ino = a => fs.statSync(path.join(root, a, 'lib', 'System.Private.CoreLib.dll')).ino;
  assert.equal(ino('sonarr'), ino('radarr')); assert.equal(ino('radarr'), ino('lidarr'));
  assert.notEqual(fs.statSync(path.join(root, 'sonarr', 'run.sh')).ino, ino('sonarr'), 'a different file mode is not merged');
  for (const a of ['sonarr', 'radarr', 'lidarr']) assert.deepEqual(fs.readFileSync(path.join(root, a, 'lib', 'App.dll')), before[a]);
  assert.notEqual(fs.statSync(path.join(root, 'sonarr', 'small.txt')).ino, fs.statSync(path.join(root, 'radarr', 'small.txt')).ino, 'tiny files are left alone');
  // Running again changes nothing.
  assert.match(execFileSync('python3', [path.join(__dirname, '../goat/dedupe.py'), root], { encoding: 'utf8' }), /0 duplicate files/);
});
