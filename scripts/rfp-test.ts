// Run: pnpm tsx scripts/rfp-test.ts
import path from "node:path";
import fs from "node:fs";
import { runRfp } from "@/agents/rfp";
import { readQuestions } from "@/lib/xlsx";
import ExcelJS from "exceljs";

type AnswerKeyRow = {
  id: number;
  question: string;
  correctAnswer: string;
  type: string;
};

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

async function readAnswerKey(filePath: string): Promise<AnswerKeyRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet("Sheet1 key (Meridian)");
  if (!ws) {
    throw new Error('Worksheet "Sheet1 key (Meridian)" not found in answer_key.xlsx');
  }

  const rows: AnswerKeyRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const vals = row.values as ExcelJS.CellValue[];
    const id = typeof vals[1] === "number" ? vals[1] : Number(vals[1]);
    const question = vals[2] != null ? String(vals[2]) : "";
    const correctAnswer = vals[3] != null ? String(vals[3]) : "";
    const type = vals[4] != null ? String(vals[4]) : "";
    if (!isNaN(id)) {
      rows.push({ id, question, correctAnswer, type });
    }
  });

  return rows;
}

function extractKeyTerms(text: string): string[] {
  // Extract numbers (including decimals, percentages), durations (e.g. "30 days"), and multi-word proper nouns
  const terms: string[] = [];

  // Numbers, percentages, durations
  const numMatches = text.match(/\b\d+(?:\.\d+)?(?:\s*%|\s+(?:day|month|year|hour|week)s?)?\b/gi);
  if (numMatches) terms.push(...numMatches.map((m) => m.toLowerCase().trim()));

  // Proper nouns (capitalized words that are not common words)
  const commonWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "is", "are", "was", "were", "be", "been", "have",
    "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "must", "that", "this", "these", "those",
    "it", "its", "we", "our", "you", "your", "they", "their", "he", "she",
    "i", "my", "what", "which", "who", "when", "where", "how", "why",
  ]);

  const properMatches = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g);
  if (properMatches) {
    for (const match of properMatches) {
      const lower = match.toLowerCase();
      if (!commonWords.has(lower) && match.length > 2) {
        terms.push(lower);
      }
    }
  }

  return terms;
}

function checkAnswerable(agentAnswer: string | null, correctAnswer: string): boolean {
  if (!agentAnswer) return false;
  const keyTerms = extractKeyTerms(correctAnswer);
  if (keyTerms.length === 0) return true; // No specific terms to check
  const lowerAgent = agentAnswer.toLowerCase();
  return keyTerms.every((term) => lowerAgent.includes(term));
}

