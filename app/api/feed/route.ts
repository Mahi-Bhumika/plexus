// app/api/feed/route.ts
import { NextResponse } from "next/server";
import { listEvents } from "@/lib/events";


// GET /api/feed?limit=25 -> { status: "ok", events: Event[] }
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit")) || 25));
    const events = listEvents(limit);
    return NextResponse.json({ status: "ok", events });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
