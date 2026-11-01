// app/api/search/upload/route.ts
import { NextResponse } from "next/server";
import { kbStatus, kbUpload } from "@/lib/meko-kb";

const ALLOWED = /\.(md|txt|text|json|csv|html?|xml)$/i;
const NAME_OK = /^[\w][\w.\- ]{0,99}$/;
const MAX_CHARS = 1_000_000;

// Facts that contradict the seeded SOC 2 doc (Harlow & Pike LLP, Jan-Jun 2026, two exceptions).
const WRONG_SOC2 = [/Schellman/i, /zero exceptions/i];

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

// POST /api/search/upload { filename, content, force? }  (needs ALLOW_KB_UPLOAD=1)
export async function POST(req: Request) {
  if (process.env.ALLOW_KB_UPLOAD !== "1") {
    return json(403, { status: "error", message: "Uploads are disabled. Set ALLOW_KB_UPLOAD=1 to enable." });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { filename?: unknown; content?: unknown; force?: unknown };
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!NAME_OK.test(filename) || !ALLOWED.test(filename)) {
      return json(400, { status: "error", message: "filename must be a plain name ending in .md, .txt, .json, .csv, .html or .xml" });
    }
    if (!content.trim() || content.length > MAX_CHARS) {
      return json(400, { status: "error", message: "content must be non-empty and under 1,000,000 characters" });
    }
    if (body.force !== true && /soc\s*2/i.test(content)) {
      const conflicts = WRONG_SOC2.filter((re) => re.test(content)).map((re) => re.source);
      if (conflicts.length) {
        return json(422, {
          status: "error",
          message: "Content contradicts the SOC 2 summary in the knowledge base. Fix it, or send force: true.",
          conflicts,
        });
      }
    }
    const r = await kbUpload(filename, content);
    return json(200, { status: "ok", ...r });
  } catch (e) {
    return json(502, { status: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

// GET /api/search/upload?key=...  -> indexing status of an earlier upload
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return json(400, { status: "error", message: "key query parameter is required" });
  try {
    return json(200, { status: "ok", document: await kbStatus(key) });
  } catch (e) {
    return json(502, { status: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
