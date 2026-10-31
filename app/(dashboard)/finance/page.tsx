"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  ScanLine,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  MOCK DATA. Swap these constants for the real /api endpoints later.         */
/*  Merchants, limits and tool names are placeholders: align them with the     */
/*  seed files (expense policy, card feed, SaaS billing, SSO logins).          */
/* -------------------------------------------------------------------------- */

type Category = "Cab" | "Meals" | "Travel" | "Software" | "Hotel";

const POLICY_LIMITS: Record<Category, { limit: number; per: string }> = {
  Cab: { limit: 1500, per: "per trip" },
  Meals: { limit: 3000, per: "per meal" },
  Travel: { limit: 10000, per: "per ticket" },
  Software: { limit: 5000, per: "per subscription" },
  Hotel: { limit: 8000, per: "per night" },
};

type ExpenseReceipt = {
  id: string;
  merchant: string;
  category: Category;
  date: string;
  base: number;
  gstRate: number; // percent
  gst: number;
  total: number;
  confidence: number; // vision extraction confidence, 0..1
  duplicateOf?: string; // earlier claim this one repeats
};

// Order = the order the demo scans them. First two start already scanned.
const RECEIPTS: ExpenseReceipt[] = [
  { id: "R-1", merchant: "Ola Cabs", category: "Cab", date: "28 Oct", base: 612, gstRate: 5, gst: 31, total: 643, confidence: 0.97 },
  { id: "R-2", merchant: "IRCTC Rajdhani Express", category: "Travel", date: "25 Oct", base: 2805, gstRate: 5, gst: 140, total: 2945, confidence: 0.95 },
  { id: "R-3", merchant: "Karavalli Kitchen", category: "Meals", date: "27 Oct", base: 4000, gstRate: 5, gst: 200, total: 4200, confidence: 0.96 },
  { id: "R-4", merchant: "Figma Inc.", category: "Software", date: "24 Oct", base: 3000, gstRate: 18, gst: 540, total: 3540, confidence: 0.94 },
  { id: "R-5", merchant: "Vivanta Hotel", category: "Hotel", date: "23 Oct", base: 7000, gstRate: 12, gst: 840, total: 7840, confidence: 0.93, duplicateOf: "EXP-0871 (filed 22 Oct)" },
];

type CardTxn = { id: string; date: string; merchant: string; amount: number; receiptId?: string; filedEarlier?: boolean };

