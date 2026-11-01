// POST /api/chat  { message: string, role?: "founder" | "engineering manager" | "engineering" | "intern" }
// -> { status: "done", intent, reply, links?: [{label, href}] }   or   { status: "error", message }
//
// The chat detects what you asked for (see lib/chat-intent.ts) and calls the same routes and
// agents the screens use, so every action goes through the guard and shows up in the activity feed.
import fs from "node:fs";
import path from "node:path";
import { runRfp } from "@/agents/rfp";
import { evaluate, guard } from "@/lib/guard";
import { parseIntent, type Intent } from "@/lib/chat-intent";


export const maxDuration = 300;

type Link = { label: string; href: string };
type Reply = { intent: Intent; reply: string; links?: Link[] };

const ROLES = ["founder", "engineering manager", "engineering", "intern"];

// ---------- helpers ----------

type Json = Record<string, unknown>;

async function callRoute(origin: string, pathname: string, body?: Json): Promise<{ ok: boolean; data: Json }> {
  try {
    const res = await fetch(origin + pathname, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    return { ok: res.ok && data.status !== "error", data };
  } catch (e) {
    return { ok: false, data: { status: "error", message: e instanceof Error ? e.message : String(e) } };
  }
}

function errText(data: Json, fallback: string): string {
  return typeof data.message === "string" && data.message ? data.message : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function arr(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : [];
}

function lockedLine(locked: Json[]): string {
  if (locked.length === 0) return "";
  const names = locked.map((l) => str(l.title) || str(l.id)).join(", ");
  return `\n\nLocked for your role (not shown): ${names}`;
}

function findSheet(kind: "meridian" | "aegis"): string | null {
  const wanted = kind === "aegis" ? /aegis/i : /meridian/i;
  const found: string[] = [];
  for (const folder of ["data", path.join("seed", "rfp")]) {
    const dir = path.resolve(process.cwd(), folder);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.xlsx$/i.test(f) && wanted.test(f) && !/key/i.test(f) && !f.startsWith("~$")) found.push(path.join(dir, f));
    }
    if (found.length > 0) break; // prefer data/ (the sheets the tests use)
  }
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] ?? null;
}

// ---------- handlers ----------

const HELP: Reply = {
  intent: "help",
  reply: [
    "I can run these for you. Just ask in plain words:",
    "",
    '• "Catch me up on Meridian for 4 days": a briefing with sources',
    '• "Fill the RFP" (or "fill the Aegis questionnaire"): answers the sheet and flags what needs a human',
    '• "Process the kickoff transcript": tasks, a Slack post and an email draft (sending needs approval)',
    '• "Show unused SaaS tools": finds licences nobody logs in to',
    '• "Show the expenses": the receipts and what needs review',
    '• Anything else: I search the company documents, respecting your role',
  ].join("\n"),
};

async function handleCatchup(origin: string, role: string, topic: string, days: number): Promise<Reply> {
  const { ok, data } = await callRoute(origin, "/api/search/catchup", { role, topic, days });
  if (!ok) return { intent: "catchup", reply: `I couldn't build that catch-up: ${errText(data, "the search service did not answer")}` };

  const points = arr(data.points);
  const lines = [`Catch-up on ${topic}, last ${days} day${days === 1 ? "" : "s"}:`, ""];
  if (str(data.briefing)) lines.push(str(data.briefing), "");
  for (const p of points) {
    const src = str(p.source);
    lines.push(`• ${str(p.text)}${src ? `  (${src})` : ""}`);
  }
  if (points.length === 0 && !str(data.briefing)) lines.push(`I found nothing dated in the last ${days} days about "${topic}".`);
  if (data.fallback === true) lines.push("", "(Plain summary: the model was unavailable, so this is extracted text.)");
  return { intent: "catchup", reply: lines.join("\n") + lockedLine(arr(data.locked)) };
}

async function handleSearch(origin: string, role: string, message: string): Promise<Reply> {
  const { ok, data } = await callRoute(origin, "/api/search", { query: message, role });
  if (!ok) return { intent: "search", reply: `I couldn't search: ${errText(data, "the search service did not answer")}` };

  const sources = arr(data.sources);
  const lines = [str(data.answer) || "I didn't find anything about that in the documents you can access."];
  if (sources.length) {
    lines.push("", "Sources:");
    for (const s of sources.slice(0, 4)) lines.push(`• ${str(s.title)}${str(s.date) ? ` (${str(s.date)})` : ""}`);
  }
  return { intent: "search", reply: lines.join("\n") + lockedLine(arr(data.locked)) };
}

async function handleRfp(sheet: "meridian" | "aegis"): Promise<Reply> {
  const file = findSheet(sheet);
  if (!file) return { intent: "rfp", reply: `I couldn't find the ${sheet} sheet in data/ or seed/rfp.` };

  // In demo mode the recorded answers are stored under the id "demo"; live runs get a fresh id.
  const id = process.env.DEMO_MODE === "true" ? "demo" : `chat_${crypto.randomUUID().slice(0, 8)}`;
  try {
    const r = await runRfp(id, file);
    const total = r.total ?? r.filled + r.flagged;
    const label = sheet === "aegis" ? "Aegis Life" : "Meridian Bank";
    return {
      intent: "rfp",
      reply: [
        `Done: ${label} questionnaire.`,
        `Filled ${r.filled} of ${total} answers. ${r.flagged} flagged for a human to review.`,
        r.flagged > 0 ? "Flagged answers are marked red; fix one and I'll reuse the fix on the next questionnaire." : "",
      ]
        .filter(Boolean)
        .join("\n"),
      links: [{ label: "Download the filled sheet", href: `/api/rfp/${id}/download` }],
    };
  } catch (e) {
    return { intent: "rfp", reply: `The RFP run failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` };
  }
}

