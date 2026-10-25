// "Ready for you" emails: what lands from someone's requests or watchlist is emailed, several in one, only when they turned it on.
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
test('ready emails are opt-in and batched', async () => {
  const msv = await mailServer(), fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '150', READY_MAIL_MS: '400' }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/alerts/channels', { type: 'email', host: '127.0.0.1', port: msv.port, secure: 'none', from: 'mh@example.com', to: 'owner@example.com' });
    for (const n of ['ann', 'bob']) await a.post('/api/users', { name: n, password: n.repeat(4), role: 'user', email: n + '@example.com' });
    const ann = client(s.base); await ann.post('/api/login', { name: 'ann', password: 'annannannann' });
    const bob = client(s.base); await bob.post('/api/login', { name: 'bob', password: 'bobbobbobbob' });
    assert.equal((await ann.put('/api/me/readymail', { on: true })).data.readyMail, true);
    assert.equal((await ann.get('/api/me')).data.user.readyMail, true);
    // Both put two movies on their watchlist before Radarr is connected; then they arrive.
    for (const c of [ann, bob]) for (const [id, t] of [[5001, 'Glass Meridian'], [5002, 'Salt & Ember']]) await c.post('/api/watchlist', { type: 'movie', id, title: t });
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    for (let i = 0; i < 80 && !msv.mails.some(m => m.to[0] === 'ann@example.com'); i++) await sleep(150);
    const mine = msv.mails.filter(m => m.to[0] === 'ann@example.com');
    assert.equal(mine.length, 1, 'one email for both'); assert.match(mine[0].data, /Subject: 2 things are ready for you/);
    assert.ok(!msv.mails.some(m => m.to[0] === 'bob@example.com'), 'bob did not turn it on');
  } finally { await s.stop(); srv.close(); msv.srv.close(); }
});
