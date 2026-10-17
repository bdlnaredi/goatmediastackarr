// A small SMTP client (no dependencies) for sending alert emails.
const net = require('net'), tls = require('tls'), os = require('os'), crypto = require('crypto');
const ADDR = /^[^\s<>"',;\r\n]+@[^\s<>"',;\r\n]+$/;
const split = s => String(s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);

function sendMail(o) {
  return new Promise((resolve, reject) => {
    const to = split(o.to), from = String(o.from || '').trim();
    if (!ADDR.test(from) || !to.length || !to.every(a => ADDR.test(a))) return reject(new Error('Check the from and to email addresses'));
    const port = +o.port || (o.secure === 'ssl' ? 465 : o.secure === 'starttls' ? 587 : 25);
    let sock, buf = '', waiter = null, done = false;
    const fail = e => { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('The mail server took too long to answer')), o.timeout || 20000);
    const check = () => {
      if (!waiter) return;
      const lines = buf.split('\r\n'); lines.pop();               // the last piece may be incomplete
      if (!lines.length || !/^\d{3} /.test(lines[lines.length - 1])) return;
      const w = waiter; waiter = null; buf = '';
      w.res({ code: +lines[0].slice(0, 3), text: lines.join('\n') });
    };
    const hook = s => { s.on('data', d => { buf += d.toString('utf8'); check(); }); s.on('error', fail); s.on('close', () => { if (!done && waiter) fail(new Error('The mail server closed the connection')); }); };
    const reply = () => new Promise(res => { waiter = { res }; check(); });
    const cmd = async (line, ok) => { sock.write(line + '\r\n'); const r = await reply(); if (!ok.includes(r.code)) throw new Error('Mail server said: ' + r.text.split('\n').pop().slice(4)); return r; };
    const run = async () => {
      const r0 = await reply(); if (r0.code !== 220) throw new Error('Mail server said: ' + r0.text.slice(4));
      let ehlo = await cmd('EHLO ' + (os.hostname() || 'mediahub'), [250]);
      if (o.secure === 'starttls') {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data'); const raw = sock;
        sock = tls.connect({ socket: raw, servername: o.host, rejectUnauthorized: o.insecure ? false : true }); hook(sock);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
        ehlo = await cmd('EHLO ' + (os.hostname() || 'mediahub'), [250]);
      }
      if (o.user) await cmd('AUTH PLAIN ' + Buffer.from('\0' + o.user + '\0' + (o.pass || '')).toString('base64'), [235]);
      await cmd('MAIL FROM:<' + from + '>', [250]);
      for (const a of to) await cmd('RCPT TO:<' + a + '>', [250, 251]);
      await cmd('DATA', [354]);
      const subj = /^[\x20-\x7e]*$/.test(o.subject) ? o.subject : '=?UTF-8?B?' + Buffer.from(o.subject).toString('base64') + '?=';
      const b64 = t => Buffer.from(String(t || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
      const head = ['From: ' + from, 'To: ' + to.join(', '), 'Subject: ' + String(subj).replace(/[\r\n]/g, ' '), 'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + crypto.randomBytes(8).toString('hex') + '@mediahub>', 'MIME-Version: 1.0'];
      let msg;
      if (o.html) {
        const bd = '=_mh_' + crypto.randomBytes(8).toString('hex');
        msg = [...head, 'Content-Type: multipart/alternative; boundary="' + bd + '"', '',
          '--' + bd, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(o.text),
          '--' + bd, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(o.html), '--' + bd + '--'].join('\r\n');
      } else msg = [...head, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(o.text)].join('\r\n');
      sock.write(msg + '\r\n.\r\n'); const r = await reply(); if (r.code !== 250) throw new Error('Mail server said: ' + r.text.split('\n').pop().slice(4));
      try { sock.write('QUIT\r\n'); } catch {}
    };
    const connected = () => { hook(sock); run().then(() => { done = true; clearTimeout(timer); try { sock.end(); } catch {} resolve(true); }).catch(fail); };
    try {
      if (o.secure === 'ssl') { sock = tls.connect({ host: o.host, port, servername: o.host, rejectUnauthorized: o.insecure ? false : true }, connected); sock.on('error', fail); }
      else { sock = net.connect({ host: o.host, port }, connected); sock.on('error', fail); }
    } catch (e) { fail(e); }
  });
}
module.exports = { sendMail, split, ADDR };
