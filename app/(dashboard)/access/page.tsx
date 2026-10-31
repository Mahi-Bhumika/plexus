"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Undo2,
  Sparkles,
  Send,
  AlertTriangle,
  Zap,
  FileCheck2,
  KeyRound,
  Timer,
  User,
} from "lucide-react";

export type Requester = {
  id: string;
  name: string;
  role: string;
  handle: string;
  manager: string;
};

export const REQUESTERS: Requester[] = [
  { id: "meera", name: "Meera Iyer", role: "Software Engineer", handle: "@meera", manager: "Karan Malhotra" },
  { id: "arjun", name: "Arjun Verma", role: "Engineering Intern", handle: "@arjun", manager: "Karan Malhotra" },
  { id: "karan", name: "Karan Malhotra", role: "Engineering Manager", handle: "@karan", manager: "Riya Sharma" },
  { id: "riya", name: "Riya Sharma", role: "Founder", handle: "@riya", manager: "None" },
];

export type PolicyRule = {
  app: string;
  risk: "Low" | "Medium" | "High";
  rolesAllowed: string;
  approver: string;
  notes: string;
};

export const ACCESS_POLICIES: PolicyRule[] = [
  { app: "Figma", risk: "Low", rolesAllowed: "Founder, Eng Manager, Engineer, Intern", approver: "Auto-approved", notes: "Default design access" },
  { app: "Slack", risk: "Low", rolesAllowed: "All Roles", approver: "Auto-approved", notes: "Default workspace" },
  { app: "Google Workspace", risk: "Low", rolesAllowed: "All Roles", approver: "Auto-approved", notes: "Email & Docs" },
  { app: "GitHub", risk: "Medium", rolesAllowed: "Founder, Eng Manager, Engineer, Intern", approver: "Requester's Manager", notes: "Interns read-only" },
  { app: "Datadog", risk: "Medium", rolesAllowed: "Founder, Eng Manager, Engineer", approver: "Requester's Manager", notes: "Observability metrics" },
  { app: "AWS Production", risk: "High", rolesAllowed: "Founder, Eng Manager, Engineer", approver: "Karan Malhotra (A request from Karan goes to Riya Sharma)", notes: "Just-in-time, max 8 hours. Interns ineligible." },
  { app: "Payroll Tool", risk: "High", rolesAllowed: "Founder", approver: "Riya Sharma", notes: "Founder only (Ineligible for Eng Manager & Engineers)" },
];

export type ActiveGrant = {
  id: string;
  requesterName: string;
  app: string;
  risk: "Low" | "Medium" | "High";
  approver: string;
  grantedAt: number;
  maxDurationHours: number;
};

export type AccessAuditRow = {
  id: string;
  timestamp: string;
  requesterName: string;
  app: string;
  risk: "Low" | "Medium" | "High";
  decision: "granted" | "denied" | "pending_approval" | "undone";
  approver: string;
  justification?: string;
  canUndo?: boolean;
};

// Built on the client after mount so Date.now() is never read during prerender.
function makeInitialGrants(base: number): ActiveGrant[] {
  return [
    {
      id: "grant_1",
      requesterName: "Meera Iyer",
      app: "Figma",
      risk: "Low",
      approver: "Auto-approved (Policy)",
      grantedAt: base - 36 * 60 * 1000,
      maxDurationHours: 24,
    },
    {
      id: "grant_2",
      requesterName: "Karan Malhotra",
      app: "AWS Production",
      risk: "High",
      approver: "Riya Sharma (Founder)",
      grantedAt: base - 14 * 60 * 1000,
      maxDurationHours: 8,
    },
  ];
}

// Backend stores approver_id (e.g. "karan"); show the person's name instead.
function approverLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const person = REQUESTERS.find((p) => p.id === raw.toLowerCase());
  if (!person) return raw;
  if (person.role === "Founder") return `${person.name} (Founder)`;
  if (person.role === "Engineering Manager") return `${person.name} (Eng Manager)`;
  return person.name;
}

