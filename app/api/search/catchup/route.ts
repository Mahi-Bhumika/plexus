// app/api/search/catchup/route.ts
import { NextResponse } from "next/server";
import { parseCatchUp, parseRole, clampDays, DEFAULT_DAYS, ROLES } from "@/lib/search";
import { runCatchUp } from "@/lib/search-audit";

// POST /api/search/catchup { role, query } or { role, topic, days }
//   e.g. { role: "founder", query: "Catch me up on Meridian, last 4 days" }
//   -> { status: "done", briefing, points: [{ text, source }], sources, locked, window, ... }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: unknown;
      topic?: unknown;
      days?: unknown;
      role?: unknown;
    };
    const role = typeof body.role === "string" ? parseRole(body.role) : "intern";
    if (!role) {
      return NextResponse.json(
        { status: "error", message: `role must be one of: ${ROLES.join(", ")}` },
        { status: 400 }
      );
    }
    let topic = typeof body.topic === "string" ? body.topic.trim() : "";
    let days =
      typeof body.days === "number" && body.days > 0 ? clampDays(body.days) : 0;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query) {
      const parsed = parseCatchUp(query);
      if (!topic) topic = parsed.topic;
      if (!days) days = parsed.days;
    }
    if (!days) days = DEFAULT_DAYS;

    return NextResponse.json(await runCatchUp(query, topic, days, role));
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
