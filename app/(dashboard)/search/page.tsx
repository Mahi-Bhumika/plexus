"use client";

import { useEffect, useState } from "react";

const openSearch = () => window.dispatchEvent(new Event("plexus:open-search"));

type SearchRecord = {
  id: string;
  title: string;
  snippet: string;
  source: string;
  category: string;
  badge: string;
  badgeCls: string;
};

const SAMPLE_RESULTS: SearchRecord[] = [
  {
    id: "res-1",
    title: "Meridian Bank Pilot Kickoff & SLA Terms",
    snippet:
      "Incident response SLA guaranteed at 24 hours for UPI reconciliation payment feeds. Cross-border replica in Singapore with primary storage in India.",
    source: "seed/cmdk/02_meridian_notes_2026-10-28.md",
    category: "Transcript & Notes",
    badge: "Verified Term",
    badgeCls: "text-emerald-700 bg-emerald-50 border-emerald-200",
  },
  {
    id: "res-2",
    title: "Access Control & Separation of Duties Policy",
    snippet:
      "Engineering managers may not self-approve AWS Production elevations. Requests automatically escalate to CEO (Riya Sharma). Interns ineligible for production.",
    source: "seed/knowledge/04_access_control_policy.md",
    category: "Security Policy",
    badge: "Strict Rule",
    badgeCls: "text-[#3B5BFD] bg-blue-50 border-blue-200",
  },
  {
    id: "res-3",
    title: "Company Travel & Expense Reimbursement Policy",
    snippet:
      "Domestic air travel capped at ₹8,000 per ticket. Metro lodging capped at ₹9,000/night. Incidentals under ₹1,000 do not require physical receipts.",
    source: "seed/finance/expense_policy.md",
    category: "Finance Policy",
    badge: "Policy Active",
    badgeCls: "text-amber-700 bg-amber-50 border-amber-200",
  },
  {
    id: "res-4",
    title: "SOC 2 Type II Schellman Audit Summary",
    snippet:
      "Concluded on November 30, 2024 with zero exceptions. Cure53 third-party pen-test with 48h remediation SLA for critical findings.",
    source: "seed/knowledge/01_soc2_summary.md",
    category: "Compliance",
    badge: "Audited",
    badgeCls: "text-emerald-700 bg-emerald-50 border-emerald-200",
  },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(SAMPLE_RESULTS);

  useEffect(() => {
    // Optionally open search overlay
  }, []);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults(SAMPLE_RESULTS);
    } else {
      setResults(
        SAMPLE_RESULTS.filter(
          (r) =>
            r.title.toLowerCase().includes(q.toLowerCase()) ||
            r.snippet.toLowerCase().includes(q.toLowerCase()) ||
            r.source.toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-5">
      {/* Search Header Banner */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#3B5BFD] font-mono text-[10px] font-medium tracking-wide uppercase">
              Global Swarm Inspector
            </span>
            <span className="text-gray-400 text-xs">•</span>
            <span className="text-xs font-mono text-gray-500">Meko Index v4.9</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-[#111827]">
            Swarm Memory &amp; Trace Search
          </h1>
          <p className="text-xs text-gray-600 mt-1 max-w-2xl leading-relaxed">
            Query across knowledge vectors, RFP answer banks, expense rules, and
            execution traces in real-time.
          </p>
        </div>

        <button
          type="button"
          onClick={openSearch}
          className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white font-mono text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all cursor-pointer self-start lg:self-center"
        >
          <span className="material-symbols-outlined text-[16px]">search</span>
          <span>Open Quick Cmd+K Palette</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="bg-white border border-[#E5E7EB] p-3 rounded-xl shadow-xs flex items-center gap-3">
        <span className="material-symbols-outlined text-[20px] text-gray-400 pl-1">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search documents, policies, or try: catch me up on Meridian..."
          className="flex-1 bg-transparent border-none text-xs text-[#111827] focus:outline-none placeholder:text-gray-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => handleSearch("")}
            className="text-gray-400 hover:text-gray-700 text-xs font-mono px-2 cursor-pointer"
          >
            Clear
          </button>
        )}
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#F3F4F6] text-gray-500 font-mono text-[10px] border border-[#E5E7EB]">
          ⌘K
        </kbd>
      </div>

      {/* Results List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-gray-500 font-mono px-1">
          <span>Found {results.length} indexed chunks</span>
          <span>Ranked by BM25 + Vector Cosine Sim</span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {results.map((res) => (
            <div
              key={res.id}
              className="p-4 rounded-xl bg-white border border-[#E5E7EB] hover:border-gray-300 transition-all shadow-xs flex flex-col gap-2 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#3B5BFD]">
                    description
                  </span>
                  <h3 className="text-xs font-semibold text-[#111827] group-hover:text-[#3B5BFD] transition-colors">
                    {res.title}
                  </h3>
                </div>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium border ${res.badgeCls}`}
                >
                  {res.badge}
                </span>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed font-sans">
                {res.snippet}
              </p>

              <div className="flex items-center justify-between pt-2 border-t border-[#E5E7EB] font-mono text-[11px] text-gray-400">
                <span className="truncate">{res.source}</span>
                <span className="text-gray-500">{res.category}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
