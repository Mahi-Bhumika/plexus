"use client";

// File: components/command-palette.tsx
// Mount once in app/(dashboard)/layout.tsx:  <CommandPalette />
// Open it from anywhere: window.dispatchEvent(new CustomEvent("plexus:open-search", { detail: { query, role } }))
// Live data: GET /api/search (search and browse) and POST /api/search/catchup (briefing).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { CornerDownLeft, FileText, Lock, Search, Sparkles, X } from "lucide-react";

type Role = "intern" | "founder";
type Mode = "search" | "briefing";

interface Hit {
  id: string;
  title: string;
  snippet: string;
  doc: string;
  documentId: string;
  matchType: string;
  date?: string | null;
  flagged?: boolean;
}
interface Point {
  text: string;
  source: number;
}
interface Brief {
  topic: string;
  days: number;
  window: { from: string; to: string; days: number } | null;
  points: Point[];
  results: Hit[];
  note: string | null;
  briefingMode: string | null;
  briefingNote: string | null;
  hidden: number;
}

type Row = { kind: "catchup" } | { kind: "hit"; hit: Hit } | { kind: "locked"; count: number };

const ROLES: { id: Role; label: string }[] = [
  { id: "intern", label: "Intern (Arjun)" },
  { id: "founder", label: "Founder (Riya)" },
];

const CATCHUP_RE = /catch\s*me\s*up/i;
const STOP = new Set(["the", "me", "up", "on", "of", "a", "an", "in", "to", "and", "is", "what", "when", "who", "for"]);

function toWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
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
  const [pinned, setPinned] = useState<string | null>(null); // a hit id, or "locked"
  const [hits, setHits] = useState<Hit[]>([]);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [autoBrief, setAutoBrief] = useState(false);
  const openRef = useRef(false);
  const searchReq = useRef(0);
  const briefReq = useRef(0);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const openPalette = useCallback((prefill?: string, prefillRole?: string) => {
    setQuery(prefill ?? "");
    if (prefillRole === "intern" || prefillRole === "founder") setRole(prefillRole);
    setActive(0);
    setMode("search");
    setPinned(null);
    setBrief(null);
    setHits([]);
    setHidden(0);
    setError(null);
    setAutoBrief(!!prefill && CATCHUP_RE.test(prefill));
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
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ query?: string; role?: string } | undefined>).detail;
      openPalette(d?.query, d?.role);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("plexus:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("plexus:open-search", onOpen);
    };
  }, [openPalette]);

  // Live search (debounced while typing). An empty query lists one passage per document.
  useEffect(() => {
    if (!open || mode !== "search") return;
    const id = ++searchReq.current;
    const ctrl = new AbortController();
    const q = query.trim();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/search?role=${role}&limit=8${q ? `&mode=search&q=${encodeURIComponent(q)}` : ""}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json().catch(() => ({}));
        if (id !== searchReq.current) return;
        if (!res.ok || data?.status === "error") throw new Error(data?.message ?? `API returned ${res.status}`);
        setHits(data.results ?? []);
        setHidden(data.hidden ?? 0);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (id === searchReq.current) setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (id === searchReq.current) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, mode, query, role]);

  const runBriefing = useCallback(async (q: string, r: Role) => {
    const id = ++briefReq.current;
    setMode("briefing");
    setPinned(null);
    setBriefLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search/catchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: r, query: CATCHUP_RE.test(q) ? q : "Catch me up on Meridian" }),
      });
      const data = await res.json().catch(() => ({}));
      if (id !== briefReq.current) return;
      if (!res.ok || data?.status === "error") throw new Error(data?.message ?? `API returned ${res.status}`);
      setBrief({
        topic: data.topic ?? "Meridian",
        days: data.days ?? 4,
        window: data.window ?? null,
        points: data.points ?? [],
        results: data.results ?? [],
        note: data.note ?? null,
        briefingMode: data.briefingMode ?? null,
        briefingNote: data.briefingNote ?? null,
        hidden: data.hidden ?? 0,
      });
    } catch (e) {
      if (id === briefReq.current) setError(e instanceof Error ? e.message : "Briefing failed");
    } finally {
      if (id === briefReq.current) setBriefLoading(false);
    }
  }, []);

  // Opened with "Catch me up ..." (for example from the Search page button): run the briefing straight away.
  useEffect(() => {
    if (open && autoBrief) {
      setAutoBrief(false);
      runBriefing(query, role);
    }
  }, [open, autoBrief, query, role, runBriefing]);

  const words = useMemo(() => toWords(query), [query]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (words.length === 0 || /catch|brief|meridian/i.test(query)) out.push({ kind: "catchup" });
    hits.forEach((hit) => out.push({ kind: "hit", hit }));
    if (role !== "founder" && hidden > 0) out.push({ kind: "locked", count: hidden });
    return out;
  }, [query, words, hits, hidden, role]);

  const pool = useMemo(() => [...hits, ...(brief?.results ?? [])], [hits, brief]);
  const activeRow = rows[Math.min(active, Math.max(rows.length - 1, 0))];
  const previewLocked = pinned === "locked" || (pinned === null && activeRow?.kind === "locked");
  const preview: Hit | null =
    pinned && pinned !== "locked"
      ? (pool.find((h) => h.id === pinned) ?? null)
      : pinned === null && activeRow?.kind === "hit"
        ? activeRow.hit
        : null;

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
    } else if (e.key === "Enter" && activeRow) {
      e.preventDefault();
      if (activeRow.kind === "catchup") runBriefing(query, role);
      else if (activeRow.kind === "hit") setPinned(activeRow.hit.id);
      else setPinned("locked");
    }
  };

  const cite = (n: number) => {
    const src = brief?.results[n - 1];
    if (!src) return null;
    return (
      <button
        key={n}
        type="button"
        onClick={() => setPinned(src.id)}
        className="mx-0.5 rounded border border-indigo-400/40 px-1 font-mono text-[10px] text-indigo-300 hover:bg-indigo-400/10"
        title={src.doc + (src.date ? ", " + src.date : "")}
      >
        {n}
      </button>
    );
  };

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
        className="w-full max-w-3xl overflow-hidden rounded-xl border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-[#0c1424] text-slate-900 dark:text-slate-100 shadow-2xl"
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
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none"
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
                  if (mode === "briefing") runBriefing(query, r.id);
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
                    {brief ? `${brief.topic}, last ${brief.days} days` : "Catch me up"}
                    {brief?.window ? ` (${brief.window.from} to ${brief.window.to})` : ""}
                  </h2>
                  {brief?.briefingMode === "extractive" && <Tag tone="amber">extractive</Tag>}
                </div>

                {briefLoading && <p className="mt-4 text-sm text-slate-500">Reading the knowledge base…</p>}
                {error && !briefLoading && <p className="mt-4 text-sm text-rose-400">Briefing failed: {error}</p>}

                {brief && !briefLoading && (
                  <>
                    {brief.points.length > 0 ? (
                      <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
                        {brief.points.map((p, i) => (
                          <li key={i}>
                            {p.text}
                            {cite(p.source)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
                        {brief.note ?? "Nothing to brief on yet."}
                      </p>
                    )}
                    {brief.points.length > 0 && brief.briefingNote && (
                      <p className="mt-3 text-[11px] text-amber-400">{brief.briefingNote}</p>
                    )}
                    <p className="mt-3 text-[11px] text-slate-500">
                      Built from {brief.results.length} source{brief.results.length === 1 ? "" : "s"}.
                      {brief.points.length > 0 ? " Select a number to read one." : ""}
                      {brief.hidden > 0 && role !== "founder" ? ` ${brief.hidden} restricted hidden for ${role}.` : ""}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="py-1">
                {loading && rows.length <= 1 && <p className="px-4 py-3 text-xs text-slate-500">Searching…</p>}
                {error && <p className="px-4 py-3 text-xs text-rose-400">Search failed: {error}</p>}

                {!loading && !error && rows.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">
                    No matches. Try a project, a person or a policy name.
                  </p>
                )}

                {rows.map((row, i) => {
                  const isActive = i === active && pinned === null;
                  const base = `flex w-full items-start gap-3 border-l-2 px-4 py-2.5 text-left ${
                    isActive ? "border-[#5046E5] bg-[#5046E5]/15" : "border-transparent hover:bg-gray-100/80 dark:hover:bg-slate-800/40"
                  }`;
                  const hover = () => {
                    setActive(i);
                    setPinned(null);
                  };

                  if (row.kind === "catchup") {
                    return (
                      <button
                        key="catchup"
                        type="button"
                        className={base}
                        onMouseEnter={hover}
                        onClick={() => runBriefing(query, role)}
                      >
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#5046E5]" />
                        <div>
                          <div className="text-sm text-slate-900 dark:text-slate-100">Catch me up on Meridian</div>
                          <div className="text-xs text-slate-500">Briefing for the last 4 days, with sources</div>
                        </div>
                      </button>
                    );
                  }

                  if (row.kind === "locked") {
                    return (
                      <button
                        key="locked"
                        type="button"
                        className={base}
                        onMouseEnter={hover}
                        onClick={() => setPinned("locked")}
                      >
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-900 dark:text-slate-100">
                              {row.count} restricted result{row.count > 1 ? "s" : ""} hidden
                            </span>
                            <Tag tone="amber">Founder only</Tag>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">You do not have access to these documents.</div>
                        </div>
                      </button>
                    );
                  }

                  const { hit } = row;
                  const primary = hit.title === "Untitled" ? hit.doc : hit.title;
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      className={base}
                      onMouseEnter={hover}
                      onClick={() => setPinned(hit.id)}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm text-slate-900 dark:text-slate-100">
                            {highlight(primary, words)}
                          </span>
                          {hit.date && <span className="font-mono text-[11px] text-slate-500">{hit.date}</span>}
                          {hit.flagged && <Tag tone="amber">flagged</Tag>}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                          {highlight(snippet(hit.snippet, words), words)}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{hit.doc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="hidden overflow-y-auto p-4 md:block">
            {previewLocked ? (
              <div>
                <Lock className="h-5 w-5 text-amber-400" />
                <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">Restricted documents</h3>
                <p className="mt-1 text-[13px] text-slate-400">
                  These documents are limited to the founder. Interns cannot read them.
                </p>
                <Link
                  href="/access"
                  onClick={() => setOpen(false)}
                  className="mt-3 inline-block rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-800"
                >
                  Request access
                </Link>
              </div>
            ) : preview ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{preview.matchType}</Tag>
                  {preview.date && <span className="font-mono text-[11px] text-slate-500">{preview.date}</span>}
                  {preview.flagged && <Tag tone="amber">flagged</Tag>}
                </div>
                <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {preview.title === "Untitled" ? preview.doc : preview.title}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {highlight(preview.snippet, words)}
                </p>
                <p className="mt-3 break-all font-mono text-[11px] text-slate-500">
                  source: {preview.doc} · {(preview.documentId || preview.id).slice(0, 8)}
                </p>
              </div>
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
          <span>Live from the Meko knowledge base. Role limits are applied in app code.</span>
        </div>
      </div>
    </div>
  );
}
``
