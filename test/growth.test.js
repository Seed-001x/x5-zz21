// test/growth.test.js — Developmental morphology: determinism, aging,
// stage transitions, weathering, and merge with pre-growth stored state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Organism, GENESIS } from '../server/engine.js';
import { STAGES, stageIndexFor, formFor, developmentBlurb, experience, hashSeed } from '../src/shared/growth.js';

const silent = () => {};
const BORN = 1791065112337;
function makeOrg(state = {}) {
  return new Organism({ ...state }, silent, { bornAt: BORN });
}
function runTicks(org, n, dt = 0.1) {
  let t = org.last;
  for (let i = 0; i < n; i++) { t += dt * 1000; org.tick(t); }
}

test('growth: identical history produces identical form', () => {
  const a = makeOrg(), b = makeOrg();
  // pin autonomy so both fire the same background events
  a.lastAutonomy = b.lastAutonomy = Date.now() - 60000;
  for (let i = 0; i < 20; i++) {
    a.stimulus('message', { text: 'same input' });
    b.stimulus('message', { text: 'same input' });
  }
  runTicks(a, 50); runTicks(b, 50);
  assert.deepEqual(a.s.form, b.s.form);
  assert.deepEqual(a.s.growth, b.s.growth);
});

test('growth: seed derives from birth timestamp, unique per organism', () => {
  const a = makeOrg();
  const b = new Organism({}, silent, { bornAt: BORN + 1 });
  assert.equal(a.s.form.seed, hashSeed(String(BORN)));
  assert.notEqual(a.s.form.seed, b.s.form.seed);
});

test('growth: development is monotonic with lived time', () => {
  const org = makeOrg();
  const devs = [];
  for (let b = 0; b < 10; b++) {
    runTicks(org, 100, 0.5);
    devs.push(org.s.form.dev);
    org.stimulus('message', { text: 'hello' });
  }
  for (let i = 1; i < devs.length; i++) {
    assert.ok(devs[i] >= devs[i - 1], `dev monotonic ${devs[i - 1]} -> ${devs[i]}`);
  }
  assert.ok(org.s.growth.ageSec > 400, `age accumulated: ${org.s.growth.ageSec}`);
  assert.ok(org.s.form.lobes >= 3 && org.s.form.filaments >= 10, 'form in sane ranges');
});

test('growth: stage thresholds (age or experience)', () => {
  const g0 = { ageSec: 0, stimuli: 0, memories: 0, autonomous: 0 };
  assert.equal(stageIndexFor(g0), 0);
  assert.equal(stageIndexFor({ ...g0, ageSec: 86400 }), 1, '1 day -> juvenile');
  assert.equal(stageIndexFor({ ...g0, stimuli: 25 }), 1, '25 contacts -> juvenile');
  assert.equal(stageIndexFor({ ...g0, ageSec: 7 * 86400 }), 2, '7 days -> mature');
  assert.equal(stageIndexFor({ ...g0, ageSec: 30 * 86400 }), 3, '30 days -> elder');
  assert.equal(STAGES[3].name, 'elder');
});

test('growth: stage transitions emit STAGE_REACHED in order', () => {
  const events = [];
  const org = new Organism({}, (t, d) => events.push([t, d]), { bornAt: BORN });
  for (let i = 0; i < 25; i++) org.stimulus('observer', {});
  runTicks(org, 3, 0.2);
  assert.equal(org.s.growth.stageIndex, 1, 'reached juvenile');
  for (let i = 0; i < 600; i++) org.stimulus('observer', {});
  runTicks(org, 3, 0.2);
  const stages = events.filter(([t]) => t === 'STAGE_REACHED').map(([, d]) => d.stage);
  assert.deepEqual(stages, ['juvenile', 'mature', 'elder'], `stages in order: ${stages}`);
  assert.equal(org.s.growth.stageIndex, 3);
  const last = events[events.length - 1][1];
  assert.ok(last.shapedBy.includes('625 observer contacts'), `honest blurb: ${last.shapedBy}`);
  assert.equal(last.stageIndex, 3);
});