async function handleActionSwarm(origin: string): Promise<Reply> {
  const { ok, data } = await callRoute(origin, "/api/actionswarm", {});
  if (!ok) return { intent: "actionswarm", reply: `I couldn't process the transcript: ${errText(data, "the ActionSwarm run failed")}` };

  const tasks = arr(data.tasks);
  const quarantined = arr(data.quarantined);
  const slack = (data.slack ?? {}) as Json;
  const draft = (data.emailDraft ?? null) as Json | null;
  const lines = [`Kickoff processed. ${tasks.length} task${tasks.length === 1 ? "" : "s"} created:`, ""];
  for (const t of tasks) {
    const flag = str(t.status) === "needs_review" ? "  [needs review]" : str(t.status) === "blocked" ? "  [blocked]" : "";
    lines.push(`• ${str(t.title)} (${str(t.assignee) || "owner to confirm"}${str(t.due) ? `, due ${str(t.due)}` : ""})${flag}`);
  }
  if (quarantined.length) lines.push("", `Blocked ${quarantined.length} suspicious line${quarantined.length === 1 ? "" : "s"} in the transcript before they reached the model.`);
  if (str(slack.status)) lines.push(`Slack: ${str(slack.status)}.`);
  if (draft) lines.push(`Email draft ready: "${str(draft.subject)}". Sending needs approval.`);
  return { intent: "actionswarm", reply: lines.join("\n") };
}

async function handleZombie(origin: string): Promise<Reply> {
  const { ok, data } = await callRoute(origin, "/api/finance/zombie");
  if (!ok) return { intent: "zombie", reply: `I couldn't check the SaaS spend: ${errText(data, "no billing data loaded")}` };

  // Report field names beyond totalToolsChecked are read defensively.
  const list = Object.values(data).find((v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && ("tool" in (v[0] as Json) || "name" in (v[0] as Json))) as Json[] | undefined;
  const lines: string[] = [];
  const checked = typeof data.totalToolsChecked === "number" ? data.totalToolsChecked : undefined;
  if (list && list.length) {
    lines.push(`${list.length} unused tool${list.length === 1 ? "" : "s"}${checked ? ` out of ${checked} checked` : ""}:`, "");
    for (const t of list) {
      const cost = Object.entries(t).find(([k, v]) => /cost|inr|monthly/i.test(k) && typeof v === "number");
      lines.push(`• ${str(t.tool) || str(t.name)}${cost ? ` (Rs ${Number(cost[1]).toLocaleString("en-IN")} a month)` : ""}`);
    }
  } else {
    lines.push(`No unused tools found${checked ? ` among ${checked} checked` : ""}.`);
  }
  return { intent: "zombie", reply: lines.join("\n"), links: [{ label: "Open the SaaS report", href: "/api/finance/zombie" }] };
}

async function handleExpenses(origin: string): Promise<Reply> {
  const { ok, data } = await callRoute(origin, "/api/finance/expenses");
  if (!ok) return { intent: "expenses", reply: `I couldn't read the expenses: ${errText(data, "the finance service did not answer")}` };

  const receipts = arr(data.receipts);
  if (receipts.length === 0) {
    return { intent: "expenses", reply: "No receipts have been processed yet. Run the expense check from the Finance screen first." };
  }
  const lines = [`${receipts.length} receipt${receipts.length === 1 ? "" : "s"} on file:`, ""];
  for (const r of receipts) {
    const total = typeof r.total === "number" ? ` Rs ${r.total.toLocaleString("en-IN")}` : "";
    const approver = str(r.approver) ? `, approver ${str(r.approver)}` : "";
    lines.push(`• ${str(r.merchant) || str(r.id) || "receipt"}${total}${approver}`);
  }
  return { intent: "expenses", reply: lines.join("\n") };
}

function handleAccess(): Reply {
  return {
    intent: "access",
    reply: "Access requests go through the Access screen so the right manager can approve them with a full audit trail. Open it and request the app there.",
  };
}

// ---------- route ----------

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { message?: unknown; role?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return Response.json({ status: "error", message: "message is required" }, { status: 400 });
    if (message.length > 600) return Response.json({ status: "error", message: "message is too long (600 characters max)" }, { status: 400 });
    const role = typeof body.role === "string" && ROLES.includes(body.role.toLowerCase()) ? body.role.toLowerCase() : "founder";

    // Chat text is untrusted: block attempts to override the rules before doing anything.
    if (evaluate({ kind: "chat_message", untrustedText: [message] }).decision === "block") {
      guard({ kind: "chat_message", agent: "guard", label: `Chat message blocked: "${message.slice(0, 80)}"`, untrustedText: [message] });
      return Response.json({
        status: "done",
        intent: "blocked",
        reply: "I can't act on that. It looks like an attempt to change my rules, so I blocked it and logged it in the activity feed.",
      });
    }

    const origin = new URL(req.url).origin;
    const parsed = parseIntent(message);
    let out: Reply;
    switch (parsed.intent) {
      case "help":
        out = HELP;
        break;
      case "catchup":
        out = await handleCatchup(origin, role, parsed.topic!, parsed.days!);
        break;
      case "rfp":
        out = await handleRfp(parsed.sheet ?? "meridian");
        break;
      case "actionswarm":
        out = await handleActionSwarm(origin);
        break;
      case "zombie":
        out = await handleZombie(origin);
        break;
      case "expenses":
        out = await handleExpenses(origin);
        break;
      case "access":
        out = handleAccess();
        break;
      default:
        out = await handleSearch(origin, role, message);
    }
    return Response.json({ status: "done", ...out });
  } catch (e) {
    return Response.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
