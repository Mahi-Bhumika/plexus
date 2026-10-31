"use client";

import { useState, type ReactNode } from "react";
import { Clock, Sparkles } from "lucide-react";

/* Sample data: replace with the real SaaS billing + SSO login tables. */
type SaasTool = { name: string; monthly: number; seats: number; logins30d: number; lastLogin: string };

// "As of" date is fixed on purpose: no Date.now() during render (Next 16 prerender rule).
const AS_OF = Date.UTC(2026, 9, 31);

const SAAS_TOOLS: SaasTool[] = [
  { name: "Datadog", monthly: 42000, seats: 12, logins30d: 118, lastLogin: "2026-10-31" },
  { name: "Slack", monthly: 24500, seats: 35, logins30d: 612, lastLogin: "2026-10-31" },
  { name: "GitHub", monthly: 21000, seats: 14, logins30d: 340, lastLogin: "2026-10-31" },
  { name: "Figma", monthly: 18000, seats: 6, logins30d: 74, lastLogin: "2026-10-30" },
  { name: "Jira", monthly: 15400, seats: 14, logins30d: 96, lastLogin: "2026-10-30" },
  { name: "Asana", monthly: 13500, seats: 10, logins30d: 0, lastLogin: "2026-08-19" },
  { name: "Miro", monthly: 11200, seats: 8, logins30d: 0, lastLogin: "2026-09-02" },
  { name: "Notion", monthly: 9600, seats: 22, logins30d: 201, lastLogin: "2026-10-31" },
  { name: "Zoom", monthly: 8400, seats: 20, logins30d: 143, lastLogin: "2026-10-29" },
  { name: "Airtable", monthly: 7200, seats: 5, logins30d: 0, lastLogin: "2026-09-11" },
  { name: "Loom", monthly: 6800, seats: 9, logins30d: 37, lastLogin: "2026-10-27" },
  { name: "Canva", monthly: 5400, seats: 4, logins30d: 19, lastLogin: "2026-10-28" },
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Indian digit grouping without Intl, so server and client always render the same text.
function inr(n: number): string {
  const s = Math.round(n).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return "₹" + (rest ? grouped + "," + last3 : last3);
}

function daysSince(isoDate: string): number {
  return Math.floor((AS_OF - Date.parse(isoDate + "T00:00:00Z")) / 86400000);
}


/* Shared look: matches the RFP Agent page (navy cards, thin borders, small bordered pills). */
const CARD = "rounded-2xl border border-slate-800 bg-[#0c1424]";
const TABLE_WRAP = "overflow-x-auto rounded-2xl border border-slate-800 bg-[#0c1424]";
const TH = "text-left px-4 py-3.5 font-medium text-slate-400";
const TD = "px-4 py-3.5";

const PILL = {
  good: "bg-emerald-950/60 text-emerald-400 border-emerald-800/60",
  warn: "bg-amber-950/50 text-amber-400 border-amber-800/60",
  bad: "bg-rose-950/50 text-rose-400 border-rose-800/60",
  muted: "bg-slate-900 text-slate-400 border-slate-700",
} as const;

function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${PILL[tone]}`}
    >
      {children}
    </span>
  );
}

function SampleBadge() {
  return (
    <div className={`${CARD} px-4 py-2.5 flex items-center gap-2.5 text-sm text-slate-300 shrink-0`}>
      <Sparkles className="w-4 h-4 text-indigo-400" />
      <span className="leading-tight">
        Sample
        <br />
        data
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page: Audit Trail (Zombie SaaS)                                            */
/* -------------------------------------------------------------------------- */

export default function AuditTrailPage() {
  const [flagged, setFlagged] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  function notice(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 4000);
  }

  const maxCost = Math.max(...SAAS_TOOLS.map((t) => t.monthly));
  const totalSpend = SAAS_TOOLS.reduce((s, t) => s + t.monthly, 0);
  const zombies = SAAS_TOOLS.filter((t) => t.logins30d === 0);
  const wasteMonthly = zombies.reduce((s, t) => s + t.monthly, 0);
  const savingMonthly = zombies.filter((t) => flagged.includes(t.name)).reduce((s, t) => s + t.monthly, 0);

  function flagTool(name: string) {
    if (flagged.includes(name)) return;
    setFlagged((prev) => [...prev, name]);
    notice(`${name}: cancellation sent for approval. Nothing is cancelled until a human approves.`);
  }

  function flagAll() {
    const names = zombies.map((t) => t.name).filter((n) => !flagged.includes(n));
    if (names.length === 0) return;
    setFlagged((prev) => [...prev, ...names]);
    notice(`${names.length} cancellations sent for approval. Nothing is cancelled until a human approves.`);
  }
  return (
    <div className="min-h-full bg-[#0b1120]">
    <div className="p-8 max-w-6xl space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Audit Trail</h2>
          <p className="text-[15px] text-slate-400 mt-1.5 max-w-2xl">
            Zombie SaaS: billing joined with SSO logins to find tools nobody uses. Cancelling is a gated action, so it goes to a human approver and is logged here.
          </p>
        </div>
        <SampleBadge />
      </div>

      {banner && (
        <div className="px-4 py-3 rounded-xl border border-indigo-500/40 bg-indigo-950/50 text-indigo-200 text-sm">
          {banner}
        </div>
      )}

      {/* Stats strip */}
      <div className={`${CARD} grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-800`}>
        {[
          { label: "Tools tracked", value: String(SAAS_TOOLS.length), tone: "text-white" },
          { label: "Spend / month", value: inr(totalSpend), tone: "text-white" },
          { label: "Wasted / month", value: inr(wasteMonthly), tone: "text-rose-400" },
          { label: "Wasted / year", value: inr(wasteMonthly * 12), tone: "text-rose-400" },
        ].map((t) => (
          <div key={t.label} className="py-6 text-center">
            <div className={`text-4xl font-bold ${t.tone}`}>{t.value}</div>
            <div className="text-sm text-slate-400 mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="font-mono text-[13px] text-slate-400">
        saas_billing + sso_logins · {zombies.length} tools with zero logins in 30+ days ·{" "}
        {Math.round((wasteMonthly / totalSpend) * 100)}% of spend unused
      </div>

      {/* Cost chart */}
      <div className={`${CARD} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200">Monthly cost by tool</h3>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Active
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Zombie (0 logins, 30+ days)
            </span>
          </div>
        </div>
        <div className="space-y-2.5">
          {SAAS_TOOLS.map((t) => {
            const zombie = t.logins30d === 0;
            return (
              <div key={t.name} className="flex items-center gap-3 text-[13px]">
                <div className="w-20 text-slate-300 truncate">{t.name}</div>
                <div className="flex-1 h-5 rounded-md bg-slate-900 overflow-hidden">
                  <div
                    className={`h-full rounded-md ${zombie ? "bg-rose-500" : "bg-indigo-500/80"}`}
                    style={{ width: `${(t.monthly / maxCost) * 100}%` }}
                  />
                </div>
                <div className="w-20 text-right font-mono text-slate-300">{inr(t.monthly)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zombie tools */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-slate-200">Zombie tools</h3>
            <Pill tone="bad">{zombies.length} found</Pill>
          </div>
          <button
            onClick={flagAll}
            disabled={zombies.every((t) => flagged.includes(t.name))}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#5046E5] hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
          >
            Send all for cancellation approval
          </button>
        </div>

        <div className={TABLE_WRAP}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={TH}>Tool</th>
                <th className={`${TH} text-right`}>Seats</th>
                <th className={`${TH} text-right`}>Logins (30d)</th>
                <th className={TH}>Last login</th>
                <th className={TH}>Inactive</th>
                <th className={`${TH} text-right`}>Monthly</th>
                <th className={`${TH} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {zombies.map((t) => {
                const isFlagged = flagged.includes(t.name);
                return (
                  <tr key={t.name} className="hover:bg-slate-800/30 transition-colors">
                    <td className={`${TD} text-slate-100`}>{t.name}</td>
                    <td className={`${TD} text-right text-slate-300 font-mono`}>{t.seats}</td>
                    <td className={`${TD} text-right text-rose-400 font-mono font-semibold`}>{t.logins30d}</td>
                    <td className={`${TD} text-slate-400 font-mono`}>{t.lastLogin}</td>
                    <td className={`${TD} text-slate-300`}>{daysSince(t.lastLogin)} days</td>
                    <td className={`${TD} text-right text-white font-mono font-semibold`}>{inr(t.monthly)}</td>
                    <td className={`${TD} text-right`}>
                      {isFlagged ? (
                        <Pill tone="warn">
                          <Clock className="w-3 h-3" />
                          Pending approval
                        </Pill>
                      ) : (
                        <button
                          onClick={() => flagTool(t.name)}
                          className="px-3 py-1.5 rounded-lg border border-rose-800/60 bg-rose-950/40 hover:bg-rose-950/70 text-rose-300 text-xs font-semibold transition-colors"
                        >
                          Flag for cancellation
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {savingMonthly > 0 && (
          <div className="font-mono text-[13px] text-emerald-400">
            Pending approval: {inr(savingMonthly)} / month ({inr(savingMonthly * 12)} / year)
          </div>
        )}
      </div>
    </div>
    </div>
  );
}