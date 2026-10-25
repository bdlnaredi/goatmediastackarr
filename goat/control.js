#!/usr/bin/env node
'use strict';
// The control service: runs as root and lets the GoatMediaStackarr interface apply changes it cannot make
// itself as a normal user (restarting an engine, re-running the wiring, re-applying the VPN).
// It listens on a Unix socket only the PUID user can open, and accepts only the commands listed here.
//
// Protocol: one JSON line in, one JSON line out.  {"cmd":"restart","engine":"sonarr"} -> {"ok":true}

const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');
const E = require('./engines');

const SOCK = process.env.GOAT_CONTROL_SOCK || '/run/goat/control.sock';
const SERVICES = process.env.GOAT_SERVICE_DIR || '/run/service';
const BIN = process.env.GOAT_BIN || '/opt/goat/bin';
const ENGINES = Object.keys(E.ENGINES);
const log = (...a) => console.log('[goat-control]', ...a);

const run = (file, args) => new Promise(resolve => {
  execFile(file, args, { timeout: 120000 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: String(stdout || '').slice(-2000), err: String(stderr || (err && err.message) || '').slice(-2000) }));
});
const restart = name => run('/command/s6-svc', ['-r', `${SERVICES}/${name}`]);
const svc = (name, up) => run('/command/s6-svc', [up ? '-u' : '-d', `${SERVICES}/${name}`]);
// Which apps were stopped by hand, so the interface can show them. Kept in /run, so a restart of the container starts everything again.
const STOPPED = process.env.GOAT_STOPPED || '/run/goat/stopped.json';
const stoppedList = () => { try { return JSON.parse(fs.readFileSync(STOPPED, 'utf8')); } catch { return []; } };
const markStopped = (name, on) => { const l = new Set(stoppedList()); on ? l.add(name) : l.delete(name); try { fs.writeFileSync(STOPPED, JSON.stringify([...l])); fs.chmodSync(STOPPED, 0o644); } catch {} };

// ruTorrent and Deluge are two services each: the downloader and its web page. They are restarted, stopped and
// started together.
const WITH_WEB = ['rutorrent', 'deluge'];
const parts = name => WITH_WEB.includes(name) ? [name, name + '-web'] : [name];

// Logins made for you that can be changed from the Stack page, and where each password is kept in secrets.json.
const LOGINS = { qbittorrent: 'qbitPass', rutorrent: 'rutorrentPass', deluge: 'delugePass', jellyfin: 'jellyfinPass' };
const SECRETS = () => process.env.GOAT_SECRETS || `${E.CONFIG}/goat/secrets.json`;
const QBIT_CONF = () => process.env.GOAT_QBIT_CONF || `${E.CONFIG}/qbittorrent/qBittorrent/config/qBittorrent.conf`;
// 8 to 128 visible characters, no spaces: it goes into config files, a web login and Basic auth.
const goodPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /^[\x21-\x7e]+$/.test(p);
const refused = e => e && (e.cause && /ECONNREFUSED|ECONNRESET|ENOTFOUND/.test(e.cause.code || '') || /ECONNREFUSED|fetch failed/.test(e.message || ''));

// Gives the app its new password while it runs (qBittorrent and Jellyfin keep their own), or leaves it for init.js to
// write when the app starts (ruTorrent reads it at start, Deluge's web.conf is rewritten by init.js).
async function applyPassword(app, old, pw, s, fetchFn) {
  if (app === 'qbittorrent') {
    try {
      const r = await fetchFn(`${E.url('qbittorrent')}/api/v2/app/setPreferences`, { method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'json=' + encodeURIComponent(JSON.stringify({ web_ui_password: pw })) });
      if (!r.ok) throw new Error('qBittorrent refused the change (' + r.status + ')');
    } catch (e) { if (!refused(e)) throw e; }
    // Also in its settings file, so the next start (and init.js, which keeps the stored one) has the new password.
    try {
      const f = QBIT_CONF(), line = `WebUI\\Password_PBKDF2="${require('./init').qbitHash(pw)}"`, t = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, /^WebUI\\Password_PBKDF2=.*$/m.test(t) ? t.replace(/^WebUI\\Password_PBKDF2=.*$/m, () => line) : t.replace(/^\[Preferences\]\r?\n/m, m => m + line + '\n'));
    } catch {}
  }
  if (app === 'jellyfin') {
    const jf = E.url('jellyfin'), auth = t => `MediaBrowser Client="GoatMediaStackarr", Device="goat", DeviceId="goat-control", Version="1"${t ? `, Token="${t}"` : ''}`;
    let login;
    try {
      const r = await fetchFn(`${jf}/Users/AuthenticateByName`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: auth() },
        body: JSON.stringify({ Username: s.jellyfinUser, Pw: old }) });
      if (!r.ok) throw new Error(r.status === 401 ? 'Jellyfin did not accept the current password (was it changed in Jellyfin?)' : 'Jellyfin sign-in failed (' + r.status + ')');
      login = await r.json();
    } catch (e) { throw refused(e) ? new Error('Jellyfin has to be running to change its password') : e; }
    const r = await fetchFn(`${jf}/Users/${login.User.Id}/Password`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: auth(login.AccessToken) },
      body: JSON.stringify({ CurrentPw: old, NewPw: pw }) });
    if (!r.ok) throw new Error('Jellyfin refused the new password (' + r.status + ')');
  }
}

