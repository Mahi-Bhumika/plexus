"use client";

// File: components/command-palette.tsx
// Mount once in app/(dashboard)/layout.tsx:  <CommandPalette />
// Anything can open it with: window.dispatchEvent(new Event("plexus:open-search"))
// Mock mode first. Wiring point: replace DOCS + `rows` with the search endpoint,
// and BRIEFING with the Catch-Me-Up response.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { CornerDownLeft, FileText, Lock, Search, Sparkles, X } from "lucide-react";

type Role = "intern" | "founder";
type Mode = "search" | "briefing";

interface Doc {
  id: string;
  title: string;
  kind: string;
  date?: string;
  minRole: Role;
  body: string;
  tags: string[];
}

type Row = { kind: "catchup" } | { kind: "doc"; doc: Doc; locked: boolean };

const ROLES: { id: Role; label: string }[] = [
  { id: "intern", label: "Intern (Arjun)" },
  { id: "founder", label: "Founder (Riya)" },
];

const DOCS: Doc[] = [
  {
    id: "n-27",
    title: "Meridian pilot notes",
    kind: "Project notes",
    date: "27 Oct",
    minRole: "intern",
    tags: ["meridian", "kickoff", "soc 2", "sub-processor"],
    body: "Kickoff follow-ups sent. Meridian asked for the SOC 2 Type II report and the sub-processor list. Karan will share the report under NDA.",
  },
  {
    id: "n-28",
    title: "Meridian pilot notes",
    kind: "Project notes",
    date: "28 Oct",
    minRole: "intern",
    tags: ["meridian", "access", "meera", "figma", "aws"],
    body: "Meera is set up on Slack and Google Workspace. Figma was auto-approved. Her AWS production request went to Karan for approval.",
  },
  {
    id: "n-29",
    title: "Meridian pilot notes",
    kind: "Project notes",
    date: "29 Oct",
    minRole: "intern",
    tags: ["meridian", "india", "singapore", "replica", "data location"],
    body: "Vikram Rao asked about India-only data copies. The disaster recovery replica is in Singapore, so this needs to be agreed before signing.",
  },
  {
    id: "n-30",
    title: "Meridian pilot notes",
    kind: "Project notes",
    date: "30 Oct",
    minRole: "intern",
    tags: ["meridian", "uat", "test plan", "go-live"],
    body: "UPI pilot test plan outlined. The UAT environment owner is still open. Go-live target is unchanged at Monday 30 November.",
  },
  {
    id: "launch",
    title: "Meridian launch plan",
    kind: "Plan",
    date: "26 Oct",
    minRole: "intern",
    tags: ["launch", "go-live", "date", "owner", "meridian"],
    body: "Nimbus Ledger Sync pilot for Meridian's UPI reconciliation. Go-live: Monday 30 November 2026. Delivery owner: Karan Malhotra. Sponsor at Meridian: Sanjay Desai.",
  },
  {
    id: "roadmap",
    title: "Product roadmap Q4",
    kind: "Roadmap",
    minRole: "intern",
    tags: ["roadmap", "q4", "reconciliation", "upi"],
    body: "Q4 focus: UPI reconciliation for the Meridian pilot, audit export, and reliability work on the reconciliation engine.",
  },
  {
    id: "pricing",
    title: "Pricing sheet",
    kind: "Pricing",
    minRole: "intern",
    tags: ["pricing", "pilot", "tier", "cost"],
    body: "The pilot tier is a flat monthly fee. The production tier is priced per million reconciled transactions. Exact rates are in the sheet.",
  },
  {
    id: "onboarding",
    title: "New hire onboarding guide",
    kind: "Guide",
    minRole: "intern",
    tags: ["onboarding", "new hire", "training", "laptop"],
    body: "Complete security awareness training within 7 days of joining. Laptops come with MDM and disk encryption. Request extra access through the access request process.",
  },
  {
    id: "slack",
    title: "Slack export: #eng-tasks",
    kind: "Slack export (JSON)",
    minRole: "intern",
    tags: ["slack", "eng-tasks", "export", "messages"],
    body: "Task posts and approvals from the engineering channel. Includes the Meridian kickoff action items and access approvals.",
  },
  {
    id: "salary",
    title: "Salary sheet",
    kind: "Founder only",
    minRole: "founder",
    tags: ["salary", "compensation", "pay", "bands"],
    body: "Compensation bands by role and review dates. Confidential. Contents are not shown in this demo.",
  },
  {
    id: "soc2",
    title: "SOC 2 Type II summary",
    kind: "Policy",
    minRole: "intern",
    tags: ["soc 2", "audit", "report", "nda", "security"],
    body: "Audit period 1 January to 30 June 2026, report issued 14 August 2026 by Harlow & Pike LLP. The full report is shared under NDA within 3 business days of a request to security@nimbuslabs.example.",
  },
  {
    id: "backup",
    title: "Backup and recovery plan",
    kind: "Policy",
    minRole: "intern",
    tags: ["backup", "recovery", "singapore", "replica", "rpo", "rto", "india"],
    body: "RPO 1 hour, RTO 4 hours. Production is in Mumbai with a cross-region replica in Singapore. Customers who need all copies kept in India should discuss this before signing.",
  },
  {
    id: "access",
    title: "Access control policy",
    kind: "Policy",
    minRole: "intern",
    tags: ["access", "approval", "production", "just-in-time", "aws"],
    body: "Low-risk apps are approved automatically. High-risk apps such as AWS production need the Engineering Manager. Production access lasts at most 8 hours. Interns are not eligible.",
  },
];

