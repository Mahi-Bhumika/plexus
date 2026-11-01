import { NextResponse } from "next/server";
import { approveCancel, CancelError, listCancellations, rejectCancel, requestCancel } from "@/agents/saas-cancel";
import { undoAction } from "@/lib/guard";

function fail(err: unknown) {
  if (err instanceof CancelError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

// GET -> { ok, cancellations, monthlySaved, yearlySaved }
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...listCancellations() });
  } catch (err) {
    return fail(err);
  }
}

// POST { tool, action: "request" | "approve" | "reject" | "undo", approver?, eventId? }
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => null)) as {
      tool?: string;
      action?: string;
      approver?: string;
      eventId?: string;
    } | null;
    if (!b?.tool || !b.action) throw new CancelError("tool and action are required", 400);

    if (b.action === "request") {
      const r = await requestCancel(b.tool, { slack: false });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === "approve" || b.action === "reject") {
      if (!b.approver) throw new CancelError("approver is required", 400);
      const r = b.action === "approve" ? await approveCancel(b.tool, b.approver) : await rejectCancel(b.tool, b.approver);
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === "undo") {
      if (!b.eventId) throw new CancelError("eventId is required", 400);
      const r = await undoAction(b.eventId);
      return NextResponse.json(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }, { status: r.ok ? 200 : 409 });
    }
    throw new CancelError(`Unknown action ${b.action}`, 400);
  } catch (err) {
    return fail(err);
  }
}