// Web Push without dependencies: what lets the installed web app (and any browser that allows it) show notifications
// while the page is closed. The message is encrypted for that one browser (RFC 8291, "aes128gcm" of RFC 8188) and the
// server signs who it is with a VAPID key (RFC 8292). The browser's own push service (Google's, Mozilla's, Apple's)
// passes it on; it cannot read it.
'use strict';
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** A new VAPID key pair: { pub (the 65-byte point, base64url, for the browser), priv (PKCS#8 PEM) }. */
function keys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { pub: b64u(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), priv: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}

/** The encrypted body for one subscription ({ p256dh, auth } from the browser). */
function encrypt(payload, sub) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  if (ua.length !== 65 || auth.length < 16) throw new Error('Bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const as = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  // IKM from the shared secret and the browser's auth secret, then the content key and nonce from it and the salt.
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, as, body]);
}

/** The Authorization header: a JWT signed with the VAPID key, for the push service at that endpoint. */
function vapid(endpoint, k, subject) {
  const aud = new URL(endpoint).origin, h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const c = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject || 'mailto:admin@localhost' }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + c), { key: k.priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${k.pub}`;
}

/** Sends one message. Resolves { ok, gone } (gone: the browser unsubscribed, so forget it). */
async function send(sub, message, k, { subject, ttl = 86400, timeout = 15000 } = {}) {
  const r = await fetch(sub.endpoint, { method: 'POST', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: vapid(sub.endpoint, k, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal' },
    body: encrypt(JSON.stringify(message), sub) });
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}

/** For tests: what a browser would do to read a message (its private key, auth secret, and the body). */
function decrypt(body, uaPriv, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPriv); const ua = ecdh.getPublicKey(), shared = ecdh.computeSecret(as);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])])), prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return pt.subarray(0, pt.lastIndexOf(2)).toString();
}

module.exports = { keys, encrypt, decrypt, vapid, send, b64u, unb64u };
