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

// Each command is a fixed list of steps; nothing from the request reaches a shell.
async function handle(msg, exec = { run, restart, svc, markStopped }) {
  const cmd = msg && msg.cmd;
  if (cmd === 'ping') return { ok: true };
  if (cmd === 'restart') {
    if (!ENGINES.includes(msg.engine)) return { ok: false, error: 'Unknown app' };
    const r = await exec.restart(msg.engine);
    if (r.ok && exec.markStopped) exec.markStopped(msg.engine, false);
    return r.ok ? { ok: true } : { ok: false, error: r.err || 'Could not restart' };
  }
  if (cmd === 'stop' || cmd === 'start') {
    if (!ENGINES.includes(msg.engine)) return { ok: false, error: 'Unknown app' };
    const r = await exec.svc(msg.engine, cmd === 'start');
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
    const steps = ['goat-vpn', 'qbittorrent', 'sabnzbd', 'prowlarr', 'flaresolverr', 'sitefetch'];
    const failed = [];
    for (const s of steps) { const r = await exec.restart(s); if (!r.ok) failed.push(s); }
    return failed.length ? { ok: false, error: 'Could not restart ' + failed.join(', '), output: k.out } : { ok: true, output: k.out };
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
        log('command', msg.cmd, msg.engine || '');
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
module.exports = { handle, SOCK };
