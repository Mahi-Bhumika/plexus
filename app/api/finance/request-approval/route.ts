import { requestExpenseApproval, ApprovalError } from "@/agents/expense-approval";

// POST /api/finance/request-approval { claimId }
// Logs "Needs approval from <approver>" in the feed, DMs the routed approver on Slack with
// Approve / Reject buttons, and posts a receipt notice in #finance.
// -> { ok, eventId, approver, slack: { dm, finance } }   (each slack part: posted | skipped | error)
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { claimId?: string };
    if (!body.claimId) return Response.json({ ok: false, error: "claimId is required" }, { status: 400 });
    const r = await requestExpenseApproval(body.claimId);
    return Response.json({ ok: true, ...r });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ApprovalError) return Response.json({ ok: false, error: message }, { status: err.status });
    console.error("Error in /api/finance/request-approval:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
