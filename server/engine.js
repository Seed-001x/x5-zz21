// server/engine.js — Organism simulation core.
//
// Coupling model kept from v0.1: homeostatic lerp toward targets plus
// coupled differential terms (cortisol/stress/arousal/valence/dopamine/
// serotonin/energy/fatigue/socialNeed/reward/threat). Deterministic — no
// randomness drives state.
//
// Added: per-variable causal tracking (which events/reasons moved which
// variable, for the "WHY IS IT FEELING THIS?" view), an explicit
// sleep/rest cycle driven by fatigue, and developmental morphology — the
// body plan is a pure, deterministic function of lived history (age,
// experience counters, long-run emotional averages). See src/shared/growth.js.

import { STAGES, stageIndexFor, formFor, developmentBlurb, ageDays, calmRatio, experience, hashSeed } from "../src/shared/growth.js";

const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;

export const GENESIS = {
  valence: .52, arousal: .28, stress: .18, curiosity: .72, trust: .30,
  energy: .78, socialNeed: .35, novelty: .58, confidence: .42, fatigue: .12,
  stability: .72, reward: .20, threat: .08,
  dopamine: .44, serotonin: .54, cortisol: .20, oxytocin: .26,
  attention: { x: 0, y: 0, intensity: 0 }, dominantDrive: "observe",
  // Developmental morphology. Counters accumulate in tick()/stimulus();
  // form is recomputed deterministically from them every tick.
  growth: { ageSec: 0, stimuli: 0, memories: 0, autonomous: 0, stressSum: 0, timeSum: 0, stageIndex: 0 },
  form: null,
};

const targets = {
  valence: .52, arousal: .27, stress: .16, curiosity: .62, trust: .32,
  energy: .70, socialNeed: .42, novelty: .48, confidence: .45, fatigue: .18,
  stability: .74, reward: .18, threat: .06,
  dopamine: .42, serotonin: .55, cortisol: .18, oxytocin: .28
};

const CAUSE_THRESHOLD = 0.0008; // min |delta| per tick to record a cause
const CAUSE_KEEP = 12;

export class Organism {
  constructor(state, emit, opts = {}) {
    this.s = { ...GENESIS, ...state };
    // growth must be a fresh object per organism — never mutate GENESIS
    this.s.growth = { ...GENESIS.growth, ...(state.growth || {}) };
    this.emit = emit;
    // Seed is derived from the true birth timestamp: unique per organism,
    // fully deterministic. Drives idiosyncratic form details (lobe phase,
    // wear-mark placement) — never state.
    this.bornAt = opts.bornAt || Date.now();
    this.seed = hashSeed(String(this.bornAt));
    this.s.form = formFor(this.s.growth, this.seed);
    this.last = Date.now();
    this.lastAutonomy = Date.now();
    this.resting = false;
    // causal ledger: key -> [{t, delta, reason, eventId}]
    this.causes = {};
    for (const k of Object.keys(targets)) this.causes[k] = [];
    this.pendingCause = null; // {reason, eventId} set by stimulus/autonomy
  }

  /** Attribute the next tick's significant deltas to a reason. */
  noteCause(reason, eventId = null) {
    this.pendingCause = { reason, eventId };
  }

  causesFor(key) {
    return (this.causes[key] || []).slice().reverse();
  }

  /** A memory was formed (called by the server after each store.memory). */
  noteMemory() {
    this.s.growth.memories++;
  }

  /** Honest developmental readout for the UI — real counters only. */
  developmentSummary() {
    const g = this.s.growth;
    const si = stageIndexFor(g);
    return {
      stage: STAGES[si].name,
      stageIndex: si,
      ageDays: Math.round(ageDays(g) * 100) / 100,
      experience: Math.round(experience(g) * 10) / 10,
      stimuli: g.stimuli,
      memories: g.memories,
      autonomous: g.autonomous,
      calmRatio: Math.round(calmRatio(g) * 1000) / 1000,
      blurb: developmentBlurb(g),
      form: this.s.form,
    };
  }

  _recordCauses(before, now) {
    const cause = this.pendingCause || { reason: "homeostasis", eventId: null };
    for (const k of Object.keys(targets)) {
      const d = this.s[k] - before[k];
      if (Math.abs(d) >= CAUSE_THRESHOLD) {
        const list = this.causes[k];
        list.push({ t: now, delta: Math.round(d * 10000) / 10000, reason: cause.reason, eventId: cause.eventId });
        if (list.length > CAUSE_KEEP) list.shift();
      }
    }
    this.pendingCause = null;
  }

