// Alerts like Tautulli's: playback and recently-added triggers, each channel's own text with {parameters},
// conditions, and newsletters with their own schedule, time frame and recipients.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');
const AL = require('../lib/alerts');

test('text with parameters and optional parts; conditions', () => {
  assert.equal(AL.render('{user} on {player}<, {quality}>.', { user: 'Ann', player: 'TV', quality: '' }), 'Ann on TV.');
  assert.equal(AL.render('{user} on {player}<, {quality}>.', { user: 'Ann', player: 'TV', quality: '4K' }), 'Ann on TV, 4K.');
  assert.equal(AL.render('a\\nb {nope}', {}), 'a\nb');
  const p = { user: 'Ravi', media_type: 'movie', progress_percent: 42 };
  assert.ok(AL.condsOk({ conds: [{ p: 'user', op: 'is', v: 'ann, ravi' }] }, p));
  assert.ok(!AL.condsOk({ conds: [{ p: 'user', op: 'isnot', v: 'ravi' }] }, p));
  assert.ok(AL.condsOk({ conds: [{ p: 'progress_percent', op: 'gt', v: '40' }, { p: 'media_type', op: 'is', v: 'episode' }], condMode: 'any' }, p));
  assert.ok(!AL.condsOk({ conds: [{ p: 'progress_percent', op: 'gt', v: '40' }, { p: 'media_type', op: 'is', v: 'episode' }] }, p));
  assert.deepEqual(AL.cleanConds([{ p: 'user', op: 'is', v: 'x' }, { p: 'evil', op: 'is', v: 1 }, { p: 'user', op: 'eval', v: 1 }]), [{ p: 'user', op: 'is', v: 'x' }]);
  assert.equal(AL.message({}, 'finished', { subject: 'S', message: 'M' }).body, 'M', 'old triggers keep their own words');
});

test('playback, new device and recently added go to the channels that want them, in their own words', async () => {
  const got = [], hook = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  const fake = fakes.create({ streams: 1 }), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => hook.once('listening', r))]);
  const fb = `http://127.0.0.1:${srv.address().port}`, hk = `http://127.0.0.1:${hook.address().port}/`;
  const s = await boot({ MONITOR_MS: '300' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
  try {
    // One channel for Ravi's... no: for "sam" only, with its own text; another for everything else, default text.
    let r = await a.post('/api/alerts/channels', { type: 'webhook', name: 'Sam', target: hk + 'sam', events: ['playStart', 'playPause', 'playResume', 'playStop', 'newDevice'],
      tpl: { playStart: { subject: 'Hey {user}', body: '{full_title} on {player}<, {quality}>' } }, conds: [{ p: 'user', op: 'is', v: 'sam' }] });
    assert.equal(r.status, 200);
    await a.post('/api/alerts/channels', { type: 'webhook', name: 'All', target: hk + 'all', events: ['playStart', 'recentlyAdded'] });
    const al = (await a.get('/api/alerts')).data;
    assert.equal(al.channels[0].tpl.playStart.subject, 'Hey {user}'); assert.deepEqual(al.channels[0].conds, [{ p: 'user', op: 'is', v: 'sam' }]);
    assert.ok(al.meta.playStart.params.includes('player')); assert.equal(al.meta.playStart.group, 'Playback');
    assert.equal((await a.get('/api/alerts')).data.channels[1].events.includes('recentlyAdded'), true);

    await a.post('/api/services', { type: 'plex', name: 'Plex', url: `${fb}/plex`, apiKey: 'k' });
    // The one stream belongs to "alex": the All channel hears it, the Sam channel (only sam) does not.
    assert.ok(await wait(() => got.some(x => x.title.startsWith('alex started'))), 'default text: ' + JSON.stringify(got));
    assert.ok(!got.some(x => x.title.startsWith('Hey')));
    // A second stream, by sam, on a new device: custom text with the optional quality.
    fake.state.streams = 2;
    assert.ok(await wait(() => got.some(x => x.title === 'Hey sam')));
    const m = got.find(x => x.title === 'Hey sam'); assert.match(m.message, /on Phone, 1080p$/);
    // Paused, then gone.
    fake.state.paused = [false, true];
    assert.ok(await wait(() => got.some(x => /^sam paused/.test(x.title))));
    fake.state.streams = 1;
    assert.ok(await wait(() => got.some(x => /^sam stopped/.test(x.title))));
    assert.ok(!got.some(x => x.title === 'New device for alex'), 'the first look only notes the devices already in use');
    assert.ok(got.some(x => x.title === 'New device for sam'), 'a device seen later is new');

    // Recently added: the first look notes where things stand; a new title is told about.
    await new Promise(r => setTimeout(r, 1500));
    fake.state.added = [{ type: 'movie', ratingKey: '999', title: 'Fresh Film', year: 2026, addedAt: Math.round(Date.now() / 1000) + 5, librarySectionTitle: 'Movies', summary: 'New.' }];
    assert.ok(await wait(() => got.some(x => x.title === 'Added: Fresh Film')), JSON.stringify(got.map(x => x.title)));
    assert.match(got.find(x => x.title === 'Added: Fresh Film').message, /Fresh Film \(2026\) is ready to watch in Movies\./);

    // Preview with made-up values, and a test message for one trigger.
    r = await a.post('/api/alerts/preview', { kind: 'playStop', subject: '{user} done', body: '{progress_percent}%< in {nothing}>' });
    assert.equal(r.data.subject, 'Ravi done'); assert.equal(r.data.body, '42%');
    const before = got.length;
    r = await a.post('/api/alerts/test', { id: al.channels[0].id, kind: 'playStart' });
    assert.ok(r.data.results[0].ok); assert.ok(await wait(() => got.length > before)); assert.equal(got[got.length - 1].title, 'Hey Ravi');
  } finally { await s.stop(); srv.close(); hook.close(); }
});

