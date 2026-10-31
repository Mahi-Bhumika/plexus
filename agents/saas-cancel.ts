import { getDb } from "@/lib/db";
import { emitEvent, newEventId } from "@/lib/events";
import { approvalRule, guard, registerUndoHandler } from "@/lib/guard";
import { approvalBlocks, approvalTarget, postSlack, type SlackResult } from "@/lib/slack";

// Zombie SaaS cancel. Asking to cancel a tool is a money action: it goes to approval (never the
// tool's own owner), and the approved cancellation is undoable. Nothing is changed in saas_billing;
// cancellations live in their own table, so undo simply puts the tool back to active.
//
//   request -> pending_approval event, row status "pending", Slack card to the approver
//   approve -> only the routed approver; guard allows, status "cancelled", Undo button
//   reject  -> only the routed approver; the pending request is dropped

export type Cancellation = {
  tool: string;
  monthly_cost_inr: number;
  owner: string | null;
  approver: string;
  status: "pending" | "cancelled";
  requested_at: string;
  decided_at: string | null;
  event_id: string;
};

export class CancelError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "CancelError";
    this.status = status;
  }
}

const PEOPLE = ["Karan Malhotra", "Riya Sharma"];

function inr(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS saas_cancellations (
      tool TEXT PRIMARY KEY,
      monthly_cost_inr REAL NOT NULL,
      owner TEXT,
      approver TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      event_id TEXT NOT NULL
    )
  `);
}

export function listCancellations(): { cancellations: Cancellation[]; monthlySaved: number; yearlySaved: number } {
  ensureTable();
  const rows = getDb().prepare("SELECT * FROM saas_cancellations ORDER BY requested_at").all() as Cancellation[];
  const monthly = rows.filter((r) => r.status === "cancelled").reduce((s, r) => s + r.monthly_cost_inr, 0);
  return { cancellations: rows, monthlySaved: monthly, yearlySaved: monthly * 12 };
}

function getRow(tool: string): Cancellation | undefined {
  ensureTable();
  return getDb().prepare("SELECT * FROM saas_cancellations WHERE lower(tool) = lower(?)").get(tool) as Cancellation | undefined;
}

function resolveApprover(input: string): string | null {
  const first = input.trim().toLowerCase().split(/\s+/)[0];
  if (!first) return null;
  return PEOPLE.find((p) => p.toLowerCase().startsWith(first)) ?? null;
}

registerUndoHandler("saas_cancel", (raw) => {
  const p = raw as { tool: string };
  ensureTable();
  getDb().prepare("DELETE FROM saas_cancellations WHERE lower(tool) = lower(?)").run(p.tool);
});

export async function requestCancel(
  toolInput: string,
  opts: { slack?: boolean } = {},
): Promise<{ cancellation: Cancellation; eventId: string; slack: SlackResult | null }> {
  const tool = toolInput.trim();
  if (!tool) throw new CancelError("tool is required", 400);
  const billing = getDb()
    .prepare("SELECT tool, monthly_cost_inr, owner FROM saas_billing WHERE lower(tool) = lower(?)")
    .get(tool) as { tool: string; monthly_cost_inr: number; owner: string | null } | undefined;
  if (!billing) throw new CancelError(`No SaaS tool named ${tool}`, 404);

  const existing = getRow(billing.tool);
  if (existing?.status === "cancelled") throw new CancelError(`${billing.tool} is already cancelled. Undo it first.`, 409);
  if (existing?.status === "pending") return { cancellation: existing, eventId: existing.event_id, slack: null };

  const monthly = Number(billing.monthly_cost_inr) || 0;
  const rule = approvalRule({ kind: "saas_cancel", amount: monthly, actor: billing.owner });
  if (!rule.approver) throw new CancelError("No eligible approver for this tool (nobody approves their own).");

  const verdict = guard({
    agent: "finance",
    kind: "saas_cancel",
    label: `Cancel ${billing.tool}: saves ${inr(monthly)} a month (${inr(monthly * 12)} a year)`,
    amount: monthly,
    actor: billing.owner,
    untrustedText: [toolInput],
    sources: [{ title: "saas_billing", ref: billing.tool }],
  });
  if (verdict.decision === "block") throw new CancelError(verdict.reasons[0] ?? "Stopped by the guard layer.");

  const cancellation: Cancellation = {
    tool: billing.tool,
    monthly_cost_inr: monthly,
    owner: billing.owner,
    approver: rule.approver,
    status: "pending",
    requested_at: new Date().toISOString(),
    decided_at: null,
    event_id: verdict.eventId,
  };
  getDb()
    .prepare(
      "INSERT INTO saas_cancellations (tool, monthly_cost_inr, owner, approver, status, requested_at, decided_at, event_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .run(cancellation.tool, cancellation.monthly_cost_inr, cancellation.owner, cancellation.approver, cancellation.status, cancellation.requested_at, cancellation.event_id);

  let slack: SlackResult | null = null;
  if (opts.slack !== false) {
    slack = await postSlack(
      approvalTarget(cancellation.approver),
      `Cancel ${billing.tool}? Saves ${inr(monthly)} a month.`,
      approvalBlocks({
        title: `Cancel unused tool: ${billing.tool}`,
        lines: [`${inr(monthly)} a month (${inr(monthly * 12)} a year)`, billing.owner ? `Owner: ${billing.owner}` : "No owner on record"],
        value: { kind: "saas", id: billing.tool },
      }),
    );
  }
  return { cancellation, eventId: verdict.eventId, slack };
}

function pendingFor(toolInput: string, approverInput: string): { row: Cancellation; approver: string } {
  const row = getRow(toolInput.trim());
  if (!row) throw new CancelError("There is no cancellation request for this tool.", 404);
  if (row.status === "cancelled") throw new CancelError("This tool is already cancelled. Undo it first.", 409);
  const approver = resolveApprover(approverInput);
  if (!approver) throw new CancelError("Unknown approver. Use Karan Malhotra or Riya Sharma.");
  if (approver === row.owner) throw new CancelError("Nobody can approve cancelling their own tool.", 403);
  if (approver !== row.approver) throw new CancelError(`Only ${row.approver} can approve this.`, 403);
  return { row, approver };
}

export async function approveCancel(toolInput: string, approverInput: string): Promise<{ cancellation: Cancellation; eventId: string }> {
  const { row, approver } = pendingFor(toolInput, approverInput);
  const verdict = guard({
    agent: "finance",
    kind: "saas_cancel",
    label: `Cancelled ${row.tool}: saving ${inr(row.monthly_cost_inr)} a month (approved by ${approver})`,
    actor: approver,
    untrustedText: [row.tool],
    sources: [{ title: "saas_billing", ref: row.tool }],
    undo: { kind: "saas_cancel", payload: { tool: row.tool } },
  });
  if (verdict.decision !== "allow") throw new CancelError(verdict.reasons[0] ?? "Stopped by the guard layer.");

  const decidedAt = new Date().toISOString();
  getDb().prepare("UPDATE saas_cancellations SET status = 'cancelled', decided_at = ?, event_id = ? WHERE tool = ?").run(decidedAt, verdict.eventId, row.tool);
  return { cancellation: { ...row, status: "cancelled", decided_at: decidedAt, event_id: verdict.eventId }, eventId: verdict.eventId };
}

export async function rejectCancel(toolInput: string, approverInput: string): Promise<{ eventId: string }> {
  const { row, approver } = pendingFor(toolInput, approverInput);
  getDb().prepare("DELETE FROM saas_cancellations WHERE tool = ?").run(row.tool);
  const eventId = newEventId();
  emitEvent({
    id: eventId,
    timestamp: new Date().toISOString(),
    agent: "finance",
    action: `Cancellation rejected: ${row.tool} stays (by ${approver})`,
    status: "flagged",
    confidence: 1,
    sources: [{ title: "saas_billing", ref: row.tool }],
    traceId: newEventId(),
    undoable: false,
  });
  return { eventId };
}
