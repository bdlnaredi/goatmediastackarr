// Passkeys: add one while signed in, then sign in with it (no password), with a pretend authenticator made here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot, client, setup } = require('./helpers');
const WA = require('../lib/webauthn');

// A pretend authenticator: an ES256 key, signing the way a phone or security key does.
function device(rpId, origin) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), id = WA.b64u(crypto.randomBytes(32));
  let count = 0;
  const ad = (flags = 0x05) => { const b = Buffer.alloc(37); WA.sha256(rpId).copy(b, 0); b[32] = flags; b.writeUInt32BE(count, 33); return b; };
  const cd = (type, challenge, o = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
  return {
    id,
    create: (start, o) => ({ ticket: start.ticket, id, clientDataJSON: WA.b64u(cd('webauthn.create', start.challenge, o)), authenticatorData: WA.b64u(ad(0x45)),
      publicKey: WA.b64u(publicKey.export({ format: 'der', type: 'spki' })), alg: -7, name: 'Test phone' }),
    get: (start, o = {}) => { count++; const a = ad(o.flags), c = cd('webauthn.get', o.challenge || start.challenge, o.origin);
      return { ticket: start.ticket, id: o.id || id, clientDataJSON: WA.b64u(c), authenticatorData: WA.b64u(a), signature: WA.b64u(crypto.sign('sha256', Buffer.concat([a, WA.sha256(c)]), o.key || privateKey)), userHandle: '' }; },
  };
}

test('add a passkey, sign in with it, and the checks that keep it safe', async () => {
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const host = new URL(s.base).hostname;   // 127.0.0.1 in tests; the page origin must match it
    const dev = device(host, `https://${host}`);
    assert.equal((await a.get('/api/passkeys')).data.length, 0);
    let st = (await a.post('/api/passkeys/register/start', {})).data;
    assert.equal(st.rp.id, host); assert.ok(st.challenge.length > 30);
    // A different page cannot add one
    assert.equal((await a.post('/api/passkeys/register/finish', dev.create(st, 'https://evil.example'))).status, 400);
    st = (await a.post('/api/passkeys/register/start', {})).data;
    const add = await a.post('/api/passkeys/register/finish', dev.create(st));
    assert.equal(add.status, 200, JSON.stringify(add.data)); assert.equal(add.data.name, 'Test phone');
    assert.equal((await a.get('/api/passkeys')).data.length, 1); assert.equal((await a.get('/api/me')).data.user.passkeys, 1);

    // Signing in, from a fresh browser
    const b = client(s.base);
    let ls = (await b.post('/api/passkeys/login/start', {})).data; assert.equal(ls.rpId, host);
    const ok = await b.post('/api/passkeys/login/finish', dev.get(ls));
    assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.user.name, 'admin');
    assert.equal((await b.get('/api/me')).data.user.name, 'admin', 'signed in');
    // The same answer twice does not work (the ticket is used up)
    assert.equal((await client(s.base).post('/api/passkeys/login/finish', dev.get(ls))).status, 401);
    // A wrong key, a wrong challenge, no touch on the device, an unknown passkey
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    for (const [o, re] of [[{ key: other }, /signature/], [{ challenge: WA.b64u(crypto.randomBytes(32)) }, /does not match/], [{ flags: 0x04 }, /confirmed/], [{ id: WA.b64u(crypto.randomBytes(32)) }, /not known/], [{ origin: 'https://evil.example' }, /another page/]]) {
      ls = (await b.post('/api/passkeys/login/start', {})).data;
      const r = await client(s.base).post('/api/passkeys/login/finish', dev.get(ls, o));
      assert.equal(r.status, 401); assert.match(r.data.error, re);
    }
    // Removing it
    const pk = (await a.get('/api/passkeys')).data[0];
    assert.equal((await a.del(`/api/passkeys/${pk.id}`)).status, 200);
    ls = (await b.post('/api/passkeys/login/start', {})).data;
    assert.equal((await client(s.base).post('/api/passkeys/login/finish', dev.get(ls))).status, 401);
  } finally { await s.stop(); }
});
