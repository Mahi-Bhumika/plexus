import { approveClaim, rejectClaim, listApprovals, ApprovalError, type ApproveMode } from "@/agents/expense-approval";

export const runtime = "nodejs";

// GET  /api/finance/approve -> { approvals: [{ claim_id, approver, amount, mode, approved_at, event_id }] }
//      Merge with /api/finance/expenses by claim id (the receipt file name) to show "Approved by ...".
// POST /api/finance/approve  { claimId, approver, mode?: "allowed" | "full", reject?: true }
//      -> { ok: true, approval, eventId }   eventId goes to POST /api/undo
//      -> with reject: { ok: true, rejected: true, eventId }
//      -> { ok: false, error } with 403 (wrong approver), 404, 409 (already approved) or 422 (not approvable / blocked)
export async function GET() {
  return Response.json({ approvals: listApprovals() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { claimId?: string; approver?: string; mode?: string; reject?: boolean };
    if (!body.claimId) return Response.json({ ok: false, error: "claimId is required" }, { status: 400 });
    if (!body.approver) return Response.json({ ok: false, error: "approver is required" }, { status: 400 });

    if (body.reject) {
      const { eventId } = await rejectClaim(body.claimId, body.approver);
      return Response.json({ ok: true, rejected: true, eventId });
    }
    const mode: ApproveMode = body.mode === "full" ? "full" : "allowed";
    const { approval, eventId } = await approveClaim(body.claimId, body.approver, mode);
    return Response.json({ ok: true, approval, eventId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ApprovalError) {
      return Response.json({ ok: false, error: message }, { status: err.status });
    }
    console.error("Error in /api/finance/approve:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
