import fs from "node:fs";
import { findTranscriptFile, runActionSwarm } from "@/agents/actionswarm";

// POST /api/actionswarm
//   body (optional): { transcript?: string, meetingDate?: "YYYY-MM-DD" }
//   With no transcript it uses the kickoff transcript file in data/.
// Returns the full result: tasks (with guard decisions), quarantined lines, slack, emailDraft.
// Errors: { status: "error", message }.
export async function POST(req: Request) {
  try {
    let body: { transcript?: string; meetingDate?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    let transcript = body.transcript?.trim();
    if (!transcript) {
      const file = findTranscriptFile();
      if (!file) {
        return Response.json(
          { status: "error", message: "No transcript sent and no kickoff transcript found in data/" },
          { status: 400 },
        );
      }
      transcript = fs.readFileSync(file, "utf8");
    }

    const result = await runActionSwarm(transcript, { meetingDate: body.meetingDate });
    return Response.json(result, { status: result.status === "error" ? 502 : 200 });
  } catch (e) {
    return Response.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
