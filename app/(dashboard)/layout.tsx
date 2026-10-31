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
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-950 border-r border-zinc-800/80 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-zinc-800/80 flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white leading-none">Plexus</h1>
            <p className="text-[11px] text-zinc-500 mt-1">Multi-Agent Control & Guard</p>
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
                    ? "bg-zinc-800 text-white font-semibold border border-zinc-700/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <Icon className="w-4 h-4 text-zinc-400" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-800/80 text-[11px] text-zinc-500">
          <div>Nimbus Labs demo</div>
          <div className="text-[10px] text-zinc-600 mt-0.5">HackCBS 9.0 · Meridian Bank</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-900 overflow-y-auto">
        {children}
      </main>

      {/* Right Column: Activity Feed */}
      <ActivityFeed />
    </div>
  );
}