  tick(now = Date.now()) {
    const dt = Math.min((now - this.last) / 1000, 2); this.last = now;
    const s = this.s;
    const before = {};
    for (const k of Object.keys(targets)) before[k] = s[k];

    // --- v0.1 coupling model (unchanged) ---
    for (const k of Object.keys(targets)) {
      const rate = ["trust", "confidence", "oxytocin"].includes(k) ? .006 : .018;
      s[k] = lerp(s[k], targets[k], clamp(rate * dt));
    }
    s.cortisol = clamp(s.cortisol + (s.threat * .022 - s.stability * .008) * dt);
    s.stress = clamp(s.stress + (s.cortisol * .018 + s.threat * .025 - s.serotonin * .015) * dt);
    s.trust = clamp(s.trust - s.cortisol * .004 * dt); // sustained threat erodes trust
    s.arousal = clamp(s.arousal + (s.stress * .010 + s.curiosity * .004 - s.fatigue * .009) * dt);
    s.valence = clamp(s.valence + (s.reward * .009 + s.serotonin * .005 - s.stress * .010) * dt);
    s.dopamine = clamp(s.dopamine + (s.reward * .014 + s.novelty * .005 - s.fatigue * .005) * dt);
    s.serotonin = clamp(s.serotonin + (s.stability * .006 - s.stress * .004) * dt);
    s.energy = clamp(s.energy - (.0009 + s.arousal * .0008) * dt);
    s.fatigue = clamp(s.fatigue + .0007 * dt - s.energy * .00015 * dt);
    s.socialNeed = clamp(s.socialNeed + .00055 * dt);
    s.reward = lerp(s.reward, .12, clamp(.035 * dt));
    s.threat = lerp(s.threat, .04, clamp(.05 * dt));
    s.attention.intensity = lerp(s.attention.intensity, 0, clamp(.25 * dt));

    // --- rest cycle: fatigue-driven sleep ---
    if (!this.resting && s.fatigue > 0.8) {
      this.resting = true;
      this.emit("REST_STARTED", { fatigue: +s.fatigue.toFixed(3) });
    }
    if (this.resting) {
      s.fatigue = clamp(s.fatigue - .004 * dt);
      s.arousal = clamp(s.arousal - .006 * dt);
      s.stress = clamp(s.stress - .004 * dt);
      s.energy = clamp(s.energy + .002 * dt);
      if (s.fatigue < 0.35) {
        this.resting = false;
        this.emit("REST_ENDED", { fatigue: +s.fatigue.toFixed(3) });
      }
    }

    const driveScores = {
      rest: s.fatigue * (1 - s.energy),
      connect: s.socialNeed * (1 - s.trust * .25),
      explore: s.curiosity * s.novelty,
      regulate: s.stress + s.cortisol * .7,
      observe: .22 + s.curiosity * .2
    };
    s.dominantDrive = Object.entries(driveScores).sort((a, b) => b[1] - a[1])[0][0];

    // --- developmental growth: slow, deterministic, persisted ---
    // Counters accumulate here, so downtime catch-up ticks age the body too.
    const g = s.growth;
    g.ageSec += dt;
    g.timeSum += dt;
    g.stressSum += s.stress * dt;
    s.form = formFor(g, this.seed);
    // Stage transitions are monotonic and each emits its own event.
    const targetStage = stageIndexFor(g);
    while (g.stageIndex < targetStage) {
      g.stageIndex++;
      this.emit("STAGE_REACHED", {
        stage: STAGES[g.stageIndex].name,
        stageIndex: g.stageIndex,
        shapedBy: developmentBlurb(g),
      });
    }

    this._recordCauses(before, now);

    if (now - this.lastAutonomy > 12000) {
      this.lastAutonomy = now;
      s.growth.autonomous++;
      const drive = s.dominantDrive;
      const text = {
        rest: "Internal activity reduced; conserving energy.",
        connect: "Social need increased; attention moved outward.",
        explore: "Novelty drive triggered an exploratory attention shift.",
        regulate: "Homeostatic regulation prioritized.",
        observe: "Attention shifted without external stimulus."
      }[drive];
      this.noteCause("autonomous behavior");
      this.emit("AUTONOMOUS_EVENT", { drive, text });
    }
    return s;
  }

  stimulus(kind, payload = {}) {
    const s = this.s;
    s.growth.stimuli++; // every contact, of any kind, is lived experience
    // record a directly-applied delta in the causal ledger
    const apply = (key, delta, reason) => {
      const before = s[key];
      s[key] = clamp(s[key] + delta);
      const actual = s[key] - before;
      if (Math.abs(actual) >= CAUSE_THRESHOLD) {
        const list = this.causes[key];
        list.push({ t: Date.now(), delta: Math.round(actual * 10000) / 10000, reason, eventId: null });
        if (list.length > CAUSE_KEEP) list.shift();
      }
    };
    if (kind === "observer") {
      const intensity = clamp(payload.intensity ?? .15);
      apply("curiosity", .05 * intensity, "observer presence");
      apply("arousal", .025 * intensity, "observer presence");
      s.attention = { x: payload.x ?? 0, y: payload.y ?? 0, intensity };
      this.noteCause("observer presence");
      this.emit("OBSERVER_DETECTED", { intensity: +intensity.toFixed(3) });
    }
    if (kind === "message") {
      const text = String(payload.text || "");
      const magnitude = clamp(.22 + Math.min(text.length, 500) / 1500);
      apply("arousal", .09 * magnitude, "observer message");
      apply("curiosity", .13 * magnitude, "observer message");
      apply("socialNeed", -.10, "observer message");
      apply("reward", .07, "observer message");
      apply("dopamine", .05, "observer message");
      apply("trust", .012, "observer message");
      this.noteCause("observer message");
      this.emit("STIMULUS_RECEIVED", { kind: "message", magnitude: +magnitude.toFixed(3) });
      return magnitude;
    }
  }
}
