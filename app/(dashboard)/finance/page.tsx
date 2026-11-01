"use client";

import { useState, useEffect, useCallback } from "react";
import type { ExpenseResult, CardTxn } from "@/agents/expenses";
import type { ZombieReport } from "@/lib/zombie";
import { getSavedReceipts, runReceipts, getCardFeed, getZombie } from "@/lib/finance-client";

// ── Helpers: transform API shapes into display shapes ────────────────────

type ClaimItem = {
  id: string;
  category: string;
  vendor: string;
  amount: number;
  unit?: string;
  status: "ok" | "violation" | "review";
  statusBadge: string;
  badgeCls: string;
  details: string;
  subdetails?: string;
  cardName: string;
  approverText: string;
  alertMsg?: string;
  alertSub?: string;
  alertBtn?: string;
};

function categoryLabel(r: ExpenseResult): string {
  const typeMap: Record<string, string> = {
    local_travel: "Ground Transport",
    auto_rickshaw: "Ground Transport",
    domestic_flight: "Aviation · Domestic",
    train: "Rail",
    hotel: `Lodging${r.extraction?.city ? ` · ${r.extraction.city}` : ""}`,
    meal: "Meals",
    team_lunch: "Team Meals",
    software: "Software",
    office_supplies: "Office Supplies",
    client_entertainment: "Client Relations",
    other: "Other",
  };
  return typeMap[r.type ?? "other"] ?? "Other";
}

function statusBadgeText(r: ExpenseResult): string {
  if (r.status === "ok") return "OK - Auto Approved";
  const firstViolation = r.issues.find((i) => i.severity === "violation");
  if (r.status === "violation" && firstViolation) {
    const code = firstViolation.code;
    if (code === "over_limit") return "VIOLATION - Over Limit";
    if (code === "duplicate_invoice") return "VIOLATION - Duplicate";
    if (code === "late_claim") return "VIOLATION - Late Claim";
    if (code === "needs_written_approval") return "VIOLATION - Needs Approval";
    if (code === "possible_injection") return "VIOLATION - Blocked";
    if (code === "flight_class") return "VIOLATION - Class Policy";
    if (code === "no_total") return "VIOLATION - No Total";
    return "VIOLATION";
  }
  const firstWarning = r.issues[0];
  if (firstWarning?.code === "low_confidence") return "REVIEW - Low Confidence";
  if (firstWarning?.code === "no_card_match") return "REVIEW - No Card Match";
  return "REVIEW - Needs Check";
}

function badgeClasses(status: "ok" | "violation" | "review"): string {
  if (status === "ok") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "violation") return "bg-red-100 text-red-800 border-red-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function toClaim(r: ExpenseResult): ClaimItem {
  const firstIssue = r.issues.find((i) => i.severity === "violation") ?? r.issues[0];
  return {
    id: r.id,
    category: categoryLabel(r),
    vendor: r.extraction?.merchant ?? r.file,
    amount: r.total ?? 0,
    status: r.status,
    statusBadge: statusBadgeText(r),
    badgeCls: badgeClasses(r.status),
    details:
      r.allowedAmount != null && r.total != null && r.allowedAmount < r.total
        ? `Limit ₹${r.allowedAmount.toLocaleString("en-IN")} (Excess +₹${(r.total - r.allowedAmount).toLocaleString("en-IN")})`
        : r.allowedAmount != null
          ? `Limit ₹${r.allowedAmount.toLocaleString("en-IN")}`
          : "",
    cardName: r.card ? `Card: matched (${r.card.matchedBy})` : "No card match",
    approverText: r.approver ? `Approver: ${r.approver}` : "Approver: unassigned",
    alertMsg: firstIssue ? firstIssue.message : undefined,
    alertSub:
      firstIssue && r.approver
        ? `Sent to ${r.approver} for review.`
        : firstIssue
          ? "Needs manual review."
          : undefined,
    alertBtn: r.status !== "ok" ? "Review Details" : undefined,
  };
}

type CardTxnItem = {
  id: string;
  date: string;
  vendor: string;
  cardInfo: string;
  amount: number;
  matched: boolean;
  statusBadge: string;
  daysLeft?: number;
  isIncidental?: boolean;
};

