import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { searchKnowledge, searchMemory, logTurn } from "@/lib/meko";
import { withReplay } from "@/lib/replay";
import { emitEvent, newEventId } from "@/lib/events";
import { getDb } from "@/lib/db";

const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.CONFIDENCE_THRESHOLD ?? "0.85",
);

const questionResultSchema = z.object({
  id: z.string(),
  answer: z.string().nullable(),
  coverage: z.enum(["full", "partial", "none"]),
  confidence: z.number().min(0).max(1),
  source_ref: z.string().nullable(),
});

type QuestionResult = z.infer<typeof questionResultSchema>;

const batchResultSchema = z.array(questionResultSchema);

type QuestionInput = {
  id: string;
  number: number;
  question: string;
};

type KnowledgeChunk = {
  title: string;
  content: string;
  ref: string;
};

type MemoryFix = {
  text: string;
};

function deriveCitationTitle(chunk: KnowledgeChunk): string {
  const firstLine = chunk.content.split("\n")[0]?.trim() ?? "";
  if (firstLine.startsWith("Section: ")) {
    return firstLine.slice("Section: ".length).trim();
  }
  return chunk.title || "Knowledge Doc";
}

function parseMemoryFix(
  text: string,
  question: string,
): { answer: string; approver: string } | null {
  // Format: "RFP_FIX | <question> | <approved answer> | <approver>"
  if (!text.startsWith("RFP_FIX")) return null;
  const parts = text.split("|").map((p) => p.trim());
  if (parts.length < 4) return null;
  const fixQuestion = parts[1] ?? "";
  const answer = parts[2] ?? "";
  const approver = parts[3] ?? "";

  // Only reuse if clearly about the same topic (case-insensitive keyword overlap)
  const qWords = question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const fqWords = fixQuestion.toLowerCase();
  const overlapCount = qWords.filter((w) => fqWords.includes(w)).length;
  if (overlapCount < 2) return null;

  return { answer, approver };
}

async function fetchQuestionContext(
  q: QuestionInput,
  questionnaireId: string,
): Promise<{
  chunks: KnowledgeChunk[];
  memFix: { answer: string; approver: string } | null;
}> {
  const knowledgeKey = `rfp/knowledge_q${q.id}_${questionnaireId}`;
  const memoryKey = `rfp/memory_q${q.id}_${questionnaireId}`;

  const [chunks, memories] = await Promise.all([
    withReplay(knowledgeKey, () =>
      searchKnowledge("plexus_rfp", q.question),
    ),
    withReplay(memoryKey, () =>
      searchMemory("plexus_rfp", `RFP_FIX ${q.question}`),
    ),
  ]);

  let memFix: { answer: string; approver: string } | null = null;
  for (const mem of memories as MemoryFix[]) {
    const parsed = parseMemoryFix(mem.text, q.question);
    if (parsed) {
      memFix = parsed;
      break;
    }
  }

  return { chunks: chunks as KnowledgeChunk[], memFix };
}

function buildBatchPrompt(
  batch: QuestionInput[],
  contexts: Map<
    string,
    { chunks: KnowledgeChunk[]; memFix: { answer: string; approver: string } | null }
  >,
): string {
  const lines: string[] = [
    "You are filling an RFP questionnaire. For each question, use ONLY the provided knowledge chunks to answer. If chunks don't fully answer, set coverage to \"partial\" or \"none\".",
    "",
    "Questions and their knowledge:",
  ];

  for (let i = 0; i < batch.length; i++) {
    const q = batch[i];
    const ctx = contexts.get(q.id);
    lines.push(`\n[Q${i + 1}] ID: ${q.id}`);
    lines.push(`Question: "${q.question}"`);
    lines.push("Knowledge chunks:");

    if (ctx && ctx.chunks.length > 0) {
      for (const chunk of ctx.chunks) {
        const title = deriveCitationTitle(chunk);
        lines.push(`- [${title}] ref:${chunk.ref}`);
        lines.push(`  "${chunk.content.slice(0, 500)}"`);
      }
    } else {
      lines.push("  (no knowledge chunks found)");
    }
  }

  lines.push(
    "\nReturn a JSON array of objects with fields: id (string), answer (string or null), coverage (\"full\"|\"partial\"|\"none\"), confidence (0-1), source_ref (string or null).",
  );

  return lines.join("\n");
}

