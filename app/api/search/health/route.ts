// app/api/search/health/route.ts
import { NextResponse } from "next/server";
import { KB_DATAPACK_ID, kbInfo, kbSearch } from "@/lib/meko-kb";

// GET /api/search/health: is Meko reachable, and are the Meridian notes in the knowledge base?
export async function GET(req: Request) {
  void new URL(req.url); // reading the request keeps this route dynamic
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];

  checks.push({
    name: "env",
    ok: !!process.env.MEKO_AUTH && !!process.env.MEKO_DATAPACK_ID,
    detail: {
      MEKO_AUTH: !!process.env.MEKO_AUTH,
      MEKO_DATAPACK_ID: process.env.MEKO_DATAPACK_ID ?? "not set",
      knowledge_base_datapack: KB_DATAPACK_ID,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GEMINI_API_KEY_2: !!process.env.GEMINI_API_KEY_2,
      ALLOW_KB_UPLOAD: process.env.ALLOW_KB_UPLOAD === "1",
    },
  });

  try {
    const info = await kbInfo();
    checks.push({
      name: "datapack",
      ok: true,
      detail: {
        name: info?.datapack_name,
        knowledge_chunks: info?.knowledge_chunk_count,
        memories: info?.memory_count,
        learnings: info?.learnings_count,
        collective_memories: info?.collective_memory_count,
      },
    });
  } catch (e) {
    checks.push({ name: "datapack", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  try {
    const rows = await kbSearch("Meridian project notes", 10);
    const matches = rows.filter((r) => /meridian/i.test(r.chunk_text ?? ""));
    checks.push({
      name: "meridian_notes",
      ok: matches.length > 0,
      detail:
        matches.length > 0
          ? { chunks_mentioning_meridian: matches.length }
          : "No chunk mentions Meridian. Upload the seed/cmdk notes (POST /api/search/upload) before demoing Catch-Me-Up.",
    });
  } catch (e) {
    checks.push({ name: "meridian_notes", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ status: checks.every((c) => c.ok) ? "ok" : "degraded", checks });
}