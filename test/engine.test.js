// test/engine.test.js — Organism engine: coupling, homeostasis, causality, rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Organism, GENESIS } from '../server/engine.js';

const silent = () => {};
function makeOrg(state = {}) {
  return new Organism({ ...state }, silent);
}
// run N ticks of dt seconds, advancing the clock manually
function runTicks(org, n, dt = 0.1) {
  let t = org.last;
  for (let i = 0; i < n; i++) { t += dt * 1000; org.tick(t); }
}

test('threat pathway: threat -> cortisol -> arousal up, trust down', () => {
  const org = makeOrg();
  const c0 = org.s.cortisol, a0 = org.s.arousal, t0 = org.s.trust;
  org.s.threat = 1; // impulse
  runTicks(org, 40, 0.25); // 10 simulated seconds
  assert.ok(org.s.cortisol > c0, `cortisol rose ${c0} -> ${org.s.cortisol}`);
  assert.ok(org.s.arousal > a0, `arousal rose ${a0} -> ${org.s.arousal}`);
  assert.ok(org.s.trust < t0, `trust fell ${t0} -> ${org.s.trust}`);
});

test('homeostasis: stress spike regulates down gradually, never instant-reset', () => {
  const org = makeOrg({ stress: 0.95 });
  runTicks(org, 40, 0.25); // 10 simulated seconds
  const at10s = org.s.stress;
  assert.ok(at10s > 0.5 && at10s < 0.95, `stress declining gradually, not reset: ${at10s}`);
  runTicks(org, 160, 0.25); // 40 more seconds
  assert.ok(org.s.stress < 0.45, `stress well on its way down: ${org.s.stress}`);
  runTicks(org, 400, 0.25); // 100 more seconds
  assert.ok(org.s.stress <= 0.2, `organism calmed (at/below baseline band): ${org.s.stress}`);
});

test('decay: reward/threat signals clear without input', () => {
  const org = makeOrg({ reward: 0.9, threat: 0.9 });
  runTicks(org, 120, 0.25); // 30s
  assert.ok(org.s.reward < 0.3, `reward decayed: ${org.s.reward}`);
  assert.ok(org.s.threat < 0.3, `threat decayed: ${org.s.threat}`);
});

test('no randomness: identical inputs produce identical trajectories', () => {
  const a = makeOrg(), b = makeOrg();
  a.stimulus('message', { text: 'hello organism' });
  b.stimulus('message', { text: 'hello organism' });
  runTicks(a, 50); runTicks(b, 50);
  assert.deepEqual(
    Object.keys(a.s).filter((k) => typeof a.s[k] === 'number').map((k) => a.s[k].toFixed(6)),
    Object.keys(b.s).filter((k) => typeof b.s[k] === 'number').map((k) => b.s[k].toFixed(6))
  );
});

test('causality: stimulus is recorded as the reason variables moved', () => {
  const org = makeOrg();
  org.stimulus('message', { text: 'a curious test message' });
  runTicks(org, 5, 0.2);
  const arousalCauses = org.causesFor('arousal');
  assert.ok(arousalCauses.length > 0, 'arousal has recorded causes');
  assert.ok(arousalCauses.some((c) => c.reason === 'observer message'), 'stimulus recorded as cause');
  // homeostasis also recorded for drifting variables
  const energyCauses = org.causesFor('energy');
  assert.ok(energyCauses.every((c) => typeof c.reason === 'string' && typeof c.delta === 'number'));
});

test('rest cycle: high fatigue triggers REST_STARTED then REST_ENDED', () => {
  const events = [];
  const org = new Organism({ fatigue: 0.85 }, (t, d) => events.push(t));
  runTicks(org, 10, 0.5);
  assert.ok(org.resting, 'organism entered rest');
  assert.ok(events.includes('REST_STARTED'), 'REST_STARTED emitted');
  runTicks(org, 600, 0.5); // 300 simulated seconds of rest
  assert.ok(!org.resting, 'organism left rest');
  assert.ok(events.includes('REST_ENDED'), 'REST_ENDED emitted');
  assert.ok(org.s.fatigue < 0.5, `fatigue recovered: ${org.s.fatigue}`);
});

test('observer stimulus moves curiosity/arousal and sets attention', () => {
  const org = makeOrg();
  const c0 = org.s.curiosity;
  org.stimulus('observer', { x: 0.5, y: -0.3, intensity: 0.5 });
  assert.ok(org.s.curiosity > c0, 'curiosity rose');
  assert.equal(org.s.attention.x, 0.5);
  assert.ok(org.s.attention.intensity > 0, 'attention engaged');
});

test('autonomous events fire without any stimulus', () => {
  const events = [];
  const org = new Organism({}, (t) => events.push(t));
  org.lastAutonomy = Date.now() - 20000;
  org.tick(Date.now());
  assert.ok(events.includes('AUTONOMOUS_EVENT'), 'autonomous event fired');
});
