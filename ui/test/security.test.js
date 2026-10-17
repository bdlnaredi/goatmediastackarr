const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { tmp, sleep, boot, client, setup } = require('./helpers');
const totp = require('../lib/totp');

test('two-step sign-in: set up, sign in with a code, recovery codes work once, wrong codes are limited', async () => {
  const s = await boot();
  try {
    const c = client(s.base); await setup(c);
    const st = (await c.post('/api/2fa/start')).data; assert.match(st.secret, /^[A-Z2-7]{32}$/); assert.match(st.uri, /^otpauth:\/\//);
    assert.equal((await c.post('/api/2fa/enable', { code: '000000' })).status, 400, 'a wrong code does not turn it on');
    const en = await c.post('/api/2fa/enable', { code: totp.totp(st.secret) }); assert.equal(en.status, 200); assert.equal(en.data.recovery.length, 8);
    assert.equal((await c.get('/api/me')).data.user.twofa, true);
    const raw = fs.readFileSync(path.join(s.dir, 'db.json'), 'utf8');
    assert.ok(!raw.includes(st.secret), 'the secret is encrypted on disk');
    for (const x of en.data.recovery) assert.ok(!raw.includes(x), 'recovery codes are only stored as hashes');
    // password alone no longer signs in
    const c2 = client(s.base); const l1 = await c2.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal(l1.data.twofa, true); assert.ok(l1.data.ticket); assert.equal((await c2.get('/api/me')).data.user, null, 'no session before the code');
    assert.equal((await c2.post('/api/login/2fa', { ticket: l1.data.ticket, code: '123456' })).status, 401);
    // a code can only be used once
    const code = totp.totp(st.secret, Date.now() + 30000);
    assert.equal((await c2.post('/api/login/2fa', { ticket: l1.data.ticket, code })).status, 200);
    assert.equal((await c2.get('/api/me')).data.user.name, 'admin');
    const c3 = client(s.base), l2 = await c3.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await c3.post('/api/login/2fa', { ticket: l2.data.ticket, code })).status, 401, 'the same code is refused the second time');
    // recovery code: works once
    const rc = en.data.recovery[0], l3 = await c3.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await c3.post('/api/login/2fa', { ticket: l3.data.ticket, code: rc })).status, 200);
    const c4 = client(s.base), l4 = await c4.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await c4.post('/api/login/2fa', { ticket: l4.data.ticket, code: rc })).status, 401, 'a recovery code only works once');
    // a ticket stops working after 5 wrong tries
    const c5 = client(s.base), l5 = await c5.post('/api/login', { name: 'admin', password: 'correct-horse' });
    for (let i = 0; i < 5; i++) await c5.post('/api/login/2fa', { ticket: l5.data.ticket, code: '000000' });
    assert.equal((await c5.post('/api/login/2fa', { ticket: l5.data.ticket, code: totp.totp(st.secret, Date.now() + 60000) })).status, 401, 'ticket was cancelled');
    // turning it off needs password and a code
    assert.equal((await c.post('/api/2fa/disable', { password: 'wrong', code: en.data.recovery[1] })).status, 400);
    assert.equal((await c.post('/api/2fa/disable', { password: 'correct-horse', code: en.data.recovery[1] })).status, 200);
    assert.equal((await client(s.base).post('/api/login', { name: 'admin', password: 'correct-horse' })).data.user.name, 'admin');
  } finally { await s.stop(); }
});

test('an admin can switch off another person\'s two-step sign-in, and regular profiles cannot', async () => {
  const s = await boot();
  try {
    const a = client(s.base); await setup(a);
    const kid = (await a.post('/api/users', { name: 'kid', password: 'kid-password-1' })).data;
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    const st = (await k.post('/api/2fa/start')).data; await k.post('/api/2fa/enable', { code: totp.totp(st.secret) });
    assert.equal((await client(s.base).post('/api/login', { name: 'kid', password: 'kid-password-1' })).data.twofa, true);
    assert.equal((await k.post(`/api/users/${kid.id}/2fa/reset`)).status, 403);
    assert.equal((await a.post(`/api/users/${kid.id}/2fa/reset`)).status, 200);
    assert.equal((await client(s.base).post('/api/login', { name: 'kid', password: 'kid-password-1' })).data.user.name, 'kid');
  } finally { await s.stop(); }
});

test('read-only status links: secret token, only the chosen sections, can be turned off, guessing is limited', async () => {
  const s = await boot();
  try {
    const a = client(s.base); await setup(a);
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:9', apiKey: 'SECRET-KEY' });
    const link = (await a.post('/api/statuslinks', { name: 'Hallway tablet', apps: true })).data;
    assert.ok(link.token.length >= 30);
    const raw = fs.readFileSync(path.join(s.dir, 'db.json'), 'utf8'); assert.ok(!raw.includes(link.token), 'only a hash of the token is stored');
    const anon = client(s.base);
    const d = (await anon.get('/api/public/' + link.token)).data;
    assert.equal(d.name, 'Hallway tablet'); assert.equal(d.apps[0].name, 'Sonarr');
    assert.ok(!('traffic' in d) && !('downloads' in d) && !('upcoming' in d), 'sections that were not chosen are not shared');
    assert.ok(!JSON.stringify(d).includes('SECRET-KEY') && !JSON.stringify(d).includes('127.0.0.1'), 'no keys or addresses');
    const page = await fetch(s.base + '/s/' + link.token); assert.equal(page.status, 200); assert.match(await page.text(), /Status/);
    assert.equal((await anon.get('/api/statuslinks')).status, 401, 'the management list needs sign-in');
    assert.equal((await a.del('/api/statuslinks/' + link.id)).status, 200);
    assert.equal((await anon.get('/api/public/' + link.token)).status, 404);
    let last; for (let i = 0; i < 31; i++) last = await anon.get('/api/public/' + 'x'.repeat(30) + i);
    assert.equal(last.status, 429, 'guessing tokens is rate limited');
  } finally { await s.stop(); }
});

