// Alerts the way Tautulli does them: every channel picks its triggers, can have its own subject and text for each
// one (with {parameters} filled in), and conditions that decide whether a message goes out at all.
// GoatMediaStackarr, Copyright (C) 2026 bdlnaredi, GPL-3.0-or-later. No dependencies.
'use strict';

// Each trigger: its name, the group it is shown in, the parameters it fills, and the text a channel gets by default.
// Triggers that existed before custom text keep sending what they always sent ({subject} and {message}).
const PLAY = ['user', 'title', 'full_title', 'show_name', 'episode_name', 'season_num', 'episode_num', 'year', 'media_type', 'player', 'product',
  'quality', 'stream_decision', 'bandwidth', 'location', 'progress_percent', 'duration', 'server'];
const EVENTS = {
  playStart: { name: 'Playback starts', group: 'Playback', params: PLAY, subject: '{user} started {full_title}', body: '{user} is watching {full_title} on {player}<, {quality}><, {stream_decision}>.' },
  playStop: { name: 'Playback stops', group: 'Playback', params: PLAY, subject: '{user} stopped {full_title}', body: '{user} stopped {full_title} at {progress_percent}% on {player}.' },
  playPause: { name: 'Playback paused', group: 'Playback', params: PLAY, subject: '{user} paused {full_title}', body: '{user} paused {full_title} on {player}.' },
  playResume: { name: 'Playback resumed', group: 'Playback', params: PLAY, subject: '{user} resumed {full_title}', body: '{user} resumed {full_title} on {player}.' },
  watched: { name: 'Watched (90% played)', group: 'Playback', params: PLAY, subject: '{user} watched {full_title}', body: '{user} finished watching {full_title}.' },
  transcode: { name: 'Transcode starts', group: 'Playback', params: PLAY, subject: '{user} is transcoding {full_title}', body: '{full_title} for {user} on {player} changed to {stream_decision}<, {quality}>.' },
  newDevice: { name: 'New device', group: 'Playback', params: ['user', 'player', 'product', 'server'], subject: 'New device for {user}', body: '{user} played something on a new device: {player}< ({product})>.' },
  recentlyAdded: { name: 'Recently added', group: 'Library', params: ['title', 'full_title', 'year', 'media_type', 'show_name', 'library', 'summary', 'server'], subject: 'Added: {full_title}', body: '{full_title}< ({year})> is ready to watch< in {library}>.<\n{summary}>' },
  finished: { name: 'Download finished', group: 'Downloads', params: [] },
  grabbed: { name: 'Download grabbed', group: 'Downloads', params: [] },
  healed: { name: 'Download fixed by itself', group: 'Downloads', params: [] },
  requests: { name: 'New request', group: 'Requests', params: [] },
  available: { name: 'Request available', group: 'Requests', params: [] },
  reports: { name: 'Problem reported', group: 'Requests', params: [] },
  streamLimit: { name: 'Streaming limit reached', group: 'Requests', params: [] },
  offline: { name: 'App down or back up', group: 'Server', params: [] },
  vpn: { name: 'VPN down or back up', group: 'Server', params: [] },
  disk: { name: 'Array almost full', group: 'Server', params: [] },
  backup: { name: 'Backup failed', group: 'Server', params: [] },
  update: { name: 'GoatMediaStackarr update', group: 'Server', params: [] },
  appUpdates: { name: 'App updates in the stack', group: 'Server', params: [] },
  weekly: { name: 'Weekly newsletter', group: 'Newsletters', params: [] },
};
const KEYS = Object.keys(EVENTS);
const COMMON = ['subject', 'message', 'event', 'app_name', 'datestamp', 'timestamp'];
const paramsOf = k => [...COMMON, ...((EVENTS[k] || {}).params || [])];

// {param} is replaced by its value. <text with {param}> is left out entirely when any parameter in it is empty,
// the way Tautulli does optional parts. \n in the text is a new line.
function render(tpl, p) {
  const val = k => { const v = p[k]; return v == null ? '' : String(v); };
  let s = String(tpl == null ? '' : tpl).replace(/\\n/g, '\n');
  s = s.replace(/<([^<>]*\{\w+\}[^<>]*)>/g, (_, inner) => [...inner.matchAll(/\{(\w+)\}/g)].some(m => !val(m[1]).trim()) ? '' : inner);
  return s.replace(/\{(\w+)\}/g, (_, k) => val(k)).replace(/[ \t]+\n/g, '\n').trim();
}

