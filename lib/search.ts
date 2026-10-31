import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { searchKnowledge, logTurn } from "@/lib/meko";
import { withReplay } from "@/lib/replay";
import { emitEvent, newEventId } from "@/lib/events";

// Cmd+K search and Catch-Me-Up over the seeded documents.
//
// Role scoping is done HERE, in our own code, before anything reaches the model:
// restricted documents are filtered out of the text Gemini sees. Meko is used for
// retrieval, traces and memory; it is not what enforces permissions.
//
// Documents are read from SEARCH_DOCS_DIR (default seed/search), .md or .txt, with
// optional header lines such as:
//   title: Q3 Salary Sheet
//   date: 2026-10-28
//   access: founder            (or "all", or "founder, engineering manager")
// A document with no access line that looks like salary or payroll defaults to
// founder-only, so a missing header can never leak it.

export type Role = "founder" | "engineering manager" | "engineering" | "intern";
export const ROLES: Role[] = ["founder", "engineering manager", "engineering", "intern"];

export function parseRole(value: string): Role | null {
  const v = value.toLowerCase().trim();
  if (v.includes("founder") || v === "ceo") return "founder";
  if (v.includes("manager")) return "engineering manager";
  if (v.includes("intern")) return "intern";
  if (v.includes("engineer")) return "engineering";
  return null;
}

type Chunk = { docId: string; text: string };
type Doc = {
  id: string;
  title: string;
  date: string | null; // ISO
  access: Role[] | "all";
  accessSource: "header" | "filename" | "default-sensitive" | "default-open";
  text: string;
  chunks: Chunk[];
};

export type SourceRef = { id: string; title: string; date: string | null; snippet: string };
export type LockedRef = { id: string; title: string; reason: string };

export type SearchResponse = {
  status: "done";
  role: Role;
  query: string;
  answer: string | null;
  sources: SourceRef[];
  locked: LockedRef[];
  fallback: boolean; // true when the answer is extractive because Gemini was unavailable
};

export type CatchUpResponse = {
  status: "done";
  role: Role;
  topic: string;
  window: { from: string; to: string; days: number };
  briefing: string | null;
  points: Array<{ text: string; source: SourceRef }>;
  sources: SourceRef[];
  locked: LockedRef[];
  undatedSkipped: number;
  fallback: boolean;
};

// ---- Registry ----------------------------------------------------------

const SENSITIVE = /salary|salaries|payroll|compensation|cap table|esop|equity grant/i;

function docsDir(): string {
  return path.resolve(process.cwd(), process.env.SEARCH_DOCS_DIR ?? "seed/search");
}

function headerMeta(raw: string): { meta: Map<string, string>; body: string } {
  const meta = new Map<string, string>();
  let body = raw;
  let headerLines: string[] = [];

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    headerLines = fm[1].split(/\r?\n/);
    body = raw.slice(fm[0].length);
  } else {
    headerLines = raw.split(/\r?\n/).slice(0, 12);
  }
  const KNOWN = new Set(["title", "date", "access", "visibility", "audience", "updated", "last updated", "restricted to"]);
  const consumed = new Set<string>();
  for (const line of headerLines) {
    const m = line.match(/^\s*[*_]*([A-Za-z ]{2,20}?)[*_]*\s*:\s*(.+?)\s*$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      if (!meta.has(key)) meta.set(key, m[2].replace(/[*_]+$/g, "").trim());
      if (KNOWN.has(key)) consumed.add(line);
    }
  }
  if (!fm && consumed.size > 0) {
    // header lines without --- fences: keep them out of the searchable body
    body = raw
      .split(/\r?\n/)
      .filter((line, i) => !(i < 12 && consumed.has(line)))
      .join("\n");
  }
  return { meta, body };
}