test('alert channels: several at once, secrets stay hidden, old single setting is upgraded', async () => {
  const hits = [];
  const mock = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { hits.push({ url: req.url, body: b }); res.end('ok'); }); });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.address().port, dir = tmp();
  // an old-style database with the single channel format
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], services: [], alerts: { type: 'ntfy', target: base + '/old-topic', token: '', chat: '', finished: true, diskPct: 85 } }));
  const s = await boot({}, dir);
  try {
    const a = client(s.base); await setup(a);
    const al = (await a.get('/api/alerts')).data;
    assert.equal(al.channels.length, 1); assert.equal(al.channels[0].type, 'ntfy'); assert.equal(al.finished, true); assert.equal(al.diskPct, 85);
    assert.ok(!JSON.stringify(al).includes('old-topic'), 'the address is never sent back to the page');
    assert.equal((await a.post('/api/alerts/channels', { type: 'gotify', target: base, token: 'APP-TOKEN-1' })).status, 200);
    assert.equal((await a.post('/api/alerts/channels', { type: 'ntfy', target: 'not a url' })).status, 400);
    assert.ok(!JSON.stringify((await a.get('/api/alerts')).data).includes('APP-TOKEN-1'));
    assert.ok(!fs.readFileSync(path.join(dir, 'db.json'), 'utf8').includes('APP-TOKEN-1'), 'channel secrets are encrypted on disk');
    const res = (await a.post('/api/alerts/test', {})).data.results; assert.equal(res.length, 2); assert.ok(res.every(r => r.ok));
    assert.ok(hits.some(h => h.url === '/old-topic') && hits.some(h => h.url.startsWith('/message?token=APP-TOKEN-1')));
    const id = (await a.get('/api/alerts')).data.channels[0].id;
    assert.equal((await a.put('/api/alerts/channels/' + id, { type: 'ntfy', target: base + '/new-topic' })).status, 200);
    hits.length = 0; await a.post('/api/alerts/test', { id }); assert.equal(hits[0].url, '/new-topic');
    assert.equal((await a.del('/api/alerts/channels/' + id)).status, 200); assert.equal((await a.get('/api/alerts')).data.channels.length, 1);
    const k = client(s.base); await a.post('/api/users', { name: 'kid', password: 'kid-password-1' }); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.post('/api/alerts/test', {})).status, 403);
  } finally { await s.stop(); mock.close(); }
});

test('automatic backups: made on schedule, listed, kept to a limit, and restorable without a passphrase', async () => {
  const s = await boot({ MONITOR_MS: '600' });
  try {
    const a = client(s.base); await setup(a);
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: 'http://127.0.0.1:9', apiKey: 'k' });
    assert.equal((await a.put('/api/backups/config', { on: true, keep: 2, hour: 0 })).status, 200);
    for (let i = 0; i < 40 && !(await a.get('/api/backups')).data.files.length; i++) await sleep(300);
    let list = (await a.get('/api/backups')).data; assert.ok(list.files.length >= 1, 'a scheduled backup appeared'); assert.equal(list.cfg.on, true);
    const name = list.files[0].name; assert.match(name, /^auto-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const raw = fs.readFileSync(path.join(s.dir, 'backups', name), 'utf8'); assert.ok(!raw.includes('"apiKey": "k"'), 'secrets inside are encrypted');
    await a.del('/api/services/' + (await a.get('/api/services')).data[0].id); assert.equal((await a.get('/api/services')).data.length, 0);
    assert.equal((await a.post('/api/backups/restore', { name: '../../etc/passwd' })).status, 400);
    assert.equal((await a.post('/api/backups/restore', { name })).status, 200);
    assert.equal((await a.get('/api/me')).data.user, null, 'everyone is signed out after a restore');
    await a.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await a.get('/api/services')).data.length, 1);
    const files = fs.readdirSync(path.join(s.dir, 'backups')); assert.ok(files.some(f => f.startsWith('pre-restore-')), 'a safety copy is made before restoring');
    // limit
    for (let i = 0; i < 4; i++) { await a.post('/api/backups/run'); await sleep(20); }
    assert.ok(fs.readdirSync(path.join(s.dir, 'backups')).filter(f => /^auto-/.test(f) || /^pre-/.test(f)).length <= 2 + 3 + 1, 'old copies are removed');
    const k = client(s.base); await a.post('/api/users', { name: 'kid', password: 'kid-password-1' }); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get('/api/backups')).status, 403);
  } finally { await s.stop(); }
});
