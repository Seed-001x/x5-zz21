// server/store.js — Store factory.
//
// DATABASE_URL set    -> Postgres (required in production: Render's disk is
//                        ephemeral, so SQLite would lose the organism).
// DATABASE_URL unset  -> better-sqlite3 file (local dev).
// The server awaits every store call, so sync and async adapters mix freely.

import { SqliteStore } from "./store-sqlite.js";
import { PgStore } from "./store-pg.js";

export async function createStore() {
  if (process.env.DATABASE_URL) {
    const pg = new PgStore(process.env.DATABASE_URL);
    await pg.init();
    console.log("[store] postgres (persistent)");
    return pg;
  }
  const lite = new SqliteStore(process.env.SQLITE_PATH || "organism.db");
  console.log("[store] sqlite (local dev file)");
  return lite;
}
