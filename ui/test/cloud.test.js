// Backups copied to Google Drive, OneDrive or iCloud Drive, through rclone (a pretend one here, with a folder as the
// cloud): connecting each way, copying, keeping the newest few, and disconnecting.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup } = require('./helpers');
const FAKE = path.join(__dirname, 'fixtures', 'fake-rclone.js');

test('Google Drive: connect with the pasted address, copy backups, keep the newest, disconnect', async () => {
  const dir = tmp(), cloud = path.join(dir, 'cloud'); fs.mkdirSync(cloud);
  const s = await boot({ RCLONE_BIN: FAKE, FAKE_CLOUD: cloud, CLOUD_AUTH_PORT: '53791' }, dir), a = client(s.base); await setup(a);
  try {
    let c = (await a.get('/api/cloud')).data; assert.equal(c.connected, false); assert.deepEqual(Object.keys(c.types), ['drive', 'onedrive', 'iclouddrive']);
    assert.equal((await a.put('/api/cloud', { on: true })).status, 400, 'nothing connected yet');
    const st = (await a.post('/api/cloud/connect', { type: 'drive', step: 'start' })).data;
    assert.match(st.url, /^https:\/\/accounts\.example\/o\/oauth2\/auth\?state=st\d+&scope=drive\.file$/, 'only the files it makes');
    const state = new URL(st.url).searchParams.get('state');
    assert.equal((await a.post('/api/cloud/connect', { type: 'drive', step: 'finish', url: 'not an address' })).status, 400);
    assert.equal((await a.post('/api/cloud/connect', { type: 'drive', step: 'finish', url: 'http://127.0.0.1:53682/?state=x' })).status, 400, 'no code in it');
    // A reload or a second press reuses the sign-in that is waiting, and the page shows it again.
    assert.equal((await a.post('/api/cloud/connect', { type: 'drive', step: 'start' })).data.url, st.url, 'the same sign-in');
    assert.deepEqual((await a.get('/api/cloud')).data.pending, { type: 'drive', url: st.url });
    // A used-up code says so; pressing Open sign-in again is all it takes.
    const bad = await a.post('/api/cloud/connect', { type: 'drive', step: 'finish', url: `127.0.0.1:53682/?state=${state}&code=bad` });
    assert.equal(bad.status, 400); assert.match(bad.data.error, /used up or too old/);
    // The helper has gone (as after a restart): an address with an old state, without http://, still connects.
    const fin = await a.post('/api/cloud/connect', { type: 'drive', step: 'finish', url: `  127.0.0.1:53682/?state=old-one&code=4/abc&scope=x ` });
    assert.equal(fin.status, 200, JSON.stringify(fin.data)); assert.equal(fin.data.connected, true); assert.equal(fin.data.on, true);
    const conf = fs.readFileSync(path.join(s.dir, 'rclone.conf'), 'utf8'); assert.match(conf, /type = drive/); assert.match(conf, /scope = drive\.file/); assert.match(conf, /"refresh_token":"rt"/);
    assert.equal((fs.statSync(path.join(s.dir, 'rclone.conf')).mode & 0o777), 0o600, 'only readable by this app');
    assert.equal((await a.put('/api/cloud', { on: true, folder: 'Goat', keep: 2 })).status, 200);
    assert.equal((await a.post('/api/cloud/test')).status, 200);
    fs.mkdirSync(path.join(cloud, 'Goat'), { recursive: true });
    for (const n of ['auto-2026-01-01-0100.json', 'auto-2026-02-01-0100.json', 'stack-2026-01-01.tar.gz', 'my-notes.txt']) fs.writeFileSync(path.join(cloud, 'Goat', n), 'old');
    const r = await a.post('/api/cloud/now'); assert.equal(r.status, 200, JSON.stringify(r.data));
    const left = fs.readdirSync(path.join(cloud, 'Goat')).sort();
    assert.equal(left.length, 4, left.join(', ')); assert.ok(left.includes('auto-2026-02-01-0100.json') && !left.includes('auto-2026-01-01-0100.json'), 'the newest two of its own kind: ' + left.join(', '));
    assert.ok(left.includes('stack-2026-01-01.tar.gz') && left.includes('my-notes.txt'), 'other files are left alone');
    c = (await a.get('/api/cloud')).data; assert.equal(c.last.ok, true);
    assert.equal((await a.post('/api/cloud/disconnect')).status, 200);
    assert.ok(!fs.existsSync(path.join(s.dir, 'rclone.conf'))); assert.equal((await a.get('/api/cloud')).data.connected, false);
    // A helper left over from before a restart (here: one started by hand) is stopped, so the port is free again.
    const { spawn } = require('node:child_process');
    const stale = spawn(FAKE, ['authorize', 'drive'], { env: { ...process.env, CLOUD_AUTH_PORT: '53791' } });
    await new Promise(r => stale.stderr.once('data', r));
    // Only the code, pasted with no sign-in running at all.
    const only = await a.post('/api/cloud/connect', { type: 'drive', step: 'finish', url: '4%2F0AbCdEfGhIjK' });
    assert.equal(only.status, 200, JSON.stringify(only.data)); assert.equal(only.data.connected, true);
    assert.notEqual(stale.exitCode ?? stale.signalCode, null, 'the leftover helper was stopped');
  } finally { await s.stop(); }
});

