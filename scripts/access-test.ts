// Runs the six Slack access requests from seed/access/slack_requests.json through the access agent,
// then tests approval, self-approval, wrong approver, double decision and undo.
// Run: pnpm tsx --env-file=.env.local scripts/access-test.ts
// It deletes the access_requests rows it creates. Run scripts/reset-demo.ts afterwards to clear the feed events.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { createAccessRequest, decideAccessRequest, AccessError } from "@/agents/access";
import { undoAction } from "@/lib/guard";

const HANDLES: Record<string, string> = { "@meera": "Meera Iyer", "@arjun": "Arjun Verma", "@karan": "Karan Malhotra", "@riya": "Riya Sharma" };
let failed = 0;
const created: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

function status(id: string): string {
  return (getDb().prepare("SELECT status FROM access_requests WHERE id = ?").get(id) as { status: string }).status;
}

function tryDecide(id: string, decision: "granted" | "denied", approverName: string): { ok: boolean; code?: number; error?: string } {
  try {
    decideAccessRequest({ id, decision, approverName });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e instanceof AccessError ? e.httpStatus : 500, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const file = ["seed/access/slack_requests.json", "data/slack_requests.json"].map((p) => path.join(process.cwd(), p)).find(existsSync);
  if (!file) throw new Error("slack_requests.json not found");
  const reqs = JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; user: string; text: string }>;
  const out: Record<string, ReturnType<typeof createAccessRequest>> = {};
  for (const r of reqs) {
    out[r.id] = createAccessRequest({ userName: HANDLES[r.user], text: r.text });
    created.push(out[r.id].request.id);
    const o = out[r.id];
    console.log(`  ${r.id} ${r.user} -> ${o.request.app} [${o.request.risk}] ${o.request.status}, decision ${o.decision}${o.approver ? `, approver ${o.approver}` : ""}${o.reasons.length ? `, reasons: ${o.reasons.join("; ")}` : ""}`);
  }

  console.log("\nSlack requests");
  check("REQ-001 Meera -> Figma is granted at once", out["REQ-001"].request.status === "granted" && out["REQ-001"].decision === "allow");
  check("REQ-002 Meera -> AWS production waits for Karan", out["REQ-002"].request.status === "pending_approval" && out["REQ-002"].approver === "Karan Malhotra" && out["REQ-002"].request.risk === "High", `guard said ${out["REQ-002"].decision}`);
  check("REQ-003 Arjun -> GitHub waits for Karan", out["REQ-003"].request.status === "pending_approval" && out["REQ-003"].approver === "Karan Malhotra");
  check("REQ-004 Meera -> Jira is granted at once", out["REQ-004"].request.status === "granted");
  check("REQ-005 Arjun -> AWS production is denied (interns not eligible)", out["REQ-005"].request.status === "denied" && out["REQ-005"].decision === "block");
  check("REQ-006 injected urgent request is blocked, nothing granted", out["REQ-006"].request.status === "denied" && out["REQ-006"].decision === "block", out["REQ-006"].reasons.join(", "));

  console.log("\nCaller cannot choose risk or approver");
  const sneaky = createAccessRequest({ userName: "Meera Iyer", app: "AWS production", risk: "Low", approverId: "Meera Iyer" });
  created.push(sneaky.request.id);
  check("AWS production with risk 'Low' in the body still waits for Karan", sneaky.request.status === "pending_approval" && sneaky.approver === "Karan Malhotra" && sneaky.request.risk === "High");

  console.log("\nApprovals");
  const aws = out["REQ-002"].request.id;
  let r = tryDecide(aws, "granted", "Meera Iyer");
  check("Meera cannot approve her own AWS request", !r.ok && r.code === 403, r.error);
  r = tryDecide(aws, "granted", "Arjun Verma");
  check("Arjun cannot approve it either", !r.ok && r.code === 403, r.error);
  check("request is still pending", status(aws) === "pending_approval");
  r = tryDecide(aws, "granted", "Karan");
  check("Karan can approve it", r.ok && status(aws) === "granted", r.error);
  r = tryDecide(aws, "granted", "Karan Malhotra");
  check("a second decision is refused", !r.ok && r.code === 409, r.error);

  console.log("\nUndo");
  const approved = decideAccessRequest({ id: out["REQ-003"].request.id, decision: "granted", approverName: "Karan Malhotra" });
  check("Karan approves Arjun's GitHub request", status(out["REQ-003"].request.id) === "granted");
  const u = await undoAction(approved.eventId);
  check("undo reverses the approved grant", u.ok && status(out["REQ-003"].request.id) === "undone", u.ok ? u.message : u.error);
  const u2 = await undoAction(out["REQ-001"].eventId ?? "");
  check("undo reverses an auto-granted Figma access", u2.ok && status(out["REQ-001"].request.id) === "undone", u2.ok ? u2.message : u2.error);

  console.log("\nEscalation");
  const karanAws = createAccessRequest({ userName: "Karan Malhotra", app: "AWS production" });
  created.push(karanAws.request.id);
  check("Karan's own AWS request goes to Riya", karanAws.approver === "Riya Sharma");
  r = tryDecide(karanAws.request.id, "granted", "Karan Malhotra");
  check("Karan cannot approve his own request", !r.ok && r.code === 403, r.error);
  r = tryDecide(karanAws.request.id, "granted", "Riya Sharma");
  check("Riya can approve it", r.ok);
  const riyaPayroll = createAccessRequest({ userName: "Riya Sharma", app: "Payroll tool" });
  created.push(riyaPayroll.request.id);
  check("Riya's payroll request is granted at once", riyaPayroll.request.status === "granted");
  const unknown = createAccessRequest({ userName: "Stranger", app: "Figma" });
  created.push(unknown.request.id);
  check("a person not in the directory needs approval", unknown.request.status === "pending_approval");

  const del = getDb().prepare("DELETE FROM access_requests WHERE id = ?");
  for (const id of created) del.run(id);
  console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
