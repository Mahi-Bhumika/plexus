// Run: pnpm tsx --env-file=.env.local scripts/finance-guard-test.ts
// Tests Slack cards (fetch is stubbed: NOTHING is posted to Slack), expense reject, and zombie SaaS cancel.
// Uses a fake tool "ZZ Test Tool" and claim ids starting with test_; both are removed at the end.
// Run scripts/reset-demo.ts afterwards (audit and undo rows).
import { getDb } from "@/lib/db";
import { undoAction } from "@/lib/guard";
import { approverForSlackUser, approvalBlocks } from "@/lib/slack";
import { requestExpenseApproval, rejectClaim, ApprovalError } from "@/agents/expense-approval";
import { requestCancel, approveCancel, rejectCancel, listCancellations, CancelError } from "@/agents/saas-cancel";

let fail = 0;
const t = (name: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
async function status(p: Promise<unknown>): Promise<number | "ok" | "other"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ApprovalError || e instanceof CancelError ? e.status : "other";
  }
}

async function main() {
  // Fake Slack: fake tokens and a stubbed fetch. The real token in .env.local is replaced for this process.
  const saved = { ...process.env };
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  delete process.env.ACTIONSWARM_NO_SLACK;
  delete process.env.DEMO_MODE;
  process.env.SLACK_USER_KARAN = "U_KARAN";
  process.env.SLACK_USER_RIYA = "U_RIYA";
  process.env.SLACK_FINANCE_CHANNEL = "C_FIN";
  const posts: Array<{ channel: string; text: string; blocks?: Array<{ type: string; elements?: Array<{ action_id: string }> }> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    posts.push(JSON.parse(init?.body ?? "{}"));
    return { json: async () => ({ ok: true, ts: "1", channel: "x" }) } as Response;
  }) as typeof fetch;

  try {
    const db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS expense_claims (id TEXT PRIMARY KEY, run_at TEXT NOT NULL, payload TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS saas_billing (tool TEXT, monthly_cost_inr REAL, owner TEXT, seats INTEGER)");
    db.prepare("DELETE FROM saas_billing WHERE tool = 'ZZ Test Tool'").run();
    db.prepare("INSERT INTO saas_billing (tool, monthly_cost_inr, owner, seats) VALUES ('ZZ Test Tool', 4200, 'Riya Sharma', 5)").run();

    const claim = {
      id: "test_rest", file: "test_rest", type: "meal", claimant: "Karan Malhotra", card: { txn_id: "T8", matchedBy: "receipt_ref" },
      total: 5250, allowedAmount: 3000, approvedAmount: 3000, approver: "Riya Sharma", status: "violation",
      issues: [{ code: "over_limit", severity: "violation", message: "Dinner for 2 is over the limit." }], confidence: 0.99, extractionError: null,
      extraction: { merchant: "Saffron & Salt", date: "2026-10-28", invoice_number: "S1", expense_type: "meal", items: [], subtotal: null, gst: null, total: 5250, covers: 2, meal_type: "dinner", nights: null, city: null, travel_class: null, trip_type: "unknown", confidence: 0.99 },
    };
    db.prepare("INSERT OR REPLACE INTO expense_claims (id, run_at, payload) VALUES (?, ?, ?)").run(claim.id, new Date().toISOString(), JSON.stringify(claim));

    // ---- Slack mapping and card ----
    t("Slack user maps to approver", approverForSlackUser("U_RIYA") === "Riya Sharma" && approverForSlackUser("U_KARAN") === "Karan Malhotra");
    t("unknown Slack user is not an approver", approverForSlackUser("U_OTHER") === null);
    const card = approvalBlocks({ title: "x", lines: ["y"], value: { kind: "expense", id: "a" }, fullAmountButton: true }) as Array<{ elements?: Array<{ action_id: string }> }>;
    t("card has approve, approve full, reject", JSON.stringify(card[1].elements?.map((e) => e.action_id)) === '["plexus_approve","plexus_approve_full","plexus_reject"]');

    // ---- Expense: request on Slack, then reject ----
    const r = await requestExpenseApproval("test_rest");
    t("request routes to Riya", r.approver === "Riya Sharma");
    t("DM goes to Riya's member ID with 3 buttons", posts[0]?.channel === "U_RIYA" && posts[0].blocks?.[1].elements?.length === 3);
    t("receipt notice goes to #finance", posts[1]?.channel === "C_FIN" && /test_rest/.test(posts[1].text));
    const ev = db.prepare("SELECT status, agent FROM audit_events WHERE id = ?").get(r.eventId) as { status: string; agent: string };
    t("feed shows pending_approval from finance", ev.status === "pending_approval" && ev.agent === "finance");

    process.env.ACTIONSWARM_NO_SLACK = "1";
    const off = await requestExpenseApproval("test_rest");
    t("Slack off: request still works, posts skipped", off.slack.dm.status === "skipped");
    delete process.env.ACTIONSWARM_NO_SLACK;

    t("wrong person cannot reject", (await status(rejectClaim("test_rest", "Karan"))) === 403);
    const rej = await rejectClaim("test_rest", "Riya");
    const rev = db.prepare("SELECT status FROM audit_events WHERE id = ?").get(rej.eventId) as { status: string };
    t("Riya rejects: flagged event", rev.status === "flagged");

    // ---- Zombie SaaS cancel ----
    const before = posts.length;
    const req = await requestCancel("zz test tool");
    t("cancel request is pending, routed to Karan (owner is Riya)", req.cancellation.status === "pending" && req.cancellation.approver === "Karan Malhotra");
    t("Slack card goes to Karan", posts[before]?.channel === "U_KARAN" && posts.length === before + 1);
    const pev = db.prepare("SELECT status FROM audit_events WHERE id = ?").get(req.eventId) as { status: string };
    t("feed shows pending_approval", pev.status === "pending_approval");
    const again = await requestCancel("ZZ Test Tool");
    t("asking twice returns the same pending request", again.eventId === req.eventId && posts.length === before + 1);
    t("owner cannot approve own tool", (await status(approveCancel("ZZ Test Tool", "Riya"))) === 403);
    t("unknown tool is 404", (await status(requestCancel("No Such Tool"))) === 404);

    const ap = await approveCancel("ZZ Test Tool", "karan");
    const aev = db.prepare("SELECT status, undo_state, agent FROM audit_events WHERE id = ?").get(ap.eventId) as { status: string; undo_state: string | null; agent: string };
    t("Karan approves: done, undoable, finance", aev.status === "done" && aev.undo_state !== null && aev.agent === "finance");
    t("approving again is 409", (await status(approveCancel("ZZ Test Tool", "Karan"))) === 409);
    const saved1 = listCancellations();
    t("savings: Rs 4,200 a month, Rs 50,400 a year", saved1.monthlySaved === 4200 && saved1.yearlySaved === 50400);

    t("undo succeeds", (await undoAction(ap.eventId)).ok);
    t("after undo the tool is active again", listCancellations().cancellations.length === 0 && listCancellations().monthlySaved === 0);

    await requestCancel("ZZ Test Tool", { slack: false });
    t("wrong approver cannot reject", (await status(rejectCancel("ZZ Test Tool", "Riya"))) === 403);
    await rejectCancel("ZZ Test Tool", "Karan");
    t("reject drops the request", listCancellations().cancellations.length === 0);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    const db = getDb();
    db.prepare("DELETE FROM expense_claims WHERE id LIKE 'test_%'").run();
    db.prepare("DELETE FROM saas_billing WHERE tool = 'ZZ Test Tool'").run();
    db.prepare("DELETE FROM saas_cancellations WHERE tool = 'ZZ Test Tool'").run();
  }

  console.log(fail ? `\n${fail} FAILED` : "\nall passed");
  process.exit(fail ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
