// Replace cam copies: a cam/telesync/telecine copy is deleted a day before the home release and Radarr searches again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');
const DAY = 864e5, iso = d => new Date(Date.now() + d * DAY).toISOString();

test('cam copies go a day before release, proper ones and ones without a date stay', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ MONITOR_MS: '150', CAM_EVERY: '2' }), a = client(s.base); await setup(a);
  try {
    const [m1, m2, m3, m4] = fake.state.movies;
    const file = (m, name, source) => Object.assign(m, { hasFile: true, monitored: false, movieFile: { id: 700 + m.id, quality: { quality: { name, source } } } });
    file(m1, 'TELESYNC', 'telesync'); Object.assign(m1, { digitalRelease: iso(0.5), physicalRelease: iso(30) });   // out in 12 hours: goes
    file(m2, 'CAM', 'cam'); Object.assign(m2, { digitalRelease: iso(7), physicalRelease: null });                    // a week away: stays for now
    file(m3, 'WEBDL-1080p', 'webdl'); Object.assign(m3, { digitalRelease: iso(-1) });                               // a proper copy: never
    file(m4, 'CAM', 'cam'); Object.assign(m4, { digitalRelease: null, physicalRelease: null });                      // no date yet: kept
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });

    let d = (await a.get('/api/camrules')).data;
    assert.equal(d.on, false, 'off until turned on');
    assert.deepEqual(d.waiting.map(x => [x.id, x.kind]).sort(), [[m1.id, 'telesync'], [m2.id, 'cam'], [m4.id, 'cam']].sort());
    const w2 = d.waiting.find(x => x.id === m2.id); assert.ok(Math.abs(w2.removeAt - (Date.parse(m2.digitalRelease) - DAY)) < 1000, 'a day before');
    await sleep(800); assert.deepEqual(fake.state.deleted || [], [], 'nothing deleted while off');

    await a.put('/api/camrules', { on: true });
    for (let i = 0; i < 60 && !(fake.state.deleted || []).length; i++) await sleep(100);
    assert.deepEqual(fake.state.deleted, ['moviefile ' + (700 + m1.id)], 'only the one out within a day');
    assert.ok(fake.state.calls.some(c => /MoviesSearch/.test(c) && c.includes(String(m1.id))), 'and Radarr searches for it: ' + fake.state.calls.slice(-5).join(' | '));
    d = (await a.get('/api/camrules')).data;
    assert.match(d.log[0].what, /telesync copy was removed before its home release.*searching for a proper one/);
    await sleep(600); assert.equal(fake.state.deleted.length, 1, 'not again');
    const told = (await a.get('/api/notifications')).data.items.filter(x => x.title === `${m1.title}${m1.year ? ' (' + m1.year + ')' : ''} is being replaced with a better copy`);
    assert.equal(told.length, 1, 'everyone who can watch is told why it is gone'); assert.match(told[0].body, /telesync copy \(filmed in a cinema.*proper one is being looked for/);

    // Telesync left out of the kinds: kept.
    await a.put('/api/camrules', { kinds: ['cam'], days: 10 });
    for (let i = 0; i < 60 && fake.state.deleted.length < 2; i++) await sleep(100);
    assert.deepEqual(fake.state.deleted.slice(1), ['moviefile ' + (700 + m2.id)], 'ten days before: the cam one a week away goes now');
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await k.put('/api/camrules', { on: false })).status, 403);
  } finally { await s.stop(); srv.close(); }
});
