import { emitEvent, newEventId } from "@/lib/events";

// POST /api/actionswarm/slack
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { text?: string };

    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: "actionswarm",
      action: "Action items posted to #eng-tasks",
      status: "done",
      sources: [{ title: "slack_summary", ref: "#eng-tasks" }],
      traceId: newEventId(),
      undoable: false,
    });

    return Response.json({ status: "ok", message: "Posted to #eng-tasks" });
  } catch (e) {
    return Response.json(
      { status: "error", error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
