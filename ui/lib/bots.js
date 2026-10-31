// Requests from Telegram and Discord. People link their chat account to their GoatMediaStackarr profile once
// (a code from Account), then ask for a movie or show by name, pick it from the posters, and hear in the chat when it
// is ready. Everything a chat asks for goes through the same API, with the same rights, limits and approval, as the
// web page. GoatMediaStackarr, Copyright (C) 2026 bdlnaredi, GPL-3.0-or-later. No dependencies (Node 22's fetch and WebSocket).
'use strict';

// o.cfg()                  -> { telegram: { token }, discord: { token } }
// o.userFor(kind, chatId)  -> the linked profile, or null
// o.link(kind, chatId, code, name) -> the profile the code belongs to (and links it), or null
// o.api(user, method, path, body) -> { status, data }, as that profile
// o.log(text)
function create(o) {
  const picks = new Map();   // what a search offered, so a tap on "Request" knows the title, year and poster
  const remember = x => { const k = x.mediaType + ':' + x.id; picks.set(k, x); if (picks.size > 500) picks.delete(picks.keys().next().value); return k; };
  const HELP = 'Send the name of a movie or show (or /request name) and pick it from the list. /requests shows yours. /link CODE links this chat to your GoatMediaStackarr profile (the code is under Account → Chat apps).';
  const STAT = { 2: 'requested', 3: 'being downloaded', 4: 'partly in the library', 5: 'in the library' };

  // One message from a chat: what to answer. { text, items?: [{ key, title, year, poster, overview, can, note }] }
  async function talk(kind, chatId, name, text) {
    text = String(text || '').trim();
    const cmd = (text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s) || []).slice(1);
    if (cmd[0] === 'start' || cmd[0] === 'help') return { text: 'Hi! ' + HELP };
    if (cmd[0] === 'link') {
      const u = await o.link(kind, chatId, cmd[1].trim(), name);
      return { text: u ? `Linked to ${u.name}. ${HELP}` : 'That code is not right or too old. Get a new one under Account → Chat apps.' };
    }
    const u = o.userFor(kind, chatId);
    if (!u) return { text: 'This chat is not linked yet. In GoatMediaStackarr open Account → Chat apps, get a code and send /link CODE here.' };
    if (cmd[0] === 'requests' || cmd[0] === 'status') {
      const r = await o.api(u, 'GET', '/api/requests');
      if (r.status !== 200) return { text: r.data.error || 'Could not get your requests.' };
      const l = r.data.filter(x => x.uid === u.id).slice(0, 8);
      const st = { pending: 'waiting for approval', approved: 'approved', searching: 'looking for a download', downloading: 'downloading', importing: 'copying to the library', library: 'in the library', available: 'ready to watch', declined: 'declined', failed: 'download failed', partial: 'partly ready' };
      return { text: l.length ? 'Your latest requests:\n' + l.map(x => `• ${x.title}${x.year ? ' (' + x.year + ')' : ''}: ${st[x.stage || x.status] || x.stage || x.status}`).join('\n') : 'You have not asked for anything yet.' };
    }
    const q = cmd[0] === 'request' || cmd[0] === 'r' ? cmd[1] : cmd.length ? '' : text;
    if (!q) return { text: HELP };
    const sv = await o.api(u, 'GET', '/api/services'), seerr = sv.status === 200 && sv.data.find(x => x.type === 'seerr');
    if (!seerr) return { text: 'Asking for things needs Seerr, and your profile cannot use it.' };
    const r = await o.api(u, 'GET', `/api/seerr/search?sid=${encodeURIComponent(seerr.id)}&term=${encodeURIComponent(q.slice(0, 100))}`);
    if (r.status !== 200) return { text: r.data.error || 'Search failed.' };
    const items = r.data.slice(0, 5).map(x => ({ key: remember({ ...x, sid: seerr.id }), title: x.title, year: x.year, poster: x.poster, overview: String(x.overview || '').slice(0, 220),
      kind: x.mediaType === 'tv' ? 'Show' : 'Movie', can: !x.status || x.status === 1, note: STAT[x.status] || '' }));
    return items.length ? { text: `Found ${items.length} for "${q}":`, items } : { text: `Nothing found for "${q}".` };
  }
  // A tap on "Request".
  async function ask(kind, chatId, key) {
    const u = o.userFor(kind, chatId); if (!u) return 'This chat is not linked yet.';
    const x = picks.get(key); if (!x) return 'That list is too old; search again.';
    const r = await o.api(u, 'POST', '/api/requests', { sid: x.sid, mediaType: x.mediaType, mediaId: x.id, title: x.title, year: x.year, poster: x.poster, via: kind });
    if (r.status !== 200) return r.data.error || 'Could not ask for it.';
    return r.data.status === 'pending' ? `Asked for ${x.title}. An admin needs to approve it; you will hear here.` : `Asked for ${x.title}. You will hear here when it is ready to watch.`;
  }

  // ---------- Telegram: long polling, so it works behind a home router without opening any port ----------
  const TG = () => (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
  let tg = { token: '', stop: true, off: 0 };
  const tgCall = async (token, method, body, ms = 20000) => {
    const r = await fetch(`${TG()}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) });
    const d = await r.json().catch(() => ({})); if (!d.ok) throw new Error(d.description || 'Telegram said no (' + r.status + ')'); return d.result;
  };
  async function tgReply(token, chat, out) {
    await tgCall(token, 'sendMessage', { chat_id: chat, text: out.text });
    for (const it of out.items || []) {
      const caption = `${it.title}${it.year ? ' (' + it.year + ')' : ''} · ${it.kind}${it.note ? '\nAlready ' + it.note + '.' : ''}${it.overview ? '\n\n' + it.overview : ''}`.slice(0, 1000);
      const kb = it.can ? { reply_markup: { inline_keyboard: [[{ text: 'Request ' + it.title.slice(0, 40), callback_data: 'rq|' + it.key }]] } } : {};
      if (it.poster) await tgCall(token, 'sendPhoto', { chat_id: chat, photo: it.poster, caption, ...kb }).catch(() => tgCall(token, 'sendMessage', { chat_id: chat, text: caption, ...kb }));
      else await tgCall(token, 'sendMessage', { chat_id: chat, text: caption, ...kb });
    }
  }
  async function tgLoop(me) {
    while (!me.stop) {
      let ups;
      try { ups = await tgCall(me.token, 'getUpdates', { offset: me.off, timeout: +process.env.TELEGRAM_POLL_S || 50, allowed_updates: ['message', 'callback_query'] }, 70000); }
      catch (e) { if (!me.stop) { me.error = e.message; await new Promise(r => setTimeout(r, +process.env.BOT_RETRY_MS || 15000)); } continue; }
      me.error = ''; me.ok = Date.now();
      for (const up of ups || []) {
        me.off = up.update_id + 1;
        try {
          if (up.message && up.message.text && up.message.chat && up.message.chat.type === 'private') {
            const m = up.message; await tgReply(me.token, m.chat.id, await talk('telegram', String(m.chat.id), (m.from || {}).first_name || '', m.text));
          } else if (up.callback_query) {
            const c = up.callback_query, chat = String(((c.message || {}).chat || {}).id || (c.from || {}).id);
            const key = String(c.data || '').replace(/^rq\|/, ''), txt = await ask('telegram', chat, key);
            await tgCall(me.token, 'answerCallbackQuery', { callback_query_id: c.id, text: txt.slice(0, 190) }).catch(() => {});
            await tgCall(me.token, 'sendMessage', { chat_id: chat, text: txt });
          }
        } catch (e) { o.log('Telegram: ' + e.message); }
      }
    }
  }

  // ---------- Discord: the Gateway (no public address needed) and slash commands with buttons ----------
  const DC = () => (process.env.DISCORD_API || 'https://discord.com/api/v10').replace(/\/+$/, '');
  let dc = { token: '', stop: true };
  const dcCall = async (token, method, path, body) => {
    const r = await fetch(DC() + path, { method, headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || 'Discord said no (' + r.status + ')'); return d;
  };
  const dcMessage = out => ({ content: out.text.slice(0, 1900), flags: 64,
    embeds: (out.items || []).map((it, i) => ({ title: `${i + 1}. ${it.title}${it.year ? ' (' + it.year + ')' : ''}`.slice(0, 250), description: (`${it.kind}${it.note ? ' · already ' + it.note : ''}\n${it.overview}`).slice(0, 400), ...(it.poster ? { thumbnail: { url: it.poster } } : {}) })),
    components: (out.items || []).some(it => it.can) ? [{ type: 1, components: (out.items || []).map((it, i) => it.can ? { type: 2, style: 1, label: `${i + 1}. ${it.title}`.slice(0, 80), custom_id: 'rq|' + it.key } : null).filter(Boolean).slice(0, 5) }] : [] });
  const COMMANDS = [
    { name: 'request', description: 'Ask for a movie or show', options: [{ type: 3, name: 'title', description: 'What to look for', required: true }] },
    { name: 'requests', description: 'Your latest requests' },
    { name: 'link', description: 'Link Discord to your GoatMediaStackarr profile', options: [{ type: 3, name: 'code', description: 'The code from Account → Chat apps', required: true }] }];
  async function dcInteraction(me, it) {
    const who = String(((it.member || {}).user || it.user || {}).id || ''), name = ((it.member || {}).user || it.user || {}).username || '';
    await dcCall(me.token, 'POST', `/interactions/${it.id}/${it.token}/callback`, { type: it.type === 3 ? 5 : 5, data: { flags: 64 } });
    let msg;
    try {
      if (it.type === 2) { const d = it.data || {}, opt = ((d.options || [])[0] || {}).value || '';
        msg = dcMessage(await talk('discord', who, name, d.name === 'request' ? '/request ' + opt : d.name === 'link' ? '/link ' + opt : '/requests')); }
      else if (it.type === 3) msg = { content: await ask('discord', who, String((it.data || {}).custom_id || '').replace(/^rq\|/, '')), flags: 64 };
    } catch (e) { msg = { content: 'Something went wrong: ' + e.message, flags: 64 }; }
    if (msg) await dcCall(me.token, 'PATCH', `/webhooks/${it.application_id}/${it.token}/messages/@original`, msg);
  }
  function dcConnect(me) {
    if (me.stop || typeof WebSocket !== 'function') return;
    let hb = null, seq = null;
    const ws = new WebSocket(process.env.DISCORD_GATEWAY || 'wss://gateway.discord.gg/?v=10&encoding=json'); me.ws = ws;
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.s != null) seq = m.s;
      if (m.op === 10) {
        hb = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: seq })); } catch {} }, m.d.heartbeat_interval);
        ws.send(JSON.stringify({ op: 2, d: { token: me.token, intents: 0, properties: { os: 'linux', browser: 'GoatMediaStackarr', device: 'GoatMediaStackarr' } } }));
      } else if (m.op === 1) ws.send(JSON.stringify({ op: 1, d: seq }));
      else if (m.op === 0 && m.t === 'READY') {
        me.error = ''; me.ok = Date.now(); me.app = m.d.application && m.d.application.id; me.name = (m.d.user || {}).username || '';
        try { await dcCall(me.token, 'PUT', `/applications/${me.app}/commands`, COMMANDS); } catch (e) { me.error = 'Could not add the commands: ' + e.message; }
      } else if (m.op === 0 && m.t === 'INTERACTION_CREATE') dcInteraction(me, m.d).catch(e => o.log('Discord: ' + e.message));
      else if (m.op === 9 || m.op === 7) { try { ws.close(); } catch {} }
    };
    ws.onclose = ev => { clearInterval(hb); if (ev && ev.code === 4004) { me.error = 'Discord did not accept the bot token.'; me.stop = true; return; } if (!me.stop) setTimeout(() => dcConnect(me), +process.env.BOT_RETRY_MS || 15000); };
    ws.onerror = () => { me.error = me.error || 'Could not reach Discord.'; };
  }

  /** Starts, restarts or stops each bot to match the saved settings. */
  function sync() {
    const c = o.cfg() || {}, t = (c.telegram || {}).token || '', d = (c.discord || {}).token || '';
    if (t !== tg.token) { tg.stop = true; tg = { token: t, stop: !t, off: 0 }; if (t) tgLoop(tg).catch(e => o.log('Telegram stopped: ' + e.message)); }
    if (d !== dc.token) { dc.stop = true; try { dc.ws && dc.ws.close(); } catch {} dc = { token: d, stop: !d }; if (d) dcConnect(dc); }
  }
  const state = () => ({ telegram: { on: !!tg.token, ok: !!tg.ok && !tg.error, error: tg.error || '' }, discord: { on: !!dc.token, ok: !!dc.ok && !dc.error, error: dc.error || '', name: dc.name || '', invite: dc.app ? `https://discord.com/oauth2/authorize?client_id=${dc.app}&scope=bot%20applications.commands&permissions=0` : '' } });
  /** A message to one linked chat (request approved, ready to watch). */
  async function tell(kind, chatId, text) {
    if (kind === 'telegram' && tg.token) return tgCall(tg.token, 'sendMessage', { chat_id: chatId, text });
    if (kind === 'discord' && dc.token) { const ch = await dcCall(dc.token, 'POST', '/users/@me/channels', { recipient_id: chatId }); return dcCall(dc.token, 'POST', `/channels/${ch.id}/messages`, { content: text.slice(0, 1900) }); }
  }
  async function check(kind, token) {
    if (kind === 'telegram') { const me = await tgCall(token, 'getMe', {}); return '@' + me.username; }
    const me = await dcCall(token, 'GET', '/users/@me'); return me.username;
  }
  const stop = () => { tg.stop = true; dc.stop = true; try { dc.ws && dc.ws.close(); } catch {} };
  return { sync, state, tell, check, stop, talk, ask };
}

module.exports = { create };
