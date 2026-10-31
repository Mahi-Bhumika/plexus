/**
 * scripts/rfp-debug.ts
 * Diagnostic: first batch of 10 questions ONLY, no changes to any agent logic.
 * Run: pnpm tsx scripts/rfp-debug.ts
 *
 * Prints:
 *   (a) per question – chunk count + first 80 chars of top chunk
 *   (b) Gemini raw JSON (≤1500 chars) or exact error
 *   (c) per row – coverage, confidence, final status, flag reason
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GoogleGenAI } from "@google/genai";

// ── 1. Load .env.local manually (tsx doesn't do it) ─────────────────────────
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip inline comment (everything after first unquoted #)
    let val = trimmed.slice(eqIdx + 1).trim();
    const commentIdx = val.indexOf(" #");
    if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}
loadEnvLocal();

// ── 2. Imports that need env vars already set ────────────────────────────────
import { readQuestions } from "@/lib/xlsx";
import { searchKnowledge, searchMemory, type KnowledgeSearchResult } from "@/lib/meko";

// ── 3. Zod schema (identical to agents/rfp.ts) ───────────────────────────────
const questionResultSchema = z.object({
  id: z.string(),
  answer: z.string().nullable(),
  coverage: z.enum(["full", "partial", "none"]),
  confidence: z.number().min(0).max(1),
  source_ref: z.string().nullable(),
});
const batchResultSchema = z.array(questionResultSchema);

type QuestionResult = z.infer<typeof questionResultSchema>;

// ── 4. Helper: strip auth token from any error message ───────────────────────
function redactKey(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "[REDACTED_AUTH]")
    .replace(/mko_tkn_[A-Za-z0-9]+/gi, "[REDACTED_AUTH]")
    .replace(/AIza[A-Za-z0-9_\-]{35}/g, "[REDACTED_KEY]");
}

// ── 5. Gemini JSON schema cleaner (identical to lib/gemini.ts) ───────────────
function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  function sanitize(obj: Record<string, unknown>) {
    delete obj["$schema"];
    delete obj["additionalProperties"];
    delete obj["default"];
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object") sanitize(item as Record<string, unknown>);
          }
        } else {
          sanitize(val as Record<string, unknown>);
        }
      }
    }
  }
  sanitize(cloned);
  return cloned;
}

// ── 6. Build batch prompt (identical to agents/rfp.ts) ───────────────────────
function deriveCitationTitle(chunk: KnowledgeSearchResult): string {
  const firstLine = chunk.content.split("\n")[0]?.trim() ?? "";
  if (firstLine.startsWith("Section: ")) return firstLine.slice("Section: ".length).trim();
  return chunk.title || "Knowledge Doc";
}

function buildBatchPrompt(
  batch: { id: string; number: number; question: string }[],
  contexts: Map<string, KnowledgeSearchResult[]>,
): string {
  const lines: string[] = [
    'You are filling an RFP questionnaire. For each question, use ONLY the provided knowledge chunks to answer. If chunks don\'t fully answer, set coverage to "partial" or "none".',
    "",
    "Questions and their knowledge:",
  ];
  for (let i = 0; i < batch.length; i++) {
    const q = batch[i];
    const chunks = contexts.get(q.id) ?? [];
    lines.push(`\n[Q${i + 1}] ID: ${q.id}`);
    lines.push(`Question: "${q.question}"`);
    lines.push("Knowledge chunks:");
    if (chunks.length > 0) {
      for (const chunk of chunks) {
        const title = deriveCitationTitle(chunk);
        lines.push(`- [${title}] ref:${chunk.ref}`);
        lines.push(`  "${chunk.content.slice(0, 500)}"`);
      }
    } else {
      lines.push("  (no knowledge chunks found)");
    }
  }
  lines.push(
    '\nReturn a JSON array of objects with fields: id (string), answer (string or null), coverage ("full"|"partial"|"none"), confidence (0-1), source_ref (string or null).',
  );
  return lines.join("\n");
}

// ── 7. Direct Gemini call (captures raw text before any parsing) ──────────────
async function callGeminiRaw(prompt: string): Promise<{ rawText: string | null; error: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { rawText: null, error: "GEMINI_API_KEY is not set in .env.local" };

  const modelName = process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite";
  const ai = new GoogleGenAI({ apiKey });

  const rawSchema = zodToJsonSchema(batchResultSchema as any, "plexus_response");
  const jsonSchema = cleanJsonSchema(
    (rawSchema.definitions?.plexus_response as Record<string, unknown>) || rawSchema,
  );

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: jsonSchema as any,
      },
    });
    const text = response.text ?? null;
    if (!text) return { rawText: null, error: "Gemini returned empty text (no content)" };
    return { rawText: text, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rawText: null, error: redactKey(msg) };
  }
}

// ── 8. Main debug run ─────────────────────────────────────────────────────────
async function main() {
  const meridianPath = path.resolve(process.cwd(), "data", "meridian.xlsx");
  const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD ?? "0.85");

  console.log("=".repeat(70));
  console.log("RFP DEBUG — first batch (10 questions) only");
  console.log(`GEMINI_MODEL_FAST : ${process.env.GEMINI_MODEL_FAST ?? "(not set)"}`);
  console.log(`CONFIDENCE_THRESHOLD: ${CONFIDENCE_THRESHOLD}`);
  console.log(`MEKO_MCP_URL      : ${process.env.MEKO_MCP_URL ?? "(not set)"}`);
  console.log(`MEKO_DATAPACK_ID  : ${process.env.MEKO_DATAPACK_ID ?? "(not set)"}`);
  console.log(`DEMO_MODE         : ${process.env.DEMO_MODE ?? "false"}`);
  console.log("=".repeat(70));

  // Read first 10 questions
  const all = await readQuestions(meridianPath);
  const batch = all.slice(0, 10);
  console.log(`\nLoaded ${all.length} questions total. Debugging batch: Q${batch[0]?.number}–Q${batch[batch.length - 1]?.number}\n`);

  // ── (a) Per-question: fetch knowledge + memory, print chunk info ───────────
  const knowledgeMap = new Map<string, KnowledgeSearchResult[]>();

  console.log("─".repeat(70));
  console.log("(a) RETRIEVAL — knowledge chunks per question");
  console.log("─".repeat(70));

  for (const q of batch) {
    let chunks: KnowledgeSearchResult[] = [];
    let retrievalError: string | null = null;
    try {
      // Deliberately bypass withReplay so we always hit the real service in debug
      chunks = await searchKnowledge("plexus_rfp", q.question);
    } catch (err: unknown) {
      retrievalError = redactKey(err instanceof Error ? err.message : String(err));
    }
    knowledgeMap.set(q.id, chunks);

    const topChunk = chunks[0];
    const topPreview = topChunk
      ? (topChunk.content.slice(0, 80).replace(/\n/g, " ") + (topChunk.content.length > 80 ? "…" : ""))
      : "(none)";

    console.log(`Q${q.number} [id=${q.id}]`);
    console.log(`  chunks: ${chunks.length}${retrievalError ? ` [RETRIEVAL ERROR: ${retrievalError}]` : ""}`);
    console.log(`  top chunk preview: ${topPreview}`);

    // Also check memory for RFP_FIX entries
    let memHits = 0;
    try {
      const mems = await searchMemory("plexus_rfp", `RFP_FIX ${q.question}`);
      memHits = mems.filter((m) => m.text?.startsWith("RFP_FIX")).length;
    } catch {
      // ignore
    }
    if (memHits > 0) console.log(`  memory fixes found: ${memHits}`);
  }

  // ── (b) Gemini raw response ────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("(b) GEMINI CALL — raw response or error");
  console.log("─".repeat(70));

  const prompt = buildBatchPrompt(batch, knowledgeMap);
  console.log(`Prompt length: ${prompt.length} chars`);

  const { rawText, error: geminiError } = await callGeminiRaw(prompt);

  let parsedResults: QuestionResult[] | null = null;
  let parseError: string | null = null;
  let zodError: string | null = null;

  if (geminiError) {
    console.log(`\n[GEMINI ERROR] ${geminiError}`);
  } else if (rawText) {
    const preview = rawText.slice(0, 1500) + (rawText.length > 1500 ? `… [+${rawText.length - 1500} chars]` : "");
    console.log(`\nRaw response (${rawText.length} chars):\n${preview}`);

    // Try parsing
    try {
      const json = JSON.parse(rawText) as unknown;
      const validation = batchResultSchema.safeParse(json);
      if (validation.success) {
        parsedResults = validation.data;
        console.log(`\n[PARSE OK] Zod validation passed. Got ${parsedResults.length} results.`);
      } else {
        zodError = JSON.stringify(validation.error.format(), null, 2);
        // Try to keep the raw parsed JSON for inspection
        parsedResults = Array.isArray(json)
          ? (json as QuestionResult[])
          : null;
        console.log(`\n[ZOD ERROR] Schema validation failed:\n${zodError}`);
      }
    } catch (e: unknown) {
      parseError = e instanceof Error ? e.message : String(e);
      console.log(`\n[JSON PARSE ERROR] ${parseError}`);
    }
  }

  // ── (c) Per-row decision ───────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("(c) PER-ROW — coverage / confidence / status / flag reason");
  console.log("─".repeat(70));

  if (!parsedResults) {
    console.log("No parsed results — all rows flagged due to Gemini/parse failure.");
    const rootCause = geminiError
      ? `Gemini call failed: ${geminiError}`
      : parseError
        ? `JSON parse failed: ${parseError}`
        : zodError
          ? `Zod validation failed`
          : "Unknown";
    for (const q of batch) {
      console.log(`Q${q.number}: coverage=n/a  confidence=0  status=flagged  reason="${rootCause}"`);
    }
  } else {
    const resultMap = new Map<string, QuestionResult>();
    for (const r of parsedResults) resultMap.set(r.id, r);

    for (const q of batch) {
      const r = resultMap.get(q.id);
      if (!r) {
        console.log(
          `Q${q.number} [id=${q.id}]: [NOT IN MODEL RESPONSE] status=flagged  reason="id '${q.id}' missing from model output"`,
        );
        continue;
      }

      const isFilled = r.coverage === "full" && r.confidence >= CONFIDENCE_THRESHOLD;
      const status = isFilled ? "filled" : "flagged";

      let reason = "";
      if (status === "flagged") {
        const parts: string[] = [];
        if (r.coverage !== "full") parts.push(`coverage="${r.coverage}" (need "full")`);
        if (r.confidence < CONFIDENCE_THRESHOLD)
          parts.push(`confidence=${r.confidence.toFixed(3)} < threshold ${CONFIDENCE_THRESHOLD}`);
        if (knowledgeMap.get(q.id)?.length === 0)
          parts.push("no knowledge chunks were retrieved");
        reason = parts.join("; ");
      }

      console.log(
        `Q${q.number}: coverage="${r.coverage}"  confidence=${r.confidence.toFixed(3)}` +
          `  status=${status}` +
          (reason ? `  reason="${reason}"` : ""),
      );
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("DIAGNOSIS SUMMARY");
  console.log("=".repeat(70));

  const totalChunks = batch.reduce((s, q) => s + (knowledgeMap.get(q.id)?.length ?? 0), 0);
  const emptyChunks = batch.filter((q) => (knowledgeMap.get(q.id)?.length ?? 0) === 0).length;

  console.log(`Retrieval:  ${totalChunks} total chunks across ${batch.length} questions; ${emptyChunks} questions with zero chunks`);
  console.log(`Gemini:     ${geminiError ? "FAILED — " + geminiError : rawText ? "OK (" + rawText.length + " chars)" : "no response"}`);
  console.log(`JSON parse: ${parseError ? "FAILED — " + parseError : parsedResults ? "OK" : "n/a"}`);
  console.log(`Zod schema: ${zodError ? "FAILED" : parsedResults ? "OK" : "n/a"}`);
  if (parsedResults) {
    const filledCount = parsedResults.filter(
      (r) => r.coverage === "full" && r.confidence >= CONFIDENCE_THRESHOLD,
    ).length;
    const coverageNone = parsedResults.filter((r) => r.coverage === "none").length;
    const coveragePartial = parsedResults.filter((r) => r.coverage === "partial").length;
    const belowThreshold = parsedResults.filter(
      (r) => r.coverage === "full" && r.confidence < CONFIDENCE_THRESHOLD,
    ).length;
    console.log(`Threshold:  ${filledCount} would fill; ${coverageNone} coverage=none; ${coveragePartial} coverage=partial; ${belowThreshold} full-but-low-confidence`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[FATAL]", msg.replace(/mko_tkn_[A-Za-z0-9]+/gi, "[REDACTED_AUTH]"));
  process.exit(1);
});
