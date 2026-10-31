"use client";

import ZombieSaas from "@/components/zombie-saas";

export default function AuditTrailPage() {
  return (
    <div className="min-h-full bg-[#0b1120]">
      <div className="p-8 max-w-6xl space-y-7">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Audit Trail</h2>
          <p className="text-[15px] text-slate-400 mt-1.5 max-w-2xl">
            Every agent action with its trace. Gated actions go to a human approver and are logged here.
          </p>
        </div>

        {/* …audit log table goes here (above Zombie SaaS) */}

        <ZombieSaas />
      </div>
    </div>
  );
}