function parseAccess(value: string): Role[] | "all" | null {
  const v = value.toLowerCase();
  if (/\b(all|everyone|company[- ]wide|public)\b/.test(v)) return "all";
  const roles = new Set<Role>();
  if (/founder|ceo/.test(v)) roles.add("founder");
  if (/manager/.test(v)) roles.add("engineering manager");
  if (/\bintern/.test(v)) roles.add("intern");
  if (/engineer(?!ing manager)/.test(v) && !/engineering manager only/.test(v)) roles.add("engineering");
  return roles.size > 0 ? [...roles] : null;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function chunkText(body: string): string[] {
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const out: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length > 700) {
      out.push(cur);
      cur = b;
    } else {
      cur = cur ? `${cur}\n\n${b}` : b;
    }
    if (cur.length >= 250 && !/^#/.test(cur.split("\n").slice(-1)[0] ?? "")) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out.map((c) => (c.length > 1200 ? c.slice(0, 1200) : c));
}

let cache: Doc[] | null = null;

export function resetSearchCache(): void {
  cache = null;
}

export function loadRegistry(): Doc[] {
  if (cache) return cache;
  const dir = docsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`Search documents folder not found: ${dir}. Put the seeded docs there or set SEARCH_DOCS_DIR.`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort();

  const docs: Doc[] = files.map((file) => {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const { meta, body } = headerMeta(raw);
    const id = file.replace(/\.(md|txt)$/i, "");
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = meta.get("title") ?? heading ?? id;
    const date = toIso(meta.get("date") ?? meta.get("updated") ?? meta.get("last updated")) ?? toIso(id.match(/\d{4}-\d{2}-\d{2}/)?.[0]);

    const accessValue = meta.get("access") ?? meta.get("visibility") ?? meta.get("audience") ?? meta.get("restricted to");
    let access: Role[] | "all" = "all";
    let accessSource: Doc["accessSource"] = "default-open";
    const parsed = accessValue ? parseAccess(accessValue) : null;
    if (parsed) {
      access = parsed;
      accessSource = "header";
    } else if (/founder[-_ ]?only/i.test(id) || /founder[-_ ]?only/i.test(title)) {
      access = ["founder"];
      accessSource = "filename";
    } else if (SENSITIVE.test(title) || SENSITIVE.test(id)) {
      access = ["founder"];
      accessSource = "default-sensitive";
    }

    const chunks = chunkText(body).map((text) => ({ docId: id, text }));
    return { id, title, date, access, accessSource, text: body, chunks };
  });

  cache = docs;
  return docs;
}

export function canSee(role: Role, doc: Pick<Doc, "access">): boolean {
  if (doc.access === "all") return true;
  if (role === "founder") return true;
  return doc.access.includes(role);
}

function lockReason(doc: Pick<Doc, "access">): string {
  if (doc.access === "all") return "";
  const who = doc.access.join(" or ");
  return `Restricted: visible to ${who} only`;
}

// ---- Retrieval ---------------------------------------------------------

const STOP = new Set([
  "the", "and", "for", "are", "you", "your", "our", "what", "which", "that", "this", "with", "from",
  "have", "has", "can", "will", "any", "all", "how", "who", "when", "where", "was", "were", "about",
  "catch", "last", "days", "day", "tell", "show", "give", "latest", "update", "updates", "please",
]);

function toks(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, 5) : w));
}

type Scored = { chunk: Chunk; score: number; fromMeko: boolean };

