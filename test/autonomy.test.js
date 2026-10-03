// test/autonomy.test.js — Autonomous inner life: the organism forms its OWN
// episodic memories from inner experience, not just from observer contact.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Organism } from '../server/engine.js';
import { SqliteStore } from '../server/store-sqlite.js';
import {
  createSalienceTracker, evaluateSalience, noteObserverContact, EVAL_MIN_GAP_MS,
} from '../server/salience.js';

const DB = '/tmp/x5-zz21-autonomy-test.db';
let store;
beforeEach(() => { try { fs.unlinkSync(DB); } catch {} store = new SqliteStore(DB); });
afterEach(() => { store.close(); try { fs.unlinkSync(DB); } catch {} });

const silent = () => {};
const recordNoop = () => {};

// Fake-clock world: the fake epoch is anchored at real now so DB timestamps
// (real ms) and evaluator `now` (fake ms) stay on the same scale.
function makeWorld(state = {}) {
  const org = new Organism({ ...state }, silent);
  const tracker = createSalienceTracker();
  let now = Date.now();
  org.last = now; org.lastAutonomy = now;
  return {
    org, tracker,
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

async function tickTo(w, ms, stepMs = 2000) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(stepMs, remaining);
    w.advance(dt);
    w.org.tick(w.now());
    remaining -= dt;
  }
}

const evalAt = (w) =>
  evaluateSalience({ organism: w.org, tracker: w.tracker, store, record: recordNoop, now: w.now() });

const autonomousMems = async () =>
  (await store.memories(200)).filter((m) => m.source === 'autonomous');

test('boring flatline forms no autonomous memory', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now()); // boot seeding equivalent
  for (let i = 0; i < 20; i++) { await tickTo(w, 30000); await evalAt(w); } // 10 min
  assert.equal((await autonomousMems()).length, 0, 'flatline leaves no trace');
  assert.equal(await store.countMemories(), 1, 'only the birth memory exists');
});

test('induced stress spike forms an autonomous memory with accurate numbers', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now());
  await tickTo(w, 30000); await evalAt(w); // settle baselines
  w.org.s.stress = 0.72; // induced spike, as if from the threat pathway
  const mem = await evalAt(w);
  assert.ok(mem, 'spike formed a memory');
  assert.equal(mem.source, 'autonomous');
  assert.match(mem.summary, /0\.72/, 'summary carries the real measured value');
  assert.ok(mem.associations.includes('autonomy'), 'honest associations');
  assert.ok(mem.importance >= .3 && mem.importance <= .7, `importance in range: ${mem.importance}`);
  assert.equal(w.org.s.growth.memories, 1, 'flows through the growth counter');
});

test('rate cap holds under sustained salience', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now());
  await tickTo(w, 30000); await evalAt(w);
  w.org.s.stress = 0.72;
  const m1 = await evalAt(w);
  assert.ok(m1, 'first spike remembered');
  // fresh spike 60s later, with a fresh low baseline so the crossing is real
  w.advance(60000);
  w.tracker.prev = { ...w.tracker.prev, stress: 0.1 };
  w.org.s.stress = 0.8;
  const m2 = await evalAt(w);
  assert.equal(m2, null, 'rate cap suppresses the second memory');
  assert.equal((await autonomousMems()).length, 1);
  // after the cap window the same spike is remembered
  w.advance(EVAL_MIN_GAP_MS);
  w.tracker.prev = { ...w.tracker.prev, stress: 0.1 };
  w.org.s.stress = 0.8;
  const m3 = await evalAt(w);
  assert.ok(m3, 'memory allowed after cap window');
  assert.equal((await autonomousMems()).length, 2);
});

test('restart does not duplicate a recent autonomous memory', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now());
  await tickTo(w, 30000); await evalAt(w);
  w.org.s.stress = 0.72;
  assert.ok(await evalAt(w), 'spike remembered');
  assert.equal((await autonomousMems()).length, 1);

  // restart: fresh tracker, seeded from the database the way index.js does
  const t2 = createSalienceTracker();
  const recentMems = await store.memories(80);
  t2.lastMemoryTs = recentMems.find((m) => m.source === 'autonomous').ts;
  t2.stillnessSinceTs = Date.now();
  const ctx = () => ({ organism: w.org, tracker: t2, store, record: recordNoop, now: w.now() });
  await tickTo(w, 30000);
  await evaluateSalience(ctx()); // baselines
  // fresh spike shortly after restart: seeded rate cap must suppress it
  w.org.s.stress = 0.1;
  await tickTo(w, 30000);
  await evaluateSalience(ctx()); // prev now low
  w.org.s.stress = 0.85;
  const dup = await evaluateSalience(ctx());
  assert.equal(dup, null, 'seeded rate cap suppresses the duplicate');
  assert.equal((await autonomousMems()).length, 1, 'still exactly one autonomous memory');
});

test('completed rest forms a memory with the real from/to numbers', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now());
  await tickTo(w, 30000); await evalAt(w); // baselines
  w.org.s.fatigue = 0.85; // force the rest cycle
  await tickTo(w, 4000);
  assert.ok(w.org.resting, 'rest began');
  await evalAt(w); // evaluator observes the rest entry
  const rs = { ...w.tracker.restStart };
  assert.ok(rs, 'rest start captured');
  let guard = 0;
  while (w.org.resting && guard++ < 300) { await tickTo(w, 2000); }
  assert.ok(!w.org.resting, 'rest ended');
  const f1 = w.org.s.fatigue, e1 = w.org.s.energy;
  const mem = await evalAt(w);
  assert.ok(mem, 'rest completion remembered');
  assert.equal(mem.source, 'autonomous');
  assert.deepEqual(mem.associations, ['autonomy', 'rest']);
  const r2 = (n) => String(Math.round(n * 100) / 100);
  assert.match(mem.summary, new RegExp(`fatigue ${r2(rs.fatigue)}→${r2(f1)}`), 'fatigue delta is real');
  assert.match(mem.summary, new RegExp(`energy ${r2(rs.energy)}→${r2(e1)}`), 'energy delta is real');
});

test('long stillness forms exactly one quiet memory', async () => {
  const w = makeWorld();
  noteObserverContact(w.tracker, w.now()); // stillness clock starts now
  for (let i = 0; i < 41; i++) { await tickTo(w, 30000); await evalAt(w); } // 20.5 min
  const mems = await autonomousMems();
  assert.equal(mems.length, 1, 'one quiet memory for the stillness episode');
  assert.match(mems[0].summary, /without contact/, 'honest stillness summary');
});
