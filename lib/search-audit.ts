// lib/search-audit.ts: wraps search and catch-up so they show up in the Activity Feed, audit log and Meko traces.
import { emitEvent, newEventId } from "@/lib/events";
import { logTurn } from "@/lib/meko";
import { catchMeUp, search, type Hit, type Role } from "@/lib/search";

type CatchUp = Awaited<ReturnType<typeof catchMeUp>>;

const warn = (what: string, e: unknown) =>
  console.warn(`[search-audit] ${what} failed:`, e instanceof Error ? e.message : e);

const traceId = () => `trc_${crypto.randomUUID()}`;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const sourcesOf = (hits: Hit[]) =>
  hits
    .filter((h) => !h.flagged)
    .slice(0, 3)
    .map((h) => ({ title: h.doc, ref: (h.documentId || h.id).slice(0, 8) }));

// A hidden restricted result is a guard decision worth showing in the feed (throttled so typing can't flood it).
let lastGuardAt = 0;
export function auditHidden(role: Role, hidden: number, what: string) {
  if (role === "founder" || hidden <= 0) return;
  const now = Date.now();
  if (now - lastGuardAt < 3000) return;
  lastGuardAt = now;
  try {
    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: "guard",
      action: `Hid ${hidden} restricted result${hidden > 1 ? "s" : ""} from ${role} (${what})`,
      status: "blocked",
      sources: [],
      traceId: traceId(),
      undoable: false,
    });
  } catch (e) {
    warn("guard event", e);
  }
}

async function auditCatchUp(query: string, out: CatchUp) {
  const found = !out.note;
  const plan = [
    `Search the knowledge base for ${out.topic} updates, decisions, action items and launch details`,
    `Filter results for the ${out.role} role${out.hidden ? ` (${out.hidden} hidden)` : ""}`,
    found ? `Write a cited briefing (${out.briefingMode ?? "none"})` : "Report that no matching notes were found",
  ];
  const reasoning = found
    ? `Built from ${out.results.length} passages${out.window ? ` dated ${out.window.from} to ${out.window.to}` : ""}; points without a valid source were dropped.`
    : (out.note ?? "No matching notes.");

  let trace = traceId();
  try {
    const t = await logTurn(
      "plexus_search",
      query || `Catch me up on ${out.topic}`,
      out.briefing ?? out.note ?? "",
      plan,
      reasoning,
      "search/logTurn_catchup", // stable key: one fixture, not one per call
    );
    trace = t.traceId;
  } catch (e) {
    warn("Meko trace", e);
  }

  const top = out.results.find((h) => typeof h.score === "number")?.score;
  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "search",
    action: found
      ? `Catch-up on ${out.topic} (${out.days}d) as ${out.role}: ${out.points.length} cited points from ${out.results.length} sources`
      : `Catch-up on ${out.topic} as ${out.role}: no notes found`,
    status: found ? "done" : "flagged",
    confidence: typeof top === "number" ? clamp01(top) : undefined,
    sources: sourcesOf(out.results),
    traceId: trace,
    undoable: false,
  });
}

export async function runSearch(query: string, role: Role, limit: number) {
  const out = await search(query, role, limit);
  auditHidden(role, out.hidden, `search "${query.slice(0, 40)}"`);
  return out;
}

export async function runCatchUp(query: string, topic: string, days: number, role: Role) {
  const out = await catchMeUp(topic, days, role);
  auditHidden(role, out.hidden, `catch-up ${topic}`);
  void auditCatchUp(query, out).catch((e) => warn("catch-up audit", e)); // never blocks or breaks the response
  return out;
}