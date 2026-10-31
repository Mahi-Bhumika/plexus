// Access agent: decides access requests from the policy table (seed/access/access_policy_table.md),
// not from what the caller says. Risk and approver always come from the policy.
//   Low risk + role allowed          -> granted at once (guard allows, Undo available)
//   Medium / High risk + role allowed -> pending_approval, waits for the policy approver
//   Role not allowed                  -> denied (for example interns and AWS production)
//   Injected or pressuring text       -> denied and logged as blocked
// Approvals also check WHO approves: the named approver (or the founder), never the requester.
import { getDb } from "@/lib/db";
import { emitEvent, newEventId } from "@/lib/events";
import { evaluate, guard, registerUndoHandler } from "@/lib/guard";

// ---- People and policy (from people_and_roles.md and access_policy_table.md) ----

type RoleKey = "founder" | "engineering_manager" | "engineer" | "intern";
type Person = { name: string; first: string; role: RoleKey; manager: string | null };

const PEOPLE: Person[] = [
  { name: "Riya Sharma", first: "riya", role: "founder", manager: null },
  { name: "Karan Malhotra", first: "karan", role: "engineering_manager", manager: "Riya Sharma" },
  { name: "Meera Iyer", first: "meera", role: "engineer", manager: "Karan Malhotra" },
  { name: "Arjun Verma", first: "arjun", role: "intern", manager: "Karan Malhotra" },
];

type Risk = "Low" | "Medium" | "High";
type Policy = {
  app: string;
  risk: Risk;
  roles: RoleKey[];
  approver: "auto" | "manager" | string; // a name means a fixed approver
  aliases: string[];
  lease?: string;
};

const ALL: RoleKey[] = ["founder", "engineering_manager", "engineer", "intern"];
const NO_INTERN: RoleKey[] = ["founder", "engineering_manager", "engineer"];

const POLICY: Policy[] = [
  { app: "Slack", risk: "Low", roles: ALL, approver: "auto", aliases: ["slack"] },
  { app: "Google Workspace", risk: "Low", roles: ALL, approver: "auto", aliases: ["google workspace", "gsuite", "g suite", "google"] },
  { app: "Figma", risk: "Low", roles: ALL, approver: "auto", aliases: ["figma"] },
  { app: "Jira", risk: "Low", roles: NO_INTERN, approver: "auto", aliases: ["jira"] },
  { app: "GitHub", risk: "Medium", roles: ALL, approver: "manager", aliases: ["github"] },
  { app: "Datadog", risk: "Medium", roles: NO_INTERN, approver: "manager", aliases: ["datadog"] },
  { app: "Payroll tool", risk: "High", roles: ["founder"], approver: "Riya Sharma", aliases: ["payroll"] },
  { app: "AWS production", risk: "High", roles: NO_INTERN, approver: "Karan Malhotra", aliases: ["aws"], lease: "8h just-in-time" },
];

const ROLE_LABEL: Record<RoleKey, string> = {
  founder: "Founder",
  engineering_manager: "Engineering Manager",
  engineer: "Engineer",
  intern: "Intern",
};

export function findPolicy(app: string | null | undefined): Policy | null {
  if (!app) return null;
  const a = app.toLowerCase();
  return POLICY.find((p) => p.app.toLowerCase() === a || p.aliases.some((x) => a.includes(x))) ?? null;
}

// Apps named in free text, in the order they appear
export function appsInText(text: string): Policy[] {
  const t = text.toLowerCase();
  const hits: Array<{ p: Policy; at: number }> = [];
  for (const p of POLICY) {
    const idx = Math.min(...p.aliases.map((a) => (t.indexOf(a) >= 0 ? t.indexOf(a) : Infinity)));
    if (idx !== Infinity) hits.push({ p, at: idx });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.p);
}

export function personByName(name: string | null | undefined): Person | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return PEOPLE.find((p) => n === p.name.toLowerCase() || n.split(/\s+/)[0] === p.first) ?? null;
}

function resolvePerson(userId?: string, userName?: string): Person | null {
  if (userId) {
    try {
      const row = getDb().prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name?: string } | undefined;
      const p = personByName(row?.name);
      if (p) return p;
    } catch {
      // no users table: fall back to the name
    }
  }
  return personByName(userName);
}

// ---- Text checks that the shared injection rules might not catch ----------------

