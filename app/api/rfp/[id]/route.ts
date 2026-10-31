import { getDb } from "@/lib/db";

type RfpQuestion = {
  id: string;
  questionnaire_id: string;
  number: number;
  question: string;
  answer: string | null;
  confidence: number;
  status: string;
  source_ref: string | null;
  human_answer: string | null;
  reused_from_fix: number;
};

type Questionnaire = {
  id: string;
  customer: string;
  uploaded_at: string;
  total: number;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();

    const questionnaire = db
      .prepare("SELECT * FROM questionnaires WHERE id = ?")
      .get(id) as Questionnaire | undefined;

    if (!questionnaire) {
      return Response.json({ error: "Questionnaire not found" }, { status: 404 });
    }

    const questions = db
      .prepare(
        "SELECT * FROM rfp_questions WHERE questionnaire_id = ? ORDER BY number ASC",
      )
      .all(id) as RfpQuestion[];

    return Response.json({ questionnaire, questions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      questionId: string;
      humanAnswer: string;
    };
    const { questionId, humanAnswer } = body;

    const db = getDb();
    db.prepare(
      "UPDATE rfp_questions SET human_answer = ? WHERE id = ? AND questionnaire_id = ?",
    ).run(humanAnswer, questionId, id);

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
