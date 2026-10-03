// server/index.js — X5-ZZ21 organism server.
//
// Structure kept from v0.1: 10Hz simulation tick independent of clients,
// WebSocket state broadcast, stimulus → state change → delayed cognition.
// Extended with: async store (SQLite local / Postgres via DATABASE_URL),
// state-history sampling for waveforms, per-variable causality endpoint,
// LLM provider with transparent fallback, memory detail endpoint.

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createStore } from "./store.js";
import { Organism } from "./engine.js";
import { generateReply, llmConfigured } from "./llm.js";
import { createSalienceTracker, evaluateSalience, noteObserverContact, isContactEvent } from "./salience.js";
import path from "path";
import { fileURLToPath } from "url";

const store = await createStore();
let persisted = await store.load();
let cycles = persisted.cycles;
const clients = new Set();
const broadcast = (msg) => { const raw = JSON.stringify(msg); for (const c of clients) if (c.readyState === 1) c.send(raw); };
// Autonomous inner life: salience tracker for the organism's own memories.
// Created before record() so the event path can mark observer contact.
const salienceTracker = createSalienceTracker();
const record = (type, data = {}) => {
  // fire-and-forget: works with both sync (sqlite) and async (pg) adapters
  (async () => { try { await store.event(type, data); } catch (e) { console.error("[event]", e.message); } })();
  // Genuine outside contact resets the stillness clock (inner events don't).
  if (isContactEvent(type)) noteObserverContact(salienceTracker, Date.now());
  if (type === "STAGE_REACHED") {
    // A developmental milestone is worth remembering: it becomes a memory,
    // which itself counts as lived experience.
    (async () => {
      try {
        await store.memory(
          `Developmental milestone: entered the ${data.stage} stage. ${data.shapedBy}.`,
          organism.s, .7, "development", ["growth", "self"]
        );
        organism.noteMemory();
      } catch (e) { console.error("[memory]", e.message); }
    })();
  }
  broadcast({ type: "event", event: { ts: Date.now(), type, data } });
};
const organism = new Organism(persisted.state, record, { bornAt: persisted.born_at });

// Reconcile the experience counter with memories that predate the growth
// layer (e.g. the birth memory on a long-running organism). Never invents
// experience — only counts what the database actually holds.
try {
  const dbMems = await store.countMemories();
  if (dbMems > organism.s.growth.memories) organism.s.growth.memories = dbMems;
} catch (e) { console.error("[growth]", e.message); }

// Seed the salience tracker's baselines from real history: the rate cap
// resumes from the last autonomous memory, and the stillness clock from the
// last genuine observer contact — so a restart never invents a "long quiet"
// out of its own downtime, nor double-fires a recent memory.
try {
  const recentMems = await store.memories(80);
  const lastAuto = recentMems.find((m) => m.source === "autonomous");
  if (lastAuto) salienceTracker.lastMemoryTs = lastAuto.ts;
  const recentEvts = await store.events(200);
  const lastContact = Math.max(0, ...recentEvts.filter((e) => isContactEvent(e.type)).map((e) => e.ts));
  salienceTracker.stillnessSinceTs = Math.max(lastContact, recentMems[0]?.ts || 0, persisted.born_at);
} catch (e) { console.error("[salience]", e.message); }

// Catch-up: age and homeostasis advance after downtime without inventing
// memories. Ticks the proven coupling model in 2s steps, capped at 24h.
const lastEvent = (await store.events(1))[0];
const elapsed = Math.min((Date.now() - (lastEvent?.ts || Date.now())) / 1000, 86400);
if (elapsed > 5) {
  for (let i = 0; i < Math.floor(elapsed / 2); i++) organism.tick(organism.last + 2000);
  record("DOWNTIME_CATCHUP", { elapsedSeconds: Math.round(elapsed), simulatedTicks: Math.floor(elapsed / 2) });
}

const app = express(); app.use(express.json());

app.get("/api/snapshot", async (req, res) => {
  const p = await store.load();
  res.json({
    designation: "X5-ZZ21", bornAt: p.born_at, cycles,
    resting: organism.resting, llm: llmConfigured(),
    state: organism.s,
    development: organism.developmentSummary(),
    memories: await store.memories(40),
    events: await store.events(40),
  });
});

app.get("/api/memories/:id", async (req, res) => {
  const m = await store.memoryById(req.params.id);
  if (!m) return res.status(404).json({ error: "no such memory" });
  res.json(m);
});

// "WHY IS IT FEELING THIS?" — recent causal contributions per variable.
app.get("/api/why/:variable", (req, res) => {
  const key = req.params.variable;
  if (!organism.causes[key]) return res.status(404).json({ error: "unknown variable" });
  res.json({ variable: key, value: organism.s[key], causes: organism.causesFor(key) });
});

// Waveform history for a variable (or full snapshots when no variable).
app.get("/api/history", async (req, res) => {
  const limit = Math.min(600, Math.max(10, Number(req.query.limit) || 240));
  res.json(await store.history(req.query.variable || null, limit));
});

app.post("/api/interact", async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: "empty stimulus" });
  // 1. stimulus hits the body/state FIRST
  organism.stimulus("message", { text });
  const mem = await store.memory(`Observer stimulus: "${text.slice(0, 160)}"`, organism.s, .55, "observer", ["observer", "language"]);
  organism.noteMemory();
  record("MEMORY_FORMED", { memoryId: mem.id });
  // 2. cognition follows after a natural delay — the body reacts first
  record("COGNITION_STARTED", { memoryId: mem.id });
  const past = await store.memories(6);
  setTimeout(async () => {
    const { text: response, source } = await generateReply({ state: organism.s, memories: past, stimulus: text });
    organism.s.reward = Math.min(1, organism.s.reward + .035);
    organism.noteCause("cognitive response");
    const m2 = await store.memory(`Cognitive response: "${response.slice(0, 160)}"`, organism.s, .42, "self", ["cognition", "observer"]);
    organism.noteMemory();
    record("COGNITION_COMPLETED", { memoryId: m2.id, response, source });
  }, 900);
  res.json({ accepted: true, memory: mem });
});

app.post("/api/observe", async (req, res) => {
  organism.stimulus("observer", req.body || {});
  res.json({ ok: true });
});

app.post("/api/observer-left", (req, res) => {
  record("OBSERVER_LEFT", {});
  res.json({ ok: true });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws); record("OBSERVER_CONNECTED", {});
  ws.on("close", () => { clients.delete(ws); record("OBSERVER_DISCONNECTED", {}); });
});

setInterval(() => {
  cycles++;
  const state = organism.tick();
  broadcast({ type: "state", state, cycles, resting: organism.resting, now: Date.now() });
}, 100);

setInterval(async () => {
  try {
    await store.save(organism.s, cycles);
    await store.sampleHistory(organism.s);
  } catch (e) { console.error("[save]", e.message); }
}, 2000);

// Autonomous inner life: every 30s, notice whether anything in the
// organism's own experience was worth remembering. Local, deterministic,
// free — the LLM is never called on a timer.
setInterval(() => {
  evaluateSalience({ organism, tracker: salienceTracker, store, record })
    .catch((e) => console.error("[salience]", e.message));
}, 30000);

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => console.log(`X5-ZZ21 organism server: http://localhost:${PORT}`));
