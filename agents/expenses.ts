import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { generateJson, type GeminiImage } from "@/lib/gemini";
import { withReplay } from "@/lib/replay";
import { emitEvent, newEventId, type AgentName } from "@/lib/events";
import { getDb } from "@/lib/db";
import { checkInjection } from "@/lib/guard-rules";

// ZeroTouch Expenses: receipt image -> Gemini vision -> policy check -> card match.
// The policy rules below are plain code (not an LLM) so the verdict is repeatable.
// Source of truth: seed/finance/expense_policy.md (Nimbus Labs Expense Policy v1.1).

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD ?? "0.85");

const AGENT: AgentName = "finance";

// ---- Types -------------------------------------------------------------

const EXPENSE_TYPES = [
  "local_travel",
  "auto_rickshaw",
  "domestic_flight",
  "train",
  "hotel",
  "meal",
  "team_lunch",
  "software",
  "office_supplies",
  "client_entertainment",
  "other",
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

// What Gemini FAST returns is sloppy: it leaves keys out, sends null inside lists and
// sometimes picks a value outside the enum. This schema accepts all of that and
// normalizeExtraction() below turns it into the strict Extraction the policy code uses.
// (No transforms here on purpose, so the schema can still be turned into a JSON schema.)
const numOrNull = z.number().nullish().catch(null);
const strOrNull = z.string().nullish().catch(null);

export const extractionSchema = z.object({
  merchant: strOrNull,
  date: strOrNull, // YYYY-MM-DD
  invoice_number: strOrNull,
  expense_type: z.enum(EXPENSE_TYPES).catch("other"),
  items: z.array(z.unknown()).catch([]),
  subtotal: numOrNull,
  gst: numOrNull,
  total: numOrNull,
  covers: numOrNull, // people on a restaurant bill
  meal_type: z.enum(["breakfast", "lunch", "dinner", "unknown"]).catch("unknown"),
  nights: numOrNull, // hotel stays
  city: strOrNull, // hotel or travel city
  travel_class: strOrNull, // flight or train class as printed
  trip_type: z.enum(["one_way", "round_trip", "unknown"]).catch("unknown"),
  confidence: z.number().min(0).max(1).catch(0.5), // missing or invalid -> flagged for review
});
export type RawExtraction = z.infer<typeof extractionSchema>;

export type Extraction = {
  merchant: string | null;
  date: string | null;
  invoice_number: string | null;
  expense_type: ExpenseType;
  items: Array<{ description: string; amount: number | null }>;
  subtotal: number | null;
  gst: number | null;
  total: number | null;
  covers: number | null;
  meal_type: "breakfast" | "lunch" | "dinner" | "unknown";
  nights: number | null;
  city: string | null;
  travel_class: string | null;
  trip_type: "one_way" | "round_trip" | "unknown";
  confidence: number;
};

export function normalizeExtraction(raw: RawExtraction): Extraction {
  const items: Extraction["items"] = [];
  for (const it of raw.items) {
    if (typeof it === "string") {
      if (it.trim()) items.push({ description: it.trim(), amount: null });
    } else if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const description = typeof o.description === "string" ? o.description : "";
      const amount = typeof o.amount === "number" ? o.amount : null;
      if (description || amount != null) items.push({ description, amount });
    }
    // null and anything else is dropped
  }
  return {
    merchant: raw.merchant ?? null,
    date: raw.date ?? null,
    invoice_number: raw.invoice_number ?? null,
    expense_type: raw.expense_type,
    items,
    subtotal: raw.subtotal ?? null,
    gst: raw.gst ?? null,
    total: raw.total ?? null,
    covers: raw.covers ?? null,
    meal_type: raw.meal_type,
    nights: raw.nights ?? null,
    city: raw.city ?? null,
    travel_class: raw.travel_class ?? null,
    trip_type: raw.trip_type,
    confidence: raw.confidence,
  };
}

export type IssueSeverity = "violation" | "warning";
export type Issue = { code: string; severity: IssueSeverity; message: string };

export type ClaimStatus = "ok" | "violation" | "review";

export type CardTxn = {
  txn_id: string;
  date: string;
  merchant: string;
  amount_inr: number;
  card_holder: string;
  category: string;
  receipt_ref: string | null;
};

