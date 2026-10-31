"use client";

import { useState } from "react";

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

const INITIAL_CLAIMS: ClaimItem[] = [
  {
    id: "REC-109",
    category: "Lodging · Mumbai",
    vendor: "Taj Lands End, Mumbai",
    amount: 8400,
    unit: " / night",
    status: "ok",
    statusBadge: "OK - Auto Approved",
    badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    details: "Limit ₹9,000 metro",
    cardName: "Card: Axis Corp #4891",
    approverText: "Approver: Auto (L4)",
  },
  {
    id: "REC-112",
    category: "Team Meals",
    vendor: "Team Dinner at Bombay Canteen",
    amount: 7200,
    unit: " (4 covers)",
    status: "violation",
    statusBadge: "VIOLATION - Meal Cap",
    badgeCls: "bg-red-100 text-red-800 border-red-200",
    details: "Per-head: ₹1,800 (Cap ₹1,500)",
    cardName: "Card: Axis Corp #4891",
    approverText: "Approver: Karan",
    alertMsg:
      "Dinner bill exceeded the ₹1,500 per person limit by ₹300 per head (Total extra: ₹1,200).",
    alertSub: "Sent to Karan Malhotra for review.",
    alertBtn: "Review Details",
  },
  {
    id: "REC-115",
    category: "Aviation · Domestic",
    vendor: "Indigo Airlines (DEL ➔ BOM)",
    amount: 9450,
    unit: " (Economy)",
    status: "review",
    statusBadge: "REVIEW - Flight Cap",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
    details: "Limit ₹8,000 (Excess +₹1,450)",
    subdetails: "Cardholder: Meera Iyer",
    cardName: "Card: HDFC Corp #1029",
    approverText: "Approver: Riya Sharma",
    alertMsg: "Flight ticket cost ₹9,450 (limit is ₹8,000).",
    alertSub: "Needs approval from Riya.",
    alertBtn: "Send to Riya",
  },
  {
    id: "REC-118",
    category: "Client Relations",
    vendor: "Dinner with Meridian Bank (Sanjay Desai)",
    amount: 14200,
    status: "review",
    statusBadge: "REVIEW - Note Required",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
    details: "Attendees: 3 Meridian, 2 Nimbus",
    cardName: "Card: Axis Corp #4891",
    approverText: "Approver: Riya Sharma",
    alertMsg:
      "Client dinners over ₹10,000 need a brief note explaining the business purpose.",
    alertSub: "Awaiting quick note from: Riya Sharma",
    alertBtn: "Add Note",
  },
  {
    id: "REC-121",
    category: "Ground Transport",
    vendor: "Uber Premier ride · Airport to BKC",
    amount: 1680,
    status: "violation",
    statusBadge: "VIOLATION - Ride Limit",
    badgeCls: "bg-red-100 text-red-800 border-red-200",
    details: "Cap ₹1,500 (Exceeded by ₹180)",
    cardName: "Card: Personal Reimbursement",
    approverText: "Payroll Deduction",
    alertMsg: "Cab cost was ₹180 over the standard ride budget.",
    alertSub: "Deduct ₹180 difference from upcoming salary, or request waiver.",
    alertBtn: "Deduct ₹180",
  },
];

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

const INITIAL_CARD_FEED: CardTxnItem[] = [
  {
    id: "txn-1",
    date: "29 Oct",
    vendor: "Taj Hotels Mumbai",
    cardInfo: "Axis Corp #4891 · Karan Malhotra",
    amount: 8400,
    matched: true,
    statusBadge: "Matched with Receipt ✓",
  },
  {
    id: "txn-2",
    date: "29 Oct",
    vendor: "Bombay Canteen",
    cardInfo: "Axis Corp #4891 · Karan Malhotra",
    amount: 7200,
    matched: true,
    statusBadge: "Matched with Receipt ✓",
  },
  {
    id: "txn-3",
    date: "28 Oct",
    vendor: "Indigo Air Domestic",
    cardInfo: "HDFC Corp #1029 · Meera Iyer",
    amount: 9450,
    matched: true,
    statusBadge: "Matched with Receipt ✓",
  },
  {
    id: "txn-4",
    date: "27 Oct",
    vendor: "Amazon India (Office cables)",
    cardInfo: "Axis Corp #4891 · Karan Malhotra",
    amount: 3200,
    matched: false,
    statusBadge: "Needs receipt · 12 days left",
  },
  {
    id: "txn-5",
    date: "26 Oct",
    vendor: "Blue Tokai Coffee",
    cardInfo: "HDFC Corp #7741 · Arjun Verma",
    amount: 680,
    matched: false,
    statusBadge: "Unmatched · 11d left",
    isIncidental: true,
  },
];

export default function FinancePage() {
  const [claims] = useState<ClaimItem[]>(INITIAL_CLAIMS);
  const [feed] = useState<CardTxnItem[]>(INITIAL_CARD_FEED);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; desc: string; type: string } | null>(
    null,
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [waiveIncidental, setWaiveIncidental] = useState(true);

  const showToast = (title: string, desc: string, type = "secondary") => {
    setToast({ title, desc, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleTriggerReconcile = () => {
    setIsSyncing(true);
    showToast(
      "Sync In Progress",
      "Polling Meridian Bank SFTP feed for 15-day settlement logs...",
      "primary",
    );
    setTimeout(() => {
      setIsSyncing(false);
      showToast(
        "Reconciliation Complete",
        "Matched 8 claims against Axis & HDFC statements. 0 slippage.",
        "secondary",
      );
    }, 1200);
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
              Synced: <strong className="text-[#111827]">Just now</strong>
            </span>
          </div>
        </div>

        {/* Global Operations Group */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">
              document_scanner
            </span>
            <span>Scan New Receipts</span>
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
              12 uploaded
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-[#111827] font-bold tracking-tight">
              ₹78,450
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
              8 approved
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-emerald-700 font-bold tracking-tight">
              ₹52,100
            </span>
            <span className="font-mono text-xs text-gray-500">66% of total</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: "66.4%" }}
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
              4 flagged
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-xl text-red-600 font-bold tracking-tight">
              ₹26,350
            </span>
            <span className="font-mono text-xs text-red-600">On hold</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full"
              style={{ width: "33.6%" }}
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
              3 Card Charges
            </span>
            <span className="font-mono text-xs text-gray-500">₹3,880 total without bill</span>
          </div>
          <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: "25%" }}
            ></div>
          </div>
        </div>
      </section>

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
                All (5 Claims)
              </button>
            </div>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto max-h-[700px]">
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

        {/* RIGHT WORKBENCH (5 cols): Meridian Pilot Corporate Card Feed */}
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
                      Auto-reminder sent to Karan
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
              onClick={() => {
                setIsModalOpen(false);
                showToast(
                  "Batch Queued",
                  "3 receipts queued for OCR extraction & rule evaluation",
                  "primary",
                );
              }}
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
                onClick={() => {
                  setIsModalOpen(false);
                  showToast(
                    "Batch Queued",
                    "3 receipts queued for OCR extraction & rule evaluation",
                    "primary",
                  );
                }}
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
