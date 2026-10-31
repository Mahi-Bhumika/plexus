import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDb } from "./db";
import { withReplay } from "./replay";

type MekoClientState = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

let mekoState: MekoClientState | null = null;
const agentConversationMap = new Map<string, string>();
let loggedKnowledgeKeys = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDatapackId(): string {
  const id = process.env.MEKO_DATAPACK_ID;
  if (!id) {
    throw new Error("MEKO_DATAPACK_ID not set");
  }
  return id;
}

function sanitizeErrorMessage(msg: string): string {
  const sanitized = msg.replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "[REDACTED_AUTH]");
  return sanitized.slice(0, 300);
}

function isRetryableError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();

  // Do NOT retry tool errors or validation errors
  if (msg.includes("unknown tool") || msg.includes("validation error") || msg.includes("invalid argument")) {
    return false;
  }

  const status = Number(err.status || err.statusCode || 0);
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  // Network / fetch errors
  if (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("abort") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }

  return false;
}

export async function invokeToolSafe(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<any> {
  const result = (await client.callTool({
    name: toolName,
    arguments: args,
  })) as any;

  if (result?.isError) {
    const errorText =
      result.content?.[0]?.text ||
      result.error ||
      JSON.stringify(result.content || "Unknown tool error");
    throw new Error(sanitizeErrorMessage(errorText));
  }

  return result;
}

export async function getMekoClient(): Promise<Client | null> {
  const mekoUrl = process.env.MEKO_MCP_URL || "https://mcp.mekodata.ai/mcp";
  const mekoAuth = process.env.MEKO_AUTH;

  if (!mekoAuth) {
    return null;
  }

  if (mekoState) {
    return mekoState.client;
  }

  try {
    const transport = new StreamableHTTPClientTransport(new URL(mekoUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${mekoAuth}`,
          "User-Agent": "meko-mcp-installer/1.0",
        },
      },
    });

    const client = new Client(
      {
        name: "plexus-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await client.connect(transport);
    mekoState = { client, transport };
    return client;
  } catch (err: any) {
    console.warn(`meko connect failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    return null;
  }
}

export async function getOrCreateConversation(client: Client, agentId: string): Promise<string> {
  const existing = agentConversationMap.get(agentId);
  if (existing) {
    return existing;
  }

  const datapackId = getDatapackId();
  const result = await invokeToolSafe(client, "conversation_create", {
    datapack_id: datapackId,
    agent_id: agentId,
    title: `Plexus Session - ${agentId}`,
  });

  let convId: string | undefined;
  if (result?.content?.[0]?.text) {
    try {
      const parsed = JSON.parse(result.content[0].text);
      convId = parsed.conversation_id || parsed.id;
    } catch {
      // not JSON
    }
  }

  if (!convId) {
    throw new Error("conversation_create returned no conversation ID");
  }

  agentConversationMap.set(agentId, convId);
  return convId;
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [2000, 4000, 8000];
  let lastErr: any;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i < 2 && isRetryableError(err)) {
        await delay(delays[i]);
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

export type MemorySearchResult = {
  id?: string;
  text: string;
  score?: number;
  fallback?: boolean;
};

export type KnowledgeSearchResult = {
  title: string;
  content: string;
  ref: string;
  score?: number;
  fallback?: boolean;
};

export async function addMemory(
  agentId: string,
  text: string,
  replayKey?: string,
): Promise<{ success: boolean; memoryId?: string; fallback?: boolean }> {
  const key = replayKey || `meko/addMemory_${agentId}_${Date.now()}`;
  return withReplay(key, async () => {
    const datapackId = getDatapackId();
    try {
      const client = await getMekoClient();
      if (client) {
        const convId = await getOrCreateConversation(client, agentId);
        const res = await callWithRetry(() =>
          invokeToolSafe(client, "memory_add", {
            conversation_id: convId,
            agent_id: agentId,
            datapack_id: datapackId,
            text,
          }),
        );
        let extractedId: string | undefined;
        try {
          if (res?.content?.[0]?.text) {
            const parsed = JSON.parse(res.content[0].text);
            const first = Array.isArray(parsed?.results) ? parsed.results[0] : parsed?.results;
            if (first?.id) extractedId = String(first.id);
          }
        } catch {
          // fallback to JSON string
        }
        return { success: true, memoryId: extractedId || JSON.stringify(res) };
      }
    } catch (err: any) {
      console.warn(`meko memory_add failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    }

    // SQLite fallback
    const id = `mem_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    getDb()
      .prepare("INSERT INTO memories (id, agent_id, text, created_at) VALUES (?, ?, ?, ?)")
      .run(id, agentId, text, now);
    return { success: true, memoryId: id, fallback: true };
  });
}

export async function deleteMemory(
  memoryId: string,
  agentId = "plexus_rfp",
  replayKey?: string,
): Promise<{ success: boolean; fallback?: boolean }> {
  const key = replayKey || `meko/deleteMemory_${agentId}_${memoryId}`;
  return withReplay(key, async () => {
    const datapackId = getDatapackId();
    try {
      const client = await getMekoClient();
      if (client) {
        const convId = await getOrCreateConversation(client, agentId);
        await callWithRetry(() =>
          invokeToolSafe(client, "memory_delete_by_id", {
            conversation_id: convId,
            agent_id: agentId,
            datapack_id: datapackId,
            memory_id: memoryId,
          }),
        );
        return { success: true };
      }
    } catch (err: any) {
      console.warn(`meko memory_delete_by_id failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    }

    // SQLite fallback
    getDb().prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
    return { success: true, fallback: true };
  });
}

export async function searchMemory(
  agentId: string,
  query: string,
  replayKey?: string,
): Promise<Array<MemorySearchResult>> {
  const key = replayKey || `meko/searchMemory_${agentId}_${encodeURIComponent(query.slice(0, 30))}`;
  return withReplay(key, async () => {
    const datapackId = getDatapackId();
    try {
      const client = await getMekoClient();
      if (client) {
        const convId = await getOrCreateConversation(client, agentId);
        const res = await callWithRetry(() =>
          invokeToolSafe(client, "memory_search", {
            conversation_id: convId,
            agent_id: agentId,
            datapack_id: datapackId,
            query,
          }),
        );

        if (res?.content?.[0]?.text) {
          const parsed = JSON.parse(res.content[0].text);
          const results = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
          return results.map((m: any) => ({
            id: m.id ? String(m.id) : undefined,
            text: m.memory || m.text || (typeof m === "string" ? m : JSON.stringify(m)),
            score: m.score,
          }));
        }
      }
    } catch (err: any) {
      console.warn(`meko memory_search failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    }

    // SQLite fallback with LIKE on query words
    const words = query
      .split(/\s+/)
      .map((w) => w.trim().replace(/[%_]/g, ""))
      .filter((w) => w.length > 2);

    let rows: Array<{ id: string; text: string }> = [];
    if (words.length > 0) {
      const conditions = words.map(() => "text LIKE ?").join(" OR ");
      const params = words.map((w) => `%${w}%`);
      rows = getDb()
        .prepare(
          `SELECT id, text FROM memories WHERE (agent_id = ? OR agent_id = 'all') AND (${conditions}) ORDER BY created_at DESC LIMIT 10`,
        )
        .all(agentId, ...params) as Array<{ id: string; text: string }>;
    } else {
      rows = getDb()
        .prepare("SELECT id, text FROM memories WHERE agent_id = ? OR agent_id = 'all' ORDER BY created_at DESC LIMIT 10")
        .all(agentId) as Array<{ id: string; text: string }>;
    }

    return rows.map((r) => ({ id: r.id, text: r.text, fallback: true }));
  });
}

export async function searchKnowledge(
  agentId: string,
  query: string,
  replayKey?: string,
): Promise<Array<KnowledgeSearchResult>> {
  const key = replayKey || `meko/searchKnowledge_${agentId}_${encodeURIComponent(query.slice(0, 30))}`;
  return withReplay(key, async () => {
    const datapackId = getDatapackId();
    try {
      const client = await getMekoClient();
      if (client) {
        const convId = await getOrCreateConversation(client, agentId);
        const res = await callWithRetry(() =>
          invokeToolSafe(client, "knowledgebase_search", {
            conversation_id: convId,
            agent_id: agentId,
            datapack_id: datapackId,
            query,
            limit: 8,
          }),
        );

        if (res?.content?.[0]?.text) {
          const parsed = JSON.parse(res.content[0].text);
          const results = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];

          // Knowledge search also returns planning-note memories that Meko indexes
          // into the knowledge base (metadata_filters.source === "memory"). Keep
          // policy documents only; learned RFP fixes come back through searchMemory.
          const docs = results.filter((r: any) => r?.metadata_filters?.source !== "memory");

          if (docs.length > 0 && !loggedKnowledgeKeys) {
            console.warn("Meko knowledge item keys:", Object.keys(docs[0]));
            loggedKnowledgeKeys = true;
          }

          return docs.map((item: any) => ({
            title: item.title || item.doc_name || item.document_name || item.name || "Knowledge Doc",
            content: item.chunk_text || item.content || item.text || "",
            ref: item.id ? String(item.id) : item.ref || item.doc_name || "policy",
            score: item.score,
          }));
        }
      }
    } catch (err: any) {
      console.warn(`meko knowledgebase_search failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    }

    // Fallback: Return empty list with fallback flag
    return [];
  });
}

export async function logTurn(
  agentId: string,
  input: string,
  output: string,
  plan: string[] | string,
  reasoning: string,
  replayKey?: string,
): Promise<{ success: boolean; traceId: string; fallback?: boolean }> {
  const key = replayKey || `meko/logTurn_${agentId}_${Date.now()}`;
  return withReplay(key, async () => {
    const datapackId = getDatapackId();
    const traceId = `trc_${crypto.randomUUID()}`;

    // Ensure plan is an array of 2 to 4 items
    let planArray: string[];
    if (Array.isArray(plan)) {
      planArray = plan.slice(0, 4);
      if (planArray.length < 2) {
        planArray.push("Complete execution");
      }
    } else {
      planArray = [plan || "Analyze task input", "Generate output result"];
    }

    try {
      const client = await getMekoClient();
      if (client) {
        const convId = await getOrCreateConversation(client, agentId);
        await callWithRetry(() =>
          invokeToolSafe(client, "conversation_add_message", {
            conversation_id: convId,
            agent_id: agentId,
            datapack_id: datapackId,
            input,
            output,
            plan: planArray,
            reasoning,
          }),
        );
        return { success: true, traceId };
      }
    } catch (err: any) {
      console.warn(`meko conversation_add_message failed: ${sanitizeErrorMessage(err?.message || String(err))}`);
    }

    // SQLite fallback
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO traces (id, agent_id, conversation_id, input, output, plan, reasoning, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(traceId, agentId, `conv_${agentId}`, input, output, JSON.stringify(planArray), reasoning, now);

    return { success: true, traceId, fallback: true };
  });
}