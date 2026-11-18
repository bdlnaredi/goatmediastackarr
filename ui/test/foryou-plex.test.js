// Because you watched, from Plex itself when there is no Tautulli: the person's account, its history, Plex's TMDB ids.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('Plex history is read directly when there is no Tautulli', async () => {
  const fake = fakes.create();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/plex/accounts') return j({ MediaContainer: { Account: [{ id: 1, name: 'someone' }, { id: 7, name: 'admin' }] } });
    if (u.pathname === '/plex/status/sessions/history/all') { assert.equal(u.searchParams.get('accountID'), '7'); return j({ MediaContainer: { Metadata: [{ type: 'movie', ratingKey: '55', title: 'Demo movie 5001' }] } }); }
    if (u.pathname === '/plex/library/metadata/55') return j({ MediaContainer: { Metadata: [{ title: 'Demo movie 5001', Guid: [{ id: 'imdb://tt1' }, { id: 'tmdb://5001' }] }] } });
    if (u.pathname.startsWith('/plex/')) return j({ MediaContainer: {} });
    fake.handle(req, res, req.url);
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'plex', name: 'Plex', url: base + '/plex', apiKey: 'k' });
    await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: base + '/seerr', apiKey: 'k' });
    const f = (await a.get('/api/foryou')).data;
    assert.ok(f.rows.length >= 1, JSON.stringify(f));
    assert.equal(f.rows[0].because.title, 'Demo movie 5001'); assert.equal(f.rows[0].source, 'watched');
  } finally { await s.stop(); srv.close(); }
});
