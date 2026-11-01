import { NextResponse } from "next/server";
import { readCardFeed, asOfDate } from "@/agents/expenses";

// GET /api/finance/card-feed -> { asOf, txns: CardTxn[] }, or { status: "error", message }
export async function GET() {
  try {
    return NextResponse.json({ asOf: asOfDate().toISOString(), txns: readCardFeed() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}