// Applies the ActionSwarm fixes to agents/actionswarm.ts in place:
//   1. de-duplicates tasks (the NDA appears twice, so 7 tasks become 6)
//   2. short imperative task titles (prompt rules plus a code cleanup)
//   3. finds the kickoff transcript in seed/ as well as data/ (the POST /api/actionswarm route needs this)
// Run once: pnpm tsx scripts/patch-actionswarm.ts   (add a path to patch another file)
// Every change is matched against exact text; if any piece is missing nothing is written.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const file = process.argv[2] ?? "agents/actionswarm.ts";
const raw = readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let src = raw.replace(/\r\n/g, "\n");

if (src.includes("function cleanTitle(")) {
  console.log("Already patched: nothing to do.");
  process.exit(0);
}

const HELPERS = `// ---------- task cleanup: short imperative titles and de-duplication ----------

const DATE_WORDS =
  "(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day\\\\s+)?(?:\\\\d{1,2}\\\\s+[A-Za-z]+(?:\\\\s+\\\\d{4})?|end of (?:today|the day|the week)|today|tomorrow)";
const TRAILING_DATE = new RegExp("\\\\s+(?:by|on|before)\\\\s+" + DATE_WORDS + "\\\\.?$", "i");

export function cleanTitle(raw: string): string {
  let t = raw.trim().replace(/\\s+/g, " ");
  t = t.replace(/^(?:i|we)\\s*(?:will|'ll|\\u2019ll|shall|am going to)\\s+/i, "");
  t = t.replace(/^(?:will|please|need to|needs to)\\s+/i, "");
  t = t.replace(/^(?:riya|karan|meera|arjun)(?:\\s+(?:sharma|malhotra|iyer|verma))?\\s+(?:will|to)\\s+/i, "");
  t = t.replace(TRAILING_DATE, "");
  t = t.replace(/[.\\s]+$/, "");
  if (t.length > 70) {
    const cut = t.slice(0, 70);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : cut).trim();
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : raw.trim();
}

const TITLE_STOP = new Set([
  "the", "and", "for", "will", "with", "that", "this", "those", "them", "you", "are", "our", "has", "have",
  "been", "not", "all", "any", "from", "into", "send", "sent", "share", "prepare", "write", "provide",
  "create", "make", "set", "ensure", "confirm", "arrange", "get", "give",
]);

function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\\s]/g, " ")
      .split(/\\s+/)
      .filter((w) => w.length > 2 && !TITLE_STOP.has(w))
      .map((w) => (w.length > 5 ? w.slice(0, 5) : w)),
  );
}

// Two items are the same commitment when the owners and dates do not clash and the titles share the key words.
function sameCommitment(a: Extraction["items"][number], b: Extraction["items"][number]): boolean {
  if (a.assignee && b.assignee && a.assignee !== b.assignee) return false;
  if (a.due && b.due && a.due !== b.due) return false;
  const wa = titleWords(a.title);
  const wb = titleWords(b.title);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const smaller = Math.min(wa.size, wb.size);
  if (smaller === 0) return false;
  const sameOwnerAndDate = !!a.assignee && a.assignee === b.assignee && !!a.due && a.due === b.due;
  return (shared >= 2 && shared / smaller >= 0.5) || (sameOwnerAndDate && shared >= 1);
}

export function dedupeItems(items: Extraction["items"]): Extraction["items"] {
  const out: Extraction["items"] = [];
  for (const it of items) {
    const i = out.findIndex((o) => sameCommitment(o, it));
    if (i < 0) {
      out.push({ ...it });
      continue;
    }
    const keep = out[i];
    if (it.confidence > keep.confidence) {
      keep.title = it.title;
      keep.confidence = it.confidence;
    }
    keep.assignee = keep.assignee ?? it.assignee;
    keep.due = keep.due ?? it.due;
    keep.quote = keep.quote ?? it.quote;
  }
  return out;
}

`;

function replaceOnce(anchor: string, replacement: string, label: string): void {
  const count = src.split(anchor).length - 1;
  if (count !== 1) {
    console.error(`NOT PATCHED: "${label}" matched ${count} times (expected 1). Nothing was written.`);
    console.error(`Looking for: ${anchor.trim()}`);
    process.exit(1);
  }
  src = src.replace(anchor, () => replacement);
}

replaceOnce(
  "function normalize(raw: z.infer<typeof extractionSchema>): Extraction {",
  HELPERS + "function normalize(raw: z.infer<typeof extractionSchema>): Extraction {",
  "normalize signature",
);
replaceOnce(
  "    const title = i.title!.trim();",
  "    const rawTitle = i.title!.trim();\n    const title = cleanTitle(rawTitle);",
  "title line",
);
replaceOnce(
  "      const inferred = inferAssigneeAndDue(title);",
  "      const inferred = inferAssigneeAndDue(rawTitle);",
  "infer call",
);
replaceOnce(
  "  // Ensure we have between 5 and 8 tasks if model omitted some",
  "  // One commitment, one task (the NDA is mentioned twice in the transcript)\n  {\n    const deduped = dedupeItems(items);\n    items.length = 0;\n    items.push(...deduped);\n  }\n\n  // Ensure we have between 5 and 8 tasks if model omitted some",
  "dedupe insert",
);
replaceOnce(
  '    "    title (string, a clear imperative task),",',
  `    "    title (string): a short imperative task of 3 to 8 words that names the thing, for example 'Send mutual NDA to Neha Kapoor'. Never start with 'I will'; never use words like 'those' or 'it' for the object; leave the date out of the title,",`,
  "title prompt line",
);
replaceOnce(
  '    "- Only mention facts that are stated in the transcript. Do not invent meetings, calls, dates, prices or commitments.",',
  '    "- If the same commitment is mentioned more than once in the transcript (same person, same thing), return it only once.",\n    "- Only mention facts that are stated in the transcript. Do not invent meetings, calls, dates, prices or commitments.",',
  "prompt dedupe rule",
);
replaceOnce(
  '  const root = path.resolve(process.cwd(), "data");',
  '  const roots = ["seed", "data"].map((d) => path.resolve(process.cwd(), d)).filter((d) => fs.existsSync(d));',
  "transcript roots",
);
replaceOnce("  if (!fs.existsSync(root)) return null;", "  if (roots.length === 0) return null;", "transcript exists check");
replaceOnce("  walk(root);", "  for (const r of roots) walk(r);", "transcript walk");

copyFileSync(file, `${file}.bak`);
writeFileSync(file, src.replace(/\n/g, eol), "utf8");
console.log(`Patched ${file} (backup saved as ${file}.bak). Now run: pnpm tsc --noEmit`);
