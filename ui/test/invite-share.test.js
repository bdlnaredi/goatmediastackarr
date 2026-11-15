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

test('a Plex invite: they join with their Plex account, the libraries are shared with it, and no password works', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: `${fb}/plextv`, PLEX_AUTH_URL: 'https://app.plex.example/auth' }), a = client(s.base); await setup(a);
  fake.state.pinDelay = 200;
  try {
    const px = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `${fb}/plex`, apiKey: 'tok' })).data.id;
    const iv = (await a.post('/api/invites', { label: 'Plex friends', access: [px], viaPlex: true, plex: { on: true, libs: ['1'] }, welcome: 'Hi!' })).data;
    assert.equal(iv.viaPlex, true);
    const g = client(s.base), info = (await g.get('/api/invite/' + iv.code)).data; assert.equal(info.viaPlex, true);
    assert.equal((await g.post('/api/invite/' + iv.code, { name: 'ravi', password: 'ravipassword' })).status, 400, 'no name and password for a Plex invite');
    // Sign in with Plex is off, but the invite lets them join with it.
    assert.equal((await g.post('/api/plexlogin/start', { invite: 'not-a-real-invite-code-at-all' })).status, 404);
    fake.state.plexWho = 'ravi';
    const st = await g.post('/api/plexlogin/start', { invite: iv.code }); assert.equal(st.status, 200, JSON.stringify(st.data));
    let r; for (let i = 0; i < 30; i++) { r = await g.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await new Promise(z => setTimeout(z, 150)); }
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.user.name, 'ravi');
    const me = (await g.get('/api/me')).data.user; assert.equal(me.name, 'ravi'); assert.deepEqual(me.access, [px]);
    assert.equal(fake.state.plexShares[0].shared_server.invited_email, 'ravi@example.com', 'shared with their Plex account');
    const inv = (await a.get('/api/invites')).data.find(x => x.id === iv.id); assert.equal(inv.used, 1); assert.deepEqual(inv.people, ['ravi']);
    // Joining again with the same Plex account signs in, without a second profile.
    const g2 = client(s.base), st2 = await g2.post('/api/plexlogin/start', { invite: iv.code });
    for (let i = 0; i < 30; i++) { r = await g2.get('/api/plexlogin/poll?t=' + st2.data.ticket); if (!r.data.pending) break; await new Promise(z => setTimeout(z, 150)); }
    assert.equal(r.data.user.name, 'ravi'); assert.equal((await a.get('/api/users')).data.filter(u => u.name.startsWith('ravi')).length, 1);
    // A password invite cannot be used with Plex.
    const pw = (await a.post('/api/invites', { label: 'Password' })).data; assert.equal(pw.viaPlex, false);
    assert.equal((await client(s.base).post('/api/plexlogin/start', { invite: pw.code })).status, 400);
  } finally { await s.stop(); srv.close(); }
});