const BY_ID: Record<string, Doc> = Object.fromEntries(DOCS.map((d) => [d.id, d]));

const ANSWERS: { test: RegExp; text: string; cites: string[] }[] = [
  {
    test: /go.?live|launch|30 nov/,
    text: "Meridian go-live is Monday 30 November 2026. Karan Malhotra owns delivery.",
    cites: ["launch"],
  },
  {
    test: /india|singapore|replica|disaster|data location/,
    text: "Production data is stored in India by default, but the disaster recovery replica is in Singapore. Meridian raised this on 29 Oct and it needs to be agreed before signing.",
    cites: ["backup", "n-29"],
  },
  {
    test: /soc ?2|audit report|nda/,
    text: "The SOC 2 Type II report is shared under NDA within 3 business days of a request.",
    cites: ["soc2"],
  },
];

const BRIEFING: { text: string; cite: string }[] = [
  {
    cite: "n-27",
    text: "27 Oct: kickoff follow-ups went out. Meridian wants the SOC 2 Type II report and the sub-processor list.",
  },
  {
    cite: "n-28",
    text: "28 Oct: Meera has Slack and Google Workspace. Figma was auto-approved and AWS production went to Karan.",
  },
  {
    cite: "n-29",
    text: "29 Oct: Meridian asked about India-only copies. The DR replica is in Singapore, so it needs agreeing before signing.",
  },
  {
    cite: "n-30",
    text: "30 Oct: UPI test plan outlined. The UAT environment still has no owner. Go-live is unchanged.",
  },
];

const STOP = new Set(["the", "me", "up", "on", "of", "a", "an", "in", "to", "and", "is", "what", "when", "who", "for"]);

const canRead = (doc: Doc, role: Role) => doc.minRole === "intern" || role === "founder";

function toWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function score(doc: Doc, words: string[], locked: boolean): number {
  const title = doc.title.toLowerCase();
  const tags = doc.tags.join(" ").toLowerCase();
  // Locked documents are matched on title and tags only, so their contents never leak.
  const body = locked ? "" : doc.body.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (title.includes(w)) s += 3;
    if (tags.includes(w)) s += 2;
    if (body.includes(w)) s += 1;
  }
  return s;
}

