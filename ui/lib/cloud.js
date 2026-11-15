// Copies backups to Google Drive, OneDrive or iCloud Drive, through rclone (in the image). rclone keeps the sign-in in
// its own config file (rclone.conf next to GoatMediaStackarr's data) and renews it by itself.
//
// Signing in to Google or Microsoft: rclone's "authorize" runs a small sign-in helper on this server at
// 127.0.0.1:53682. The person opens the provider's page in their own browser and allows access; the provider then sends
// their browser to http://127.0.0.1:53682/… or http://localhost:53682/…, which does not open on their device (the
// helper is on the server). They copy that address and paste it in GoatMediaStackarr, which hands it to the helper here;
// rclone finishes the sign-in and prints the token.
//
// iCloud: Apple ID, password, then the 6-digit code Apple shows on their devices (rclone's own steps). Apple asks again
// about once a month, and it only works with Advanced Data Protection off.
'use strict';
const { spawn, execFile } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');

const TYPES = { drive: 'Google Drive', onedrive: 'OneDrive', iclouddrive: 'iCloud Drive' };
const REMOTE = 'goatcloud';
const BIN = () => process.env.RCLONE_BIN || 'rclone';
const AUTH_PORT = () => +process.env.CLOUD_AUTH_PORT || 53682;
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

let CONF = '';
const conf = () => CONF;
function setConfDir(dir) { CONF = path.join(dir, 'rclone.conf'); }
const env = () => ({ ...process.env, RCLONE_CONFIG: CONF });

/** Runs rclone; resolves its output, or rejects with what it said went wrong. */
function rc(args, { timeout = +process.env.CLOUD_TIMEOUT_MS || 6 * 3600e3, input } = {}) {
  return new Promise((ok, no) => {
    const p = execFile(BIN(), args, { env: env(), timeout, maxBuffer: 32 * 1024 * 1024 }, (e, out, err) => {
      if (e) { const m = String(err || e.message).split('\n').map(l => l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d (ERROR|NOTICE|CRITICAL|Failed to \w+)?:?\s*/, '').trim()).filter(l => l && !/^Usage:|^\s*rclone |^Flags:|^Use "rclone/.test(l));
        return no(new Error(m.find(l => /error|fail|denied|invalid|forbidden|expired|not found/i.test(l)) || m[0] || 'rclone failed')); }
      ok(String(out));
    });
    if (input != null) { p.stdin.end(input); }
  });
}

/** Settings as stored: { on, type, folder, keep, account, last }. */
function clean(b = {}, o = {}) {
  const type = TYPES[b.type] ? b.type : TYPES[o.type] ? o.type : '';
  return { on: type ? ('on' in b ? !!b.on : !!o.on) : false, type, connected: type === o.type ? !!o.connected : false,
    folder: (cut(b.folder != null ? b.folder : o.folder, 120) || 'GoatMediaStackarr').replace(/^\/+|\/+$/g, '').replace(/\.\.+/g, '.'),
    keep: Math.min(60, Math.max(1, Math.round(+(b.keep != null ? b.keep : o.keep) || 7))), account: type === o.type ? o.account || '' : '', last: o.last || null };
}
function problem(c) {
  if (!c.type) return 'Pick Google Drive, OneDrive or iCloud Drive';
  if (!c.connected) return `Connect ${TYPES[c.type]} first`;
  return '';
}

// ---- The config file (one remote, written here; rclone renews its tokens in it).
function writeRemote(fields) {
  const body = `[${REMOTE}]\n` + Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n';
  fs.mkdirSync(path.dirname(CONF), { recursive: true });
  fs.writeFileSync(CONF, body, { mode: 0o600 });
}
function forget() { try { fs.unlinkSync(CONF); } catch {} }

// ---- Google Drive and OneDrive: the sign-in helper.
let auth = null;   // { type, proc, out, url, at }
function stopAuth() { if (auth && auth.proc && auth.proc.exitCode == null) try { auth.proc.kill(); } catch {} auth = null; }