export type ExpenseResult = {
  id: string; // receipt file name
  file: string;
  extraction: Extraction | null;
  extractionError: string | null;
  type: ExpenseType | null;
  claimant: string | null;
  card: { txn_id: string; matchedBy: "receipt_ref" | "amount_date" } | null;
  total: number | null;
  allowedAmount: number | null; // what policy lets us approve
  approvedAmount: number | null;
  approver: string | null;
  status: ClaimStatus;
  issues: Issue[];
  confidence: number;
};

export type ExpenseReport = {
  asOf: string;
  receipts: ExpenseResult[];
  unmatchedTransactions: Array<CardTxn & { daysLeft: number }>;
  totals: { claimed: number; approved: number; violations: number; needsReview: number };
};

// ---- Policy rules (from expense_policy.md) ------------------------------

const LIMITS = {
  localRide: 1500,
  autoNoReceipt: 200,
  flightOneWay: 8000,
  hotelMetroNight: 9000,
  hotelOtherNight: 6000,
  breakfast: 500,
  lunch: 800,
  dinner: 1500,
  teamLunchPerPerson: 800,
  softwarePerMonth: 5000,
  officeSupplies: 5000,
  approverLimit: 25000,
  claimWindowDays: 15,
};
const METRO = /mumbai|bombay|delhi|bengaluru|bangalore/i;
const KARAN = "Karan Malhotra";
const RIYA = "Riya Sharma";

const DAY_MS = 24 * 60 * 60 * 1000;

export function asOfDate(): Date {
  const raw = process.env.EXPENSES_AS_OF ?? process.env.ZOMBIE_AS_OF;
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) ? d : new Date();
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

