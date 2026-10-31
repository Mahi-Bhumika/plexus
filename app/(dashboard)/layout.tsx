"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CommandPalette from "@/components/command-palette";

const TOP_NAV_ITEMS = [
  { name: "RFP Agent", href: "/rfp" },
  { name: "ActionSwarm", href: "/actions" },
  { name: "Access Agent", href: "/access" },
  { name: "Finance Agent", href: "/finance" },
  { name: "Audit & SaaS", href: "/audit" },
];

const SIDEBAR_ITEMS = [
  {
    name: "RFP Pipeline",
    href: "/rfp",
    icon: "description",
    badge: "v2.4",
    badgeCls: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800",
  },
  {
    name: "ActionSwarm Matrix",
    href: "/actions",
    icon: "hive",
    badge: "18 nodes",
    badgeCls: "text-[#3B5BFD] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800",
  },
  {
    name: "Access Policies",
    href: "/access",
    icon: "verified_user",
    badge: "ZTA",
    badgeCls: "text-[#3B5BFD] dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800",
  },
  {
    name: "UPI Reconcile Guard",
    href: "/finance",
    icon: "payments",
    badge: "Realtime",
    badgeCls: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800",
  },
  {
    name: "Audit & Compliance",
    href: "/audit",
    icon: "shield",
    badge: "SOC2",
    badgeCls: "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700",
  },
  {
    name: "Swarm Inspector",
    href: "/search",
    icon: "troubleshoot",
    badge: "âŒ˜K",
    badgeCls: "text-gray-500 dark:text-gray-400",
    isKbd: true,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState<boolean>(false);

  useEffect(() => {
    // Check initial preference from localStorage or system
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

  return (
    <div className="min-h-screen bg-[#F9FAFB] dark:bg-[#090D16] text-[#111827] dark:text-[#F3F4F6] antialiased selection:bg-[#3B5BFD]/20 selection:text-[#3B5BFD] transition-colors duration-200">
      <CommandPalette />

      {/* TOP BAR SHELL */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 bg-white/90 dark:bg-[#0C1222]/90 backdrop-blur-xl border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between px-4 sm:px-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors duration-200">
        {/* Brand + Workspace Switcher */}
        <div className="flex items-center gap-3">
          <Link href="/rfp" className="flex items-center gap-2 pr-2 group">
            <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-[#3B5BFD] to-indigo-600 flex items-center justify-center text-white shadow-sm ring-1 ring-black/5">
              <span className="material-symbols-outlined text-[15px] font-bold">hub</span>
            </div>
            <span className="font-semibold text-sm tracking-tight text-[#111827] dark:text-[#F3F4F6]">
              Plexus
            </span>
          </Link>
          <div className="h-3.5 w-px bg-[#E5E7EB] dark:bg-[#1E293B]"></div>

          {/* Workspace pill dropdown */}
          <button
            type="button"
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F3F4F6] dark:bg-[#162032] hover:bg-[#E5E7EB]/80 dark:hover:bg-[#1F2C44] border border-[#E5E7EB] dark:border-[#1E293B] text-xs transition-all group cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"></span>
            <span className="text-[#111827] dark:text-[#F3F4F6] font-medium text-xs">
              Nimbus Labs
            </span>
            <span className="text-gray-400 dark:text-gray-500 text-[10px]">Ã—</span>
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
          {TOP_NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1 rounded-md text-xs transition-all ${
                  isActive
                    ? "bg-white dark:bg-[#0F172A] text-[#111827] dark:text-[#F3F4F6] font-semibold shadow-sm border border-[#E5E7EB] dark:border-[#1E293B]"
                    : "text-gray-600 dark:text-gray-400 hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-white/60 dark:hover:bg-[#1E293B]/60 font-medium"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Right utility controls */}
        <div className="flex items-center gap-2.5">
          {/* Search Cmd+K */}
          <div
            onClick={openCmdK}
            className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F3F4F6] dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] hover:border-gray-400 dark:hover:border-gray-500 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs transition-all cursor-pointer group shadow-sm"
          >
            <span className="material-symbols-outlined text-[15px] text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300">
              search
            </span>
            <span className="font-normal text-xs">Search traces, tokens, nodes...</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#0F172A] text-gray-500 dark:text-gray-400 text-[10px] font-mono border border-[#E5E7EB] dark:border-[#1E293B] font-medium shadow-2xs">
              âŒ˜K
            </kbd>
          </div>

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

          {/* Live latency pill */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 shadow-sm text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-mono text-[11px] font-medium">142ms</span>
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
                Admin Â· CEO
              </span>
            </div>
            <span className="material-symbols-outlined text-gray-400 text-[15px] group-hover:text-[#111827] dark:group-hover:text-[#F3F4F6] transition-colors">
              expand_more
            </span>
          </div>
        </div>
      </header>

      {/* SUB-SIDEBAR (CONTROL DOMAIN) */}
      <aside className="fixed left-0 top-14 bottom-0 w-60 bg-white dark:bg-[#0C1222] border-r border-[#E5E7EB] dark:border-[#1E293B] flex flex-col justify-between z-40 transition-colors duration-200">
        <div className="p-3 space-y-4">
          <div className="px-2 pt-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider font-mono">
              Control Domain
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">v2.4</span>
          </div>
          <nav className="space-y-0.5 text-xs">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname?.startsWith(item.href));
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
                  {item.isKbd ? (
                    <kbd className="text-[10px] font-mono text-gray-400 dark:text-gray-500 px-1 py-0.2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      {item.badge}
                    </kbd>
                  ) : (
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-medium ${item.badgeCls}`}
                    >
                      {item.badge}
                    </span>
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

      {/* DEDICATED ACTIVITY FEED ASIDE */}
      <aside className="fixed right-0 top-14 bottom-0 w-84 xl:w-96 bg-white dark:bg-[#0C1222] border-l border-[#E5E7EB] dark:border-[#1E293B] flex flex-col z-30 shadow-[-1px_0_4px_rgba(0,0,0,0.02)] transition-colors duration-200">
        <div className="h-10 px-3.5 border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between bg-[#F9FAFB]/70 dark:bg-[#090D16]/70">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-mono text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] tracking-tight">
              Shared Activity Feed
            </span>
            <span className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">/stream</span>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">tune</span>
          </button>
        </div>

        {/* Feed Events */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB] dark:divide-[#1E293B] font-mono text-xs">
          <div className="p-3 hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors">
            <div className="flex items-center justify-between text-gray-400 dark:text-gray-500 text-[10px]">
              <span>14:02:44.204</span>
              <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
                c:0.99
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="px-1 py-0.2 rounded bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[#3B5BFD] dark:text-blue-400 text-[9px] uppercase font-bold">
                UPI-REC
              </span>
              <span className="text-[#111827] dark:text-[#F3F4F6] truncate text-xs font-medium">
                BATCH #8821 matched against Meridian ledger
              </span>
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-[10px] pt-1 flex justify-between">
              <span>tx:89fa-03ea-91</span>
              <span className="text-gray-600 dark:text-gray-400 font-medium">UPI-9904</span>
            </div>
          </div>

          <div className="p-3 hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors">
            <div className="flex items-center justify-between text-gray-400 dark:text-gray-500 text-[10px]">
              <span>14:02:41.118</span>
              <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
                c:0.94
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="px-1 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-[9px] uppercase font-bold">
                ACTION
              </span>
              <span className="text-[#111827] dark:text-[#F3F4F6] truncate text-xs font-medium">
                Auto-routed webhook notification to Nimbus core
              </span>
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-[10px] pt-1 flex justify-between">
              <span>tx:12cb-77ef-02</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">HTTP 200 OK</span>
            </div>
          </div>

          <div className="p-3 hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors">
            <div className="flex items-center justify-between text-gray-400 dark:text-gray-500 text-[10px]">
              <span>14:02:37.892</span>
              <span className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1 py-0.2 rounded font-medium">
                c:0.78
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="px-1 py-0.2 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-[9px] uppercase font-bold">
                ACCESS
              </span>
              <span className="text-[#111827] dark:text-[#F3F4F6] truncate text-xs font-medium">
                Elevated token query from agent_rfp_prod
              </span>
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-[10px] pt-1 flex justify-between">
              <span>tx:aa81-44cd-10</span>
              <span className="text-amber-700 dark:text-amber-400 font-medium">Policy Scrutiny</span>
            </div>
          </div>

          <div className="p-3 hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors">
            <div className="flex items-center justify-between text-gray-400 dark:text-gray-500 text-[10px]">
              <span>14:02:32.410</span>
              <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
                c:0.97
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="px-1 py-0.2 rounded bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[#3B5BFD] dark:text-blue-400 text-[9px] uppercase font-bold">
                RFP
              </span>
              <span className="text-[#111827] dark:text-[#F3F4F6] truncate text-xs font-medium">
                Extracted SLA clauses from tender doc bundle
              </span>
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-[10px] pt-1 flex justify-between">
              <span>tx:ff09-22a1-89</span>
              <span className="text-gray-600 dark:text-gray-400 font-medium">SLA-Sec.4</span>
            </div>
          </div>

          <div className="p-3 hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors">
            <div className="flex items-center justify-between text-gray-400 dark:text-gray-500 text-[10px]">
              <span>14:02:29.004</span>
              <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
                c:0.99
              </span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="px-1 py-0.2 rounded bg-[#F3F4F6] dark:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#334155] text-gray-700 dark:text-gray-300 text-[9px] uppercase font-bold">
                GUARD
              </span>
              <span className="text-[#111827] dark:text-[#F3F4F6] truncate text-xs font-medium">
                Prompt injection scanner passed zero vulnerabilities
              </span>
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-[10px] pt-1 flex justify-between">
              <span>tx:e01c-63b7-4a</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">Clean Pass</span>
            </div>
          </div>
        </div>

        {/* Aside Stream Footer */}
        <div className="p-2.5 border-t border-[#E5E7EB] dark:border-[#1E293B] bg-[#F9FAFB]/70 dark:bg-[#090D16]/70 flex items-center justify-between font-mono text-[11px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Stream healthy
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">buffer: 128 / 5000</span>
        </div>
      </aside>
    </div>
  );
}
