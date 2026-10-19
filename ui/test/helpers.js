// Shared helpers for the end-to-end tests.
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');

const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mediahub-test-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(env = {}, dir = tmp()) {
  const port = await free(), log = [];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), TRUST_PROXY: '', SETUP_TOKEN: '', DEMO: '', RELEASES_URL: 'http://127.0.0.1:9/no-github-in-tests', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => log.push(String(d))); child.stderr.on('data', d => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80 && child.exitCode === null; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await sleep(100); }
  return { base, dir, child, log: () => log.join(''), stop: () => new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}

function client(base) {
  const c = { base, cookie: '' };
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(c.base + url, { method, headers: { 'Content-Type': 'application/json', ...(c.cookie ? { Cookie: c.cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const x of sc) { if (x.startsWith('sid=')) c.cookie = /Max-Age=0/i.test(x) ? '' : x.split(';')[0]; }
    let data = null; const txt = await r.text(); try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: r.status, data, headers: r.headers };
  };
  return Object.assign(c, { get: (u, h) => call('GET', u, null, h), post: (u, b, h) => call('POST', u, b, h), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) });
}
const setup = async (c, name = 'admin', password = 'correct-horse') => c.post('/api/setup', { name, password });
module.exports = { free, tmp, sleep, boot, client, setup };
