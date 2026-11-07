// Year in review: a person's year from Tautulli's history and their requests, and everyone's for admins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('year in review for one person and for everyone', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    const y = new Date().getFullYear();
    let d = (await a.get(`/api/wrapped?year=${y}&uid=all`)).data;
    assert.match(d.note, /Tautulli/); assert.equal(d.watch, null);
    const tt = (await a.post('/api/services', { type: 'tautulli', name: 'Tautulli', url: `${fb}/tautulli`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'alex', password: 'alexalexalex', role: 'user' });
    await a.post('/api/users', { name: 'nobody', password: 'nobodynobody', role: 'user' });
    const users = (await a.get('/api/users')).data, alex = users.find(u => u.name === 'alex');
    await a.put(`/api/users/${alex.id}/access`, { access: [tt] });
    const k = client(s.base); await k.post('/api/login', { name: 'alex', password: 'alexalexalex' });
    d = (await k.get(`/api/wrapped?year=${y}`)).data;
    assert.ok(d.watch, JSON.stringify(d)); assert.equal(d.name, 'alex'); assert.ok(d.watch.plays > 10, 'plays: ' + d.watch.plays); assert.ok(d.watch.seconds > 0);
    assert.ok(d.watch.topShows.length >= 1); assert.equal(d.watch.binge && d.watch.binge.episodes, 4, 'four in one evening');
    assert.ok(d.watch.day && d.watch.hour >= 19); assert.equal(d.watch.months.length, 12); assert.equal(d.watch.people, undefined, 'no one else in your own year');
    assert.equal(d.people, undefined);
    const th = d.watch.topShows[0].thumb; if (th) assert.notEqual((await k.get(`/api/tautulli/${tt}/img?p=${encodeURIComponent(th)}`)).status, 403, 'its pictures may be shown');
    assert.equal((await k.get(`/api/wrapped?year=${y}&uid=all`)).status, 403, 'only your own');
    const all = (await a.get(`/api/wrapped?year=${y}&uid=all`)).data;
    assert.ok(all.watch.plays > d.watch.plays); assert.equal(all.watch.people[0].title !== undefined, true); assert.ok(all.people.length >= 3);
    const nb = users.find(u => u.name === 'nobody');
    assert.match((await a.get(`/api/wrapped?year=${y}&uid=${nb.id}`)).data.note, /Plex name/);
    assert.equal((await a.get(`/api/wrapped?year=${y + 1}`)).status, 400);
  } finally { await s.stop(); srv.close(); }
});

test('a yearly newsletter sends the year in review in December', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'tautulli', name: 'Tautulli', url: `${fb}/tautulli`, apiKey: 'k' });
    const nl = (await a.post('/api/newsletters', { name: 'Our year', every: 'year', day: 20, hour: 10, subject: '{name}: {year} in review', on: true })).data;
    assert.equal(nl.every, 'year'); assert.equal(nl.day, 20);
    assert.equal(new Date(nl.next).getMonth(), 11, 'next one is in December'); assert.equal(new Date(nl.next).getDate(), 20);
    const pv = (await a.get(`/api/newsletters/${nl.id}/preview`)).data;
    assert.match(pv.subject, /^Our year: \d{4} in review$/); assert.match(pv.html, /hours watched/); assert.match(pv.html, /Top shows/); assert.ok(pv.count > 0);
  } finally { await s.stop(); srv.close(); }
});