function inr(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function typeFromCardCategory(cat: string): ExpenseType | null {
  const c = cat.toLowerCase();
  if (c.includes("team lunch")) return "team_lunch";
  if (c.includes("local travel")) return "local_travel";
  if (c.includes("flight")) return "domestic_flight";
  if (c.includes("hotel")) return "hotel";
  if (c.includes("meal")) return "meal";
  if (c.includes("software")) return "software";
  if (c.includes("office")) return "office_supplies";
  if (c.includes("entertain")) return "client_entertainment";
  return null;
}

type PolicyContext = {
  type: ExpenseType;
  claimant: string | null;
  cardTxns: CardTxn[]; // whole card feed, for the monthly software total
  seenInvoices: Map<string, string>; // invoice number -> first file that used it
  file: string;
  asOf: Date;
};

export function checkPolicy(
  ex: Extraction,
  ctx: PolicyContext,
): { issues: Issue[]; allowed: number | null } {
  const issues: Issue[] = [];
  const total = ex.total;
  let allowed: number | null = total;

  const violation = (code: string, message: string) =>
    issues.push({ code, severity: "violation", message });
  const warning = (code: string, message: string) =>
    issues.push({ code, severity: "warning", message });

  // Receipt basics: merchant, date, GST split and total
  if (total == null) violation("no_total", "No total could be read from the receipt.");
  if (!ex.merchant) warning("no_merchant", "Merchant name is missing from the receipt.");
  if (!ex.date) warning("no_date", "Date is missing from the receipt.");
  if (ex.gst == null) warning("no_gst", "No GST split on the receipt (policy asks for a GST invoice).");

  // Duplicate invoice number
  if (ex.invoice_number) {
    const key = ex.invoice_number.trim().toLowerCase();
    const first = ctx.seenInvoices.get(key);
    if (first && first !== ctx.file) {
      violation(
        "duplicate_invoice",
        `Invoice ${ex.invoice_number} was already claimed (${first}). Duplicates are rejected.`,
      );
      allowed = 0;
    } else {
      ctx.seenInvoices.set(key, ctx.file);
    }
  }

  // 15-day submission window
  if (ex.date) {
    const age = daysBetween(ctx.asOf, new Date(ex.date));
    if (age > LIMITS.claimWindowDays) {
      violation("late_claim", `Submitted ${age} days after the expense; the window is ${LIMITS.claimWindowDays} days.`);
    }
  }

  if (total == null) return { issues, allowed: null };

  const cap = (limit: number, what: string) => {
    if (total > limit) {
      violation("over_limit", `${what}: ${inr(total)} is over the ${inr(limit)} limit. Approve ${inr(limit)} unless the approver signs off the excess.`);
      allowed = allowed == null ? limit : Math.min(allowed, limit);
    }
  };

  switch (ctx.type) {
    case "local_travel":
      cap(LIMITS.localRide, "Local travel ride");
      break;

    case "auto_rickshaw":
      if (total > LIMITS.autoNoReceipt) {
        warning("auto_receipt", `Auto-rickshaw fares above ${inr(LIMITS.autoNoReceipt)} need a receipt.`);
      }
      break;

    case "domestic_flight": {
      const legs = ex.trip_type === "round_trip" ? 2 : 1;
      cap(LIMITS.flightOneWay * legs, legs === 2 ? "Domestic flight (round trip)" : "Domestic flight (one way)");
      if (ex.travel_class && !/economy|^y$|^m$/i.test(ex.travel_class.trim())) {
        violation("flight_class", `Flight class is "${ex.travel_class}"; policy allows economy only.`);
      } else if (!ex.travel_class) {
        warning("flight_class_unknown", "Flight class is not shown on the receipt; economy only is allowed.");
      }
      break;
    }

    case "train":
      if (ex.travel_class && /1a|first|executive|ec\b/i.test(ex.travel_class)) {
        violation("train_class", `Train class "${ex.travel_class}" is above the AC 2-tier fare allowed.`);
      }
      break;

    case "hotel": {
      const nights = ex.nights && ex.nights > 0 ? ex.nights : 1;
      if (!ex.nights) warning("nights_unknown", "Number of nights not on the receipt; assumed 1.");
      const metro = ex.city ? METRO.test(ex.city) : false;
      if (!ex.city) warning("city_unknown", "Hotel city not on the receipt; the lower non-metro limit was applied.");
      const perNight = metro ? LIMITS.hotelMetroNight : LIMITS.hotelOtherNight;
      const limit = perNight * nights;
      const where = metro ? `metro city (${ex.city})` : `non-metro${ex.city ? ` (${ex.city})` : ""}`;
      if (total > limit) {
        violation(
          "over_limit",
          `Hotel in a ${where}: ${inr(total)} for ${nights} night${nights > 1 ? "s" : ""} is over the ${inr(perNight)} per night limit (${inr(limit)}). Approve ${inr(limit)} unless the approver signs off the excess.`,
        );
        allowed = allowed == null ? limit : Math.min(allowed, limit);
      }
      break;
    }

    case "meal": {
      if (!ex.covers || ex.covers < 1) {
        violation("covers_missing", "Number of covers is not on the bill; policy requires it for meals while travelling.");
        break;
      }
      if (ex.meal_type === "unknown") {
        warning("meal_type_unknown", "Could not tell whether this was breakfast, lunch or dinner, so the per-person limit cannot be checked.");
        break;
      }
      const perPerson = LIMITS[ex.meal_type];
      const each = total / ex.covers;
      if (each > perPerson) {
        const limit = perPerson * ex.covers;
        violation(
          "over_limit",
          `${ex.meal_type[0].toUpperCase()}${ex.meal_type.slice(1)} for ${ex.covers}: ${inr(each)} per person is over the ${inr(perPerson)} limit. Approve ${inr(limit)} unless the approver signs off the excess.`,
        );
        allowed = allowed == null ? limit : Math.min(allowed, limit);
      }
      break;
    }

    case "team_lunch": {
      if (!ex.covers || ex.covers < 1) {
        warning("covers_missing", "Number of covers is not on the bill; cannot check the per-person limit.");
        break;
      }
      const each = total / ex.covers;
      if (each > LIMITS.teamLunchPerPerson) {
        const limit = LIMITS.teamLunchPerPerson * ex.covers;
        violation("over_limit", `Team lunch: ${inr(each)} per person is over ${inr(LIMITS.teamLunchPerPerson)}. Approve ${inr(limit)} unless the approver signs off the excess.`);
        allowed = allowed == null ? limit : Math.min(allowed, limit);
      }
      break;
    }

    case "software": {
      const month = ex.date ? monthOf(ex.date) : null;
      const others = ctx.cardTxns
        .filter((t) => typeFromCardCategory(t.category) === "software" && month && monthOf(t.date) === month)
        .reduce((s, t) => s + t.amount_inr, 0);
      // The card feed already includes this purchase when it is matched; avoid double counting.
      const monthTotal = Math.max(others, total);
      if (monthTotal > LIMITS.softwarePerMonth) {
        violation(
          "needs_approval",
          `Software this month totals ${inr(monthTotal)}, above ${inr(LIMITS.softwarePerMonth)}. Needs the Engineering Manager's approval before purchase.`,
        );
      }
      break;
    }

    case "office_supplies":
      cap(LIMITS.officeSupplies, "Office supplies purchase");
      break;

    case "client_entertainment":
      violation("needs_written_approval", `Client entertainment needs prior written approval from ${RIYA}; meal limits do not apply.`);
      break;

    case "other":
      warning("category_unknown", "This does not fit a policy category; a person should review it.");
      break;
  }

  return { issues, allowed };
}

// Up to Rs 25,000 Karan approves; above that Riya. Nobody approves their own claim.
// If the claimant is unknown (no card match), return null so a person assigns the approver.
export function approverFor(amount: number | null, claimant: string | null): string | null {
  if (!claimant) return null;
  const amt = amount ?? 0;
  if (amt > LIMITS.approverLimit) {
    return claimant === RIYA ? "Escalate (no eligible approver)" : RIYA;
  }
  return claimant === KARAN ? RIYA : KARAN;
}

// ---- Card feed ---------------------------------------------------------

export function readCardFeed(): CardTxn[] {
  const rows = getDb().prepare("SELECT * FROM card_feed").all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    txn_id: String(r.txn_id ?? ""),
    date: String(r.date ?? ""),
    merchant: String(r.merchant ?? ""),
    amount_inr: Number(r.amount_inr ?? 0),
    card_holder: String(r.card_holder ?? ""),
    category: String(r.category ?? ""),
    receipt_ref: r.receipt_ref ? String(r.receipt_ref) : null,
  }));
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}

function merchantSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  for (const w of wa) if (wb.has(w)) return true;
  return false;
}

// 1) exact receipt_ref = file name; 2) same amount (within Re 1), date within 2 days.
export function matchCard(
  file: string,
  ex: Extraction | null,
  txns: CardTxn[],
  used: Set<string>,
): { txn: CardTxn; matchedBy: "receipt_ref" | "amount_date" } | null {
  const byRef = txns.find((t) => t.receipt_ref === file && !used.has(t.txn_id));
  if (byRef) return { txn: byRef, matchedBy: "receipt_ref" };
  if (!ex || ex.total == null || !ex.date) return null;
  const exDate = new Date(ex.date);
  const cands = txns.filter(
    (t) =>
      !used.has(t.txn_id) &&
      !t.receipt_ref &&
      Math.abs(t.amount_inr - ex.total!) <= 1 &&
      Math.abs(daysBetween(new Date(t.date), exDate)) <= 2 &&
      (ex.merchant ? merchantSimilar(ex.merchant, t.merchant) : true),
  );
  return cands.length === 1 ? { txn: cands[0], matchedBy: "amount_date" } : null;
}

// ---- Receipt reading (Gemini vision) -----------------------------------

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function receiptsDir(): string {
  const candidates = [
    process.env.EXPENSE_RECEIPTS_DIR,
    path.join(process.cwd(), "seed", "finance", "receipts"),
    path.join(process.cwd(), "seed", "finance"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(dir) && listReceipts(dir).length > 0) return dir;
  }
  throw new Error(
    `No receipt images (receipt_*.png/jpg) found. Looked in: ${candidates.join(", ")}. Set EXPENSE_RECEIPTS_DIR.`,
  );
}

function listReceipts(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^receipt_.*\.(png|jpe?g|webp)$/i.test(f))
    .sort();
}

export const EXTRACT_PROMPT = [
  "You are reading one receipt or invoice image for an expense claim. Return only what is printed on it; never guess.",
  "Always return ALL of these keys, even when the value is unknown: merchant, date, invoice_number, expense_type, items, subtotal, gst, total, covers, meal_type, nights, city, travel_class, trip_type, confidence. Use null for a missing value and never leave a key out.",
  "merchant is the business name at the top of the receipt. invoice_number is the invoice, bill or receipt number. date is the invoice date. items is a list of objects like {\"description\": \"...\", \"amount\": 0}, with no null entries.",
  "Amounts are Indian rupees as plain numbers (no symbols or commas). Dates are YYYY-MM-DD. Use null for anything you cannot see.",
  "expense_type: local_travel (cab, ride-hailing), auto_rickshaw, domestic_flight, train, hotel, meal (restaurant bill), team_lunch, software (subscription, SaaS, domain), office_supplies, client_entertainment, or other.",
  "items: a list of objects, each with description (text) and amount (number or null), one per line item on the receipt.",
  "total is the final amount payable including GST. gst is the total tax amount if shown.",
  "covers: the number of people or covers printed on a restaurant bill, else null.",
  "meal_type: breakfast, lunch or dinner from the time printed on the bill or the menu items, else unknown.",
  "nights: nights stayed on a hotel invoice. city: the city of the hotel or service. travel_class: the fare class printed on a flight or train ticket (for example Economy). trip_type: one_way or round_trip for flights, else unknown.",
  "confidence: 0 to 1 for how sure you are that every number you returned is correct; lower it if the image is blurry or cropped.",
].join("\n");

