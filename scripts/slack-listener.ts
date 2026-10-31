// Slack button listener (Socket Mode). Run it in a second terminal while the app runs:
//   pnpm tsx --env-file=.env.local scripts/slack-listener.ts
//
// It does no business logic. A click is mapped to an approver (SLACK_USER_KARAN / SLACK_USER_RIYA)
// and sent to the app's own API, so the feed, guard and undo all run inside the app process.
//   expense card -> POST /api/finance/approve   (approve, approve full amount, reject)
//   saas card    -> POST /api/finance/saas      (approve, reject)

import { App } from "@slack/bolt";
import { approverForSlackUser } from "@/lib/slack";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken || !appToken) {
  console.error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be loaded. Use --env-file=.env.local.");
  process.exit(1);
}
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

type ApiReply = { ok?: boolean; error?: string; approval?: { amount: number; mode: string }; cancellation?: { monthly_cost_inr: number } };

async function callApi(path: string, body: Record<string, unknown>): Promise<ApiReply> {
  try {
    const res = await fetch(`${APP_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as ApiReply;
  } catch {
    return { ok: false, error: `Could not reach the app at ${APP_URL}. Is it running?` };
  }
}

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

const app = new App({ token: botToken, appToken, socketMode: true });

app.action(/^plexus_(approve|approve_full|reject)$/, async ({ ack, body, action, respond }) => {
  await ack();
  const a = action as unknown as { action_id: string; value?: string };
  const userId = (body as { user: { id: string } }).user.id;
  const approver = approverForSlackUser(userId);
  if (!approver) {
    await respond({ response_type: "ephemeral", replace_original: false, text: "You are not set up as an approver for this app." });
    return;
  }

  let value: { kind?: string; id?: string } = {};
  try {
    value = JSON.parse(a.value ?? "{}");
  } catch {
    // handled below
  }
  if (!value.kind || !value.id) {
    await respond({ response_type: "ephemeral", replace_original: false, text: "This card is not readable." });
    return;
  }

  const reject = a.action_id === "plexus_reject";
  let reply: ApiReply;
  let done: string;
  if (value.kind === "expense") {
    reply = await callApi("/api/finance/approve", { claimId: value.id, approver, mode: a.action_id === "plexus_approve_full" ? "full" : "allowed", reject });
    done = reject ? `Rejected by ${approver}` : `Approved by ${approver}${reply.approval ? `: ${inr(reply.approval.amount)}` : ""}`;
  } else if (value.kind === "saas") {
    reply = await callApi("/api/finance/saas", { tool: value.id, approver, action: reject ? "reject" : "approve" });
    done = reject ? `Cancellation rejected by ${approver}, ${value.id} stays` : `Cancelled by ${approver}: ${value.id}${reply.cancellation ? ` (saves ${inr(reply.cancellation.monthly_cost_inr)} a month)` : ""}`;
  } else {
    await respond({ response_type: "ephemeral", replace_original: false, text: `Unknown card type ${value.kind}.` });
    return;
  }

  if (!reply.ok) {
    // keep the buttons so the right person can still act
    await respond({ response_type: "ephemeral", replace_original: false, text: reply.error ?? "That did not work." });
    return;
  }

  const first = (body as { message?: { blocks?: unknown[] } }).message?.blocks?.[0];
  const blocks = [
    ...(first ? [first] : []),
    { type: "context", elements: [{ type: "mrkdwn", text: `${reject ? ":x:" : ":white_check_mark:"} ${done}` }] },
  ];
  await respond({ replace_original: true, text: done, blocks } as unknown as Parameters<typeof respond>[0]);
});

(async () => {
  await app.start();
  console.log(`Slack listener running (Socket Mode). Buttons call ${APP_URL}.`);
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
