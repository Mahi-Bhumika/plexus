// Put the app back to a clean demo start.
//
// Run: pnpm tsx --env-file=.env.local scripts/reset-demo.ts
//   (no flags)       clear demo data in SQLite and delete test fixtures
//   --meko           also LIST learned fixes (RFP_FIX memories) in Meko
//   --meko --yes     also DELETE them
//
// Why Meko matters: if an RFP_FIX memory for a Meridian question is still
// there, that question fills instantly in the demo and nothing turns red.
// Run this with --meko --yes before every rehearsal and before the real demo.
//
// Kept on purpose: users, saas_billing, sso_logins (seed data) and the
// *_demo.json fixtures that Demo Mode replays.

import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { searchMemory, deleteMemory } from "@/lib/meko";

const CLEAR_TABLES = [
  "rfp_questions",
  "questionnaires",
  "tasks",
  "access_requests",
  "expenses",
  "audit_events",
  "traces",
  "memories",
];

function clearDb(): void {
  const db = getDb();
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (t) => t.name,
    ),
  );
  const tx = db.transaction(() => {
    for (const table of CLEAR_TABLES) {
      if (!existing.has(table)) continue;
      const res = db.prepare(`DELETE FROM ${table}`).run();
      console.log(`  ${table}: removed ${res.changes} rows`);
    }
  });
  tx();
}

function removeFixtures(): void {
  const root = path.resolve(process.cwd(), "fixtures");
  let removed = 0;

  const rfpDir = path.join(root, "rfp");
  if (fs.existsSync(rfpDir)) {
    for (const f of fs.readdirSync(rfpDir)) {
      if (f.includes("_test_") || f.startsWith("lt_poll_") || /_lt[12]_/.test(f)) {
        fs.rmSync(path.join(rfpDir, f));
        removed++;
      }
    }
  }

  const mekoDir = path.join(root, "meko");
  if (fs.existsSync(mekoDir)) {
    for (const f of fs.readdirSync(mekoDir)) {
      // timestamped write/poll recordings; never replayed by Demo Mode
      if (f.startsWith("addMemory_") || f.startsWith("deleteMemory_") || f.startsWith("logTurn_")) {
        fs.rmSync(path.join(mekoDir, f));
        removed++;
      }
    }
  }
  console.log(`  fixtures: removed ${removed} test files (demo fixtures kept)`);
}

async function learnedFixes(): Promise<Array<{ id: string; text: string }>> {
  const queries = ["RFP_FIX", "RFP_FIX approved answer", "RFP_FIX Karan"];
  const found = new Map<string, { id: string; text: string }>();
  for (const q of queries) {
    const mems = await searchMemory("plexus_rfp", q, `rfp/reset_${Date.now()}`);
    for (const m of mems) {
      if (m.id && m.text.includes("RFP_FIX |")) found.set(m.id, { id: m.id, text: m.text });
    }
  }
  return [...found.values()];
}

async function main() {
  console.log("Clearing demo data in SQLite:");
  clearDb();
  removeFixtures();

  if (!process.argv.includes("--meko")) {
    console.log("\nSkipped Meko. Add --meko to check for learned fixes that would hide the red cells.");
    return;
  }
  if (!process.env.MEKO_DATAPACK_ID || !process.env.MEKO_AUTH) {
    console.error("\nMEKO_DATAPACK_ID and MEKO_AUTH must be loaded. Use --env-file=.env.local.");
    process.exit(1);
  }

  const fixes = await learnedFixes();
  console.log(`\nLearned fixes in Meko: ${fixes.length}`);
  for (const f of fixes) console.log(`  - ${f.id}  ${f.text.slice(0, 110)}`);

  if (fixes.length === 0) return;
  if (!process.argv.includes("--yes")) {
    console.log("\nDry run. Add --yes to delete these.");
    return;
  }
  for (const f of fixes) {
    try {
      await deleteMemory(f.id, "plexus_rfp");
      console.log(`  deleted ${f.id}`);
    } catch (err) {
      console.warn(`  could not delete ${f.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("Done. Meko search can lag a few seconds, so re-run without --yes to confirm the list is empty.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