// Errors worth waiting out: the model is busy, not wrong.
const OVERLOADED = /503|UNAVAILABLE|high demand|overloaded|429|RESOURCE_EXHAUSTED/i;
const MAX_OVERLOAD_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function extractReceipt(dir: string, file: string): Promise<Extraction | { error: string }> {
  const ext = path.extname(file).toLowerCase();
  const data = (await readFile(path.join(dir, file))).toString("base64");
  const image: GeminiImage = { mimeType: MIME[ext] ?? "image/png", data };
  const key = `expenses/receipt_${file.replace(/\.[^.]+$/, "")}`;

  const readOnce = () =>
    generateJson(extractionSchema, EXTRACT_PROMPT, { model: "FAST", images: [image], timeoutMs: 60000 });
  const filled = (e: RawExtraction) =>
    [e.merchant, e.date, e.invoice_number, e.total].filter((v) => v != null).length;

  // FAST sometimes drops merchant, date or invoice number. Read again (up to 2 more times)
  // and keep the fullest result. The best result is what gets recorded as the fixture.
  const callModel = () =>
    withReplay(key, async () => {
      let best = await readOnce();
      for (let i = 1; i <= 2; i++) {
        if (!best.success) break; // errors are handled by the retry loop below
        if (best.data.merchant && best.data.date && best.data.invoice_number) break;
        const next = await readOnce();
        if (next.success && filled(next.data) > filled(best.data)) best = next;
      }
      return best;
    });

  let res = await callModel();
  // Wait and retry when Gemini says it is busy (503 and similar): 4 s, 8 s, 12 s.
  for (let attempt = 1; attempt <= MAX_OVERLOAD_RETRIES && !res.success && OVERLOADED.test(res.error); attempt++) {
    console.warn(`  ${file}: model busy, retry ${attempt}/${MAX_OVERLOAD_RETRIES} in ${4 * attempt}s`);
    await sleep(4000 * attempt);
    res = await callModel();
  }
  return res.success ? normalizeExtraction(res.data) : { error: res.error };
}

// ---- Run ---------------------------------------------------------------

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS expense_claims (
      id TEXT PRIMARY KEY,
      run_at TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);
}

function save(results: ExpenseResult[]): void {
  ensureTable();
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO expense_claims (id, run_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET run_at = excluded.run_at, payload = excluded.payload",
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const r of results) ins.run(r.id, now, JSON.stringify(r));
  })();
}

export function getSavedClaims(): ExpenseResult[] {
  ensureTable();
  return (getDb().prepare("SELECT payload FROM expense_claims ORDER BY id").all() as Array<{ payload: string }>).map(
    (r) => JSON.parse(r.payload) as ExpenseResult,
  );
}

