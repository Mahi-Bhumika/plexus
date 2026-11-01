import { NextResponse } from "next/server";
import { catchMeUp, parseCatchUp, parseRole, ROLES } from "@/lib/search";

// POST /api/search/catchup { role, query } or { role, topic, days }
//   e.g. { role: "founder", query: "Catch me up on Meridian, last 4 days" }
//   -> { status: "done", briefing, points: [{ text, source }], sources, locked, window, ... }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: unknown; topic?: unknown; days?: unknown; role?: unknown };
    const role = typeof body.role === "string" ? parseRole(body.role) : null;
    if (!role) {
      return NextResponse.json(
        { status: "error", message: `role must be one of: ${ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    let topic = typeof body.topic === "string" ? body.topic.trim() : "";
    let days = typeof body.days === "number" && body.days > 0 ? Math.min(Math.floor(body.days), 60) : 0;
    if (typeof body.query === "string" && body.query.trim()) {
      const parsed = parseCatchUp(body.query);
      if (!topic) topic = parsed.topic;
      if (!days) days = parsed.days;
    }
    if (!days) days = 4;
    return NextResponse.json(await catchMeUp(topic, days, role));
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}