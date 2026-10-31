import { getDb } from "@/lib/db";
import { getSavedClaims, type ExpenseResult } from "@/agents/expenses";
import { guard, registerUndoHandler } from "@/lib/guard";

// Expense approval. The expense agent only recommends (status, allowed amount, approver);
// this is the action where a person approves, so it goes through the guard and can be undone.
//
//   Who may approve: exactly the approver the claim was routed to (Karan up to Rs 25,000,
//   Riya above, never the claimant). Anyone else is refused.
//   What is approved: mode "allowed" (default) = the policy-allowed amount; mode "full" =
//   the whole receipt total, i.e. the approver signs off the excess.
//   Never approvable: duplicate invoices, receipts that tripped the injection check,
//   receipts that could not be read, receipts with no total.
//
// The guard call below leaves out amount and confidence on purpose: the approver acting IS the
// approval and the human check, so asking again would loop. The guard still checks the receipt
// text for injection, writes the audit event and records the undo.

export type ApproveMode = "allowed" | "full";

export type Approval = {
  claim_id: string;
  approver: string;
  amount: number;
  mode: ApproveMode;
  approved_at: string;
  event_id: string;
};

export class ApprovalError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
  }
}

const PEOPLE = ["Karan Malhotra", "Riya Sharma"];
const NEVER_APPROVABLE = new Set(["duplicate_invoice", "possible_injection", "no_total", "read_failed"]);

function inr(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS expense_approvals (
      claim_id TEXT PRIMARY KEY,
      approver TEXT NOT NULL,
      amount REAL NOT NULL,
      mode TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      event_id TEXT NOT NULL
    )
  `);
}

export function listApprovals(): Approval[] {
  ensureTable();
  return getDb().prepare("SELECT * FROM expense_approvals ORDER BY approved_at").all() as Approval[];
}

export function getApproval(claimId: string): Approval | undefined {
  ensureTable();
  return getDb().prepare("SELECT * FROM expense_approvals WHERE claim_id = ?").get(claimId) as Approval | undefined;
}

function resolveApprover(input: string): string | null {
  const first = input.trim().toLowerCase().split(/\s+/)[0];
  if (!first) return null;
  return PEOPLE.find((p) => p.toLowerCase().startsWith(first)) ?? null;
}

registerUndoHandler("expense_approve", (raw) => {
  const p = raw as { claimId: string };
  ensureTable();
  getDb().prepare("DELETE FROM expense_approvals WHERE claim_id = ?").run(p.claimId);
});

export async function approveClaim(
  claimId: string,
  approverInput: string,
  mode: ApproveMode = "allowed",
): Promise<{ approval: Approval; eventId: string }> {
  const claim: ExpenseResult | undefined = getSavedClaims().find((c) => c.id === claimId);
  if (!claim) throw new ApprovalError(`No claim with id ${claimId}`, 404);
  if (getApproval(claimId)) throw new ApprovalError("This claim is already approved. Undo it first to change it.", 409);

  const blocking = claim.issues.find((i) => NEVER_APPROVABLE.has(i.code));
  if (blocking) throw new ApprovalError(`This claim cannot be approved: ${blocking.message}`);
  if (claim.extractionError || claim.total == null) throw new ApprovalError("This claim cannot be approved: the receipt could not be read.");

  const amount = mode === "full" ? claim.total : (claim.allowedAmount ?? claim.approvedAmount ?? 0);
  if (!(amount > 0)) throw new ApprovalError("Nothing to approve: the allowed amount is Rs 0.");

  const approver = resolveApprover(approverInput);
  if (!approver) throw new ApprovalError("Unknown approver. Use Karan Malhotra or Riya Sharma.");
  if (!claim.approver) throw new ApprovalError("No approver is assigned to this claim yet (no matching card transaction).");
  if (approver === claim.claimant) throw new ApprovalError("Nobody can approve their own claim.", 403);
  if (approver !== claim.approver) throw new ApprovalError(`Only ${claim.approver} can approve this claim.`, 403);

  const ex = claim.extraction;
  const label = `Expense approved: ${ex?.merchant ?? claim.file} ${inr(amount)} (by ${approver}${mode === "full" && amount > (claim.allowedAmount ?? 0) ? ", excess signed off" : ""})`;

  const verdict = guard({
    agent: "finance",
    kind: "expense_approve",
    label,
    actor: approver,
    untrustedText: [ex?.merchant, ex?.invoice_number, ex?.city, ...(ex?.items.map((i) => i.description) ?? [])],
    sources: [{ title: claim.file, ref: claim.file }],
    undo: { kind: "expense_approve", payload: { claimId } },
  });
  if (verdict.decision !== "allow") throw new ApprovalError(verdict.reasons[0] ?? "Stopped by the guard layer.");

  const approval: Approval = {
    claim_id: claimId,
    approver,
    amount,
    mode,
    approved_at: new Date().toISOString(),
    event_id: verdict.eventId,
  };
  ensureTable();
  getDb()
    .prepare("INSERT INTO expense_approvals (claim_id, approver, amount, mode, approved_at, event_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(approval.claim_id, approval.approver, approval.amount, approval.mode, approval.approved_at, approval.event_id);

  return { approval, eventId: verdict.eventId };
}
