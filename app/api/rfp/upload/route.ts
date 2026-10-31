import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { readQuestions } from "@/lib/xlsx";
import { runRfp } from "@/agents/rfp";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const customer = (formData.get("customer") as string | null) ?? "Unknown";

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const uuid = crypto.randomUUID();
    const uploadsDir = path.resolve(process.cwd(), "data", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, `${uuid}.xlsx`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Read question count
    const questions = await readQuestions(filePath);
    const total = questions.length;

    // Insert questionnaire row
    const db = getDb();
    const uploadedAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO questionnaires (id, customer, uploaded_at, total) VALUES (?, ?, ?, ?)",
    ).run(uuid, customer, uploadedAt, total);

    // Run the RFP agent
    const result = await runRfp(uuid, filePath);

    return Response.json({
      questionnaireId: uuid,
      filled: result.filled,
      flagged: result.flagged,
      total: result.total,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("RFP upload error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