test('newsletters: their own schedule, time frame, parts and recipients; kept after sending', async () => {
  const got = [], hook = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => hook.once('listening', r))]);
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' });
    const ch = (await a.post('/api/alerts/channels', { type: 'webhook', name: 'Hook', target: `http://127.0.0.1:${hook.address().port}/`, events: [] })).data.id;
    let r = await a.post('/api/newsletters', { name: 'Movie night', every: 'month', day: 40, hour: 30, days: 365, sids: [rad, 'nope'], kinds: { tv: false }, parts: { soon: false },
      to: { channels: [ch, 'nope'] }, subject: '{name}: {count} new', intro: 'Popcorn time.' });
    const nl = r.data;
    assert.equal(nl.day, 28); assert.equal(nl.hour, 23); assert.equal(nl.days, 90); assert.deepEqual(nl.sids, [rad]); assert.deepEqual(nl.to.channels, [ch]); assert.equal(nl.parts.soon, false);
    assert.equal((await client(s.base).get('/api/newsletters')).status, 401);
    r = await a.get(`/api/newsletters/${nl.id}/preview`);
    assert.match(r.data.html, /Movie night/); assert.match(r.data.html, /Popcorn time\./); assert.doesNotMatch(r.data.html, /Coming up/);
    assert.match(r.data.subject, /^Movie night: \d+ new$/);
    r = await a.post(`/api/newsletters/${nl.id}/send`);
    assert.equal(r.status, 200); assert.equal(r.data.sent, 1); assert.equal(got.length, 1); assert.match(got[0].title, /^Movie night: /);
    const l = (await a.get('/api/newsletters')).data.list[0]; assert.equal(l.sentList.length, 1); assert.ok(!l.archive);
    r = await a.get(`/api/newsletters/${nl.id}/archive/0`); assert.match(r.data.html, /Popcorn/);
    r = await a.put(`/api/newsletters/${nl.id}`, { on: true, every: 'day', hour: 9 }); assert.equal(r.data.on, true); assert.ok(r.data.next > Date.now()); assert.equal(r.data.name, 'Movie night');
    assert.equal((await a.del(`/api/newsletters/${nl.id}`)).status, 200); assert.equal((await a.get('/api/newsletters')).data.list.length, 0);
  } finally { await s.stop(); srv.close(); hook.close(); }
});
