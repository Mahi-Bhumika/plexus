"use client";

import { useState } from "react";

type RiskTier = "Low" | "Medium" | "High" | "Critical";

type PendingRequest = {
  id: string;
  requester: string;
  target: string;
  scopeDesc: string;
  risk: RiskTier;
  note: string;
  assignedTo: string;
  timeAgo: string;
};

type ActiveGrant = {
  id: string;
  principal: string;
  scope: string;
  risk: RiskTier;
  approver: string;
  started: string;
  ttl: string;
};

type AuditEntry = {
  id: string;
  principal: string;
  scope: string;
  risk: RiskTier | "Enforced";
  decision: string;
  timestamp: string;
  reverted?: boolean;
};

const INITIAL_PENDING: PendingRequest[] = [
  {
    id: "AC-802",
    requester: "Karan Malhotra",
    target: "AWS Production Servers",
    scopeDesc: "Target: Primary Server Cluster (Max 8 hours)",
    risk: "High",
    note: "Karan requested Server Access for the bank pilot. Because Karan is a manager, the system sent this to Riya (CEO) so he doesn't approve his own request.",
    assignedTo: "Riya Sharma (CEO Anti Self-Approval)",
    timeAgo: "Requested 11 mins ago",
  },
  {
    id: "AC-804",
    requester: "Meera Iyer",
    target: "Datadog Prod Metrics",
    scopeDesc: "Scope: monitors:read, logs:filter:prod-ledger",
    risk: "Medium",
    note: "Investigate 4xx spike on settlement webhook during Meridian 2PM settlement test.",
    assignedTo: "Karan Malhotra",
    timeAgo: "Requested 18 mins ago",
  },
];

const INITIAL_ACTIVE: ActiveGrant[] = [
  {
    id: "grant-1",
    principal: "Meera Iyer",
    scope: "AWS Staging",
    risk: "Low",
    approver: "Auto-approved",
    started: "2h ago",
    ttl: "5h 42m",
  },
  {
    id: "grant-2",
    principal: "Karan Malhotra",
    scope: "GitHub Repo Admin",
    risk: "Medium",
    approver: "Riya Sharma",
    started: "8h ago",
    ttl: "1d 4h",
  },
];

const INITIAL_AUDIT: AuditEntry[] = [
  {
    id: "audit-1",
    principal: "Meera Iyer",
    scope: "Figma Nimbus UX",
    risk: "Low",
    decision: "Auto-approved",
    timestamp: "13:45:12",
  },
  {
    id: "audit-2",
    principal: "Arjun Verma",
    scope: "AWS Production",
    risk: "High",
    decision: "Rejected (Policy: Ineligible)",
    timestamp: "13:12:08",
  },
  {
    id: "audit-3",
    principal: "Karan Malhotra",
    scope: "GitHub Admin",
    risk: "Medium",
    decision: "Approved by Riya",
    timestamp: "11:02:44",
  },
  {
    id: "audit-4",
    principal: "External Auditor",
    scope: "SOC2 Bucket",
    risk: "Low",
    decision: "Revoked (Expired)",
    timestamp: "09:30:19",
  },
];