// Backups of the whole stack run as a job in the background (they can take minutes); the interface asks how it goes.
const SB = require('./stackbackup');
const JOB = () => process.env.GOAT_BACKUP_JOB || '/run/goat/stackbackup.json';
let job = null;
const jobWrite = j => { try { fs.writeFileSync(JOB(), JSON.stringify(j)); fs.chmodSync(JOB(), 0o644); } catch {} };
const owner = () => ({ uid: Number(process.env.PUID || 99), gid: Number(process.env.PGID || 100) });
// Backups belong to the PUID user, like the rest of App data, so the interface can list and download them.
const giveBackups = () => { const { uid, gid } = owner(); try { const d = SB.DIR(); fs.chownSync(d, uid, gid); for (const f of fs.readdirSync(d)) if (!f.startsWith('.')) fs.chownSync(require('path').join(d, f), uid, gid); } catch {} };
function startJob(kind, fn, extra = {}) {
  if (job && job.running) return { ok: false, error: 'A backup or restore is already running' };
  job = { kind, ...extra, running: true, started: Date.now(), log: [] };
  const log = m => { job.log.push(m); if (job.log.length > 60) job.log.shift(); jobWrite(job); };
  jobWrite(job);
  Promise.resolve().then(() => fn(log)).then(r => { job = { ...job, running: false, ok: true, result: r, finished: Date.now() }; },
    e => { job = { ...job, running: false, ok: false, error: e.message, finished: Date.now() }; })
    .finally(() => { giveBackups(); jobWrite(job); log(job.ok ? 'Finished' : 'Failed: ' + job.error); });
  return { ok: true, started: true };
}

