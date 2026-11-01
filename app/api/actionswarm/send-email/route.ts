import { emitEvent, newEventId } from "@/lib/events";

// POST /api/actionswarm/send-email
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      to?: string;
      cc?: string;
      subject?: string;
      body?: string;
    };

    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: "actionswarm",
      action: `Follow-up email dispatched to ${body.to || "client"} (${body.subject || "Meeting Summary"})`,
      status: "done",
      sources: [{ title: "email_draft", ref: body.subject || "Meeting Summary" }],
      traceId: newEventId(),
      undoable: false,
    });

    return Response.json({ status: "ok", message: "Email logged successfully" });
  } catch (e) {
    return Response.json(
      { status: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
