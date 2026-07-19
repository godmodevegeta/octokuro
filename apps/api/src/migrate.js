"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const envFile = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to apply the Socrates migration.");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const migrations = ["0000_initial", "0001_durable_repository", "0002_local_passwords", "0003_physics_ontology", "0004_decision_grade_ontology", "0005_backfill_legacy_session_revision", "0006_remove_trace_snapshot_payload_index"].map((id) => ({ id, sql: fs.readFileSync(path.resolve(__dirname, `../drizzle/${id}.sql`), "utf8") }));

(async () => {
  try {
    await sql.unsafe("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = new Set((await sql`SELECT id FROM schema_migrations`).map((row) => row.id));
    for (const migration of migrations.filter((item) => !applied.has(item.id))) {
      for (const statement of migration.sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) await sql.unsafe(statement);
      await sql`INSERT INTO schema_migrations (id) VALUES (${migration.id})`;
      console.log(`Socrates database migration ${migration.id} applied.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
