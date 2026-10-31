#!/usr/bin/env node
// Fetches web pages for GoatMediaStackarr's site browser. It runs in the VPN group (see engine.sh), so everything it
// fetches goes through the VPN tunnel, and the kill switch stops it when the tunnel is down. It only listens on
// 127.0.0.1, and only does what the interface asks: one request in, one answer back.
//
// POST /fetch   headers: X-Goat-Url, X-Goat-Method, X-Goat-Headers (base64 JSON)   body: the request body
// answer:       200 with X-Goat-Status, X-Goat-Headers (base64 JSON; set-cookie as a list) and the body.
//               The body is passed on as it arrives, so the first bytes reach the phone without waiting for the rest.
'use strict';
const http = require('http');
const { Readable } = require('stream');
const PORT = +process.env.SITEFETCH_PORT || 8899, MAX = 40e6;

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => { try { return JSON.parse(Buffer.from(String(s || ''), 'base64').toString()); } catch { return {}; } };

http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.method !== 'POST' || req.url !== '/fetch') { res.writeHead(404); return res.end(); }
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    const url = String(req.headers['x-goat-url'] || ''), method = String(req.headers['x-goat-method'] || 'GET').toUpperCase();
    if (!/^https?:\/\//i.test(url)) { res.writeHead(400); return res.end('bad url'); }
    const body = ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks);
    try {
      const headers = unb64(req.headers['x-goat-headers']);
      if (process.env.SITEFETCH_TAG) headers['x-goat-tag'] = process.env.SITEFETCH_TAG; // tests only: shows a request came this way
      const r = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(120000) });
      const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie' && k !== 'content-length' && k !== 'content-encoding') h[k] = v; });
      h['set-cookie'] = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      res.writeHead(200, { 'X-Goat-Status': String(r.status), 'X-Goat-Headers': b64(h), 'Content-Type': 'application/octet-stream' });
      if (!r.body) return res.end();
      const out = Readable.fromWeb(r.body);
      out.on('error', () => res.destroy()); res.on('close', () => out.destroy());
      out.pipe(res);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(String((e.cause && (e.cause.code || e.cause.message)) || e.message || 'failed'));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[sitefetch] ready on 127.0.0.1:${PORT}`));

// ---------- DNS for the VPN apps when the container asks Docker's own resolver (127.0.0.11) ----------
// On a Docker network of its own (docker compose, Docker Desktop) the apps ask 127.0.0.11. Their questions are sent
// here instead (vpn.sh), and passed on to the VPN's DNS server: this process is a VPN app, so they go through the
// tunnel. UDP and TCP, one question in, one answer back.
const dgram = require('dgram'), net = require('net'), fs = require('fs');
const DNS_PORT = +process.env.GOAT_DNS_PORT || 5335;
const vpnDns = () => { try { return fs.readFileSync('/run/goat/vpn-dns', 'utf8').trim() || '1.1.1.1'; } catch { return '1.1.1.1'; } };
const udp = dgram.createSocket('udp4');
udp.on('message', (msg, from) => {
  const up = dgram.createSocket('udp4'), t = setTimeout(() => up.close(), 6000);
  up.on('message', ans => { clearTimeout(t); udp.send(ans, from.port, from.address); up.close(); });
  up.on('error', () => { clearTimeout(t); try { up.close(); } catch {} });
  up.send(msg, 53, vpnDns());
});
udp.on('error', e => console.error('[sitefetch] DNS (udp):', e.message));
udp.bind(DNS_PORT, '127.0.0.1');
net.createServer(c => {
  const up = net.connect(53, vpnDns()); up.setTimeout(10000, () => up.destroy());
  c.pipe(up).pipe(c); up.on('error', () => c.destroy()); c.on('error', () => up.destroy());
}).on('error', e => console.error('[sitefetch] DNS (tcp):', e.message)).listen(DNS_PORT, '127.0.0.1');
