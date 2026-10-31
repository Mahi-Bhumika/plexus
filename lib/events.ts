import { z } from "zod";
import { getDb } from "@/lib/db";

export const AGENTS = [
  "rfp",
  "actionswarm",
  "access",
  "finance",
  "search",
  "guard",
] as const;

export type AgentName = (typeof AGENTS)[number];

export const STATUSES = [
  "done",
  "flagged",
  "blocked",
  "pending_approval",
  "undone",
  "error",
] as const;

export type ActivityStatus = (typeof STATUSES)[number];

export const sourceSchema = z.object({
  title: z.string(),
  ref: z.string(),
});

export const activityEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  agent: z.enum(AGENTS),
  action: z.string(),
  status: z.enum(STATUSES),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(sourceSchema),
  traceId: z.string(),
  undoable: z.boolean(),
});

export type ActivityEvent = z.infer<typeof activityEventSchema>;

type Listener = (event: ActivityEvent) => void;

type EventsGlobal = typeof globalThis & {
  __plexusListeners?: Set<Listener>;
};

function listeners(): Set<Listener> {
  const g = globalThis as EventsGlobal;
  if (!g.__plexusListeners) {
    g.__plexusListeners = new Set<Listener>();
  }
  return g.__plexusListeners;
}

export function subscribe(listener: Listener): () => void {
  const set = listeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function listEvents(limit = 50): ActivityEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, timestamp, agent, action, status, confidence, sources_json, trace_id, undo_state
       FROM audit_events
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    timestamp: string;
    agent: string;
    action: string;
    status: string;
    confidence: number | null;
    sources_json: string;
    trace_id: string;
    undo_state: string | null;
  }>;

  return rows.map((row) => {
    const parsed = activityEventSchema.safeParse({
      id: row.id,
      timestamp: row.timestamp,
      agent: row.agent,
      action: row.action,
      status: row.status,
      confidence: row.confidence ?? undefined,
      sources: JSON.parse(row.sources_json || "[]") as unknown,
      traceId: row.trace_id,
      undoable: Boolean(row.undo_state),
    });
    if (parsed.success) {
      return parsed.data;
    }
    return {
      id: row.id,
      timestamp: row.timestamp,
      agent: "guard",
      action: row.action || "unreadable audit row",
      status: "error",
      sources: [],
      traceId: row.trace_id,
      undoable: false,
    };
  });
}

export function emitEvent(event: ActivityEvent): ActivityEvent {
  const parsed = activityEventSchema.parse(event);
  getDb()
    .prepare(
      `INSERT INTO audit_events (
         id, timestamp, agent, action, status, confidence, sources_json, trace_id, undo_state, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.id,
      parsed.timestamp,
      parsed.agent,
      parsed.action,
      parsed.status,
      parsed.confidence ?? null,
      JSON.stringify(parsed.sources),
      parsed.traceId,
      parsed.undoable ? "{}" : null,
      JSON.stringify(parsed),
    );

  for (const listener of listeners()) {
    listener(parsed);
  }
  return parsed;
}

export function newEventId(): string {
  return crypto.randomUUID();
}
