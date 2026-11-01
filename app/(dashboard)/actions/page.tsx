"use client";

import { useRef, useState } from "react";

type Status = "Ready" | "Needs Assignment";
type TaskItem = {
  id: number;
  title: string;
  desc: string;
  assignee: string;
  dueDate: string;
  status: Status;
  guard: string | null;
};
type Draft = { to: string; cc: string; subject: string; body: string };

const TEAM = ["Karan Malhotra", "Meera Iyer", "Riya Sharma", "Arjun Verma"];

/* ---------- adapter ---------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const str = (v: Any) => (typeof v === "string" ? v : v == null ? "" : String(v));
const pick = (o: Any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k];
  return undefined;
};
const list = (v: Any): string => (Array.isArray(v) ? v.map(str).join(", ") : str(v));

function adaptTasks(res: Any): TaskItem[] {
  const arr: Any[] = res?.tasks ?? [];
  return arr.map((t, i) => {
    const owner = str(pick(t, "owner", "assignee", "assignedTo"));
    const guardRaw = pick(t, "guard", "decision", "guardDecision");
    const guard =
      typeof guardRaw === "string"
        ? guardRaw
        : guardRaw
          ? str(pick(guardRaw, "decision", "status", "action", "verdict"))
          : null;
    const taskStatus = pick(t, "status");
    const isNeeds =
      taskStatus === "needs_review" ||
      !owner ||
      /^(unassigned|unknown|tbd)$/i.test(owner);

    return {
      id: i + 1,
      title: str(pick(t, "title", "task", "summary")) || "Untitled task",
      desc: str(pick(t, "description", "desc", "details", "context")),
      assignee: owner || "Unassigned",
      dueDate: str(pick(t, "dueDate", "due", "deadline")) || "TBD",
      status: isNeeds ? "Needs Assignment" : "Ready",
      guard: guard || null,
    };
  });
}

function adaptQuarantined(res: Any): string[] {
  const q: Any[] = res?.quarantined ?? [];
  return q.map((x) =>
    typeof x === "string" ? x : str(pick(x, "line", "text", "content", "reason")) || JSON.stringify(x),
  );
}

function adaptDraft(res: Any): Draft | null {
  const d = res?.emailDraft;
  if (!d) return null;
  if (typeof d === "string") return { to: "", cc: "", subject: "Meeting Summary", body: d };
  return {
    to: list(pick(d, "to", "recipients")),
    cc: list(pick(d, "cc")),
    subject: str(pick(d, "subject", "title")) || "Meeting Summary & Project Timeline",
    body: str(pick(d, "body", "text", "content", "message")),
  };
}

function flatten(v: Any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join("\n");
  if (typeof v === "object") {
    const direct = pick(v, "text", "message", "body", "content", "summary", "post");
    if (direct != null) return flatten(direct);
    if (v.blocks) return flatten(v.blocks);
    if (v.lines) return flatten(v.lines);
    return Object.values(v).map(flatten).filter(Boolean).join("\n");
  }
  return String(v);
}

function adaptSlack(res: Any): string {
  return flatten(res?.slack).trim();
}
/* -------------------------------------------------------------------------- */

function guardStyle(g: string) {
  if (/block|deny|denied|quarant|reject/i.test(g)) return "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50";
  if (/approv|review|confirm/i.test(g)) return "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/50";
  return "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50";
}

