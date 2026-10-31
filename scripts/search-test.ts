// Permission and briefing check for Cmd+K search and Catch-Me-Up.
//
// Run: pnpm tsx --env-file=.env.local scripts/search-test.ts [--topic=Meridian] [--days=4]
// Set SEARCH_AS_OF=2026-11-01 (any ISO date) to pin "today" so the window is repeatable.
//
// Hard checks (fail the run): a restricted document never appears in sources or
// briefing points for a role that cannot see it, and none of its figures leak
// into the answer text. Everything else is printed for you to read.

import { loadRegistry, searchDocs, catchMeUp, canSee, ROLES, type Role } from "@/lib/search";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const failures: string[] = [];
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

// Distinctive figures: 5+ digit numbers or comma-grouped amounts. Years and dates are ignored.
function figures(text: string): string[] {
  return [...new Set(text.match(/\b\d{5,}\b|\b\d{1,3}(?:,\d{3})+\b/g) ?? [])];
}

async function main() {
  const topic = arg("topic", "Meridian");
  const days = Number(arg("days", "4"));
  const docs = loadRegistry();

  console.log(`Loaded ${docs.length} documents:`);
  for (const d of docs) {
    const access = d.access === "all" ? "all" : d.access.join(", ");
    console.log(`  ${d.id}  |  ${d.title}  |  ${d.date?.slice(0, 10) ?? "NO DATE"}  |  ${access} (${d.accessSource})`);
  }
  const undated = docs.filter((d) => !d.date);
  if (undated.length > 0) console.log(`NOTE: ${undated.length} undated document(s) never appear in Catch-Me-Up: ${undated.map((d) => d.id).join(", ")}`);
  const guessed = docs.filter((d) => d.accessSource === "default-sensitive");
  if (guessed.length > 0) console.log(`NOTE: no access header, defaulted to founder-only: ${guessed.map((d) => d.id).join(", ")}. Add an "access:" line to confirm.`);
  if (docs.length === 0) {
    console.error("No documents found.");
    process.exit(1);
  }

  const restricted = docs.filter((d) => d.access !== "all");
  console.log(`\n${restricted.length} restricted document(s).`);

  for (const doc of restricted) {
    const secrets = figures(doc.text);
    for (const role of ROLES.filter((r) => !canSee(r, doc))) {
      const res = await searchDocs(doc.title, role);
      const leaked = secrets.filter((s) => `${res.answer ?? ""} ${res.sources.map((x) => x.snippet).join(" ")}`.includes(s));
      check(!res.sources.some((s) => s.id === doc.id), `${role} search for "${doc.title}": document not in sources`);
      check(leaked.length === 0, `${role} search for "${doc.title}": no figures leaked${leaked.length ? ` (${leaked.join(", ")})` : ""}`);
      console.log(`      locked card shown: ${res.locked.some((l) => l.id === doc.id) ? "yes" : "NO (it did not rank in the top results)"}`);
    }
    const founder = await searchDocs(doc.title, "founder");
    console.log(`  founder sees "${doc.title}": ${founder.sources.some((s) => s.id === doc.id) ? "yes" : "NO"}`);
  }

  console.log(`\nCatch-Me-Up: "${topic}", last ${days} days`);
  for (const role of ["founder", "intern"] as Role[]) {
    const res = await catchMeUp(topic, days, role);
    console.log(`\n[${role}] window ${res.window.from.slice(0, 10)} to ${res.window.to.slice(0, 10)}  fallback=${res.fallback}`);
    console.log(`  briefing: ${res.briefing ?? "(none)"}`);
    for (const p of res.points) console.log(`  - ${p.text}  [${p.source.title}]`);
    console.log(`  sources: ${res.sources.map((s) => s.id).join(", ") || "-"}`);
    console.log(`  locked:  ${res.locked.map((l) => l.title).join(", ") || "-"}`);

    for (const doc of restricted.filter((d) => !canSee(role, d))) {
      const text = `${res.briefing ?? ""} ${res.points.map((p) => p.text).join(" ")}`;
      const leaked = figures(doc.text).filter((s) => text.includes(s));
      check(!res.sources.some((s) => s.id === doc.id) && !res.points.some((p) => p.source.id === doc.id), `${role} catch-up: "${doc.title}" not used`);
      check(leaked.length === 0, `${role} catch-up: no figures from "${doc.title}" leaked`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nall passed");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
