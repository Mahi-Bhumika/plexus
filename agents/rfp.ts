import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { searchKnowledge, searchMemory, addMemory, deleteMemory, logTurn } from "@/lib/meko";
import { withReplay } from "@/lib/replay";
import { emitEvent, newEventId } from "@/lib/events";
import { getDb } from "@/lib/db";
import { guard, recordUndo, registerUndoHandler } from "@/lib/guard";

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

type Fix = { answer: string; approver: string };
type Candidate = Fix & { question: string };
// candidates: stored human fixes that might apply; memFix: the one the judge accepted
type Ctx = { chunks: KnowledgeChunk[]; candidates: Candidate[]; memFix: Fix | null };

export type RowStatus = "filled" | "flagged" | "error";
export type Coverage = "full" | "partial" | "none";
export type FlagReason =
  | "gemini_error" // Gemini call failed or returned nothing for this id
  | "no_knowledge" // knowledge search returned zero chunks
  | "coverage:none" // chunks found, but they do not answer the question
  | "coverage:partial" // chunks answer only part, or reveal a gap
  | "low_confidence"; // full coverage but confidence under threshold

type Resolved = {
  q: QuestionInput;
  answer: string | null;
  confidence: number;
  coverage: Coverage | null;
  status: RowStatus;
  reason: FlagReason | null;
  sourceRef: string | null;
  reused: number;
};

export function decide(
  r: QuestionResult,
  hadChunks: boolean,
): { status: RowStatus; reason: FlagReason | null } {
  if (r.coverage === "none") {
    return {
      status: "flagged",
      reason: hadChunks ? "coverage:none" : "no_knowledge",
    };
  }
  if (r.coverage === "partial") {
    return { status: "flagged", reason: "coverage:partial" };
  }
  if (r.confidence < CONFIDENCE_THRESHOLD) {
    return { status: "flagged", reason: "low_confidence" };
  }
  return { status: "filled", reason: null };
}

function resolveRow(
  q: QuestionInput,
  r: QuestionResult | undefined,
  ctx: Ctx | undefined,
  failedIds: Set<string>,
): Resolved {
  if (ctx?.memFix) {
    return {
      q,
      answer: ctx.memFix.answer,
      confidence: 1,
      coverage: "full",
      status: "filled",
      reason: null,
      sourceRef: `fix:${ctx.memFix.approver}`,
      reused: 1,
    };
  }
  if (!r || failedIds.has(q.id)) {
    return {
      q,
      answer: null,
      confidence: 0,
      coverage: null,
      status: "error",
      reason: "gemini_error",
      sourceRef: null,
      reused: 0,
    };
  }
  const d = decide(r, (ctx?.chunks.length ?? 0) > 0);
  // Gemini cites a chunk id; show the document section title instead
  const cited = ctx?.chunks.find((c) => c.ref === r.source_ref);
  return {
    q,
    answer: r.answer,
    confidence: r.confidence,
    coverage: r.coverage,
    status: d.status,
    reason: d.reason,
    sourceRef: cited ? deriveCitationTitle(cited) : r.source_ref,
    reused: 0,
  };
}

function deriveCitationTitle(chunk: KnowledgeChunk): string {
  const firstLine = chunk.content.split("\n")[0]?.trim() ?? "";
  if (firstLine.startsWith("Section: ")) {
    return firstLine.slice("Section: ".length).trim();
  }
  return chunk.title || "Knowledge Doc";
}

// ---- Safer reuse match -------------------------------------------------
// A stored fix is reused only when the new question is clearly a rewording
// of the fixed one: same numbers, and at least half of the shorter question's
// content words appear in the other. Thresholds are a starting point; tune
// them against the real sheet 1 / sheet 2 pairs with scripts/learning-test.ts.

const STOP = new Set([
  "the", "and", "for", "are", "you", "your", "our", "does", "do", "how",
  "what", "which", "that", "this", "with", "from", "have", "has", "can",
  "will", "any", "all", "please", "describe", "provide", "explain", "its",
  "who", "when", "where", "into", "not", "than", "then", "also", "such",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s.%]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length > 2 && !STOP.has(w))
      // crude stemming: retain / retained / retention share a prefix
      .map((w) => (/\d/.test(w) || w.length <= 5 ? w : w.slice(0, 5))),
  );
}

export type MatchDetails = {
  match: boolean;
  numbersEqual: boolean;
  ratio: number; // shared words / words in the shorter question
  shared: string[];
  onlyA: string[];
  onlyB: string[];
};

