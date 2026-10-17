// Password recovery by email, and the library artwork feed with cached sign-in wallpapers.
// The mail server and the apps are small pretend ones, so these prove MediaHub's own behaviour, not that a real mail provider accepts the message.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net'), http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

function mailServer() {
  const mails = [];
  const srv = net.createServer(sock => {
    let inData = false, buf = '', cur = { to: [], data: '' };
    sock.write('220 test ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString(); let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; mails.push(cur); cur = { to: [], data: '' }; sock.write('250 queued\r\n'); } else cur.data += line + '\n'; continue; }
        if (/^EHLO/.test(line)) sock.write('250 test\r\n');
        else if (/^RCPT TO:<(.*)>/.test(line)) { cur.to.push(line.match(/<(.*)>/)[1]); sock.write('250 ok\r\n'); }
        else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 what\r\n');
      }
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, mails, port: srv.address().port })));
}
const bodyOf = m => { const [, b] = m.data.split('\n\n'); return Buffer.from(b.replace(/\n/g, ''), 'base64').toString(); };

test('forgot password: emails a single-use link, never reveals which names exist, and sign-out follows a reset', async () => {
  const ms = await mailServer(), s = await boot(), a = client(s.base);
  try {
    await setup(a);
    assert.equal((await a.get('/api/me')).data.recovery, false, 'off until email and an address are set up');
    await a.post('/api/alerts/channels', { type: 'email', host: '127.0.0.1', port: ms.port, secure: 'none', from: 'mh@example.com', to: 'owner@example.com' });
    assert.equal((await a.get('/api/me')).data.recovery, true, 'the admin address was learned from the admin sign-in');
    assert.equal((await a.put('/api/me/email', { email: 'owner@example.com', password: 'wrong' })).status, 400);
    assert.equal((await a.put('/api/me/email', { email: 'not an email', password: 'correct-horse' })).status, 400);
    assert.equal((await a.put('/api/me/email', { email: 'owner@example.com', password: 'correct-horse' })).status, 200);
    await a.post('/api/users', { name: 'kid', password: 'kid-password-1', email: 'kid@example.com' });

    const anon = client(s.base);
    const r1 = await anon.post('/api/forgot', { who: 'nobody-here' }), r2 = await anon.post('/api/forgot', { who: 'kid' });
    assert.deepEqual(r1.data, r2.data); assert.equal(r1.status, 200); assert.equal(r2.status, 200);
    await sleep(500);
    assert.equal(ms.mails.length, 1, 'only the real profile got an email');
    assert.deepEqual(ms.mails[0].to, ['kid@example.com']);
    const text = bodyOf(ms.mails[0]), token = (text.match(/#reset=([\w-]+)/) || [])[1];
    assert.ok(token && token.length >= 40, 'the link carries a long secret');
    assert.ok(text.includes(s.base + '/#reset='), 'the secret sits after the # so it never reaches server logs');

    const again = await anon.post('/api/forgot', { who: 'kid@example.com' }); assert.equal(again.status, 200);
    await sleep(300); assert.equal(ms.mails.length, 1, 'no second email within a minute');

    const kid = client(s.base); assert.equal((await kid.post('/api/login', { name: 'kid', password: 'kid-password-1' })).status, 200);
    assert.equal((await anon.post('/api/reset', { token: 'x'.repeat(43), password: 'brand-new-pass' })).status, 400);
    assert.equal((await anon.post('/api/reset', { token, password: 'short' })).status, 400, 'short passwords are refused and the link is kept');
    assert.equal((await anon.post('/api/reset', { token, password: 'brand-new-pass' })).status, 200);
    assert.equal((await anon.post('/api/reset', { token, password: 'another-pass-2' })).status, 400, 'a link works only once');
    assert.equal((await kid.get('/api/services')).status, 401, 'old sessions are signed out');
    assert.equal((await anon.post('/api/login', { name: 'kid', password: 'kid-password-1' })).status, 401);
    assert.equal((await anon.post('/api/login', { name: 'kid', password: 'brand-new-pass' })).status, 200);
    assert.ok(!JSON.stringify((await a.get('/api/users')).data).includes(token), 'the secret is never listed');
  } finally { await s.stop(); ms.srv.close(); }
});

test('forgot password: expired links, rate limits, and a profile without email', async () => {
  const ms = await mailServer(), s = await boot(), a = client(s.base);
  try {
    await setup(a);
    await a.post('/api/alerts/channels', { type: 'email', host: '127.0.0.1', port: ms.port, secure: 'none', from: 'mh@example.com', to: 'x@example.com' });
    await a.get('/api/me');
    const anon = client(s.base);
    await anon.post('/api/forgot', { who: 'admin' }); await sleep(300);
    assert.equal(ms.mails.length, 0, 'a profile with no email gets nothing');
    let last; for (let i = 0; i < 6; i++) last = await anon.post('/api/forgot', { who: 'x' + i });
    assert.equal(last.status, 429);
    for (let i = 0; i < 10; i++) await anon.post('/api/reset', { token: 'bad' + i, password: 'whatever-pass-1' });
    assert.equal((await anon.post('/api/reset', { token: 'bad', password: 'whatever-pass-1' })).status, 429);
    const rec = await a.get('/api/signin'); assert.equal(rec.data.mail, true);
    const b = client(s.base); await b.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await a.put('/api/signin', { publicUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await a.put('/api/signin', { publicUrl: 'https://media.example.com/' })).status, 200);
    assert.equal((await a.get('/api/signin')).data.publicUrl, 'https://media.example.com');
  } finally { await s.stop(); ms.srv.close(); }
});

test('signing in is guarded: only admins change sign-in options', async () => {
  const s = await boot(), a = client(s.base);
  try {
    await setup(a); await a.post('/api/users', { name: 'kid', password: 'kid-password-1' });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get('/api/signin')).status, 403); assert.equal((await k.put('/api/signin', { loginArt: 'scenes' })).status, 403);
    assert.equal((await client(s.base).get('/api/signin')).status, 401);
  } finally { await s.stop(); }
});

