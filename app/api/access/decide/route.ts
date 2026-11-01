import { decideAccessRequest, AccessError } from "@/agents/access";

// POST /api/access/decide
// Body: { id: string, decision: 'granted' | 'denied', approverName: string }
// Only the policy approver (or the founder) can decide, and never the requester.
// Success: { ok: true, status, eventId }.  Refused: { error } with 403 / 404 / 409.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id: string;
      decision: "granted" | "denied";
      approverName: string;
    };
    const out = decideAccessRequest({ id: body.id, decision: body.decision, approverName: body.approverName });
    return Response.json({ ok: true, status: out.status, eventId: out.eventId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof AccessError ? err.httpStatus : 500;
    return Response.json({ error: message }, { status });
  }
}
