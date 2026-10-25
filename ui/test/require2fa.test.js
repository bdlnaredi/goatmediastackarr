// Requiring two-step sign-in: for chosen profiles, admins or everyone; nothing else works until it is set up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, setup } = require('./helpers');
const totp = require('../lib/totp');

test('required two-step sign-in blocks everything but setting it up, and cannot then be turned off', async () => {
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam');
    let u = client(s.base); await u.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await u.get('/api/services')).status, 200, 'not required yet');
    // Required for Sam only.
    assert.equal((await a.put(`/api/users/${sam.id}`, { require2fa: true })).data.require2fa, true);
    let r = await u.get('/api/services'); assert.equal(r.status, 403); assert.equal(r.data.need2fa, true);
    assert.equal((await u.get('/api/me')).data.user.need2fa, true);
    assert.equal((await a.get('/api/services')).status, 200, 'the admin is not affected');
    // Setting it up opens everything again.
    const st = (await u.post('/api/2fa/start')).data;
    r = await u.post('/api/2fa/enable', { code: totp.totp(st.secret) }); assert.equal(r.status, 200);
    assert.equal((await u.get('/api/services')).status, 200);
    r = await u.post('/api/2fa/disable', { password: 'samsamsam', code: totp.totp(st.secret) }); assert.equal(r.status, 400, 'required, so it stays on');
    // Policy: admins. The admin without it is now asked too.
    r = await a.put('/api/settings/2fa', { policy: 'admins' }); assert.deepEqual(r.data.missing, ['admin']);
    assert.equal((await a.get('/api/services')).status, 403);
    assert.equal((await a.put('/api/settings/2fa', { policy: 'none' })).status, 403, 'even this waits until it is set up');
  } finally { await s.stop(); }
});
