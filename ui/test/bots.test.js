// Requests from a Telegram chat: link with a code, search, tap Request, hear back. (Discord shares the same steps.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('Telegram: link, search with posters, request with a tap, and the request is theirs', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  const queue = [], sent = [];
  let uid = 1;
  const tg = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    const body = JSON.parse(b || '{}'), method = req.url.split('/').pop(), ok = r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (method === 'getMe') return ok({ username: 'goat_bot' });
    if (method === 'getUpdates') { const l = queue.splice(0).filter(u => u.update_id >= (body.offset || 0)); return setTimeout(() => ok(l), l.length ? 0 : 150); }
    sent.push({ method, ...body }); ok({ message_id: sent.length });
  }); });
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => tg.listen(0, r))]);
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ TELEGRAM_API: `http://127.0.0.1:${tg.address().port}`, BOT_RETRY_MS: '200' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 6000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
  const say = (text, chat = 555) => queue.push({ update_id: uid++, message: { chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Nana' }, text } });
  try {
    const seerr = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' })).data.id;
    assert.equal((await a.put('/api/bots', { telegram: 'nope' })).status, 400);
    assert.equal((await a.put('/api/bots', { telegram: '123456:' + 'A'.repeat(35) })).status, 200);
    let b = (await a.get('/api/bots')).data; assert.equal(b.telegram.name, '@goat_bot'); assert.equal(b.telegram.set, true);
    await a.post('/api/users', { name: 'nana', password: 'nananana1', role: 'user' });
    const nid = (await a.get('/api/users')).data.find(u => u.name === 'nana').id;
    await a.put(`/api/users/${nid}/access`, { access: [seerr] });
    const n = client(s.base); await n.post('/api/login', { name: 'nana', password: 'nananana1' });

    say('hello');
    assert.ok(await wait(() => sent.some(x => /not linked yet/.test(x.text || ''))));
    const code = (await n.post('/api/me/chats/code')).data.code;
    say('/link ' + code);
    assert.ok(await wait(() => sent.some(x => /Linked to nana/.test(x.text || ''))));
    assert.equal((await n.get('/api/me/chats')).data.telegram, true);
    say('/link ' + code, 777); assert.ok(await wait(() => sent.some(x => x.chat_id === 777 && /not right/.test(x.text || ''))), 'a code works once');

    say('hidden');
    assert.ok(await wait(() => sent.some(x => x.reply_markup)));
    const btn = sent.find(x => x.reply_markup).reply_markup.inline_keyboard[0][0];
    assert.match(btn.text, /^Request /);
    queue.push({ update_id: uid++, callback_query: { id: 'cb1', from: { id: 555 }, message: { chat: { id: 555 } }, data: btn.callback_data } });
    assert.ok(await wait(() => sent.some(x => /^Asked for /.test(x.text || '') && String(x.chat_id) === '555')), JSON.stringify(sent.slice(-3)));
    assert.ok(sent.some(x => x.method === 'answerCallbackQuery'));
    const rq = (await n.get('/api/requests')).data;
    assert.equal(rq.length, 1); assert.equal(rq[0].user, 'nana'); assert.equal(rq[0].status, 'pending', 'their own rights: an admin approves');
    say('/requests'); assert.ok(await wait(() => sent.some(x => /Your latest requests/.test(x.text || '') && /waiting for approval/.test(x.text))));
    // Approval reaches the chat.
    const ap = await a.post(`/api/requests/${rq[0].id}/approve`); assert.equal(ap.status, 200, JSON.stringify(ap.data));
    assert.ok(await wait(() => sent.some(x => /Request approved/.test(x.text || '') && x.chat_id === '555')), JSON.stringify(sent.slice(-2).map(x=>[x.chat_id,x.text])));
    assert.ok(!(await n.get('/api/sessions')).data.some(x => x.device && /chat/.test(x.ip || '')), 'the bot does not show as a device');
    await a.put('/api/bots', { telegram: '' }); assert.equal((await a.get('/api/bots')).data.telegram.set, false);
  } finally { await s.stop(); srv.close(); tg.close(); }
});

// A tiny WebSocket server (text frames only), standing in for Discord's Gateway.
function fakeGateway(onMsg) {
  const crypto = require('node:crypto'), socks = [];
  const srv = http.createServer().on('upgrade', (req, sock) => {
    const key = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
    const out = o => { const b = Buffer.from(JSON.stringify(o)); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); sock.write(Buffer.concat([h, b])); };
    let buf = Buffer.alloc(0);
    sock.on('data', d => { buf = Buffer.concat([buf, d]);
      while (buf.length >= 6) { let len = buf[1] & 127, off = 2; if (len === 126) { len = buf.readUInt16BE(2); off = 4; } if (buf.length < off + 4 + len) break;
        const mask = buf.slice(off, off + 4), data = Buffer.from(buf.slice(off + 4, off + 4 + len).map((x, i) => x ^ mask[i % 4])); const op = buf[0] & 15; buf = buf.slice(off + 4 + len);
        if (op === 1) onMsg(JSON.parse(data.toString()), out); } });
    sock.on('error', () => {}); socks.push(sock); out({ op: 10, d: { heartbeat_interval: 30000 } });
  });
  return { srv, close: () => { socks.forEach(x => x.destroy()); srv.close(); } };
}

