// Learning-loop proof (the 7 PM gate).
//
// Run: pnpm tsx --env-file=.env.local scripts/learning-test.ts
// Options:
//   --aegis=data/aegis.xlsx   path to sheet 2 (default data/aegis.xlsx)
//   --keep                    keep the test memories in Meko (default: delete them)
//
// Flow: run sheet 1 -> fix Q40 and Q43 as a human -> wait until the fixes are
// searchable in Meko -> run sheet 2 -> check Aegis Q8 and Q14 were filled from
// the fixes (reused_from_fix = 1) and nothing else was reused by mistake.
//
// Needs live Meko + Gemini. It refuses to run in Demo Mode.

import path from "node:path";
import ExcelJS from "exceljs";
import { runRfp, humanFix, getRow, sameQuestion } from "@/agents/rfp";
import { searchMemory, deleteMemory } from "@/lib/meko";
import { getDb } from "@/lib/db";

const FIX_NUMBERS = [40, 43]; // Meridian questions a human fixes
// Aegis questions that should reuse those fixes: Q43 -> Aegis Q8, Q40 -> Aegis Q14
const EXPECT_REUSED = [8, 14, 30];
const APPROVER = "Karan";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function readKeyAnswers(filePath: string): Promise<Map<number, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Sheet1 key (Meridian)");
  if (!ws) fail('Worksheet "Sheet1 key (Meridian)" not found in answer_key.xlsx');
  const out = new Map<number, string>();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const vals = row.values as ExcelJS.CellValue[];
    const id = typeof vals[1] === "number" ? vals[1] : Number(vals[1]);
    if (!isNaN(id) && vals[3] != null) out.set(id, String(vals[3]));
  });
  return out;
}

function fixQuestionFromMemory(text: string): string | null {
  const idx = text.indexOf("RFP_FIX");
  if (idx < 0) return null;
  const parts = text.slice(idx).split("|").map((p) => p.trim());
  return parts.length >= 4 ? parts[1] : null;
}

