// app/api/search/route.ts
import { NextResponse } from "next/server";
import { browse, parseCatchUp, parseRole, clampDays, DEFAULT_DAYS, ROLES } from "@/lib/search";
import { runCatchUp, runSearch } from "@/lib/search-audit";

type Input = { query?: unknown; mode?: unknown; role?: unknown; limit?: unknown; topic?: unknown; days?: unknown };

const bad = (message: string) => NextResponse.json({ status: "error", message }, { status: 400 });

async function handle(input: Input) {
  // Missing role = least privilege. An unknown role is rejected.
  const role = input.role == null || input.role === "" ? "intern" : parseRole(input.role);
  if (!role) return bad(`role must be one of: ${ROLES.join(", ")}`);

  const query = typeof input.query === "string" ? input.query.trim() : "";
  const wantsCatchup = input.mode === "catchup" || (input.mode == null && /catch\s*me\s*up/i.test(query));

  if (wantsCatchup) {
    const parsed = parseCatchUp(query);
    const topic = typeof input.topic === "string" && input.topic.trim() ? input.topic.trim() : parsed.topic;
    const days = typeof input.days === "number" && input.days > 0 ? clampDays(input.days) : parsed.days || DEFAULT_DAYS;
    return NextResponse.json(await runCatchUp(query, topic, days, role));
  }

  // No query (or mode "browse"): one passage per knowledge-base document, so the UI is never empty.
  if (input.mode === "browse" || !query) {
    const { hits, hidden } = await browse(role);
    return NextResponse.json({ status: "ok", mode: "browse", role, hidden, filtered: 0, results: hits });
  }

  const limit = typeof input.limit === "number" ? input.limit : 10;
  const { hits, hidden, filtered } = await runSearch(query, role, limit);
  return NextResponse.json({ status: "ok", mode: "search", role, hidden, filtered, results: hits });
}

function fail(e: unknown) {
  return NextResponse.json(
    { status: "error", message: e instanceof Error ? e.message : String(e) },
    { status: 502 },
  );
}

// POST /api/search { query, role, mode?: "search" | "catchup" | "browse", limit? }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Input;
    return await handle(body);
  } catch (e) {
    return fail(e);
  }
}

// GET /api/search?q=...&role=founder&mode=search&limit=8  (used by the Cmd+K palette)
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    return await handle({
      query: sp.get("q") ?? "",
      role: sp.get("role") ?? undefined,
      mode: sp.get("mode") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    });
  } catch (e) {
    return fail(e);
  }
}