function scoreChunks(query: string, docs: Doc[], extra: Chunk[] = []): Scored[] {
  const q = [...new Set(toks(query))];
  if (q.length === 0) return [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const all: Chunk[] = [...docs.flatMap((d) => d.chunks), ...extra];
  const chunkTokens = all.map((c) => toks(c.text));
  const N = all.length;
  const df = new Map<string, number>();
  for (const ts of chunkTokens) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);

  const mekoSet = new Set(extra.map((c) => c.text));
  const out: Scored[] = [];
  all.forEach((chunk, i) => {
    const ts = chunkTokens[i];
    const titleToks = new Set(toks(byId.get(chunk.docId)?.title ?? ""));
    let score = 0;
    let matched = 0;
    for (const t of q) {
      const tf = Math.min(3, ts.filter((x) => x === t).length);
      const inTitle = titleToks.has(t) ? 2 : 0;
      if (tf + inTitle === 0) continue;
      matched++;
      score += (tf + inTitle) * Math.log(1 + N / (1 + (df.get(t) ?? 0)));
    }
    if (matched > 0) {
      const fromMeko = mekoSet.has(chunk.text);
      out.push({ chunk, score: score * (matched / q.length) * (fromMeko ? 1.25 : 1), fromMeko });
    }
  });
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const k = `${s.chunk.docId}|${s.chunk.text.slice(0, 80)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Meko hits that belong to one of the registry documents (matched by the
// "Section: <doc title> > heading" first line). Hits for other documents are ignored.
async function mekoChunks(query: string, docs: Doc[]): Promise<Chunk[]> {
  try {
    const hits = await searchKnowledge("plexus_search", query);
    const out: Chunk[] = [];
    for (const h of hits) {
      const first = h.content.split("\n")[0]?.trim() ?? "";
      if (!first.startsWith("Section:")) continue;
      const docTitle = first.slice("Section:".length).split(">")[0].trim();
      const doc = docs.find((d) => normTitle(d.title) === normTitle(docTitle));
      if (!doc) continue;
      const text = h.content.split("\n").slice(1).join("\n").trim();
      if (text) out.push({ docId: doc.id, text });
    }
    return out;
  } catch {
    return [];
  }
}

function snippet(text: string, n = 240): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

function toSource(doc: Doc, text: string): SourceRef {
  return { id: doc.id, title: doc.title, date: doc.date, snippet: snippet(text) };
}

// Gemini sometimes cites a title or a slightly different id; accept any of them
function resolveDoc(ref: string, docs: Doc[]): Doc | undefined {
  const r = ref.trim().replace(/^source id:\s*/i, "");
  return (
    docs.find((d) => d.id === r) ??
    docs.find((d) => normTitle(d.title) === normTitle(r)) ??
    docs.find((d) => r.includes(d.id) || (r.length > 4 && d.id.includes(r)))
  );
}

function plain(text: string): string {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pick the document that best supports a sentence, by shared words. Used when the
// model returns plain sentences without a usable citation. Returns undefined when
// no document clearly supports it, so we never attach a guessed source.
function attribute(text: string, docs: Doc[]): Doc | undefined {
  const words = [...new Set(toks(text))];
  if (words.length < 3) return undefined;
  let best: Doc | undefined;
  let bestRatio = 0;
  for (const d of docs) {
    const have = new Set(toks(`${d.title} ${d.text}`));
    const ratio = words.filter((w) => have.has(w)).length / words.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = d;
    }
  }
  return bestRatio >= 0.5 ? best : undefined;
}

function hash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

// ---- Cmd+K search ------------------------------------------------------

const answerSchema = z.object({
  answer: z.string().nullable(),
  sources: z.array(z.string()),
});

export async function searchDocs(query: string, role: Role): Promise<SearchResponse> {
  const docs = loadRegistry();
  const byId = new Map(docs.map((d) => [d.id, d]));

  const extra = await mekoChunks(query, docs);
  const scored = scoreChunks(query, docs, extra);

  const allowed = scored.filter((s) => canSee(role, byId.get(s.chunk.docId)!)).slice(0, 5);
  const topOverall = scored.slice(0, 6);
  const lockedDocs = new Map<string, LockedRef>();
  for (const s of topOverall) {
    const d = byId.get(s.chunk.docId)!;
    if (!canSee(role, d) && !lockedDocs.has(d.id)) {
      lockedDocs.set(d.id, { id: d.id, title: d.title, reason: lockReason(d) });
    }
  }
  const locked = [...lockedDocs.values()];

  let answer: string | null = null;
  let sources: SourceRef[] = [];
  let fallback = false;

  if (allowed.length > 0) {
    const ids = [...new Set(allowed.map((a) => a.chunk.docId))];
    const lines: string[] = [
      "Answer the question using ONLY the sources below. Be concise (1 to 3 sentences). If the sources do not answer it, set answer to null.",
      "List the ids of the sources you used in sources.",
      "",
      `Question: "${query}"`,
      "",
    ];
    for (const s of allowed) {
      const d = byId.get(s.chunk.docId)!;
      lines.push(`[source id: ${d.id}] ${d.title}${d.date ? ` (${d.date.slice(0, 10)})` : ""}`);
      lines.push(`"${s.chunk.text.slice(0, 900)}"`);
      lines.push("");
    }
    lines.push('Return JSON: {"answer": string or null, "sources": [source ids]}.');

    try {
      const res = await withReplay(`search/answer_${hash(`${role}|${query}|${ids.join(",")}`)}`, () =>
        generateJson(answerSchema, lines.join("\n"), { model: "FAST" }),
      );
      if (res.success) {
        answer = res.data.answer;
        const used = res.data.sources
          .map((ref) => resolveDoc(ref, docs)?.id)
          .filter((id): id is string => !!id && ids.includes(id));
        const useIds = used.length > 0 ? [...new Set(used)] : ids.slice(0, 1);
        sources = useIds.map((id) => {
          const best = allowed.find((a) => a.chunk.docId === id)!;
          return toSource(byId.get(id)!, best.chunk.text);
        });
      } else {
        console.warn(`search: Gemini answer failed, using extractive fallback: ${JSON.stringify(res).slice(0, 300)}`);
        fallback = true;
      }
    } catch (err) {
      console.warn(`search: answer error, using extractive fallback: ${err instanceof Error ? err.message : String(err)}`);
      fallback = true;
    }
    if (fallback) {
      const top = allowed[0];
      answer = snippet(plain(top.chunk.text), 400);
      sources = [toSource(byId.get(top.chunk.docId)!, top.chunk.text)];
    }
  }

  const traceId = newEventId();
  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "search",
    action: `Search as ${role}: "${query.slice(0, 80)}" (${sources.length} sources)`,
    status: "done",
    sources: sources.map((s) => ({ title: s.title, ref: s.id })),
    traceId,
    undoable: false,
  });
  for (const l of locked) {
    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: "search",
      action: `Blocked: "${l.title}" hidden from ${role} (${l.reason})`,
      status: "blocked",
      sources: [{ title: l.title, ref: l.id }],
      traceId,
      undoable: false,
    });
  }
  await logTurn(
    "plexus_search",
    `[${role}] ${query}`,
    answer ?? "no answer",
    ["Retrieve chunks", "Filter by role", "Answer with citations"],
    `Used ${sources.length} sources; ${locked.length} restricted documents hidden`,
    `search/logTurn_${hash(`${role}|${query}`)}`,
  ).catch(() => undefined);

  return { status: "done", role, query, answer, sources, locked, fallback };
}

// ---- Catch-Me-Up -------------------------------------------------------

export function parseCatchUp(text: string): { topic: string; days: number } {
  const days = Number(text.match(/last\s+(\d+)\s+days?/i)?.[1] ?? NaN);
  let topic = text.match(/(?:on|about|regarding)\s+(.+?)(?:\s*,|\s+last\s+\d+|\s*$)/i)?.[1]?.trim() ?? "";
  topic = topic.replace(/[.?!]+$/, "").trim();
  return { topic, days: Number.isFinite(days) && days > 0 ? days : 4 };
}

// Gemini sometimes returns a point as a plain string instead of {text, source};
// accept both and recover the citation from the string when we can.
const briefingSchema = z.object({
  briefing: z.string().nullable(),
  points: z.array(z.union([z.object({ text: z.string(), source: z.string() }), z.string()])),
});

function asOfDate(): Date {
  const pinned = process.env.SEARCH_AS_OF ? new Date(process.env.SEARCH_AS_OF) : null;
  return pinned && !isNaN(pinned.getTime()) ? pinned : new Date();
}

export async function catchMeUp(topic: string, days: number, role: Role): Promise<CatchUpResponse> {
  const docs = loadRegistry();
  const to = asOfDate();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  let undatedSkipped = 0;
  const inWindow = docs.filter((d) => {
    if (!d.date) {
      undatedSkipped++;
      return false;
    }
    const t = Date.parse(d.date);
    return t >= from.getTime() && t <= to.getTime() + 24 * 60 * 60 * 1000;
  });

  // Relevance to the topic, using only the documents in the window
  let relevant = inWindow;
  if (topic.trim()) {
    const scored = scoreChunks(topic, inWindow);
    const ids = new Set(scored.map((s) => s.chunk.docId));
    relevant = inWindow.filter((d) => ids.has(d.id));
  }
  relevant = [...relevant].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const allowedDocs = relevant.filter((d) => canSee(role, d)).slice(0, 6);
  const locked: LockedRef[] = relevant
    .filter((d) => !canSee(role, d))
    .map((d) => ({ id: d.id, title: d.title, reason: lockReason(d) }));

  let briefing: string | null = null;
  let points: Array<{ text: string; source: SourceRef }> = [];
  let fallback = false;

  if (allowedDocs.length > 0) {
    const ids = allowedDocs.map((d) => d.id);
    const lines: string[] = [
      `Write a short executive briefing${topic ? ` on "${topic}"` : ""} covering the last ${days} days, using ONLY the documents below.`,
      "briefing: 2 to 4 sentences. points: 3 to 6 short factual sentences, most important and most recent first. Include dates, numbers and names that matter. Each point must be supported by one of the documents.",
      "",
    ];
    for (const d of allowedDocs) {
      lines.push(`[source id: ${d.id}] ${d.title} (${(d.date ?? "").slice(0, 10)})`);
      lines.push(`"${d.text.replace(/\s+/g, " ").slice(0, 1500)}"`);
      lines.push("");
    }
    lines.push(
      'Return JSON: {"briefing": "<2 to 4 sentences>", "points": ["<one factual sentence>", "..."]}',
      "Do not include source ids in the points; sources are attached afterwards.",
    );

    try {
      const res = await withReplay(
        `search/catchup_${hash(`${role}|${topic}|${days}|${ids.join(",")}`)}`,
        () => generateJson(briefingSchema, lines.join("\n"), { model: "FAST" }),
      );
      if (res.success) {
        briefing = res.data.briefing;
        points = [];
        for (const p of res.data.points) {
          if (typeof p === "string") {
            const d =
              allowedDocs.find((x) => p.includes(x.id)) ??
              allowedDocs.find((x) => p.includes(x.title)) ??
              attribute(p, allowedDocs);
            if (!d) continue; // nothing clearly supports it: drop it rather than guess
            const text = p
              .replace(/\[[^\]]*(source|id)[^\]]*\]/gi, "")
              .replace(d.id, "")
              .replace(d.title, "")
              .replace(/\s+/g, " ")
              .trim();
            if (text) points.push({ text, source: toSource(d, d.text) });
          } else {
            const d = resolveDoc(p.source, allowedDocs);
            if (d) points.push({ text: p.text, source: toSource(d, d.text) });
          }
        }
        if (points.length === 0) {
          console.warn(`catch-up: no usable points; Gemini returned: ${JSON.stringify(res.data.points).slice(0, 300)}`);
          fallback = true;
        }
      } else {
        console.warn(`catch-up: Gemini briefing failed, using extractive fallback: ${JSON.stringify(res).slice(0, 300)}`);
        fallback = true;
      }
    } catch (err) {
      console.warn(`catch-up: briefing error, using extractive fallback: ${err instanceof Error ? err.message : String(err)}`);
      fallback = true;
    }
    if (fallback) {
      briefing = null;
      points = allowedDocs.slice(0, 5).map((d) => ({
        text: snippet(plain(d.chunks[0]?.text ?? d.text), 200),
        source: toSource(d, d.text),
      }));
    }
  }

  const sources = allowedDocs.map((d) => toSource(d, d.text));
  const traceId = newEventId();
  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "search",
    action: `Catch-Me-Up as ${role}: "${topic || "everything"}", last ${days} days (${sources.length} sources)`,
    status: "done",
    sources: sources.slice(0, 3).map((s) => ({ title: s.title, ref: s.id })),
    traceId,
    undoable: false,
  });
  for (const l of locked) {
    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: "search",
      action: `Blocked: "${l.title}" hidden from ${role} (${l.reason})`,
      status: "blocked",
      sources: [{ title: l.title, ref: l.id }],
      traceId,
      undoable: false,
    });
  }
  await logTurn(
    "plexus_search",
    `[${role}] catch me up on ${topic}, last ${days} days`,
    briefing ?? "no briefing",
    ["Find documents in window", "Filter by role", "Write briefing with citations"],
    `${sources.length} sources, ${locked.length} restricted hidden, ${undatedSkipped} undated skipped`,
    `search/logTurn_catchup_${hash(`${role}|${topic}|${days}`)}`,
  ).catch(() => undefined);

  return {
    status: "done",
    role,
    topic,
    window: { from: from.toISOString(), to: to.toISOString(), days },
    briefing,
    points,
    sources,
    locked,
    undatedSkipped,
    fallback,
  };
}