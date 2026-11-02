// Proves that a backup of the database can really be restored.
//
// It dumps SOURCE_DATABASE_URL (default: DATABASE_URL), restores the dump into a
// brand-new scratch database on the same server, compares the row count of every
// table, then drops the scratch database and deletes the dump. Exits non-zero on
// any mismatch or failure. Read-only against the source.
//
//   node scripts/verifyBackup.mjs            # uses DATABASE_URL from .env
//   PG_BIN="C:/Program Files/PostgreSQL/17/bin" node scripts/verifyBackup.mjs
//
// Needs pg_dump, pg_restore and psql on PATH (or PG_BIN). Run it against a
// restore of a real provider backup as well: that is the only way to know the
// provider's automated backups are usable.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL && !process.env.SOURCE_DATABASE_URL && existsSync(".env")) {
  process.loadEnvFile(".env");
}
const sourceUrl = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceUrl) {
  console.error("Set SOURCE_DATABASE_URL or DATABASE_URL.");
  process.exit(1);
}

const bin = (name) => (process.env.PG_BIN ? join(process.env.PG_BIN, name) : name);
function run(command, args, { capture = false } = {}) {
  const result = spawnSync(bin(command), args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed${result.stderr ? `: ${result.stderr.trim().slice(0, 400)}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

// Prisma adds a `schema` query parameter that libpq tools reject.
const forPgTools = (value) => {
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url;
};
const source = forPgTools(sourceUrl);
const scratchName = `restore_check_${Date.now()}`;
const adminUrl = forPgTools(sourceUrl);
adminUrl.pathname = "/postgres";
const scratchUrl = forPgTools(sourceUrl);
scratchUrl.pathname = `/${scratchName}`;

const countsOf = (url) => {
  const sql = run(
    "psql",
    [url, "-At", "-c", `SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'`],
    { capture: true },
  );
  const rows = run("psql", [url, "-At", "-F", "|", "-c", `${sql} ORDER BY t`], { capture: true });
  return Object.fromEntries(rows.split("\n").filter(Boolean).map((line) => line.split("|")));
};

const workDir = mkdtempSync(join(tmpdir(), "shoproom-backup-"));
const dumpFile = join(workDir, "backup.dump");
let created = false;
let ok = false;

try {
  console.log(`Dumping ${source.pathname.slice(1)}…`);
  run("pg_dump", ["--format=custom", "--no-owner", "--file", dumpFile, source.toString()]);

  console.log(`Restoring into scratch database ${scratchName}…`);
  run("psql", [adminUrl.toString(), "-c", `CREATE DATABASE "${scratchName}"`], { capture: true });
  created = true;
  run("pg_restore", ["--no-owner", "--exit-on-error", "--dbname", scratchUrl.toString(), dumpFile]);

  const before = countsOf(source.toString());
  const after = countsOf(scratchUrl.toString());
  const tables = Object.keys(before);
  const mismatches = tables.filter((t) => before[t] !== after[t]);
  const missing = tables.filter((t) => !(t in after));
  const total = Object.values(after).reduce((sum, n) => sum + Number(n), 0);

  for (const t of tables) console.log(`  ${mismatches.includes(t) || missing.includes(t) ? "✗" : "✓"} ${t}: ${before[t]} → ${after[t] ?? "missing"}`);
  if (tables.length === 0) throw new Error("the source database has no tables");
  if (mismatches.length || missing.length) throw new Error(`row counts differ in: ${[...mismatches, ...missing].join(", ")}`);
  console.log(`\nRestore verified: ${tables.length} tables, ${total} rows identical.`);
  ok = true;
} catch (err) {
  console.error(`\nRestore verification FAILED: ${err.message}`);
} finally {
  if (created) {
    try {
      run("psql", [adminUrl.toString(), "-c", `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`], { capture: true });
    } catch (err) {
      console.error(`Could not drop ${scratchName}; drop it manually. ${err.message}`);
    }
  }
  rmSync(workDir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
