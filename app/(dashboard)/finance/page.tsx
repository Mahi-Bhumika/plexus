"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ExpenseResult, CardTxn, ExpenseReport } from "@/agents/expenses";
import type { ZombieReport } from "@/lib/zombie";
import {
  getSavedReceipts,
  runReceipts,
  getCardFeed,
  getZombie,
  exportAuditReport,
} from "@/lib/finance-client";

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
  if (status === "ok") return "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50";
  if (status === "violation") return "bg-red-100 dark:bg-rose-950/40 text-red-800 dark:text-rose-400 border-red-200 dark:border-rose-900/50";
  return "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/50";
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
  }>({
    claimed: 0,
    approved: 0,
    violations: 0,
    needsReview: 0,
    receiptsCount: 0,
    unmatchedCount: 0,
    unmatchedTotal: 0,
  });
  const [zombieReport, setZombieReport] = useState<ZombieReport | null>(null);

  // UI state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"folder" | "path">("path");
  const [toast, setToast] = useState<{ title: string; desc: string; type: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [waiveIncidental, setWaiveIncidental] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Folder selection state
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [customServerDir, setCustomServerDir] = useState<string>("seed/finance/receipts");

  const showToast = (title: string, desc: string, type = "secondary") => {
    setToast({ title, desc, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Helper to re-map report into state
  const updateReportData = useCallback(async (report: ExpenseReport) => {
    const matchedIds = new Set<string>();
    for (const r of report.receipts) {
      if (r.card?.txn_id) matchedIds.add(r.card.txn_id);
    }
    const daysLeftMap = new Map<string, number>();
    for (const u of report.unmatchedTransactions) {
      daysLeftMap.set(u.txn_id, u.daysLeft);
    }
    setClaims(report.receipts.map(toClaim));

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
  }, []);

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

      const matchedIds = new Set<string>();
      for (const r of receipts) {
        if (r.card?.txn_id) matchedIds.add(r.card.txn_id);
      }

      setClaims(receipts.map(toClaim));

      const cardItems = txns.map((t) => toCardItem(t, matchedIds));
      setFeed(cardItems);

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

      getZombie()
        .then((z) => setZombieReport(z))
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle folder chosen via HTML folder picker
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const allFiles = Array.from(fileList);
    const imageFiles = allFiles.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));

    let folderName = "Selected Folder";
    if (allFiles[0]?.webkitRelativePath) {
      const parts = allFiles[0].webkitRelativePath.split("/");
      if (parts.length > 1) {
        folderName = parts[0];
      }
    }

    setSelectedFolderName(folderName);
    setSelectedFiles(imageFiles);

    if (imageFiles.length === 0) {
      showToast(
        "No Receipt Images",
        `Folder "${folderName}" contains no supported images (.png, .jpg, .webp).`,
        "error",
      );
    } else {
      showToast(
        "Folder Loaded",
        `Found ${imageFiles.length} receipt image(s) in "${folderName}".`,
        "primary",
      );
    }
  };

  // 1. Scan a server directory path explicitly
  const handleScanServerPath = async (dirPath: string) => {
    try {
      setIsScanning(true);
      setIsModalOpen(false);
      showToast(
        "Checking Receipts Path",
        `Scanning receipts from "${dirPath}"...`,
        "primary",
      );

      const report = await runReceipts({ dir: dirPath });
      await updateReportData(report);

      showToast(
        "Scan Complete",
        `Processed ${report.receipts.length} receipts: ${report.totals.violations} violations, ${report.totals.needsReview} need review.`,
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

  // 2. Scan uploaded files from chosen computer folder explicitly
  const handleScanUploadedFolder = async () => {
    if (selectedFiles.length === 0) {
      showToast("No Folder Selected", "Please select a folder containing receipt images first.", "error");
      return;
    }

    try {
      setIsScanning(true);
      setIsModalOpen(false);
      showToast(
        "Checking Uploaded Receipts",
        `Uploading and scanning ${selectedFiles.length} receipt(s) from "${selectedFolderName}"...`,
        "primary",
      );

      const report = await runReceipts({ files: selectedFiles });
      await updateReportData(report);

      setSelectedFiles([]);
      setSelectedFolderName(null);

      showToast(
        "Folder Scan Complete",
        `Processed ${report.receipts.length} receipts: ${report.totals.violations} violations, ${report.totals.needsReview} need review.`,
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

  // REAL CSV EXPORT FUNCTION: Downloads the financial audit report file
  const handleExportAudit = async () => {
    try {
      setIsExporting(true);
      showToast(
        "Generating Financial Audit",
        "Exporting certified Nimbus-Meridian audit report with SHA-256 hash...",
        "primary",
      );

      const { blob, sha256 } = await exportAuditReport();
      const filename = "Nimbus-Meridian-Audit-FY24-Q3.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(
        "Financial Audit Downloaded",
        `${filename} saved (SHA-256: ${sha256.slice(0, 16)}...)`,
        "secondary",
      );
    } catch (err) {
      showToast(
        "Export Failed",
        err instanceof Error ? err.message : String(err),
        "error",
      );
    } finally {
      setIsExporting(false);
    }
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
  const approvedPct =
    totals.claimed > 0 ? Math.round((totals.approved / totals.claimed) * 100) : 0;
  const flaggedTotal = totals.claimed - totals.approved;
  const flaggedCount = totals.violations + totals.needsReview;
  const flaggedPct =
    totals.claimed > 0 ? Math.round((flaggedTotal / totals.claimed) * 100) : 0;
  const unmatchedPct =
    feed.length > 0 ? Math.round((totals.unmatchedCount / feed.length) * 100) : 0;

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
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white dark:bg-[#0F172A] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-xs">
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
          {/* Check Receipts Folder Button */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={isScanning}
            className="flex items-center gap-1.5 bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${
                isScanning ? "animate-spin" : ""
              }`}
            >
              {isScanning ? "sync" : "folder_open"}
            </span>
            <span>{isScanning ? "Scanning Folder..." : "Check Receipts Folder"}</span>
          </button>

          {/* Trigger Auto-Reconcile Button */}
          <button
            type="button"
            onClick={handleTriggerReconcile}
            disabled={isSyncing}
            className="flex items-center gap-1.5 bg-white dark:bg-[#162032] hover:bg-gray-50 dark:hover:bg-[#1E293B] text-gray-700 dark:text-gray-200 border border-[#E5E7EB] dark:border-[#1E293B] font-mono text-xs px-3 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
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

          {/* Export Financial Audit Button (REAL CSV DOWNLOAD) */}
          <button
            type="button"
            onClick={handleExportAudit}
            disabled={isExporting}
            className="flex items-center gap-1.5 bg-white dark:bg-[#162032] hover:bg-gray-50 dark:hover:bg-[#1E293B] text-gray-700 dark:text-gray-200 border border-[#E5E7EB] dark:border-[#1E293B] font-mono text-xs px-3 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[16px] text-gray-500 ${
                isExporting ? "animate-spin" : ""
              }`}
            >
              {isExporting ? "sync" : "download_for_offline"}
            </span>
            <span>{isExporting ? "Exporting..." : "Export Financial Audit"}</span>
          </button>

          {/* Policy Rules Sheet Button */}
          <button
            type="button"
            onClick={scrollToRules}
            className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#162032] hover:bg-gray-200 dark:hover:bg-[#1E293B] text-[#3B5BFD] dark:text-blue-400 border border-[#E5E7EB] font-mono text-xs px-3 py-1.5 rounded-lg shadow-2xs transition-all ml-auto xl:ml-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">rule</span>
            <span>Policy Rules Sheet</span>
          </button>
        </div>
      </section>

      {/* Metric Gauges Bento */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Scanned */}
        <div className="bg-white dark:bg-[#0F172A] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Total Receipts
            </span>
            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#162032] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-[#1E293B] font-mono text-[10px]">
              {totals.receiptsCount} uploaded
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-[#111827] font-bold tracking-tight">
              ₹{totals.claimed.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-xs text-emerald-600 font-medium flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[14px]">check</span> All read clearly
            </span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 dark:bg-[#162032] rounded-full overflow-hidden">
            <div className="h-full bg-[#3B5BFD] rounded-full w-full"></div>
          </div>
        </div>

        {/* Card 2: Reconciled & Approved */}
        <div className="bg-white dark:bg-[#0F172A] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between shadow-xs relative overflow-hidden">
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
          <div className="mt-2.5 h-1 w-full bg-gray-100 dark:bg-[#162032] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${approvedPct}%` }}
            ></div>
          </div>
        </div>

        {/* Card 3: Violations & Flags */}
        <div className="bg-white dark:bg-[#0F172A] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between shadow-xs relative overflow-hidden">
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
          <div className="mt-2.5 h-1 w-full bg-gray-100 dark:bg-[#162032] rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full"
              style={{ width: `${flaggedPct}%` }}
            ></div>
          </div>
        </div>

        {/* Card 4: Unmatched Corporate Transactions */}
        <div className="bg-white dark:bg-[#0F172A] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between shadow-xs relative overflow-hidden">
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
            <span className="font-mono text-xs text-gray-500">
              ₹{totals.unmatchedTotal.toLocaleString("en-IN")} total without bill
            </span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 dark:bg-[#162032] rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: `${unmatchedPct}%` }}
            ></div>
          </div>
        </div>
      </section>

      {/* Zombie SaaS Alert (if data available) */}
      {zombieReport && zombieReport.tools.length > 0 && (
        <section className="bg-white dark:bg-[#0F172A] rounded-xl border border-amber-200 dark:border-amber-900/40 p-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-amber-100 dark:border-amber-900/30">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-amber-600 dark:text-amber-400">
                warning
              </span>
              <div>
                <h3 className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6]">Zombie SaaS Detected</h3>
                <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                  {zombieReport.tools.length} tool{zombieReport.tools.length !== 1 ? "s" : ""} with
                  no logins in {zombieReport.thresholdDays}+ days — ₹
                  {zombieReport.monthlyWasteInr.toLocaleString("en-IN")}/mo potential waste (₹
                  {zombieReport.annualWasteInr.toLocaleString("en-IN")}/yr)
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3">
            {zombieReport.tools.slice(0, 6).map((t) => (
              <div
                key={t.tool}
                className="p-2.5 rounded-lg bg-amber-50/50 dark:bg-[#131C2E] border border-amber-200/70 dark:border-amber-900/40 flex items-center justify-between"
              >
                <div>
                  <span className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6]">{t.tool}</span>
                  <p className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                    {t.days_idle != null ? `${t.days_idle}d idle` : "No logins on record"}
                    {t.owner ? ` · ${t.owner}` : ""}
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
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
        <div className="lg:col-span-7 flex flex-col bg-white dark:bg-[#0F172A] rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-xs overflow-hidden">
          <div className="p-4 bg-[#F9FAFB] dark:bg-[#131C2E] border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between">
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
                  No expense claims yet. Click &quot;Check Receipts Folder&quot; to process receipts.
                </p>
              </div>
            )}
            {claims.map((claim) => (
              <article
                key={claim.id}
                className={`p-4 rounded-lg border transition-colors ${
                  claim.status === "violation"
                    ? "bg-red-50/30 dark:bg-[#191118] border-red-200 dark:border-rose-900/50"
                    : claim.status === "review"
                    ? "bg-amber-50/40 dark:bg-[#1A1610] border-amber-200 dark:border-amber-900/50"
                    : "bg-[#F9FAFB] dark:bg-[#131C2E] border-[#E5E7EB] dark:border-[#1E293B] hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#3B5BFD] dark:text-blue-400">
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
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{claim.category}</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-base font-bold ${
                        claim.status === "violation"
                          ? "text-red-700 dark:text-rose-400"
                          : "text-[#111827] dark:text-[#F3F4F6]"
                      }`}
                    >
                      ₹{claim.amount.toLocaleString("en-IN")}
                    </span>
                    {claim.unit && (
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{claim.unit}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-gray-600 dark:text-gray-300 gap-1 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#111827] dark:text-[#F3F4F6] font-medium">{claim.vendor}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-medium">
                      {claim.details}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-gray-600 dark:text-gray-300 bg-white dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] px-1.5 py-0.5 rounded">
                      {claim.cardName}
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">{claim.approverText}</span>
                  </div>
                </div>

                {claim.alertMsg && (
                  <div
                    className={`mt-2 p-2.5 rounded-lg bg-white dark:bg-[#0B101D] border flex items-start justify-between gap-2 shadow-2xs ${
                      claim.status === "violation" ? "border-red-200 dark:border-rose-900/50" : "border-amber-200 dark:border-amber-900/50"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`material-symbols-outlined text-[16px] mt-0.5 ${
                          claim.status === "violation" ? "text-red-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        report_problem
                      </span>
                      <div>
                        <p
                          className={`font-mono text-xs font-medium ${
                            claim.status === "violation" ? "text-red-700 dark:text-rose-400" : "text-amber-800 dark:text-amber-400"
                          }`}
                        >
                          {claim.alertMsg}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{claim.alertSub}</p>
                      </div>
                    </div>
                    {claim.alertBtn && (
                      <button
                        type="button"
                        onClick={() => showToast("Action Dispatched", claim.alertMsg || "")}
                        className="px-2 py-1 rounded bg-white dark:bg-[#162032] hover:bg-gray-50 dark:hover:bg-[#1E293B] text-gray-800 dark:text-gray-200 border border-[#E5E7EB] dark:border-[#1E293B] font-mono text-[11px] whitespace-nowrap shadow-2xs cursor-pointer font-medium"
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
        <div className="lg:col-span-5 flex flex-col bg-white dark:bg-[#0F172A] rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-xs overflow-hidden">
          <div className="p-4 bg-[#F9FAFB] dark:bg-[#131C2E] border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between">
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

          <div className="divide-y divide-gray-100 dark:divide-[#1E293B] p-2 space-y-1.5 max-h-[700px] overflow-y-auto">
            {feed.length === 0 && (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-[32px] text-gray-300 dark:text-gray-600">
                  credit_card_off
                </span>
                <p className="text-sm text-gray-400 mt-2">No card transactions loaded.</p>
              </div>
            )}
            {feed.map((txn) => (
              <div
                key={txn.id}
                className={`p-2.5 rounded-lg border transition-colors ${
                  !txn.matched && !txn.isIncidental
                    ? "bg-amber-50/30 dark:bg-[#1A1610] border-amber-200 dark:border-amber-900/50"
                    : txn.isIncidental
                    ? "bg-[#F9FAFB] dark:bg-[#131C2E] border-[#E5E7EB] dark:border-[#1E293B]"
                    : "hover:bg-[#F9FAFB] dark:hover:bg-[#131C2E] border-transparent hover:border-[#E5E7EB] dark:hover:border-[#1E293B]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{txn.date}</span>
                      <span className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6]">{txn.vendor}</span>
                    </div>
                    <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{txn.cardInfo}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        !txn.matched ? "text-amber-700 dark:text-amber-400" : "text-[#111827] dark:text-[#F3F4F6]"
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
                          <span className="material-symbols-outlined text-[12px]">check</span>
                        )}
                        {txn.statusBadge}
                      </span>
                    </div>
                  </div>
                </div>

                {!txn.matched && !txn.isIncidental && (
                  <div className="mt-2 pt-2 flex items-center justify-between border-t border-amber-100 dark:border-amber-900/40">
                    <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">Auto-reminder sent</span>
                    <button
                      type="button"
                      onClick={() => {
                        setModalTab("path");
                        setIsModalOpen(true);
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#3B5BFD] text-white font-mono text-[11px] hover:bg-[#2549ED] flex items-center gap-1 shadow-2xs font-medium cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[13px]">folder_open</span>
                      <span>Check Receipts Folder</span>
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

          <div className="p-2.5 bg-[#F9FAFB] dark:bg-[#131C2E] border-t border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between text-gray-500 font-mono text-[11px]">
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
        className="bg-white dark:bg-[#0F172A] rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] p-4 shadow-xs transition-all duration-300"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#3B5BFD]">
              gavel
            </span>
            <div>
              <h3 className="text-xs font-semibold text-[#111827]">Company Spending Rules</h3>
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
          <div className="p-3 rounded-lg bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Flights
                </span>
                <span className="material-symbols-outlined text-[16px] text-[#3B5BFD]">flight</span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">Flights: Up to ₹8,000</p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Per one-way domestic ticket (Economy class)
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-400 uppercase font-semibold">
                  Hotels
                </span>
                <span className="material-symbols-outlined text-[16px] text-emerald-600">hotel</span>
              </div>
              <p className="font-mono text-sm text-[#111827] font-bold mt-1">
                Hotels: Up to ₹9,000/night
              </p>
            </div>
            <p className="font-mono text-[11px] text-gray-500 mt-2">
              Up to ₹9,000 in big cities (Mumbai, Delhi, BLR); ₹6,000 elsewhere
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between">
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

          <div className="p-3 rounded-lg bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between">
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

          <div className="p-3 rounded-lg bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between">
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

      {/* Check Receipts Folder Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-xl w-full rounded-xl shadow-xl border border-[#E5E7EB] p-5 space-y-4 relative">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#3B5BFD]">
                  <span className="material-symbols-outlined text-[20px]">folder_open</span>
                </div>
                <div>
                  <h4 className="text-sm text-[#111827] font-semibold">Check Receipts Folder</h4>
                  <p className="font-mono text-[11px] text-gray-500">
                    Scan receipts, inspect OCR, check policies, and match card charges
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedFiles([]);
                  setSelectedFolderName(null);
                }}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Mode Switch Tabs */}
            <div className="flex items-center gap-2 bg-[#F9FAFB] p-1 rounded-lg border border-[#E5E7EB]">
              <button
                type="button"
                onClick={() => setModalTab("path")}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  modalTab === "path"
                    ? "bg-white text-[#3B5BFD] shadow-xs border border-[#E5E7EB]"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">terminal</span>
                <span>Server Directory Path</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab("folder")}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  modalTab === "folder"
                    ? "bg-white text-[#3B5BFD] shadow-xs border border-[#E5E7EB]"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Select Folder from Computer</span>
              </button>
            </div>

            {/* Hidden Folder Input for browser picker */}
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is standard in browser engines
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderChange}
            />

            {/* TAB 1: Server Directory Path */}
            {modalTab === "path" && (
              <div className="space-y-3.5 py-1">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-gray-800">
                    Receipts Folder Path:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customServerDir}
                      onChange={(e) => setCustomServerDir(e.target.value)}
                      placeholder="e.g. seed/finance/receipts or projects/plexus/seed/finance/receipts"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-xs font-mono text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#3B5BFD] bg-white"
                    />
                  </div>
                  <p className="font-mono text-[11px] text-gray-400">
                    Accepts relative paths (e.g. <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">seed/finance/receipts</code>, <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">projects/plexus/seed/finance/receipts</code>) or absolute paths.
                  </p>
                </div>

                {/* Quick Presets */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-gray-500 uppercase tracking-wider font-semibold">
                    Quick Presets:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomServerDir("seed/finance/receipts")}
                      className={`px-2.5 py-1 rounded-md font-mono text-[11px] border cursor-pointer transition-all ${
                        customServerDir === "seed/finance/receipts"
                          ? "bg-blue-50 text-[#3B5BFD] border-blue-200 font-semibold"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      seed/finance/receipts (Default)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomServerDir("projects/plexus/seed/finance/receipts")}
                      className={`px-2.5 py-1 rounded-md font-mono text-[11px] border cursor-pointer transition-all ${
                        customServerDir === "projects/plexus/seed/finance/receipts"
                          ? "bg-blue-50 text-[#3B5BFD] border-blue-200 font-semibold"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      projects/plexus/seed/finance/receipts
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 font-mono text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScanServerPath(customServerDir)}
                    disabled={isScanning || !customServerDir.trim()}
                    className="px-4 py-1.5 rounded-lg bg-[#3B5BFD] text-white text-xs hover:bg-[#2549ED] shadow-sm flex items-center gap-1.5 font-medium cursor-pointer disabled:opacity-50"
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] ${
                        isScanning ? "animate-spin" : ""
                      }`}
                    >
                      {isScanning ? "sync" : "bolt"}
                    </span>
                    <span>{isScanning ? "Scanning..." : "Check This Receipts Path"}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Select Folder from Computer */}
            {modalTab === "folder" && (
              <div className="space-y-3 py-1">
                <div
                  onClick={() => folderInputRef.current?.click()}
                  className={`p-6 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center ${
                    selectedFiles.length > 0
                      ? "bg-emerald-50/50 border-emerald-300 hover:bg-emerald-50"
                      : "bg-[#F9FAFB] hover:bg-gray-100 border-gray-300"
                  }`}
                >
                  {selectedFiles.length > 0 ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center border border-emerald-200">
                        <span className="material-symbols-outlined text-[26px]">snippet_folder</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">
                          Folder: {selectedFolderName}
                        </p>
                        <p className="font-mono text-xs text-emerald-700 mt-0.5">
                          {selectedFiles.length} receipt image(s) detected and ready
                        </p>
                      </div>
                      {/* File chips */}
                      <div className="flex flex-wrap gap-1 justify-center max-h-24 overflow-y-auto pt-1">
                        {selectedFiles.slice(0, 8).map((f) => (
                          <span
                            key={f.name}
                            className="px-2 py-0.5 rounded bg-white border border-emerald-200 font-mono text-[10px] text-emerald-800"
                          >
                            {f.name}
                          </span>
                        ))}
                        {selectedFiles.length > 8 && (
                          <span className="px-2 py-0.5 rounded bg-white border border-emerald-200 font-mono text-[10px] text-emerald-800">
                            +{selectedFiles.length - 8} more
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          folderInputRef.current?.click();
                        }}
                        className="text-xs text-[#3B5BFD] hover:underline font-mono inline-block pt-1 cursor-pointer"
                      >
                        Choose a different folder...
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 text-[#3B5BFD] mx-auto flex items-center justify-center">
                        <span className="material-symbols-outlined text-[28px]">drive_folder_upload</span>
                      </div>
                      <div>
                        <p className="text-xs text-[#111827] font-semibold">
                          Click to Select Receipts Folder from Computer
                        </p>
                        <p className="font-mono text-[11px] text-gray-500 mt-0.5">
                          Opens system directory picker to select all receipts inside
                        </p>
                      </div>
                      <span className="inline-block px-2.5 py-1 rounded-md bg-white border border-[#E5E7EB] text-gray-700 font-mono text-[11px] shadow-2xs font-medium">
                        Browse Folder...
                      </span>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-gray-100">
                  <span className="font-mono text-[10px] text-gray-400">
                    Supports PNG, JPG, JPEG, WEBP
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsModalOpen(false);
                        setSelectedFiles([]);
                        setSelectedFolderName(null);
                      }}
                      className="px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 font-mono text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleScanUploadedFolder}
                      disabled={isScanning || selectedFiles.length === 0}
                      className="px-4 py-1.5 rounded-lg bg-[#3B5BFD] text-white text-xs hover:bg-[#2549ED] shadow-sm flex items-center gap-1.5 font-medium cursor-pointer disabled:opacity-50"
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] ${
                          isScanning ? "animate-spin" : ""
                        }`}
                      >
                        {isScanning ? "sync" : "bolt"}
                      </span>
                      <span>
                        {isScanning
                          ? "Uploading & Processing..."
                          : selectedFiles.length > 0
                          ? `Scan ${selectedFiles.length} Receipts in ${selectedFolderName}`
                          : "Select Folder First"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
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
