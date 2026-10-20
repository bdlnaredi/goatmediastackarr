// ruTorrent (rTorrent) and Deluge as download clients, shaped like qBittorrent so the Downloads page, the phone app
// and everything else that lists torrents can use them unchanged.
//
// ruTorrent: rTorrent's own XML-RPC commands, sent through ruTorrent's httprpc plugin
//   (/plugins/httprpc/action.php, on by default) or straight to rTorrent's /RPC2 — the same way Sonarr talks to it.
//   Labels are ruTorrent's (d.custom1, kept URL-encoded like ruTorrent does).
// Deluge: the Web UI's JSON-RPC (/json), signed in with the Web UI password; connects the Web UI to its daemon if needed.
//   Labels need Deluge's Label plugin.
//
// Each client: list(), act(action, hashes, opts), add({ urls, files, category, paused }), meta(), info(hash), test().
'use strict';

const cut = (v, n = 200) => String(v == null ? '' : v).slice(0, n);
const plain = msg => Object.assign(new Error(msg), { plain: true });
const base = s => String(s.url || '').replace(/\/+$/, '');
const auth = s => s.user ? { Authorization: 'Basic ' + Buffer.from(`${s.user}:${s.pass || ''}`).toString('base64') } : {};
const why = e => (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'failed';

// ---------- XML-RPC, just enough for rTorrent ----------
const xmlEsc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xmlValue(v) {
  if (Buffer.isBuffer(v)) return `<value><base64>${v.toString('base64')}</base64></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(xmlValue).join('')}</data></array></value>`;
  if (typeof v === 'number' && Number.isInteger(v)) return `<value><i8>${v}</i8></value>`;
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  return `<value><string>${xmlEsc(v)}</string></value>`;
}
const xmlCall = (method, params) => `<?xml version="1.0"?><methodCall><methodName>${xmlEsc(method)}</methodName><params>${params.map(p => `<param>${xmlValue(p)}</param>`).join('')}</params></methodCall>`;
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (a, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
/** Reads an XML-RPC answer into plain values. Throws on a fault. */
function xmlParse(text) {
  const t = String(text), toks = t.match(/<\/?[a-zA-Z0-9.]+\s*\/?>|[^<]+/g) || [];
  let i = 0;
  const skipWs = () => { while (i < toks.length && /^\s+$/.test(toks[i])) i++; };
  const expect = tag => { skipWs(); if (toks[i] !== tag) throw new Error(`Unexpected answer from rTorrent (wanted ${tag}, got ${String(toks[i]).slice(0, 40)})`); i++; };
  function value() {
    expect('<value>'); skipWs();
    let out;
    const tk = toks[i];
    if (tk === '</value>') { i++; return ''; }
    if (!tk.startsWith('<')) { out = unxml(tk); i++; skipWs(); expect('</value>'); return out; }
    const m = /^<([a-z0-9.]+)\s*(\/)?>$/i.exec(tk); i++;
    const type = m[1], empty = !!m[2];
    if (type === 'array') { expect('<data>'); out = []; skipWs(); while (toks[i] === '<value>') { out.push(value()); skipWs(); } expect('</data>'); expect('</array>'); }
    else if (type === 'struct') { out = {}; skipWs(); while (toks[i] === '<member>') { i++; expect('<name>'); const n = toks[i] && !toks[i].startsWith('<') ? unxml(toks[i++]) : ''; expect('</name>'); out[n] = value(); expect('</member>'); skipWs(); } expect('</struct>'); }
    else {
      let raw = '';
      if (!empty) { if (toks[i] && !toks[i].startsWith('<')) raw = unxml(toks[i++]); expect(`</${type}>`); }
      out = /^(i4|i8|int)$/.test(type) ? Number(raw) : type === 'double' ? Number(raw) : type === 'boolean' ? raw.trim() === '1' : type === 'base64' ? Buffer.from(raw.trim(), 'base64') : raw;
    }
    expect('</value>'); return out;
  }
  const at = toks.findIndex(x => x === '<fault>' || x === '<params>');
  if (at < 0) throw new Error('rTorrent sent an answer this does not understand');
  if (toks[at] === '<fault>') { i = at + 1; const f = value(); throw plain('rTorrent said: ' + cut((f && (f.faultString || f.faultCode)) || 'error', 200)); }
  i = at + 1; skipWs(); if (toks[i] === '</params>') return null;
  expect('<param>'); return value();
}

function rutorrent(s) {
  let endpoint = null;
  const candidates = () => {
    const b = base(s);
    if (/\/(RPC2|action\.php|rpc\.php)$/i.test(b)) return [b];
    return [b + '/plugins/httprpc/action.php', b + '/RPC2', b + '/plugins/rpc/rpc.php'];
  };
  async function post(url, method, params) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml', ...auth(s) }, body: xmlCall(method, params), signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw plain(`Could not reach ruTorrent at ${base(s)} (${why(e)}).`); }
    if (r.status === 401 || r.status === 403) throw plain('ruTorrent refused the username or password.');
    if (!r.ok) throw Object.assign(new Error(`ruTorrent answered ${r.status}`), { status: r.status });
    return xmlParse(await r.text());
  }
  async function call(method, ...params) {
    if (endpoint) return post(endpoint, method, params);
    let last;
    for (const u of candidates()) {
      try { const v = await post(u, method, params); endpoint = u; return v; }
      catch (e) { if (e.plain && !/answer this does not understand|Unexpected answer/.test(e.message)) throw e; last = e; }
    }
    throw plain(`ruTorrent did not answer at ${base(s)}. Use the address you open ruTorrent with (like http://192.168.1.10:8080); its httprpc plugin must be on, or give rTorrent's RPC2 address.` + (last && last.status ? ` (It answered ${last.status}.)` : ''));
  }
  // rTorrent 0.9+ calls it d.multicall2; older ones d.multicall.
  async function multi(view, fields) {
    try { return await call('d.multicall2', '', view, ...fields); }
    catch (e) { if (!/rTorrent said/.test(e.message)) throw e; return call('d.multicall', view, ...fields); }
  }
  const label = v => { try { return decodeURIComponent(String(v || '')); } catch { return String(v || ''); } };
  const F = ['d.hash=', 'd.name=', 'd.size_bytes=', 'd.completed_bytes=', 'd.down.rate=', 'd.up.rate=', 'd.ratio=', 'd.state=', 'd.is_active=', 'd.complete=',
    'd.custom1=', 'd.directory=', 'd.peers_complete=', 'd.peers_accounted=', 'd.message=', 'd.hashing=', 'd.left_bytes=', 'd.custom=addtime', 'd.priority=', 'd.free_diskspace='];
  const stateOf = x => {
    if (+x.hashing > 0) return 'checkingDL';
    const done = +x.complete === 1;
    if (+x.state === 0 || +x.active === 0) return x.message && +x.state === 0 && !done ? 'error' : done ? 'pausedUP' : 'pausedDL';
    return done ? (+x.up > 0 ? 'uploading' : 'stalledUP') : (+x.down > 0 ? 'downloading' : 'stalledDL');
  };
  async function rows() {
    const raw = await multi('main', F);
    return (raw || []).map(r => ({ hash: String(r[0]).toLowerCase(), name: r[1], size: +r[2], done: +r[3], down: +r[4], up: +r[5], ratio: +r[6] / 1000, state: r[7], active: r[8], complete: r[9],
      label: label(r[10]), dir: r[11], seeds: +r[12], peers: +r[13], message: r[14], hashing: r[15], left: +r[16], added: +r[17] || 0, prio: +r[18], free: +r[19] }));
  }
  const H = h => String(h).toUpperCase();
  return {
    kind: 'rutorrent',
    async test() { const v = await call('system.client_version'); return { version: String(v) }; },
    /** The XML-RPC address that answered (for Sonarr and Radarr, which talk to it the same way). */
    async endpoint() { if (!endpoint) await call('system.client_version'); return endpoint; },
    async list() {
      const [l, dl, ul] = await Promise.all([rows(), call('throttle.global_down.rate').catch(() => 0), call('throttle.global_up.rate').catch(() => 0)]);
      return { dl: +dl || 0, ul: +ul || 0, alt: false, torrents: l.map(x => ({ hash: x.hash, name: x.name, state: stateOf(x), progress: x.size ? x.done / x.size : 0,
        dlspeed: x.down, upspeed: x.up, size: x.size, added: x.added, eta: x.down > 0 ? Math.round(x.left / x.down) : 8640000, ratio: x.ratio, seeds: x.seeds, peers: x.peers,
        category: x.label, tags: '', path: x.dir, prio: x.prio })) };
    },
    async act(action, hashes, o = {}) {
      const all = hashes === 'all' ? (await rows()).map(x => x.hash) : hashes;
      const each = async (...cmds) => { for (const h of all) for (const c of cmds) await call(c, H(h)); };
      if (action === 'pause') return each('d.stop', 'd.close');
      if (action === 'resume' || action === 'force') return each('d.open', 'd.start');
      if (action === 'recheck') return each('d.check_hash');
      if (action === 'reannounce') return each('d.tracker_announce');
      if (action === 'category') { for (const h of all) await call('d.custom1.set', H(h), encodeURIComponent(cut(o.value, 100))); return; }
      if (action === 'delete') {
        // rTorrent cannot delete files itself; ruTorrent's erasedata plugin does it for torrents marked like this.
        for (const h of all) { if (o.files) await call('d.custom5.set', H(h), '1').catch(() => {}); await call('d.erase', H(h)); }
        return;
      }
      throw plain('ruTorrent cannot do that.');
    },
    async add({ urls = [], files = [], category = '', paused = false }) {
      const extra = category ? [`d.custom1.set=${encodeURIComponent(cut(category, 100))}`] : [];
      for (const u of urls) await call(paused ? 'load.normal' : 'load.start', '', u, ...extra);
      for (const f of files) await call(paused ? 'load.raw' : 'load.raw_start', '', f.buf, ...extra);
    },
    async meta() {
      const l = await rows();
      return { free: l.length ? l[0].free : null, categories: [...new Set(l.map(x => x.label).filter(Boolean))].sort().map(n => ({ name: n, path: '' })), tags: [] };
    },
    async info(hash) {
      const h = H(hash);
      const [props, files, trk, prs] = await Promise.all([
        Promise.all(['d.directory', 'd.size_bytes', 'd.ratio', 'd.down.total', 'd.up.total', 'd.peers_connected'].map(c => call(c, h).catch(() => 0))),
        call('f.multicall', h, '', 'f.path=', 'f.size_bytes=', 'f.completed_chunks=', 'f.size_chunks=', 'f.priority=').catch(() => []),
        call('t.multicall', h, '', 't.url=', 't.scrape_complete=', 't.scrape_incomplete=', 't.is_enabled=').catch(() => []),
        call('p.multicall', h, '', 'p.address=', 'p.client_version=', 'p.completed_percent=', 'p.down_rate=', 'p.up_rate=').catch(() => [])]);
      return { props: { path: props[0], size: +props[1], added: 0, done: 0, ratio: +props[2] / 1000, down: +props[3], up: +props[4], seedTime: 0, comment: '', conns: +props[5] },
        files: (files || []).map((f, i) => ({ i, name: f[0], size: +f[1], progress: +f[3] ? +f[2] / +f[3] : 0, prio: +f[4] })),
        trackers: (trk || []).filter(t => /^(https?|udp):/.test(t[0])).map(t => ({ url: t[0], status: +t[3] ? 2 : 0, seeds: +t[1], peers: +t[2], msg: '' })),
        peers: (prs || []).slice(0, 100).map(p => ({ ip: p[0], client: p[1], progress: (+p[2] || 0) / 100, dl: +p[3], up: +p[4] })) };
    },
  };
}

// ---------- Deluge ----------
const sessions = new Map(); // service id -> cookie
function deluge(s) {
  const url = () => { const b = base(s); return /\/json$/.test(b) ? b : b + '/json'; };
  let n = 0;
  async function raw(method, params, cookie) {
    let r;
    try { r = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(s.user ? auth(s) : {}) },
      body: JSON.stringify({ method, params, id: ++n }), signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw plain(`Could not reach Deluge at ${base(s)} (${why(e)}).`); }
    if (!r.ok) throw plain(`Deluge answered ${r.status}. Use the address of Deluge's Web UI (like http://192.168.1.10:8112).`);
    let j; try { j = await r.json(); } catch { throw plain('Deluge sent something that is not its Web UI answer. Check the address (the Web UI, usually port 8112).'); }
    const set = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).find(c => c.startsWith('_session_id='));
    return { j, set };
  }
  async function login() {
    const { j, set } = await raw('auth.login', [s.pass || '']);
    if (!j.result || !set) throw plain('Deluge did not accept that password (the Web UI password).');
    sessions.set(s.id, set);
    // The Web UI must be connected to a Deluge daemon; connect it to the first one when it is not.
    const c = await raw('web.connected', [], set);
    if (!c.j.result) {
      const hosts = (await raw('web.get_hosts', [], set)).j.result || [];
      if (!hosts.length) throw plain('Deluge\'s Web UI has no daemon to connect to. Add one in its Connection Manager.');
      await raw('web.connect', [hosts[0][0]], set);
    }
    return set;
  }
  async function call(method, ...params) {
    let ck = sessions.get(s.id) || await login();
    let { j } = await raw(method, params, ck);
    // The Web UI forgets sessions after a while (or a restart): sign in again once.
    if (j.error && /not authenticated/i.test(j.error.message || '')) { ck = await login(); ({ j } = await raw(method, params, ck)); }
    if (j.error) throw Object.assign(plain('Deluge said: ' + cut(j.error.message || 'error', 200)), { code: j.error.code });
    return j.result;
  }
  // Deluge 2 has plural names for these; Deluge 1.3 only the old ones.
  const either = async (a, b, ...p) => { try { return await call(a, ...p); } catch (e) { if (!/unknown method|has no attribute|not found/i.test(e.message)) throw e; return call(b, ...p); } };
  const FIELDS = ['name', 'state', 'progress', 'download_payload_rate', 'upload_payload_rate', 'total_wanted', 'time_added', 'eta', 'ratio', 'num_seeds', 'num_peers', 'label', 'save_path', 'queue', 'message'];
  const stateOf = x => {
    const st = String(x.state || ''), done = +x.progress >= 100;
    if (st === 'Downloading') return +x.download_payload_rate > 0 ? 'downloading' : 'stalledDL';
    if (st === 'Seeding') return +x.upload_payload_rate > 0 ? 'uploading' : 'stalledUP';
    if (st === 'Paused') return done ? 'pausedUP' : 'pausedDL';
    if (st === 'Checking') return 'checkingDL';
    if (st === 'Queued') return done ? 'queuedUP' : 'queuedDL';
    if (st === 'Error') return 'error';
    if (st === 'Moving') return 'moving';
    return done ? 'stalledUP' : 'stalledDL';
  };
  const ui = () => call('web.update_ui', FIELDS, {});
  async function ensureLabel(name) {
    const want = cut(name, 100).toLowerCase();   // Deluge keeps labels in lower case
    if (!want) return '';
    const have = await call('label.get_labels').catch(() => { throw plain('Labels need Deluge\'s Label plugin. Turn it on in Deluge (Preferences, Plugins).'); });
    if (!(have || []).includes(want)) await call('label.add', want);
    return want;
  }
  return {
    kind: 'deluge',
    async test() { await call('web.update_ui', ['name'], {}); const v = await call('daemon.info').catch(() => ''); return { version: String(v || '') }; },
    async list() {
      const u = await ui(), st = u.stats || {};
      return { dl: +st.download_rate || 0, ul: +st.upload_rate || 0, alt: false, torrents: Object.entries(u.torrents || {}).map(([hash, x]) => ({ hash, name: x.name, state: stateOf(x),
        progress: (+x.progress || 0) / 100, dlspeed: +x.download_payload_rate || 0, upspeed: +x.upload_payload_rate || 0, size: +x.total_wanted || 0, added: Math.round(+x.time_added || 0),
        eta: +x.eta > 0 ? Math.round(+x.eta) : 8640000, ratio: +x.ratio > 0 ? +x.ratio : 0, seeds: +x.num_seeds || 0, peers: +x.num_peers || 0, category: x.label || '', tags: '', path: x.save_path, prio: +x.queue })) };
    },
    async act(action, hashes, o = {}) {
      const ids = hashes === 'all' ? Object.keys((await ui()).torrents || {}) : hashes;
      if (!ids.length) return;
      if (action === 'pause') return either('core.pause_torrents', 'core.pause_torrent', ids);
      if (action === 'resume' || action === 'force') return either('core.resume_torrents', 'core.resume_torrent', ids);
      if (action === 'recheck') return call('core.force_recheck', ids);
      if (action === 'reannounce') return call('core.force_reannounce', ids);
      if (action === 'delete') { try { return await call('core.remove_torrents', ids, !!o.files); } catch (e) { if (!/unknown method|has no attribute/i.test(e.message)) throw e; for (const id of ids) await call('core.remove_torrent', id, !!o.files); return; } }
      if (['top', 'up', 'down', 'bottom'].includes(action)) return call('core.queue_' + action, ids);
      if (action === 'category') { const l = o.value ? await ensureLabel(o.value) : ''; for (const id of ids) await call('label.set_torrent', id, l || ''); return; }
      if (action === 'location') return call('core.move_storage', ids, cut(o.value, 500));
      throw plain('Deluge cannot do that.');
    },
    async add({ urls = [], files = [], category = '', paused = false }) {
      const opt = { add_paused: !!paused }, ids = [];
      for (const u of urls) ids.push(await call(/^magnet:/i.test(u) ? 'core.add_torrent_magnet' : 'core.add_torrent_url', u, opt));
      for (const f of files) ids.push(await call('core.add_torrent_file', f.name || 'file.torrent', f.buf.toString('base64'), opt));
      if (category) { const l = await ensureLabel(category); for (const id of ids.filter(Boolean)) await call('label.set_torrent', id, l); }
    },
    async meta() {
      const [u, labels] = await Promise.all([ui(), call('label.get_labels').catch(() => [])]);
      return { free: (u.stats || {}).free_space != null ? +u.stats.free_space : null, categories: (labels || []).map(n => ({ name: n, path: '' })), tags: [] };
    },
    async info(hash) {
      const x = await call('core.get_torrent_status', hash, ['save_path', 'total_size', 'time_added', 'completed_time', 'ratio', 'total_done', 'total_uploaded', 'seeding_time', 'comment',
        'num_peers', 'files', 'file_progress', 'file_priorities', 'trackers', 'peers']);
      return { props: { path: x.save_path, size: +x.total_size, added: Math.round(+x.time_added || 0), done: Math.round(+x.completed_time || 0), ratio: +x.ratio, down: +x.total_done, up: +x.total_uploaded,
        seedTime: +x.seeding_time, comment: x.comment || '', conns: +x.num_peers },
        files: (x.files || []).map((f, i) => ({ i: f.index != null ? f.index : i, name: f.path, size: +f.size, progress: +((x.file_progress || [])[i] || 0), prio: +((x.file_priorities || [])[i] || 0) })),
        trackers: (x.trackers || []).map(t => ({ url: t.url, status: 2, seeds: 0, peers: 0, msg: '' })),
        peers: (x.peers || []).slice(0, 100).map(p => ({ ip: p.ip, client: p.client, progress: +p.progress, dl: +p.down_speed, up: +p.up_speed })) };
    },
  };
}

const TYPES = ['rutorrent', 'deluge'];
const clientFor = s => s && s.type === 'rutorrent' ? rutorrent(s) : s && s.type === 'deluge' ? deluge(s) : null;

module.exports = { clientFor, TYPES, xmlCall, xmlParse };
