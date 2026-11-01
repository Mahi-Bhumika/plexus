"use client";

import { useEffect, useRef, useState } from "react";

const openSearch = (query?: string, role?: string) =>
  window.dispatchEvent(new CustomEvent("plexus:open-search", { detail: query || role ? { query, role } : undefined }));

type Hit = {
  id: string;
  title: string;
  snippet: string;
  doc: string;
  documentId: string;
  matchType: string;
  date?: string | null;
  flagged?: boolean;
};
type Point = { text: string; source: number };
type Role = "founder" | "intern";
type Mode = "search" | "catchup";
type Meta = {
  note: string | null;
  filtered: number;
  flagged: number;
  window: { from: string; to: string; days: number } | null;
  briefingMode: string | null;
  briefingNote: string | null;
};
const EMPTY_META: Meta = { note: null, filtered: 0, flagged: 0, window: null, briefingMode: null, briefingNote: null };

const MATCH_CLS: Record<string, string> = {
  hybrid: "text-emerald-700 bg-emerald-50 border-emerald-200",
  semantic: "text-[#3B5BFD] bg-blue-50 border-blue-200",
  keyword: "text-amber-700 bg-amber-50 border-amber-200",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role>("founder");
  const [results, setResults] = useState<Hit[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [mode, setMode] = useState<Mode>("search");
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  // When set, we stay in Catch-Me-Up mode for this topic (so changing role re-runs it, not a plain search).
  const [catchTopic, setCatchTopic] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);

  async function run(q: string, m: Mode, r: Role) {
    const id = ++reqId.current;
    if (m === "search" && !q.trim()) {
      setResults([]); setBriefing(null); setPoints([]); setMeta(EMPTY_META);
      setHidden(0); setSearched(false); setError(null);
      setLoading(false); // an earlier in-flight request can no longer clear this itself
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, mode: m, role: r }),
      });
      const data = await res.json().catch(() => ({}));
      if (id !== reqId.current) return; // a newer request replaced this one
      if (!res.ok || data?.status === "error") throw new Error(data?.message ?? `API returned ${res.status}`);
      setResults(data.results ?? []);
      setBriefing(data.briefing ?? null);
      setPoints(data.points ?? []);
      setHidden(data.hidden ?? 0);
      setMeta({
        note: data.note ?? null,
        filtered: data.filtered ?? 0,
        flagged: data.flagged ?? 0,
        window: data.window ?? null,
        briefingMode: data.briefingMode ?? null,
        briefingNote: data.briefingNote ?? null,
      });
      setMode(m);
      setSearched(true);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // Debounced search while typing; the Catch me up button runs immediately and sticks to catch-up mode.
  useEffect(() => {
    const delay = catchTopic !== null ? 0 : 400;
    const t = setTimeout(() => {
      if (catchTopic !== null) {
        run(catchTopic, "catchup", role);
        return;
      }
      const catchup = /catch\s*me\s*up/i.test(query);
      run(query, catchup ? "catchup" : "search", role);
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, role, catchTopic, nonce]);

  function catchUp() {
    const topic = query.trim() || "Meridian";
    setCatchTopic(topic);
    setNonce((n) => n + 1);
    openSearch(/catch\s*me\s*up/i.test(topic) ? topic : `Catch me up on ${topic}`, role);
  }

  const windowLabel = meta.window ? `${meta.window.from} to ${meta.window.to} (${meta.window.days} days, up to the latest dated note)` : null;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-5">
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#3B5BFD] font-mono text-[10px] font-medium tracking-wide uppercase">
            Meko knowledge base
          </span>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-[#111827] mt-1">
            Search (Catch-Me-Up)
          </h1>
          <p className="text-xs text-gray-600 mt-1 max-w-2xl leading-relaxed">
            Searches the company knowledge base in Meko and returns the matching passages with their source document.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start lg:self-center">
          <label className="font-mono text-[11px] text-gray-500" htmlFor="role">Viewing as</label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="bg-gray-50 border border-gray-300 text-xs px-2.5 py-1.5 rounded-md cursor-pointer"
          >
            <option value="founder">Founder</option>
            <option value="intern">Intern</option>
          </select>
          <button
            type="button"
            onClick={catchUp}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white font-mono text-xs font-medium cursor-pointer disabled:opacity-60"
          >
            Catch me up
          </button>
          <button
            type="button"
            onClick={() => openSearch()}
            className="px-3 py-1.5 rounded-md bg-white border border-[#E5E7EB] text-gray-700 font-mono text-xs cursor-pointer hover:bg-gray-50"
          >
            ⌘K
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] p-3 rounded-xl flex items-center gap-3">
        <span className="material-symbols-outlined text-[20px] text-gray-400 pl-1">search</span>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCatchTopic(null); }}
          placeholder="Search policies and documents, or type: catch me up on Meridian"
          className="flex-1 bg-transparent border-none text-xs text-[#111827] focus:outline-none placeholder:text-gray-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setCatchTopic(null); }}
            className="text-gray-400 hover:text-gray-700 text-xs font-mono px-2 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs px-4 py-2.5 rounded-lg">
          Search failed: {error}
        </div>
      )}

      {mode === "catchup" && (briefing || points.length > 0) && (
        <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-[#3B5BFD] font-semibold tracking-wider">Briefing</span>
            {meta.briefingMode === "extractive" && (
              <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-mono text-[10px]">
                extractive
              </span>
            )}
          </div>
          {points.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-xs text-gray-700 leading-relaxed list-disc pl-4">
              {points.map((p, i) => (
                <li key={i}>
                  {p.text}{" "}
                  <a href={`#src-${p.source}`} className="font-mono text-[11px] text-[#3B5BFD] hover:underline">
                    [{p.source}]
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{briefing}</pre>
          )}
          {windowLabel && <p className="mt-2 text-[11px] text-gray-400 font-mono">Window: {windowLabel}</p>}
          {meta.briefingNote && <p className="mt-1 text-[11px] text-amber-700 font-mono">{meta.briefingNote}</p>}
          <p className="mt-2 text-[11px] text-gray-400 font-mono">Generated from the sources below. Check the sources before sharing.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-gray-500 font-mono px-1">
          <span>
            {loading
              ? "Searching…"
              : searched
                ? `${results.length} passage${results.length === 1 ? "" : "s"}${meta.filtered ? `, ${meta.filtered} weak match${meta.filtered === 1 ? "" : "es"} dropped` : ""}`
                : "Type to search"}
          </span>
          {role === "intern" && hidden > 0 && (
            <span>{hidden} restricted result{hidden > 1 ? "s" : ""} hidden for Intern (role filter in app code)</span>
          )}
        </div>

        {meta.flagged > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-2.5 rounded-lg">
            {meta.flagged} passage{meta.flagged > 1 ? "s" : ""} contain instruction-like text and were kept out of the briefing.
          </div>
        )}

        {searched && !loading && results.length === 0 && !error && (
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 text-xs text-gray-500 text-center">
            {meta.note ?? "Nothing found. If you expected Meridian notes, they may not be uploaded to the knowledge base yet."}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          {results.map((r, i) => (
            <div
              key={r.id}
              id={`src-${i + 1}`}
              className={`p-4 rounded-xl bg-white border hover:border-gray-300 shadow-xs flex flex-col gap-2 group scroll-mt-24 ${
                r.flagged ? "border-amber-300" : "border-[#E5E7EB]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-400">[{i + 1}]</span>
                  <h3 className="text-xs font-semibold text-[#111827] group-hover:text-[#3B5BFD] transition-colors">{r.title}</h3>
                  {r.date && <span className="font-mono text-[10px] text-gray-400">{r.date}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {r.flagged && (
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] font-medium border text-amber-700 bg-amber-50 border-amber-200">
                      flagged
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium border ${MATCH_CLS[r.matchType] ?? MATCH_CLS.semantic}`}>
                    {r.matchType}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{r.snippet}</p>
              <div className="flex items-center justify-between pt-2 border-t border-[#E5E7EB] font-mono text-[11px] text-gray-400">
                <span className="truncate">{r.doc}</span>
                <span className="text-gray-400">{(r.documentId ?? "").slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}