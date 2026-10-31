"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityFeed } from "@/components/ActivityFeed";
import {
  FileText,
  ListTodo,
  KeyRound,
  Search,
  Receipt,
  History,
  Shield,
} from "lucide-react";

const NAV_ITEMS = [
  { name: "RFP Agent", href: "/rfp", icon: FileText },
  { name: "ActionSwarm", href: "/actions", icon: ListTodo },
  { name: "Access Agent", href: "/access", icon: KeyRound },
  { name: "Search (Cmd+K)", href: "/search", icon: Search },
  { name: "Finance Agent", href: "/finance", icon: Receipt },
  { name: "Audit Trail", href: "/audit", icon: History },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-screen overflow-x-hidden overflow-y-hidden bg-[#0F172A] text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0F172A] border-r border-slate-800/80 flex flex-col flex-shrink-0 text-slate-100">
        <div className="p-4 border-b border-slate-800/80 flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#4F46E5]/20 text-[#4F46E5] border border-[#4F46E5]/30">
            <Shield className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white leading-none">Plexus</h1>
            <p className="text-[11px] text-slate-400 mt-1">Multi-Agent Control & Guard</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[#4F46E5] text-white font-semibold shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800/80 text-[11px] text-slate-400">
          <div className="font-medium text-slate-300">Nimbus Labs demo</div>
          <div className="text-[10px] text-slate-500 mt-0.5">HackCBS 9.0 · Meridian Bank</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0F172A] overflow-y-auto">
        {children}
      </main>

      {/* Right Column: Activity Feed */}
      <ActivityFeed />
    </div>
  );
}