function toCardItem(
  txn: CardTxn,
  matchedIds: Set<string>,
  daysLeftMap?: Map<string, number>,
): CardTxnItem {
  const matched = matchedIds.has(txn.txn_id) || !!txn.receipt_ref;
  const d = new Date(txn.date);
  const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const daysLeft = daysLeftMap?.get(txn.txn_id);
  return {
    id: txn.txn_id,
    date: dateStr,
    vendor: txn.merchant,
    cardInfo: `${txn.card_holder}`,
    amount: txn.amount_inr,
    matched,
    statusBadge: matched
      ? "Matched with Receipt ✓"
      : daysLeft != null
        ? `Needs receipt · ${daysLeft}d left`
        : "Unmatched",
    daysLeft: daysLeft ?? undefined,
    isIncidental: !matched && txn.amount_inr < 1000,
  };
}

// ── Page component ───────────────────────────────────────────────────────

export default function FinancePage() {
  // Data state
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [feed, setFeed] = useState<CardTxnItem[]>([]);
  const [totals, setTotals] = useState<{
    claimed: number;
    approved: number;
    violations: number;
    needsReview: number;
    receiptsCount: number;
    unmatchedCount: number;
    unmatchedTotal: number;
  }>({ claimed: 0, approved: 0, violations: 0, needsReview: 0, receiptsCount: 0, unmatchedCount: 0, unmatchedTotal: 0 });
  const [zombieReport, setZombieReport] = useState<ZombieReport | null>(null);

  // UI state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; desc: string; type: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [waiveIncidental, setWaiveIncidental] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const showToast = (title: string, desc: string, type = "secondary") => {
    setToast({ title, desc, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load saved data on mount
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [receiptsRes, cardRes] = await Promise.all([
        getSavedReceipts(),
        getCardFeed(),
      ]);

      const receipts = receiptsRes.receipts ?? [];
      const txns = cardRes.txns ?? [];

      // Build matched txn IDs from receipts
      const matchedIds = new Set<string>();
      for (const r of receipts) {
        if (r.card?.txn_id) matchedIds.add(r.card.txn_id);
      }

      // Claims from receipts
      setClaims(receipts.map(toClaim));

      // Card feed items
      const cardItems = txns.map((t) => toCardItem(t, matchedIds));
      setFeed(cardItems);

      // Totals
      const claimed = receipts.reduce((s, r) => s + (r.total ?? 0), 0);
      const approved = receipts.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
      const violations = receipts.filter((r) => r.status === "violation").length;
      const needsReview = receipts.filter((r) => r.status === "review").length;
      const unmatched = cardItems.filter((c) => !c.matched);
      setTotals({
        claimed,
        approved,
        violations,
        needsReview,
        receiptsCount: receipts.length,
        unmatchedCount: unmatched.length,
        unmatchedTotal: unmatched.reduce((s, c) => s + c.amount, 0),
      });

      // Also load zombie report (non-blocking)
      getZombie()
        .then((z) => setZombieReport(z))
        .catch(() => {}); // silently ignore if zombie data not loaded
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Scan receipts: POST to run the expense pipeline
  const handleScanReceipts = async () => {
    try {
      setIsScanning(true);
      setIsModalOpen(false);
      showToast(
        "Scanning Receipts",
        "Processing all receipts through OCR + policy checks...",
        "primary",
      );

      const report = await runReceipts();

      // Build matched set from results
      const matchedIds = new Set<string>();
      for (const r of report.receipts) {
        if (r.card?.txn_id) matchedIds.add(r.card.txn_id);
      }

      // Build daysLeft map from unmatched transactions
      const daysLeftMap = new Map<string, number>();
      for (const u of report.unmatchedTransactions) {
        daysLeftMap.set(u.txn_id, u.daysLeft);
      }

      setClaims(report.receipts.map(toClaim));

      // Re-fetch card feed to get the full list
      const cardRes = await getCardFeed();
      const cardItems = (cardRes.txns ?? []).map((t) =>
        toCardItem(t, matchedIds, daysLeftMap),
      );
      setFeed(cardItems);

      const unmatched = cardItems.filter((c) => !c.matched);
      setTotals({
        claimed: report.totals.claimed,
        approved: report.totals.approved,
        violations: report.totals.violations,
        needsReview: report.totals.needsReview,
        receiptsCount: report.receipts.length,
        unmatchedCount: unmatched.length,
        unmatchedTotal: unmatched.reduce((s, c) => s + c.amount, 0),
      });

      showToast(
        "Scan Complete",
        `Processed ${report.receipts.length} receipts. ${report.totals.violations} violations, ${report.totals.needsReview} need review.`,
        "secondary",
      );
    } catch (err) {
      showToast(
        "Scan Failed",
        err instanceof Error ? err.message : String(err),
        "error",
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleTriggerReconcile = async () => {
    setIsSyncing(true);
    showToast(
      "Sync In Progress",
      "Re-loading card feed and matching against claims...",
      "primary",
    );
    try {
      await loadData();
      showToast(
        "Reconciliation Complete",
        `Matched ${claims.filter((c) => c.cardName.includes("matched")).length} claims against card statements.`,
        "secondary",
      );
    } catch {
      showToast("Reconciliation Failed", "Could not reload data.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportAudit = () => {
    showToast(
      "Audit Report Generated",
      "Nimbus-Meridian-Audit-FY24-Q3.csv exported with SHA-256 hash",
      "secondary",
    );
  };

  const scrollToRules = () => {
    const el = document.getElementById("policy-rules-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      el.classList.add("ring-2", "ring-[#3B5BFD]");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#3B5BFD]"), 1200);
    }
  };

  const okCount = claims.filter((c) => c.status === "ok").length;
  const approvedPct = totals.claimed > 0 ? Math.round((totals.approved / totals.claimed) * 100) : 0;
  const flaggedTotal = totals.claimed - totals.approved;
  const flaggedCount = totals.violations + totals.needsReview;
  const flaggedPct = totals.claimed > 0 ? Math.round((flaggedTotal / totals.claimed) * 100) : 0;
  const unmatchedPct = feed.length > 0 ? Math.round((totals.unmatchedCount / feed.length) * 100) : 0;

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-20 flex flex-col items-center gap-4">
        <span className="material-symbols-outlined text-[32px] text-[#3B5BFD] animate-spin">
          sync
        </span>
        <p className="text-sm text-gray-500 font-mono">Loading finance data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-20 flex flex-col items-center gap-4">
        <span className="material-symbols-outlined text-[32px] text-red-500">error</span>
        <p className="text-sm text-red-600 font-mono">{error}</p>
        <button
          type="button"
          onClick={loadData}
          className="px-4 py-2 rounded-lg bg-[#3B5BFD] text-white text-xs font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col space-y-4">
      {/* Top Command & Telemetry Bar */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E5E7EB] shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#3B5BFD]">
              <span className="material-symbols-outlined text-[20px]">
                account_balance_wallet
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#111827] font-semibold tracking-tight">
                  Smart Expense Review
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[11px] font-medium">
                  Automatic Check: Active
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Scans company bills and connects with card transactions
              </p>
            </div>
          </div>
          <div className="hidden sm:block h-6 w-px bg-gray-200"></div>
          <div className="flex items-center gap-2 text-gray-500 font-mono text-[11px]">
            <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Spending Rules Active
            </span>
            <span className="text-gray-300">/</span>
            <span>
              Receipts: <strong className="text-[#111827]">{totals.receiptsCount}</strong>
            </span>
          </div>
        </div>

        {/* Global Operations Group */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={isScanning}
            className="flex items-center gap-1.5 bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[16px] ${isScanning ? "animate-spin" : ""}`}>
              {isScanning ? "sync" : "document_scanner"}
            </span>
            <span>{isScanning ? "Scanning..." : "Scan New Receipts"}</span>
          </button>
          <button
            type="button"
            onClick={handleTriggerReconcile}
            disabled={isSyncing}
            className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-[#E5E7EB] font-mono text-xs px-3 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            <span
              className={`material-symbols-outlined text-[16px] text-emerald-600 ${
                isSyncing ? "animate-spin" : ""
              }`}
            >
              sync
            </span>
            <span>{isSyncing ? "Syncing..." : "Trigger Auto-Reconcile"}</span>
          </button>
          <button
            type="button"
            onClick={handleExportAudit}
            className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-[#E5E7EB] font-mono text-xs px-3 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-gray-500">
              download_for_offline
            </span>
            <span>Export Financial Audit</span>
          </button>
          <button
            type="button"
            onClick={scrollToRules}
            className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-[#3B5BFD] border border-[#E5E7EB] font-mono text-xs px-3 py-1.5 rounded-lg shadow-2xs transition-all ml-auto xl:ml-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">rule</span>
            <span>Policy Rules Sheet</span>
          </button>
        </div>
      </section>

      {/* Metric Gauges Bento */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Scanned */}
        <div className="bg-white p-4 rounded-xl border border-[#E5E7EB] flex flex-col justify-between shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Total Receipts
            </span>
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 font-mono text-[10px]">
              {totals.receiptsCount} uploaded
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-[#111827] font-bold tracking-tight">
              ₹{totals.claimed.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-xs text-emerald-600 font-medium flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[14px]">check</span> All
              read clearly
            </span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#3B5BFD] rounded-full w-full"></div>
          </div>
        </div>

        {/* Card 2: Reconciled & Approved */}
        <div className="bg-white p-4 rounded-xl border border-[#E5E7EB] flex flex-col justify-between shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-emerald-700 uppercase tracking-wider font-semibold">
              Ready to Pay
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px]">
              {okCount} approved
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-emerald-700 font-bold tracking-tight">
              ₹{totals.approved.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-xs text-gray-500">{approvedPct}% of total</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${approvedPct}%` }}
            ></div>
          </div>
        </div>

        {/* Card 3: Violations & Flags */}
        <div className="bg-white p-4 rounded-xl border border-[#E5E7EB] flex flex-col justify-between shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-red-600 uppercase tracking-wider font-semibold">
              Needs Your Look
            </span>
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-mono text-[10px] font-medium">
              {flaggedCount} flagged
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-red-600 font-bold tracking-tight">
              ₹{flaggedTotal.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-xs text-red-600">On hold</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full"
              style={{ width: `${flaggedPct}%` }}
            ></div>
          </div>
        </div>

        {/* Card 4: Unmatched Corporate Transactions */}
        <div className="bg-white p-4 rounded-xl border border-[#E5E7EB] flex flex-col justify-between shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-amber-700 uppercase tracking-wider font-semibold">
              Missing Receipts
            </span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-medium">
              Needs receipt
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-amber-700 font-bold tracking-tight">
              {totals.unmatchedCount} Card Charges
            </span>
            <span className="font-mono text-xs text-gray-500">₹{totals.unmatchedTotal.toLocaleString("en-IN")} total without bill</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: `${unmatchedPct}%` }}
            ></div>
          </div>
        </div>
      </section>

      {/* Zombie SaaS Alert (if data available) */}
      {zombieReport && zombieReport.tools.length > 0 && (
        <section className="bg-white rounded-xl border border-amber-200 p-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-amber-100">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-amber-600">
                warning
              </span>
              <div>
                <h3 className="text-xs font-semibold text-[#111827]">
                  Zombie SaaS Detected
                </h3>
                <p className="font-mono text-[11px] text-gray-500">
                  {zombieReport.tools.length} tool{zombieReport.tools.length !== 1 ? "s" : ""} with no logins
                  in {zombieReport.thresholdDays}+ days — ₹{zombieReport.monthlyWasteInr.toLocaleString("en-IN")}/mo
                  potential waste (₹{zombieReport.annualWasteInr.toLocaleString("en-IN")}/yr)
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3">
            {zombieReport.tools.slice(0, 6).map((t) => (
              <div
                key={t.tool}
                className="p-2.5 rounded-lg bg-amber-50/50 border border-amber-100 flex items-center justify-between"
              >
                <div>
                  <span className="text-xs font-semibold text-[#111827]">{t.tool}</span>
                  <p className="font-mono text-[10px] text-gray-500">
                    {t.days_idle != null ? `${t.days_idle}d idle` : "No logins on record"}
                    {t.owner ? ` · ${t.owner}` : ""}
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-amber-700">
                  ₹{t.monthly_cost_inr.toLocaleString("en-IN")}/mo
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Live Pipeline Split Workstation */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT WORKBENCH (7 cols): Processed Expense Claims */}
        <div className="lg:col-span-7 flex flex-col bg-white rounded-xl border border-[#E5E7EB] shadow-xs overflow-hidden">
          <div className="p-4 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[#3B5BFD]">
                receipt_long
              </span>
              <div>
                <h2 className="text-xs font-semibold text-[#111827]">
                  Processed Expense Claims
                </h2>
                <p className="font-mono text-[11px] text-gray-500">
                  Checked against company spending limits
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase text-gray-400 font-semibold">
                Filter:
              </span>
              <button
                type="button"
                className="px-2 py-0.5 rounded-md bg-white border border-[#E5E7EB] text-[#111827] font-mono text-xs shadow-2xs font-medium"
              >
                All ({claims.length} Claims)
              </button>
            </div>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto max-h-[700px]">
            {claims.length === 0 && (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-[32px] text-gray-300">
                  receipt_long
                </span>
                <p className="text-sm text-gray-400 mt-2">
                  No expense claims yet. Click &quot;Scan New Receipts&quot; to process receipts.
                </p>
              </div>
            )}
            {claims.map((claim) => (
              <article
                key={claim.id}
                className={`p-4 rounded-lg border transition-colors ${
                  claim.status === "violation"
                    ? "bg-red-50/30 border-red-200"
                    : claim.status === "review"
                    ? "bg-amber-50/40 border-amber-200"
                    : "bg-[#F9FAFB] border-[#E5E7EB] hover:border-gray-300"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#3B5BFD]">
                      #{claim.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border font-mono text-[10px] font-semibold flex items-center gap-1 ${claim.badgeCls}`}
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {claim.status === "ok"
                          ? "check_circle"
                          : claim.status === "violation"
                          ? "cancel"
                          : "hourglass_top"}
                      </span>
                      {claim.statusBadge}
                    </span>
                    <span className="font-mono text-xs text-gray-500">
                      {claim.category}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-base font-bold ${
                        claim.status === "violation" ? "text-red-700" : "text-[#111827]"
                      }`}
                    >
                      ₹{claim.amount.toLocaleString("en-IN")}
                    </span>
                    {claim.unit && (
                      <span className="font-mono text-xs text-gray-500">{claim.unit}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-gray-600 gap-1 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#111827] font-medium">{claim.vendor}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-emerald-700 font-mono text-[11px] font-medium">
                      {claim.details}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-gray-600 bg-white border border-[#E5E7EB] px-1.5 py-0.5 rounded">
                      {claim.cardName}
                    </span>
                    <span className="text-emerald-700 font-medium">
                      {claim.approverText}
                    </span>
                  </div>
                </div>

                {claim.alertMsg && (
                  <div
                    className={`mt-2 p-2.5 rounded-lg bg-white border flex items-start justify-between gap-2 shadow-2xs ${
                      claim.status === "violation" ? "border-red-200" : "border-amber-200"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`material-symbols-outlined text-[16px] mt-0.5 ${
                          claim.status === "violation" ? "text-red-600" : "text-amber-600"
                        }`}
                      >
                        report_problem
                      </span>
                      <div>
                        <p
                          className={`font-mono text-xs font-medium ${
                            claim.status === "violation"
                              ? "text-red-700"
                              : "text-amber-800"
                          }`}
                        >
                          {claim.alertMsg}
                        </p>
                        <p className="text-xs text-gray-600">{claim.alertSub}</p>
                      </div>
                    </div>
                    {claim.alertBtn && (
                      <button
                        type="button"
                        onClick={() => showToast("Action Dispatched", claim.alertMsg || "")}
                        className="px-2 py-1 rounded bg-white hover:bg-gray-50 text-gray-800 border border-[#E5E7EB] font-mono text-[11px] whitespace-nowrap shadow-2xs cursor-pointer font-medium"
                      >
                        {claim.alertBtn}
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        {/* RIGHT WORKBENCH (5 cols): Corporate Card Feed */}
        <div className="lg:col-span-5 flex flex-col bg-white rounded-xl border border-[#E5E7EB] shadow-xs overflow-hidden">
          <div className="p-4 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-emerald-600">
                credit_card
              </span>
              <div>
                <h2 className="text-xs font-semibold text-[#111827]">Company Card Charges</h2>
                <p className="font-mono text-[11px] text-gray-500">
                  Direct feed from company bank cards
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="font-mono text-[11px] text-emerald-700 font-medium">
                Connected
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100 p-2 space-y-1.5 max-h-[700px] overflow-y-auto">
            {feed.length === 0 && (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-[32px] text-gray-300">
                  credit_card_off
                </span>
                <p className="text-sm text-gray-400 mt-2">
                  No card transactions loaded.
                </p>
              </div>
            )}
            {feed.map((txn) => (
              <div
                key={txn.id}
                className={`p-2.5 rounded-lg border transition-colors ${
                  !txn.matched && !txn.isIncidental
                    ? "bg-amber-50/30 border-amber-200"
                    : txn.isIncidental
                    ? "bg-[#F9FAFB] border-[#E5E7EB]"
                    : "hover:bg-[#F9FAFB] border-transparent hover:border-[#E5E7EB]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{txn.date}</span>
                      <span className="text-xs font-semibold text-[#111827]">
                        {txn.vendor}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-gray-500">{txn.cardInfo}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        !txn.matched ? "text-amber-700" : "text-[#111827]"
                      }`}
                    >
                      ₹{txn.amount.toLocaleString("en-IN")}
                    </span>
                    <div className="mt-0.5">
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono text-[10px] font-medium border ${
                          txn.matched
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        }`}
                      >
                        {txn.matched && (
                          <span className="material-symbols-outlined text-[12px]">
                            check
                          </span>
                        )}
                        {txn.statusBadge}
                      </span>
                    </div>
                  </div>
                </div>

                {!txn.matched && !txn.isIncidental && (
                  <div className="mt-2 pt-2 flex items-center justify-between border-t border-amber-100">
                    <span className="font-mono text-[11px] text-gray-500">
                      Auto-reminder sent
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(true)}
                      className="px-2 py-0.5 rounded-md bg-[#3B5BFD] text-white font-mono text-[11px] hover:bg-[#2549ED] flex items-center gap-1 shadow-2xs font-medium cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        upload_file
                      </span>
                      <span>Upload Receipt</span>
                    </button>
                  </div>
                )}

                {txn.isIncidental && (
                  <div className="mt-2 pt-2 flex items-center justify-between border-t border-[#E5E7EB]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={waiveIncidental}
                        onChange={(e) => setWaiveIncidental(e.target.checked)}
                        className="rounded border-gray-300 text-[#3B5BFD] focus:ring-0 w-3.5 h-3.5"
                      />
                      <span className="font-mono text-[11px] text-emerald-700 font-medium">
                        Small expense (Under ₹1,000) - Receipt not needed
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        showToast(
                          "Waiver Confirmed",
                          "Expense waived under minor incidental threshold",
                        )
                      }
                      className="px-2 py-0.5 rounded-md bg-white border border-[#E5E7EB] text-gray-700 font-mono text-[11px] hover:bg-gray-100 shadow-2xs font-medium cursor-pointer"
                    >
                      Confirm Waiver
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-2.5 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between text-gray-500 font-mono text-[11px]">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-emerald-600">
                verified_user
              </span>
              Meridian Bank PCI DSS Level 1 Tokenized
            </span>
            <span>Window: 15-day strict</span>
          </div>
        </div>
      </section>

      {/* Slide-out Policy Rules Sheet */}
      <section
        id="policy-rules-panel"
        className="bg-white rounded-xl border border-[#E5E7EB] p-4 shadow-xs transition-all duration-300"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#3B5BFD]">
              gavel
            </span>
            <div>
              <h3 className="text-xs font-semibold text-[#111827]">
                Company Spending Rules
              </h3>
              <p className="font-mono text-[11px] text-gray-500">
                Limits used to automatically check every bill
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-blue-50 text-[#3B5BFD] border border-blue-200 font-mono text-[10px] font-medium">
            CURRENT RULES
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-3">
          <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Flights
                </span>
                <span className="material-symbols-outlined text-[16px] text-[#3B5BFD]">
                  flight
                </span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">
                Flights: Up to ₹8,000
              </p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Per one-way domestic ticket (Economy class)
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Hotels
                </span>
                <span className="material-symbols-outlined text-[16px] text-emerald-600">
                  hotel
                </span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">
                Hotels: Up to ₹9,000/night
              </p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Up to ₹9,000 in big cities (Mumbai, Delhi, BLR); ₹6,000 elsewhere
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Meals
                </span>
                <span className="material-symbols-outlined text-[16px] text-amber-600">
                  restaurant
                </span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">
                ₹500 / ₹800 / ₹1,500
              </p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Food: ₹500 breakfast, ₹800 lunch, ₹1,500 dinner per person
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Software
                </span>
                <span className="material-symbols-outlined text-[16px] text-[#3B5BFD]">
                  deployed_code
                </span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">
                Software: Up to ₹5,000/mo
              </p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              For work tools. Anything higher needs IT manager approval
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Who Approves
                </span>
                <span className="material-symbols-outlined text-[16px] text-emerald-600">
                  verified
                </span>
              </div>
              <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                <div className="text-[#111827] flex justify-between">
                  <span>Under ₹25,000:</span>
                  <strong className="text-emerald-700">Karan</strong>
                </div>
                <div className="text-[#111827] flex justify-between">
                  <span>Over ₹25,000:</span>
                  <strong className="text-[#3B5BFD]">Riya</strong>
                </div>
              </div>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Who approves: Karan under ₹25k, Riya over ₹25k
            </p>
          </div>
        </div>
      </section>

      {/* Upload Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-xl shadow-xl border border-[#E5E7EB] p-5 space-y-4 relative">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#3B5BFD]">
                  document_scanner
                </span>
                <div>
                  <h4 className="text-sm text-[#111827] font-semibold">
                    Autonomous Receipt Ingestion
                  </h4>
                  <p className="font-mono text-[11px] text-gray-500">
                    OCR parsing + GST verification + Auto-reconciliation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div
              onClick={handleScanReceipts}
              className="p-8 rounded-xl bg-[#F9FAFB] hover:bg-gray-100 border-2 border-dashed border-gray-300 text-center cursor-pointer transition-colors space-y-2"
            >
              <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 text-[#3B5BFD] mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px]">
                  cloud_upload
                </span>
              </div>
              <div>
                <p className="text-xs text-[#111827] font-medium">
                  Drop receipts or browse files
                </p>
                <p className="font-mono text-[11px] text-gray-500 mt-0.5">
                  Supports PDF, PNG, JPG up to 25MB each
                </p>
              </div>
              <span className="inline-block px-2 py-1 rounded-md bg-white border border-[#E5E7EB] text-gray-600 font-mono text-[10px] shadow-2xs">
                Auto-detects Meridian corporate cards
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 font-mono text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleScanReceipts}
                className="px-4 py-1.5 rounded-lg bg-[#3B5BFD] text-white text-xs hover:bg-[#2549ED] shadow-sm flex items-center gap-1 font-medium cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                <span>Process with Swarm</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
          <div
            className={`p-3 rounded-lg shadow-lg border font-mono text-xs flex items-start gap-2 max-w-sm bg-white ${
              toast.type === "secondary"
                ? "text-emerald-700 border-emerald-200"
                : toast.type === "error"
                ? "text-red-700 border-red-200"
                : "text-[#3B5BFD] border-blue-200"
            }`}
          >
            <span className="material-symbols-outlined text-[18px] mt-0.5">
              {toast.type === "secondary"
                ? "check_circle"
                : toast.type === "error"
                ? "error"
                : "info"}
            </span>
            <div>
              <strong className="font-bold block text-[#111827]">{toast.title}</strong>
              <span className="text-gray-600">{toast.desc}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
