// Guard layer, with side effects: audit events and undo.
// The rules themselves live in lib/guard-rules.ts (pure, unit tested).
//
// Typical use inside an agent, before doing anything that matters:
//
//   const v = guard({
//     kind: "expense_approve",
//     label: `Approve ${merchant} Rs ${total}`,
//     amount: total,
//     actor: claimant,
//     confidence: ex.confidence,
//     untrustedText: [ex.merchant, ex.invoice_number, ...ex.items.map((i) => i.description)],
//     undo: { kind: "expense_approve", payload: { claimId } },   // only if it can be undone
//   });
//   if (v.decision !== "allow") return { status: "needs_approval", approver: v.approver, reasons: v.reasons };
//   ...do the action...
//
// Register an undo handler once, where the action is defined:
//   registerUndoHandler("expense_approve", (p) => reopenClaim((p as { claimId: string }).claimId));

import { AGENTS, emitEvent, newEventId, type ActivityStatus, type AgentName } from "@/lib/events";
import { getDb } from "@/lib/db";
import { evaluate, type GuardInput, type GuardVerdict } from "@/lib/guard-rules";

export * from "@/lib/guard-rules";

const AGENT: AgentName = "guard";

const STATUS_FOR: Record<"allow" | "needs_approval" | "block", ActivityStatus> = {
  allow: "done",
  needs_approval: "pending_approval",
  block: "blocked",
};

// The event schema only accepts 0 to 1; never let a bad score crash the audit write.
function clamp01(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

export type GuardCall = GuardInput & {
  agent?: AgentName; // which agent the feed row belongs to; defaults to "guard"
  label: string; // short human sentence for the audit feed
  sources?: Array<{ title: string; ref: string }>;
  undo?: { kind: string; payload: unknown }; // set only when the action can be reversed
};

export type GuardResult = GuardVerdict & { eventId: string };

export function guard(call: GuardCall): GuardResult {
  const verdict = evaluate(call);
  const eventId = newEventId();
  const first = verdict.reasons[0];

  const action =
    verdict.decision === "allow"
      ? `Allowed: ${call.label}`
      : verdict.decision === "block"
        ? `Blocked: ${call.label}${first ? ` - ${first}` : ""}`
        : `Needs approval from ${verdict.approver ?? "a person"}: ${call.label}${first ? ` - ${first}` : ""}`;

  const undoable = verdict.decision === "allow" && Boolean(call.undo);
  if (undoable && call.undo) recordUndo(eventId, call.undo.kind, call.undo.payload);

  emitEvent({
    id: eventId,
    timestamp: new Date().toISOString(),
    agent: call.agent ?? AGENT,
    action,
    status: STATUS_FOR[verdict.decision],
    confidence: clamp01(call.confidence),
    sources: call.sources ?? [],
    traceId: newEventId(),
    undoable,
  });

  return { ...verdict, eventId };
}

// ---- Undo --------------------------------------------------------------

type UndoHandler = (payload: unknown) => void | Promise<void>;

// Kept on globalThis so every Next.js route bundle sees the same handlers.
type GuardGlobal = typeof globalThis & { __plexusUndoHandlers?: Map<string, UndoHandler> };
const handlers: Map<string, UndoHandler> = ((globalThis as GuardGlobal).__plexusUndoHandlers ??= new Map());

export function registerUndoHandler(kind: string, fn: UndoHandler): void {
  handlers.set(kind, fn);
}

function ensureUndoTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS undo_log (
      event_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      undone_at TEXT
    )
  `);
}

export function recordUndo(eventId: string, kind: string, payload: unknown): void {
  ensureUndoTable();
  getDb()
    .prepare("INSERT OR REPLACE INTO undo_log (event_id, kind, payload, created_at, undone_at) VALUES (?, ?, ?, ?, NULL)")
    .run(eventId, kind, JSON.stringify(payload ?? null), new Date().toISOString());
}

export async function undoAction(eventId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  ensureUndoTable();
  const db = getDb();
  const row = db.prepare("SELECT kind, payload, undone_at FROM undo_log WHERE event_id = ?").get(eventId) as
    | { kind: string; payload: string; undone_at: string | null }
    | undefined;
  if (!row) return { ok: false, error: "Nothing to undo for this event." };
  if (row.undone_at) return { ok: false, error: "This action was already undone." };
  const handler = handlers.get(row.kind);
  if (!handler) return { ok: false, error: `No undo handler is registered for "${row.kind}".` };

  try {
    await handler(JSON.parse(row.payload));
  } catch (err) {
    return { ok: false, error: `Undo failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE undo_log SET undone_at = ? WHERE event_id = ?").run(now, eventId);

  // The original feed row stops being undoable and shows as undone.
  db.prepare(
    "UPDATE audit_events SET status = 'undone', undo_state = NULL, payload_json = json_set(payload_json, '$.status', 'undone', '$.undoable', json('false')) WHERE id = ?",
  ).run(eventId);

  const orig = db.prepare("SELECT agent FROM audit_events WHERE id = ?").get(eventId) as { agent: string } | undefined;
  const origAgent: AgentName = (AGENTS as readonly string[]).includes(orig?.agent ?? "") ? (orig!.agent as AgentName) : AGENT;

  emitEvent({
    id: newEventId(),
    timestamp: now,
    agent: origAgent,
    action: `Undone: ${row.kind}`,
    status: "undone",
    confidence: 1,
    sources: [{ title: "undo", ref: eventId }],
    traceId: newEventId(),
    undoable: false,
  });
  return { ok: true, message: `Undid ${row.kind}.` };
}