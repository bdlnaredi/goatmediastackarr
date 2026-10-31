// Preferred audio languages ("Hindi, else English"): marks and orders releases in interactive search, and sets up
// Radarr and Sonarr so they pick and upgrade to them by themselves (a custom format per language, scored in every
// quality profile). GoatMediaStackarr, Copyright (C) 2026 bdlnaredi, GPL-3.0-or-later. No dependencies.
'use strict';

// The languages offered, with the words release names use for them.
const LANGS = {
  English: 'english|eng', Hindi: 'hindi|hin', Tamil: 'tamil|tam', Telugu: 'telugu', Malayalam: 'malayalam', Kannada: 'kannada',
  Bengali: 'bengali|bangla', Marathi: 'marathi', Punjabi: 'punjabi', Gujarati: 'gujarati|guj', Urdu: 'urdu', Spanish: 'spanish|espanol|español|spa|castellano|latino',
  French: 'french|fre|vff|vf2|truefrench', German: 'german|ger|deutsch', Italian: 'italian|ita', Portuguese: 'portuguese|dublado', Russian: 'russian|rus',
  Japanese: 'japanese|jpn|jap', Korean: 'korean|kor', Chinese: 'chinese|mandarin|cantonese', Arabic: 'arabic', Turkish: 'turkish', Polish: 'polish',
  Dutch: 'dutch', Thai: 'thai', Indonesian: 'indonesian', Vietnamese: 'vietnamese|vie',
};
const DUAL = 'dual[ ._-]?audio|multi[ ._-]?audio|\\bmulti\\b';
const titleRe = l => new RegExp(`(^|[^a-z])(${LANGS[l]})([^a-z]|$)`, 'i');
const dualRe = new RegExp(DUAL, 'i');

/** The saved settings, cleaned: { langs: ['Hindi','English'], dual, upgrade, only }. */
function clean(b = {}, o = {}) {
  const pick = Array.isArray(b.langs) ? b.langs : o.langs || [];
  const langs = [...new Set(pick.map(String).filter(l => LANGS[l]))].slice(0, 4);
  const flag = (k, d) => k in b ? !!b[k] : k in o ? !!o[k] : d;
  return { langs, dual: flag('dual', true), upgrade: flag('upgrade', true), only: flag('only', false), applied: o.applied || null };
}

/** 1 for the first preferred language, 2 for the second…, 0 when none matches. The release's own language list
 *  counts, and so do the words in its name; "Dual audio" counts as the first preferred language that is not English. */
function rank(rel, p) {
  if (!p || !p.langs.length) return 0;
  const have = new Set((rel.langs || []).map(x => String(x).toLowerCase())), title = String(rel.title || '');
  for (let i = 0; i < p.langs.length; i++) {
    const l = p.langs[i];
    if (have.has(l.toLowerCase()) || titleRe(l).test(title)) return i + 1;
    if (p.dual && l !== 'English' && p.langs.findIndex(x => x !== 'English') === i && dualRe.test(title)) return i + 1;
  }
  return 0;
}

const CF_TAG = ' (GoatMediaStackarr)', cfName = l => 'Audio: ' + l + CF_TAG;

/** Sets up one Radarr or Sonarr. api(path, opt) calls it. Returns what was done, in words. */
async function apply(type, api, p) {
  const done = [];
  const langs = await api('/api/v3/language').catch(() => []), idOf = l => ((Array.isArray(langs) ? langs : []).find(x => String(x.name).toLowerCase() === l.toLowerCase()) || {}).id;
  const all = await api('/api/v3/customformat');
  const ours = (Array.isArray(all) ? all : []).filter(f => String(f.name).endsWith(CF_TAG));
  const firstOther = p.langs.find(l => l !== 'English');
  const ids = {};
  for (const l of p.langs) {
    const specs = [{ name: l + ' in the name', implementation: 'ReleaseTitleSpecification', negate: false, required: false, fields: [{ name: 'value', value: `\\b(${LANGS[l]})\\b` }] }];
    const lid = idOf(l); if (lid != null) specs.unshift({ name: l + ' audio', implementation: 'LanguageSpecification', negate: false, required: false, fields: [{ name: 'value', value: lid }] });
    if (p.dual && l === firstOther) specs.push({ name: 'Dual or multi audio', implementation: 'ReleaseTitleSpecification', negate: false, required: false, fields: [{ name: 'value', value: DUAL }] });
    const body = { name: cfName(l), includeCustomFormatWhenRenaming: false, specifications: specs }, cur = ours.find(f => f.name === body.name);
    const r = cur ? await api('/api/v3/customformat/' + cur.id, { method: 'PUT', body: JSON.stringify({ ...body, id: cur.id }) }) : await api('/api/v3/customformat', { method: 'POST', body: JSON.stringify(body) });
    ids[l] = (r && r.id) || (cur && cur.id); done.push((cur ? 'updated ' : 'added ') + body.name);
  }
  // Languages no longer wanted lose their custom format.
  for (const f of ours) if (!p.langs.some(l => f.name === cfName(l))) { await api('/api/v3/customformat/' + f.id, { method: 'DELETE' }).catch(() => {}); done.push('removed ' + f.name); }
  const n = p.langs.length, score = l => (n - p.langs.indexOf(l)) * 100, low = n ? score(p.langs[n - 1]) : 0, top = n ? score(p.langs[0]) : 0;
  const profiles = await api('/api/v3/qualityprofile');
  for (const q of Array.isArray(profiles) ? profiles : []) {
    const items = (q.formatItems || []).filter(x => !Object.values(ids).includes(x.format) && !ours.some(f => f.id === x.format));
    for (const l of p.langs) if (ids[l]) items.push({ format: ids[l], name: cfName(l), score: score(l) });
    const nq = { ...q, formatItems: items };
    if (n && p.upgrade) { nq.upgradeAllowed = true; nq.cutoffFormatScore = Math.max(+q.cutoffFormatScore || 0, top); }
    nq.minFormatScore = n && p.only ? low : (p.applied && p.applied.only && +q.minFormatScore === +p.applied.low ? 0 : +q.minFormatScore || 0);
    // Radarr turns away releases that are not in the profile's own language; with preferences it should take any.
    if (type === 'radarr' && n && q.language && !['Any'].includes(q.language.name) && p.langs.some(l => l !== q.language.name)) nq.language = { id: -1, name: 'Any' };
    await api('/api/v3/qualityprofile/' + q.id, { method: 'PUT', body: JSON.stringify(nq) });
    done.push('scored in ' + q.name);
  }
  return { done, low };
}

module.exports = { LANGS: Object.keys(LANGS), clean, rank, apply, cfName };
