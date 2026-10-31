'use strict';
// Backups of the whole stack: every app's settings and databases in one .tar.gz, and putting them back.
// Run by the control service (as root), so every app's files can be read and written back with the right owner.
//
// What goes in: each app's own folder under /config, without what it can make again by itself (artwork,
// caches, logs, transcodes, Plex's program files, FlareSolverr's download). Databases are copied with SQLite's own
// backup, so a database that is being written to while the backup runs is still copied whole.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const E = require('./engines');

const C = () => E.CONFIG;
const DIR = () => process.env.GOAT_BACKUP_DIR || path.join(C(), 'backups');
const NAME_RE = /^stack-(auto|manual|before-restore)-(\d{4}-\d{2}-\d{2}-\d{6}(?:\d{3})?)\.tar\.gz$/;

// Folder in /config for each part of the backup, and what is left out of it (paths inside that folder).
const PARTS = {
  goat: { name: 'GoatMediaStackarr (keys, logins, settings)', dir: 'goat', skip: ['backups'] },
  ui: { name: 'GoatMediaStackarr (profiles, requests, history)', dir: 'ui', skip: ['backups', 'sitecache', 'avatars-tmp'] },
  vpn: { name: 'VPN files', dir: 'vpn', skip: [] },
  sonarr: { name: 'Sonarr', dir: 'sonarr', skip: ['MediaCover', 'logs', 'Backups', 'logs.db', 'logs.db-wal', 'logs.db-shm', 'UpdateLogs'] },
  radarr: { name: 'Radarr', dir: 'radarr', skip: ['MediaCover', 'logs', 'Backups', 'logs.db', 'logs.db-wal', 'logs.db-shm', 'UpdateLogs'] },
  lidarr: { name: 'Lidarr', dir: 'lidarr', skip: ['MediaCover', 'logs', 'Backups', 'logs.db', 'logs.db-wal', 'logs.db-shm', 'UpdateLogs'] },
  prowlarr: { name: 'Prowlarr', dir: 'prowlarr', skip: ['logs', 'Backups', 'logs.db', 'logs.db-wal', 'logs.db-shm', 'UpdateLogs'] },
  bazarr: { name: 'Bazarr', dir: 'bazarr', skip: ['log', 'cache', 'backup', 'restore'] },
  qbittorrent: { name: 'qBittorrent', dir: 'qbittorrent', skip: ['qBittorrent/data/logs', 'qBittorrent/cache'] },
  rutorrent: { name: 'ruTorrent and rTorrent', dir: 'rutorrent', skip: ['tmp', 'errors.log'] },
  deluge: { name: 'Deluge', dir: 'deluge', skip: ['deluged.log', 'deluge-web.log'] },
  sabnzbd: { name: 'SABnzbd', dir: 'sabnzbd', skip: ['logs', 'Downloads', 'admin/future'] },
  jellyfin: { name: 'Jellyfin', dir: 'jellyfin', skip: ['cache', 'log', 'tmp', 'data/metadata', 'data/transcodes', 'data/subtitles', 'data/keyframes', 'data/attachments'] },
  seerr: { name: 'Seerr', dir: 'seerr', skip: ['logs', 'cache'] },
  tautulli: { name: 'Tautulli', dir: 'tautulli', skip: ['logs', 'cache', 'backups', 'newsletters'] },
  filebrowser: { name: 'File Browser', dir: 'filebrowser', skip: [] },
  plex: { name: 'Plex', dir: 'plex', skip: ['pms', 'tmp', 'Library/Application Support/Plex Media Server/Cache', 'Library/Application Support/Plex Media Server/Metadata',
    'Library/Application Support/Plex Media Server/Media', 'Library/Application Support/Plex Media Server/Logs', 'Library/Application Support/Plex Media Server/Crash Reports',
    'Library/Application Support/Plex Media Server/Codecs', 'Library/Application Support/Plex Media Server/Updates', 'Library/Application Support/Plex Media Server/Drivers',
    'Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.blobs.db'] },
};
// The services that keep files open in each part, stopped while it is put back.
const SERVICES = { sonarr: ['sonarr'], radarr: ['radarr'], lidarr: ['lidarr'], prowlarr: ['prowlarr'], bazarr: ['bazarr'], qbittorrent: ['qbittorrent'],
  rutorrent: ['rutorrent', 'rutorrent-web'], deluge: ['deluge', 'deluge-web'], sabnzbd: ['sabnzbd'], jellyfin: ['jellyfin'], seerr: ['seerr'], tautulli: ['tautulli'], filebrowser: ['filebrowser'],
  plex: ['plex'], vpn: ['goat-vpn'], goat: [], ui: ['goat-ui'] };

