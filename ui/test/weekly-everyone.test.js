// The weekly email for everyone: each person with an email gets their own week, and can turn it off.
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
const textOf = m => { const parts = m.data.split(/\n--[^\n]+\n/); const p = parts.find(x => /text\/plain/.test(x)) || m.data; const b = p.split('\n\n').slice(1).join('\n\n'); try { return Buffer.from(b.replace(/\n/g, ''), 'base64').toString(); } catch { return b; } };

test('weekly email: own week for each person with an email, kids filtered, opt-out respected', async () => {
  const msv = await mailServer(), fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '150' }), a = client(s.base); await setup(a);
  try {
    const rid = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    const sid = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' })).data.id;
    await a.post('/api/alerts/channels', { type: 'email', host: '127.0.0.1', port: msv.port, secure: 'none', from: 'mh@example.com', to: 'owner@example.com' });
    for (const [n, e] of [['kid', 'kid@example.com'], ['bob', 'bob@example.com'], ['carl', '']]) await a.post('/api/users', { name: n, password: n.repeat(4), role: 'user', email: e });
    const us = (await a.get('/api/users')).data, id = n => us.find(u => u.name === n).id;
    for (const n of ['kid', 'bob', 'carl']) await a.put(`/api/users/${id(n)}/access`, { access: [rid, sid] });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkidkid' });
    const b = client(s.base); await b.post('/api/login', { name: 'bob', password: 'bobbobbobbob' });
    assert.equal((await k.post('/api/watchlist', { type: 'movie', id: 5001, title: 'Glass Meridian', year: '2024' })).status, 200);
    await a.put(`/api/users/${id('kid')}`, { kids: { age: 7 } });
    // Bob turns it off.
    assert.equal((await b.put('/api/me/weekly', { on: false })).data.weekly, false);
    // The watchlist check runs every few monitor rounds; wait until it has noticed 5001 is here.
    for (let i = 0; i < 60 && !(await k.get('/api/me/weekly')).data.text.includes('Glass Meridian'); i++) await sleep(200);
    const pv = (await k.get('/api/me/weekly')).data;
    assert.equal(pv.everyone, false); assert.match(pv.text, /From your watchlist/); assert.match(pv.html, /Hi kid/);

    // Off for everyone: only the owner's channel gets the newsletter.
    let r = await a.post('/api/weekly/send'); assert.equal(r.status, 200); assert.equal(r.data.sent, 0);
    assert.deepEqual(msv.mails.map(m => m.to[0]), ['owner@example.com']);
    // On: kid gets their own; bob turned it off; carl has no email.
    await a.put('/api/weekly', { on: false, everyone: true, day: 1, hour: 9 });
    const cfg = (await a.get('/api/weekly')).data; assert.equal(cfg.everyone, true); assert.equal(cfg.people, 1);
    msv.mails.length = 0; r = await a.post('/api/weekly/send');
    assert.equal(r.data.sent, 1);
    assert.deepEqual(msv.mails.map(m => m.to[0]).sort(), ['kid@example.com', 'owner@example.com']);
    const kidMail = msv.mails.find(m => m.to[0] === 'kid@example.com');
    assert.match(kidMail.data, /Subject: Your week on GoatMediaStackarr/);
    assert.match(textOf(kidMail), /Glass Meridian/);
    assert.doesNotMatch(textOf(kidMail), /Coming up/, 'kids get no calendar');
    assert.equal((await b.get('/api/me')).data.user.weekly, false);
  } finally { await s.stop(); srv.close(); msv.srv.close(); }
});
