// Slack helpers: post messages with Approve/Reject buttons, and map Slack users to approvers.
// Posts use the bot token over HTTPS (no extra package). Button clicks are received by
// scripts/slack-listener.ts (Socket Mode), which calls the app's own API routes.
//
// Env (values never logged):
//   SLACK_BOT_TOKEN            xoxb-...  (scope: chat:write)
//   SLACK_USER_KARAN / SLACK_USER_RIYA   Slack member IDs (profile -> Copy member ID), approval cards go to their DMs
//   SLACK_APPROVALS_CHANNEL    optional fallback channel ID if a member ID is missing (bot must be in it)
//   SLACK_FINANCE_CHANNEL      channel ID of #finance for receipt notices (bot must be invited)
// Slack is skipped in Demo Mode and when ACTIONSWARM_NO_SLACK=1.

export type SlackResult = { status: "posted" | "skipped" | "error"; message: string; ts?: string; channel?: string };

export function slackEnabled(): boolean {
  if (process.env.DEMO_MODE === "true") return false;
  if (process.env.ACTIONSWARM_NO_SLACK === "1") return false;
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

const PEOPLE: Array<{ name: string; env: string }> = [
  { name: "Karan Malhotra", env: "SLACK_USER_KARAN" },
  { name: "Riya Sharma", env: "SLACK_USER_RIYA" },
];

export function slackIdFor(approver: string): string | null {
  const p = PEOPLE.find((x) => x.name === approver);
  return (p && process.env[p.env]?.trim()) || null;
}

export function approverForSlackUser(slackUserId: string): string | null {
  const p = PEOPLE.find((x) => process.env[x.env]?.trim() === slackUserId);
  return p ? p.name : null;
}

// A member ID as the channel posts into the app's DM with that person.
export function approvalTarget(approver: string): string | null {
  return slackIdFor(approver) ?? (process.env.SLACK_APPROVALS_CHANNEL?.trim() || null);
}

export function financeChannel(): string | null {
  return process.env.SLACK_FINANCE_CHANNEL?.trim() || null;
}

export async function postSlack(channel: string | null, text: string, blocks?: unknown[]): Promise<SlackResult> {
  if (!slackEnabled()) return { status: "skipped", message: "Slack is off (Demo Mode, ACTIONSWARM_NO_SLACK, or no bot token)." };
  if (!channel) return { status: "skipped", message: "No Slack channel or member ID is configured for this message." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; ts?: string; channel?: string };
    if (!data.ok) return { status: "error", message: `Slack said: ${data.error ?? "unknown error"}` };
    return { status: "posted", message: "Posted to Slack.", ts: data.ts, channel: data.channel };
  } catch (err) {
    return { status: "error", message: `Slack post failed: ${err instanceof Error ? err.name : "error"}` };
  } finally {
    clearTimeout(timer);
  }
}

export type CardValue = { kind: "expense" | "saas"; id: string };

export function approvalBlocks(opts: { title: string; lines: string[]; value: CardValue; fullAmountButton?: boolean }): unknown[] {
  const encoded = JSON.stringify(opts.value);
  const buttons: unknown[] = [
    { type: "button", text: { type: "plain_text", text: opts.fullAmountButton ? "Approve allowed amount" : "Approve" }, style: "primary", action_id: "plexus_approve", value: encoded },
  ];
  if (opts.fullAmountButton) {
    buttons.push({ type: "button", text: { type: "plain_text", text: "Approve full amount" }, action_id: "plexus_approve_full", value: encoded });
  }
  buttons.push({ type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "plexus_reject", value: encoded });
  return [
    { type: "section", text: { type: "mrkdwn", text: `*${opts.title}*\n${opts.lines.join("\n")}` } },
    { type: "actions", elements: buttons },
  ];
}
