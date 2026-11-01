import { getDb } from "@/lib/db";
import { createAccessRequest, AccessError } from "@/agents/access";

export type { AccessRequestRow } from "@/agents/access";


// GET /api/access -> returns list of requests and audit rows
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT ar.id, ar.user_id, ar.app, ar.risk, ar.status, ar.approver_id, ar.requested_at, ar.decided_at,
                u.name as user_name, u.role as user_role
         FROM access_requests ar
         LEFT JOIN users u ON u.id = ar.user_id
         ORDER BY ar.requested_at DESC`,
      )
      .all();

    return Response.json({ requests: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST /api/access -> Submit new access request
// Body: { userId, userName, app, justification?, text? }
// risk and approverId in the body are ignored: the policy table decides both.
// Response keeps the old shape ({ ok, request }) and adds decision, reasons, eventId, approver, message.
// status in request is one of: granted | pending_approval | denied
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      userName?: string;
      app?: string;
      justification?: string;
      text?: string;
      risk?: string;
      approverId?: string;
    };
    const out = createAccessRequest(body);
    return Response.json({
      ok: true,
      request: out.request,
      decision: out.decision,
      blocked: out.decision === "block",
      reasons: out.reasons,
      eventId: out.eventId,
      approver: out.approver,
      message: out.message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof AccessError ? err.httpStatus : 500;
    console.error("Error in POST /api/access:", message);
    return Response.json({ error: message }, { status });
  }
}
