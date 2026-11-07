'use strict';
// Passkeys (WebAuthn), without outside packages. The browser hands over the new key in SPKI form
// (AuthenticatorAttestationResponse.getPublicKey()), so no CBOR has to be read here; attestation is not asked for
// ("none"), the way most sites do it. Sign-in checks the signature over authenticatorData + SHA-256(clientDataJSON).
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const ALGS = { '-7': 'sha256', '-257': 'sha256', '-8': null };   // ES256, RS256, Ed25519 (no digest name)
const fail = m => Object.assign(new Error(m), { plain: true });

// authenticatorData: rpIdHash (32) | flags (1) | signCount (4) | ...
function authData(buf) {
  if (buf.length < 37) throw fail('The passkey answer is too short');
  const flags = buf[32];
  return { rpIdHash: buf.subarray(0, 32), up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64), count: buf.readUInt32BE(33) };
}
// clientDataJSON: the type, the challenge we sent and the page it came from.
function clientData(raw, type, challenge, rpId) {
  let c; try { c = JSON.parse(unb64u(raw).toString('utf8')); } catch { throw fail('The passkey answer could not be read'); }
  if (c.type !== type) throw fail('The passkey answer is of the wrong kind');
  const a = unb64u(c.challenge), b = unb64u(challenge);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail('The passkey answer does not match this sign-in. Please try again.');
  let o; try { o = new URL(c.origin); } catch { throw fail('The passkey answer came from an unknown page'); }
  const okHost = o.hostname === rpId || o.hostname.endsWith('.' + rpId), okProto = o.protocol === 'https:' || (o.protocol === 'http:' && o.hostname === 'localhost');
  if (!okHost || !okProto) throw fail('The passkey answer came from another page (' + o.origin + ')');
  return c;
}
function checkAuth(ad, rpId) {
  if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(rpId))) throw fail('This passkey belongs to another address');
  if (!ad.up) throw fail('The passkey was not confirmed on the device');
}

/** A new passkey: returns what to keep ({ pk, alg, count }). */
function register(b, { challenge, rpId }) {
  clientData(b.clientDataJSON, 'webauthn.create', challenge, rpId);
  const ad = authData(unb64u(b.authenticatorData)); checkAuth(ad, rpId);
  const alg = +b.alg; if (!(String(alg) in ALGS)) throw fail('This passkey uses a kind of key that is not supported');
  let key; try { key = crypto.createPublicKey({ key: unb64u(b.publicKey), format: 'der', type: 'spki' }); } catch { throw fail('Your browser did not give the passkey\'s key. Update the browser and try again.'); }
  return { pk: b64u(key.export({ format: 'der', type: 'spki' })), alg, count: ad.count };
}
/** Signing in with a stored passkey: returns its new signature count. */
function verify(b, cred, { challenge, rpId }) {
  const cd = unb64u(b.clientDataJSON); clientData(b.clientDataJSON, 'webauthn.get', challenge, rpId);
  const raw = unb64u(b.authenticatorData), ad = authData(raw); checkAuth(ad, rpId);
  const key = crypto.createPublicKey({ key: unb64u(cred.pk), format: 'der', type: 'spki' }), data = Buffer.concat([raw, sha256(cd)]);
  const ok = crypto.verify(ALGS[String(cred.alg)], data, key.asymmetricKeyType === 'rsa' ? { key, padding: crypto.constants.RSA_PKCS1_PADDING } : key, unb64u(b.signature));
  if (!ok) throw fail('The passkey signature is not right');
  // A count that goes backwards means a copied key; 0 means the device does not count (most synced passkeys).
  if (ad.count && cred.count && ad.count <= cred.count) throw fail('This passkey looks copied. Remove it under Account and add it again.');
  return { count: ad.count };
}
module.exports = { register, verify, b64u, unb64u, sha256, authData };
