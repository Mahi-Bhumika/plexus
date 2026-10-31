// Blocks injected search queries before they reach retrieval or Gemini.
// Normal queries only run the pure rule check (no audit event); a blocked one is logged through guard().
import { evaluate, guard } from "@/lib/guard";

export type QueryVerdict =
  | { blocked: false }
  | { blocked: true; reasons: string[]; eventId: string; message: string };

export function guardSearchQuery(texts: Array<string | null | undefined>): QueryVerdict {
  const untrusted = texts.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (untrusted.length === 0) return { blocked: false };

  const verdict = evaluate({ kind: "search_query", untrustedText: untrusted });
  if (verdict.decision !== "block") return { blocked: false };

  const preview = untrusted[0].trim().slice(0, 80);
  const g = guard({
    kind: "search_query",
    agent: "search",
    label: `Search query blocked: "${preview}${untrusted[0].trim().length > 80 ? "..." : ""}"`,
    untrustedText: untrusted,
  });
  return {
    blocked: true,
    reasons: g.reasons,
    eventId: g.eventId,
    message: "This query looks like an attempt to override the assistant's instructions, so it was blocked and logged.",
  };
}

// Response body for a blocked query. It has every field the search and catch-up screens read,
// so a screen that ignores "status" still renders an empty result instead of crashing.
export function blockedSearchBody(v: Extract<QueryVerdict, { blocked: true }>) {
  return {
    status: "blocked" as const,
    message: v.message,
    reasons: v.reasons,
    eventId: v.eventId,
    answer: "",
    sources: [],
    locked: [],
    fallback: false,
    briefing: "",
    points: [],
    window: null,
    undatedSkipped: 0,
  };
}
