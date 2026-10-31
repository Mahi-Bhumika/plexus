"use client";

import { Sparkles } from "lucide-react";
import ZombieSaas from "@/components/zombie-saas";

/* Shared look: matches the RFP Agent page (navy cards, thin borders). */
const CARD = "rounded-2xl border border-slate-800 bg-[#0c1424]";

function SampleBadge() {
  return (
    <div className={`${CARD} px-4 py-2.5 flex items-center gap-2.5 text-sm text-slate-300 shrink-0`}>
      <Sparkles className="w-4 h-4 text-indigo-400" />
      <span className="leading-tight">
        Sample
        <br />
        data
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page: Audit Trail                                                          */
/* -------------------------------------------------------------------------- */

export default function AuditTrailPage() {
  return (
    <div className="min-h-full bg-[#0b1120]">
      <div className="p-8 max-w-6xl space-y-7">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Audit Trail</h2>
            <p className="text-[15px] text-slate-400 mt-1.5 max-w-2xl">
              Every agent action with its trace. Gated actions go to a human approver and are logged here.
            </p>
          </div>
          <SampleBadge />
        </div>

        {/* …audit log table goes here (above Zombie SaaS) */}

        <ZombieSaas />
      </div>
    </div>
  );
}