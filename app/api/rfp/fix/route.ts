import { humanFix } from "@/agents/rfp";

// POST /api/rfp/fix
// Body: { questionId: string, answer?: string, approver: string }
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      questionId?: string;
      answer?: string;
      approver?: string;
    };

    if (!body.questionId) {
      return Response.json({ error: "questionId is required" }, { status: 400 });
    }

    const approver = body.approver || "Riya Sharma";
    const result = await humanFix(body.questionId, body.answer, approver);

    return Response.json({ ok: true, row: result.row, memoryId: result.memoryId, fallback: result.fallback });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error in /api/rfp/fix:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