export function matchDetails(a: string, b: string): MatchDetails {
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = [...ta].filter((w) => tb.has(w));
  const onlyA = [...ta].filter((w) => !tb.has(w));
  const onlyB = [...tb].filter((w) => !ta.has(w));

  const nums = (s: Set<string>) =>
    [...s].filter((w) => /\d/.test(w)).sort().join(",");
  const numbersEqual = nums(ta) === nums(tb);
  const smaller = Math.min(ta.size, tb.size);
  const ratio = smaller === 0 ? 0 : shared.length / smaller;

  return {
    match: numbersEqual && shared.length >= 3 && ratio >= 0.5,
    numbersEqual,
    ratio,
    shared,
    onlyA,
    onlyB,
  };
}

export function sameQuestion(a: string, b: string): boolean {
  return matchDetails(a, b).match;
}

function parseFixCandidate(text: string): Candidate | null {
  // Stored as: "RFP_FIX | <question> | <approved answer> | <approver>"
  // Meko may rewrite memories, so look for the marker rather than
  // requiring it at position 0.
  const idx = text.indexOf("RFP_FIX");
  if (idx < 0) return null;
  const parts = text
    .slice(idx)
    .split("|")
    .map((p) => p.trim());
  if (parts.length < 4) return null;
  const [, question, answer, approver] = parts;
  if (!question || !answer || !approver) return null;
  return { question, answer, approver };
}

