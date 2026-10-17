// Sends a message to one alert channel. Types: ntfy, discord, telegram, pushover, gotify, webhook, email.
const { sendMail } = require('./smtp');
const TYPES = ['ntfy', 'discord', 'telegram', 'pushover', 'gotify', 'webhook', 'email'];
const asciiHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';

async function http(url, opt) {
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000), ...opt });
  if (!r.ok) throw new Error('The notification service answered ' + r.status);
}
const json = { 'Content-Type': 'application/json' };

async function send(ch, title, body, html) {
  const t = String(title || ''), b = String(body || '');
  switch (ch.type) {
    case 'ntfy': return http(ch.target, { headers: { Title: asciiHeader(t) }, body: b });
    case 'discord': return http(ch.target, { headers: json, body: JSON.stringify({ content: `**${t}**\n${b}` }) });
    case 'telegram': return http(`https://api.telegram.org/bot${ch.token}/sendMessage`, { headers: json, body: JSON.stringify({ chat_id: ch.chat, text: `${t}\n${b}` }) });
    case 'pushover': return http('https://api.pushover.net/1/messages.json', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: ch.token, user: ch.chat, title: t, message: b }) });
    case 'gotify': return http(`${String(ch.target).replace(/\/+$/, '')}/message?token=${encodeURIComponent(ch.token)}`, { headers: json, body: JSON.stringify({ title: t, message: b, priority: 5 }) });
    case 'webhook': return http(ch.target, { headers: json, body: JSON.stringify({ title: t, message: b }) });
    case 'email': return sendMail({ host: ch.host, port: ch.port, secure: ch.secure, user: ch.user, pass: ch.pass, from: ch.from, to: ch.to, insecure: !!ch.insecure, subject: t, text: b, html });
    default: throw new Error('Unknown channel type');
  }
}
// What to check before saving a channel. Returns an error text or ''.
function problem(c) {
  const url = v => /^https?:\/\//i.test(v || '');
  if (!TYPES.includes(c.type)) return 'Pick a channel type';
  if (['ntfy', 'discord', 'webhook'].includes(c.type) && !url(c.target)) return 'Enter the web address (it starts with http)';
  if (c.type === 'gotify' && (!url(c.target) || !c.token)) return 'Enter your Gotify address and app token';
  if (c.type === 'telegram' && (!c.token || !c.chat)) return 'Enter the bot token and chat ID';
  if (c.type === 'pushover' && (!c.token || !c.chat)) return 'Enter the app token and your user key';
  if (c.type === 'email' && (!c.host || !c.from || !c.to)) return 'Enter the mail server, from address and to address';
  return '';
}
module.exports = { send, problem, TYPES };
