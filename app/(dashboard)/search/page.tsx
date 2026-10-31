"use client";

// Route: app/(dashboard)/search/page.tsx
// The sidebar item "Search Cmd+K" lands here and the palette opens on arrival.
// <CommandPalette /> must be mounted in app/(dashboard)/layout.tsx.

import { useEffect } from "react";
import { Search } from "lucide-react";

const openSearch = () => window.dispatchEvent(new Event("plexus:open-search"));

export default function SearchPage() {
  useEffect(() => {
    openSearch();
  }, []);

  return (
    <div className="min-h-full bg-[#0b1120] text-slate-200">
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Search</h1>
            <p className="mt-1 text-sm text-slate-400">
              Find answers across project notes and policies, with sources.
            </p>
          </div>
          <span className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Sample data
          </span>
        </div>

        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-[#0c1424] px-4 py-3 text-left text-sm text-slate-500 hover:border-slate-700"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1">Search documents, or try: catch me up on Meridian</span>
          <kbd className="rounded border border-slate-700 bg-[#0b1120] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            Ctrl K
          </kbd>
        </button>
      </div>
    </div>
  );
}