// Each command is a fixed list of steps; nothing from the request reaches a shell.
async function handle(msg, exec = { run, restart, svc, markStopped, fetch: (...a) => fetch(...a) }) {
  const cmd = msg && msg.cmd;
  if (cmd === 'ping') return { ok: true };
  if (cmd === 'restart') {
    if (!ENGINES.includes(msg.engine)) return { ok: false, error: 'Unknown app' };
    let r = { ok: true };
    for (const n of parts(msg.engine)) { const x = await exec.restart(n); if (!x.ok) r = x; }
    if (r.ok && exec.markStopped) exec.markStopped(msg.engine, false);
    return r.ok ? { ok: true } : { ok: false, error: r.err || 'Could not restart' };
  }
  if (cmd === 'stop' || cmd === 'start') {
    if (!ENGINES.includes(msg.engine)) return { ok: false, error: 'Unknown app' };
    let r = { ok: true };
    for (const n of parts(msg.engine)) { const x = await exec.svc(n, cmd === 'start'); if (!x.ok) r = x; }
    if (r.ok && exec.markStopped) exec.markStopped(msg.engine, cmd === 'stop');
    return r.ok ? { ok: true } : { ok: false, error: r.err || 'Could not ' + cmd + ' it' };
  }
  if (cmd === 'rewire') {
    // Settings first (keys, paths, VPN binding), then the wiring runs again from the start.
    const i = await exec.run('/usr/local/bin/node', [`${BIN}/init.js`]);
    if (!i.ok) return { ok: false, error: 'Writing the app settings failed: ' + i.err };
    const r = await exec.restart('goat-wire');
    return r.ok ? { ok: true } : { ok: false, error: r.err };
  }
  if (cmd === 'apply-vpn') {
    // New VPN settings: rewrite engine settings (qBittorrent's interface binding), rebuild the kill switch,
    // then restart the tunnel and every app that may use it, so nothing runs with old rules.
    const i = await exec.run('/usr/local/bin/node', [`${BIN}/init.js`]);
    if (!i.ok) return { ok: false, error: 'Writing the app settings failed: ' + i.err };
    const k = await exec.run('/bin/bash', [`${BIN}/vpn-init.sh`]);
    if (!k.ok) return { ok: false, error: 'Setting up the kill switch failed: ' + k.err };
    const steps = ['goat-vpn', 'qbittorrent', 'rutorrent', 'deluge', 'sabnzbd', 'prowlarr', 'flaresolverr', 'sitefetch'];
    const failed = [];
    for (const s of steps.flatMap(parts)) { const r = await exec.restart(s); if (!r.ok) failed.push(s); }
    return failed.length ? { ok: false, error: 'Could not restart ' + failed.join(', '), output: k.out } : { ok: true, output: k.out };
  }
  if (cmd === 'stack-backup') {
    const only = Array.isArray(msg.only) ? msg.only.filter(k => SB.PARTS[k]) : [];
    return startJob('backup', log => SB.backup({ kind: msg.auto ? 'auto' : 'manual', keep: Math.min(60, Math.max(1, Number(msg.keep) || 7)), only, log }), { auto: !!msg.auto });
  }
  if (cmd === 'stack-restore') {
    if (!SB.NAME_RE.test(String(msg.name || ''))) return { ok: false, error: 'Not a backup' };
    const only = Array.isArray(msg.only) ? msg.only.filter(k => SB.PARTS[k]) : [];
    const { uid, gid } = owner(), sv = (n, up) => exec.svc(n, up);
    return startJob('restore', async log => {
      const have = await SB.parts(msg.name), want = (only.length ? only : have).filter(k => have.includes(k));
      const first = want.filter(k => k !== 'ui');
      let r = { restored: [], services: [] };
      if (first.length) {
        r = await SB.restore({ name: msg.name, only: first, svc: sv, uid, gid, log });
        // Settings files that depend on the keys (init.js), the apps started again, then the wiring.
        log('Writing the app settings');
        await exec.run('/usr/local/bin/node', [`${BIN}/init.js`]);
        for (const s of r.services) await sv(s, true);
        await exec.restart('goat-wire');
      }
      // The interface's own data last: it is stopped while its folder is swapped, then started again.
      if (want.includes('ui')) { const u = await SB.restore({ name: msg.name, only: ['ui'], svc: sv, uid, gid, log }); r.restored.push('ui'); await sv('goat-ui', true); r.ui = u.before; }
      return r;
    });
  }
  if (cmd === 'stack-remove') {
    try { SB.remove(String(msg.name || '')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  if (cmd === 'stack-job') return { ok: true, job: job || null };
  if (cmd === 'set-login') {
    const key = LOGINS[msg.app];
    if (!key) return { ok: false, error: 'Unknown login' };
    if (!goodPassword(msg.password)) return { ok: false, error: 'Use 8 to 128 characters: letters, numbers and symbols, no spaces.' };
    let s; try { s = JSON.parse(fs.readFileSync(SECRETS(), 'utf8')); } catch { return { ok: false, error: 'The logins file could not be read' }; }
    const old = s[key];
    if (old === msg.password) return { ok: true };
    try { await applyPassword(msg.app, old, msg.password, s, exec.fetch || fetch); } catch (e) { return { ok: false, error: e.message }; }
    s[key] = msg.password;
    const tmp = SECRETS() + '.new';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 }); fs.renameSync(tmp, SECRETS());
    // init.js writes it into the apps' settings (and managed.json for the interface); the web page that reads it at
    // start is restarted; the wiring gives Sonarr, Radarr, Lidarr and Prowlarr the new password.
    const i = await exec.run('/usr/local/bin/node', [`${BIN}/init.js`]);
    if (!i.ok) return { ok: false, error: 'Writing the app settings failed: ' + i.err };
    const web = { rutorrent: 'rutorrent-web', deluge: 'deluge-web' }[msg.app];
    if (web && E.enabled().includes(msg.app)) await exec.restart(web);
    await exec.restart('goat-wire');
    return { ok: true };
  }
  return { ok: false, error: 'Unknown command' };
}

function serve() {
  const uid = Number(process.env.PUID || 99), gid = Number(process.env.PGID || 100);
  try { fs.unlinkSync(SOCK); } catch {}
  let busy = Promise.resolve();
  const server = net.createServer(sock => {
    let buf = '';
    sock.setTimeout(150000, () => sock.destroy());
    sock.on('data', d => {
      buf += d;
      if (buf.length > 4096) return sock.destroy();
      const nl = buf.indexOf('\n'); if (nl === -1) return;
      let msg; try { msg = JSON.parse(buf.slice(0, nl)); } catch { return sock.end(JSON.stringify({ ok: false, error: 'Bad request' }) + '\n'); }
      // One command at a time, so two clicks cannot interleave restarts.
      busy = busy.then(async () => {
        log('command', msg.cmd, msg.engine || msg.app || '');
        let r; try { r = await handle(msg); } catch (e) { r = { ok: false, error: e.message }; }
        if (!r.ok) log('failed:', r.error);
        sock.end(JSON.stringify(r) + '\n');
      });
    });
    sock.on('error', () => {});
  });
  server.listen(SOCK, () => {
    fs.chownSync(SOCK, uid, gid);
    fs.chmodSync(SOCK, 0o600);
    log(`listening on ${SOCK}`);
  });
}

if (require.main === module) serve();
module.exports = { handle, SOCK, goodPassword };
