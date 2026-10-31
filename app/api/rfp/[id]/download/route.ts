import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getDb } from "@/lib/db";
import { writeFilled } from "@/lib/xlsx";
import type { FilledRow } from "@/lib/xlsx";

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
  let tmpPath: string | null = null;
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

    // Build filled rows
    const filledRows: FilledRow[] = questions.map((q) => ({
      id: q.id.replace(`${id}_q`, ""), // strip prefix to get original number string
      answer: q.human_answer ?? q.answer,
      confidence: q.confidence,
      status: q.status as "filled" | "flagged",
      sourceRef: q.source_ref,
    }));

    // Use original upload path; if missing, use uploads dir
    const originalPath = path.resolve(
      process.cwd(),
      "data",
      "uploads",
      `${id}.xlsx`,
    );

    // Create a temp copy so we don't mutate the original
    const tmpDir = await os.tmpdir
      ? os.tmpdir()
      : path.resolve(process.cwd(), "data", "uploads");
    const tmpId = crypto.randomUUID();
    tmpPath = path.join(tmpDir, `${tmpId}.xlsx`);

    await mkdir(path.dirname(tmpPath), { recursive: true });
    await copyFile(originalPath, tmpPath);

    await writeFilled(tmpPath, filledRows);

    // Read the file back as buffer
    const { readFile } = await import("node:fs/promises");
    const fileBuffer = await readFile(tmpPath);

    const customerSlug = questionnaire.customer
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const filename = `rfp_${customerSlug}_${id.slice(0, 8)}.xlsx`;

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (tmpPath) {
      rm(tmpPath, { force: true }).catch(() => {
        // ignore cleanup errors
      });
    }
  }
}