test('growth: old stored state without growth fields merges cleanly', () => {
  // simulates a row saved before the growth layer existed
  const org = new Organism({ valence: 0.9 }, silent, { bornAt: BORN });
  assert.equal(org.s.valence, 0.9, 'existing fields preserved');
  assert.ok(org.s.growth, 'growth defaulted in');
  assert.equal(org.s.growth.stageIndex, 0);
  assert.ok(org.s.form && Number.isFinite(org.s.form.dev), 'form computed');
  runTicks(org, 10);
  assert.ok(org.s.growth.ageSec > 0, 'aging works on merged state');
  // GENESIS template must never be polluted by per-organism growth
  assert.equal(GENESIS.growth.ageSec, 0, 'GENESIS.growth untouched');
  assert.equal(GENESIS.form, null, 'GENESIS.form untouched');
});

test('growth: a strained life weathers the body more than a calm one', () => {
  const base = { ageSec: 15 * 86400, stimuli: 100, memories: 20, autonomous: 5000, timeSum: 15 * 86400, stageIndex: 0 };
  const calm = makeOrg({ growth: { ...base, stressSum: 0.15 * base.timeSum } });
  const strained = makeOrg({ growth: { ...base, stressSum: 0.75 * base.timeSum } });
  runTicks(calm, 5); runTicks(strained, 5);
  assert.ok(strained.s.form.wear > calm.s.form.wear,
    `wear strained ${strained.s.form.wear} > calm ${calm.s.form.wear}`);
  assert.ok(strained.s.form.asymmetry > calm.s.form.asymmetry,
    `asymmetry strained ${strained.s.form.asymmetry} > calm ${calm.s.form.asymmetry}`);
  assert.ok(calm.s.form.wear < 0.2, `calm life barely scars: ${calm.s.form.wear}`);
  // both look developed, neither is a reskin of the newborn
  assert.ok(calm.s.form.lobes > 3 && calm.s.form.filaments > 10, 'calm organism still intricate');
});

test('growth: noteMemory counts and the blurb reports real numbers', () => {
  const org = makeOrg();
  org.noteMemory(); org.noteMemory(); org.noteMemory();
  assert.equal(org.s.growth.memories, 3);
  const blurb = developmentBlurb(org.s.growth);
  assert.ok(blurb.includes('3 memories'), blurb);
  assert.ok(blurb.includes('0 observer contacts'), blurb);
  assert.ok(blurb.includes('yet unshaped'), `newborn temper honest: ${blurb}`);
});

test('growth: formFor is pure and bounded', () => {
  const g = { ageSec: 10 * 86400, stimuli: 200, memories: 40, autonomous: 8000, stressSum: 100000, timeSum: 864000 };
  assert.deepEqual(formFor(g, 42), formFor(g, 42), 'pure function');
  const f = formFor(g, 42);
  for (const [k, v] of Object.entries(f)) assert.ok(Number.isFinite(v), `${k} is finite`);
  assert.ok(f.lobes >= 3 && f.lobes <= 9, `lobes ${f.lobes}`);
  assert.ok(f.filaments >= 10 && f.filaments <= 38, `filaments ${f.filaments}`);
  assert.ok(f.vessels >= 8 && f.vessels <= 20, `vessels ${f.vessels}`);
  assert.ok(f.wear >= 0 && f.wear <= 1 && f.asymmetry >= 0 && f.asymmetry <= 0.35, 'weathering bounded');
  const newborn = formFor({ ageSec: 0, stimuli: 0, memories: 0, autonomous: 0, stressSum: 0, timeSum: 0 }, 7);
  assert.equal(newborn.lobes, 3, 'newborn starts simple');
  assert.equal(newborn.wear, 0, 'newborn unscarred');
});

test('growth: developmentSummary is honest and complete', () => {
  const org = makeOrg();
  const d = org.developmentSummary();
  assert.equal(d.stage, 'nascent');
  assert.equal(d.stageIndex, 0);
  assert.ok(d.blurb.includes('shaped by'), d.blurb);
  assert.deepEqual(d.form, org.s.form);
});
