const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net'), http = require('node:http');
const totp = require('../lib/totp'), { sendMail } = require('../lib/smtp'), channels = require('../lib/channels');

test('one-time codes match the published test values', () => {
  const secret = totp.b32enc(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp.b32dec(secret).toString(), '12345678901234567890');
  assert.equal(totp.hotp(totp.b32dec(secret), 1, 8), '94287082');   // RFC 6238, time 59 seconds
  assert.equal(totp.hotp(totp.b32dec(secret), 37037036, 8), '07081804'); // RFC 6238, time 1111111109
  assert.equal(totp.totp(secret, 59000), '287082');
});
test('codes are accepted once, only inside the time window', () => {
  const s = totp.newSecret(), now = 1_700_000_000_000, code = totp.totp(s, now);
  const step = totp.verify(s, code, now); assert.ok(step > 0);
  assert.equal(totp.verify(s, code, now, step), 0, 'cannot be used twice');
  assert.ok(totp.verify(s, totp.totp(s, now - 30000), now) > 0, 'one step old is fine');
  assert.equal(totp.verify(s, totp.totp(s, now - 120000), now), 0, 'two minutes old is not');
  assert.equal(totp.verify(s, '12345', now), 0); assert.equal(totp.verify(s, 'abcdef', now), 0);
  assert.match(totp.uri(s, 'jane'), /^otpauth:\/\/totp\/MediaHub%3Ajane\?secret=[A-Z2-7]+&issuer=MediaHub$/);
  const rc = totp.recoveryCodes(); assert.equal(rc.length, 8); assert.match(rc[0], /^[a-z0-9]{4}-[a-z0-9]{4}$/);
});

test('email is sent over SMTP with sign-in and a readable message', async () => {
  const got = { lines: [], data: '' };
  const srv = net.createServer(sock => {
    let inData = false, buf = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let i; while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else got.data += line + '\n'; continue; }
        got.lines.push(line);
        if (/^EHLO/.test(line)) sock.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 what\r\n');
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    await sendMail({ host: '127.0.0.1', port: srv.address().port, secure: 'none', user: 'u', pass: 'p', from: 'mh@example.com', to: 'a@example.com, b@example.com', subject: 'Download finished é', text: 'Hello there' });
    assert.ok(got.lines.some(l => l === 'MAIL FROM:<mh@example.com>'));
    assert.equal(got.lines.filter(l => l.startsWith('RCPT TO')).length, 2);
    assert.ok(got.lines.some(l => l === 'AUTH PLAIN ' + Buffer.from('\0u\0p').toString('base64')));
    assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
    assert.equal(Buffer.from(got.data.split('\n\n')[1].replace(/\n/g, ''), 'base64').toString(), 'Hello there');
    await assert.rejects(sendMail({ host: '127.0.0.1', port: srv.address().port, secure: 'none', from: 'bad address', to: 'a@example.com', subject: 's', text: 't' }), /addresses/);
    await assert.rejects(sendMail({ host: '127.0.0.1', port: 1, secure: 'none', from: 'a@example.com', to: 'b@example.com', subject: 's', text: 't', timeout: 2000 }), /ECONNREFUSED|refused/i);
  } finally { srv.close(); }
});

test('each channel type sends the right request', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: b }); res.end('ok'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    await channels.send({ type: 'ntfy', target: base + '/topic' }, 'Finished é', 'body');
    assert.match(seen[0].headers.title, /^=\?UTF-8\?B\?/); assert.equal(seen[0].body, 'body');
    await channels.send({ type: 'discord', target: base + '/hook' }, 'T', 'B'); assert.equal(JSON.parse(seen[1].body).content, '**T**\nB');
    await channels.send({ type: 'gotify', target: base + '/', token: 'tok en' }, 'T', 'B'); assert.equal(seen[2].url, '/message?token=tok%20en'); assert.equal(JSON.parse(seen[2].body).title, 'T');
    await channels.send({ type: 'webhook', target: base + '/w' }, 'T', 'B'); assert.deepEqual(JSON.parse(seen[3].body), { title: 'T', message: 'B' });
    assert.equal(channels.problem({ type: 'ntfy', target: 'nope' }) !== '', true);
    assert.equal(channels.problem({ type: 'pushover', token: 'a', chat: 'b' }), '');
    assert.equal(channels.problem({ type: 'email', host: 'h', from: 'a@b.c', to: 'd@e.f' }), '');
    assert.notEqual(channels.problem({ type: 'telegram', token: 'x' }), '');
    await assert.rejects(channels.send({ type: 'nope' }, 'a', 'b'), /Unknown/);
  } finally { srv.close(); }
});
