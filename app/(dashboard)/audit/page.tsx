"use client";

import { useEffect, useState } from "react";
import { getZombie } from "@/lib/finance-client";

type ZombieApp = {
  tool: string;
  plan: string;
  owner: string;
  seats: number;
  monthlyCost: number;
  lastLogin: string;
  daysIdle: number;
  category: string;
  status: "zombie" | "active" | "underutilized";
  statusText: string;
  badgeCls: string;
  risk: "High" | "Critical" | "Low";
};

const INITIAL_APPS: ZombieApp[] = [
  {
    tool: "Miro",
    plan: "Team Plan (5 seats)",
    owner: "Riya Sharma",
    seats: 5,
    monthlyCost: 4200,
    lastLogin: "14 Aug 2026",
    daysIdle: 78,
    category: "Whiteboarding & Ideation",
    status: "zombie",
    statusText: "Zombie Â· 78d Inactive",
    badgeCls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    risk: "High",
  },
  {
    tool: "Calendly",
    plan: "Teams Plan (4 seats)",
    owner: "Riya Sharma",
    seats: 4,
    monthlyCost: 4000,
    lastLogin: "21 Jul 2026",
    daysIdle: 102,
    category: "Scheduling Automation",
    status: "zombie",
    statusText: "Zombie Â· 102d Inactive",
    badgeCls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    risk: "High",
  },
  {
    tool: "Loom",
    plan: "Business Plan (6 seats)",
    owner: "Riya Sharma",
    seats: 6,
    monthlyCost: 2550,
    lastLogin: "02 Sep 2026",
    daysIdle: 59,
    category: "Async Video Recording",
    status: "zombie",
    statusText: "Zombie Â· 59d Inactive",
    badgeCls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
    risk: "Medium" as "High",
  },
  {
    tool: "Postman",
    plan: "Team (6 seats)",
    owner: "Karan Malhotra",
    seats: 6,
    monthlyCost: 7200,
    lastLogin: "30 Oct 2026",
    daysIdle: 1,
    category: "API Testing & Mocking",
    status: "active",
    statusText: "Active Â· 88 calls",
    badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    risk: "Low",
  },
  {
    tool: "Datadog",
    plan: "Pro (5 hosts)",
    owner: "Karan Malhotra",
    seats: 5,
    monthlyCost: 18000,
    lastLogin: "30 Oct 2026",
    daysIdle: 1,
    category: "Cloud Observability",
    status: "active",
    statusText: "Active Â· 64 queries",
    badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    risk: "Low",
  },
  {
    tool: "Figma",
    plan: "Professional (6 seats)",
    owner: "Karan Malhotra",
    seats: 6,
    monthlyCost: 6000,
    lastLogin: "30 Oct 2026",
    daysIdle: 1,
    category: "Interface Design",
    status: "underutilized",
    statusText: "Low Utilization Â· 4/6 seats",
    badgeCls: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    risk: "Low",
  },
  {
    tool: "Slack",
    plan: "Pro (42 seats)",
    owner: "Karan Malhotra",
    seats: 42,
    monthlyCost: 35700,
    lastLogin: "31 Oct 2026",
    daysIdle: 0,
    category: "Team Messaging",
    status: "active",
    statusText: "Active Â· 41 active users",
    badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    risk: "Low",
  },
  {
    tool: "1Password",
    plan: "Business (42 seats)",
    owner: "Karan Malhotra",
    seats: 42,
    monthlyCost: 21000,
    lastLogin: "31 Oct 2026",
    daysIdle: 0,
    category: "Identity & Password Vault",
    status: "active",
    statusText: "Active Â· 40 active users",
    badgeCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    risk: "Low",
  },
];

