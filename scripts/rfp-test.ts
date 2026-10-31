// Run: pnpm tsx scripts/rfp-test.ts
import path from "node:path";
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
  const questionnaireId = `test_${crypto.randomUUID().slice(0, 8)}`;
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
    for (const row of wrongRows) {
      console.log(`  ${row}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
