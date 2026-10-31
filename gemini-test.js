// gemini-test.js: THROWAWAY test. Delete after Friday. No npm install needed (Node 20+).
//
// Windows PowerShell, in the folder with this file:
//   $env:GEMINI_API_KEY = "paste-your-key-here"
//   node gemini-test.js models                  <- lists model names your key can use
//   $env:GEMINI_MODEL = "model-name-from-list"
//   node gemini-test.js                          <- runs the test 5 times
// Optional: $env:RUNS = "8"   (number of runs)
//
// What it checks: 10 questions in ONE call, reply forced into a JSON schema,
// answers only from the given context, unanswerable questions flagged.

const KEY = process.env.GEMINI_API_KEY;
const MODEL = (process.env.GEMINI_MODEL || "").replace(/^models\//, "");
const RUNS = Number(process.env.RUNS || 5);
const THRESHOLD = 0.85;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

if (!KEY) {
  console.error('Set your key first:  $env:GEMINI_API_KEY = "your-key"');
  process.exit(1);
}

const CONTEXT = [
  "D1: Nimbus Labs encrypts customer data at rest with AES-256 and in transit with TLS 1.2 or higher.",
  "D2: Multi-factor authentication is required for all employees on every company system.",
  "D3: Customer data backups run daily and are retained for 30 days.",
  "D4: Nimbus Labs notifies affected customers of a security incident within 72 hours of confirming it.",
  "D5: An independent penetration test is performed once a year.",
  "D6: Employee access is removed within 24 hours of an employee leaving the company.",
  "D7: Customer data is hosted in the Mumbai region of the cloud provider.",
  "D8: Production access requires manager approval and is reviewed every quarter.",
].join("\n");

// expect: regex the answer must match, or null if the question is NOT answerable from the context
const QUESTIONS = [
  { id: 1, q: "How is customer data encrypted at rest?", expect: /AES-?256/i },
  { id: 2, q: "What minimum TLS version is used for data in transit?", expect: /1\.2/ },
  { id: 3, q: "Is multi-factor authentication required for employees?", expect: /yes|required|mfa|multi-factor/i },
  { id: 4, q: "How long are backups retained?", expect: /30/ },
  { id: 5, q: "How quickly do you notify customers of a security incident?", expect: /72/ },
  { id: 6, q: "How often is penetration testing performed?", expect: /annual|once a year|yearly|every year/i },
  { id: 7, q: "How fast is access removed when an employee leaves?", expect: /24/ },
  { id: 8, q: "Where is customer data hosted?", expect: /mumbai/i },
  { id: 9, q: "Do you hold ISO 27001 certification?", expect: null },
  { id: 10, q: "What is your uptime SLA percentage?", expect: null },
];

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "INTEGER" },
      answer: { type: "STRING" },
      confidence: { type: "NUMBER" },
      source: { type: "STRING" },
    },
    required: ["id", "answer", "confidence", "source"],
  },
};

const PROMPT =
  "You answer security questionnaire questions for Nimbus Labs.\n" +
  "Use ONLY the CONTEXT below. Never use outside knowledge.\n" +
  "If the context does not contain the answer, set answer to an empty string, confidence to 0 and source to \"none\".\n" +
  "confidence is a number from 0 to 1 for how well the context supports your answer.\n" +
  "source is the id of the context line you used, for example \"D3\".\n" +
  "Return exactly one result per question, using the same id.\n\n" +
  "CONTEXT:\n" + CONTEXT + "\n\nQUESTIONS:\n" +
  QUESTIONS.map((x) => x.id + ". " + x.q).join("\n");

async function listModels() {
  const res = await fetch(BASE + "/models?pageSize=200", { headers: { "x-goog-api-key": KEY } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("HTTP " + res.status, JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }
  const names = (body.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  console.log("Models that support generateContent for your key:\n  " + names.join("\n  "));
  console.log('\nPick one, then:  $env:GEMINI_MODEL = "<name>"');
}

async function callOnce() {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(BASE + "/models/" + MODEL + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    return { status: "network error", ms: Date.now() - t0, error: String(e.message || e) };
  }
  return { status: res.status, ms: Date.now() - t0, body };
}

function score(parsed) {
  // returns { schemaOk, autoFilled, flagged, autoCorrect, expectedOk }
  const byId = new Map();
  for (const r of parsed) byId.set(r.id, r);
  const schemaOk =
    Array.isArray(parsed) &&
    parsed.length === QUESTIONS.length &&
    QUESTIONS.every((x) => {
      const r = byId.get(x.id);
      return r && typeof r.answer === "string" && typeof r.confidence === "number" &&
             r.confidence >= 0 && r.confidence <= 1 && typeof r.source === "string";
    });
  let autoFilled = 0, flagged = 0, autoCorrect = 0, expectedOk = 0;
  for (const x of QUESTIONS) {
    const r = byId.get(x.id);
    if (!r) { flagged++; continue; }
    const isAuto = r.answer.trim() !== "" && r.confidence >= THRESHOLD;
    if (isAuto) autoFilled++; else flagged++;
    if (x.expect === null) { if (!isAuto) expectedOk++; }
    else if (isAuto && x.expect.test(r.answer)) { autoCorrect++; expectedOk++; }
  }
  return { schemaOk, autoFilled, flagged, autoCorrect, expectedOk };
}

async function main() {
  if (process.argv[2] === "models") return listModels();
  if (!MODEL) {
    console.error('Set a model first. Run "node gemini-test.js models" to see names, then:\n  $env:GEMINI_MODEL = "<name>"');
    process.exit(1);
  }
  console.log("Model: " + MODEL + " | runs: " + RUNS + " | 10 questions per call | threshold " + THRESHOLD + "\n");
  const rows = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await callOnce();
    const row = { run: i, status: r.status, secs: (r.ms / 1000).toFixed(1), json: "-", schema: "-", auto: "-", flagged: "-", correct: "-", tokens: "-" };
    if (r.status === 200) {
      const text = r.body && r.body.candidates && r.body.candidates[0] &&
                   r.body.candidates[0].content && r.body.candidates[0].content.parts &&
                   r.body.candidates[0].content.parts.map((p) => p.text || "").join("");
      row.tokens = (r.body.usageMetadata && r.body.usageMetadata.totalTokenCount) || "?";
      try {
        const parsed = JSON.parse(text);
        row.json = "ok";
        const s = score(parsed);
        row.schema = s.schemaOk ? "ok" : "BAD";
        row.auto = s.autoFilled;
        row.flagged = s.flagged;
        row.correct = s.autoCorrect + "/" + s.autoFilled + " auto, " + s.expectedOk + "/10 as expected";
      } catch (e) {
        row.json = "FAILED";
        console.log("Run " + i + " raw reply (first 300 chars): " + String(text).slice(0, 300));
      }
    } else {
      const msg = r.error || (r.body && r.body.error && r.body.error.message) || JSON.stringify(r.body).slice(0, 200);
      console.log("Run " + i + " HTTP " + r.status + ": " + String(msg).slice(0, 300));
    }
    rows.push(row);
  }
  console.table(rows);
  const ok = rows.filter((r) => r.status === 200 && r.json === "ok" && r.schema === "ok").length;
  const limited = rows.filter((r) => r.status === 429).length;
  console.log("Clean runs: " + ok + "/" + RUNS + " | rate-limited (429): " + limited);
  console.log("Pass = at least 4 of 5 clean, and unanswerable questions 9 and 10 flagged every time.");
}

main();
