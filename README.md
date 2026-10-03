# X5-ZZ21 — Persistent Digital Organism Prototype

One organism. Server-side simulation. Browsers observe; they never own it.

## Run

```bash
npm install
npm test            # 24 tests: engine, homeostasis, causality, rest, growth, store
npm run build       # build the frontend
npm start           # organism server on http://localhost:8787
```

Dev mode: `npm run dev` (server with `--watch` + Vite on :5173).

### Environment

| var | purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string → production store (required on Render; disk is ephemeral) |
| `SQLITE_PATH` | SQLite file path (default `organism.db`; local dev only) |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI-compatible chat endpoint for the language organ (optional) |
| `PORT` | server port (default 8787) |

## Architecture

```
server/index.js      Express + ws. 10 Hz sim tick, 2 s persist, WS broadcast.
server/engine.js     Organism: coupled homeostatic variables + causality ledger + rest cycle + developmental growth (see `src/shared/growth.js`).
server/store.js      Factory: Postgres when DATABASE_URL set, else SQLite.
server/store-sqlite.js / store-pg.js   Same conventions, sync vs async (server awaits both).
server/llm.js        Language organ: provider interface + transparent fallback.
server/blockchain.js Placeholder: MARKET_EVENT shape only. No token economics.
src/main.jsx         Canvas organism + layered views (organism / nervous / state / memory / events).
```

## What is real

- One persistent organism (single row, `CHECK(id=1)`), server-side 10 Hz tick that runs with zero clients.
- Coupled homeostatic variables with baselines; deterministic — no randomness drives state.
- Every significant variable movement records a causal entry (`/api/why/:variable`).
- State history sampled every 2 s for per-variable waveforms (`/api/history`).
- Episodic memories with emotional snapshots, importance, associations; first memory is birth — no seeded history.
- Restart: same birth timestamp, catch-up ticks over downtime (capped 24 h), `DOWNTIME_CATCHUP` logged.
- Stimulus → body/state reacts first → delayed cognition (900 ms) → language.
- Rest cycle: fatigue > 0.8 triggers REST, recovery until < 0.35.
- Developmental morphology: the body plan (membrane lobes, filament/vessel counts, core depth, asymmetry, wear marks, hue depth, ridges) is a pure deterministic function of lived history — chronological age, experience counters (stimuli, memories, autonomous events), and long-run emotional averages. No randomness; per-organism idiosyncrasies come from a seed hashed from the birth timestamp. Named stages (nascent → juvenile → mature → elder) emit `STAGE_REACHED` events and form memories. The UI shows a live DEVELOPMENT readout derived from real counters.

## Deliberately not faked

- **No LLM is required.** Without `LLM_API_URL`/`LLM_API_KEY`, cognition uses the local templated fallback and the UI labels it "fallback cognition". The LLM (when configured) receives measured state and returns language only — it never sets state.
- **No blockchain.** `blockchain.js` defines the future `MARKET_EVENT` shape and validates it; nothing connects to a chain.
- **No sound.** Skipped for the prototype.
- **Frontend PRNG is seeded and visual-only** (`mulberry32`): node layout, constellation positions. It never touches organism state.
- Waveform/why data comes from the real causal ledger and history table — not synthesized.

## Verified in this sandbox

- `npm test`: 24/24 pass (engine coupling, threat pathway, homeostasis convergence, decay, determinism, causality, rest cycle, growth determinism/monotonicity/stages/weathering/merge, birth/memory/event/history/save-load).
- Server boots, ticks with zero clients, WS streams ~10 Hz state snapshots.
- Restart test: same birth timestamp, cycles advanced, `DOWNTIME_CATCHUP` logged, memories preserved.
- better-sqlite3 v13 (prebuilt for Node 24). Postgres adapter verified against live Postgres on the Render deploy (`[store] postgres (persistent)`, birth memory intact).

## Known simplifications

- Memory retrieval is recency-capped (last 6 into the LLM prompt); no salience-weighted recall yet.
- Catch-up replays the tick loop rather than an analytic solution.
- The body is canvas 2D, not Three.js — chosen for reliability; all motion parameters remain state-driven.
- Autonomous behavior is a 12 s drive-based scheduler, not a planner.