const sh = (file, args, opt = {}) => new Promise((resolve, reject) =>
  execFile(file, args, { timeout: 30 * 60000, maxBuffer: 16 << 20, ...opt }, (err, out, errOut) => err ? reject(new Error(String(errOut || err.message).trim().slice(-600))) : resolve(String(out))));
// Down to the millisecond, so two backups made close together never share a name.
const stamp = (d = new Date()) => d.toISOString().replace(/[-:T.]/g, '').slice(0, 17).replace(/^(\d{4})(\d{2})(\d{2})(\d{9})$/, '$1-$2-$3-$4');
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

// Every file under dir, as paths relative to it, without the skipped ones.
function walk(base, rel, skip, out) {
  const full = path.join(base, rel);
  let ents; try { ents = fs.readdirSync(full, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (skip.some(s => r === s || r.startsWith(s + '/'))) continue;
    if (e.isDirectory()) walk(base, r, skip, out);
    else if (e.isFile() || e.isSymbolicLink()) out.push(r);
  }
}
const isDb = f => /\.(db|sqlite|sqlite3)$/i.test(f) || /com\.plexapp\.plugins\.library\.db$/.test(f);
const isDbSide = f => /\.(db|sqlite|sqlite3)-(wal|shm|journal)$/i.test(f);

function list() {
  const d = DIR(); let names = [];
  try { names = fs.readdirSync(d).filter(n => NAME_RE.test(n)); } catch {}
  return names.map(n => {
    const st = fs.statSync(path.join(d, n)), m = n.match(NAME_RE);
    let parts = []; try { parts = JSON.parse(fs.readFileSync(path.join(d, n + '.json'), 'utf8')).parts || []; } catch {}
    return { name: n, kind: m[1], at: st.mtimeMs, size: st.size, parts };
  }).sort((a, b) => b.at - a.at);
}

// Makes one backup. kind: auto, manual or before-restore. only: the parts to include (all that exist when empty).
async function backup({ kind = 'manual', keep = 7, only = [], log = () => {} } = {}) {
  const d = DIR(); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const free = await sh('df', ['-Pk', d]).then(o => +o.trim().split('\n').pop().split(/\s+/)[3] * 1024).catch(() => 0);
  const parts = Object.entries(PARTS).filter(([k, p]) => (!only.length || only.includes(k)) && exists(path.join(C(), p.dir)));
  if (!parts.length) throw new Error('There is nothing to back up yet');
  const work = fs.mkdtempSync(path.join(d, '.work-'));
  const name = `stack-${kind}-${stamp()}.tar.gz`, out = path.join(d, name);
  let bytes = 0;
  try {
    for (const [k, p] of parts) {
      const files = []; walk(path.join(C(), p.dir), '', p.skip, files);
      for (const f of files) {
        if (isDbSide(f)) continue;
        const src = path.join(C(), p.dir, f), dst = path.join(work, p.dir, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const st = fs.lstatSync(src);
        if (st.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(src), dst); } catch {} continue; }
        bytes += st.size;
        if (isDb(f)) {
          // A database in use: SQLite's own copy, so it is never caught half-written. A file that is not really a
          // database (or that sqlite3 cannot open) is copied as it is.
          try { await sh('sqlite3', [src, `.backup '${dst.replace(/'/g, "''")}'`], { timeout: 10 * 60000 }); continue; } catch (e) { log(`${p.dir}/${f}: copied as a file (${e.message.slice(0, 80)})`); }
        }
        fs.copyFileSync(src, dst);
      }
      log(`${p.name}: ${files.length} files`);
    }
    if (free && bytes > free * 0.9) throw new Error(`Not enough free space for the backup: it needs about ${Math.round(bytes / 1e6)} MB, there is ${Math.round(free / 1e6)} MB`);
    fs.writeFileSync(path.join(work, 'goat-backup.json'), JSON.stringify({ made: Date.now(), kind, parts: parts.map(([k]) => k), version: process.env.GOAT_VERSION || '' }));
    await sh('tar', ['-czf', out + '.part', '-C', work, '.']);
    fs.renameSync(out + '.part', out); fs.chmodSync(out, 0o600);
    fs.writeFileSync(out + '.json', JSON.stringify({ parts: parts.map(([k]) => k) })); fs.chmodSync(out + '.json', 0o600);
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); try { fs.rmSync(out + '.part', { force: true }); } catch {}
  }
  // Keep the newest few of each kind (manual and before-restore copies are kept until removed, up to 20).
  const mine = list().filter(x => x.kind === kind), limit = kind === 'auto' ? Math.max(1, keep) : 20;
  for (const x of mine.slice(limit)) remove(x.name);
  return { name, size: fs.statSync(out).size, parts: parts.map(([k]) => k) };
}

