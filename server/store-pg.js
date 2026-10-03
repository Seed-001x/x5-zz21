// server/store-pg.js — Postgres store (production).
// Same conventions as the SQLite store: single organism CHECK(id=1),
// birth row + first memory on creation, ms timestamps. All methods are
// async; the server awaits every store call so both adapters work.

import pg from "pg";
import { GENESIS } from "./engine.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organism(id INTEGER PRIMARY KEY CHECK(id=1), born_at BIGINT NOT NULL, state TEXT NOT NULL, cycles BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories(id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, summary TEXT NOT NULL, valence REAL, arousal REAL, importance REAL, source TEXT, associations TEXT);
CREATE TABLE IF NOT EXISTS state_history(id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, state TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(ts DESC);
CREATE INDEX IF NOT EXISTS idx_history_ts ON state_history(ts DESC);
`;

export class PgStore {
  constructor(url) {
    this.pool = new pg.Pool({ connectionString: url, max: 5 });
  }

  async init() {
    await this.pool.query(SCHEMA);
    const { rows } = await this.pool.query("SELECT * FROM organism WHERE id=1");
    if (!rows.length) {
      const now = Date.now();
      await this.pool.query("INSERT INTO organism(id,born_at,state,cycles) VALUES(1,$1,$2,0)", [now, JSON.stringify(GENESIS)]);
      await this.memory("Initialization. First awareness cycle.", GENESIS, .95, "genesis", ["birth", "self"]);
      await this.event("BIRTH", { designation: "X5-ZZ21" });
    }
  }

  async load() {
    const { rows } = await this.pool.query("SELECT * FROM organism WHERE id=1");
    const r = rows[0];
    return { ...r, born_at: Number(r.born_at), cycles: Number(r.cycles), state: JSON.parse(r.state) };
  }

  async save(state, cycles) {
    await this.pool.query("UPDATE organism SET state=$1,cycles=$2 WHERE id=1", [JSON.stringify(state), cycles]);
  }

  async event(type, data = {}) {
    const ts = Date.now();
    await this.pool.query("INSERT INTO events(ts,type,data) VALUES($1,$2,$3)", [ts, type, JSON.stringify(data)]);
    return { ts, type, data };
  }

  async memory(summary, s, importance = .5, source = "system", associations = []) {
    const ts = Date.now();
    const { rows } = await this.pool.query(
      "INSERT INTO memories(ts,summary,valence,arousal,importance,source,associations) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [ts, summary, s.valence, s.arousal, importance, source, JSON.stringify(associations)]
    );
    return { id: Number(rows[0].id), ts, summary, valence: s.valence, arousal: s.arousal, importance, source, associations };
  }

  async memories(limit = 80) {
    const { rows } = await this.pool.query("SELECT * FROM memories ORDER BY id DESC LIMIT $1", [limit]);
    return rows.map((x) => ({ ...x, id: Number(x.id), ts: Number(x.ts), associations: JSON.parse(x.associations) }));
  }

  async countMemories() {
    const { rows } = await this.pool.query("SELECT COUNT(*) AS c FROM memories");
    return Number(rows[0].c);
  }

  async memoryById(id) {
    const { rows } = await this.pool.query("SELECT * FROM memories WHERE id=$1", [id]);
    const x = rows[0];
    return x ? { ...x, id: Number(x.id), ts: Number(x.ts), associations: JSON.parse(x.associations) } : null;
  }

  async events(limit = 80) {
    const { rows } = await this.pool.query("SELECT * FROM events ORDER BY id DESC LIMIT $1", [limit]);
    return rows.map((x) => ({ ...x, id: Number(x.id), ts: Number(x.ts), data: JSON.parse(x.data) }));
  }

  async sampleHistory(state) {
    const ts = Date.now();
    await this.pool.query("INSERT INTO state_history(ts,state) VALUES($1,$2)", [ts, JSON.stringify(state)]);
    await this.pool.query("DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT 4000)");
  }

  async history(variable, limit = 240) {
    const { rows } = await this.pool.query("SELECT ts, state FROM state_history ORDER BY id DESC LIMIT $1", [limit]);
    const rev = rows.reverse();
    if (!variable) return rev.map((r) => ({ ts: Number(r.ts), state: JSON.parse(r.state) }));
    return rev.map((r) => ({ ts: Number(r.ts), value: JSON.parse(r.state)[variable] ?? null }));
  }

  async close() { await this.pool.end(); }
}
