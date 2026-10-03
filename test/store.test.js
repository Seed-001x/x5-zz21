// test/store.test.js — Persistence: birth convention, memory, events, history.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SqliteStore } from '../server/store-sqlite.js';
import { GENESIS } from '../server/engine.js';

const DB = '/tmp/x5-zz21-test.db';
let store;
beforeEach(() => { try { fs.unlinkSync(DB); } catch {} store = new SqliteStore(DB); });
afterEach(() => { store.close(); try { fs.unlinkSync(DB); } catch {} });

test('birth: first creation inserts organism row + birth memory + BIRTH event', () => {
  const loaded = store.load();
  assert.ok(loaded.born_at > 0, 'born_at set');
  assert.ok(Math.abs(loaded.born_at - Date.now()) < 60000, 'born_at is now');
  assert.deepEqual(Object.keys(loaded.state).sort(), Object.keys(GENESIS).sort());
  const mems = store.memories();
  assert.equal(mems.length, 1, 'exactly one memory at birth');
  assert.match(mems[0].summary, /Initialization/, 'birth memory is first awareness');
  assert.equal(mems[0].source, 'genesis');
  const evs = store.events();
  assert.ok(evs.some((e) => e.type === 'BIRTH'), 'BIRTH event logged');
});

test('reopen: same organism loads, no duplicate birth memory', () => {
  const b1 = store.load().born_at;
  store.close();
  const s2 = new SqliteStore(DB);
  assert.equal(s2.load().born_at, b1, 'same birth timestamp');
  assert.equal(s2.memories().length, 1, 'no duplicate birth memory');
  s2.close();
});

test('memory formation stores emotional snapshot and associations', () => {
  const s = { ...GENESIS, valence: 0.8, arousal: 0.6 };
  const m = store.memory('Observer stimulus: "hello"', s, 0.55, 'observer', ['observer', 'language']);
  assert.ok(m.id > 1, 'new memory id');
  assert.equal(m.valence, 0.8);
  assert.equal(m.arousal, 0.6);
  assert.deepEqual(m.associations, ['observer', 'language']);
  const byId = store.memoryById(m.id);
  assert.equal(byId.summary, 'Observer stimulus: "hello"');
});

test('event causality chain is preserved in order', () => {
  store.event('STIMULUS_RECEIVED', { kind: 'message' });
  store.event('MEMORY_FORMED', { memoryId: 2 });
  store.event('COGNITION_COMPLETED', { memoryId: 3 });
  const evs = store.events(10);
  const types = evs.map((e) => e.type);
  assert.ok(types.indexOf('COGNITION_COMPLETED') < types.indexOf('MEMORY_FORMED'), 'reverse-chronological');
  assert.ok(types.indexOf('MEMORY_FORMED') < types.indexOf('STIMULUS_RECEIVED'), 'reverse-chronological');
});

test('state history sampling stores waveforms, capped', () => {
  for (let i = 0; i < 10; i++) store.sampleHistory({ ...GENESIS, stress: i / 10 });
  const h = store.history('stress', 10);
  assert.equal(h.length, 10);
  assert.ok(h[9].value > h[0].value, 'waveform rises');
  assert.ok(h.every((p) => typeof p.ts === 'number'));
});

test('save/load roundtrip preserves state and cycles', () => {
  const s = { ...GENESIS, curiosity: 0.99 };
  store.save(s, 4242);
  const loaded = store.load();
  assert.equal(loaded.state.curiosity, 0.99);
  assert.equal(loaded.cycles, 4242);
});
