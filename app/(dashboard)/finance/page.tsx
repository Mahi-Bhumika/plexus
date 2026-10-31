"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardTxn, ExpenseReport, ExpenseResult } from "@/agents/expenses";
import { getCardFeed, getSavedReceipts, runReceipts } from "@/lib/finance-client";

const inr = (n: number | null | undefined) =>
  n == null ? "-" : `₹${Math.round(n).toLocaleString("en-IN")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);

const PILL: Record<ExpenseResult["status"], string> = {
  ok: "border-emerald-500/40 text-emerald-400",
  violation: "border-red-500/40 text-red-400",
  review: "border-amber-500/40 text-amber-400",
};
const LABEL: Record<ExpenseResult["status"], string> = {
  ok: "Within policy",
  violation: "Violation",
  review: "Needs review",
};

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className="flex-1 px-6 py-5 text-center">
      <div className={`text-4xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

export default function FinancePage() {
  const [rows, setRows] = useState<ExpenseResult[]>([]);
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [feed, setFeed] = useState<CardTxn[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [saved, cards] = await Promise.all([getSavedReceipts(), getCardFeed()]);
      if (!alive.current) return;
      setRows(saved.receipts);
      setFeed(cards.txns);
      setAsOf(cards.asOf);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setRunning(true);
    setError(null);
    try {
      const rep = await runReceipts();
      if (!alive.current) return;
      setRows([]);
      for (const r of rep.receipts) {
        if (!alive.current) return;
        setRows((p) => [...p, r]);
        await sleep(400);
      }
      setReport(rep);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setRunning(false);
    }
  }

  const ok = rows.filter((r) => r.status === "ok").length;
  const flagged = rows.filter((r) => r.status !== "ok");
  const claimed = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const approved = rows.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  const matchedIds = new Set(rows.flatMap((r) => (r.card ? [r.card.txn_id] : [])));
  const scanned = rows.length > 0;
  const noReceipt = scanned ? feed.filter((t) => !matchedIds.has(t.txn_id)).length : 0;

  return (
    <div className="min-h-full bg-[#0b1120] p-8 text-slate-200">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold text-white">Finance Agent</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Receipt reading with vision, expense policy checks, duplicate detection and card-feed
            reconciliation. Every flag comes with a reason.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
          Live data{asOf ? ` · as of ${asOf.slice(0, 10)}` : ""}
        </span>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={scan}
          disabled={running || loading}
          className="rounded-lg bg-[#5046E5] px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          {running ? "Reading receipts…" : scanned ? "Scan receipts again" : "Scan receipts"}
        </button>
        {running && (
          <span className="text-sm text-slate-400">
            Reading each receipt with Gemini vision. This can take a minute.
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mb-3 flex divide-x divide-slate-800 rounded-xl border border-slate-800 bg-[#0c1424]">
        <Stat value={rows.length} label="Receipts scanned" tone="text-white" />
        <Stat value={ok} label="Within policy" tone="text-emerald-400" />
        <Stat value={flagged.length} label="Flagged" tone="text-amber-400" />
        <Stat value={noReceipt} label="Card txns without receipt" tone="text-amber-400" />
      </div>
      <p className="mb-6 font-mono text-xs text-slate-500">
        receipts · {rows.length} scanned · {inr(claimed)} claimed · {inr(approved)} approvable
      </p>

      {flagged.map((r) => {
        const first = r.issues.find((i) => i.severity === "violation") ?? r.issues[0];
        return (
          <div key={r.id} className="mb-3 rounded-xl border border-amber-500/30 bg-[#1a1209] p-4">
            <div className="font-medium text-white">
              {r.extraction?.merchant ?? r.file} · {inr(r.total)} · {LABEL[r.status]}
            </div>
            {first && <div className="mt-1 text-sm text-slate-400">{first.message}</div>}
          </div>
        );
      })}

      <div className="mb-8 overflow-x-auto rounded-xl border border-slate-800 bg-[#0c1424]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
              {["Receipt", "Date", "Type", "Base", "GST", "Total", "Approvable", "Approver", "Conf", "Status"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                  {loading ? "Loading…" : "No receipts scanned yet. Press Scan receipts."}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <>
                <tr key={r.id} className="border-b border-slate-800/60">
                  <td className="px-4 py-3 text-white">{r.extraction?.merchant ?? r.file}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{r.extraction?.date ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-400">{(r.type ?? "other").replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 font-mono">{inr(r.extraction?.subtotal)}</td>
                  <td className="px-4 py-3 font-mono">{inr(r.extraction?.gst)}</td>
                  <td className="px-4 py-3 font-mono text-white">{inr(r.total)}</td>
                  <td className="px-4 py-3 font-mono">{inr(r.approvedAmount)}</td>
                  <td className="px-4 py-3 text-slate-400">{r.approver ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-emerald-400">{Math.round((r.confidence ?? 0) * 100)}%</td>
                  <td className="px-4 py-3"><Pill cls={PILL[r.status]}>{LABEL[r.status]}</Pill></td>
                </tr>
                {r.issues.length > 0 && (
                  <tr key={`${r.id}-issues`} className="border-b border-slate-800/60 bg-[#0a1020]">
                    <td colSpan={10} className="px-4 py-2 text-xs text-slate-400">
                      {r.issues.map((i) => (
                        <div key={i.code + i.message}>
                          <span className={i.severity === "violation" ? "text-red-400" : "text-amber-400"}>
                            {i.severity}
                          </span>{" "}
                          · {i.message}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-white">Card feed reconciliation</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0c1424]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
              {["Txn", "Date", "Merchant", "Card holder", "Category", "Amount", "Receipt"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {feed.map((t) => {
              const matched = matchedIds.has(t.txn_id);
              const left = asOf ? 15 - daysBetween(asOf, t.date) : null;
              return (
                <tr key={t.txn_id} className="border-b border-slate-800/60">
                  <td className="px-4 py-3 font-mono text-slate-500">{t.txn_id}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{t.date}</td>
                  <td className="px-4 py-3 text-white">{t.merchant}</td>
                  <td className="px-4 py-3 text-slate-400">{t.card_holder}</td>
                  <td className="px-4 py-3 text-slate-400">{t.category}</td>
                  <td className="px-4 py-3 font-mono">{inr(t.amount_inr)}</td>
                  <td className="px-4 py-3">
                    {!scanned ? (
                      <Pill cls="border-slate-600 text-slate-400">Not scanned</Pill>
                    ) : matched ? (
                      <Pill cls={PILL.ok}>Matched</Pill>
                    ) : (
                      <Pill cls={PILL.review}>
                        No receipt{left != null ? ` · ${Math.max(left, 0)}d left` : ""}
                      </Pill>
                    )}
                  </td>
                </tr>
              );
            })}
            {feed.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Card feed is empty. Run scripts/load-finance.ts.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {report && (
        <p className="mt-3 font-mono text-xs text-slate-500">
          {report.totals.violations} violations · {report.totals.needsReview} need review · {report.unmatchedTransactions.length} card txns chased
        </p>
      )}
    </div>
  );
}