const PRESSURE_PATTERNS: Array<[string, RegExp]> = [
  ["skips_checks", /\b(no need|don'?t need|do not need|without)\b[^.]{0,30}\b(check|verify|confirm|approval|ask)/i],
  ["claims_verbal_approval", /\b(told me|said|asked me)\b[^.]{0,40}\b(corridor|in person|verbally|on the phone|boarding|flight)/i],
  ["asks_for_admin_everywhere", /\b(admin|root|full access)\b[^.]{0,20}\b(everything|all systems|every)/i],
];

export function pressureReasons(text: string): string[] {
  return PRESSURE_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ---- Types ---------------------------------------------------------------------

export type AccessRequestRow = {
  id: string;
  user_id: string;
  app: string;
  risk: string;
  status: string; // 'granted' | 'pending_approval' | 'denied' | 'undone'
  approver_id: string;
  requested_at: string;
  decided_at: string | null;
};

export type AccessInput = {
  userId?: string;
  userName?: string;
  app?: string;
  justification?: string;
  text?: string; // raw Slack message, when the request came from Slack
  // risk and approverId are accepted for backward compatibility and IGNORED
  risk?: string;
  approverId?: string;
};

export type AccessOutcome = {
  request: AccessRequestRow;
  decision: "allow" | "needs_approval" | "block";
  reasons: string[];
  eventId: string | null;
  approver: string | null;
  message: string;
};

export class AccessError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

function strs(...xs: Array<string | null | undefined>): string[] {
  return xs.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

const SOURCES = [{ title: "Access Policy", ref: "doc_04_access_policy" }];

function resolveApprover(policy: Policy, person: Person): string | null {
  if (person.role === "founder") return null; // nobody above the founder
  if (policy.approver === "auto") return null;
  if (policy.approver === "manager") return person.manager;
  // fixed approver; a request from the approver goes to their own manager
  return policy.approver === person.name ? person.manager : policy.approver;
}

function insertRow(row: AccessRequestRow): void {
  getDb()
    .prepare(
      `INSERT INTO access_requests (id, user_id, app, risk, status, approver_id, requested_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.user_id, row.app, row.risk, row.status, row.approver_id, row.requested_at, row.decided_at);
}

function blockedEvent(action: string): string {
  const id = newEventId();
  emitEvent({
    id,
    timestamp: new Date().toISOString(),
    agent: "access",
    action,
    status: "blocked",
    confidence: 1,
    sources: SOURCES,
    traceId: newEventId(),
    undoable: false,
  });
  return id;
}

// ---- Create a request ------------------------------------------------------------

export function createAccessRequest(input: AccessInput): AccessOutcome {
  const now = new Date().toISOString();
  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const text = strs(input.justification, input.text).join(" ");
  const person = resolvePerson(input.userId, input.userName);
  const requester = person?.name ?? (input.userName?.trim() || "Unknown requester");

  const policy = findPolicy(input.app) ?? appsInText(`${input.app ?? ""} ${text}`)[0] ?? null;
  const appName = policy?.app ?? (input.app?.trim() || "Unknown app");
  const risk: Risk = policy?.risk ?? "Medium";
  const userKey = input.userId ?? person?.first ?? requester;

  const row = (status: string, approver: string | null, decided: boolean): AccessRequestRow => ({
    id,
    user_id: userKey,
    app: appName,
    risk,
    status,
    approver_id: approver ?? "",
    requested_at: now,
    decided_at: decided ? now : null,
  });

  const untrusted = strs(input.justification, input.text, input.app, input.userName);

  // 1. Injected or pressuring text is quarantined before any decision is made.
  const pressure = pressureReasons(text);
  const verdict = evaluate({ kind: "access_request", untrustedText: untrusted });
  if (verdict.decision === "block" || pressure.length > 0) {
    let eventId: string;
    let reasons: string[];
    const label = `Access request quarantined: ${requester} -> ${appName} (suspicious request text)`;
    if (verdict.decision === "block") {
      const g = guard({ kind: "access_request", agent: "access", label, untrustedText: untrusted, sources: SOURCES });
      eventId = g.eventId;
      reasons = [...g.reasons, ...pressure];
    } else {
      eventId = blockedEvent(label);
      reasons = pressure;
    }
    const r = row("denied", null, true);
    insertRow(r);
    return {
      request: r,
      decision: "block",
      reasons,
      eventId,
      approver: null,
      message: "Blocked: the request text tries to skip approval or claims verbal permission. Nothing was granted.",
    };
  }

  // 2. Policy: is this role allowed this app at all?
  if (person && policy && !policy.roles.includes(person.role)) {
    const reason = `${ROLE_LABEL[person.role]} is not eligible for ${appName} under the access policy`;
    const eventId = blockedEvent(`Access denied: ${requester} -> ${appName} (${reason})`);
    const r = row("denied", null, true);
    insertRow(r);
    return { request: r, decision: "block", reasons: [reason], eventId, approver: null, message: reason };
  }

  // 3. Who has to approve?
  let approver: string | null;
  const reasons: string[] = [];
  if (!person) {
    approver = "Karan Malhotra";
    reasons.push("Requester is not in the people directory");
  } else if (!policy) {
    approver = person.manager ?? "Karan Malhotra";
    reasons.push("App is not in the access policy table");
  } else {
    approver = resolveApprover(policy, person);
  }

  const lease = policy?.lease ? ` (${policy.lease})` : "";

  // 4a. Auto-grant
  if (!approver) {
    const g = guard({
      kind: "access_grant",
      agent: "access",
      label: `Access granted: ${requester} -> ${appName} (auto-approved)`,
      confidence: 1,
      untrustedText: untrusted,
      sources: SOURCES,
      undo: { kind: "access_grant", payload: { requestId: id } },
    });
    if (g.decision === "block") {
      const r = row("denied", null, true);
      insertRow(r);
      return { request: r, decision: "block", reasons: g.reasons, eventId: g.eventId, approver: null, message: "Blocked by the guard." };
    }
    if (g.decision === "allow") {
      const r = row("granted", null, true);
      insertRow(r);
      return { request: r, decision: "allow", reasons: g.reasons, eventId: g.eventId, approver: null, message: `Access granted to ${appName}.` };
    }
    // The guard wants a human for this one: fall through to approval
    approver = person?.manager ?? "Karan Malhotra";
    reasons.push(...g.reasons);
  }

  // 4b. Needs approval
  const g = guard({
    kind: "access_request",
    agent: "access",
    label: `Access requested: ${requester} -> ${appName} (${risk} risk${lease}, awaiting ${approver})`,
    confidence: 1,
    irreversible: true,
    untrustedText: untrusted,
    sources: SOURCES,
  });
  if (g.decision === "block") {
    const r = row("denied", null, true);
    insertRow(r);
    return { request: r, decision: "block", reasons: g.reasons, eventId: g.eventId, approver: null, message: "Blocked by the guard." };
  }
  const r = row("pending_approval", approver, false);
  insertRow(r);
  return {
    request: r,
    decision: "needs_approval",
    reasons: [...reasons, ...g.reasons],
    eventId: g.eventId,
    approver,
    message: `Waiting for ${approver} to approve ${appName}.`,
  };
}

// ---- Decide a pending request ----------------------------------------------------

export function decideAccessRequest(input: {
  id: string;
  decision: "granted" | "denied";
  approverName: string;
}): { status: string; eventId: string } {
  if (input.decision !== "granted" && input.decision !== "denied") {
    throw new AccessError("decision must be 'granted' or 'denied'", 400);
  }
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT ar.*, u.name AS user_name FROM access_requests ar
       LEFT JOIN users u ON u.id = ar.user_id
       WHERE ar.id = ?`,
    )
    .get(input.id) as (AccessRequestRow & { user_name: string | null }) | undefined;
  if (!existing) throw new AccessError(`Request ${input.id} not found`, 404);

  const requesterPerson = personByName(existing.user_name) ?? personByName(existing.user_id);
  const requester = requesterPerson?.name ?? existing.user_name ?? existing.user_id;

  if (existing.status !== "pending_approval") {
    throw new AccessError(`Request is already ${existing.status}; nothing to approve.`, 409);
  }

  const approver = personByName(input.approverName);
  const refuse = (why: string): never => {
    blockedEvent(`Approval refused: ${input.approverName || "unknown"} cannot decide ${requester} -> ${existing.app} (${why})`);
    throw new AccessError(why, 403);
  };
  if (!approver) refuse("approver is not a known person");
  const who = approver as Person;
  if (requesterPerson && who.name === requesterPerson.name) refuse("nobody approves their own request");
  if (who.name !== existing.approver_id && who.role !== "founder") {
    refuse(`only ${existing.approver_id || "the policy approver"} or the founder can decide this`);
  }

  const decidedAt = new Date().toISOString();

  if (input.decision === "denied") {
    const eventId = blockedEvent(`Access denied: ${requester} -> ${existing.app} by ${who.name}`);
    db.prepare("UPDATE access_requests SET status = 'denied', decided_at = ?, approver_id = ? WHERE id = ?").run(
      decidedAt,
      who.name,
      existing.id,
    );
    return { status: "denied", eventId };
  }

  const policy = findPolicy(existing.app);
  const lease = policy?.lease ? ` (${policy.lease} lease)` : "";
  const g = guard({
    kind: "access_grant",
    agent: "access",
    label: `Access approved: ${requester} -> ${existing.app} by ${who.name}${lease}`,
    actor: who.name,
    confidence: 1,
    sources: SOURCES,
    undo: { kind: "access_grant", payload: { requestId: existing.id } },
  });
  if (g.decision === "block") throw new AccessError(`Blocked by the guard: ${g.reasons.join(", ")}`, 403);

  db.prepare("UPDATE access_requests SET status = 'granted', decided_at = ?, approver_id = ? WHERE id = ?").run(
    decidedAt,
    who.name,
    existing.id,
  );
  return { status: "granted", eventId: g.eventId };
}

// ---- Undo ---------------------------------------------------------------------------
// Reverses a grant (auto or approved): the request goes back to 'undone'.
registerUndoHandler("access_grant", (payload) => {
  const { requestId } = payload as { requestId: string };
  getDb()
    .prepare("UPDATE access_requests SET status = 'undone', decided_at = ? WHERE id = ?")
    .run(new Date().toISOString(), requestId);
});
