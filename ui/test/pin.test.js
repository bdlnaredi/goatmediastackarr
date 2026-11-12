// The PIN: made, checked, changed and turned off; 5 wrong ones sign that device out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, setup, sleep } = require('./helpers');

test('a PIN is made, checked, changed and turned off, and 5 wrong ones sign the device out', async () => {
  const s = await boot({ PIN_FRESH_MS: '1500' }), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.get('/api/me')).data.user.pin, false);
    assert.equal((await a.post('/api/pin/check', { pin: '0000' })).status, 200, 'no PIN: nothing to check');
    assert.equal((await a.post('/api/pin', { pin: '12a4' })).status, 400, 'digits only');
    assert.equal((await a.post('/api/pin', { pin: '12345' })).status, 400, 'four of them');
    assert.equal((await a.post('/api/pin', { pin: '1234' })).status, 200);
    assert.equal((await a.get('/api/me')).data.user.pin, true);
    assert.equal((await a.post('/api/pin/check', { pin: '1234' })).status, 200);
    const w = await a.post('/api/pin/check', { pin: '9999' }); assert.equal(w.status, 400); assert.equal(w.data.left, 4);
    await sleep(1600);   // no longer "just signed in"
    assert.equal((await a.post('/api/pin', { pin: '4321', current: '0000' })).status, 400, 'a wrong current PIN');
    // Changing it: the current PIN (or the password, or having just signed in) proves it is you.
    assert.equal((await a.post('/api/pin', { pin: '4321', current: '1234' })).status, 200);
    assert.equal((await a.post('/api/pin/check', { pin: '4321' })).status, 200, 'a right PIN starts the count again');
    assert.equal((await a.post('/api/pin', { pin: '4321', current: 'correct-horse' })).status, 200, 'the password works too');
    // A second device, signed in just now: a forgotten PIN can be set again there.
    const b = client(s.base); await b.post('/api/login', { name: 'admin', password: 'correct-horse' });
    assert.equal((await b.post('/api/pin', { pin: '0000', current: '' })).status, 200, 'just signed in: a forgotten PIN can be set again');
    assert.equal((await b.post('/api/pin', { pin: '1111', current: '0000' })).status, 200);
    for (let i = 1; i < 5; i++) assert.equal((await b.post('/api/pin/check', { pin: '2222' })).status, 400);
    const out = await b.post('/api/pin/check', { pin: '2222' }); assert.equal(out.status, 401); assert.ok(out.data.out);
    assert.equal((await b.get('/api/me')).data.user, null, 'that device is signed out');
    assert.equal((await a.get('/api/me')).data.user.name, 'admin', 'the other one is not');
    assert.equal((await a.del('/api/pin', { current: 'nope' })).status, 400);
    assert.equal((await a.del('/api/pin', { current: '1111' })).status, 200);
    assert.equal((await a.get('/api/me')).data.user.pin, false);
  } finally { await s.stop(); }
});