const CARD_FEED: CardTxn[] = [
  { id: "T-01", date: "28 Oct", merchant: "OLA CABS BLR", amount: 643, receiptId: "R-1" },
  { id: "T-02", date: "25 Oct", merchant: "IRCTC E-TICKETING", amount: 2945, receiptId: "R-2" },
  { id: "T-03", date: "27 Oct", merchant: "KARAVALLI KITCHEN", amount: 4200, receiptId: "R-3" },
  { id: "T-04", date: "24 Oct", merchant: "FIGMA INC", amount: 3540, receiptId: "R-4" },
  { id: "T-05", date: "23 Oct", merchant: "VIVANTA HOTEL", amount: 7840, receiptId: "R-5" },
  { id: "T-06", date: "26 Oct", merchant: "ZOMATO", amount: 780, filedEarlier: true },
  { id: "T-07", date: "22 Oct", merchant: "UBER INDIA", amount: 421, filedEarlier: true },
  { id: "T-08", date: "21 Oct", merchant: "AWS EMEA", amount: 18400, filedEarlier: true },
  { id: "T-09", date: "20 Oct", merchant: "SLACK TECHNOLOGIES", amount: 24500, filedEarlier: true },
  { id: "T-10", date: "20 Oct", merchant: "CAFE COFFEE DAY", amount: 360, filedEarlier: true },
  { id: "T-11", date: "19 Oct", merchant: "INDIAN OIL FUEL", amount: 2000, filedEarlier: true },
  { id: "T-12", date: "29 Oct", merchant: "AMAZON BUSINESS", amount: 1299 },
  { id: "T-13", date: "29 Oct", merchant: "SWIGGY", amount: 940 },
  { id: "T-14", date: "30 Oct", merchant: "UBR*TRIP", amount: 1150 },
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

type ReceiptVerdict = { status: "ok" | "over_limit" | "duplicate"; reason: string };

// The policy check runs here from the data, so changing a limit or amount changes the verdict.
function evaluate(r: ExpenseReceipt): ReceiptVerdict {
  if (r.duplicateOf) {
    return { status: "duplicate", reason: `Same merchant, amount and date as ${r.duplicateOf}. Not reimbursable twice.` };
  }
  const p = POLICY_LIMITS[r.category];
  if (r.total > p.limit) {
    return {
      status: "over_limit",
      reason: `${r.category} limit is ${inr(p.limit)} ${p.per}. This is ${inr(r.total - p.limit)} over. Needs manager approval.`,
    };
  }
  return { status: "ok", reason: `Within the ${inr(p.limit)} ${p.per} limit.` };
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

function StatusPill({ status }: { status: ReceiptVerdict["status"] }) {
  if (status === "ok") {
    return (
      <Pill tone="good">
        <CheckCircle2 className="w-3 h-3" />
        Within policy
      </Pill>
    );
  }
  if (status === "over_limit") {
    return (
      <Pill tone="warn">
        <AlertTriangle className="w-3 h-3" />
        Over limit
      </Pill>
    );
  }
  return (
    <Pill tone="bad">
      <Copy className="w-3 h-3" />
      Duplicate
    </Pill>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page: Finance Agent (expenses)                                             */
/* -------------------------------------------------------------------------- */

export default function FinancePage() {
  const [scanned, setScanned] = useState<ExpenseReceipt[]>(RECEIPTS.slice(0, 2));
  const [scanning, setScanning] = useState(false);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, []);

  /* ----------------------------- Expenses logic ---------------------------- */

  const queueLeft = RECEIPTS.length - scanned.length;

  function scanNext() {
    if (scanning || queueLeft <= 0) return;
    setScanning(true);
    // MOCK: replace with POST of the photo to the vision endpoint; it returns an ExpenseReceipt.
    scanTimer.current = setTimeout(() => {
      setScanned((prev) => (prev.length < RECEIPTS.length ? [...prev, RECEIPTS[prev.length]] : prev));
      setScanning(false);
    }, 1400);
  }

  const verdicts = scanned.map((r) => ({ r, v: evaluate(r) }));
  const flaggedReceipts = verdicts.filter((x) => x.v.status !== "ok");
  const totalClaimed = scanned.reduce((s, r) => s + r.total, 0);
  const scannedIds = new Set(scanned.map((r) => r.id));

  function txnMatch(t: CardTxn): { label: string; tone: "good" | "wait" | "bad" } {
    if (t.receiptId) {
      return scannedIds.has(t.receiptId)
        ? { label: `Matched to ${t.receiptId}`, tone: "good" }
        : { label: "Awaiting receipt scan", tone: "wait" };
    }
    if (t.filedEarlier) return { label: "Matched (filed earlier)", tone: "good" };
    return { label: "No receipt on file", tone: "bad" };
  }

  const unmatched = CARD_FEED.filter((t) => txnMatch(t).tone === "bad").length;
  return (
    <div className="min-h-full bg-[#0b1120]">
    <div className="p-8 max-w-6xl space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Finance Agent</h2>
          <p className="text-[15px] text-slate-400 mt-1.5 max-w-2xl">
            Receipt reading with vision, expense policy checks, duplicate detection and card-feed reconciliation. Every flag comes with a reason.
          </p>
        </div>
        <SampleBadge />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={scanNext} />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={scanning || queueLeft <= 0}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#5046E5] hover:bg-indigo-500 disabled:opacity-60 text-white text-[15px] font-semibold transition-colors"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          {scanning ? "Reading receipt…" : "Upload Receipt"}
        </button>
        <button
          onClick={scanNext}
          disabled={scanning || queueLeft <= 0}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800/60 disabled:opacity-50 text-sm font-medium transition-colors"
          title="Demo shortcut: scans the next sample receipt"
        >
          <ScanLine className="w-4 h-4" />
          Scan next sample ({queueLeft} left)
        </button>
      </div>

      {/* Stats strip */}
      <div className={`${CARD} grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-800`}>
        {[
          { label: "Receipts scanned", value: `${scanned.length} / ${RECEIPTS.length}`, tone: "text-white" },
          { label: "Within policy", value: String(scanned.length - flaggedReceipts.length), tone: "text-emerald-500" },
          { label: "Flagged", value: String(flaggedReceipts.length), tone: "text-amber-500" },
          { label: "Card txns without receipt", value: String(unmatched), tone: "text-amber-500" },
        ].map((t) => (
          <div key={t.label} className="py-6 text-center">
            <div className={`text-4xl font-bold ${t.tone}`}>{t.value}</div>
            <div className="text-sm text-slate-400 mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="font-mono text-[13px] text-slate-400">
        receipts · {scanned.length} scanned · {inr(totalClaimed)} claimed
      </div>

      {/* Policy flags */}
      {flaggedReceipts.length > 0 && (
        <div className="space-y-3">
          {flaggedReceipts.map(({ r, v }) => (
            <div
              key={r.id}
              className={`px-5 py-4 rounded-2xl border flex items-start gap-3 ${
                v.status === "duplicate" ? "border-rose-900/60 bg-rose-950/20" : "border-amber-900/60 bg-amber-950/20"
              }`}
            >
              <span className={v.status === "duplicate" ? "text-rose-400" : "text-amber-400"}>
                {v.status === "duplicate" ? <Copy className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </span>
              <div className="text-sm">
                <div className="font-semibold text-white">
                  {r.merchant} · {inr(r.total)} · {v.status === "duplicate" ? "Duplicate claim" : "Over policy limit"}
                </div>
                <div className="text-slate-400 mt-0.5">{v.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Receipts table */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Extracted receipts</h3>
        <div className={TABLE_WRAP}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={TH}>Merchant</th>
                <th className={TH}>Category</th>
                <th className={TH}>Date</th>
                <th className={`${TH} text-right`}>Base</th>
                <th className={`${TH} text-right`}>GST</th>
                <th className={`${TH} text-right`}>Total</th>
                <th className={`${TH} text-right`}>Limit</th>
                <th className={TH}>Confidence</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {[...verdicts].reverse().map(({ r, v }) => (
                <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className={`${TD} text-slate-100`}>{r.merchant}</td>
                  <td className={`${TD} text-slate-300`}>{r.category}</td>
                  <td className={`${TD} text-slate-400 font-mono`}>{r.date}</td>
                  <td className={`${TD} text-right text-slate-300 font-mono`}>{inr(r.base)}</td>
                  <td className={`${TD} text-right text-slate-400 font-mono`}>
                    {inr(r.gst)} <span className="text-slate-500">({r.gstRate}%)</span>
                  </td>
                  <td className={`${TD} text-right text-white font-mono font-semibold`}>{inr(r.total)}</td>
                  <td className={`${TD} text-right text-slate-400 font-mono`}>{inr(POLICY_LIMITS[r.category].limit)}</td>
                  <td className={`${TD} text-emerald-400 font-mono font-semibold`}>{Math.round(r.confidence * 100)}%</td>
                  <td className={TD}>
                    <StatusPill status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card feed reconciliation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Card feed reconciliation</h3>
          <span className="font-mono text-[13px] text-slate-400">{CARD_FEED.length} transactions</span>
        </div>
        <div className={TABLE_WRAP}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={`${TH} w-24`}>Date</th>
                <th className={TH}>Merchant (as on card)</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Receipt match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {CARD_FEED.map((t) => {
                const m = txnMatch(t);
                return (
                  <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className={`${TD} text-slate-400 font-mono`}>{t.date}</td>
                    <td className={`${TD} text-slate-100`}>{t.merchant}</td>
                    <td className={`${TD} text-right text-slate-200 font-mono`}>{inr(t.amount)}</td>
                    <td className={TD}>
                      {m.tone === "good" ? (
                        <Pill tone="good">
                          <CheckCircle2 className="w-3 h-3" />
                          {m.label}
                        </Pill>
                      ) : m.tone === "wait" ? (
                        <Pill tone="muted">
                          <Clock className="w-3 h-3" />
                          {m.label}
                        </Pill>
                      ) : (
                        <Pill tone="bad">
                          <XCircle className="w-3 h-3" />
                          {m.label}
                        </Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy limits */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Expense policy limits</h3>
        <div className={`${CARD} grid grid-cols-2 sm:grid-cols-5 divide-x divide-slate-800`}>
          {(Object.keys(POLICY_LIMITS) as Category[]).map((c) => (
            <div key={c} className="py-4 text-center">
              <div className="text-xs text-slate-400">{c}</div>
              <div className="text-lg font-bold text-white mt-0.5">{inr(POLICY_LIMITS[c].limit)}</div>
              <div className="text-[11px] text-slate-500">{POLICY_LIMITS[c].per}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}