async function fetchQuestionContext(
  q: QuestionInput,
  questionnaireId: string,
): Promise<Ctx> {
  const knowledgeKey = `rfp/knowledge_q${q.id}_${questionnaireId}`;
  const memoryKey = `rfp/memory_q${q.id}_${questionnaireId}`;

  const [chunks, memories] = await Promise.all([
    withReplay(knowledgeKey, () => searchKnowledge("plexus_rfp", q.question)),
    withReplay(memoryKey, () =>
      searchMemory("plexus_rfp", `RFP_FIX ${q.question}`),
    ),
  ]);

  // Cheap pre-filter only: drop fixes whose numbers differ (AES-256 vs AES-128).
  // Whether a fix really answers this question is decided by the judge below.
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const mem of memories as MemoryFix[]) {
    const c = parseFixCandidate(mem.text);
    if (!c) continue;
    const key = `${c.question}|${c.answer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!matchDetails(q.question, c.question).numbersEqual) continue;
    candidates.push(c);
    if (candidates.length >= 3) break;
  }

  return { chunks: chunks as KnowledgeChunk[], candidates, memFix: null };
}

const judgeSchema = z.array(
  z.object({ id: z.string(), fix_index: z.number().int().nullable() }),
);

// One Gemini call per batch: for questions that have candidate fixes, decide
// whether a stored human-approved answer can be reused as-is. Fails closed:
// on any error nothing is reused and the question goes through normal answering.
async function judgeFixes(
  questionnaireId: string,
  batchIndex: number,
  batch: QuestionInput[],
  contexts: Map<string, Ctx>,
): Promise<void> {
  const withCandidates = batch.filter(
    (q) => (contexts.get(q.id)?.candidates.length ?? 0) > 0,
  );
  if (withCandidates.length === 0) return;

  const lines: string[] = [
    "You decide whether a stored, human-approved answer can be reused for a new RFP question.",
    "Reuse a stored fix only if its question asks for the same thing as the new question: same subject, same scope, same people or systems, and the approved answer fully answers the new question as asked.",
    "Do NOT reuse when the new question is narrower, broader or about a different detail, for example a deletion timeline versus a certificate of deletion, how data is deleted versus whether proof is given, or employees versus contractors.",
    "When unsure, do not reuse.",
    "",
  ];
  withCandidates.forEach((q, i) => {
    lines.push(`[Q${i + 1}] ID: ${q.id}`);
    lines.push(`New question: "${q.question}"`);
    contexts.get(q.id)!.candidates.forEach((c, k) => {
      lines.push(`  Stored fix ${k}: question "${c.question}" | approved answer "${c.answer.slice(0, 400)}"`);
    });
    lines.push("");
  });
  lines.push(
    "Return a JSON array with one object per new question: id (string) and fix_index (the number of the stored fix that can be reused, or null).",
  );
  const prompt = lines.join("\n");

  try {
    const res = await withReplay(
      `rfp/judge_q${questionnaireId}_b${batchIndex}`,
      () => generateJson(judgeSchema, prompt, { model: "FAST" }),
    );
    if (!res.success) {
      console.warn("rfp fix judge failed; no fixes reused for this batch");
      return;
    }
    for (const d of res.data) {
      const ctx = contexts.get(d.id);
      if (!ctx || d.fix_index == null) continue;
      const c = ctx.candidates[d.fix_index];
      if (c) ctx.memFix = { answer: c.answer, approver: c.approver };
    }
  } catch (err) {
    console.warn(
      `rfp fix judge error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function buildBatchPrompt(
  batch: QuestionInput[],
  contexts: Map<string, Ctx>,
): string {
  const lines: string[] = [
    "You are filling an RFP questionnaire. For each question, use ONLY the provided knowledge chunks to answer. Never use outside knowledge.",
    "Write each answer in 1 to 3 sentences. Include every specific date, number, count and name in the chunks that bears on the question; do not leave one out.",
    "",
    "Set coverage for each question using these exact rules:",
    "- \"full\": the chunks answer every part of the question, and contain everything a customer would need to rely on the answer.",
    "- \"partial\": the chunks answer only part of the question, OR the honest answer reveals a gap between what the customer is asking for and what we do (for example, some data or copies fall outside their stated requirement) and the chunks contain no policy, option or next step for handling that gap.",
    "- \"none\": the chunks do not answer the question at all.",
    "For \"partial\" or \"none\", still give a short draft answer from the chunks if there is one, otherwise null.",
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
        lines.push(`  "${chunk.content.slice(0, 1200)}"`);
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

function saveRows(questionnaireId: string, rows: Resolved[]): void {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO rfp_questions (id, questionnaire_id, number, question, answer, confidence, coverage, status, source_ref, flag_reason, reused_from_fix)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      answer = excluded.answer,
      confidence = excluded.confidence,
      coverage = excluded.coverage,
      status = excluded.status,
      source_ref = excluded.source_ref,
      flag_reason = excluded.flag_reason,
      reused_from_fix = excluded.reused_from_fix
  `);

  const tx = db.transaction((items: Resolved[]) => {
    for (const r of items) {
      upsert.run(
        `${questionnaireId}_q${r.q.number}`,
        questionnaireId,
        r.q.number,
        r.q.question,
        r.answer,
        r.confidence,
        r.coverage,
        r.status,
        r.sourceRef,
        r.reason,
        r.reused,
      );
    }
  });
  tx(rows);
}

function markBatchError(questionnaireId: string, batch: QuestionInput[]): void {
  saveRows(
    questionnaireId,
    batch.map((q) => ({
      q,
      answer: null,
      confidence: 0,
      coverage: null,
      status: "error" as const,
      reason: "gemini_error" as const,
      sourceRef: null,
      reused: 0,
    })),
  );
}

async function processBatch(
  questionnaireId: string,
  batch: QuestionInput[],
  batchIndex: number,
): Promise<{ filled: number; flagged: number; errors: number }> {
  const traceId = newEventId();

  const contextEntries: Array<[string, Ctx]> = await Promise.all(
    batch.map(async (q): Promise<[string, Ctx]> => {
      try {
        return [q.id, await fetchQuestionContext(q, questionnaireId)];
      } catch (err) {
        console.warn(
          `rfp context failed for q${q.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [q.id, { chunks: [], candidates: [], memFix: null }];
      }
    }),
  );
  const contexts = new Map<string, Ctx>(contextEntries);

  // Decide which stored human fixes can be reused (skips Gemini answering for those)
  await judgeFixes(questionnaireId, batchIndex, batch, contexts);

  // Questions with a reusable human fix skip Gemini entirely
  const needsGemini = batch.filter((q) => !contexts.get(q.id)?.memFix);
  const failedIds = new Set<string>();
  let geminiResults: QuestionResult[] = [];

  if (needsGemini.length > 0) {
    const prompt = buildBatchPrompt(needsGemini, contexts);
    const replayKey = `rfp/batch_q${questionnaireId}_b${batchIndex}`;

    const genResult = await withReplay(replayKey, () =>
      generateJson(batchResultSchema, prompt, { model: "FAST" }),
    );

    if (genResult.success) {
      geminiResults = genResult.data;
    } else {
      for (const q of needsGemini) failedIds.add(q.id);
    }
  }

  const resultMap = new Map<string, QuestionResult>();
  for (const r of geminiResults) resultMap.set(r.id, r);

  const rows = batch.map((q) =>
    resolveRow(q, resultMap.get(q.id), contexts.get(q.id), failedIds),
  );
  saveRows(questionnaireId, rows);

  const filled = rows.filter((r) => r.status === "filled").length;
  const errors = rows.filter((r) => r.status === "error").length;
  const flagged = rows.length - filled;

  const batchStatus: "done" | "flagged" | "error" =
    errors > 0 ? "error" : flagged > 0 ? "flagged" : "done";

  const sources: Array<{ title: string; ref: string }> = [];
  for (const r of rows) {
    if (r.sourceRef) sources.push({ title: r.sourceRef, ref: r.sourceRef });
  }

  const avgConfidence =
    rows.length > 0
      ? rows.reduce((sum, r) => sum + r.confidence, 0) / rows.length
      : 0;

  const reasonCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.reason) reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  }
  const reasonText =
    reasonCounts.size > 0
      ? ` [${[...reasonCounts].map(([k, v]) => `${k}:${v}`).join(", ")}]`
      : "";

  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "rfp",
    action: `Batch ${batchIndex + 1}: answered ${rows.length} questions (${filled} filled, ${flagged} flagged)${reasonText}`,
    status: batchStatus,
    confidence: avgConfidence,
    sources: sources.slice(0, 3),
    traceId,
    undoable: false,
  });

  await logTurn(
    "plexus_rfp",
    `Batch ${batchIndex}: ${batch.map((q) => q.id).join(",")}`,
    `filled=${filled} flagged=${flagged} errors=${errors}${reasonText}`,
    ["Fetch knowledge", "Search memory", "Call Gemini", "Save to DB"],
    `Processed ${batch.length} questions with ${filled} filled at threshold ${CONFIDENCE_THRESHOLD}`,
    `rfp/logTurn_${questionnaireId}_b${batchIndex}`,
  );

  return { filled, flagged, errors };
}

