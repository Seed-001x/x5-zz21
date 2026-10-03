// shared/growth.js — Developmental morphology for X5-ZZ21.
//
// Pure, deterministic functions shared by the server engine (Node) and the
// frontend renderer (Vite). No side effects, no randomness: the body plan is
// a pure function of lived history — chronological age, cumulative experience
// counters, and long-run emotional averages — plus a seed derived from the
// organism's birth timestamp. Same history → same form, always.

const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

// Named life stages. A stage is reached by age OR by experience —
// a heavily-observed organism develops faster than a quiet one, but
// time alone also ages it.
export const STAGES = [
  { name: "nascent",   minAgeDays: 0,  minExp: 0 },
  { name: "juvenile",  minAgeDays: 1,  minExp: 25 },
  { name: "mature",    minAgeDays: 7,  minExp: 150 },
  { name: "elder",     minAgeDays: 30, minExp: 600 },
];

// FNV-1a hash → uint32. The seed is derived from the birth timestamp, so each
// organism's idiosyncrasies (lobe phase, wear-mark placement) are unique to
// it yet fully deterministic — never Math.random.
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Weighted lived experience. Stimuli and memories count most; the background
// autonomous inner life counts a little — it is still a life being lived.
export function experience(g) {
  return (g.stimuli || 0) + (g.memories || 0) * 3 + (g.autonomous || 0) * 0.003;
}

export function ageDays(g) {
  return (g.ageSec || 0) / 86400;
}

export function stageIndexFor(g) {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (ageDays(g) >= STAGES[i].minAgeDays || experience(g) >= STAGES[i].minExp) idx = i;
  }
  return idx;
}

// Long-run emotional average: 1 = a life lived calm, 0 = a life lived strained.
export function calmRatio(g) {
  const t = g.timeSum || 0;
  if (t <= 0) return 0.8; // newborn default: calm-leaning, unshaped
  return clamp(1 - (g.stressSum || 0) / t, 0, 1);
}

// The body plan. `dev` blends age (70%) and experience (30%); `hard`
// (a life lived under strain) drives weathering: asymmetry, wear marks,
// membrane ridges. A calm old organism looks deep and intricate; a strained
// one looks weathered. Both look lived.
export function formFor(g, seed = 1) {
  const t = clamp(ageDays(g) / 30, 0, 1);
  const e = clamp(experience(g) / 600, 0, 1);
  const dev = clamp(0.7 * t + 0.3 * e, 0, 1);
  const hard = 1 - calmRatio(g);
  return {
    seed: seed >>> 0,
    dev: r3(dev),
    lobes: 3 + Math.round(dev * 6),          // membrane complexity: 3 → 9
    filaments: Math.round(10 + dev * 28),     // neural filaments: 10 → 38
    vessels: Math.round(8 + dev * 12),        // vascular network: 8 → 20
    coreScale: r2(1 + dev * 0.35),            // the core deepens with age
    asymmetry: r3(dev * 0.35 * (0.5 + 0.5 * hard)), // weathering breaks symmetry
    wear: r3(clamp(hard * dev * 1.2, 0, 1)),  // scar marks from a hard life
    hueDepth: r3(dev),                        // color deepens, never reskins
    ridge: r3(dev * (0.4 + 0.6 * hard)),       // membrane ridge sharpness
  };
}

// Honest developmental readout — derived from real counters only.
export function developmentBlurb(g) {
  const contacts = g.stimuli || 0;
  const mems = g.memories || 0;
  const temper = (g.timeSum || 0) < 60
    ? "yet unshaped"
    : calmRatio(g) >= 0.66 ? "predominantly calm"
    : calmRatio(g) >= 0.4 ? "a tempered life"
    : "predominantly strained";
  return `shaped by ${contacts} observer contact${contacts === 1 ? "" : "s"}` +
    ` · ${mems} ${mems === 1 ? "memory" : "memories"} · ${temper}`;
}