async function waitForFix(question: string, timeoutMs = 60_000): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  let lastSeen: string[] = [];
  while (Date.now() < end) {
    const mems = await searchMemory(
      "plexus_rfp",
      `RFP_FIX ${question}`,
      `rfp/lt_poll_${Date.now()}`,
    );
    lastSeen = mems.map((m) => m.text.slice(0, 160));
    for (const m of mems) {
      const q = fixQuestionFromMemory(m.text);
      if (q && sameQuestion(question, q)) return m.text;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error("Last memories returned by search:");
  for (const t of lastSeen) console.error(`  - ${t}`);
  return null;
}

async function main() {
  if (process.env.DEMO_MODE === "true") fail("Turn Demo Mode off: this test needs live Meko and Gemini.");
  if (!process.env.MEKO_DATAPACK_ID || !process.env.MEKO_AUTH) {
    fail("MEKO_DATAPACK_ID and MEKO_AUTH must be loaded. Use: pnpm tsx --env-file=.env.local scripts/learning-test.ts");
  }
  const keep = process.argv.includes("--keep");
  const meridianPath = path.resolve(process.cwd(), "data", "meridian.xlsx");
  const keyPath = path.resolve(process.cwd(), "data", "answer_key.xlsx");
  const aegisPath = path.resolve(process.cwd(), arg("aegis", "data/aegis.xlsx"));

  const suffix = crypto.randomUUID().slice(0, 6);
  const id1 = `lt1_${suffix}`;
  const id2 = `lt2_${suffix}`;

  const keyAnswers = await readKeyAnswers(keyPath);
  const memoryIds: string[] = [];
  const problems: string[] = [];

  // 1. Sheet 1
  console.log(`1) Running sheet 1 (${id1})...`);
  const r1 = await runRfp(id1, meridianPath);
  console.log(`   filled ${r1.filled}, flagged ${r1.flagged}, errors ${r1.errors}, total ${r1.total}`);
  if (r1.errors > 0) fail("Sheet 1 had errors. Fix those first (see flag_reason).");

  // 2. Human fixes
  console.log(`2) Fixing Q${FIX_NUMBERS.join(" and Q")} as ${APPROVER}...`);
  const fixedQuestions: string[] = [];
  for (const n of FIX_NUMBERS) {
    const rowId = `${id1}_q${n}`;
    const before = getRow(rowId);
    if (!before) fail(`Row ${rowId} not found. Does meridian.xlsx have question ${n}?`);
    if (before.status === "filled") {
      problems.push(`Q${n} was already filled in sheet 1, so the demo will not show it going red.`);
    } else {
      console.log(`   Q${n} was ${before.status} (${before.flag_reason ?? "no reason"})`);
    }
    const answer = keyAnswers.get(n);
    if (!answer) fail(`No correct answer for Q${n} in answer_key.xlsx`);
    const res = await humanFix(rowId, answer, APPROVER);
    if (res.fallback) problems.push(`Q${n}: fix was saved locally only, Meko memory was not written.`);
    if (res.memoryId && /^[0-9a-f-]{36}$/i.test(res.memoryId)) memoryIds.push(res.memoryId);
    fixedQuestions.push(res.row.question);
  }

  // 3. Wait for the memories to become searchable
  console.log("3) Waiting for the fixes to be searchable in Meko (up to 60s each)...");
  for (let i = 0; i < fixedQuestions.length; i++) {
    const text = await waitForFix(fixedQuestions[i]);
    if (!text) {
      problems.push(`Q${FIX_NUMBERS[i]}: fix never came back from memory search in the expected "RFP_FIX | ..." format.`);
    } else {
      console.log(`   Q${FIX_NUMBERS[i]} stored as: ${text.slice(0, 220)}${text.length > 220 ? "..." : ""}`);
    }
  }

  // 4. Sheet 2
  console.log(`4) Running sheet 2 (${id2}) from ${path.relative(process.cwd(), aegisPath)}...`);
  const r2 = await runRfp(id2, aegisPath);
  console.log(`   filled ${r2.filled}, flagged ${r2.flagged}, errors ${r2.errors}, total ${r2.total}`);

  // 5. Check reuse
  console.log("5) Checking reuse...");
  for (const n of EXPECT_REUSED) {
    const row = getRow(`${id2}_q${n}`);
    if (!row) {
      problems.push(`Aegis Q${n}: row not found.`);
      continue;
    }
    const ok = row.reused_from_fix === 1 && row.status === "filled";
    console.log(`   Aegis Q${n}: ${ok ? "PASS" : "FAIL"}  status=${row.status} reused=${row.reused_from_fix} source=${row.source_ref ?? "-"}`);
    if (!ok) {
      problems.push(`Aegis Q${n} was not filled from a human fix (status ${row.status}, reason ${row.flag_reason ?? "none"}).`);
    }
  }

  const reused = getDb()
    .prepare("SELECT number FROM rfp_questions WHERE questionnaire_id = ? AND reused_from_fix = 1 ORDER BY number")
    .all(id2) as Array<{ number: number }>;
  const unexpected = reused.map((r) => r.number).filter((n) => !EXPECT_REUSED.includes(n));
  if (unexpected.length > 0) {
    for (const n of unexpected) {
      const row = getRow(`${id2}_q${n}`);
      console.log(`   Unexpected reuse, Aegis Q${n}: ${row?.question ?? "?"}`);
      console.log(`     answer: ${(row?.answer ?? "").slice(0, 200)}`);
      console.log(`     source: ${row?.source_ref ?? "-"}`);
    }
    problems.push(`Reused a fix on unexpected Aegis questions: ${unexpected.join(", ")}. The match may be too loose.`);
  }

  // Cleanup
  if (!keep && memoryIds.length > 0) {
    console.log(`Cleaning up ${memoryIds.length} test memories (use --keep to skip)...`);
    for (const id of memoryIds) {
      try {
        await deleteMemory(id, "plexus_rfp");
      } catch (err) {
        console.warn(`   could not delete ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (keep) {
    console.log("Keeping test memories. Run scripts/reset-demo.ts --meko before the real demo.");
  }

  if (problems.length > 0) {
    console.error("\nProblems:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nPASS: what one agent learns, every agent knows.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});