// Find the person behind a display name like "Karan Malhotra (Eng Manager)".
function personForName(display: string): Requester | undefined {
  return REQUESTERS.find((p) => display.startsWith(p.name));
}

const INITIAL_MOCK_AUDIT: AccessAuditRow[] = [
  {
    id: "req_1",
    timestamp: "2026-10-31T14:10:00Z",
    requesterName: "Meera Iyer",
    app: "Figma",
    risk: "Low",
    decision: "granted",
    approver: "Auto-approved (Policy)",
    justification: "Need Figma editor seat for payments redesign.",
    canUndo: true,
  },
  {
    id: "req_2",
    timestamp: "2026-10-31T14:15:00Z",
    requesterName: "Meera Iyer",
    app: "AWS Production",
    risk: "High",
    decision: "pending_approval",
    approver: "Karan Malhotra",
    justification: "Need access to debug production webhook retry lag.",
    canUndo: false,
  },
];

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "--:--";
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return "--:--";
  }
}

export default function AccessPage() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);

  // Request Form State
  const [selectedRequesterId, setSelectedRequesterId] = useState("meera");
  const [selectedApp, setSelectedApp] = useState("Figma");
  const [justification, setJustification] = useState("Need access for upcoming sprint tasks.");

  // Access Requests, Active Grants & Audit Log State
  const [activeGrants, setActiveGrants] = useState<ActiveGrant[]>([]);
  const [auditRows, setAuditRows] = useState<AccessAuditRow[]>(INITIAL_MOCK_AUDIT);
  const [actionSuccessBanner, setActionSuccessBanner] = useState<string | null>(null);

  const selectedRequester = REQUESTERS.find((r) => r.id === selectedRequesterId) ?? REQUESTERS[0];
  const pendingRequests = auditRows.filter((row) => row.decision === "pending_approval");

  useEffect(() => {
    // Client-only: real time, seed grants and the countdown tick all start after mount.
    const start = Date.now();
    setMounted(true);
    setNow(start);
    setActiveGrants((prev) => (prev.length > 0 ? prev : makeInitialGrants(start)));
    const timer = setInterval(() => setNow(Date.now()), 1000);

    // Initial fetch from real /api/access backend
    fetch("/api/access")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          requests: Array<{
            id: string;
            user_id: string;
            app: string;
            risk: "Low" | "Medium" | "High";
            status: "granted" | "denied" | "pending_approval" | "undone";
            approver_id: string;
            requested_at: string;
            decided_at: string | null;
            user_name: string | null;
            user_role: string | null;
          }>;
        }>;
      })
      .then((data) => {
        if (data.requests && data.requests.length > 0) {
          // Safety net: a row where the approver is the requester is stale/corrupt.
          // Show it as denied by the guard and never turn it into a grant.
          const isSelfApproved = (r: { user_id: string; approver_id: string }) =>
            !!r.approver_id && r.user_id.toLowerCase() === r.approver_id.toLowerCase();

          const backendRows: AccessAuditRow[] = data.requests.map((r) => {
            const selfApproved = isSelfApproved(r);
            return {
              id: r.id,
              timestamp: r.requested_at,
              requesterName: r.user_name || r.user_id,
              app: r.app,
              risk: r.risk,
              decision: selfApproved ? ("denied" as const) : r.status,
              approver: selfApproved
                ? "Policy Guard (self-approval blocked)"
                : approverLabel(r.approver_id),
              canUndo: !selfApproved && r.status === "granted",
            };
          });
          setAuditRows(backendRows);

          // Build active grants from granted requests
          const backendGrants: ActiveGrant[] = data.requests
            .filter((r) => r.status === "granted" && !isSelfApproved(r))
            .map((r) => ({
              id: `grant_${r.id}`,
              requesterName: r.user_name || r.user_id,
              app: r.app,
              risk: r.risk,
              approver: approverLabel(r.approver_id),
              grantedAt: new Date(r.decided_at || r.requested_at).getTime(),
              maxDurationHours: r.risk === "High" ? 8 : 24,
            }));
          if (backendGrants.length > 0) {
            setActiveGrants(backendGrants);
          }
        }
      })
      .catch((err) => {
        // Fallback to local initial state if backend DB has no rows yet
        console.log("Using initial access audit state", err);
      });

    return () => clearInterval(timer);
  }, []);

  function triggerNotice(msg: string) {
    setActionSuccessBanner(msg);
    setTimeout(() => setActionSuccessBanner(null), 4000);
  }

  function getRemainingTime(grant: ActiveGrant): string {
    const totalMs = grant.maxDurationHours * 60 * 60 * 1000;
    const elapsedMs = now - grant.grantedAt;
    const remainingMs = Math.max(0, totalMs - elapsedMs);

    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

    if (grant.risk === "High") {
      return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
    }
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  function resolveApprover(requester: Requester, policy: PolicyRule): { approver: string; eligible: boolean; reason?: string } {
    if (policy.app === "Payroll Tool" && requester.role !== "Founder") {
      return { approver: "Riya Sharma", eligible: false, reason: "Payroll Tool is Founder-only (Riya Sharma)." };
    }
    if (requester.role.includes("Intern") && policy.app.includes("AWS")) {
      return { approver: "Policy Rule", eligible: false, reason: "Interns are not eligible for Production access." };
    }

    if (requester.id === "karan") {
      return { approver: "Riya Sharma (Founder)", eligible: true };
    }

    if (requester.id === "riya") {
      return { approver: "Self (Founder)", eligible: true };
    }

    if (policy.risk === "High") {
      return { approver: "Karan Malhotra (Eng Manager)", eligible: true };
    }
    if (policy.risk === "Medium") {
      return { approver: requester.manager || "Karan Malhotra", eligible: true };
    }

    return { approver: "Auto-approved (Policy)", eligible: true };
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    const policy = ACCESS_POLICIES.find((p) => p.app.toLowerCase() === selectedApp.toLowerCase()) || {
      app: selectedApp,
      risk: "Medium" as const,
      rolesAllowed: "Engineer",
      approver: selectedRequester.manager,
      notes: "Custom request",
    };

    const resolution = resolveApprover(selectedRequester, policy);
    const newId = `req_${Date.now()}`;
    const newTimestamp = new Date().toISOString();

    if (!resolution.eligible) {
      const row: AccessAuditRow = {
        id: newId,
        timestamp: newTimestamp,
        requesterName: selectedRequester.name,
        app: policy.app,
        risk: policy.risk,
        decision: "denied",
        approver: `Policy Guard (${resolution.reason})`,
        justification,
        canUndo: false,
      };
      setAuditRows([row, ...auditRows]);
      triggerNotice(`Denied: ${resolution.reason}`);
      return;
    }

    // Call backend API /api/access
    try {
      await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedRequester.id,
          userName: selectedRequester.name,
          app: policy.app,
          risk: policy.risk,
          justification,
          approverId: resolution.approver,
        }),
      });
    } catch (err) {
      console.warn("Backend /api/access sync error:", err);
    }

    if (policy.risk === "High" || policy.risk === "Medium") {
      const row: AccessAuditRow = {
        id: newId,
        timestamp: newTimestamp,
        requesterName: selectedRequester.name,
        app: policy.app,
        risk: policy.risk,
        decision: "pending_approval",
        approver: resolution.approver,
        justification,
        canUndo: false,
      };
      setAuditRows([row, ...auditRows]);
      triggerNotice(`Gated: ${policy.app} request submitted. Awaiting approval from ${resolution.approver}.`);
    } else {
      const row: AccessAuditRow = {
        id: newId,
        timestamp: newTimestamp,
        requesterName: selectedRequester.name,
        app: policy.app,
        risk: policy.risk,
        decision: "granted",
        approver: "Auto-approved (Policy)",
        justification,
        canUndo: true,
      };
      setAuditRows([row, ...auditRows]);

      const grant: ActiveGrant = {
        id: `grant_${Date.now()}`,
        requesterName: selectedRequester.name,
        app: policy.app,
        risk: policy.risk,
        approver: "Auto-approved (Policy)",
        grantedAt: Date.now(),
        maxDurationHours: 24,
      };
      setActiveGrants([grant, ...activeGrants]);

      triggerNotice(`Granted: Low-risk access to ${policy.app} auto-approved instantly.`);
    }
  }

  // Fast Demo Scenarios (also calls backend API)
  async function simulateMeeraFigma() {
    setSelectedRequesterId("meera");
    setSelectedApp("Figma");
    setJustification("Need editor access for payment review.");

    try {
      await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "meera",
          userName: "Meera Iyer",
          app: "Figma",
          risk: "Low",
          justification: "Need editor access for payment review.",
          approverId: "Auto-approved (Policy)",
        }),
      });
    } catch (err) {
      console.warn("/api/access error", err);
    }

    const row: AccessAuditRow = {
      id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requesterName: "Meera Iyer",
      app: "Figma",
      risk: "Low",
      decision: "granted",
      approver: "Auto-approved (Policy)",
      justification: "Need editor access for payment review.",
      canUndo: true,
    };
    setAuditRows((prev) => [row, ...prev]);

    const grant: ActiveGrant = {
      id: `grant_${Date.now()}`,
      requesterName: "Meera Iyer",
      app: "Figma",
      risk: "Low",
      approver: "Auto-approved (Policy)",
      grantedAt: Date.now(),
      maxDurationHours: 24,
    };
    setActiveGrants((prev) => [grant, ...prev]);

    triggerNotice("Simulation: Meera requested Figma → Auto-granted instantly!");
  }

  async function simulateMeeraAwsProd() {
    setSelectedRequesterId("meera");
    setSelectedApp("AWS Production");
    setJustification("Urgent JIT access to inspect payment gateway webhook error.");

    try {
      await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "meera",
          userName: "Meera Iyer",
          app: "AWS Production",
          risk: "High",
          justification: "Urgent JIT access to inspect payment gateway webhook error.",
          approverId: "Karan Malhotra (Eng Manager)",
        }),
      });
    } catch (err) {
      console.warn("/api/access error", err);
    }

    const row: AccessAuditRow = {
      id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requesterName: "Meera Iyer",
      app: "AWS Production",
      risk: "High",
      decision: "pending_approval",
      approver: "Karan Malhotra (Eng Manager)",
      justification: "Urgent JIT access to inspect payment gateway webhook error.",
      canUndo: false,
    };
    setAuditRows((prev) => [row, ...prev]);
    triggerNotice("Simulation: Meera requested AWS Prod → Gated, awaiting Karan's approval!");
  }

  async function simulateKaranAwsProd() {
    setSelectedRequesterId("karan");
    setSelectedApp("AWS Production");
    setJustification("Scheduled database maintenance on Meridian prod cluster.");

    try {
      await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "karan",
          userName: "Karan Malhotra",
          app: "AWS Production",
          risk: "High",
          justification: "Scheduled database maintenance on Meridian prod cluster.",
          approverId: "Riya Sharma (Founder)",
        }),
      });
    } catch (err) {
      console.warn("/api/access error", err);
    }

    const row: AccessAuditRow = {
      id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requesterName: "Karan Malhotra",
      app: "AWS Production",
      risk: "High",
      decision: "pending_approval",
      approver: "Riya Sharma (Founder)",
      justification: "Scheduled database maintenance on Meridian prod cluster.",
      canUndo: false,
    };
    setAuditRows((prev) => [row, ...prev]);
    triggerNotice("Simulation: Karan requested AWS Prod → Escalated to Riya Sharma (Founder) to prevent self-approval!");
  }

  async function handleApprovalDecision(id: string, decision: "granted" | "denied", approverName: string) {
    const targetReq = auditRows.find((r) => r.id === id);

    // Segregation of duties: nobody can approve their own request.
    const requesterPerson = targetReq ? personForName(targetReq.requesterName) : undefined;
    const approverPerson = personForName(approverName);
    if (decision === "granted" && requesterPerson && approverPerson && requesterPerson.id === approverPerson.id) {
      triggerNotice(`Blocked: ${requesterPerson.name} cannot approve their own request.`);
      return;
    }

    // Call backend API /api/access/decide
    try {
      await fetch("/api/access/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          decision,
          approverName,
        }),
      });
    } catch (err) {
      console.warn("Backend /api/access/decide error:", err);
    }

    setAuditRows((prev) =>
      prev.map((row) => {
        if (row.id === id) {
          return {
            ...row,
            decision,
            approver: `${approverName} (${decision === "denied" ? "Denied" : "Approved"} by Guard)`,
            canUndo: decision === "granted",
          };
        }
        return row;
      }),
    );

    if (decision === "granted" && targetReq) {
      const grant: ActiveGrant = {
        id: `grant_${Date.now()}`,
        requesterName: targetReq.requesterName,
        app: targetReq.app,
        risk: targetReq.risk,
        approver: approverName,
        grantedAt: Date.now(),
        maxDurationHours: targetReq.risk === "High" ? 8 : 24,
      };
      setActiveGrants((prev) => [grant, ...prev]);
    }

    triggerNotice(
      decision === "granted"
        ? `Access Granted: ${approverName} approved the high-risk JIT access (8-hour window).`
        : `Access Denied: ${approverName} rejected the request.`,
    );
  }

  async function handleRevokeGrant(grantId: string) {
    const grant = activeGrants.find((g) => g.id === grantId);
    if (!grant) return;

    setActiveGrants((prev) => prev.filter((g) => g.id !== grantId));

    try {
      await fetch("/api/access/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: grant.id.replace("grant_", ""),
          reason: "Active grant revoked early via dashboard Undo",
        }),
      });
    } catch (err) {
      console.warn("Backend /api/access/revoke error:", err);
    }

    const auditRow: AccessAuditRow = {
      id: `rev_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requesterName: grant.requesterName,
      app: grant.app,
      risk: grant.risk,
      decision: "undone",
      approver: "Security Admin (Manual Revoke)",
      justification: "Active grant revoked early via dashboard Undo.",
      canUndo: false,
    };
    setAuditRows((prev) => [auditRow, ...prev]);

    triggerNotice(`Revocation Complete: ${grant.app} grant for ${grant.requesterName} was revoked and logged.`);
  }

  async function handleUndo(id: string) {
    const row = auditRows.find((r) => r.id === id);
    if (row) {
      setActiveGrants((prev) => prev.filter((g) => !(g.requesterName === row.requesterName && g.app === row.app)));
    }

    try {
      await fetch("/api/access/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reason: "Manual Undo from Decision Audit table" }),
      });
    } catch (err) {
      console.warn("Backend /api/access/revoke error:", err);
    }

    setAuditRows((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          return {
            ...r,
            decision: "undone",
            canUndo: false,
          };
        }
        return r;
      }),
    );
    triggerNotice("Revocation Complete: Access grant was rolled back via Undo.");
  }

  return (
    <div className="p-8 max-w-6xl space-y-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-white">Access Agent</h2>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
              JIT Guard & Auto-Grant
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Policy-enforced tool and infrastructure access. Auto-approves low risk (Figma), gates high risk (AWS prod) with human approvals, and prevents self-approval.
          </p>
        </div>
      </div>

      {/* Notice Banner */}
      {actionSuccessBanner && (
        <div className="p-3.5 rounded-xl bg-indigo-950/70 border border-indigo-500/40 text-indigo-200 text-xs flex items-center justify-between shadow-lg shadow-indigo-950/30 animate-in fade-in">
          <div className="flex items-center gap-2 font-medium">
            <Zap className="w-4 h-4 text-indigo-400" />
            <span>{actionSuccessBanner}</span>
          </div>
        </div>
      )}

      {/* Top Section: Request Box & Demo Fast Triggers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request Box Form */}
        <div className="lg:col-span-2 rounded-2xl bg-[#0e1726] border border-indigo-950/70 p-5 shadow-lg shadow-indigo-950/20 space-y-4">
          <div className="flex items-center justify-between border-b border-indigo-900/30 pb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Send className="w-3.5 h-3.5" />
              </span>
              New Access Request
            </h3>
            {/* Requester Role Badge Chip */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Current Role:</span>
              <span className="text-xs text-indigo-300 font-semibold bg-indigo-950/80 px-2.5 py-0.5 rounded-full border border-indigo-700/50">
                {selectedRequester.role}
              </span>
            </div>
          </div>

          <form onSubmit={handleRequestSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Requester
                </label>
                <div className="relative">
                  <select
                    value={selectedRequesterId}
                    onChange={(e) => setSelectedRequesterId(e.target.value)}
                    className="w-full bg-[#0a101d] border border-indigo-900/40 hover:border-indigo-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    {REQUESTERS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Target Application / Resource
                </label>
                <select
                  value={selectedApp}
                  onChange={(e) => setSelectedApp(e.target.value)}
                  className="w-full bg-[#0a101d] border border-indigo-900/40 hover:border-indigo-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {ACCESS_POLICIES.map((p) => (
                    <option key={p.app} value={p.app}>
                      {p.app} ({p.risk} Risk)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Justification
              </label>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={2}
                placeholder="Reason for requesting access…"
                className="w-full bg-[#0a101d] border border-indigo-900/40 hover:border-indigo-700/60 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none transition-colors"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                Segregation of Duties: Approver cannot equal Requester
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#4F46E5] hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-600/30"
              >
                Submit Request
              </button>
            </div>
          </form>
        </div>

        {/* Demo Fast Scenarios */}
        <div className="rounded-2xl bg-[#131126] border border-purple-900/40 p-5 shadow-lg shadow-purple-950/20 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Zap className="w-3.5 h-3.5" />
              </span>
              <h3 className="text-sm font-semibold text-white">
                Demo Fast Scenarios
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Click to simulate policy evaluation & anti-self-approval rules:
            </p>

            <div className="space-y-2">
              <button
                onClick={simulateMeeraFigma}
                className="w-full text-left p-2.5 rounded-xl bg-[#0c0a1a] hover:bg-[#161230] border border-emerald-900/30 hover:border-emerald-600/50 transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-emerald-300">
                    1. Meera asks for Figma
                  </span>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-700/60">
                    Instant Auto
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Low-risk role match → Auto-approved instantly.
                </div>
              </button>

              <button
                onClick={simulateMeeraAwsProd}
                className="w-full text-left p-2.5 rounded-xl bg-[#0c0a1a] hover:bg-[#161230] border border-amber-900/30 hover:border-amber-600/50 transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-amber-300">
                    2. Meera asks for AWS Prod
                  </span>
                  <span className="text-[10px] uppercase font-bold text-amber-400 px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-700/60">
                    Karan Gated
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  High-risk infra → Requires Karan Malhotra's sign-off.
                </div>
              </button>

              <button
                onClick={simulateKaranAwsProd}
                className="w-full text-left p-2.5 rounded-xl bg-[#0c0a1a] hover:bg-[#161230] border border-indigo-900/40 hover:border-indigo-600/50 transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-indigo-300">
                    3. Karan asks for AWS Prod
                  </span>
                  <span className="text-[10px] uppercase font-bold text-indigo-400 px-2 py-0.5 rounded-full bg-indigo-950/70 border border-indigo-700/60">
                    Riya Gated
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Cannot self-approve → Escalated to Riya Sharma (Founder).
                </div>
              </button>
            </div>
          </div>

          <div className="text-[10px] text-purple-300/60 pt-2.5 border-t border-purple-900/30 mt-2 font-mono">
            Policy doc 04: Karan requests escalate to Founder
          </div>
        </div>
      </div>

      {/* Active Grants Card */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <KeyRound className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-white">Active Leases & Grants</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono bg-slate-900 px-2.5 py-0.5 rounded-md border border-slate-800">
            {activeGrants.length} active sessions
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-emerald-950/60 bg-[#07130f] shadow-lg shadow-emerald-950/20">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-emerald-900/30 bg-[#050e0b] text-emerald-300/80 font-semibold">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">App / Resource</th>
                <th className="text-left px-4 py-3 w-24">Risk</th>
                <th className="text-left px-4 py-3">Granted Time</th>
                <th className="text-left px-4 py-3">Expires In</th>
                <th className="text-left px-4 py-3">Approver</th>
                <th className="text-right px-4 py-3 w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-950/40">
              {activeGrants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-slate-500 text-xs italic">
                    No active grants at this time.
                  </td>
                </tr>
              ) : (
                activeGrants.map((grant) => {
                  const isHigh = grant.risk === "High";
                  const grantedTimeStr = mounted ? formatTime(new Date(grant.grantedAt).toISOString()) : "--:--";
                  const remainingStr = mounted && now > 0 ? getRemainingTime(grant) : "--:--";

                  return (
                    <tr key={grant.id} className="hover:bg-emerald-950/20 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-slate-100 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-emerald-400" />
                        {grant.requesterName}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-200">{grant.app}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            grant.risk === "Low"
                              ? "bg-emerald-950/80 text-[#16A34A] border border-emerald-700/60"
                              : grant.risk === "Medium"
                              ? "bg-amber-950/80 text-[#F59E0B] border border-amber-700/60"
                              : "bg-rose-950/80 text-[#DC2626] border border-rose-700/60"
                          }`}
                        >
                          {grant.risk}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">{grantedTimeStr}</td>
                      <td className="px-4 py-2.5 font-mono">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            isHigh
                              ? "bg-rose-950/70 text-rose-300 border border-rose-800/60 animate-pulse"
                              : "bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                          }`}
                        >
                          <Timer className="w-3 h-3" />
                          {remainingStr}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-[11px]">{grant.approver}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleRevokeGrant(grant.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-300 text-[10px] font-semibold transition-colors shadow-sm"
                          title="Revoke access immediately"
                        >
                          <Undo2 className="w-3 h-3" />
                          Undo / Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Middle Section: Pending Approval Cards */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-white">
              Pending Approvals Queue
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-400 border border-amber-700/60 font-mono font-medium">
              {pendingRequests.length} action needed
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="p-5 rounded-2xl bg-[#1a1409] border border-amber-700/40 shadow-lg shadow-amber-950/20 space-y-3.5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{req.app}</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-950/80 text-rose-400 border border-rose-700/60">
                        {req.risk} Risk
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Requested by <strong className="text-slate-200">{req.requesterName}</strong>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-medium text-amber-400 flex items-center justify-end gap-1">
                      <Clock className="w-3 h-3" />
                      Pending Approval
                    </span>
                    <span className="text-[10px] text-amber-200/80 font-mono">
                      Assigned Approver: <strong className="text-white">{req.approver}</strong>
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-200 bg-[#0f0c05] p-3 rounded-xl border border-amber-900/30">
                  <span className="text-amber-400/80 font-medium">Justification: </span>
                  {req.justification || "Production investigation required."}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleApprovalDecision(req.id, "granted", req.approver)}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#16A34A] hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-900/30"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve as {req.approver.split(" ")[0]} (8h JIT)
                  </button>
                  <button
                    onClick={() => handleApprovalDecision(req.id, "denied", req.approver)}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-rose-950/70 hover:text-rose-300 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-800 hover:border-rose-800 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Deny Request
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Policy Rules Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-white">Access Policy Table (Nimbus Labs)</h3>
          </div>
          <span className="text-xs text-teal-400/70 font-mono">Seed Document 04 Reference</span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-teal-950/80 bg-[#0b1319] shadow-lg shadow-teal-950/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-teal-900/40 bg-[#081014] text-teal-300/80 font-semibold">
                <th className="text-left px-4 py-3">App / Resource</th>
                <th className="text-left px-4 py-3 w-28">Risk</th>
                <th className="text-left px-4 py-3">Roles Allowed</th>
                <th className="text-left px-4 py-3">Approver</th>
                <th className="text-left px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-950/50">
              {ACCESS_POLICIES.map((policy) => {
                const isLow = policy.risk === "Low";
                const isMedium = policy.risk === "Medium";
                const isHigh = policy.risk === "High";

                return (
                  <tr key={policy.app} className="hover:bg-teal-950/20 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-slate-100">{policy.app}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isLow
                            ? "bg-emerald-950/80 text-[#16A34A] border border-emerald-700/60"
                            : isMedium
                            ? "bg-amber-950/80 text-[#F59E0B] border border-amber-700/60"
                            : "bg-rose-950/80 text-[#DC2626] border border-rose-700/60"
                        }`}
                      >
                        {policy.risk}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{policy.rolesAllowed}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-200">
                      {isLow ? (
                        <span className="text-[#16A34A] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Auto-approved
                        </span>
                      ) : (
                        policy.approver
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-[11px] leading-relaxed">{policy.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Rows & Decision History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <FileCheck2 className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-white">Access Decision Audit Log</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono bg-slate-800/60 px-2 py-0.5 rounded-md border border-slate-700">
            {auditRows.length} logged events
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-700/60 bg-[#0f172a] shadow-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0c1322] text-slate-300 font-semibold">
                <th className="text-left px-4 py-3 w-28">Time</th>
                <th className="text-left px-4 py-3">Requester</th>
                <th className="text-left px-4 py-3">App</th>
                <th className="text-left px-4 py-3">Decision</th>
                <th className="text-left px-4 py-3">Approver</th>
                <th className="text-right px-4 py-3 w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {auditRows.map((row) => {
                const timeStr = mounted ? formatTime(row.timestamp) : "--:--";

                return (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]" suppressHydrationWarning>
                      {timeStr}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-100">{row.requesterName}</td>
                    <td className="px-4 py-2.5 text-slate-200 font-medium">{row.app}</td>
                    <td className="px-4 py-2.5">
                      {row.decision === "granted" ? (
                        <span className="inline-flex items-center gap-1 text-[#16A34A] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          Granted
                        </span>
                      ) : row.decision === "pending_approval" ? (
                        <span className="inline-flex items-center gap-1 text-[#F59E0B] font-semibold">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      ) : row.decision === "undone" ? (
                        <span className="inline-flex items-center gap-1 text-purple-400 font-semibold">
                          <Undo2 className="w-3 h-3" />
                          Revoked (Undone)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#DC2626] font-semibold">
                          <XCircle className="w-3 h-3" />
                          Denied
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-[11px]">{row.approver}</td>
                    <td className="px-4 py-2.5 text-right">
                      {row.canUndo && row.decision === "granted" && (
                        <button
                          onClick={() => handleUndo(row.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-950/70 hover:bg-purple-900 border border-purple-700/60 text-purple-300 text-[10px] font-semibold transition-colors shadow-sm"
                          title="Revoke and rollback granted access"
                        >
                          <Undo2 className="w-3 h-3" />
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}