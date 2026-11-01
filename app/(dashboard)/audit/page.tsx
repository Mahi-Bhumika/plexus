"use client";

import { useCallback, useEffect, useState } from "react";
import { getZombie } from "@/lib/finance-client";

type Report = Awaited<ReturnType<typeof getZombie>>;
type Cancellation = {
  tool: string;
  monthly_cost_inr: number;
  owner: string | null;
  approver: string;
  status: "pending" | "cancelled";
  event_id: string;
};
type CancelState = { cancellations: Cancellation[]; monthlySaved: number; yearlySaved: number };
type Actor = "Karan" | "Riya";
type Row = Report["tools"][number] & { zombie: boolean };

const RUPEE = "\u20B9";
const DOT = "\u00B7";
const DASH = "\u2014";

const inr = (n: number) => `${RUPEE}${Math.round(n).toLocaleString("en-IN")}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "No login on record";

async function saasPost(body: Record<string, unknown>) {
  const res = await fetch("/api/finance/saas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as { ok: true; message?: string; cancellation?: Cancellation };
}

export default function ZombieSaasPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [cancels, setCancels] = useState<CancelState>({ cancellations: [], monthlySaved: 0, yearlySaved: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actor, setActor] = useState<Actor>("Karan");
  const [filter, setFilter] = useState<"all" | "zombies" | "active">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);

  const notify = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        getZombie(),
        fetch("/api/finance/saas", { cache: "no-store" }).then((x) => x.json()),
      ]);
      setReport(r);
      if (c?.ok) setCancels(c);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const cancelFor = (tool: string) =>
    cancels.cancellations.find((c) => c.tool.toLowerCase() === tool.toLowerCase());

  const act = async (tool: string, action: "request" | "approve" | "reject" | "undo", eventId?: string) => {
    setBusy(tool);
    try {
      const r = await saasPost({ tool, action, approver: actor, eventId });
      if (action === "request") notify(`${tool}: sent to ${r.cancellation?.approver ?? "approver"} for approval.`);
      else if (action === "approve") notify(`${tool}: cancellation approved by ${actor}.`);
      else if (action === "reject") notify(`${tool}: cancellation rejected, tool stays.`);
      else notify(`${tool}: cancellation undone.`);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
    }
  };

  const zombies = report?.tools ?? [];
  const healthy = report?.healthy ?? [];
  const notRequested = zombies.filter((t) => !cancelFor(t.tool));

  const requestAll = async () => {
    if (!notRequested.length) return notify("Nothing left to request.");
    setBusy("*");
    let sent = 0;
    for (const t of notRequested) {
      try {
        await saasPost({ tool: t.tool, action: "request" });
        sent++;
      } catch (e) {
        notify(`${t.tool}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
    setBusy(null);
    if (sent) notify(`Sent ${sent} cancellation request${sent > 1 ? "s" : ""} for approval.`);
    await load();
  };

  const rows: Row[] = [
    ...zombies.map((t) => ({ ...t, zombie: true })),
    ...healthy.map((t) => ({ ...t, zombie: false })),
  ];
  const q = searchQuery.toLowerCase();
  const filteredRows = rows.filter((r) => {
    const okFilter = filter === "all" || (filter === "zombies" ? r.zombie : !r.zombie);
    return okFilter && (r.tool.toLowerCase().includes(q) || (r.owner ?? "").toLowerCase().includes(q));
  });

  const monthlyWaste = report?.monthlyWasteInr ?? 0;
  const annualWaste = report?.annualWasteInr ?? 0;
  const totalSpend = rows.reduce((s, r) => s + r.monthly_cost_inr, 0);
  const wastePct = totalSpend > 0 ? Math.min(100, (monthlyWaste / totalSpend) * 100) : 0;
  const savedPct = monthlyWaste > 0 ? Math.min(100, (cancels.monthlySaved / monthlyWaste) * 100) : 0;
  const pendingCount = cancels.cancellations.filter((c) => c.status === "pending").length;

  const tile =
    "rounded-lg border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm";
  const tileLabel = "text-[10px] font-mono uppercase tracking-wider font-medium";
  const bar = "w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden mt-2.5";
  const pillBase = "px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5";
  const pillOn = "bg-[#F3F4F6] dark:bg-[#162032] text-[#111827] dark:text-[#F3F4F6] font-semibold";
  const pillOff = "text-gray-500 hover:text-[#111827] dark:hover:text-[#F3F4F6]";

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-6">
      {/* HEADER */}
      <div className="rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-5 shadow-sm relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#3B5BFD]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[#3B5BFD] dark:text-blue-400 font-mono text-[10px] font-medium tracking-wide uppercase">
                Zombie SaaS &amp; Spend Governance
              </span>
              <span className="px-1.5 rounded bg-[#F3F4F6] dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] text-gray-500 dark:text-gray-400 text-[10px] font-mono">
                {report ? `${report.totalToolsChecked} tools checked` : "Loading..."}
              </span>
            </div>

            <h1 className="text-xl lg:text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6] tracking-tight">
              Zombie SaaS Detector
            </h1>
            <p className="text-gray-400 text-xs">
              Joins billing with SSO last-login to find paid tools nobody has used. A cancellation needs a
              person&apos;s approval and is recorded in the audit feed. Nothing is cancelled at the vendor.
            </p>

            <div className="flex items-center gap-2 text-gray-400 font-mono text-[11px] pt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Inactivity threshold: {report?.thresholdDays ?? 30} days
              </span>
              <span>/</span>
              <span>As of {report ? fmtDate(report.asOf) : DASH}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
            <div className="flex items-center gap-1 p-0.5 rounded-md border border-[#E5E7EB] dark:border-[#1E293B] text-xs font-mono">
              <span className="px-1.5 text-gray-400">Acting as</span>
              {(["Karan", "Riya"] as Actor[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActor(p)}
                  className={`px-2 py-1 rounded cursor-pointer ${
                    actor === p ? "bg-[#3B5BFD] text-white" : "text-gray-500 hover:text-[#111827] dark:hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => load().then(() => notify("Refreshed from the database."))}
              className="px-3 py-1.5 rounded-md bg-white dark:bg-[#162032] hover:bg-[#F3F4F6] dark:hover:bg-[#1F2C44] border border-[#E5E7EB] dark:border-[#1E293B] text-gray-600 dark:text-gray-300 text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px] text-gray-400">sync</span>
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={requestAll}
              disabled={busy !== null || notRequested.length === 0}
              className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
              <span>Request cancellation for all ({notRequested.length})</span>
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 p-3 text-xs font-mono">
          {loadError}
        </div>
      )}

      {/* TILES */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={tile}>
          <div className="flex items-center justify-between text-gray-400">
            <span className={tileLabel}>Monthly waste found</span>
            <span className="material-symbols-outlined text-[15px] text-rose-600">trending_down</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-rose-600">{inr(monthlyWaste)}</span>
            <span className="font-mono text-[10px] text-rose-700 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-1 rounded font-medium">
              {zombies.length} inactive tools
            </span>
          </div>
          <div className={bar}>
            <div className="bg-rose-500 h-full rounded-full" style={{ width: `${wastePct}%` }}></div>
          </div>
          <span className="font-mono text-[10px] text-gray-400 mt-1">{wastePct.toFixed(0)}% of monthly SaaS spend</span>
        </div>

        <div className={tile}>
          <div className="flex items-center justify-between text-gray-400">
            <span className={tileLabel}>Annual waste found</span>
            <span className="material-symbols-outlined text-[15px] text-rose-600">event_repeat</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-rose-600">{inr(annualWaste)}</span>
            <span className="font-mono text-[10px] text-gray-400">12 x monthly</span>
          </div>
        </div>

        <div className={tile}>
          <div className="flex items-center justify-between text-gray-400">
            <span className={tileLabel}>Saved by approved cancellations</span>
            <span className="material-symbols-outlined text-[15px] text-emerald-600">savings</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-emerald-600">{inr(cancels.monthlySaved)}/mo</span>
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 rounded font-medium">
              {inr(cancels.yearlySaved)}/yr
            </span>
          </div>
          <div className={bar}>
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${savedPct}%` }}></div>
          </div>
          <span className="font-mono text-[10px] text-gray-400 mt-1">{savedPct.toFixed(0)}% of waste found</span>
        </div>

        <div className={tile}>
          <div className="flex items-center justify-between text-gray-400">
            <span className={tileLabel}>Awaiting approval</span>
            <span className="material-symbols-outlined text-[15px] text-[#3B5BFD]">pending_actions</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-[#111827] dark:text-[#F3F4F6]">{pendingCount}</span>
            <span className="font-mono text-[10px] text-gray-400">approve in the table</span>
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white dark:bg-[#0F172A] rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-xs overflow-hidden">
        <div className="p-4 bg-[#F9FAFB] dark:bg-[#162032]/50 border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[#3B5BFD] dark:text-blue-400">troubleshoot</span>
            <h2 className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6]">Monitored SaaS tools</h2>
            <span className="text-gray-400 font-mono text-[11px]">
              ({filteredRows.length} of {rows.length})
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tool or owner..."
              className="bg-white dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] text-xs px-2.5 py-1 rounded-md text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#3B5BFD] w-48 shadow-2xs"
            />
            <div className="flex items-center gap-1 bg-white dark:bg-[#0F172A] p-0.5 rounded-md border border-[#E5E7EB] dark:border-[#1E293B]">
              <button type="button" onClick={() => setFilter("all")} className={`${pillBase} ${filter === "all" ? pillOn : pillOff}`}>
                All ({rows.length})
              </button>
              <button type="button" onClick={() => setFilter("zombies")} className={`${pillBase} ${filter === "zombies" ? pillOn : pillOff}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Zombies ({zombies.length})
              </button>
              <button type="button" onClick={() => setFilter("active")} className={`${pillBase} ${filter === "active" ? pillOn : pillOff}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Active ({healthy.length})
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-mono uppercase text-gray-400 dark:text-gray-500 border-b border-[#E5E7EB] dark:border-[#1E293B] bg-[#F9FAFB]/50 dark:bg-[#162032]/30">
                <th className="py-2.5 px-3 font-medium">Application</th>
                <th className="py-2.5 px-3 font-medium">Billing owner</th>
                <th className="py-2.5 px-3 font-medium">Monthly cost</th>
                <th className="py-2.5 px-3 font-medium">Last SSO login</th>
                <th className="py-2.5 px-3 font-medium">Audit verdict</th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#1E293B] text-[11px] text-[#111827] dark:text-[#F3F4F6]">
              {filteredRows.map((r) => {
                const c = cancelFor(r.tool);
                const isBusy = busy === r.tool || busy === "*";
                return (
                  <tr
                    key={r.tool}
                    className={`hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors ${
                      r.zombie ? "bg-rose-50/20 dark:bg-rose-950/10" : ""
                    }`}
                  >
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-center font-bold text-xs">
                          {r.tool[0]}
                        </div>
                        <div>
                          <span className="font-semibold text-xs block leading-tight">{r.tool}</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {r.seats != null ? `${r.seats} licensed seats` : "seats not recorded"}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono text-gray-600 dark:text-gray-300">{r.owner ?? DASH}</td>

                    <td className="py-3 px-3 font-mono font-semibold">
                      <span className={r.zombie ? "text-rose-600 font-bold" : ""}>{inr(r.monthly_cost_inr)}</span>
                      <span className="text-gray-400 font-normal text-[10px]"> /mo</span>
                    </td>

                    <td className="py-3 px-3 font-mono">
                      <span className={`block font-medium ${r.zombie ? "text-rose-600" : "text-gray-600 dark:text-gray-300"}`}>
                        {fmtDate(r.last_login)}
                      </span>
                      <span className="text-gray-400 text-[10px]">
                        {r.days_idle == null ? "never logged in" : r.days_idle === 0 ? "active today" : `${r.days_idle} days since last SSO`}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      {r.zombie ? (
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] font-medium border bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800">
                          Zombie{r.days_idle != null ? ` ${DOT} ${r.days_idle}d inactive` : ""}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded font-mono text-[10px] font-medium border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                          Active
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right">
                      {!r.zombie ? (
                        <span className="text-gray-400 text-[10px] font-mono">In use</span>
                      ) : !c ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => act(r.tool, "request")}
                          className="px-2.5 py-1 rounded text-xs font-mono font-medium text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          {isBusy ? "Sending..." : "Request cancellation"}
                        </button>
                      ) : c.status === "pending" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-[10px] text-amber-600">Pending: {c.approver.split(" ")[0]}</span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(r.tool, "approve")}
                            className="px-2 py-1 rounded text-xs font-mono bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(r.tool, "reject")}
                            className="px-2 py-1 rounded text-xs font-mono border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#162032] cursor-pointer disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-[10px] text-emerald-600">Cancellation approved</span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(r.tool, "undo", c.event_id)}
                            className="px-2 py-1 rounded text-xs font-mono border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#162032] cursor-pointer disabled:opacity-50"
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-3 text-center text-gray-400 font-mono">
                    {report ? "No tools match." : "Loading..."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-[#F9FAFB] dark:bg-[#162032]/40 border-t border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between text-xs font-mono text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>
              Rule: flag a tool if days since last login &gt;= {report?.thresholdDays ?? 30}. Source: saas_billing + sso_logins.
            </span>
          </div>
          <span>Total monthly spend: {inr(totalSpend)}</span>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
          <div
            className={`p-3 rounded-lg shadow-lg border bg-white dark:bg-[#0F172A] font-mono text-xs flex items-center gap-2 max-w-sm ${
              toast.error
                ? "border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400"
                : "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{toast.error ? "error" : "verified"}</span>
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}