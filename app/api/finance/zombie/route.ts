import { NextResponse } from "next/server";
import { findZombieSaas } from "@/lib/zombie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/finance/zombie -> ZombieReport, or { status: "error", message }
export async function GET() {
  try {
    const report = findZombieSaas();
    if (report.totalToolsChecked === 0) {
      return NextResponse.json(
        { status: "error", message: "No SaaS billing data loaded. Run scripts/load-finance.ts." },
        { status: 500 },
      );
    }
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
