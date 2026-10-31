import { getDb } from "@/lib/db";

// Zombie SaaS: tools we pay for that nobody has logged into recently.
// Uses saas_billing (tool, monthly_cost_inr, owner, seats) and
// sso_logins (tool, user_id, last_login as an ISO date string).
// Set ZOMBIE_AS_OF=2026-11-01 (any ISO date) to pin "today" for a repeatable demo.

export type ZombieTool = {
  tool: string;
  owner: string | null;
  seats: number | null;
  monthly_cost_inr: number;
  last_login: string | null; // null = no login on record
  days_idle: number | null;
};

export type ZombieReport = {
  asOf: string;
  thresholdDays: number;
  totalToolsChecked: number;
  tools: ZombieTool[];
  monthlyWasteInr: number;
  annualWasteInr: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function findZombieSaas(opts: { thresholdDays?: number; asOf?: Date } = {}): ZombieReport {
  const thresholdDays = opts.thresholdDays ?? 30;
  const pinned = process.env.ZOMBIE_AS_OF ? new Date(process.env.ZOMBIE_AS_OF) : null;
  const asOf = opts.asOf ?? (pinned && !isNaN(pinned.getTime()) ? pinned : new Date());

  const rows = getDb()
    .prepare(
      `SELECT b.tool AS tool, b.owner AS owner, b.seats AS seats, b.monthly_cost_inr AS monthly_cost_inr,
              (SELECT MAX(s.last_login) FROM sso_logins s WHERE s.tool = b.tool) AS last_login
       FROM saas_billing b`,
    )
    .all() as Array<{
    tool: string;
    owner: string | null;
    seats: number | null;
    monthly_cost_inr: number;
    last_login: string | null;
  }>;

  const seen = new Set<string>();
  const tools: ZombieTool[] = [];
  let checked = 0;

  for (const r of rows) {
    if (seen.has(r.tool)) continue; // one line per tool
    seen.add(r.tool);
    checked++;

    let daysIdle: number | null = null;
    if (r.last_login != null) {
      const t = Date.parse(r.last_login);
      if (isNaN(t)) {
        console.warn(`zombie: unreadable last_login "${r.last_login}" for ${r.tool}; skipped`);
        continue;
      }
      daysIdle = Math.floor((asOf.getTime() - t) / DAY_MS);
      if (daysIdle < thresholdDays) continue; // someone used it recently
    }
    tools.push({
      tool: r.tool,
      owner: r.owner,
      seats: r.seats,
      monthly_cost_inr: r.monthly_cost_inr,
      last_login: r.last_login,
      days_idle: daysIdle,
    });
  }

  tools.sort((a, b) => b.monthly_cost_inr - a.monthly_cost_inr);
  const monthlyWasteInr = tools.reduce((sum, t) => sum + t.monthly_cost_inr, 0);

  return {
    asOf: asOf.toISOString(),
    thresholdDays,
    totalToolsChecked: checked,
    tools,
    monthlyWasteInr,
    annualWasteInr: monthlyWasteInr * 12,
  };
}