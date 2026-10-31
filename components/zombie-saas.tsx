"use client";

import { useEffect, useState } from "react";
import { getZombie } from "@/lib/finance-client";

type Tool = { name: string; monthly: number; lastLogin: string | null; daysIdle: number | null; zombie: boolean };
type View = { checked: number; tools: Tool[]; wastePerMonth: number };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
};
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// ADAPTER: the only place that knows the ZombieReport field names. Fix here if numbers look wrong.
function adapt(raw: unknown): View | null {
  const r = rec(raw);
  const toTool = (x: unknown, forceZombie: boolean): Tool => {
    const t = rec(x);
    const days = num(pick(t, ["daysSinceLastLogin", "days_since_last_login", "daysIdle", "days_idle", "idleDays"]));
    return {
      name: str(pick(t, ["tool", "name", "app", "toolName", "tool_name"])) ?? "Unknown",
      monthly: num(pick(t, ["monthly_cost_inr", "monthlyCostInr", "monthlyCost", "monthly_cost", "cost_inr", "cost", "amount_inr"])) ?? 0,
      lastLogin: str(pick(t, ["lastLogin", "last_login", "lastLoginDate", "last_login_date"])),
      daysIdle: days,
      zombie: forceZombie || pick(t, ["zombie", "isZombie", "is_zombie"]) === true,
    };
  };
  const zs = pick(r, ["zombies", "zombieTools", "zombie_tools", "wasted"]);
  const all = pick(r, ["tools", "allTools", "all_tools", "rows", "items"]);
  const zombies = Array.isArray(zs) ? zs.map((x) => toTool(x, true)) : [];
  let tools: Tool[];
  if (Array.isArray(all)) {
    tools = all.map((x) => toTool(x, false));
    const zn = new Set(zombies.map((z) => z.name));
    tools = tools.map((t) => (zn.has(t.name) ? { ...t, zombie: true } : t));
  } else {
    tools = zombies;
  }
  if (tools.length === 0) return null;
  const waste = num(pick(r, ["wastePerMonth", "monthlyWaste", "totalMonthlyWaste", "total_waste_inr", "wasted_per_month"]));
  return {
    checked: num(pick(r, ["totalToolsChecked"])) ?? tools.length,
    tools,
    wastePerMonth: waste ?? tools.filter((t) => t.zombie).reduce((s, t) => s + t.monthly, 0),
  };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function ZombieSaas() {
  const [view, setView] = useState<View | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    getZombie()
      .then((raw) => {
        if (!alive) return;
        setKeys(Object.keys(rec(raw)));
        setView(adapt(raw));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const zombies = view?.tools.filter((t) => t.zombie) ?? [];
  const max = Math.max(1, ...(view?.tools.map((t) => t.monthly) ?? [1]));
  const toggle = (n: string) =>
    setFlagged((p) => {
      const s = new Set(p);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });

  return (
    <section className="mt-10 rounded-xl border border-slate-800 bg-[#0c1424] p-6 text-slate-200">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Zombie SaaS</h2>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">Live data</span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
      {loading && <p className="text-slate-500">Loading…</p>}
      {!loading && !error && !view && (
        <p className="text-sm text-amber-400">
          Got a response but could not read tools from it. Fields found: {keys.join(", ") || "none"}. Paste the JSON to fix the adapter.
        </p>
      )}

      {view && (
        <>
          <div className="mb-5 flex divide-x divide-slate-800 rounded-lg border border-slate-800">
            {[
              [view.checked, "Tools checked", "text-white"],
              [zombies.length, "Zombies", "text-red-400"],
              [inr(view.wastePerMonth), "Wasted per month", "text-amber-400"],
              [inr(view.wastePerMonth * 12), "Wasted per year", "text-amber-400"],
            ].map(([v, l, c]) => (
              <div key={String(l)} className="flex-1 px-4 py-4 text-center">
                <div className={`text-2xl font-semibold ${c}`}>{v}</div>
                <div className="text-xs text-slate-400">{l}</div>
              </div>
            ))}
          </div>

          <div className="mb-6 space-y-2">
            {view.tools.map((t) => (
              <div key={t.name} className="flex items-center gap-3 text-sm">
                <div className="w-32 truncate text-slate-400">{t.name}</div>
                <div className="h-4 flex-1 rounded bg-slate-800/60">
                  <div
                    className={`h-4 rounded ${t.zombie ? "bg-red-500" : "bg-[#5046E5]"}`}
                    style={{ width: `${(t.monthly / max) * 100}%` }}
                  />
                </div>
                <div className="w-20 text-right font-mono text-slate-300">{inr(t.monthly)}</div>
              </div>
            ))}
          </div>

          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                {["Tool", "Monthly", "Last login", "Idle", "Action"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zombies.map((t) => (
                <tr key={t.name} className="border-b border-slate-800/60">
                  <td className="px-3 py-3 text-white">{t.name}</td>
                  <td className="px-3 py-3 font-mono">{inr(t.monthly)}</td>
                  <td className="px-3 py-3 font-mono text-slate-400">{t.lastLogin ?? "-"}</td>
                  <td className="px-3 py-3 font-mono text-red-400">{t.daysIdle != null ? `${t.daysIdle}d` : "-"}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => toggle(t.name)}
                      disabled={sent}
                      className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
                    >
                      {sent ? "Pending approval" : flagged.has(t.name) ? "Flagged ✓" : "Flag for cancellation"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={() => setSent(true)}
            disabled={sent || flagged.size === 0}
            className="rounded-lg bg-[#5046E5] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {sent ? "Sent for approval" : `Send ${flagged.size || ""} for approval`}
          </button>
          {sent && (
            <p className="mt-2 text-xs text-slate-500">
              Pending approval. Nothing is cancelled until a human approves.
            </p>
          )}
        </>
      )}
    </section>
  );
}