async function main() {
  const meridianPath = path.resolve(process.cwd(), "data", "meridian.xlsx");
  const answerKeyPath = path.resolve(process.cwd(), "data", "answer_key.xlsx");

  // Step 1: Run the RFP agent
  const questionnaireId = process.env.DEMO_MODE === "true" ? "demo" : `test_${crypto.randomUUID().slice(0, 8)}`;
  console.log(`Running RFP agent on meridian.xlsx (questionnaireId: ${questionnaireId})...`);

  const rfpResult = await runRfp(questionnaireId, meridianPath);
  console.log(`filled ${rfpResult.filled}, flagged ${rfpResult.flagged}`);

  // Step 2: Load agent answers from DB
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const agentRows = db
    .prepare("SELECT * FROM rfp_questions WHERE questionnaire_id = ? ORDER BY number ASC")
    .all(questionnaireId) as RfpQuestion[];

  const agentMap = new Map<number, RfpQuestion>();
  for (const r of agentRows) {
    agentMap.set(r.number, r);
  }

  // Step 3: Read answer key
  const answerKey = await readAnswerKey(answerKeyPath);

  // Step 4: Score
  let correct = 0;
  let wronglyFilled = 0;
  let wronglyFlagged = 0;
  const wrongRows: string[] = [];

  for (const key of answerKey) {
    const agent = agentMap.get(key.id);
    if (!agent) {
      wrongRows.push(`ID ${key.id}: no agent answer found`);
      continue;
    }

    const t = key.type.trim().toLowerCase();
    if (t === "answerable") {
      // Require status===filled AND key terms present in agent answer
      if (agent.status !== "filled") {
        wronglyFlagged++;
        wrongRows.push(`ID ${key.id}: wrongly flagged (should be filled)`);
      } else {
        const answerText = agent.human_answer ?? agent.answer;
        if (checkAnswerable(answerText, key.correctAnswer)) {
          correct++;
        } else {
          wronglyFilled++;
          wrongRows.push(
            `ID ${key.id}: filled but answer missing key terms from "${key.correctAnswer.slice(0, 60)}"`,
          );
        }
      }
    } else if (t === "partial" || t === "out of scope") {
      // Require status===flagged
      if (agent.status === "flagged") {
        correct++;
      } else {
        wronglyFilled++;
        wrongRows.push(`ID ${key.id}: wrongly filled (type=${key.type}, should be flagged)`);
      }
    }
  }

  // Step 5: Print results
  const questions = await readQuestions(meridianPath);
  const total = questions.length;
  console.log(`\n--- RFP Test Results ---`);
  console.log(`filled ${rfpResult.filled}, flagged ${rfpResult.flagged}, correct ${correct}, wrongly_filled ${wronglyFilled}, wrongly_flagged ${wronglyFlagged}`);
  console.log(`total questions: ${total}`);

  if (wrongRows.length > 0) {
    console.log(`\nWrong rows:`);
    const keyMap = new Map<number, AnswerKeyRow>();
    for (const k of answerKey) {
      keyMap.set(k.id, k);
    }

    // Load fixtures to retrieve coverage, confidence, and source chunks
    const fixturesDir = path.resolve(process.cwd(), "fixtures", "rfp");
    const batchMap = new Map<
      string,
      { coverage?: string; confidence?: number; source_ref?: string | null }
    >();

    if (fs.existsSync(fixturesDir)) {
      const files = fs
        .readdirSync(fixturesDir)
        .filter(
          (f) =>
            f.startsWith(`batch_q${questionnaireId}_`) ||
            f.startsWith("batch_qdemo_") ||
            f.startsWith("batch_qtest_8b13a3ad_"),
        );
      for (const file of files) {
        try {
          const content = JSON.parse(
            fs.readFileSync(path.join(fixturesDir, file), "utf8"),
          );
          const items = Array.isArray(content)
            ? content
            : Array.isArray(content?.data)
              ? content.data
              : [];
          for (const item of items) {
            if (item?.id != null && !batchMap.has(String(item.id))) {
              batchMap.set(String(item.id), item);
            }
          }
        } catch {
          // ignore corrupted fixture files
        }
      }
    }

    function getSourceChunkPreview(id: number, sourceRef: string | null): string {
      if (!fs.existsSync(fixturesDir)) return "(no source chunk)";
      const candNames = [
        `knowledge_q${id}_${questionnaireId}.json`,
        `knowledge_q${id}_demo.json`,
        `knowledge_q${id}_test_8b13a3ad.json`,
      ];
      for (const cand of candNames) {
        const fullPath = path.join(fixturesDir, cand);
        if (fs.existsSync(fullPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
            const chunks = Array.isArray(parsed) ? parsed : [];
            if (chunks.length > 0) {
              const matched = sourceRef
                ? chunks.find((c: any) => c?.ref === sourceRef)
                : undefined;
              const target = matched || chunks[0];
              const text = target?.content || target?.text || target?.chunk_text || "";
              return text.slice(0, 200).replace(/\r?\n/g, " ");
            }
          } catch {
            // ignore
          }
        }
      }
      return "(no source chunk)";
    }

    for (const row of wrongRows) {
      console.log(`\n  ${row}`);
      const m = row.match(/^ID (\d+):/);
      if (m) {
        const id = Number(m[1]);
        const keyItem = keyMap.get(id);
        const agentItem = agentMap.get(id);
        const batchItem = batchMap.get(String(id));

        const question = keyItem?.question ?? agentItem?.question ?? "(unknown)";
        const keyAnswer = keyItem?.correctAnswer ?? "(none)";
        const agentAnswer = agentItem?.human_answer ?? agentItem?.answer ?? "(none)";
        const coverage = batchItem?.coverage ?? "(not recorded)";
        const confidence = agentItem?.confidence ?? batchItem?.confidence ?? 0;
        const sourceRef = agentItem?.source_ref ?? batchItem?.source_ref ?? null;
        const sourceChunkPreview = getSourceChunkPreview(id, sourceRef);

        console.log(`    Question:     ${question}`);
        console.log(`    Key answer:   ${keyAnswer}`);
        console.log(`    Agent answer: ${agentAnswer}`);
        console.log(`    Coverage:     ${coverage}`);
        console.log(`    Confidence:   ${confidence}`);
        console.log(`    Source chunk: ${sourceChunkPreview}`);
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
