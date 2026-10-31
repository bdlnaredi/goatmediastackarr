// Asking with choices: quality and folder go to Seerr; monitoring and minimum availability are set in Radarr/Sonarr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('request options', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ REQ_OPTS_MS: '200' }), a = client(s.base); await setup(a);
  try {
    const seerr = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' });
    let r = await a.get(`/api/request/options?sid=${seerr}&type=movie`);
    assert.equal(r.data.choose, true); assert.equal(r.data.kind, 'radarr');
    assert.deepEqual(r.data.servers[0].profiles.map(x => x.name), ['HD-1080p', 'Ultra-HD']); assert.equal(r.data.servers[0].minAvail, 'released');
    // Movie 3 (TMDB 5003) is in the pretend Radarr.
    r = await a.post('/api/requests', { sid: seerr, mediaType: 'movie', mediaId: 5003, title: 'The Last Lighthouse', opts: { serverId: 0, profileId: 3, rootFolder: '/media/movies-4k', monitor: false, minAvail: 'inCinemas' } });
    assert.equal(r.status, 200); assert.deepEqual(r.data.opts, { serverId: 0, profileId: 3, rootFolder: '/media/movies-4k', monitor: false, minAvail: 'inCinemas' });
    const sent = fake.state.calls.filter(c => c.startsWith('seerr request ')).pop();
    assert.match(sent, /"profileId":3/); assert.match(sent, /"rootFolder":"\/media\/movies-4k"/); assert.match(sent, /"serverId":0/);
    const mv = fake.state.movies.find(x => x.id === 3);
    for (let i = 0; i < 40 && mv.minimumAvailability !== 'inCinemas'; i++) await sleep(100);
    assert.equal(mv.minimumAvailability, 'inCinemas'); assert.equal(mv.monitored, false);
    // A show: Sonarr's monitoring option.
    await a.post('/api/requests', { sid: seerr, mediaType: 'tv', mediaId: 7002, title: 'Deep', opts: { monitor: 'future', minAvail: 'released' } });
    for (let i = 0; i < 40 && !fake.state.seasonpass; i++) await sleep(100);
    assert.deepEqual(fake.state.seasonpass.monitoringOptions, { monitor: 'future' });
    // Bad choices are dropped; profiles that cannot add things get no choices.
    r = await a.post('/api/requests', { sid: seerr, mediaType: 'movie', mediaId: 5004, title: 'x', opts: { rootFolder: 'relative', minAvail: 'tomorrow', profileId: 'abc' } });
    assert.equal(r.data.opts, undefined);
    await a.post('/api/users', { name: 'v', password: 'vvvvvvvv', role: 'user' });
    const v = (await a.get('/api/users')).data.find(u => u.name === 'v'); await a.put(`/api/users/${v.id}`, { perms: { add: false, control: false, remove: false, request: true } });
    await a.put(`/api/users/${v.id}/access`, { access: [seerr] });
    const k = client(s.base); await k.post('/api/login', { name: 'v', password: 'vvvvvvvv' });
    assert.equal((await k.get(`/api/request/options?sid=${seerr}&type=movie`)).data.choose, false);
  } finally { await s.stop(); srv.close(); }
});