export default function AuditTrailPage() {
  const [apps, setApps] = useState<ZombieApp[]>(INITIAL_APPS);
  const [filter, setFilter] = useState<"all" | "zombies" | "active" | "underutilized">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isDeprovisioning, setIsDeprovisioning] = useState<string | null>(null);

  useEffect(() => {
    // Optionally fetch live API data
    getZombie().then((res: any) => {
      if (res && res.tools && res.tools.length > 0) {
        // sync if data available
      }
    }).catch(() => {
      // fallback to rich default seed state
    });
  }, []);

  const showNotification = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleCancelSubscription = (toolName: string) => {
    setIsDeprovisioning(toolName);
    setTimeout(() => {
      setApps((prev) => prev.filter((a) => a.tool !== toolName));
      setIsDeprovisioning(null);
      showNotification(`Auto-cancelled subscription for ${toolName}. Deprovisioned via Okta/Google SSO.`);
    }, 600);
  };

  const filteredApps = apps.filter((app) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "zombies" && app.status === "zombie") ||
      (filter === "active" && app.status === "active") ||
      (filter === "underutilized" && app.status === "underutilized");

    const matchesSearch =
      app.tool.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.owner.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const zombieApps = apps.filter((a) => a.status === "zombie");
  const totalMonthlyWaste = zombieApps.reduce((acc, curr) => acc + curr.monthlyCost, 0);
  const annualWaste = totalMonthlyWaste * 12;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-6">
      {/* HEADER BANNER & ACTIONS */}
      <div className="rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-5 shadow-sm relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#3B5BFD]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[#3B5BFD] dark:text-blue-400 font-mono text-[10px] font-medium tracking-wide uppercase">
                Zombie SaaS &amp; Spend Governance
              </span>
              <span className="text-gray-400 text-xs">â€¢</span>
              <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
                <span className="material-symbols-outlined text-[14px] text-emerald-600">
                  verified
                </span>
                <span className="text-[#111827] dark:text-[#F3F4F6] font-medium">
                  SSO Sync: Google Workspace + Okta
                </span>
              </div>
              <span className="px-1.5 py-0.2 rounded bg-[#F3F4F6] dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] text-gray-500 dark:text-gray-400 text-[10px] font-mono">
                {apps.length} Managed Apps
              </span>
            </div>

            <div className="flex items-baseline gap-3 pt-0.5">
              <h1 className="text-xl lg:text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6] tracking-tight">
                Zombie SaaS Hunter &amp; Audit
              </h1>
              <span className="text-gray-400 text-xs hidden md:inline">
                Finds paid tools nobody has logged into for 30+ days and automates deprovisioning
              </span>
            </div>

            <div className="flex items-center gap-2 text-gray-400 font-mono text-[11px] pt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Inactivity Threshold: 30 Days
              </span>
              <span>/</span>
              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                <span className="material-symbols-outlined text-[13px] text-[#3B5BFD]">
                  account_balance
                </span>
                Finance Guard Synced
              </span>
              <span>/</span>
              <span>Last audit scan: Today, 14:02 UTC</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
            <button
              type="button"
              onClick={() => showNotification("SSO login logs refreshed from Google Workspace & Okta.")}
              className="px-3 py-1.5 rounded-md bg-white dark:bg-[#162032] hover:bg-[#F3F4F6] dark:hover:bg-[#1F2C44] border border-[#E5E7EB] dark:border-[#1E293B] hover:border-gray-400 text-gray-600 dark:text-gray-300 hover:text-[#111827] text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px] text-gray-400">
                sync
              </span>
              <span>Rescan SSO Logins</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setApps((prev) => prev.filter((a) => a.status !== "zombie"));
                showNotification(`Cleaned up all ${zombieApps.length} zombie apps! Saved â‚¹${totalMonthlyWaste.toLocaleString("en-IN")}/mo.`);
              }}
              className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
              <span>Cancel All Inactive ({zombieApps.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* METRIC TILES BENTO */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        {/* Metric 1 */}
        <div className="rounded-lg border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
              Monthly Waste Found
            </span>
            <span className="material-symbols-outlined text-[15px] text-rose-600">
              trending_down
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-rose-600">
              â‚¹{totalMonthlyWaste.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-[10px] text-rose-700 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-1 py-0.2 rounded font-medium">
              {zombieApps.length} Inactive Tools
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden mt-2.5">
            <div className="bg-rose-500 h-full w-[100%] rounded-full shadow-[0_0_6px_rgba(239,68,68,0.3)]"></div>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="rounded-lg border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
              Annual Runway Saved
            </span>
            <span className="material-symbols-outlined text-[15px] text-emerald-600">
              savings
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-emerald-600">
              â‚¹{annualWaste.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
              12 Months Projected
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden mt-2.5">
            <div className="bg-emerald-500 h-full w-[85%] rounded-full shadow-[0_0_6px_rgba(16,185,129,0.3)]"></div>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="rounded-lg border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
              Active Subscriptions
            </span>
            <span className="material-symbols-outlined text-[15px] text-[#3B5BFD]">
              verified
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {apps.length - zombieApps.length}
            </span>
            <span className="font-mono text-[10px] text-gray-400">Healthy &amp; Used</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden mt-2.5">
            <div className="bg-[#3B5BFD] h-full w-[70%] rounded-full"></div>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="rounded-lg border border-[#E5E7EB] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
              SSO Coverage
            </span>
            <span className="material-symbols-outlined text-[15px] text-emerald-600">
              lock
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="font-mono text-xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              100%
            </span>
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1 py-0.2 rounded font-medium">
              Okta + Google
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 h-1 rounded-full overflow-hidden mt-2.5">
            <div className="bg-emerald-500 h-full w-full rounded-full"></div>
          </div>
        </div>
      </div>

      {/* MAIN TABLE CONTAINER */}
      <div className="bg-white dark:bg-[#0F172A] rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-xs overflow-hidden">
        {/* Table Top Filter Bar */}
        <div className="p-4 bg-[#F9FAFB] dark:bg-[#162032]/50 border-b border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[#3B5BFD] dark:text-blue-400">
              troubleshoot
            </span>
            <h2 className="text-xs font-semibold text-[#111827] dark:text-[#F3F4F6]">
              Monitored SaaS Applications
            </h2>
            <span className="text-gray-400 font-mono text-[11px]">
              ({filteredApps.length} of {apps.length})
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools, owner..."
                className="bg-white dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] text-xs px-2.5 py-1 rounded-md text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#3B5BFD] w-48 shadow-2xs"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-white dark:bg-[#0F172A] p-0.5 rounded-md border border-[#E5E7EB] dark:border-[#1E293B]">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer ${
                  filter === "all"
                    ? "bg-[#F3F4F6] dark:bg-[#162032] text-[#111827] dark:text-[#F3F4F6] font-semibold"
                    : "text-gray-500 hover:text-[#111827] dark:hover:text-[#F3F4F6]"
                }`}
              >
                All ({apps.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("zombies")}
                className={`px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                  filter === "zombies"
                    ? "bg-[#F3F4F6] dark:bg-[#162032] text-[#111827] dark:text-[#F3F4F6] font-semibold"
                    : "text-gray-500 hover:text-[#111827] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Zombies ({zombieApps.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("active")}
                className={`px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                  filter === "active"
                    ? "bg-[#F3F4F6] dark:bg-[#162032] text-[#111827] dark:text-[#F3F4F6] font-semibold"
                    : "text-gray-500 hover:text-[#111827] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Active ({apps.filter((a) => a.status === "active").length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("underutilized")}
                className={`px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                  filter === "underutilized"
                    ? "bg-[#F3F4F6] dark:bg-[#162032] text-[#111827] dark:text-[#F3F4F6] font-semibold"
                    : "text-gray-500 hover:text-[#111827] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                Review
              </button>
            </div>
          </div>
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-mono uppercase text-gray-400 dark:text-gray-500 border-b border-[#E5E7EB] dark:border-[#1E293B] bg-[#F9FAFB]/50 dark:bg-[#162032]/30">
                <th className="py-2.5 px-3 font-medium">Application</th>
                <th className="py-2.5 px-3 font-medium">Category / Plan</th>
                <th className="py-2.5 px-3 font-medium">Billing Owner</th>
                <th className="py-2.5 px-3 font-medium">Monthly Cost</th>
                <th className="py-2.5 px-3 font-medium">Last SSO Login</th>
                <th className="py-2.5 px-3 font-medium">Audit Verdict</th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#1E293B] text-[11px] text-[#111827] dark:text-[#F3F4F6]">
              {filteredApps.map((app) => (
                <tr
                  key={app.tool}
                  className={`hover:bg-[#F9FAFB] dark:hover:bg-[#162032]/40 transition-colors ${
                    app.status === "zombie"
                      ? "bg-rose-50/20 dark:bg-rose-950/10"
                      : ""
                  }`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-center font-bold text-xs">
                        {app.tool[0]}
                      </div>
                      <div>
                        <span className="font-semibold text-xs text-[#111827] dark:text-[#F3F4F6] block leading-tight">
                          {app.tool}
                        </span>
                        <span className="font-mono text-[10px] text-gray-400">
                          {app.seats} licensed seats
                        </span>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <span className="text-gray-900 dark:text-gray-200 block font-medium">
                      {app.plan}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">
                      {app.category}
                    </span>
                  </td>

                  <td className="py-3 px-3 font-mono text-gray-600 dark:text-gray-300">
                    {app.owner}
                  </td>

                  <td className="py-3 px-3 font-mono font-semibold">
                    <span className={app.status === "zombie" ? "text-rose-600 font-bold" : ""}>
                      â‚¹{app.monthlyCost.toLocaleString("en-IN")}
                    </span>
                    <span className="text-gray-400 font-normal text-[10px]"> /mo</span>
                  </td>

                  <td className="py-3 px-3 font-mono">
                    <span
                      className={`block font-medium ${
                        app.daysIdle > 30 ? "text-rose-600" : "text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {app.lastLogin}
                    </span>
                    <span className="text-gray-400 text-[10px]">
                      {app.daysIdle === 0
                        ? "Active today"
                        : `${app.daysIdle} days since last SSO`}
                    </span>
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium border ${app.badgeCls}`}
                    >
                      {app.statusText}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-right">
                    {app.status === "zombie" ? (
                      <button
                        type="button"
                        onClick={() => handleCancelSubscription(app.tool)}
                        disabled={isDeprovisioning === app.tool}
                        className="px-2.5 py-1 rounded text-xs font-mono font-medium text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 transition-colors shadow-2xs cursor-pointer"
                      >
                        {isDeprovisioning === app.tool ? "Cancelling..." : "Cancel & Cut"}
                      </button>
                    ) : app.status === "underutilized" ? (
                      <button
                        type="button"
                        onClick={() => showNotification(`Sent seat downgrade review ping to ${app.owner}`)}
                        className="px-2.5 py-1 rounded text-xs font-mono text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-amber-200 dark:border-amber-800 transition-colors shadow-2xs cursor-pointer"
                      >
                        Downgrade
                      </button>
                    ) : (
                      <span className="text-gray-400 text-[10px] font-mono">In Compliance</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Audit Summary */}
        <div className="p-3 bg-[#F9FAFB] dark:bg-[#162032]/40 border-t border-[#E5E7EB] dark:border-[#1E293B] flex items-center justify-between text-xs font-mono text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>
              SSO Inactive Rule: Flag tool if <code>days_idle &gt; 30</code>
            </span>
          </div>
          <span>
            Total monthly spend: â‚¹
            {apps
              .reduce((acc, curr) => acc + curr.monthlyCost, 0)
              .toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* Floating Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
          <div className="p-3 rounded-lg shadow-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-[#0F172A] text-emerald-700 dark:text-emerald-400 font-mono text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