export default function AccessPage() {
  const [requester, setRequester] = useState("Meera Iyer");
  const [targetApp, setTargetApp] = useState("AWS Production");
  const [justification, setJustification] = useState(
    "Hotfix UPI settlement queue latency for Meridian pilot",
  );

  const [pendingQueue, setPendingQueue] = useState<PendingRequest[]>(INITIAL_PENDING);
  const [activeGrants, setActiveGrants] = useState<ActiveGrant[]>(INITIAL_ACTIVE);
  const [auditList, setAuditList] = useState<AuditEntry[]>(INITIAL_AUDIT);

  // Policy Evaluation logic
  const isArjunBlocked = requester.includes("Arjun") && targetApp === "AWS Production";
  const isSelfApprovalRisk = requester.includes("Karan") && targetApp === "AWS Production";

  let riskTier: RiskTier = "Medium";
  let previewText = "";
  let outcomeText = "";
  let outcomeIcon = "rule";
  let outcomeColor = "text-amber-600";

  if (targetApp === "Figma") {
    riskTier = "Low";
    previewText =
      "Figma Team: Low Risk · Autonomous Self-Serve · Approver: Instant Auto-Grant · All active employees eligible.";
    outcomeText = "Predicted outcome: Instant Autonomous Grant (No human in loop)";
    outcomeIcon = "bolt";
    outcomeColor = "text-emerald-600";
  } else if (targetApp === "AWS Production") {
    riskTier = isArjunBlocked ? "High" : "High";
    previewText =
      "AWS Production: High Risk · Just-In-Time (Max 8h) · Approver: Karan Malhotra (or Riya if requester is Karan) · Interns ineligible.";
    if (isArjunBlocked) {
      outcomeText = "Predicted outcome: REJECTED (Interns prohibited from Prod environments)";
      outcomeIcon = "cancel";
      outcomeColor = "text-rose-600";
    } else if (isSelfApprovalRisk) {
      outcomeText = "Predicted outcome: Escalation to Riya Sharma (Anti Self-Approval #9)";
      outcomeIcon = "call_split";
      outcomeColor = "text-[#3B5BFD]";
    } else {
      outcomeText = "Predicted outcome: Routing to Karan Malhotra for synchronous signoff";
      outcomeIcon = "rule";
      outcomeColor = "text-amber-600";
    }
  } else if (targetApp === "GitHub") {
    riskTier = "Medium";
    previewText =
      "GitHub Repo Admin: Medium Risk · TTL: 24h · Approver: Riya Sharma · Eng Core members only.";
    outcomeText = "Predicted outcome: Routing to Riya Sharma for elevated repo privileges";
    outcomeIcon = "rule";
    outcomeColor = "text-[#3B5BFD]";
  } else if (targetApp === "Datadog") {
    riskTier = "Medium";
    previewText =
      "Datadog Prod: Medium Risk · TTL: 12h · Approver: Karan Malhotra · Eng Core & QA.";
    outcomeText = "Predicted outcome: Routing to Karan Malhotra for signoff";
    outcomeIcon = "rule";
    outcomeColor = "text-amber-600";
  } else if (targetApp === "Payroll Tool") {
    riskTier = "Critical";
    previewText =
      "Payroll Tool: Critical Risk · TTL: 2h · Dual Authorization required (Riya Sharma + Hardware 2FA key).";
    outcomeText = "Predicted outcome: Escalation to Riya Sharma + Dual Auth Challenge";
    outcomeIcon = "lock";
    outcomeColor = "text-rose-600";
  }

  const injectScenario = (scenarioKey: "A" | "B" | "C" | "D") => {
    if (scenarioKey === "A") {
      setRequester("Meera Iyer");
      setTargetApp("Figma");
      setJustification("Review design token exports and audit UI spec for Meridian Bank merchant flows");
    } else if (scenarioKey === "B") {
      setRequester("Meera Iyer");
      setTargetApp("AWS Production");
      setJustification("Inspect CloudWatch alarms and hotfix latency bottleneck in UPI settlement queue");
    } else if (scenarioKey === "C") {
      setRequester("Karan Malhotra");
      setTargetApp("AWS Production");
      setJustification("Reconfigure core VPC peering for India primary DC failover during pilot testing");
    } else if (scenarioKey === "D") {
      setRequester("Arjun Verma");
      setTargetApp("AWS Production");
      setJustification("Debugging prod database credentials to replicate staging parity issue");
    }
  };

  const handleSendRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (isArjunBlocked) return;

    const timeString = new Date().toTimeString().split(" ")[0];

    if (targetApp === "Figma") {
      const newGrant: ActiveGrant = {
        id: `grant-${Date.now()}`,
        principal: requester,
        scope: "Figma Team",
        risk: "Low",
        approver: "Auto-approved",
        started: "Just now",
        ttl: "90d",
      };
      const newAudit: AuditEntry = {
        id: `audit-${Date.now()}`,
        principal: requester,
        scope: "Figma Team",
        risk: "Low",
        decision: "Auto-approved",
        timestamp: timeString,
      };
      setActiveGrants((prev) => [newGrant, ...prev]);
      setAuditList((prev) => [newAudit, ...prev]);
    } else {
      const newId = `AC-${Math.floor(805 + Math.random() * 80)}`;
      const newPending: PendingRequest = {
        id: newId,
        requester,
        target: targetApp,
        scopeDesc: "Scope: Just-In-Time Escalation",
        risk: riskTier,
        note: justification,
        assignedTo: isSelfApprovalRisk || targetApp === "Payroll Tool" ? "Riya Sharma" : "Karan Malhotra",
        timeAgo: "Requested just now",
      };
      setPendingQueue((prev) => [newPending, ...prev]);
    }
  };

  const handleApprove = (req: PendingRequest) => {
    setPendingQueue((prev) => prev.filter((p) => p.id !== req.id));
    const timeString = new Date().toTimeString().split(" ")[0];
    const newGrant: ActiveGrant = {
      id: `grant-${Date.now()}`,
      principal: req.requester,
      scope: req.target,
      risk: req.risk,
      approver: "Riya Sharma",
      started: "Just now",
      ttl: "8h",
    };
    const newAudit: AuditEntry = {
      id: `audit-${Date.now()}`,
      principal: req.requester,
      scope: req.target,
      risk: req.risk,
      decision: "Approved by Riya Sharma",
      timestamp: timeString,
    };
    setActiveGrants((prev) => [newGrant, ...prev]);
    setAuditList((prev) => [newAudit, ...prev]);
  };

  const handleDeny = (req: PendingRequest) => {
    setPendingQueue((prev) => prev.filter((p) => p.id !== req.id));
    const timeString = new Date().toTimeString().split(" ")[0];
    const newAudit: AuditEntry = {
      id: `audit-${Date.now()}`,
      principal: req.requester,
      scope: req.target,
      risk: req.risk,
      decision: "Rejected by Approver",
      timestamp: timeString,
    };
    setAuditList((prev) => [newAudit, ...prev]);
  };

  const handleRevoke = (grantId: string) => {
    const grant = activeGrants.find((g) => g.id === grantId);
    if (!grant) return;
    setActiveGrants((prev) => prev.filter((g) => g.id !== grantId));
    const timeString = new Date().toTimeString().split(" ")[0];
    const newAudit: AuditEntry = {
      id: `audit-${Date.now()}`,
      principal: grant.principal,
      scope: grant.scope,
      risk: "Enforced",
      decision: "Revoked early by Admin",
      timestamp: timeString,
    };
    setAuditList((prev) => [newAudit, ...prev]);
  };

  const handleToggleRevertAudit = (auditId: string) => {
    setAuditList((prev) =>
      prev.map((a) => (a.id === auditId ? { ...a, reverted: true } : a)),
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-6">
      {/* TOP BANNER & OPERATIONAL SCENARIOS */}
      <section className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-col gap-5 relative overflow-hidden">
        <div className="absolute -top-24 right-1/4 w-80 h-32 bg-blue-100/60 blur-[60px] pointer-events-none rounded-full"></div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-mono">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B5BFD] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3B5BFD]"></span>
              </span>
              <span className="font-medium text-[#3B5BFD]">Access Control System</span>
              <span>/</span>
              <span>Automatic Safeguards</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-semibold tracking-tight text-[#111827]">
              Team Access &amp; Permissions
            </h1>
            <p className="text-xs text-gray-600 max-w-2xl leading-relaxed">
              Easily approve, review, and set time limits for team tools and server access.
            </p>
          </div>

          {/* Stats Metric Pill Group */}
          <div className="flex items-center gap-4 bg-[#F9FAFB] border border-[#E5E7EB] p-2.5 rounded-lg self-start lg:self-auto shadow-2xs">
            <div className="px-2 text-right">
              <span className="block text-[10px] font-mono uppercase text-gray-400 tracking-wider">
                Active Access
              </span>
              <span className="font-mono text-base font-semibold text-emerald-600">
                14 people
              </span>
            </div>
            <div className="w-px h-6 bg-[#E5E7EB]"></div>
            <div className="px-2 text-right">
              <span className="block text-[10px] font-mono uppercase text-gray-400 tracking-wider">
                Security Issues
              </span>
              <span className="font-mono text-base font-semibold text-[#3B5BFD]">
                0 issues
              </span>
            </div>
          </div>
        </div>

        {/* Quick Scenario Preset Bar */}
        <div className="flex flex-col gap-2 pt-2 border-t border-[#E5E7EB] z-10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 font-medium">
              Try Sample Requests:
            </span>
            <span className="text-[11px] font-mono text-gray-400">
              Click to test how approvals work
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => injectScenario("A")}
              className="group text-left p-3 rounded-lg bg-[#F9FAFB] hover:bg-neutral-100/80 border border-[#E5E7EB] hover:border-gray-300 transition-all flex flex-col justify-between shadow-2xs cursor-pointer"
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <span className="font-mono text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">bolt</span>Sample 1
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Instant
                </span>
              </div>
              <span className="text-xs text-gray-600 group-hover:text-[#111827] transition-colors leading-snug">
                Meera asks for Figma (Safe · Approved instantly)
              </span>
            </button>

            <button
              type="button"
              onClick={() => injectScenario("B")}
              className="group text-left p-3 rounded-lg bg-[#F9FAFB] hover:bg-neutral-100/80 border border-[#E5E7EB] hover:border-gray-300 transition-all flex flex-col justify-between shadow-2xs cursor-pointer"
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <span className="font-mono text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">verified_user</span>Sample 2
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  Needs Review
                </span>
              </div>
              <span className="text-xs text-gray-600 group-hover:text-[#111827] transition-colors leading-snug">
                Meera asks for Server Access (Needs manager approval)
              </span>
            </button>

            <button
              type="button"
              onClick={() => injectScenario("C")}
              className="group text-left p-3 rounded-lg bg-[#F9FAFB] hover:bg-neutral-100/80 border border-[#E5E7EB] hover:border-gray-300 transition-all flex flex-col justify-between shadow-2xs cursor-pointer"
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <span className="font-mono text-xs font-semibold text-[#3B5BFD] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">call_split</span>Sample 3
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-[#3B5BFD] border border-blue-200">
                  To CEO
                </span>
              </div>
              <span className="text-xs text-gray-600 group-hover:text-[#111827] transition-colors leading-snug">
                Karan asks for Server Access (Escalates to CEO because Karan cannot approve himself)
              </span>
            </button>

            <button
              type="button"
              onClick={() => injectScenario("D")}
              className="group text-left p-3 rounded-lg bg-[#F9FAFB] hover:bg-neutral-100/80 border border-[#E5E7EB] hover:border-gray-300 transition-all flex flex-col justify-between shadow-2xs cursor-pointer"
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <span className="font-mono text-xs font-semibold text-rose-600 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">block</span>Sample 4
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                  Blocked
                </span>
              </div>
              <span className="text-xs text-gray-600 group-hover:text-[#111827] transition-colors leading-snug">
                Arjun (Intern) asks for Production (Blocked by rule)
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* TWO-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: REQUEST SIMULATOR & POLICY MATRIX (5 COLS) */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          {/* New Request Interactive Console */}
          <div className="flex flex-col bg-white rounded-xl p-5 border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#3B5BFD]">tune</span>
                <h2 className="text-sm font-semibold text-[#111827] tracking-tight">
                  Request Tool Access
                </h2>
              </div>
              <span className="font-mono text-[11px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-[#E5E7EB] font-medium">
                Loop #JIT-90
              </span>
            </div>

            <form onSubmit={handleSendRequest} className="flex flex-col gap-3.5">
              {/* Requester Principal */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-medium">
                  Who needs access
                </label>
                <div className="relative">
                  <select
                    value={requester}
                    onChange={(e) => setRequester(e.target.value)}
                    className="w-full bg-[#F9FAFB] px-3 py-2 rounded-lg text-xs font-medium text-[#111827] border border-[#E5E7EB] hover:border-gray-400 focus:outline-none focus:border-[#3B5BFD] focus:bg-white transition-colors cursor-pointer appearance-none shadow-2xs"
                  >
                    <option value="Meera Iyer">Meera Iyer (Senior Backend Engineer · Team Nimbus)</option>
                    <option value="Karan Malhotra">Karan Malhotra (Staff Lead / Approver · Team Infra)</option>
                    <option value="Arjun Verma">Arjun Verma (Security Eng Intern · 90-Day Cohort)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-[16px] text-gray-400 pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* Target Application */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-medium">
                  Which tool or server
                </label>
                <div className="relative">
                  <select
                    value={targetApp}
                    onChange={(e) => setTargetApp(e.target.value)}
                    className="w-full bg-[#F9FAFB] px-3 py-2 rounded-lg text-xs font-medium text-[#111827] border border-[#E5E7EB] hover:border-gray-400 focus:outline-none focus:border-[#3B5BFD] focus:bg-white transition-colors cursor-pointer appearance-none shadow-2xs"
                  >
                    <option value="AWS Production">AWS Production Servers (us-east-1 VPC)</option>
                    <option value="Figma">Figma (Design Workspace)</option>
                    <option value="GitHub">GitHub (Code Repositories)</option>
                    <option value="Datadog">Datadog (Monitoring & Logs)</option>
                    <option value="Payroll Tool">Payroll Tool (Finance & Banking)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-[16px] text-gray-400 pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>

              {/* Justification */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-medium">
                    Why do you need it?
                  </label>
                  <span className="text-[10px] font-mono text-gray-400">A few words</span>
                </div>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  className="w-full bg-[#F9FAFB] px-3 py-2 rounded-lg text-xs text-[#111827] border border-[#E5E7EB] hover:border-gray-400 focus:outline-none focus:border-[#3B5BFD] focus:bg-white resize-none transition-colors shadow-2xs"
                  rows={2}
                />
              </div>

              {/* Policy Rule Preview */}
              <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider font-medium">
                    Rule check
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                      isArjunBlocked
                        ? "text-rose-700 bg-rose-50 border border-rose-200"
                        : riskTier === "Low"
                        ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
                        : "text-amber-700 bg-amber-50 border border-amber-200"
                    }`}
                  >
                    {isArjunBlocked ? "POLICY BLOCKED" : `${riskTier.toUpperCase()} RISK`}
                  </span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{previewText}</p>
              </div>

              {/* Auto Evaluation Outcome Pill */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB]">
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-[16px] ${outcomeColor}`}
                  >
                    {outcomeIcon}
                  </span>
                  <span className="font-mono text-xs text-[#111827]">{outcomeText}</span>
                </div>
                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider bg-white px-1.5 py-0.5 rounded border border-[#E5E7EB] font-medium">
                  Policy Checked
                </span>
              </div>

              {/* Action Dispatch Buttons */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => injectScenario("B")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-[#111827] hover:bg-neutral-100 transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  type="submit"
                  disabled={isArjunBlocked}
                  className={`px-4 py-2 rounded-lg text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 ${
                    isArjunBlocked
                      ? "bg-gray-300 opacity-60 cursor-not-allowed"
                      : "bg-[#3B5BFD] hover:bg-[#2549ED] cursor-pointer active:scale-[0.98]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  <span>Send Access Request</span>
                </button>
              </div>
            </form>
          </div>

          {/* Active Access Policy Table Matrix */}
          <div className="flex flex-col bg-white rounded-xl p-5 border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] gap-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">
                  policy
                </span>
                <h2 className="text-sm font-semibold text-[#111827] tracking-tight">
                  Active Access Policy Matrix
                </h2>
              </div>
              <span className="text-[10px] font-mono font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                6 Managed Tiers
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-mono uppercase text-gray-400 border-b border-[#E5E7EB]">
                    <th className="py-2 px-2 font-medium">Target App</th>
                    <th className="py-2 px-2 font-medium">Risk</th>
                    <th className="py-2 px-2 font-medium">Allowed Roles</th>
                    <th className="py-2 px-2 font-medium">Approver Rule</th>
                    <th className="py-2 px-2 font-medium text-right">TTL Max</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px] text-gray-600">
                  <tr className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-2 font-medium text-[#111827]">AWS Prod</td>
                    <td className="py-2.5 px-2">
                      <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        High
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-400">Eng Staff+</td>
                    <td className="py-2.5 px-2 text-[#111827] font-medium">Karan / Riya</td>
                    <td className="py-2.5 px-2 text-right text-gray-400">8h</td>
                  </tr>
                  <tr className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-2 font-medium text-[#111827]">GitHub Admin</td>
                    <td className="py-2.5 px-2">
                      <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        Medium
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-400">Eng Core</td>
                    <td className="py-2.5 px-2 text-[#111827] font-medium">Riya Sharma</td>
                    <td className="py-2.5 px-2 text-right text-gray-400">24h</td>
                  </tr>
                  <tr className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-2 font-medium text-[#111827]">Figma Team</td>
                    <td className="py-2.5 px-2">
                      <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        Low
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-400">All Employees</td>
                    <td className="py-2.5 px-2 text-emerald-700 font-medium">Auto-Grant</td>
                    <td className="py-2.5 px-2 text-right text-gray-400">90d</td>
                  </tr>
                  <tr className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-2 font-medium text-[#111827]">Datadog Prod</td>
                    <td className="py-2.5 px-2">
                      <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        Medium
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-400">Eng Core, QA</td>
                    <td className="py-2.5 px-2 text-[#111827] font-medium">Karan Malhotra</td>
                    <td className="py-2.5 px-2 text-right text-gray-400">12h</td>
                  </tr>
                  <tr className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-2.5 px-2 font-medium text-[#111827]">Payroll Tool</td>
                    <td className="py-2.5 px-2">
                      <span className="text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        Critical
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-400">Exec Ops</td>
                    <td className="py-2.5 px-2 text-rose-700 font-medium">Riya + 2FA</td>
                    <td className="py-2.5 px-2 text-right text-gray-400">2h</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: APPROVAL QUEUE, ACTIVE GRANTS & AUDIT (7 COLS) */}
        <div className="xl:col-span-7 flex flex-col gap-6">
          {/* PENDING APPROVALS QUEUE */}
          <div className="flex flex-col bg-white rounded-xl p-5 border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-amber-600">
                  pending_actions
                </span>
                <h2 className="text-sm font-semibold text-[#111827] tracking-tight">
                  Waiting for Approval ({pendingQueue.length} requests)
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                {pendingQueue.length} Awaiting Action
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {pendingQueue.length === 0 ? (
                <div className="p-4 text-center text-xs font-mono text-gray-400">
                  All requests processed! Zero items awaiting sign-off.
                </div>
              ) : (
                pendingQueue.map((req) => (
                  <div
                    key={req.id}
                    className="p-4 rounded-lg bg-[#F9FAFB] hover:bg-neutral-100/60 border border-[#E5E7EB] transition-all flex flex-col gap-2.5 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-[#3B5BFD] border border-blue-200 font-semibold">
                          #{req.id}
                        </span>
                        <div>
                          <h3 className="text-xs font-semibold text-[#111827]">
                            {req.requester}{" "}
                            <span className="text-gray-400 font-normal">requesting</span>{" "}
                            {req.target}
                          </h3>
                          <p className="text-[11px] font-mono text-gray-400">{req.scopeDesc}</p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-medium ${
                          req.risk === "Critical"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {req.risk.toUpperCase()} RISK
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-white border border-[#E5E7EB] text-xs text-gray-600 leading-relaxed">
                      <span className="text-gray-400 font-mono text-[10px] uppercase mr-1">
                        Note:
                      </span>
                      {req.note}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[#E5E7EB]">
                      <span className="text-[11px] font-mono text-gray-400">{req.timeAgo}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeny(req)}
                          className="px-2.5 py-1 rounded text-xs font-medium text-rose-700 hover:bg-rose-50 border border-rose-200 transition-colors cursor-pointer"
                        >
                          Deny
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(req)}
                          className="px-3 py-1 rounded text-xs text-white font-medium bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all cursor-pointer"
                        >
                          Approve Access
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ACTIVE JUST-IN-TIME GRANTS */}
          <div className="flex flex-col bg-white rounded-xl p-5 border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] gap-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">
                  verified
                </span>
                <h2 className="text-sm font-semibold text-[#111827] tracking-tight">
                  Currently Active Access ({activeGrants.length} team members)
                </h2>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-semibold flex items-center gap-1.5 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                {activeGrants.length} Active Leases
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-mono uppercase text-gray-400 border-b border-[#E5E7EB]">
                    <th className="py-2 px-2 font-medium">Principal</th>
                    <th className="py-2 px-2 font-medium">Target Scope</th>
                    <th className="py-2 px-2 font-medium">Risk</th>
                    <th className="py-2 px-2 font-medium">Approved By</th>
                    <th className="py-2 px-2 font-medium">Started</th>
                    <th className="py-2 px-2 font-medium">TTL Remaining</th>
                    <th className="py-2 px-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px] text-[#111827]">
                  {activeGrants.map((grant) => (
                    <tr key={grant.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="py-2.5 px-2 font-medium text-[#111827] font-sans">
                        {grant.principal}
                      </td>
                      <td className="py-2.5 px-2 text-gray-600">{grant.scope}</td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            grant.risk === "High"
                              ? "text-amber-700 bg-amber-50 border-amber-200"
                              : grant.risk === "Critical"
                              ? "text-rose-700 bg-rose-50 border-rose-200"
                              : "text-emerald-700 bg-emerald-50 border-emerald-200"
                          }`}
                        >
                          {grant.risk}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-gray-500">{grant.approver}</td>
                      <td className="py-2.5 px-2 text-gray-400">{grant.started}</td>
                      <td className="py-2.5 px-2 text-emerald-700 font-semibold">{grant.ttl}</td>
                      <td className="py-2.5 px-2 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => handleRevoke(grant.id)}
                          className="px-2 py-0.5 rounded text-[10px] font-mono text-rose-700 hover:bg-rose-50 border border-rose-200 uppercase transition-colors cursor-pointer"
                        >
                          Remove Access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* DECISION HISTORY & AUDIT LOG TABLE */}
          <div className="flex flex-col bg-white rounded-xl p-5 border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.05)] gap-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#3B5BFD]">
                  history_edu
                </span>
                <h2 className="text-sm font-semibold text-[#111827] tracking-tight">
                  Recent Access History
                </h2>
              </div>
              <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-[#E5E7EB] uppercase font-medium">
                Immutable Chain
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-mono uppercase text-gray-400 border-b border-[#E5E7EB]">
                    <th className="py-2 px-2 font-medium">Principal</th>
                    <th className="py-2 px-2 font-medium">Target Scope</th>
                    <th className="py-2 px-2 font-medium">Risk</th>
                    <th className="py-2 px-2 font-medium">Decision Vector</th>
                    <th className="py-2 px-2 font-medium">Timestamp</th>
                    <th className="py-2 px-2 font-medium text-right">Revert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px] text-gray-600">
                  {auditList.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`hover:bg-[#F9FAFB] transition-colors ${
                        entry.reverted ? "opacity-40 line-through" : ""
                      }`}
                    >
                      <td className="py-2.5 px-2 font-medium text-[#111827] font-sans">
                        {entry.principal}
                      </td>
                      <td className="py-2.5 px-2">{entry.scope}</td>
                      <td className="py-2.5 px-2">
                        <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[10px] font-medium">
                          {entry.risk}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-emerald-700 flex items-center gap-1.5 font-sans font-medium">
                        <span className="material-symbols-outlined text-[13px]">
                          verified
                        </span>
                        {entry.decision}
                      </td>
                      <td className="py-2.5 px-2 text-gray-400">{entry.timestamp}</td>
                      <td className="py-2.5 px-2 text-right font-sans">
                        {entry.reverted ? (
                          <span className="text-rose-600 text-[11px]">Reverted</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleRevertAudit(entry.id)}
                            className="px-2 py-0.5 rounded text-gray-500 hover:text-[#111827] hover:bg-neutral-100 border border-transparent hover:border-[#E5E7EB] transition-colors cursor-pointer"
                          >
                            Revert
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
