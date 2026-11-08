// Suggestions: everyone can suggest and vote; admins send them to the project's GitHub Issues.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');

test('suggestions: post, vote, and send to GitHub with a token or a filled-in link', async () => {
  const got = [];
  const gh = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    got.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
    if (req.headers.authorization !== 'Bearer good') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"message":"Bad credentials"}'); }
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ number: 40 + got.length, html_url: 'https://github.com/bdlnaredi/goatmediastackarr/issues/' + (40 + got.length) }));
  }).listen(0);
  await new Promise(r => gh.once('listening', r));
  const s = await boot({ GITHUB_API: `http://127.0.0.1:${gh.address().port}` }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await k.post('/api/suggestions', { title: 'x' })).status, 400, 'needs a title');
    const one = (await k.post('/api/suggestions', { title: 'Dark mode for the widget', body: 'It is too bright at night.', kind: 'feature' })).data;
    assert.equal(one.votes, 1); assert.ok(one.voted && one.mine);
    const two = (await k.post('/api/suggestions', { title: 'Search crashes with emoji', kind: 'bug' })).data;
    assert.ok((await a.get('/api/notifications')).data.items.some(x => x.title === 'New suggestion'), 'admins hear about it');

    // Votes: the admin agrees, so it moves up; a second tap takes it back.
    assert.equal((await a.post(`/api/suggestions/${two.id}/vote`)).data.votes, 2);
    let l = (await k.get('/api/suggestions')).data;
    assert.equal(l.items[0].id, two.id, 'most wanted first'); assert.equal(l.repo, 'bdlnaredi/goatmediastackarr'); assert.equal(l.token, undefined, 'only admins see the settings');
    assert.equal((await k.post(`/api/suggestions/${one.id}/github`)).status, 403);

    // No token: a GitHub page already filled in.
    const link = (await a.get(`/api/suggestions/${one.id}/link`)).data.url, u = new URL(link);
    assert.equal(u.origin + u.pathname, 'https://github.com/bdlnaredi/goatmediastackarr/issues/new');
    assert.equal(u.searchParams.get('title'), '[Feature] Dark mode for the widget'); assert.match(u.searchParams.get('body'), /too bright/);
    assert.doesNotMatch(u.searchParams.get('body'), /sam/, 'no names unless the admin wants them');
    assert.match((await a.post(`/api/suggestions/${one.id}/github`)).data.error, /token/);
    // Marking it as sent by hand with the issue's address.
    const m = (await a.put(`/api/suggestions/${one.id}`, { issue: 'https://github.com/bdlnaredi/goatmediastackarr/issues/7' })).data;
    assert.equal(m.status, 'sent'); assert.equal(m.issue.number, 7);

    // With a token: a wrong one is explained, a good one opens the issue.
    assert.equal((await a.put('/api/suggestsettings', { repo: 'https://github.com/bdlnaredi/goatmediastackarr.git', token: 'bad', names: true })).data.repo, 'bdlnaredi/goatmediastackarr');
    assert.match((await a.post(`/api/suggestions/${two.id}/github`)).data.error, /did not accept the token/);
    await a.put('/api/suggestsettings', { token: 'good' });
    const sent = (await a.post(`/api/suggestions/${two.id}/github`)).data;
    assert.equal(sent.status, 'sent'); assert.ok(sent.issue.url.endsWith('/issues/' + sent.issue.number));
    const last = got.pop(); assert.equal(last.url, '/repos/bdlnaredi/goatmediastackarr/issues');
    assert.equal(last.body.title, '[Bug] Search crashes with emoji'); assert.deepEqual(last.body.labels, ['bug']); assert.match(last.body.body, /by sam/); assert.match(last.body.body, /2 people want this/);
    assert.equal((await a.post(`/api/suggestions/${two.id}/github`)).data.issue.number, sent.issue.number, 'not sent twice');

    // Send every new one at once.
    await k.post('/api/suggestions', { title: 'Three' }); await k.post('/api/suggestions', { title: 'Four' });
    const all = (await a.post('/api/suggestions-all/github')).data;
    assert.equal(all.sent.length, 2); assert.deepEqual(all.failed, []);
    assert.equal((await a.put('/api/suggestsettings', { repo: 'not a repo' })).status, 400);
    // People can take back their own, not others'.
    assert.equal((await k.del(`/api/suggestions/${one.id}`)).status, 200);
    const other = (await a.post('/api/suggestions', { title: 'Admin idea' })).data;
    assert.equal((await k.del(`/api/suggestions/${other.id}`)).status, 403);
  } finally { await s.stop(); gh.close(); }
});