test('library artwork: feed for the dashboard, backdrops cached for the sign-in page, and a safe image proxy', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ WP_DELAY_MS: '300' }), a = client(s.base);
  try {
    await setup(a);
    assert.deepEqual((await client(s.base).get('/api/wallpapers')).data, [], 'nothing before an app is connected');
    const sid = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    const art = (await a.get('/api/artwork')).data;
    assert.ok(art.hero.length >= 4 && art.recent.length && art.top[0].rating >= art.top[art.top.length - 1].rating);
    assert.ok(art.hero.every(x => x.fanart && x.title && !('fl' in x)), 'every hero has a backdrop');
    assert.equal(art.shows, 6); assert.equal(art.movies, 6);
    assert.equal((await client(s.base).get('/api/artwork')).status, 401, 'artwork needs a sign-in');
    let list = []; for (let i = 0; i < 40 && list.length < 4; i++) { await a.get('/api/artwork'); await sleep(250); list = (await client(s.base).get('/api/wallpapers')).data; }
    assert.ok(list.length >= 4 && list.every(f => /^lib-[0-9a-f]{10}\.jpg$/.test(f)), 'backdrops were saved: ' + JSON.stringify(list));
    const img = await fetch(s.base + '/wallpapers/' + list[0]); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.ok(!JSON.stringify(list).match(/Harbor|Glass|Orbit/), 'no titles are exposed to signed-out visitors');
    assert.equal((await a.put('/api/signin', { loginArt: 'scenes' })).status, 200);
    assert.deepEqual((await client(s.base).get('/api/wallpapers')).data, [], 'switching to the built-in scenes hides them');
    assert.equal((await a.get('/api/artimg?sid=' + sid + '&p=' + encodeURIComponent('/MediaCover/1/fanart.jpg'))).status, 200);
    for (const bad of ['/../secret', '/MediaCover/../x', '/api/v3/series', '/MediaCover/%2e%2e/x'])
      assert.equal((await a.get('/api/artimg?sid=' + sid + '&p=' + encodeURIComponent(bad))).status, 404, bad);
  } finally { await s.stop(); srv.close(); }
});

test('sign-in pictures: works with a URL base, covers that only accept the key in the address, a late-starting app, and reports what went wrong', async () => {
  // A stricter pretend Sonarr: lives under /sonarr, answers 401 to the header on covers, and is "down" for the first few requests.
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6000, 7)]);
  let up = false;
  const series = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: 'Show ' + i, year: 2020, images: [{ coverType: 'poster', url: `/sonarr/MediaCover/${i + 1}/poster.jpg?lastWrite=1` }, { coverType: 'fanart', url: `/sonarr/MediaCover/${i + 1}/fanart.jpg?lastWrite=1`, remoteUrl: 'http://not-https.invalid/x.jpg' }], statistics: {} }));
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!up) { res.writeHead(503); return res.end('{}'); }
    if (u.pathname === '/sonarr/api/v3/series') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(series)); }
    if (/^\/sonarr\/MediaCover\/\d+\/fanart\.jpg$/.test(u.pathname) && u.searchParams.get('apikey') === 'k') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpg); }
    res.writeHead(401); res.end();
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({ WP_DELAY_MS: '200' }), a = client(s.base);
  try {
    await setup(a);
    assert.equal((await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `http://127.0.0.1:${srv.address().port}/sonarr`, apiKey: 'k' })).status, 200);
    await sleep(900);
    const bad = (await a.post('/api/signin/refresh')).data;
    assert.equal(bad.ok, false); assert.ok(bad.errors.length && /Sonarr/.test(bad.errors[0]), 'says which app failed: ' + JSON.stringify(bad.errors));
    assert.ok(!JSON.stringify(bad).includes('apikey'), 'the key never appears in messages');
    up = true;
    const good = (await a.post('/api/signin/refresh')).data;
    assert.equal(good.ok, true, JSON.stringify(good)); assert.ok(good.count >= 4, 'count ' + good.count);
    const list = (await client(s.base).get('/api/wallpapers')).data;
    assert.ok(list.length >= 4); assert.equal((await fetch(s.base + '/wallpapers/' + list[0])).status, 200);
    const info = (await a.get('/api/signin')).data; assert.equal(info.cached, list.length); assert.ok(info.wp.at > 0);
    assert.equal((await client(s.base).post('/api/signin/refresh')).status, 401, 'signed-out people cannot trigger it');
  } finally { await s.stop(); srv.close(); }
});
