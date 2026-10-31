import { NextResponse } from "next/server";
import { getSavedClaims, runExpenses } from "@/agents/expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/finance/expenses -> { receipts: ExpenseResult[] } from the last run (may be empty)
// POST /api/finance/expenses -> runs the receipts now and returns the full ExpenseReport
// Errors come back as { status: "error", message }.
export async function GET() {
  try {
    return NextResponse.json({ receipts: getSavedClaims() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runExpenses());
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