export default function ActionSwarmPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [processed, setProcessed] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [sourceMenu, setSourceMenu] = useState(false);
  const [uploaded, setUploaded] = useState<{ name: string; text: string }[]>([]);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [quarantined, setQuarantined] = useState<string[]>([]);
  const [securityDismissed, setSecurityDismissed] = useState(false);

  const [activeTab, setActiveTab] = useState<"email" | "slack" | "agents">("email");
  const [assigneeSelect, setAssigneeSelect] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [slackFromApi, setSlackFromApi] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailBodyOverride, setEmailBodyOverride] = useState<string | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [emailMsg, setEmailMsg] = useState("");
  const [slackState, setSlackState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [slackMsg, setSlackMsg] = useState("");

  const readyCount = tasks.filter((t) => t.status === "Ready").length;
  const reviewCount = tasks.length - readyCount;
  const pending = tasks.find((t) => t.status === "Needs Assignment");

  const email: Draft = {
    to: draft?.to || "client@company.com",
    cc: draft?.cc || "team@nimbuslabs.ai",
    subject: draft?.subject || "Meeting Summary & Project Timeline",
    body:
      emailBodyOverride ??
      (draft?.body ||
        (tasks.length > 0
          ? [
              "Hi team,",
              "",
              "Thanks for the meeting. Here are the agreed next steps:",
              "",
              ...tasks.map((t) => `- ${t.dueDate}: ${t.title} (${t.assignee})`),
              "",
              "Best regards,",
              "Nimbus Labs",
            ].join("\n")
          : "")),
  };

  const slackText =
    slackFromApi ||
    (tasks.length > 0
      ? [
          "*Kickoff action items*",
          ...tasks.map((t) => `• ${t.title} → ${t.assignee} (${t.dueDate})`),
        ].join("\n")
      : "");

  const handoffs = (() => {
    const accessTasks = tasks.filter((t) =>
      /access|credential|sandbox|account|environment|login|key/i.test(t.title + " " + t.desc),
    );
    const financeTasks = tasks.filter((t) =>
      /cost|price|pricing|budget|bill|reconcil|payment|nda/i.test(t.title + " " + t.desc),
    );

    const listItems: Array<{ name: string; text: string }> = [];
    if (accessTasks.length > 0) {
      listItems.push({
        name: "Access Agent",
        text: `${accessTasks[0].title} — Assigned to ${accessTasks[0].assignee} (Due ${accessTasks[0].dueDate})`,
      });
    }
    if (financeTasks.length > 0) {
      listItems.push({
        name: "Finance Agent",
        text: `${financeTasks[0].title} — Assigned to ${financeTasks[0].assignee} (Due ${financeTasks[0].dueDate})`,
      });
    }
    if (listItems.length === 0 && tasks.length > 0) {
      listItems.push({
        name: "Access Agent",
        text: `Coordinate permissions for: ${tasks[0].title} (${tasks[0].assignee})`,
      });
      if (tasks[1]) {
        listItems.push({
          name: "Finance Agent",
          text: `Track deliverables for: ${tasks[1].title} (${tasks[1].assignee})`,
        });
      }
    }
    return listItems;
  })();

  async function runSwarm(label: string, transcript?: string) {
    setRunning(true);
    setRunError(null);
    setSourceMenu(false);
    try {
      const res = await fetch("/api/actionswarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transcript ? { transcript } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.status === "error") {
        throw new Error(data?.message ?? `API returned ${res.status}`);
      }
      const next = adaptTasks(data);
      if (!next.length) throw new Error("The run returned no tasks");
      setTasks(next);
      setQuarantined(adaptQuarantined(data));
      setDraft(adaptDraft(data));
      setSlackFromApi(adaptSlack(data));
      setSourceLabel(label);
      setProcessed(true);
      setEmailBodyOverride(null);
      setEmailState("idle");
      setSlackState("idle");
      setSecurityDismissed(false);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await f.text();
    setUploaded((u) => [{ name: f.name, text }, ...u.filter((x) => x.name !== f.name)]);
    await runSwarm(f.name, text);
  }

  function assignPending() {
    if (!assigneeSelect || !pending) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === pending.id ? { ...t, assignee: assigneeSelect, status: "Ready" } : t)),
    );
    setAssigneeSelect("");
    setEmailBodyOverride(null);
  }

  async function sendEmail() {
    setEmailState("sending");
    try {
      const res = await fetch("/api/actionswarm/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      window.location.href =
        `mailto:${encodeURIComponent(email.to)}?cc=${encodeURIComponent(email.cc)}` +
        `&subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
      setEmailState("done");
      setEmailMsg("Approved, logged and opened in your mail client");
    } catch (e) {
      setEmailState("error");
      setEmailMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  async function pushSlack() {
    setSlackState("sending");
    try {
      const res = await fetch("/api/actionswarm/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `API returned ${res.status}`);
      setSlackState("done");
      setSlackMsg("Posted to #eng-tasks");
    } catch (e) {
      setSlackState("error");
      setSlackMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  const showBanner = quarantined.length > 0;
  const bannerLines = quarantined;

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 pb-20 flex flex-col gap-5">
      <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={onFile} />

      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white dark:bg-[#0F172A] p-5 rounded-xl border border-[#E5E7EB] dark:border-[#1E293B] shadow-sm">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase text-[#3B5BFD] px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/40 font-semibold tracking-wider">
              ActionSwarm
            </span>
            {processed ? (
              <span className="px-2 py-0.5 rounded-md border text-xs font-mono font-medium bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Processed ({tasks.length} tasks)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md border text-xs font-mono font-medium bg-gray-50 dark:bg-[#162032] border-gray-200 dark:border-[#1E293B] text-gray-500 dark:text-gray-400">
                No transcript loaded
              </span>
            )}
          </div>
          <h1 className="text-xl lg:text-2xl text-[#111827] dark:text-[#F3F4F6] tracking-tight font-semibold">
            Meeting Action Items &amp; Next Steps
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 max-w-3xl">
            Extracts action items, guards permissions, drafts client emails, and prepares team updates from uploaded transcripts.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start xl:self-center relative">
          <button
            type="button"
            onClick={() => setSourceMenu((v) => !v)}
            disabled={running}
            className="flex items-center gap-2.5 bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] px-3.5 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1E293B] cursor-pointer disabled:opacity-60 text-[#111827] dark:text-[#F3F4F6]"
          >
            <span className="material-symbols-outlined text-[#3B5BFD] text-[18px]">mic</span>
            <div className="flex flex-col text-left">
              <span className="text-xs font-semibold leading-none">
                {sourceLabel ?? "Choose Transcript"}
              </span>
              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                {running ? "Processing…" : sourceLabel ? "Click to change" : "Click to select"}
              </span>
            </div>
            <span className="material-symbols-outlined text-gray-400 text-[18px]">expand_more</span>
          </button>

          {sourceMenu && (
            <div className="absolute top-full left-0 mt-1 min-w-[280px] bg-white dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#1E293B] rounded-lg shadow-lg z-20 py-1">
              <button
                type="button"
                onClick={() => runSwarm("Kickoff Transcript (Meridian Bank)")}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#131C2E] text-[#111827] dark:text-[#F3F4F6] cursor-pointer flex items-center justify-between"
              >
                <span>Kickoff Transcript (Meridian Bank)</span>
                <span className="text-[10px] font-mono text-gray-400">seed file</span>
              </button>
              {uploaded.map((u) => (
                <button
                  key={u.name}
                  type="button"
                  onClick={() => runSwarm(u.name, u.text)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#131C2E] text-[#111827] dark:text-[#F3F4F6] cursor-pointer"
                >
                  {u.name}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={running}
            className="flex items-center gap-1.5 bg-[#3B5BFD] hover:bg-[#2549ED] px-3.5 py-2 rounded-lg text-white text-xs font-medium shadow-sm cursor-pointer disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            <span>{running ? "Processing…" : "Upload Transcript"}</span>
          </button>
        </div>
      </div>

      {runError && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-400 text-xs px-4 py-2.5 rounded-lg font-mono">
          Run failed: {runError}
        </div>
      )}

      {/* Security banner (only displayed if prompt injections or unauthorized instructions were actually quarantined) */}
      {showBanner && !securityDismissed && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-900 dark:text-rose-200 p-4 rounded-xl">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/40 border border-rose-300 dark:border-rose-800 flex items-center justify-center shrink-0 text-rose-700 dark:text-rose-300">
                <span className="material-symbols-outlined text-[24px]">security</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-rose-950 dark:text-rose-200">
                  {bannerLines.length} suspicious line{bannerLines.length > 1 ? "s" : ""} quarantined by Security Guard
                </span>
                <p className="text-xs text-rose-800 dark:text-rose-300">
                  Untrusted prompt injection instruction detected in transcript and blocked. No system access changed.
                </p>
                <ul className="mt-1 space-y-1">
                  {bannerLines.map((l, i) => (
                    <li
                      key={i}
                      className="font-mono text-[11px] text-rose-900 dark:text-rose-200 bg-white/70 dark:bg-[#162032] border border-rose-200 dark:border-rose-900/40 rounded px-2 py-1 break-words"
                    >
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSecurityDismissed(true)}
              className="bg-white dark:bg-[#162032] border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 px-3 py-1.5 rounded-lg text-xs hover:bg-rose-100 dark:hover:bg-[#1E293B] font-medium cursor-pointer self-end lg:self-start"
            >
              Dismiss Alert
            </button>
          </div>
        </div>
      )}

      {/* Empty State: Shown before any transcript is uploaded */}
      {!processed && !running && (
        <div className="bg-white dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#1E293B] rounded-xl p-8 sm:p-14 text-center flex flex-col items-center justify-center gap-5 shadow-xs my-4 max-w-2xl mx-auto w-full">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-[#3B5BFD] dark:text-blue-400 flex items-center justify-center shadow-2xs border border-blue-100 dark:border-blue-900/40">
            <span className="material-symbols-outlined text-[36px]">record_voice_over</span>
          </div>
          <div className="space-y-2 max-w-lg">
            <h2 className="text-lg font-semibold text-[#111827] dark:text-[#F3F4F6] tracking-tight">
              Upload Meeting Transcript to Begin
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              ActionSwarm processes meeting conversations, extracts verified action items, evaluates security policies, drafts follow-up communications, and connects to peer agents.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#3B5BFD] hover:bg-[#2549ED] px-4 py-2.5 rounded-lg text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              <span>Upload Transcript (.txt, .md)</span>
            </button>
            <button
              type="button"
              onClick={() => runSwarm("Kickoff Transcript (Meridian Bank)")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#F9FAFB] dark:bg-[#131C2E] hover:bg-gray-100 dark:hover:bg-[#1E293B] border border-[#E5E7EB] dark:border-[#1E293B] px-4 py-2.5 rounded-lg text-gray-700 dark:text-gray-200 text-xs font-medium shadow-2xs transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] text-emerald-600">play_circle</span>
              <span>Process Kickoff Transcript</span>
            </button>
          </div>

          <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">
            Accepts raw meeting notes, transcripts, or automated recordings.
          </span>
        </div>
      )}

      {/* Loading state during execution */}
      {running && (
        <div className="bg-white dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#1E293B] rounded-xl p-14 text-center flex flex-col items-center justify-center gap-4 shadow-xs my-4 max-w-xl mx-auto w-full">
          <div className="w-12 h-12 rounded-full border-3 border-[#3B5BFD] border-t-transparent animate-spin"></div>
          <div>
            <h3 className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
              Processing Transcript with ActionSwarm
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Extracting action items, screening for prompt injections, and generating follow-ups...
            </p>
          </div>
        </div>
      )}

      {/* Processed Workstation: ONLY shown once transcript is processed */}
      {processed && tasks.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Tasks Column */}
          <div className="xl:col-span-7 flex flex-col gap-3">
            <div className="flex items-center justify-between bg-white dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#1E293B] px-4 py-2.5 rounded-lg">
              <div className="flex items-center gap-2">
                <h2 className="text-sm text-[#111827] dark:text-[#F3F4F6] font-semibold">Tasks from This Call</h2>
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] rounded font-mono text-[11px] text-gray-700 dark:text-gray-300 font-medium">
                  {tasks.length} Items
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-gray-700 dark:text-gray-300 font-medium">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {readyCount} Ready
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {reviewCount} Review
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {tasks.map((task) => {
                const needs = task.status === "Needs Assignment";
                return (
                  <div
                    key={task.id}
                    className={`border p-4 rounded-xl shadow-xs flex flex-col gap-2.5 ${
                      needs
                        ? "bg-amber-50/40 dark:bg-[#1A1610] border-amber-200 dark:border-amber-900/50"
                        : "bg-white dark:bg-[#0F172A] border-[#E5E7EB] dark:border-[#1E293B]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span className="w-6 h-6 rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-[#3B5BFD] dark:text-blue-400 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5">
                          {task.id}
                        </span>
                        <div>
                          <h3 className="text-xs text-[#111827] dark:text-[#F3F4F6] font-semibold">{task.title}</h3>
                          {task.desc && <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{task.desc}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {task.guard && (
                          <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${guardStyle(task.guard)}`}>
                            Guard: {task.guard}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                            needs
                              ? "text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900/50"
                              : "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50"
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>

                    {needs ? (
                      <div className="bg-white dark:bg-[#0B101D] border border-amber-200 dark:border-amber-900/50 p-2.5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="font-mono text-xs text-amber-700 dark:text-amber-400 font-medium">
                          Needs someone assigned • Due {task.dueDate}
                        </span>
                        {task.id === pending?.id && (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={assigneeSelect}
                              onChange={(e) => setAssigneeSelect(e.target.value)}
                              className="bg-gray-50 dark:bg-[#162032] border border-gray-300 dark:border-[#1E293B] text-[#111827] dark:text-[#F3F4F6] text-xs px-2.5 py-1 rounded-md cursor-pointer"
                            >
                              <option value="">Select Team Member...</option>
                              {TEAM.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={assignPending}
                              disabled={!assigneeSelect}
                              className="bg-[#3B5BFD] hover:bg-[#2549ED] px-3 py-1 rounded-md text-white font-mono text-xs font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-4 pt-1 font-mono text-[11px] bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] p-2 rounded-lg">
                        <span className="text-[#111827] dark:text-[#F3F4F6] font-medium">{task.assignee}</span>
                        <span className="text-gray-500 dark:text-gray-400">Due {task.dueDate}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outbound Column */}
          <div className="xl:col-span-5 flex flex-col gap-3">
            <div className="bg-white dark:bg-[#0F172A] border border-[#E5E7EB] dark:border-[#1E293B] p-4 rounded-xl shadow-xs flex flex-col gap-4">
              <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] rounded-lg">
                {(["email", "slack", "agents"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTab(t)}
                    className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold cursor-pointer ${
                      activeTab === t
                        ? "text-[#3B5BFD] dark:text-blue-400 bg-white dark:bg-[#1E293B] shadow-xs border border-[#E5E7EB] dark:border-[#1E293B]"
                        : "text-gray-600 dark:text-gray-400 hover:text-[#111827] dark:hover:text-[#F3F4F6]"
                    }`}
                  >
                    {t === "email" ? "Client Email" : t === "slack" ? "Slack Post" : "Handoffs"}
                  </button>
                ))}
              </div>

              {activeTab === "email" && (
                <div className="flex flex-col gap-3">
                  <div className="bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] p-3.5 rounded-lg flex flex-col gap-2 text-xs">
                    <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300 space-y-1 pb-2 border-b border-[#E5E7EB] dark:border-[#1E293B]">
                      <div>
                        <span className="text-gray-400 dark:text-gray-500 inline-block w-14">To:</span>
                        {email.to}
                      </div>
                      <div>
                        <span className="text-gray-400 dark:text-gray-500 inline-block w-14">Cc:</span>
                        {email.cc}
                      </div>
                      <div>
                        <span className="text-gray-400 dark:text-gray-500 inline-block w-14">Subject:</span>
                        <span className="text-[#3B5BFD] dark:text-blue-400 font-semibold">{email.subject}</span>
                      </div>
                    </div>
                    {editingEmail ? (
                      <textarea
                        value={email.body}
                        onChange={(e) => {
                          setEmailBodyOverride(e.target.value);
                          setEmailState("idle");
                        }}
                        rows={12}
                        className="bg-white dark:bg-[#090D16] border border-[#E5E7EB] dark:border-[#1E293B] p-3 rounded-md text-xs text-gray-700 dark:text-gray-200 font-mono leading-relaxed focus:outline-none focus:border-[#3B5BFD]"
                      />
                    ) : (
                      <pre className="bg-white dark:bg-[#090D16] border border-[#E5E7EB] dark:border-[#1E293B] p-3 rounded-md text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                        {email.body}
                      </pre>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingEmail((v) => !v)}
                      className="bg-white dark:bg-[#162032] border border-[#E5E7EB] dark:border-[#1E293B] px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-300 text-xs hover:bg-gray-50 dark:hover:bg-[#1E293B] font-medium cursor-pointer"
                    >
                      {editingEmail ? "Done editing" : "Edit"}
                    </button>
                    <button
                      type="button"
                      onClick={sendEmail}
                      disabled={emailState === "sending" || editingEmail}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-60 ${
                        emailState === "done"
                          ? "bg-emerald-600 text-white"
                          : "bg-[#3B5BFD] hover:bg-[#2549ED] text-white"
                      }`}
                    >
                      {emailState === "sending"
                        ? "Sending…"
                        : emailState === "done"
                        ? "Approved ✓"
                        : "Approve & Open in Mail"}
                    </button>
                  </div>
                  {emailState !== "idle" && emailMsg && (
                    <p
                      className={`text-[11px] font-mono ${
                        emailState === "error" ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {emailMsg}
                    </p>
                  )}
                </div>
              )}

              {activeTab === "slack" && (
                <div className="flex flex-col gap-3">
                  <pre className="bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] p-3 rounded-lg text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                    {slackText}
                  </pre>
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-[11px] font-mono ${
                        slackState === "error" ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {slackState === "done" || slackState === "error" ? slackMsg : ""}
                    </p>
                    <button
                      type="button"
                      onClick={pushSlack}
                      disabled={slackState === "sending"}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-60 ${
                        slackState === "done"
                          ? "bg-emerald-600 text-white"
                          : "bg-[#3B5BFD] hover:bg-[#2549ED] text-white"
                      }`}
                    >
                      {slackState === "sending"
                        ? "Posting…"
                        : slackState === "done"
                        ? "Posted ✓"
                        : "Push to Slack"}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "agents" && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded px-2.5 py-1.5 font-mono">
                    Actions automatically coordinated across peer agents based on extracted tasks:
                  </p>
                  {handoffs.map((h, idx) => (
                    <div
                      key={idx}
                      className="bg-[#F9FAFB] dark:bg-[#131C2E] border border-[#E5E7EB] dark:border-[#1E293B] p-3 rounded-lg flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3B5BFD]"></span>
                        <span className="text-xs text-[#111827] dark:text-[#F3F4F6] font-semibold">{h.name}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 font-mono text-[11px]">{h.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
