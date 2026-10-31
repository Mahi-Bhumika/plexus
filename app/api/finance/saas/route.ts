import { approveCancel, rejectCancel, requestCancel, listCancellations, CancelError } from "@/agents/saas-cancel";

export const runtime = "nodejs";

// GET  /api/finance/saas -> { cancellations, monthlySaved, yearlySaved }
// POST /api/finance/saas { tool, action: "request" | "approve" | "reject", approver? }
//   request -> { ok, cancellation, eventId, slack }   (event is pending_approval; a Slack card goes to the approver)
//   approve -> { ok, cancellation, eventId }          (eventId goes to POST /api/undo)
//   reject  -> { ok, eventId }
//   errors  -> { ok: false, error } with 403 (wrong approver), 404, 409 or 422
export async function GET() {
  return Response.json(listCancellations());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tool?: string; action?: string; approver?: string };
    if (!body.tool) return Response.json({ ok: false, error: "tool is required" }, { status: 400 });
    const action = body.action ?? "request";

    if (action === "request") {
      const r = await requestCancel(body.tool);
      return Response.json({ ok: true, ...r });
    }
    if (!body.approver) return Response.json({ ok: false, error: "approver is required" }, { status: 400 });
    if (action === "approve") {
      const r = await approveCancel(body.tool, body.approver);
      return Response.json({ ok: true, ...r });
    }
    if (action === "reject") {
      const r = await rejectCancel(body.tool, body.approver);
      return Response.json({ ok: true, ...r });
    }
    return Response.json({ ok: false, error: `Unknown action ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof CancelError) return Response.json({ ok: false, error: message }, { status: err.status });
    console.error("Error in /api/finance/saas:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