function snippet(body: string, words: string[]): string {
  const lower = body.toLowerCase();
  let idx = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  const start = Math.max(0, idx - 40);
  const end = start + 130;
  return (start > 0 ? "..." : "") + body.slice(start, end) + (end < body.length ? "..." : "");
}

function highlight(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(" + escaped.join("|") + ")", "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-[#5046E5]/30 px-0.5 text-slate-900 dark:text-slate-100">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-[#0b1120] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
      {children}
    </kbd>
  );
}

function Tag({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" }) {
  const cls = tone === "amber" ? "border-amber-500/40 text-amber-400" : "border-slate-700 text-slate-400";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role>("intern");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>("search");
  const [pinned, setPinned] = useState<string | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setMode("search");
    setPinned(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    };
    const onOpen = () => openPalette();
    window.addEventListener("keydown", onKey);
    window.addEventListener("plexus:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("plexus:open-search", onOpen);
    };
  }, [openPalette]);

  const words = useMemo(() => toWords(query), [query]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const q = query.toLowerCase();
    if (words.length === 0 || /catch|brief|meridian/.test(q)) out.push({ kind: "catchup" });
    const pool = DOCS.map((doc) => ({ doc, locked: !canRead(doc, role) }));
    if (words.length === 0) {
      pool.slice(0, 7).forEach((p) => out.push({ kind: "doc", ...p }));
      return out;
    }
    pool
      .map((p) => ({ ...p, s: score(p.doc, words, p.locked) }))
      .filter((p) => p.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .forEach((p) => out.push({ kind: "doc", doc: p.doc, locked: p.locked }));
    return out;
  }, [query, words, role]);

  const answer = useMemo(() => {
    if (words.length < 2) return null;
    const q = query.toLowerCase();
    const hit = ANSWERS.find((a) => a.test.test(q));
    if (!hit) return null;
    if (!hit.cites.every((id) => canRead(BY_ID[id], role))) return null;
    return hit;
  }, [query, words, role]);

  const activeRow = rows[Math.min(active, Math.max(rows.length - 1, 0))];
  const previewId = pinned ?? (activeRow && activeRow.kind === "doc" ? activeRow.doc.id : null);
  const preview = previewId ? BY_ID[previewId] : null;
  const previewLocked = preview ? !canRead(preview, role) : false;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "briefing") setMode("search");
      else setOpen(false);
      return;
    }
    if (mode === "briefing") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPinned(null);
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPinned(null);
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && activeRow?.kind === "catchup") {
      e.preventDefault();
      setMode("briefing");
      setPinned(null);
    }
  };

  const cite = (id: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setPinned(id)}
      className="mx-0.5 rounded border border-indigo-400/40 px-1 font-mono text-[10px] text-indigo-300 hover:bg-indigo-400/10"
      title={BY_ID[id].title + (BY_ID[id].date ? ", " + BY_ID[id].date : "")}
    >
      {n}
    </button>
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/70 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-xl border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-[#0c1424] text-slate-900 dark:text-slate-900 dark:text-slate-100 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] dark:border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setPinned(null);
              setMode("search");
            }}
            placeholder="Search documents, or try: catch me up on Meridian"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-slate-700 dark:text-slate-300"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Role scope */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] dark:border-slate-800 px-4 py-2 bg-[#F9FAFB] dark:bg-transparent">
          <span className="text-xs text-slate-500">Searching as</span>
          <div className="flex rounded-md border border-[#E5E7EB] dark:border-slate-700 p-0.5 bg-white dark:bg-transparent">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRole(r.id);
                  setActive(0);
                  setPinned(null);
                }}
                className={`rounded px-2.5 py-1 text-xs ${
                  role === r.id ? "bg-[#5046E5] text-white" : "text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid max-h-[56vh] md:grid-cols-[1.35fr_1fr]">
          {/* Left column */}
          <div className="min-h-[260px] overflow-y-auto border-[#E5E7EB] dark:border-slate-800 md:border-r">
            {mode === "briefing" ? (
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => setMode("search")}
                  className="text-xs text-indigo-300 hover:underline"
                >
                  Back to results
                </button>
                <div className="mt-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#5046E5]" />
                  <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Meridian, last 4 days (27 to 30 Oct)
                  </h2>
                </div>
                <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {BRIEFING.map((b, i) => (
                    <li key={b.cite}>
                      {b.text}
                      {cite(b.cite, i + 1)}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded border border-[#E5E7EB] dark:border-slate-800 bg-[#F9FAFB] dark:bg-[#0b1120] p-3 text-xs text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Open items: </span>
                  UAT environment owner, India-only copies agreement.
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Built from {BRIEFING.length} sources. Select a number to read one.
                </p>
              </div>
            ) : (
              <div className="py-1">
                {answer && (
                  <div className="m-3 rounded-lg border border-indigo-400/30 bg-indigo-400/5 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-indigo-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      Answer
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-200">
                      {answer.text}
                      {answer.cites.map((id, i) => cite(id, i + 1))}
                    </p>
                  </div>
                )}

                {rows.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">
                    No matches. Try a project, a person or a policy name.
                  </p>
                )}

                {rows.map((row, i) => {
                  const isActive = i === active && pinned === null;
                  const base = `flex w-full items-start gap-3 border-l-2 px-4 py-2.5 text-left ${
                    isActive ? "border-[#5046E5] bg-[#5046E5]/15" : "border-transparent hover:bg-gray-100/80 dark:hover:bg-slate-800/40"
                  }`;
                  if (row.kind === "catchup") {
                    return (
                      <button
                        key="catchup"
                        type="button"
                        className={base}
                        onMouseEnter={() => {
                          setActive(i);
                          setPinned(null);
                        }}
                        onClick={() => setMode("briefing")}
                      >
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#5046E5]" />
                        <div>
                          <div className="text-sm text-slate-900 dark:text-slate-100">Catch me up on Meridian</div>
                          <div className="text-xs text-slate-500">Briefing for the last 4 days, with sources</div>
                        </div>
                      </button>
                    );
                  }
                  const { doc, locked } = row;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      className={base}
                      onMouseEnter={() => {
                        setActive(i);
                        setPinned(null);
                      }}
                      onClick={() => setPinned(doc.id)}
                    >
                      {locked ? (
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm text-slate-900 dark:text-slate-100">
                            {highlight(doc.title, words)}
                          </span>
                          {doc.date && <span className="font-mono text-[11px] text-slate-500">{doc.date}</span>}
                          {locked && <Tag tone="amber">Founder only</Tag>}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                          {locked
                            ? "You do not have access to this document."
                            : highlight(snippet(doc.body, words), words)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="hidden overflow-y-auto p-4 md:block">
            {preview ? (
              previewLocked ? (
                <div>
                  <Lock className="h-5 w-5 text-amber-400" />
                  <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{preview.title}</h3>
                  <p className="mt-1 text-[13px] text-slate-400">
                    This document is limited to the founder. Interns cannot read it.
                  </p>
                  <Link
                    href="/access"
                    onClick={() => setOpen(false)}
                    className="mt-3 inline-block rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-800"
                  >
                    Request access
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{preview.kind}</Tag>
                    {preview.date && <span className="font-mono text-[11px] text-slate-500">{preview.date}</span>}
                  </div>
                  <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{preview.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
                    {highlight(preview.body, words)}
                  </p>
                  <p className="mt-3 break-all font-mono text-[11px] text-slate-500">source: doc/{preview.id}</p>
                </div>
              )
            ) : (
              <p className="text-xs text-slate-500">Select a result to preview it and see its source.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] dark:border-slate-800 px-4 py-2 text-[11px] text-gray-500 dark:text-slate-500 bg-[#F9FAFB] dark:bg-transparent">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>Up</Kbd>
              <Kbd>Down</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="inline h-3 w-3" />
              </Kbd>{" "}
              open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> close
            </span>
          </div>
          <span>Sample data. Role limits are applied in app code.</span>
        </div>
      </div>
    </div>
  );
}