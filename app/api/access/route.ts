import { getDb } from "@/lib/db";
import { emitEvent, newEventId } from "@/lib/events";

export type AccessRequestRow = {
  id: string;
  user_id: string;
  app: string;
  risk: string;
  status: string; // 'granted' | 'pending_approval' | 'denied' | 'undone'
  approver_id: string;
  requested_at: string;
  decided_at: string | null;
};

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
      .all() as Array<AccessRequestRow & { user_name: string | null; user_role: string | null }>;

    return Response.json({ requests: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST /api/access -> Submit new access request
// Body: { userId, userName, app, risk, justification, approverId }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      userId: string;
      userName: string;
      app: string;
      risk: "Low" | "Medium" | "High";
      justification?: string;
      approverId: string;
    };

    const { userId, userName, app, risk, approverId, justification } = body;
    const db = getDb();

    // Auto-approve Low risk, gate Medium/High
    const isAutoApproved = risk === "Low";
    const status = isAutoApproved ? "granted" : "pending_approval";
    const decidedAt = isAutoApproved ? new Date().toISOString() : null;
    const reqId = `req_${Date.now()}`;
    const requestedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO access_requests (id, user_id, app, risk, status, approver_id, requested_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(reqId, userId, app, risk, status, approverId, requestedAt, decidedAt);

    // Emit live event into ActivityFeed
    emitEvent({
      id: newEventId(),
      timestamp: requestedAt,
      agent: "access",
      action: isAutoApproved
        ? `Access granted: ${userName} -> ${app} (auto-approved)`
        : `Access requested: ${userName} -> ${app} (${risk} risk, awaiting ${approverId})`,
      status: isAutoApproved ? "done" : "pending_approval",
      confidence: 1.0,
      sources: [{ title: "Access Policy", ref: "doc_04_access_policy" }],
      traceId: newEventId(),
      undoable: isAutoApproved,
    });

    return Response.json({
      ok: true,
      request: {
        id: reqId,
        user_id: userId,
        app,
        risk,
        status,
        approver_id: approverId,
        requested_at: requestedAt,
        decided_at: decidedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error in POST /api/access:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
