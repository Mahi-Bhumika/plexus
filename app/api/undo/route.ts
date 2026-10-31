import { NextResponse } from "next/server";
import { undoAction } from "@/lib/guard";
import "@/agents/actionswarm";
// Importing the agents registers their undo handlers (side effect). Add one line per agent that has undoable actions.
import "@/agents/rfp";

export const runtime = "nodejs";

// POST /api/undo { eventId }
//   ok:    { ok: true,  status: "ok",    message }
//   error: { ok: false, status: "error", error, message }   (both fields, so either UI style works)
export async function POST(req: Request) {
  let eventId: string | undefined;
  try {
    const body = (await req.json()) as { eventId?: unknown };
    if (typeof body.eventId === "string") eventId = body.eventId;
  } catch {
    // fall through to the error below
  }
  if (!eventId) {
    const m = "eventId is required";
    return NextResponse.json({ ok: false, status: "error", error: m, message: m }, { status: 400 });
  }
  const result = await undoAction(eventId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, status: "error", error: result.error, message: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: "ok", message: result.message });
}