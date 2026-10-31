// Offline word-overlap check. Reuse is now decided by a Gemini judge in
// agents/rfp.ts; this only shows how close the pairs are lexically and which
// unrelated questions score the same (why overlap alone cannot decide).
// (original description:) Offline check of the fix-reuse matcher. No Meko, no Gemini, runs instantly.
//
// Run: pnpm tsx scripts/match-check.ts [--aegis=data/aegis.xlsx]
//
// For each human-fixed Meridian question it shows how every Aegis question
// scores against it, so you can see why a reworded question did or did not
// match and how much room there is before a wrong one would match.

import path from "node:path";
import { readQuestions } from "@/lib/xlsx";
import { matchDetails } from "@/agents/rfp";

// Q40 (personal devices)        -> Aegis Q14 (personal laptops or phones)
// Q43 (certificate of deletion) -> Aegis Q8  (formal proof of deletion)
const FIXES = [
  { number: 40, expectAegis: 14 },
  { number: 43, expectAegis: 8 },
];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const meridian = await readQuestions(path.resolve(process.cwd(), "data", "meridian.xlsx"));
  const aegis = await readQuestions(path.resolve(process.cwd(), arg("aegis", "data/aegis.xlsx")));

  for (const fix of FIXES) {
    const fq = meridian.find((q) => q.number === fix.number);
    if (!fq) {
      console.error(`Meridian Q${fix.number} not found`);
      continue;
    }
    console.log(`\n=== Meridian Q${fix.number}: ${fq.question}`);

    const scored = aegis
      .map((a) => ({ a, d: matchDetails(a.question, fq.question) }))
      .sort((x, y) => y.d.ratio - x.d.ratio);

    const expected = scored.find((s) => s.a.number === fix.expectAegis);
    if (expected) {
      const { a, d } = expected;
      console.log(`Expected Aegis Q${a.number}: ${a.question}`);
      console.log(`  ${d.match ? "MATCHES" : "NO MATCH"}  ratio=${d.ratio.toFixed(2)}  shared=${d.shared.length}  numbersEqual=${d.numbersEqual}`);
      console.log(`  shared:        ${d.shared.join(", ") || "-"}`);
      console.log(`  only Aegis:    ${d.onlyA.join(", ") || "-"}`);
      console.log(`  only Meridian: ${d.onlyB.join(", ") || "-"}`);
    } else {
      console.log(`Expected Aegis Q${fix.expectAegis} not found in sheet 2`);
    }

    console.log("Closest Aegis questions:");
    for (const { a, d } of scored.slice(0, 4)) {
      const tag = a.number === fix.expectAegis ? " <- expected" : "";
      console.log(`  Q${a.number} ratio=${d.ratio.toFixed(2)} shared=${d.shared.length} ${d.match ? "MATCH" : "-----"}${tag}  ${a.question.slice(0, 80)}`);
    }
    const wrong = scored.filter((s) => s.d.match && s.a.number !== fix.expectAegis);
    if (wrong.length > 0) {
      console.log(`WARNING: also matches ${wrong.map((w) => `Q${w.a.number}`).join(", ")} (would reuse the fix wrongly)`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});