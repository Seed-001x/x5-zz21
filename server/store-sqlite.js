// server/store-sqlite.js — SQLite store (local dev).
// Conventions kept from v0.1: single organism CHECK(id=1), birth row +
// first memory on creation, ms timestamps.

import Database from "better-sqlite3";
import { GENESIS } from "./engine.js";

export class SqliteStore {
  constructor(path = "organism.db") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organism(id INTEGER PRIMARY KEY CHECK(id=1), born_at INTEGER NOT NULL, state TEXT NOT NULL, cycles INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, summary TEXT NOT NULL, valence REAL, arousal REAL, importance REAL, source TEXT, associations TEXT);
      CREATE TABLE IF NOT EXISTS state_history(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_history_ts ON state_history(ts DESC);
    `);
    let row = this.db.prepare("SELECT * FROM organism WHERE id=1").get();
    if (!row) {
      const now = Date.now();
      this.db.prepare("INSERT INTO organism(id,born_at,state,cycles) VALUES(1,?,?,0)").run(now, JSON.stringify(GENESIS));
      this.memory("Initialization. First awareness cycle.", GENESIS, .95, "genesis", ["birth", "self"]);
      this.event("BIRTH", { designation: "X5-ZZ21" });
      row = this.db.prepare("SELECT * FROM organism WHERE id=1").get();
    }
  }

  load() { const r = this.db.prepare("SELECT * FROM organism WHERE id=1").get(); return { ...r, state: JSON.parse(r.state) }; }
  save(state, cycles) { this.db.prepare("UPDATE organism SET state=?,cycles=? WHERE id=1").run(JSON.stringify(state), cycles); }
  event(type, data = {}) { const ts = Date.now(); this.db.prepare("INSERT INTO events(ts,type,data) VALUES(?,?,?)").run(ts, type, JSON.stringify(data)); return { ts, type, data }; }
  memory(summary, s, importance = .5, source = "system", associations = []) {
    const ts = Date.now();
    const info = { ts, summary, valence: s.valence, arousal: s.arousal, importance, source, associations };
    const r = this.db.prepare("INSERT INTO memories(ts,summary,valence,arousal,importance,source,associations) VALUES(?,?,?,?,?,?,?)")
      .run(ts, summary, s.valence, s.arousal, importance, source, JSON.stringify(associations));
    return { id: Number(r.lastInsertRowid), ...info };
  }
  memories(limit = 80) { return this.db.prepare("SELECT * FROM memories ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, associations: JSON.parse(x.associations) })); }
  countMemories() { return this.db.prepare("SELECT COUNT(*) AS c FROM memories").get().c; }
  memoryById(id) { const x = this.db.prepare("SELECT * FROM memories WHERE id=?").get(id); return x ? { ...x, associations: JSON.parse(x.associations) } : null; }
  events(limit = 80) { return this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, data: JSON.parse(x.data) })); }
  sampleHistory(state) {
    const ts = Date.now();
    this.db.prepare("INSERT INTO state_history(ts,state) VALUES(?,?)").run(ts, JSON.stringify(state));
    this.db.prepare("DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT 4000)").run();
  }
  history(variable, limit = 240) {
    const rows = this.db.prepare("SELECT ts, state FROM state_history ORDER BY id DESC LIMIT ?").all(limit).reverse();
    if (!variable) return rows.map(r => ({ ts: r.ts, state: JSON.parse(r.state) }));
    return rows.map(r => ({ ts: r.ts, value: JSON.parse(r.state)[variable] ?? null }));
  }
  close() { this.db.close(); }
}
