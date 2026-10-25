// Backups of the whole stack: what goes in, what is left out, and putting parts back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-sb-'));
process.env.GOAT_CONFIG_DIR = path.join(root, 'config');
process.env.GOAT_BACKUP_DIR = path.join(root, 'config', 'backups');
process.env.GOAT_RESTORE_WAIT = '1';
const SB = require('../goat/stackbackup');
const C = process.env.GOAT_CONFIG_DIR;
const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(C, f)), { recursive: true }); fs.writeFileSync(path.join(C, f), t); };
const read = f => fs.readFileSync(path.join(C, f), 'utf8');
const has = f => fs.existsSync(path.join(C, f));
const sqlite = (() => { try { execFileSync('sqlite3', ['-version']); return true; } catch { return false; } })();

test('a backup has each app\'s settings and databases, without artwork, caches and logs', async () => {
  put('sonarr/config.xml', '<Config><ApiKey>abc</ApiKey></Config>');
  put('sonarr/MediaCover/1/poster.jpg', 'big picture');
  put('sonarr/logs/sonarr.txt', 'log');
  put('sonarr/logs.db', 'x');
  put('jellyfin/data/jellyfin.db', 'not really sqlite');
  put('jellyfin/data/metadata/library/a.jpg', 'artwork');
  put('jellyfin/cache/x', 'cache');
  put('plex/pms/usr/lib/plexmediaserver/Plex Media Server', 'program');
  put('plex/Library/Application Support/Plex Media Server/Preferences.xml', '<Preferences/>');
  put('plex/Library/Application Support/Plex Media Server/Metadata/x', 'artwork');
  put('goat/secrets.json', '{"qbitPass":"p"}');
  put('flaresolverr/app/big', 'browser');
  if (sqlite) execFileSync('sqlite3', [path.join(C, 'sonarr', 'sonarr.db'), 'create table t(a); insert into t values (42);']);
  const logs = [];
  const r = await SB.backup({ kind: 'manual', log: m => logs.push(m) });
  assert.match(r.name, SB.NAME_RE);
  assert.deepEqual(r.parts.sort(), ['goat', 'jellyfin', 'plex', 'sonarr']);
  const files = execFileSync('tar', ['-tzf', path.join(process.env.GOAT_BACKUP_DIR, r.name)]).toString().split('\n').map(x => x.replace(/^\.\//, ''));
  for (const f of ['sonarr/config.xml', 'jellyfin/data/jellyfin.db', 'plex/Library/Application Support/Plex Media Server/Preferences.xml', 'goat/secrets.json', 'goat-backup.json']) assert.ok(files.includes(f), f + ' is in it');
  for (const f of ['sonarr/MediaCover/1/poster.jpg', 'sonarr/logs/sonarr.txt', 'sonarr/logs.db', 'jellyfin/data/metadata/library/a.jpg', 'jellyfin/cache/x', 'plex/pms/usr/lib/plexmediaserver/Plex Media Server', 'flaresolverr/app/big'])
    assert.ok(!files.includes(f), f + ' is left out');
  if (sqlite) assert.ok(files.includes('sonarr/sonarr.db'));
  assert.equal(fs.statSync(path.join(process.env.GOAT_BACKUP_DIR, r.name)).mode & 0o777, 0o600, 'only the owner can read it');
  const l = SB.list(); assert.equal(l.length, 1); assert.equal(l[0].kind, 'manual'); assert.deepEqual(l[0].parts.sort(), r.parts.sort());
});

test('putting parts back: chosen apps only, stopped and started, with the left-out folders kept', async () => {
  const [b] = SB.list();
  put('sonarr/config.xml', '<Config><ApiKey>changed</ApiKey></Config>');
  put('sonarr/new-file', 'made after the backup');
  put('goat/secrets.json', '{"qbitPass":"changed"}');
  const calls = [];
  const svc = async (n, up) => { calls.push((up ? 'start ' : 'stop ') + n); };
  const r = await SB.restore({ name: b.name, only: ['sonarr'], svc, uid: process.getuid(), gid: process.getgid() });
  assert.deepEqual(r.restored, ['sonarr']); assert.deepEqual(r.services, ['sonarr']);
  assert.deepEqual(calls, ['stop sonarr'], 'the caller starts it again after writing the settings');
  assert.match(read('sonarr/config.xml'), /abc/, 'Sonarr is back as it was');
  assert.ok(!has('sonarr/new-file'), 'files made after the backup are gone');
  assert.equal(read('sonarr/MediaCover/1/poster.jpg'), 'big picture', 'artwork left out of the backup is kept');
  assert.match(read('goat/secrets.json'), /changed/, 'parts not chosen are not touched');
  assert.ok(!fs.readdirSync(C).some(f => f.includes('before-restore')), 'nothing left set aside');
  // A copy of how things were is made first, so the restore can be undone.
  const before = SB.list().find(x => x.kind === 'before-restore');
  assert.ok(before); assert.deepEqual(before.parts, ['sonarr']); assert.equal(r.before, before.name);
  // Undo: put the copy back.
  await SB.restore({ name: before.name, svc, uid: process.getuid(), gid: process.getgid() });
  assert.match(read('sonarr/config.xml'), /changed/);
});

test('names are checked; a broken backup changes nothing', async () => {
  await assert.rejects(SB.restore({ name: '../../etc/passwd', svc: async () => {} }), /Not a backup/);
  assert.throws(() => SB.remove('x.tar.gz'), /Not a backup/);
  const bad = 'stack-manual-2026-01-01-000000.tar.gz';
  fs.writeFileSync(path.join(process.env.GOAT_BACKUP_DIR, bad), 'not an archive');
  fs.writeFileSync(path.join(process.env.GOAT_BACKUP_DIR, bad + '.json'), '{"parts":["sonarr"]}');
  const was = read('sonarr/config.xml'), calls = [];
  await assert.rejects(SB.restore({ name: bad, svc: async (n, up) => calls.push((up ? 'start ' : 'stop ') + n), uid: process.getuid(), gid: process.getgid() }), /nothing was changed/);
  assert.equal(read('sonarr/config.xml'), was); assert.deepEqual(calls, ['stop sonarr', 'start sonarr']);
  SB.remove(bad); assert.ok(!SB.list().some(x => x.name === bad));
});

test('automatic backups keep only the newest few', async () => {
  for (let i = 0; i < 3; i++) { await SB.backup({ kind: 'auto', keep: 2, only: ['goat'] }); await new Promise(r => setTimeout(r, 1100)); }
  assert.equal(SB.list().filter(x => x.kind === 'auto').length, 2);
});
