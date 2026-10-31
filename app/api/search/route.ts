import { NextResponse } from "next/server";
import { searchDocs, parseRole, ROLES } from "@/lib/search";

export const runtime = "nodejs";

// POST /api/search { query, role } -> { status: "done", answer, sources, locked, ... }
// The role comes from the demo's role selector. A real deployment would take it
// from the signed-in user, never from the request body.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: unknown; role?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ status: "error", message: "query is required" }, { status: 400 });
    if (query.length > 500) return NextResponse.json({ status: "error", message: "query is too long" }, { status: 400 });
    const role = typeof body.role === "string" ? parseRole(body.role) : null;
    if (!role) {
      return NextResponse.json(
        { status: "error", message: `role must be one of: ${ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    return NextResponse.json(await searchDocs(query, role));
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
