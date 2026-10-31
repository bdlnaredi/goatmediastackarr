// Preferred audio languages: releases marked and ordered, Radarr and Sonarr set up with a scored custom format each.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');
const LP = require('../lib/langpref');

test('ranking a release by its languages and its name', () => {
  const p = LP.clean({ langs: ['Hindi', 'English', 'Klingon'] });
  assert.deepEqual(p.langs, ['Hindi', 'English']); assert.equal(p.dual, true);
  assert.equal(LP.rank({ title: 'Movie.2024.1080p.WEB-DL.Hindi.DD5.1', langs: [] }, p), 1);
  assert.equal(LP.rank({ title: 'Movie 2024 1080p Dual Audio [Org-Eng]', langs: [] }, p), 1, 'dual audio counts as Hindi');
  assert.equal(LP.rank({ title: 'Movie.2024.1080p', langs: ['English'] }, p), 2);
  assert.equal(LP.rank({ title: 'Movie.2024.FRENCH.1080p', langs: ['French'] }, p), 0);
  assert.equal(LP.rank({ title: 'Machine.2024', langs: [] }, p), 0, '"hin" inside a word does not count');
  assert.equal(LP.rank({ title: 'x Dual Audio', langs: [] }, LP.clean({ langs: ['Hindi'], dual: false })), 0);
});

test('Radarr and Sonarr get a custom format per language, scored in every profile; interactive search puts them first', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' });
    let r = await a.put('/api/langpref', { langs: ['Hindi', 'English'], upgrade: true, only: true });
    assert.equal(r.status, 200); assert.ok(r.data.results.every(x => x.ok), JSON.stringify(r.data.results));
    const cf = fake.state.cfs.radarr;
    assert.deepEqual(cf.map(f => f.name), ['Audio: Hindi (GoatMediaStackarr)', 'Audio: English (GoatMediaStackarr)']);
    assert.ok(cf[0].specifications.some(x => x.implementation === 'LanguageSpecification' && x.fields[0].value === 26));
    assert.ok(cf[0].specifications.some(x => x.name === 'Dual or multi audio')); assert.ok(!cf[1].specifications.some(x => x.name === 'Dual or multi audio'));
    const qp = fake.state.qp.radarr['2'];
    assert.deepEqual(qp.formatItems.map(x => x.score), [200, 100]); assert.equal(qp.cutoffFormatScore, 200); assert.equal(qp.minFormatScore, 100); assert.equal(qp.upgradeAllowed, true);
    assert.deepEqual(qp.language, { id: -1, name: 'Any' }, 'Radarr may take releases in any language');
    assert.equal(fake.state.qp.sonarr['2'].language, undefined);
    // Fewer languages and no "only": English's format goes, the minimum score is put back.
    r = await a.put('/api/langpref', { langs: ['Hindi'], only: false });
    assert.deepEqual(fake.state.cfs.radarr.map(f => f.name), ['Audio: Hindi (GoatMediaStackarr)']);
    assert.equal(fake.state.qp.radarr['2'].minFormatScore, 0); assert.deepEqual(fake.state.qp.radarr['2'].formatItems.map(x => x.score), [100]);
    // Interactive search: the French/German/English dual release has no Hindi, the English one is not preferred either now.
    await a.put('/api/langpref', { langs: ['French', 'Hindi'], apply: false });
    r = await a.get(`/api/releases?sid=${rad}&id=1`);
    assert.equal(r.data[0].prefLang, 'French'); assert.equal(r.data[0].pref, 1); assert.ok(!r.data[1].pref);
    assert.equal((await a.get('/api/langpref')).data.all.includes('Tamil'), true);
  } finally { await s.stop(); srv.close(); }
});