// Conditions: [{ p: parameter, op, v }], all or any of them must hold. "is" and "is not" take several values
// separated by commas; numbers compare as numbers.
const OPS = { is: 'is', isnot: 'is not', contains: 'contains', notcontains: 'does not contain', gt: 'is greater than', lt: 'is less than' };
function condsOk(c, p) {
  const list = (Array.isArray(c.conds) ? c.conds : []).filter(x => x && x.p && OPS[x.op]);
  if (!list.length) return true;
  const one = x => {
    const have = String(p[x.p] == null ? '' : p[x.p]).toLowerCase(), want = String(x.v == null ? '' : x.v).toLowerCase().trim();
    const many = want.split(',').map(s => s.trim()).filter(Boolean);
    if (x.op === 'is') return many.length ? many.includes(have) : !have;
    if (x.op === 'isnot') return many.length ? !many.includes(have) : !!have;
    if (x.op === 'contains') return !want || have.includes(want);
    if (x.op === 'notcontains') return !want || !have.includes(want);
    const a = parseFloat(have), b = parseFloat(want); if (isNaN(a) || isNaN(b)) return false;
    return x.op === 'gt' ? a > b : a < b;
  };
  return c.condMode === 'any' ? list.some(one) : list.every(one);
}

// What a channel says for one trigger: its own text, else the trigger's default, else the plain subject and message.
function message(c, kind, p) {
  const t = ((c.tpl || {})[kind]) || {}, d = EVENTS[kind] || {};
  const custom = !!(t.subject || t.body);
  return { custom, subject: render(t.subject || d.subject || '{subject}', p) || p.subject || '', body: render(t.body || d.body || '{message}', p) };
}

// Cleans what the page sends for a channel's text and conditions.
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
function cleanTpl(t) {
  const out = {};
  for (const k of KEYS) { const x = t && t[k]; if (!x) continue; const s = cut(x.subject, 300).trim(), b = cut(x.body, 3000).trim(); if (s || b) out[k] = { subject: s, body: b }; }
  return out;
}
function cleanConds(l) {
  const ok = new Set(KEYS.flatMap(paramsOf));
  return (Array.isArray(l) ? l : []).filter(x => x && ok.has(x.p) && OPS[x.op]).slice(0, 20).map(x => ({ p: x.p, op: x.op, v: cut(x.v, 300) }));
}

// The parameters of a stream (the shape plexMap and jfMap give).
function playParams(x, server) {
  const ep = x.kind === 'episode', m = /^S(\d+)E(\d+)\s*(.*)$/.exec(x.sub || '') || [];
  return { user: x.user || '', title: ep ? (m[3] || x.title) : x.title, full_title: ep ? `${x.title} ${x.sub && m[1] ? `S${m[1]}E${m[2]}` : ''}`.trim() + (m[3] ? ' ' + m[3] : '') : x.title + (x.sub ? ` (${x.sub})` : ''),
    show_name: ep ? x.title : '', episode_name: ep ? m[3] || '' : '', season_num: ep ? +m[1] || '' : '', episode_num: ep ? +m[2] || '' : '', year: ep ? '' : x.sub || '',
    media_type: ep ? 'episode' : x.kind === 'track' ? 'track' : 'movie', player: x.player || '', product: x.device || '', quality: x.res || '',
    stream_decision: x.decision === 'transcode' ? 'transcode' : x.decision === 'stream' ? 'direct stream' : 'direct play', bandwidth: x.kbps ? Math.round(x.kbps / 100) / 10 + ' Mbps' : '',
    location: x.where === 'wan' ? 'wan' : 'lan', progress_percent: Math.round((x.progress || 0) * 100), duration: x.duration ? Math.round(x.duration / 60000) + ' min' : '', server: server || '' };
}

module.exports = { EVENTS, KEYS, COMMON, OPS, paramsOf, render, condsOk, message, cleanTpl, cleanConds, playParams };