function saveBatchToDb(
  questionnaireId: string,
  batch: QuestionInput[],
  results: QuestionResult[],
  contexts: Map<
    string,
    { chunks: KnowledgeChunk[]; memFix: { answer: string; approver: string } | null }
  >,
): void {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO rfp_questions (id, questionnaire_id, number, question, answer, confidence, status, source_ref, reused_from_fix)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      answer = excluded.answer,
      confidence = excluded.confidence,
      status = excluded.status,
      source_ref = excluded.source_ref,
      reused_from_fix = excluded.reused_from_fix
  `);

  const resultMap = new Map<string, QuestionResult>();
  for (const r of results) {
    resultMap.set(r.id, r);
  }

  for (const q of batch) {
    const r = resultMap.get(q.id);
    const ctx = contexts.get(q.id);
    const rowId = `${questionnaireId}_q${q.number}`;

    if (!r) {
      // Error case: flag the row
      upsert.run(rowId, questionnaireId, q.number, q.question, null, 0, "flagged", null, 0);
      continue;
    }

    const isFilled =
      r.coverage === "full" && r.confidence >= CONFIDENCE_THRESHOLD;
    const status = isFilled ? "filled" : "flagged";
    const reusedFromFix = ctx?.memFix != null ? 1 : 0;

    let answer = r.answer;
    let sourceRef = r.source_ref;
    if (ctx?.memFix) {
      answer = ctx.memFix.answer;
      sourceRef = `fix:${ctx.memFix.approver}`;
    }

    upsert.run(
      rowId,
      questionnaireId,
      q.number,
      q.question,
      answer,
      r.confidence,
      status,
      sourceRef,
      reusedFromFix,
    );
  }
}

async function processBatch(
  questionnaireId: string,
  batch: QuestionInput[],
  batchIndex: number,
): Promise<{ filled: number; flagged: number }> {
  const traceId = newEventId();

  // Fetch knowledge and memory for each question in parallel
  type CtxEntry = { chunks: KnowledgeChunk[]; memFix: { answer: string; approver: string } | null };
  const contextEntries: Array<[string, CtxEntry]> = await Promise.all(
    batch.map(async (q): Promise<[string, CtxEntry]> => {
      try {
        const ctx = await fetchQuestionContext(q, questionnaireId);
        return [q.id, ctx];
      } catch {
        return [q.id, { chunks: [], memFix: null }];
      }
    }),
  );
  const contexts = new Map<string, CtxEntry>(contextEntries);

  // Build questions where memory fix is available - skip Gemini for those
  const needsGemini = batch.filter((q) => !contexts.get(q.id)?.memFix);
  const hasMemFix = batch.filter((q) => !!contexts.get(q.id)?.memFix);

  let geminiResults: QuestionResult[] = [];
  let batchStatus: "done" | "flagged" | "error" = "done";

  if (needsGemini.length > 0) {
    const prompt = buildBatchPrompt(needsGemini, contexts);
    const replayKey = `rfp/batch_q${questionnaireId}_b${batchIndex}`;

    const genResult = await withReplay(replayKey, () =>
      generateJson(batchResultSchema, prompt, { model: "FAST" }),
    );

    if (genResult.success) {
      geminiResults = genResult.data;
    } else {
      batchStatus = "error";
      // Flag all questions in batch that needed Gemini
      geminiResults = needsGemini.map((q) => ({
        id: q.id,
        answer: null,
        coverage: "none" as const,
        confidence: 0,
        source_ref: null,
      }));
    }
  }

  // Build memory fix results
  const fixResults: QuestionResult[] = hasMemFix.map((q) => {
    const ctx = contexts.get(q.id)!;
    return {
      id: q.id,
      answer: ctx.memFix!.answer,
      coverage: "full" as const,
      confidence: 1.0,
      source_ref: `fix:${ctx.memFix!.approver}`,
    };
  });

  const allResults = [...geminiResults, ...fixResults];

  // Save to DB
  saveBatchToDb(questionnaireId, batch, allResults, contexts);

  // Compute counts
  let filled = 0;
  let flagged = 0;
  const sources: Array<{ title: string; ref: string }> = [];

  for (const r of allResults) {
    const isFilled =
      r.coverage === "full" && r.confidence >= CONFIDENCE_THRESHOLD;
    if (isFilled) {
      filled++;
    } else {
      flagged++;
      if (batchStatus === "done") batchStatus = "flagged";
    }
    if (r.source_ref) {
      sources.push({ title: r.source_ref, ref: r.source_ref });
    }
  }

  const avgConfidence =
    allResults.length > 0
      ? allResults.reduce((sum, r) => sum + r.confidence, 0) / allResults.length
      : 0;

  // Emit batch activity event
  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "rfp",
    action: `Batch ${batchIndex + 1}: answered ${allResults.length} questions (${filled} filled, ${flagged} flagged)`,
    status: batchStatus,
    confidence: avgConfidence,
    sources: sources.slice(0, 3),
    traceId,
    undoable: false,
  });

  // Log turn
  await logTurn(
    "plexus_rfp",
    `Batch ${batchIndex}: ${batch.map((q) => q.id).join(",")}`,
    `filled=${filled} flagged=${flagged}`,
    ["Fetch knowledge", "Search memory", "Call Gemini", "Save to DB"],
    `Processed ${batch.length} questions with ${filled} filled at threshold ${CONFIDENCE_THRESHOLD}`,
  );

  return { filled, flagged };
}

export async function runRfp(
  questionnaireId: string,
  filePath: string,
): Promise<{ filled: number; flagged: number; total: number }> {
  const { readQuestions } = await import("@/lib/xlsx");
  const questions = await readQuestions(filePath);
  const total = questions.length;

  if (total === 0) {
    return { filled: 0, flagged: 0, total: 0 };
  }

  // Batch 10 questions per Gemini call, run 2 batches concurrently at most
  const BATCH_SIZE = 10;
  const CONCURRENCY = 2;
  const batches: QuestionInput[][] = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }

  let totalFilled = 0;
  let totalFlagged = 0;

  // Process batches with concurrency limit of 2
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map((batch, j) => {
        try {
          return processBatch(questionnaireId, batch, i + j);
        } catch {
          return Promise.resolve({ filled: 0, flagged: batch.length });
        }
      }),
    );
    for (const r of results) {
      totalFilled += r.filled;
      totalFlagged += r.flagged;
    }
  }

  // Emit summary event
  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "rfp",
    action: `RFP complete: filled ${totalFilled} of ${total}, flagged ${totalFlagged}`,
    status: totalFlagged === 0 ? "done" : "flagged",
    sources: [],
    traceId: newEventId(),
    undoable: false,
  });

  return { filled: totalFilled, flagged: totalFlagged, total };
}
