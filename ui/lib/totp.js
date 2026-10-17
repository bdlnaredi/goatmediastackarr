// Time-based one-time passwords (RFC 6238) using only Node's crypto module.
const crypto = require('crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32enc(buf) {
  let bits = 0, v = 0, out = '';
  for (const b of buf) {
    v = (v << 8) | b; bits += 8;
    while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; }
    v &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(v << (5 - bits)) & 31];
  return out;
}
function b32dec(s) {
  let bits = 0, v = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    v = (v << 5) | A.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
    v &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}
function hotp(key, counter, digits = 6) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const newSecret = () => b32enc(crypto.randomBytes(20));
const totp = (secret, t = Date.now(), step = 30) => hotp(b32dec(secret), Math.floor(t / 1000 / step));
// Returns the matching time step (so it can be remembered and not reused), or 0 if the code is wrong.
function verify(secret, code, t = Date.now(), lastUsed = 0, window = 1) {
  const c = String(code || '').replace(/\s/g, ''), now = Math.floor(t / 1000 / 30), key = b32dec(secret);
  if (!/^\d{6}$/.test(c)) return 0;
  for (let i = -window; i <= window; i++) {
    const step = now + i;
    if (step > lastUsed && crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return 0;
}
const uri = (secret, account, issuer = 'MediaHub') => `otpauth://totp/${encodeURIComponent(issuer + ':' + account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
function recoveryCodes(n = 8) {
  const al = 'abcdefghjkmnpqrstuvwxyz23456789', pick = () => al[crypto.randomInt(al.length)];
  return Array.from({ length: n }, () => Array.from({ length: 4 }, pick).join('') + '-' + Array.from({ length: 4 }, pick).join(''));
}
module.exports = { b32enc, b32dec, hotp, totp, verify, newSecret, uri, recoveryCodes };
