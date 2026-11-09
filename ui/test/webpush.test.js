// Push notifications for the web app: the bell's items reach the person's browsers, encrypted for each, signed by the server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), crypto = require('node:crypto');
const WP = require('../lib/webpush');
const { boot, client, setup, sleep } = require('./helpers');

// A pretend browser: its own key pair and auth secret, as a real one makes when it subscribes.
const browser = () => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { priv: e.getPrivateKey(), keys: { p256dh: WP.b64u(e.getPublicKey()), auth: WP.b64u(crypto.randomBytes(16)) } }; };

test('encrypting and signing follow the standard', () => {
  const b = browser(), body = WP.encrypt('{"title":"Hi"}', b.keys);
  assert.equal(body.readUInt32BE(16), 4096); assert.equal(body[20], 65);
  assert.equal(WP.decrypt(body, b.priv, WP.unb64u(b.keys.auth)), '{"title":"Hi"}');
  const k = WP.keys(), h = WP.vapid('https://fcm.googleapis.com/fcm/send/abc', k, 'mailto:a@b.c');
  const [, jwt, pub] = h.match(/^vapid t=([^,]+), k=(.+)$/); assert.equal(pub, k.pub);
  const [hd, cl, sig] = jwt.split('.'), claims = JSON.parse(WP.unb64u(cl));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, 'mailto:a@b.c');
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), WP.unb64u(k.pub)]), format: 'der', type: 'spki' });
  assert.ok(crypto.verify('sha256', Buffer.from(hd + '.' + cl), { key, dsaEncoding: 'ieee-p1363' }, WP.unb64u(sig)), 'the signature checks out with the public key');
});

test('the bell reaches the browser; a browser that unsubscribed is forgotten', async () => {
  const got = []; let gone = false;
  const ps = http.createServer(async (req, res) => { const c = []; for await (const x of req) c.push(x); got.push({ url: req.url, h: req.headers, body: Buffer.concat(c) }); res.writeHead(gone ? 410 : 201); res.end(); }).listen(0);
  await new Promise(r => ps.once('listening', r));
  const s = await boot({ PUSH_TEST: '1' }), a = client(s.base); await setup(a);
  try {
    const key = (await a.get('/api/push')).data.key; assert.equal(WP.unb64u(key).length, 65);
    const b = browser(), ep = `http://127.0.0.1:${ps.address().port}/push/one`;
    assert.equal((await a.post('/api/push/subscribe', { endpoint: 'ftp://x', keys: b.keys })).status, 400);
    assert.equal((await a.post('/api/push/subscribe', { endpoint: ep, keys: b.keys })).status, 200);
    assert.equal((await a.get('/api/push')).data.devices.length, 1);
    await a.post('/api/notifications/test');
    for (let i = 0; i < 40 && !got.length; i++) await sleep(50);
    assert.equal(got.length, 1); const g = got[0];
    assert.equal(g.h['content-encoding'], 'aes128gcm'); assert.match(g.h.authorization, new RegExp('^vapid t=.+, k=' + key + '$'));
    const m = JSON.parse(WP.decrypt(g.body, b.priv, WP.unb64u(b.keys.auth)));
    assert.equal(m.title, 'Notifications work'); assert.equal(m.url, '/');
    // A message for admins reaches admins' browsers only; another person's does not.
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    await k.post('/api/notifications/test'); await sleep(300);
    assert.equal(got.length, 1, 'Sam has no browser subscribed, so nothing for the admin\'s');
    // The push service says the browser is gone: forgotten.
    gone = true; await a.post('/api/notifications/test');
    for (let i = 0; i < 40 && (await a.get('/api/push')).data.devices.length; i++) await sleep(50);
    assert.equal((await a.get('/api/push')).data.devices.length, 0);
  } finally { await s.stop(); ps.close(); }
});
