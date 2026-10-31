import { getDb } from "@/lib/db";
import { emitEvent, newEventId } from "@/lib/events";

// POST /api/access/decide
// Body: { id: string, decision: 'granted' | 'denied', approverName: string }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id: string;
      decision: "granted" | "denied";
      approverName: string;
    };

    const { id, decision, approverName } = body;
    const db = getDb();
    const decidedAt = new Date().toISOString();

    const existing = db
      .prepare(
        `SELECT ar.*, u.name as user_name FROM access_requests ar
         LEFT JOIN users u ON u.id = ar.user_id
         WHERE ar.id = ?`,
      )
      .get(id) as { id: string; user_name: string | null; app: string; risk: string } | undefined;

    if (!existing) {
      return Response.json({ error: `Request ${id} not found` }, { status: 404 });
    }

    db.prepare(
      `UPDATE access_requests
       SET status = ?, decided_at = ?, approver_id = ?
       WHERE id = ?`,
    ).run(decision, decidedAt, approverName, id);

    emitEvent({
      id: newEventId(),
      timestamp: decidedAt,
      agent: "access",
      action: decision === "granted"
        ? `Access approved: ${existing.user_name || "User"} -> ${existing.app} by ${approverName} (8h lease)`
        : `Access denied: ${existing.user_name || "User"} -> ${existing.app} by ${approverName}`,
      status: decision === "granted" ? "done" : "blocked",
      confidence: 1.0,
      sources: [{ title: "Access Policy", ref: "doc_04_access_policy" }],
      traceId: newEventId(),
      undoable: decision === "granted",
    });

    return Response.json({ ok: true, status: decision });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