/** Starts signing in; resolves the provider's page to open. */
async function authStart(type) {
  if (!['drive', 'onedrive'].includes(type)) throw new Error('Pick Google Drive or OneDrive');
  stopAuth();
  // Google: only the files rclone makes (drive.file), not the whole Drive.
  const args = ['authorize', type, ...(type === 'drive' ? [Buffer.from(JSON.stringify({ scope: 'drive.file' })).toString('base64url')] : []), '--auth-no-open-browser'];
  const proc = spawn(BIN(), args, { env: env() }), a = auth = { type, proc, out: '', at: Date.now(), done: null };
  const take = d => { a.out += String(d); };
  proc.stdout.on('data', take); proc.stderr.on('data', take);
  a.done = new Promise(r => proc.on('close', () => r()));
  setTimeout(() => { if (auth === a) stopAuth(); }, 15 * 60e3).unref();
  // Its local page says where to go: follow it once to get the provider's own address.
  for (let i = 0; i < 60; i++) {
    const m = /http:\/\/127\.0\.0\.1:\d+\/auth\?state=[\w-]+/.exec(a.out);
    if (m) {
      const r = await fetch(m[0], { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const to = r.headers.get('location'); if (!to) throw new Error('rclone did not give a sign-in page');
      a.url = to; return { url: to };
    }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  stopAuth(); throw new Error('rclone did not start signing in: ' + cut(a.out.split('\n').filter(Boolean).pop(), 200));
}

/** Finishes signing in with the address the provider sent the browser to. Resolves { account }. */
async function authFinish(pasted) {
  const a = auth; if (!a) throw new Error('Start connecting again: that sign-in timed out');
  let u; try { u = new URL(String(pasted).trim()); } catch { throw new Error('Paste the whole address from the address bar (it starts with http://127.0.0.1 or http://localhost)'); }
  const q = u.searchParams;
  if (q.get('error')) { stopAuth(); throw new Error(`${TYPES[a.type]} said: ${q.get('error_description') || q.get('error')}`); }
  if (!q.get('code') || !q.get('state')) throw new Error('That address has no sign-in code in it. Copy the address of the page you were sent to after allowing access');
  await fetch(`http://127.0.0.1:${AUTH_PORT()}/?${q.toString()}`, { signal: AbortSignal.timeout(20000) }).catch(() => {});
  await Promise.race([a.done, new Promise(r => setTimeout(r, 30000))]);
  const m = /--->\s*([\s\S]*?)\s*<---End paste/.exec(a.out); stopAuth();
  if (!m) throw new Error(`${TYPES[a.type]} did not finish signing in: ` + cut((a.out.split('\n').filter(l => /error|fail/i.test(l)).pop() || '').replace(/^.*?(ERROR|NOTICE|Fatal error):?\s*/, ''), 200));
  const token = m[1].trim(); let tok; try { tok = JSON.parse(token); } catch { throw new Error('rclone gave a token that could not be read'); }
  if (a.type === 'drive') { writeRemote({ type: 'drive', scope: 'drive.file', token }); return { account: 'Google Drive' }; }
  // OneDrive: which drive is theirs (rclone's own setup asks the same of Microsoft).
  const g = await fetch('https://graph.microsoft.com/v1.0/me/drive', { headers: { Authorization: 'Bearer ' + tok.access_token }, signal: AbortSignal.timeout(15000) });
  const d = await g.json().catch(() => ({}));
  if (!g.ok || !d.id) throw new Error('OneDrive did not say which drive is yours' + (d.error ? ': ' + (d.error.message || d.error.code) : ''));
  writeRemote({ type: 'onedrive', token, drive_id: d.id, drive_type: d.driveType || 'personal' });
  return { account: (d.owner && d.owner.user && (d.owner.user.email || d.owner.user.displayName)) || 'OneDrive' };
}

// ---- iCloud Drive: rclone's own steps, one answer at a time.
const parse = s => { try { return JSON.parse(s); } catch { return {}; } };
async function icloudStart(appleId, password) {
  if (!/^\S+@\S+$/.test(String(appleId || '').trim()) || !password) throw new Error('Enter your Apple ID (its email) and password');
  forget();
  const out = parse(await rc(['config', 'create', REMOTE, 'iclouddrive', 'apple_id=' + String(appleId).trim(), 'password=' + password, '--non-interactive', '--obscure'], { timeout: 60000 }));
  if (out.Error) throw new Error(out.Error);
  if (out.State && out.Option) return { need: 'code', state: out.State };
  return { account: String(appleId).trim() };
}
async function icloudCode(state, code) {
  if (!/^\d{6}$/.test(String(code || '').trim())) throw new Error('Enter the 6-digit code Apple shows on your iPhone, iPad or Mac');
  const out = parse(await rc(['config', 'update', REMOTE, '--continue', '--state', String(state), '--result', String(code).trim(), '--non-interactive'], { timeout: 60000 }));
  if (out.Error) throw new Error(out.Error);
  if (out.State && out.Option) return { need: 'code', state: out.State };
  return { ok: true };
}

// ---- Copying, listing, removing.
const where = (c, name = '') => `${REMOTE}:${[c.folder, name].filter(Boolean).join('/')}`;
async function put(c, file, name) { await rc(['copyto', file, where(c, name), '--retries', '3']); }
async function list(c) {
  const l = parse(await rc(['lsjson', where(c), '--files-only'], { timeout: 120000 }).catch(e => { if (/not found|doesn't exist|directory not found/i.test(e.message)) return '[]'; throw e; }));
  return (Array.isArray(l) ? l : []).map(x => ({ name: x.Name, size: x.Size, at: Date.parse(x.ModTime) || 0 }));
}
async function del(c, name) { await rc(['deletefile', where(c, name)], { timeout: 120000 }); }

/** Copies one backup and keeps only the newest of each kind (GoatMediaStackarr's own, the stack's). */
async function send(c, file, name) {
  await put(c, file, name);
  const kind = n => /^stack-/.test(n) ? 'stack' : 'goat', mine = n => /\.(json|tar|tgz|tar\.gz|zip)(\.enc)?$/i.test(n);
  const l = (await list(c)).filter(x => mine(x.name) && kind(x.name) === kind(name)).sort((a, b) => b.name.localeCompare(a.name));
  const gone = []; for (const x of l.slice(c.keep)) { try { await del(c, x.name); gone.push(x.name); } catch {} }
  return { name, removed: gone };
}
/** Writes a small file and removes it again. */
async function test(c) {
  const f = path.join(path.dirname(CONF), '.goat-cloud-test.txt'); fs.writeFileSync(f, 'GoatMediaStackarr can write here.\n');
  const n = `.goat-test-${Date.now()}.txt`;
  try { await put(c, f, n); await del(c, n); } finally { try { fs.unlinkSync(f); } catch {} }
  return true;
}

module.exports = { TYPES, clean, problem, setConfDir, conf, authStart, authFinish, stopAuth, icloudStart, icloudCode, forget, put, list, del, send, test, writeRemote };
