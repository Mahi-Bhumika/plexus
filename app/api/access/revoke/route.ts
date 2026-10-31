import { getDb } from "@/lib/db";
import { emitEvent, newEventId } from "@/lib/events";

// POST /api/access/revoke
// Body: { id: string, reason?: string }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id: string; reason?: string };
    const { id, reason } = body;
    const db = getDb();
    const revokedAt = new Date().toISOString();

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
       SET status = 'undone', decided_at = ?
       WHERE id = ?`,
    ).run(revokedAt, id);

    emitEvent({
      id: newEventId(),
      timestamp: revokedAt,
      agent: "access",
      action: `Access revoked: ${existing.user_name || "User"} -> ${existing.app} (${reason || "Manual revoke"})`,
      status: "undone",
      confidence: 1.0,
      sources: [{ title: "Access Policy", ref: "doc_04_access_policy" }],
      traceId: newEventId(),
      undoable: false,
    });

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
