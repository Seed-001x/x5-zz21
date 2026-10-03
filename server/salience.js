// server/salience.js — Autonomous inner life.
//
// The 12s autonomous event loop is deliberately memory-less (too chatty to
// remember). This evaluator runs on a slow cadence (30s) and notices only
// genuinely notable inner experience: threshold crossings, a completed rest,
// sustained unusual states, a drive turning toward need, long stillness.
//
// Deterministic: salience is a pure function of the state trajectory — no
// randomness anywhere in the decision. Local and free: the LLM is never
// called on a timer, so autonomous memory costs nothing.

export const EVAL_MIN_GAP_MS = 4 * 60 * 1000; // at most ~1 autonomous memory per 4 min
export const QUIET_MS = 20 * 60 * 1000;       // stillness worth noticing
export const SUSTAINED_MS = 5 * 60 * 1000;    // "held high for N minutes"

// Observer contact = genuine outside activity. Memories and inner events
// don't count: stillness means no one has been here, even if the organism
// has been busy with itself.
const CONTACT_EVENTS = ["STIMULUS_RECEIVED", "OBSERVER_DETECTED", "OBSERVER_CONNECTED"];
export function isContactEvent(type) { return CONTACT_EVENTS.includes(type); }

const r2 = (n) => Math.round(n * 100) / 100;

export function createSalienceTracker() {
  return {
    prev: null,            // numeric snapshot at last evaluation
    prevResting: null,
    prevDrive: null,
    lastMemoryTs: 0,       // rate cap (seeded from DB on boot)
    stillnessSinceTs: null, // last observer contact (seeded from DB on boot)
    quietFired: false,     // latch: one quiet memory per stillness episode
    restStart: null,       // {ts, fatigue, energy} on observed rest entry
    sustained: {},         // condKey -> sinceTs
    sustainedFired: {},    // condKey -> true (per-episode latch)
  };
}

/** Observer contact resets the stillness clock (and its latch). */
export function noteObserverContact(tracker, now) {
  tracker.stillnessSinceTs = now;
  tracker.quietFired = false;
}

// Only the fields the triggers compare — keeps baselines cheap and explicit.
const snap = (s) => ({
  stress: s.stress, energy: s.energy, trust: s.trust,
  curiosity: s.curiosity, arousal: s.arousal, fatigue: s.fatigue,
});

// --- Trigger set. Small and principled: each trigger names a kind of inner
// event that is rare enough to be worth one memory, with salience scaled by
// how far out of the ordinary it is. Summaries are observational and use
// only measured numbers — never invented content.

function checkRestCompleted(s, resting, t, now) {
  if (t.prevResting && !resting && t.restStart) {
    const mins = Math.max(1, Math.round((now - t.restStart.ts) / 60000));
    const out = {
      salience: .9,
      summary: `Rest ended after ${mins} minute${mins === 1 ? "" : "s"}; ` +
        `fatigue ${r2(t.restStart.fatigue)}→${r2(s.fatigue)}, energy ${r2(t.restStart.energy)}→${r2(s.energy)}.`,
      associations: ["autonomy", "rest"],
    };
    t.restStart = null;
    return out;
  }
  return null;
}

function checkStressSpike(s, t) {
  if (t.prev && t.prev.stress < .5 && s.stress >= .5) {
    const mag = Math.min(1, (s.stress - .5) / .3);
    return {
      salience: .5 + .3 * mag,
      summary: `Tension spiked; stress rose to ${r2(s.stress)}.`,
      associations: ["autonomy", "strain"],
    };
  }
  return null;
}

function checkEnergyLow(s, t) {
  if (t.prev && t.prev.energy >= .35 && s.energy < .35) {
    return {
      salience: .5,
      summary: `Energy ran low, down to ${r2(s.energy)}.`,
      associations: ["autonomy", "fatigue"],
    };
  }
  return null;
}

function checkTrustMilestone(s, t) {
  // Trust climbs slowly (.012 per message against homeostatic pull), so
  // crossing 0.50 means sustained contact actually moved it — a milestone.
  if (t.prev && t.prev.trust < .5 && s.trust >= .5) {
    return {
      salience: .7,
      summary: `Trust crossed 0.50.`,
      associations: ["autonomy", "trust", "observer"],
    };
  }
  return null;
}

