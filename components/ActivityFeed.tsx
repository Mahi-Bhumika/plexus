"use client";

import { useEffect, useState } from "react";
import { ActivityEvent, ActivityStatus } from "@/lib/events";
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, Undo2, XCircle, HelpCircle } from "lucide-react";

const CONFIDENCE_THRESHOLD = 0.85;

const STATUS_CONFIG: Record<
  ActivityStatus,
  { label: string; bg: string; text: string; border: string; icon: any }
> = {
  done: {
    label: "Done",
    bg: "bg-emerald-950/40",
    text: "text-emerald-400",
    border: "border-emerald-800/60",
    icon: CheckCircle2,
  },
  flagged: {
    label: "Flagged",
    bg: "bg-amber-950/40",
    text: "text-amber-400",
    border: "border-amber-800/60",
    icon: AlertCircle,
  },
  blocked: {
    label: "Blocked",
    bg: "bg-rose-950/40",
    text: "text-rose-400",
    border: "border-rose-800/60",
    icon: ShieldAlert,
  },
  pending_approval: {
    label: "Pending",
    bg: "bg-sky-950/40",
    text: "text-sky-400",
    border: "border-sky-800/60",
    icon: Clock,
  },
  undone: {
    label: "Undone",
    bg: "bg-purple-950/40",
    text: "text-purple-400",
    border: "border-purple-800/60",
    icon: Undo2,
  },
  error: {
    label: "Error",
    bg: "bg-red-950/40",
    text: "text-red-400",
    border: "border-red-800/60",
    icon: XCircle,
  },
};

const UNKNOWN_STATUS_CONFIG = {
  label: "Unknown",
  bg: "bg-zinc-900/60",
  text: "text-zinc-400",
  border: "border-zinc-700/60",
  icon: HelpCircle,
};

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    // Initial fetch of recent events
    fetch("/api/events")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ActivityEvent[]) => {
        setEvents(data);
      })
      .catch((err) => {
        console.error("Failed to load initial events", err);
        setErrorText("Could not load recent events.");
      });

    // Connect to SSE stream
    const eventSource = new EventSource("/api/events/stream");

    eventSource.onmessage = (messageEvent) => {
      try {
        const newEvt: ActivityEvent = JSON.parse(messageEvent.data);
        setEvents((prev) => [newEvt, ...prev.filter((e) => e.id !== newEvt.id)]);
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    eventSource.onerror = () => {
      // Keep UI alive, SSE will retry automatically
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#090D16] border border-slate-800/80 rounded-2xl shadow-xl w-80 lg:w-96 text-zinc-100 flex-shrink-0 overflow-hidden">
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-[#070A12]/60">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="font-semibold text-sm tracking-wide text-zinc-200">Activity Feed</h2>
        </div>
        <span className="text-xs text-zinc-500 font-mono">{events.length} events</span>
      </div>

      {errorText && (
        <div className="m-3 p-2.5 bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs rounded">
          {errorText}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {events.length === 0 && !errorText && (
          <div className="text-center py-12 text-zinc-500 text-xs">
            No agent activity yet. Run an action to see live feed events.
          </div>
        )}

        {events.map((evt) => {
          const cfg = STATUS_CONFIG[evt.status] || UNKNOWN_STATUS_CONFIG;
          const Icon = cfg.icon;
          const time = new Date(evt.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });

          const sourcesList = evt.sources ?? [];
          const firstSource = sourcesList[0];
          const firstSourceTitle = typeof firstSource === "string" ? firstSource : firstSource?.title;
          const tooltipSources = sourcesList
            .map((s) => (typeof s === "string" ? s : s?.title))
            .filter(Boolean)
            .join(", ");

          return (
            <div
              key={evt.id}
              className={`p-3 rounded-lg border transition-all ${cfg.bg} ${cfg.border} hover:border-zinc-700`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-mono uppercase font-semibold text-zinc-400">
                  {evt.agent}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${cfg.text}`}>
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{time}</span>
                </div>
              </div>

              <div className="text-xs text-zinc-200 font-medium leading-snug">{evt.action}</div>

              {(evt.confidence != null || (evt.sources?.length ?? 0) > 0) && (
                <div className="mt-2 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                  {evt.confidence != null ? (
                    <span>
                      Confidence:{" "}
                      <span className={evt.confidence >= CONFIDENCE_THRESHOLD ? "text-emerald-400" : "text-amber-400"}>
                        {Math.round(evt.confidence * 100)}%
                      </span>
                    </span>
                  ) : <span />}

                  {(evt.sources?.length ?? 0) > 0 && (
                    <span className="truncate max-w-[150px] text-zinc-500" title={tooltipSources}>
                      {firstSourceTitle}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
