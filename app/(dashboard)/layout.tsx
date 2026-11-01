"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CommandPalette from "@/components/command-palette";
import SidePanel from "@/components/SidePanel";

const NAV_ITEMS = [
  { name: "Finance Agent", href: "/finance", icon: "payments" },
  { name: "RFP Agent", href: "/rfp", icon: "description" },
  { name: "ActionSwarm", href: "/actions", icon: "hive" },
  { name: "Search (Catch-Me-Up)", href: "/search", icon: "troubleshoot", kbd: "⌘K" },
  { name: "Access Agent", href: "/access", icon: "verified_user" },
  { name: "Zombie SaaS Detector", href: "/audit", icon: "shield" },
];

// Short labels so the top pill bar still fits
const TOP_NAV_ITEMS = [
  { name: "Finance Agent", href: "/finance" },
  { name: "RFP Agent", href: "/rfp" },
  { name: "ActionSwarm", href: "/actions" },
  { name: "Search", href: "/search" },
  { name: "Access Agent", href: "/access" },
  { name: "Zombie SaaS", href: "/audit" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState<boolean>(false);
  const [feedOk, setFeedOk] = useState<boolean>(true);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("plexus-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedTheme === "dark" || (!savedTheme && prefersDark);

    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  }, []);

  // Health ping for the top-bar latency pill. The activity list itself lives in <SidePanel />.
  useEffect(() => {
    let stop = false;
    async function tick() {
      const t0 = performance.now();
      try {
        const res = await fetch("/api/feed?limit=1", { cache: "no-store" });
        const data = await res.json();
        if (stop) return;
        if (!res.ok || data?.status === "error") throw new Error("feed error");
        setFeedOk(true);
        setLatency(Math.round(performance.now() - t0));
      } catch {
        if (!stop) setFeedOk(false);
      }
    }
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const toggleDarkMode = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
      localStorage.setItem("plexus-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
      localStorage.setItem("plexus-theme", "light");
    }
  };

  const openCmdK = () => {
    window.dispatchEvent(new Event("plexus:open-search"));
  };

  const isActiveHref = (href: string) =>
    pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#090D16] text-[#111827] dark:text-[#F3F4F6] antialiased selection:bg-[#3B5BFD]/20 selection:text-[#3B5BFD] transition-colors duration-200">
      <CommandPalette />

      {/* TOP BAR SHELL */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 bg-white/90 dark:bg-[#0C1222]/90 backdrop-blur-xl border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between px-4 sm:px-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors duration-200">
        {/* Brand + Workspace Switcher */}
        <div className="flex items-center gap-3">
          <Link href="/finance" className="flex items-center gap-2 pr-2 group">
            <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-[#3B5BFD] to-indigo-600 flex items-center justify-center text-white shadow-sm ring-1 ring-black/5">
              <span className="material-symbols-outlined text-[15px] font-bold">hub</span>
            </div>
            <span className="font-semibold text-sm tracking-tight text-[#111827] dark:text-[#F3F4F6]">
              Plexus
            </span>
          </Link>
          <div className="h-3.5 w-px bg-[#E5E7EB] dark:bg-[#1E293B]"></div>

          {/* Workspace pill */}
          <button
            type="button"
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F3F4F6] dark:bg-[#162032] hover:bg-[#E5E7EB]/80 dark:hover:bg-[#1F2C44] border border-[#E5E7EB] dark:border-[#1E293B] text-xs transition-all group cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"></span>
            <span className="text-[#111827] dark:text-[#F3F4F6] font-medium text-xs">
              Nimbus Labs
            </span>
            <span className="text-gray-400 dark:text-gray-500 text-[10px]">×</span>
            <span className="text-gray-600 dark:text-gray-400 text-xs truncate max-w-[140px] sm:max-w-[180px]">
              Meridian Pilot
            </span>
            <span className="material-symbols-outlined text-[14px] text-gray-400 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 ml-0.5">
              unfold_more
            </span>
          </button>
        </div>

        {/* Center Segmented Pill Navigation */}
        <nav className="hidden lg:flex items-center p-0.5 rounded-lg bg-[#F3F4F6] dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] shadow-inner">
          {TOP_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1 rounded-md text-xs transition-all ${
                isActiveHref(item.href)
                  ? "bg-white dark:bg-[#0F172A] text-[#111827] dark:text-[#F3F4F6] font-semibold shadow-sm border border-[#E5E7EB] dark:border-[#1E293B]"
                  : "text-gray-600 dark:text-gray-400 hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-white/60 dark:hover:bg-[#1E293B]/60 font-medium"
              }`}
            >
              {item.name}
            </Link>
          ))}
        </nav>

        {/* Right utility controls */}
        <div className="flex items-center gap-2.5">
          {/* Search Cmd+K */}
          <button
            type="button"
            onClick={openCmdK}
            className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F3F4F6] dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] hover:border-gray-400 dark:hover:border-gray-500 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs transition-all cursor-pointer group shadow-sm"
          >
            <span className="material-symbols-outlined text-[15px] text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300">
              search
            </span>
            <span className="font-normal text-xs">Search documents, or catch me up...</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#0F172A] text-gray-500 dark:text-gray-400 text-[10px] font-mono border border-[#E5E7EB] dark:border-[#1E293B] font-medium shadow-2xs">
              ⌘K
            </kbd>
          </button>

          {/* DARK MODE TOGGLE BUTTON */}
          <button
            type="button"
            onClick={toggleDarkMode}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle dark mode"
            className="flex items-center justify-center w-8 h-8 rounded-md bg-[#F3F4F6] dark:bg-[#162032] hover:bg-[#E5E7EB] dark:hover:bg-[#1F2C44] border border-[#E5E7EB] dark:border-[#1E293B] text-gray-600 dark:text-amber-400 transition-all cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">
              {isDark ? "light_mode" : "dark_mode"}
            </span>
          </button>

          {/* Measured feed round-trip time */}
          <div
            title="Round-trip time of the last activity feed request"
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md border shadow-sm ${
              feedOk
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${feedOk ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
            <span className="font-mono text-[11px] font-medium">
              {feedOk ? (latency !== null ? `${latency}ms` : "…") : "offline"}
            </span>
          </div>

          {/* User avatar */}
          <div className="flex items-center gap-2 pl-1.5 border-l border-[#E5E7EB] dark:border-[#1E293B] cursor-pointer group">
            <img
              alt="Riya Sharma"
              className="w-7 h-7 rounded-full object-cover ring-1 ring-gray-300 dark:ring-gray-700 group-hover:ring-[#3B5BFD] transition-all"
              src="https://lh3.googleusercontent.com/aida/AEtjO1UHeE2eBPhwDEksGQ4SIxnG3lPXwGbgRxMn6Rhtt5wKfMjt-wHZbly94nFFWlsxOYJWq_NlqpyxS5UvRLzPa5DlvrtoNYXfJjVtutvNmEekPeoAb-BDtsUGPyN7b69A-D3JdDqloJI9FCEiITgiLVqwqEQGutML7x48WJ3c4N714i7ynPReh854qj0IOoob5CcXVCwQoOif1PD34h8H9zihbRshSlUC0GaZ4XHzP8Q"
            />
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] leading-tight group-hover:text-[#3B5BFD]">
                Riya Sharma
              </span>
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 tracking-tight">
                Admin · CEO
              </span>
            </div>
            <span className="material-symbols-outlined text-gray-400 text-[15px] group-hover:text-[#111827] dark:group-hover:text-[#F3F4F6] transition-colors">
              expand_more
            </span>
          </div>
        </div>
      </header>

      {/* SIDEBAR */}
      <aside className="fixed left-0 top-14 bottom-0 w-60 bg-white dark:bg-[#0C1222] border-r border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between z-40 transition-colors duration-200">
        <div className="p-3 space-y-4">
          <div className="px-2 pt-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider font-mono">
              Agents
            </span>
          </div>
          <nav className="space-y-0.5 text-xs">
            {NAV_ITEMS.map((item) => {
              const isActive = isActiveHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all group ${
                    isActive
                      ? "bg-blue-50/80 dark:bg-blue-950/40 text-[#3B5BFD] dark:text-blue-400 font-semibold border border-blue-100 dark:border-blue-900 shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-[#F3F4F6] dark:hover:bg-[#162032]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`material-symbols-outlined text-[16px] ${
                        isActive
                          ? "text-[#3B5BFD] dark:text-blue-400"
                          : "text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className={isActive ? "text-[#111827] dark:text-[#F3F4F6] font-semibold" : ""}>
                      {item.name}
                    </span>
                  </div>
                  {item.kbd && (
                    <kbd className="text-[10px] font-mono text-gray-400 dark:text-gray-500 px-1 py-0.2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      {item.kbd}
                    </kbd>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* MAIN CANVAS */}
      <div className="pl-60 pr-84 xl:pr-96 min-h-screen">
        <main className="w-full min-h-[calc(100vh-3.5rem)] pt-14 bg-[#F9FAFB] dark:bg-[#090D16] transition-colors duration-200">
          {children}
        </main>
      </div>

      {/* RIGHT PANEL: one full-height window; SidePanel switches between Activity and Chat */}
      <aside className="fixed right-0 top-14 bottom-0 w-84 xl:w-96 overflow-hidden bg-white dark:bg-[#0C1222] border-l border-[#E5E7EB] dark:border-[#1E293B] flex flex-col z-30 shadow-[-1px_0_4px_rgba(0,0,0,0.02)] transition-colors duration-200">
        <div className="flex-1 min-h-0 flex flex-col">
          <SidePanel />
        </div>
      </aside>
    </div>
  );
}