export function buildResult(
  file: string,
  ex: Extraction,
  txns: CardTxn[],
  used: Set<string>,
  seenInvoices: Map<string, string>,
  asOf: Date,
): ExpenseResult {
  const match = matchCard(file, ex, txns, used);
  if (match) used.add(match.txn.txn_id);

  const cardType = match ? typeFromCardCategory(match.txn.category) : null;
  const type: ExpenseType = cardType ?? ex.expense_type;
  const claimant = match?.txn.card_holder ?? null;

  const policy = checkPolicy(ex, { type, claimant, cardTxns: txns, seenInvoices, file, asOf });
  const issues = policy.issues;
  let allowed = policy.allowed;

  // Guard: text printed on a receipt must never be able to give the AI orders.
  const injection = checkInjection(ex.merchant, ex.invoice_number, ex.city, ex.travel_class, ...ex.items.map((i) => i.description));
  if (injection.flagged) {
    issues.push({
      code: "possible_injection",
      severity: "violation",
      message: `Text on the receipt looks like instructions to the AI (${injection.matches.join(", ")}). Blocked; a person must review it.`,
    });
    allowed = 0;
  }

  if (!match) {
    issues.push({ code: "no_card_match", severity: "warning", message: "No card transaction matches this receipt; treat as an out-of-pocket claim." });
  } else {
    if (ex.total != null && Math.abs(match.txn.amount_inr - ex.total) > 1) {
      issues.push({
        code: "amount_mismatch",
        severity: "violation",
        message: `Card charge ${inr(match.txn.amount_inr)} does not match the receipt total ${inr(ex.total)}.`,
      });
    }
    if (ex.date && Math.abs(daysBetween(new Date(match.txn.date), new Date(ex.date))) > 2) {
      issues.push({ code: "date_mismatch", severity: "warning", message: `Card date ${match.txn.date} differs from the receipt date ${ex.date}.` });
    }
  }
  if (ex.confidence < CONFIDENCE_THRESHOLD) {
    issues.push({
      code: "low_confidence",
      severity: "warning",
      message: `The receipt was read with confidence ${ex.confidence.toFixed(2)}, under the ${CONFIDENCE_THRESHOLD} threshold; check the numbers by hand.`,
    });
  }

  const hasViolation = issues.some((i) => i.severity === "violation");
  const hasWarning = issues.some((i) => i.severity === "warning");
  const status: ClaimStatus = hasViolation ? "violation" : hasWarning ? "review" : "ok";

  const approved = allowed == null ? null : Math.min(allowed, ex.total ?? allowed);
  return {
    id: file,
    file,
    extraction: ex,
    extractionError: null,
    type,
    claimant,
    card: match ? { txn_id: match.txn.txn_id, matchedBy: match.matchedBy } : null,
    total: ex.total,
    allowedAmount: allowed,
    approvedAmount: approved,
    approver: approverFor(ex.total, claimant),
    status,
    issues,
    confidence: ex.confidence,
  };
}

export async function runExpenses(opts: { dir?: string } = {}): Promise<ExpenseReport> {
  const dir = opts.dir ?? receiptsDir();
  const files = listReceipts(dir);
  const asOf = asOfDate();
  const txns = readCardFeed();
  if (txns.length === 0) throw new Error("card_feed is empty; run scripts/load-finance.ts first");

  // One receipt at a time: slower, but easiest on the free-tier rate limit
  const extractions: Array<Extraction | { error: string }> = [];
  for (const f of files) {
    extractions.push(await extractReceipt(dir, f));
  }

  const used = new Set<string>();
  const seenInvoices = new Map<string, string>();
  const results: ExpenseResult[] = files.map((file, i) => {
    const ex = extractions[i];
    if ("error" in ex) {
      return {
        id: file,
        file,
        extraction: null,
        extractionError: ex.error,
        type: null,
        claimant: null,
        card: null,
        total: null,
        allowedAmount: null,
        approvedAmount: null,
        approver: null,
        status: "review" as const,
        issues: [{ code: "read_failed", severity: "warning" as const, message: `The receipt could not be read: ${ex.error.slice(0, 160)}` }],
        confidence: 0,
      };
    }
    return buildResult(file, ex, txns, used, seenInvoices, asOf);
  });

  // Card transactions with no receipt: Finance chases these within 15 days
  const unmatchedTransactions = txns
    .filter((t) => !t.receipt_ref && !used.has(t.txn_id))
    .map((t) => ({ ...t, daysLeft: LIMITS.claimWindowDays - daysBetween(asOf, new Date(t.date)) }));

  const totals = {
    claimed: results.reduce((s, r) => s + (r.total ?? 0), 0),
    approved: results.reduce((s, r) => s + (r.approvedAmount ?? 0), 0),
    violations: results.filter((r) => r.status === "violation").length,
    needsReview: results.filter((r) => r.status === "review").length,
  };

  save(results);

  for (const r of results) {
    const label = r.extraction?.merchant ?? r.file;
    const first = r.issues.find((i) => i.severity === "violation") ?? r.issues[0];
    emitEvent({
      id: newEventId(),
      timestamp: new Date().toISOString(),
      agent: AGENT,
      action:
        r.status === "ok"
          ? `Expense OK: ${label} ${r.total != null ? inr(r.total) : ""} (to ${r.approver ?? "unassigned"})`
          : `Expense ${r.status === "violation" ? "violation" : "needs review"}: ${label}${first ? ` - ${first.message}` : ""}`,
      status: r.extractionError
        ? "error"
        : r.issues.some((i) => i.code === "possible_injection")
          ? "blocked"
          : r.status === "ok"
            ? "done"
            : "flagged",
      confidence: r.confidence,
      sources: [{ title: r.file, ref: r.file }],
      traceId: newEventId(),
      undoable: false,
    });
  }

  return { asOf: asOf.toISOString(), receipts: results, unmatchedTransactions, totals };
}