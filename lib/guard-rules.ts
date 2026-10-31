// Guard layer, pure rules (no database, no network). Safe to unit test.
//   1. checkInjection    text from receipts, RFP cells or documents that tries to give the AI orders
//   2. confidenceGate    low-confidence output goes to a person instead of being acted on
//   3. approvalRule      who must approve an action; nobody approves their own
//   4. guardAction       combines the three into one verdict: allow, needs_approval or block

export type Decision = "allow" | "needs_approval" | "block";

// ---- 1. Injection check ------------------------------------------------

const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  [
    "ignore_instructions",
    /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|polic(?:y|ies)|guidelines?|checks?)\b/i,
  ],
  ["role_override", /\b(you are now|from now on,? you|pretend to be|act as (?:an?|the)\b)/i],
  [
    "prompt_leak",
    /\b(reveal|print|repeat|output|disclose)\b[^.\n]{0,30}\b(system prompt|your prompt|your instructions|hidden instructions|api key|secret)/i,
  ],
  [
    "force_approval",
    /\b(approve|mark|set|treat|flag)\b[^.\n]{0,25}\b(this|it|all|these|the claim)\b[^.\n]{0,25}\b(?:as )?(approved|ok|compliant|valid|paid|safe)\b/i,
  ],
  [
    "skip_checks",
    /\b(skip|bypass|disable|turn off)\b[^.\n]{0,30}\b(checks?|review|approval|validation|polic(?:y|ies)|audit|guard)/i,
  ],
  ["fake_markup", /<\/?\s*(system|assistant|instructions?|prompt)\s*>|\[\/?(?:INST|SYS)\]|^\s*(?:system|assistant)\s*:/im],
  [
    "exfiltrate",
    /\b(send|email|forward|post|upload)\b[^.\n]{0,40}\b(?:to|at)\b[^.\n]{0,40}(?:https?:\/\/|@[a-z0-9.-]+\.[a-z]{2,})/i,
  ],
];

// Zero-width and bidi control characters: invisible to a person, readable by a model.
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

export type InjectionResult = { flagged: boolean; matches: string[] };

export function checkInjection(...texts: Array<string | null | undefined>): InjectionResult {
  const joined = texts.filter((t): t is string => typeof t === "string" && t.length > 0).join("\n");
  const matches: string[] = [];
  if (!joined) return { flagged: false, matches };
  if (HIDDEN_CHARS.test(joined)) matches.push("hidden_characters");
  for (const [name, re] of INJECTION_PATTERNS) if (re.test(joined)) matches.push(name);
  return { flagged: matches.length > 0, matches };
}

// ---- 2. Confidence gate -----------------------------------------------

export function confidenceThreshold(): number {
  const v = parseFloat(process.env.CONFIDENCE_THRESHOLD ?? "0.85");
  return Number.isFinite(v) ? v : 0.85;
}

export function confidenceGate(confidence: number | null | undefined): { pass: boolean; reason: string | null } {
  const threshold = confidenceThreshold();
  if (confidence == null || Number.isNaN(confidence)) {
    return { pass: false, reason: "No confidence score was given, so a person must check it." };
  }
  if (confidence < threshold) {
    return {
      pass: false,
      reason: `Confidence ${confidence.toFixed(2)} is under the ${threshold} threshold; a person must check it.`,
    };
  }
  return { pass: true, reason: null };
}

// ---- 3. Approval rule -------------------------------------------------

const KARAN = "Karan Malhotra";
const RIYA = "Riya Sharma";
const APPROVER_LIMIT = 25000; // same routing as the expense policy

export type GuardAction = {
  kind: string; // e.g. "expense_approve", "access_grant", "email_send", "saas_cancel"
  amount?: number | null; // rupees, when money is involved
  actor?: string | null; // the person the action is for or on behalf of
  irreversible?: boolean; // cannot be undone
  external?: boolean; // leaves the company (email, vendor, customer)
};

export type ApprovalResult = { required: boolean; approver: string | null; reasons: string[] };

export function approvalRule(a: GuardAction): ApprovalResult {
  const reasons: string[] = [];
  if (a.irreversible) reasons.push("This action cannot be undone.");
  if (a.external) reasons.push("This action goes outside the company.");
  if ((a.amount ?? 0) > 0) reasons.push(`Money is involved (Rs ${Math.round(a.amount!).toLocaleString("en-IN")}).`);
  if (reasons.length === 0) return { required: false, approver: null, reasons };

  // Up to Rs 25,000 Karan approves, above that Riya; nobody approves their own.
  const amount = a.amount ?? 0;
  let approver: string | null;
  if (amount > APPROVER_LIMIT) {
    approver = a.actor === RIYA ? null : RIYA;
  } else {
    approver = a.actor === KARAN ? RIYA : KARAN;
  }
  if (approver === null) reasons.push("No eligible approver (nobody approves their own claim); escalate.");
  return { required: true, approver, reasons };
}

// ---- 4. Combined verdict -----------------------------------------------

export type GuardInput = GuardAction & {
  untrustedText?: Array<string | null | undefined>; // anything read from a receipt, cell, email or document
  confidence?: number | null; // omit for actions that have no model confidence
};

export type GuardVerdict = {
  decision: Decision;
  approver: string | null;
  reasons: string[];
  injection: InjectionResult;
};

export function evaluate(input: GuardInput): GuardVerdict {
  const injection = checkInjection(...(input.untrustedText ?? []));
  const reasons: string[] = [];

  if (injection.flagged) {
    reasons.push(`Possible prompt injection in the input (${injection.matches.join(", ")}). Blocked.`);
    return { decision: "block", approver: null, reasons, injection };
  }

  let decision: Decision = "allow";
  if (input.confidence !== undefined) {
    const gate = confidenceGate(input.confidence);
    if (!gate.pass && gate.reason) {
      reasons.push(gate.reason);
      decision = "needs_approval";
    }
  }
  const rule = approvalRule(input);
  if (rule.required) {
    reasons.push(...rule.reasons);
    decision = "needs_approval";
  }
  // Prefer the rule's approver; low confidence alone still needs someone, so route by the same rule.
  const approver = decision === "needs_approval" ? (rule.required ? rule.approver : approvalRule({ ...input, irreversible: true }).approver) : null;
  return { decision, approver, reasons, injection };
}