#!/usr/bin/env node
// A pretend rclone for the tests: the few commands lib/cloud.js uses, with a folder standing in for the cloud.
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = process.env.FAKE_CLOUD, a = process.argv.slice(2), port = +process.env.CLOUD_AUTH_PORT || 53682;
const at = s => path.join(ROOT, String(s).replace(/^goatcloud:/, ''));
const conf = process.env.RCLONE_CONFIG;
if (a[0] === 'authorize') {
  const st = 'st' + Date.now();
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/auth') { r.writeHead(307, { Location: `https://accounts.example/o/oauth2/auth?state=${st}&scope=${a[2] ? JSON.parse(Buffer.from(a[2], 'base64url')).scope : 'all'}` }); return r.end(); }
    r.end('Success!');
    if (u.searchParams.get('state') !== st) { console.error('ERROR: state mismatch'); process.exit(1); }
    if (u.searchParams.get('code') === 'bad') { console.error('Fatal error: failed to get token: invalid_grant'); process.exit(1); }
    console.log('Paste the following into your remote machine --->\n{"access_token":"at","token_type":"Bearer","refresh_token":"rt","expiry":"2030-01-01T00:00:00Z"}\n<---End paste'); setTimeout(() => process.exit(0), 50);
  }).listen(port, '127.0.0.1', () => console.error(`NOTICE: Please go to the following link: http://127.0.0.1:${port}/auth?state=${st}`));
} else if (a[0] === 'config' && a[1] === 'create') {
  fs.writeFileSync(conf, `[goatcloud]\ntype = iclouddrive\n${a.filter(x => x.includes('=')).join('\n')}\n`);
  console.log(JSON.stringify({ State: '*2fa', Option: { Name: 'config_2fa', Help: 'Two-factor authentication: please enter your 2FA code' }, Error: '' }));
} else if (a[0] === 'config' && a[1] === 'update') {
  const code = a[a.indexOf('--result') + 1];
  if (code !== '123456') console.log(JSON.stringify({ State: '*2fa', Option: { Name: 'config_2fa' }, Error: 'wrong code' }));
  else { fs.appendFileSync(conf, 'trust_token = t\n'); console.log(JSON.stringify({ State: '', Option: null, Error: '' })); }
} else if (a[0] === 'copyto') { fs.mkdirSync(path.dirname(at(a[2])), { recursive: true }); fs.copyFileSync(a[1], at(a[2])); }
else if (a[0] === 'lsjson') { const d = at(a[1]); if (!fs.existsSync(d)) { console.error('ERROR: directory not found'); process.exit(3); }
  console.log(JSON.stringify(fs.readdirSync(d).map(n => ({ Name: n, Size: fs.statSync(path.join(d, n)).size, ModTime: new Date().toISOString() })))); }
else if (a[0] === 'deletefile') fs.unlinkSync(at(a[1]));
else { console.error('ERROR: unknown command ' + a.join(' ')); process.exit(1); }