test('the pasted address is read however it was copied', () => {
  const { readPaste } = require('../lib/cloud');
  for (const t of ['http://127.0.0.1:53682/?state=s&code=4/0Ab-c_d&scope=x', '127.0.0.1:53682/?code=4%2F0Ab-c_d&state=s', '"http://localhost:53682/?code=4/0Ab-c_d&state=s"', '?state=s&code=4/0Ab-c_d', 'code=4/0Ab-c_d', '4/0Ab-c_d1234', '4%2F0Ab-c_d1234'])
    assert.match(readPaste(t).code, /^4\/0Ab-c_d/, t);
  assert.equal(readPaste('http://127.0.0.1:53682/?state=s&error=access_denied').error, 'access_denied');
  for (const t of ['', 'http://127.0.0.1:53682/?state=s', 'https://accounts.google.com/o/oauth2/auth', 'hello there']) assert.throws(() => readPaste(t), t);
});

test('iCloud Drive: Apple ID, then the code; an old S3 or WebDAV setting is shown as gone', async () => {
  const dir = tmp(), cloud = path.join(dir, 'cloud'); fs.mkdirSync(cloud);
  const s = await boot({ RCLONE_BIN: FAKE, FAKE_CLOUD: cloud }, dir), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.post('/api/cloud/connect', { type: 'iclouddrive', step: 'start', appleId: 'nope', password: 'x' })).status, 400);
    const r1 = (await a.post('/api/cloud/connect', { type: 'iclouddrive', step: 'start', appleId: 'me@icloud.com', password: 'pw' })).data;
    assert.equal(r1.need, 'code');
    assert.equal((await a.post('/api/cloud/connect', { type: 'iclouddrive', step: 'code', state: r1.state, code: '12' })).status, 400, 'six digits');
    const wrong = (await a.post('/api/cloud/connect', { type: 'iclouddrive', step: 'code', state: r1.state, code: '000000' }));
    assert.equal(wrong.status, 400);
    const ok = (await a.post('/api/cloud/connect', { type: 'iclouddrive', step: 'code', state: r1.state, code: '123456', appleId: 'me@icloud.com' })).data;
    assert.equal(ok.connected, true); assert.equal(ok.account, 'me@icloud.com'); assert.equal(ok.type, 'iclouddrive');
    assert.equal((await a.post('/api/cloud/now')).status, 200); assert.equal(fs.readdirSync(path.join(cloud, 'GoatMediaStackarr')).length, 1);
  } finally { await s.stop(); }
  // A setting from before (S3) comes back off, saying so.
  const d2 = tmp(); fs.writeFileSync(path.join(d2, 'db.json'), JSON.stringify({ users: [], services: [], settings: { cloud: { on: true, type: 's3', bucket: 'b' } } }));
  const s2 = await boot({ RCLONE_BIN: FAKE }, d2), b = client(s2.base); await setup(b);
  try { const c = (await b.get('/api/cloud')).data; assert.equal(c.on, false); assert.equal(c.old, 's3'); assert.equal(c.connected, false); } finally { await s2.stop(); }
});