test('Discord: slash commands are added, /link and /request answer privately, a button asks for it', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  const rest = [];
  const api = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    rest.push({ m: req.method, u: req.url, b: b ? JSON.parse(b) : null }); res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/users/@me' ? { id: '9', username: 'GoatBot' } : req.url === '/users/@me/channels' ? { id: 'dm1' } : {})); }); }).listen(0);
  let send = null;
  const gw = fakeGateway((m, out) => { if (m.op === 2) { send = out; out({ op: 0, s: 1, t: 'READY', d: { application: { id: 'app1' }, user: { username: 'GoatBot' } } }); } });
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => api.once('listening', r)), new Promise(r => gw.srv.listen(0, r))]);
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ DISCORD_API: `http://127.0.0.1:${api.address().port}`, DISCORD_GATEWAY: `ws://127.0.0.1:${gw.srv.address().port}`, BOT_RETRY_MS: '200' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 6000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
  const edits = () => rest.filter(x => x.m === 'PATCH' && /messages\/@original$/.test(x.u)).map(x => x.b);
  const cmd = (name, value, id) => send({ op: 0, s: 2, t: 'INTERACTION_CREATE', d: { id, token: 't' + id, application_id: 'app1', type: 2, user: { id: '42', username: 'nana' }, data: { name, options: value ? [{ value }] : [] } } });
  try {
    await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' });
    assert.equal((await a.put('/api/bots', { discord: 'A'.repeat(26) + '.' + 'B'.repeat(6) + '.' + 'C'.repeat(30) })).status, 200);
    assert.ok(await wait(() => rest.some(x => x.m === 'PUT' && x.u === '/applications/app1/commands')));
    assert.deepEqual(rest.find(x => x.u === '/applications/app1/commands').b.map(c => c.name), ['request', 'requests', 'link']);
    assert.match((await a.get('/api/bots')).data.discord.invite, /client_id=app1/);
    const code = (await a.post('/api/me/chats/code')).data.code;
    cmd('link', code, 'i1');
    assert.ok(await wait(() => edits().some(e => /Linked to admin/.test(e.content))));
    assert.ok(rest.some(x => x.u === '/interactions/i1/ti1/callback' && x.b.type === 5 && x.b.data.flags === 64), 'answered at once, privately');
    cmd('request', 'hidden', 'i2');
    assert.ok(await wait(() => edits().some(e => (e.components || []).length)));
    const msg = edits().find(e => (e.components || []).length), btn = msg.components[0].components[0];
    assert.ok(msg.embeds.length >= 1); assert.match(btn.custom_id, /^rq\|/);
    send({ op: 0, s: 3, t: 'INTERACTION_CREATE', d: { id: 'i3', token: 'ti3', application_id: 'app1', type: 3, user: { id: '42' }, data: { custom_id: btn.custom_id } } });
    assert.ok(await wait(() => edits().some(e => /^Asked for /.test(e.content))));
    assert.equal((await a.get('/api/requests')).data.length, 1);
  } finally { await a.put('/api/bots', { discord: '' }); await s.stop(); srv.close(); api.close(); gw.close(); }
});