const NEED_DRIVES = ["rest", "regulate"];
function checkDriveShift(s, t) {
  if (t.prevDrive && t.prevDrive !== s.dominantDrive && NEED_DRIVES.includes(s.dominantDrive)) {
    return {
      salience: .4,
      summary: `The body turned toward ${s.dominantDrive}.`,
      associations: ["autonomy", s.dominantDrive],
    };
  }
  return null;
}

const SUSTAINED_CONDS = [
  { key: "curiosity", label: "Curiosity", assoc: "attention", test: (s) => s.curiosity > .75 },
  { key: "arousal", label: "Arousal", assoc: "attention", test: (s) => s.arousal > .6 },
  { key: "strain", label: "Tension", assoc: "strain", test: (s) => s.stress > .35 },
];
function checkSustained(s, t, now) {
  let best = null;
  for (const c of SUSTAINED_CONDS) {
    if (c.test(s)) {
      if (t.sustained[c.key] == null) t.sustained[c.key] = now;
      const dur = now - t.sustained[c.key];
      if (dur >= SUSTAINED_MS && !t.sustainedFired[c.key]) {
        t.sustainedFired[c.key] = true;
        const mins = Math.round(dur / 60000);
        const cand = {
          salience: .5,
          summary: `${c.label} has held high for ${mins} minutes.`,
          associations: ["autonomy", c.assoc],
        };
        if (!best || cand.salience > best.salience) best = cand;
      }
    } else {
      // Condition cleared: the episode is over, latches reset for next time.
      delete t.sustained[c.key];
      delete t.sustainedFired[c.key];
    }
  }
  return best;
}

function checkQuiet(s, t, now) {
  if (t.quietFired || t.stillnessSinceTs == null) return null;
  const dur = now - t.stillnessSinceTs;
  if (dur < QUIET_MS) return null;
  t.quietFired = true;
  const mins = Math.round(dur / 60000);
  return {
    salience: .5,
    summary: `${mins} minutes without contact; the ${s.dominantDrive} drive was strongest.`,
    associations: ["autonomy", "stillness"],
  };
}

/**
 * Evaluate one slow-cadence pass. Forms at most one memory — the most
 * salient candidate — and only if the rate cap allows. Returns the formed
 * memory, or null.
 */
export async function evaluateSalience({ organism, tracker, store, record, now = Date.now() }) {
  const s = organism.s;
  const resting = organism.resting;

  // First run establishes baselines; never memorialize with no history.
  if (!tracker.prev) {
    tracker.prev = snap(s);
    tracker.prevResting = resting;
    tracker.prevDrive = s.dominantDrive;
    if (tracker.stillnessSinceTs == null) tracker.stillnessSinceTs = now;
    return null;
  }

  // Observe rest entry so the completion summary can use real from-values.
  if (!tracker.prevResting && resting) {
    tracker.restStart = { ts: now, fatigue: s.fatigue, energy: s.energy };
  }

  const candidates = [
    checkRestCompleted(s, resting, tracker, now),
    checkStressSpike(s, tracker),
    checkEnergyLow(s, tracker),
    checkTrustMilestone(s, tracker),
    checkDriveShift(s, tracker),
    checkSustained(s, tracker, now),
    checkQuiet(s, tracker, now),
  ].filter(Boolean);

  // Baselines advance whether or not anything fired.
  tracker.prev = snap(s);
  tracker.prevResting = resting;
  tracker.prevDrive = s.dominantDrive;

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.salience - a.salience);
  if (now - tracker.lastMemoryTs < EVAL_MIN_GAP_MS) return null;

  const best = candidates[0];
  const importance = Math.round((0.3 + 0.4 * Math.min(1, best.salience)) * 100) / 100;
  try {
    const mem = await store.memory(best.summary, s, importance, "autonomous", best.associations);
    organism.noteMemory(); // counts toward development, like every memory
    tracker.lastMemoryTs = now;
    record("MEMORY_FORMED", { memoryId: mem.id, autonomous: true });
    return mem;
  } catch (e) {
    console.error("[salience] memory failed:", e.message);
    return null;
  }
}
