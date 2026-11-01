/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/meko-kb.ts: knowledge-base search and upload for the Search page.
// Built on the existing client in lib/meko.ts (MEKO_AUTH, SDK transport), so nothing there changes.
import { createHash } from "node:crypto";
import { getMekoClient, getOrCreateConversation, invokeToolSafe } from "@/lib/meko";
import { withReplay } from "@/lib/replay";

// Which datapack holds the Nimbus policy docs and Meridian notes.
export const KB_DATAPACK_ID =
  process.env.MEKO_SEARCH_DATAPACK_ID ??
  process.env.MEKO_DATAPACK_ID ??
  "a8775b95-e56e-4445-a40b-e1b9b513807e"; // plexus-app-demo
const AGENT_ID = "plexus_search";

export type KbRow = {
  id: string;
  chunk_text: string;
  document_id: string;
  match_type: string;
  rerank_score?: number | null;
  distance?: number | null;
  metadata_filters?: { source?: string } & Record<string, unknown>;
};

// One shared conversation, created once even when several searches start in parallel.
let convPromise: Promise<string> | null = null;

async function tool(name: string, args: Record<string, unknown>) {
  const client = await getMekoClient();
  if (!client) throw new Error("Meko is not configured or unreachable. Set MEKO_AUTH and check MEKO_MCP_URL.");

  convPromise ??= getOrCreateConversation(client, AGENT_ID).catch((e) => {
    convPromise = null;
    throw e;
  });
  const conversation_id = await convPromise;

  const res = await invokeToolSafe(client, name, { conversation_id, agent_id: AGENT_ID, ...args });
  const text: string = Array.isArray(res?.content) ? res.content.map((c: any) => c?.text ?? "").join("") : "";

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  // Meko reports many failures as plain JSON: {"error": "...", "detail": "..."}
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.error) {
    throw new Error(`Meko ${name}: ${parsed.error}${parsed.detail ? ` (${parsed.detail})` : ""}`);
  }
  return parsed;
}

export function kbSearch(query: string, limit = 8, opts: { replay?: boolean } = {}): Promise<KbRow[]> {
  const run = async () => {
    const res = await tool("knowledgebase_search", { datapack_id: KB_DATAPACK_ID, query, limit });
    return (Array.isArray(res?.results) ? res.results : []) as KbRow[];
  };
  if (!opts.replay) return run(); // typed searches are always live
  return withReplay(`meko/kbSearch_${encodeURIComponent(query.slice(0, 60))}_${limit}`, run);
}

export function kbInfo() {
  return tool("datapack_describe", { datapack_id: KB_DATAPACK_ID, include_status: true });
}

// Upload a text document to the knowledge base (presigned S3 flow, then Meko indexes it).
export async function kbUpload(filename: string, content: string) {
  const bytes = Buffer.from(content, "utf8");
  const r = await tool("knowledgebase_upload_document", {
    datapack_id: KB_DATAPACK_ID,
    filename,
    size: bytes.length,
    content_hash: createHash("sha256").update(bytes).digest("hex"),
    content_head_base64: bytes.subarray(0, 3072).toString("base64"),
  });
  if (r?.already_uploaded) return { state: "already_uploaded", key: (r.key as string) ?? null };
  if (!r?.url || !r?.fields) throw new Error("Meko did not return an upload URL");

  const form = new FormData();
  for (const [k, v] of Object.entries(r.fields as Record<string, unknown>)) form.append(k, String(v));
  form.append("file", new Blob([content], { type: "text/plain" }), filename); // file must be the last field
  const up = await fetch(r.url as string, { method: "POST", body: form });
  if (!up.ok) throw new Error(`Upload to storage failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  return { state: "uploaded", key: r.key as string };
}

export function kbStatus(document_key: string) {
  return tool("knowledgebase_document_status", { datapack_id: KB_DATAPACK_ID, document_key });
}