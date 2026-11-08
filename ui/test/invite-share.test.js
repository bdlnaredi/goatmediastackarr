// Invites that also share Plex libraries and make a Jellyfin account, and the welcome page after joining.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('an invite shares Plex libraries, makes a Jellyfin account, and welcomes the new person', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: `${fb}/plextv` }), a = client(s.base); await setup(a);
  try {
    const px = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `${fb}/plex`, apiKey: 'tok' })).data.id;
    await a.post('/api/services', { type: 'jellyfin', name: 'Jellyfin', url: `${fb}/jellyfin`, apiKey: 'k' });
    const libs = (await a.get('/api/invites/plexlibs')).data; assert.deepEqual(libs.map(l => l.title), ['Movies', 'TV Shows', 'Private']);
    const iv = (await a.post('/api/invites', { label: 'Friends', days: 7, max: 5, access: [px], plex: { on: true, libs: ['1', '2'] }, jellyfin: true, welcome: 'Hi! Ask for anything.' })).data;
    assert.ok(iv.code); assert.deepEqual(iv.plex, { on: true, libs: ['1', '2'] });
    const g = client(s.base), info = (await g.get('/api/invite/' + iv.code)).data; assert.equal(info.plex, true); assert.equal(info.jellyfin, true);
    assert.equal((await g.post('/api/invite/' + iv.code, { name: 'ravi', password: 'ravipassword' })).status, 400, 'a Plex email is needed');
    const j = await g.post('/api/invite/' + iv.code, { name: 'ravi', password: 'ravipassword', plexEmail: 'ravi@example.com' });
    assert.equal(j.status, 200, JSON.stringify(j.data));
    const sh = fake.state.plexShares[0]; assert.equal(sh.shared_server.invited_email, 'ravi@example.com'); assert.deepEqual(sh.shared_server.library_section_ids, [9001, 9002], 'plex.tv numbers, only the chosen ones');
    assert.deepEqual(fake.state.jfNew[0], { Name: 'ravi', Password: 'ravipassword' });
    const w0 = await g.get('/api/welcome'); const w = w0.data; assert.ok(w.show !== undefined, w0.status + JSON.stringify(w));
    assert.equal(w.show, true); assert.equal(w.note, 'Hi! Ask for anything.'); assert.equal(w.plex.ok, true); assert.equal(w.jellyfin.ok, true); assert.match(w.apk, /\.apk$/);
    assert.equal((await g.del('/api/welcome')).status, 200); assert.equal((await g.get('/api/welcome')).data.show, false);
  } finally { await s.stop(); srv.close(); }
});