function remove(name) {
  if (!NAME_RE.test(name)) throw new Error('Not a backup');
  for (const f of [name, name + '.json']) fs.rmSync(path.join(DIR(), f), { force: true });
}

// What is in a backup: its parts, from the file next to it or from the archive itself.
async function parts(name) {
  if (!NAME_RE.test(name)) throw new Error('Not a backup');
  const f = path.join(DIR(), name);
  if (!exists(f)) throw new Error('That backup is not there any more');
  try { return JSON.parse(fs.readFileSync(f + '.json', 'utf8')).parts || []; } catch {}
  const top = (await sh('tar', ['-tzf', f])).split('\n').map(l => l.replace(/^\.\//, '').split('/')[0]).filter(Boolean);
  return Object.keys(PARTS).filter(k => top.includes(PARTS[k].dir));
}

// Puts parts of a backup back. The apps involved are stopped, each part's folder is set aside and replaced by the one
// in the backup, files get the PUID owner, and the apps start again. A failure puts the set-aside folders back.
async function restore({ name, only = [], svc, uid, gid, log = () => {} }) {
  const have = await parts(name), want = (only.length ? only : have).filter(k => have.includes(k) && PARTS[k]);
  if (!want.length) throw new Error('Nothing chosen to put back');
  const f = path.join(DIR(), name), at = stamp(), aside = [];
  // A copy of how things are now, first, so a restore can be undone.
  const before = await backup({ kind: 'before-restore', only: want, log }).catch(e => { throw new Error('Could not make a copy of the current settings first: ' + e.message); });
  const services = [...new Set(want.flatMap(k => SERVICES[k] || []))];
  // The interface itself is restarted last, after this answers, so it is not stopped here.
  const stop = want.length === 1 && want[0] === 'ui' ? services : services.filter(s => s !== 'goat-ui');
  for (const s of stop) await svc(s, false);
  await new Promise(r => setTimeout(r, Number(process.env.GOAT_RESTORE_WAIT || 4000)));
  try {
    const tmp = fs.mkdtempSync(path.join(DIR(), '.restore-'));
    try {
      await sh('tar', ['-xzf', f, '-C', tmp, ...want.map(k => './' + PARTS[k].dir)]);
      for (const k of want) {
        const dir = PARTS[k].dir, live = path.join(C(), dir), from = path.join(tmp, dir);
        if (!exists(from)) continue;
        // What the backup leaves out (artwork, caches, Plex's program files) is kept from the current folder.
        if (exists(live)) { const a = live + '.before-restore-' + at; fs.renameSync(live, a); aside.push([live, a, PARTS[k].skip]); }
        fs.renameSync(from, live);
        const a = aside.find(x => x[0] === live);
        if (a) for (const s of a[2]) { const old = path.join(a[1], s), now = path.join(live, s); if (exists(old) && !exists(now)) { fs.mkdirSync(path.dirname(now), { recursive: true }); fs.renameSync(old, now); } }
        await sh('chown', ['-R', `${uid}:${gid}`, live]);
        log(`${PARTS[k].name}: put back`);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    for (const [, a] of aside) fs.rmSync(a, { recursive: true, force: true });
  } catch (e) {
    for (const [live, a] of aside.reverse()) { try { fs.rmSync(live, { recursive: true, force: true }); fs.renameSync(a, live); } catch {} }
    for (const s of stop) await svc(s, true);
    throw new Error('Putting the backup back failed, so nothing was changed: ' + e.message);
  }
  return { restored: want, before: before.name, services };
}

module.exports = { PARTS, SERVICES, DIR, NAME_RE, list, backup, restore, remove, parts };
