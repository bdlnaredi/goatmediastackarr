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
function clientData(raw, type, challenge, rpId, apps = []) {
  let c; try { c = JSON.parse(unb64u(raw).toString('utf8')); } catch { throw fail('The passkey answer could not be read'); }
  if (c.type !== type) throw fail('The passkey answer is of the wrong kind');
  const a = unb64u(c.challenge), b = unb64u(challenge);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail('The passkey answer does not match this sign-in. Please try again.');
  // The Android app: its origin is the hash of its signing key, which must be one we know.
  const am = /^android:apk-key-hash:([\w-]+)$/.exec(String(c.origin || ''));
  if (am) { if (!apps.includes(am[1].replace(/=+$/, ''))) throw fail('The passkey answer came from an app this server does not know'); return c; }
  let o; try { o = new URL(c.origin); } catch { throw fail('The passkey answer came from an unknown page'); }
  const okHost = o.hostname === rpId || o.hostname.endsWith('.' + rpId), okProto = o.protocol === 'https:' || (o.protocol === 'http:' && o.hostname === 'localhost');
  if (!okHost || !okProto) throw fail('The passkey answer came from another page (' + o.origin + ')');
  return c;
}
function checkAuth(ad, rpId) {
  if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(rpId))) throw fail('This passkey belongs to another address');
  if (!ad.up) throw fail('The passkey was not confirmed on the device');
}


// A small CBOR reader, enough for an attestation object: maps, arrays, byte and text strings, numbers.
function cbor(buf) {
  let i = 0;
  const len = ai => { if (ai < 24) return ai; if (ai === 24) return buf[i++]; if (ai === 25) { const v = buf.readUInt16BE(i); i += 2; return v; } if (ai === 26) { const v = buf.readUInt32BE(i); i += 4; return v; } if (ai === 27) { const v = Number(buf.readBigUInt64BE(i)); i += 8; return v; } throw fail('The passkey data could not be read'); };
  const item = depth => {
    if (depth > 8 || i >= buf.length) throw fail('The passkey data could not be read');
    const b = buf[i++], mt = b >> 5, ai = b & 31;
    if (mt === 0) return len(ai);
    if (mt === 1) return -1 - len(ai);
    if (mt === 2 || mt === 3) { const n = len(ai); if (i + n > buf.length) throw fail('The passkey data could not be read'); const v = buf.subarray(i, i + n); i += n; return mt === 2 ? v : v.toString('utf8'); }
    if (mt === 4) { const n = len(ai), a = []; for (let k = 0; k < n; k++) a.push(item(depth + 1)); return a; }
    if (mt === 5) { const n = len(ai), m = new Map(); for (let k = 0; k < n; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
    if (mt === 7) return ai === 20 ? false : ai === 21 ? true : null;
    throw fail('The passkey data could not be read');
  };
  const v = item(0); return { v, end: i };
}
// attestationObject → authData → the credential's COSE key → a key Node can check signatures with.
function fromAttestation(att) {
  const o = cbor(att).v, authData = o instanceof Map ? o.get('authData') : null;
  if (!Buffer.isBuffer(authData) || authData.length < 55 || !(authData[32] & 64)) throw fail('The passkey data has no key');
  const n = authData.readUInt16BE(53), c = cbor(authData.subarray(55 + n)).v;
  if (!(c instanceof Map)) throw fail('The passkey key could not be read');
  const kty = c.get(1), alg = c.get(3), b = k => Buffer.from(c.get(k) || []).toString('base64url');
  let jwk;
  if (kty === 2 && c.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b(-2), y: b(-3) };
  else if (kty === 3) jwk = { kty: 'RSA', n: b(-1), e: b(-2) };
  else if (kty === 1 && c.get(-1) === 6) jwk = { kty: 'OKP', crv: 'Ed25519', x: b(-2) };
  else throw fail('This passkey uses a kind of key that is not supported');
  return { authData, key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg };
}

/** A new passkey: returns what to keep ({ pk, alg, count }). */
function register(b, { challenge, rpId, apps }) {
  clientData(b.clientDataJSON, 'webauthn.create', challenge, rpId, apps);
  // Browsers hand over the key directly; otherwise (Android) it is read from the attestation object.
  let raw = b.authenticatorData ? unb64u(b.authenticatorData) : null, key = null, alg = +b.alg;
  if (b.publicKey) { try { key = crypto.createPublicKey({ key: unb64u(b.publicKey), format: 'der', type: 'spki' }); } catch {} }
  if ((!key || !raw) && b.attestationObject) { const k = fromAttestation(unb64u(b.attestationObject)); raw = k.authData; if (!key) { key = k.key; alg = k.alg; } }
  if (!raw) throw fail('The passkey answer is missing its data');
  const ad = authData(raw); checkAuth(ad, rpId);
  if (!(String(alg) in ALGS)) throw fail('This passkey uses a kind of key that is not supported');
  if (!key) throw fail('The device did not give the passkey\'s key. Update it and try again.');
  return { pk: b64u(key.export({ format: 'der', type: 'spki' })), alg, count: ad.count };
}
/** Signing in with a stored passkey: returns its new signature count. */
function verify(b, cred, { challenge, rpId, apps }) {
  const cd = unb64u(b.clientDataJSON); clientData(b.clientDataJSON, 'webauthn.get', challenge, rpId, apps);
  const raw = unb64u(b.authenticatorData), ad = authData(raw); checkAuth(ad, rpId);
  const key = crypto.createPublicKey({ key: unb64u(cred.pk), format: 'der', type: 'spki' }), data = Buffer.concat([raw, sha256(cd)]);
  const ok = crypto.verify(ALGS[String(cred.alg)], data, key.asymmetricKeyType === 'rsa' ? { key, padding: crypto.constants.RSA_PKCS1_PADDING } : key, unb64u(b.signature));
  if (!ok) throw fail('The passkey signature is not right');
  // A count that goes backwards means a copied key; 0 means the device does not count (most synced passkeys).
  if (ad.count && cred.count && ad.count <= cred.count) throw fail('This passkey looks copied. Remove it under Account and add it again.');
  return { count: ad.count };
}
module.exports = { register, verify, b64u, unb64u, sha256, authData, cbor };