test('Google Drive in one tap: Google sends you back (through the forwarding page) and it is connected', async () => {
  const http = require('node:http'), crypto = require('node:crypto'), { free } = require('./helpers');
  const seen = [], gport = await free();
  const google = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
    const f = new URLSearchParams(b); seen.push(f);
    const want = seen.challenge, got = crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
    if (f.get('code') !== 'good' || got !== want || f.get('client_secret') !== 'shh' || f.get('redirect_uri') !== 'https://relay.example/signin/') { r.writeHead(400); return r.end(JSON.stringify({ error: 'invalid_grant' })); }
    const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'me@gmail.com' })).toString('base64url') + '.y';
    r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ access_token: 'at', refresh_token: 'rt1', expires_in: 3599, token_type: 'Bearer', id_token: idt }));
  }); }).listen(gport, '127.0.0.1');
  const dir = tmp(), s = await boot({ RCLONE_BIN: FAKE, GOOGLE_CLIENT_ID: 'goat.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh', GOOGLE_RELAY_URL: 'https://relay.example/signin/',
    GOOGLE_AUTH_URL: 'https://accounts.example/auth', GOOGLE_TOKEN_URL: `http://127.0.0.1:${gport}/token` }, dir), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.get('/api/cloud')).data.oneTap, true);
    const st = (await a.post('/api/cloud/connect', { type: 'drive', step: 'start', back: 'http://192.168.1.5:2806' })).data;
    assert.equal(st.oneTap, true);
    const g = new URL(st.url), q = g.searchParams; seen.challenge = q.get('code_challenge');
    assert.equal(g.origin + g.pathname, 'https://accounts.example/auth');
    assert.equal(q.get('client_id'), 'goat.apps.googleusercontent.com'); assert.equal(q.get('redirect_uri'), 'https://relay.example/signin/');
    assert.match(q.get('scope'), /auth\/drive\.file/); assert.doesNotMatch(q.get('scope'), /auth\/drive( |$)/, 'only the files it makes');
    assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('access_type'), 'offline');
    const state = q.get('state');
    assert.equal(JSON.parse(Buffer.from(state, 'base64url')).r, 'http://192.168.1.5:2806/api/cloud/google/return', 'the forwarding page sends you back here');
    // Back from Google: no session cookie comes along.
    const ret = u => fetch(s.base + '/api/cloud/google/return?' + new URLSearchParams(u)).then(async r => ({ status: r.status, text: await r.text() }));
    assert.match((await ret({ state: 'made-up', code: 'good' })).text, /not connected[\s\S]*has ended/, 'only a state this server made');
    assert.match((await ret({ state, error: 'access_denied' })).text, /did not allow access/);
    const ok = await ret({ state, code: 'good' });
    assert.match(ok.text, /Google Drive connected/, ok.text); assert.match(ok.text, /location\.replace\("\/settings\/backup"\)/);
    const conf = fs.readFileSync(path.join(s.dir, 'rclone.conf'), 'utf8');
    assert.match(conf, /client_id = goat\.apps\.googleusercontent\.com/); assert.match(conf, /client_secret = shh/); assert.match(conf, /scope = drive\.file/); assert.match(conf, /"refresh_token":"rt1"/);
    const c = (await a.get('/api/cloud')).data; assert.equal(c.connected, true); assert.equal(c.on, true); assert.equal(c.account, 'me@gmail.com');
    assert.match((await ret({ state, code: 'good' })).text, /already used/, 'a state works once');
    // Without the app's ID in the image, connecting Google Drive is the pasted address, as before.
  } finally { await s.stop(); google.close(); }
  const s2 = await boot({ RCLONE_BIN: FAKE, CLOUD_AUTH_PORT: '53792' }), b = client(s2.base); await setup(b);
  try {
    assert.equal((await b.get('/api/cloud')).data.oneTap, false);
    const st = (await b.post('/api/cloud/connect', { type: 'drive', step: 'start', back: 'http://192.168.1.5:2806' })).data;
    assert.match(st.url, /^https:\/\/accounts\.example\/o\/oauth2\/auth\?state=st/); assert.equal(st.oneTap, undefined);
  } finally { await s2.stop(); }
});