export async function runRfp(
  questionnaireId: string,
  filePath: string,
): Promise<{ filled: number; flagged: number; errors: number; total: number }> {
  const { readQuestions } = await import("@/lib/xlsx");
  const questions = await readQuestions(filePath);
  const total = questions.length;

  if (total === 0) {
    return { filled: 0, flagged: 0, errors: 0, total: 0 };
  }

  const BATCH_SIZE = 10;
  const CONCURRENCY = 2;
  const batches: QuestionInput[][] = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }

  let totalFilled = 0;
  let totalFlagged = 0;
  let totalErrors = 0;

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(async (batch, j) => {
        try {
          return await processBatch(questionnaireId, batch, i + j);
        } catch (err) {
          console.warn(
            `rfp batch ${i + j} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Write error rows so the sheet shows them instead of dropping them
          markBatchError(questionnaireId, batch);
          return { filled: 0, flagged: batch.length, errors: batch.length };
        }
      }),
    );
    for (const r of results) {
      totalFilled += r.filled;
      totalFlagged += r.flagged;
      totalErrors += r.errors;
    }
  }

  emitEvent({
    id: newEventId(),
    timestamp: new Date().toISOString(),
    agent: "rfp",
    action: `RFP complete: filled ${totalFilled} of ${total}, flagged ${totalFlagged}${totalErrors > 0 ? `, ${totalErrors} errors` : ""}`,
    status: totalErrors > 0 ? "error" : totalFlagged === 0 ? "done" : "flagged",
    sources: [],
    traceId: newEventId(),
    undoable: false,
  });

  return { filled: totalFilled, flagged: totalFlagged, errors: totalErrors, total };
}

// ---- Human fix ---------------------------------------------------------
// POST /api/rfp/fix { questionId, answer?, approver } -> { row }
// Saves the approved answer on the row and stores it as a memory so the
// next questionnaire can reuse it (memory_search is cross-agent within the
// datapack, so no separate promote step is needed for reuse to work).
// If answer is omitted or blank, the row's current answer is approved as-is.
//
// Guard layer: the answer and the question text are checked for prompt injection
// BEFORE anything is saved, because a saved fix is fed back into Gemini prompts
// on every later questionnaire. An allowed fix is undoable: undo restores the row
// and deletes the RFP_FIX memory, so the learned answer stops being reused.

export type RfpRow = {
  id: string;
  number: number;
  question: string;
  answer: string | null;
  coverage: Coverage | null;
  confidence: number;
  status: RowStatus;
  flag_reason: FlagReason | null;
  source_ref: string | null;
  reused_from_fix: number;
};

const ROW_COLUMNS =
  "id, number, question, COALESCE(human_answer, answer) AS answer, coverage, confidence, status, flag_reason, source_ref, reused_from_fix";

export function getRow(questionId: string): RfpRow | undefined {
  return getDb()
    .prepare(`SELECT ${ROW_COLUMNS} FROM rfp_questions WHERE id = ?`)
    .get(questionId) as RfpRow | undefined;
}

// What the row looked like before the fix, so undo can put it back.
type PrevRow = {
  human_answer: string | null;
  status: string;
  confidence: number | null;
  flag_reason: string | null;
  source_ref: string | null;
};
type FixUndoPayload = { questionId: string; prev: PrevRow; memoryId: string | null };

// Meko returns a UUID; the SQLite fallback uses mem_<uuid>. Anything else is not safe to delete.
const MEMORY_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mem_[0-9a-f-]{36})$/i;

registerUndoHandler("rfp_human_fix", async (raw) => {
  const p = raw as FixUndoPayload;
  getDb()
    .prepare(
      `UPDATE rfp_questions
       SET human_answer = ?, status = ?, confidence = ?, flag_reason = ?, source_ref = ?
       WHERE id = ?`,
    )
    .run(p.prev.human_answer, p.prev.status, p.prev.confidence ?? 0, p.prev.flag_reason, p.prev.source_ref, p.questionId);

  // Forget the learned answer so the next questionnaire does not reuse it.
  // Meko search can lag a few seconds before the deleted memory stops appearing.
  if (p.memoryId && MEMORY_ID.test(p.memoryId)) {
    try {
      await deleteMemory(p.memoryId, "plexus_rfp");
    } catch (err) {
      console.warn(
        `undo: row restored but memory ${p.memoryId} was not deleted: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
});

export async function humanFix(
  questionId: string,
  answer: string | undefined,
  approver: string,
): Promise<{ row: RfpRow; memoryId?: string; fallback: boolean; eventId: string }> {
  const who = approver.replace(/\|/g, "/").trim();
  if (!who) throw new Error("approver is required");

  const db = getDb();
  const existing = db
    .prepare(
      "SELECT id, number, question, COALESCE(human_answer, answer) AS current FROM rfp_questions WHERE id = ?",
    )
    .get(questionId) as
    | { id: string; number: number; question: string; current: string | null }
    | undefined;
  if (!existing) throw new Error(`No question with id ${questionId}`);

  const clean = (answer ?? existing.current ?? "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) throw new Error("No answer to approve: send an answer");

  const questionText = existing.question.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

  const prev = db
    .prepare(
      "SELECT human_answer, status, confidence, flag_reason, source_ref FROM rfp_questions WHERE id = ?",
    )
    .get(existing.id) as PrevRow;

  // Guard first: nothing is saved if the text tries to give the AI orders.
  const verdict = guard({
    agent: "rfp",
    kind: "rfp_human_fix",
    label: `Human fix saved for Q${existing.number} (approved by ${who})`,
    actor: who,
    untrustedText: [clean, questionText],
    sources: [{ title: `fix:${who}`, ref: `fix:${who}` }],
    undo: { kind: "rfp_human_fix", payload: { questionId: existing.id, prev, memoryId: null } satisfies FixUndoPayload },
  });
  if (verdict.decision !== "allow") {
    const blocked = new Error(verdict.reasons[0] ?? "This fix was stopped by the guard layer.");
    blocked.name = "GuardBlocked"; // the API route turns this into a 422 instead of a 500
    throw blocked;
  }

  db.prepare(
    `UPDATE rfp_questions
     SET human_answer = ?, status = 'filled', confidence = 1, flag_reason = NULL, source_ref = ?
     WHERE id = ?`,
  ).run(clean, `fix:${who}`, existing.id);

  // The row is already saved. If Meko is unreachable (or Demo Mode has no
  // recorded fixture for this write), keep going rather than failing the fix.
  let mem: { success: boolean; memoryId?: string; fallback?: boolean } = {
    success: false,
    fallback: true,
  };
  try {
    mem = await addMemory(
      "plexus_rfp",
      `RFP_FIX | ${questionText} | ${clean} | ${who}`,
    );
  } catch (err) {
    console.warn(
      `humanFix: memory not saved: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Now that the memory id is known, store it so undo can delete the memory too.
  const memoryId = mem.memoryId && MEMORY_ID.test(mem.memoryId) ? mem.memoryId : null;
  recordUndo(verdict.eventId, "rfp_human_fix", { questionId: existing.id, prev, memoryId } satisfies FixUndoPayload);

  const row = getRow(existing.id);
  if (!row) throw new Error("Row vanished after update");
  return { row, memoryId: mem.memoryId, fallback: mem.fallback ?? false, eventId: verdict.eventId };
}