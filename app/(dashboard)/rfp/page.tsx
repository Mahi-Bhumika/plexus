"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------- API row shapes (match your SQLite tables) ---------- */

type RfpRow = {
  id: string;
  questionnaire_id: string;
  number: number;
  question: string;
  answer: string | null;
  confidence: number;
  status: string;
  source_ref: string | null;
  human_answer: string | null;
  reused_from_fix: number;
};

type QuestionnaireRow = {
  id: string;
  customer: string;
  uploaded_at: string;
  total: number;
};

/* ---------- UI shapes ---------- */

type Status = "flagged" | "error" | "approved";

type Citation = {
  title: string;
  page: string;
  snippet: string;
  weight: string;
  tag: string;
  tagCls: string;
  icon: string;
};

type Question = {
  dbId: string;
  id: number;
  code: string;
  title: string;
  status: Status;
  statusText: string;
  confScore: string;
  confMatch: string;
  flagReason?: string;
  reusedFix?: string;
  summaryNote: string;
  sourceNote: string;
  draft: string;
  fix: string;
  citations: Citation[];
};

type Filter = "all" | Status;

/* ---------- constants & mapping helpers ---------- */

const SAFETY_BAR = 85;
const APPROVER = "Riya Sharma";
const STORAGE_KEY = "plexus.rfp.questionnaireId";

function toPct(c: number | null | undefined): number {
  const v = c ?? 0;
  return Math.round(v <= 1 ? v * 100 : v);
}

function parseCitations(ref: string | null, confPct: number): Citation[] {
  if (!ref) return [];
  let items: unknown[];
  try {
    const parsed = JSON.parse(ref);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = ref
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const weight = `Weight: ${(confPct / 100).toFixed(2)}`;
  const tagCls = "text-emerald-700 bg-emerald-50 border-emerald-200";

  return items.map((it) => {
    if (typeof it !== "object" || it === null) {
      return {
        title: String(it),
        page: "",
        snippet: "",
        weight,
        tag: "Source",
        tagCls,
        icon: "description",
      };
    }
    const o = it as Record<string, unknown>;
    return {
      title: String(o.title ?? o.doc ?? o.document ?? o.source ?? o.name ?? "Source"),
      page: String(o.page ?? o.section ?? ""),
      snippet: String(o.snippet ?? o.text ?? o.quote ?? ""),
      weight,
      tag: "Source",
      tagCls,
      icon: "description",
    };
  });
}

function toQuestion(r: RfpRow): Question {
  const conf = toPct(r.confidence);
  const human = r.human_answer?.trim() ?? "";
  const answer = r.answer?.trim() ?? "";

  let status: Status;
  let statusText: string;
  if (human) {
    status = "approved";
    statusText = "Approved (Human Fix)";
  } else if (r.status === "filled") {
    status = "approved";
    statusText = "Approved";
  } else if (!answer || conf === 0) {
    status = "error";
    statusText = "Missing Answer";
  } else {
    status = "flagged";
    statusText = "Needs Review";
  }

  const citations = parseCitations(r.source_ref, conf);
  const reused = r.reused_from_fix ? "Reused a saved human fix" : undefined;

  let flagReason: string | undefined;
  if (status === "flagged") {
    flagReason = `Confidence ${conf}% is below the ${SAFETY_BAR}% safety bar`;
  } else if (status === "error") {
    flagReason = "No supporting answer found in the knowledge base";
  }

  let summaryNote: string;
  if (human) summaryNote = "Answer confirmed by a human reviewer";
  else if (reused) summaryNote = reused;
  else if (flagReason) summaryNote = flagReason;
  else summaryNote = citations[0]?.title ?? "Auto-filled from company docs";

  return {
    dbId: r.id,
    id: r.number,
    code: `Q-${String(r.number).padStart(2, "0")}`,
    title: r.question,
    status,
    statusText,
    confScore: `${conf}%`,
    confMatch: human ? "100% verified" : `${conf}% match`,
    flagReason,
    reusedFix: reused,
    summaryNote,
    sourceNote: r.source_ref ? "Source attached" : "No source attached",
    draft: answer,
    fix: human || answer,
    citations,
  };
}

function guessCustomer(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.includes("meridian")) return "Meridian Bank";
  if (n.includes("aegis")) return "Aegis Life";
  return fileName.replace(/\.xlsx$/i, "");
}

const STATUS_ORDER: Record<Status, number> = { error: 0, flagged: 1, approved: 2 };

/* ---------- page ---------- */

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${res.status} from ${res.url}: ${text.slice(0, 120).replace(/\s+/g, " ")}`,
    );
  }
}

export default function RfpPage() {
  const [qid, setQid] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireRow | null>(null);
  const [rows, setRows] = useState<RfpRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [humanInput, setHumanInput] = useState<string>("");
  const [rememberMemory, setRememberMemory] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string, ms = 4000) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), ms);
  }, []);

  /* ----- load questionnaire + questions from GET /api/rfp/[id] ----- */

  const load = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/${id}`, { cache: "no-store" });
      const data = await readJson(res);
      if (res.status === 404) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        setQid(null);
        setQuestionnaire(null);
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to load questionnaire");
      setQuestionnaire(data.questionnaire as QuestionnaireRow);
      setRows(data.questions as RfpRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    const id = fromUrl || stored;
    if (id) {
      setQid(id);
      load(id);
    } else {
      setLoading(false);
    }
  }, [load]);

  /* ----- derived data ----- */

  const questions = useMemo(() => rows.map(toQuestion), [rows]);

  const counts = useMemo(
    () => ({
      all: questions.length,
      approved: questions.filter((q) => q.status === "approved").length,
      flagged: questions.filter((q) => q.status === "flagged").length,
      error: questions.filter((q) => q.status === "error").length,
    }),
    [questions],
  );

  const pct = (n: number) => (counts.all ? (n / counts.all) * 100 : 0);

  const filteredQuestions = useMemo(
    () =>
      questions
        .filter((q) => (filter === "all" ? true : q.status === filter))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id - b.id),
    [questions, filter],
  );

  const currentQ = selectedId ? questions.find((q) => q.dbId === selectedId) ?? null : null;

  /* ----- handlers ----- */

  const handleSelect = (q: Question) => {
    if (selectedId === q.dbId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(q.dbId);
    setHumanInput(q.fix);
    setToastMessage(null);
  };

  const handleClose = () => {
    setSelectedId(null);
    setToastMessage(null);
  };

  const handleRefresh = async () => {
    if (!qid) return;
    setIsRefreshing(true);
    await load(qid, true);
    setIsRefreshing(false);
    showToast("Reloaded questions from the database.", 3000);
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("customer", guessCustomer(file.name));
      const res = await fetch("/api/rfp/upload", { method: "POST", body: fd });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      const id = data.questionnaireId as string;
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {}
      setQid(id);
      setSelectedId(null);
      await load(id);
      showToast(
        `Processed ${data.total} questions: ${data.filled} filled, ${data.flagged} flagged.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUploading(false);
    }
  };

  const saveAnswer = async (answer: string) => {
    if (!currentQ || !qid) return;
    setIsCommitting(true);
    setError(null);
    try {
      if (rememberMemory) {
        // Saves the human answer AND writes the RFP_FIX memory
        const res = await fetch("/api/rfp/fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: currentQ.dbId,
            answer,
            approver: APPROVER,
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        showToast(
          data.fallback
            ? `${currentQ.code} saved, but memory used fallback storage.`
            : `${currentQ.code} saved and written to memory${
                data.memoryId ? ` (${data.memoryId})` : ""
              }.`,
        );
      } else {
        // Saves the answer to this questionnaire only, no memory write
        const res = await fetch(`/api/rfp/${qid}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: currentQ.dbId, humanAnswer: answer }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        showToast(`${currentQ.code} saved to this workbook only (not remembered).`);
      }
      await load(qid, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCommitting(false);
    }
  };

  const handleResetToAgent = () => {
    if (currentQ) setHumanInput(currentQ.draft);
  };

  /* ---------- render ---------- */

  const hasData = !!qid && !!questionnaire;

  return (
    <div className="px-6 py-6 pb-20 max-w-[1400px] mx-auto flex flex-col gap-5">
      {/* HEADER BANNER & ACTION BAR */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#3B5BFD]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#3B5BFD] font-mono text-[10px] font-medium tracking-wide uppercase">
                Agent Evaluation Review
              </span>
              {hasData && (
                <>
                  <span className="text-gray-400 text-xs">•</span>
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 font-mono">
                    <span className="material-symbols-outlined text-[14px] text-emerald-600">
                      verified
                    </span>
                    <span className="text-[#111827] font-medium">
                      {questionnaire.customer}
                    </span>
                  </div>
                  <span className="px-1.5 py-0.2 rounded bg-[#F3F4F6] border border-[#E5E7EB] text-gray-500 text-[10px] font-mono">
                    {questionnaire.total} Questions
                  </span>
                </>
              )}
            </div>
            <div className="flex items-baseline gap-3 pt-0.5">
              <h1 className="text-xl font-semibold text-[#111827] tracking-tight">
                Security Questionnaire Review
              </h1>
              {hasData && (
                <span className="text-gray-400 text-xs hidden md:inline">
                  Automatic answers for {questionnaire.customer} ({questionnaire.total}{" "}
                  questions total)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-400 font-mono text-[11px] pt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Engine: Gemini
              </span>
              <span>/</span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="material-symbols-outlined text-[13px] text-[#3B5BFD]">
                  database
                </span>
                Meko Knowledge Base
              </span>
              {hasData && (
                <>
                  <span>/</span>
                  <span>
                    Uploaded: {new Date(questionnaire.uploaded_at).toLocaleString()}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3 py-1.5 rounded-md bg-white hover:bg-[#F3F4F6] border border-[#E5E7EB] hover:border-gray-400 text-gray-600 hover:text-[#111827] text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[15px] text-gray-400 ${
                  isUploading ? "animate-spin" : ""
                }`}
              >
                {isUploading ? "sync" : "upload_file"}
              </span>
              <span>{isUploading ? "Processing..." : "Upload Form"}</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!qid || isRefreshing}
              className="px-3 py-1.5 rounded-md bg-white hover:bg-[#F3F4F6] border border-[#E5E7EB] hover:border-gray-400 text-gray-600 hover:text-[#111827] text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[15px] text-amber-600 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              >
                autorenew
              </span>
              <span>
                {isRefreshing ? "Reloading..." : `Reload Flagged (${counts.flagged})`}
              </span>
            </button>
            {qid ? (
              <a
                href={`/api/rfp/${qid}/download`}
                className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Download Completed Excel</span>
              </a>
            ) : (
              <span className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD]/50 text-white text-xs font-medium flex items-center gap-1.5 cursor-not-allowed">
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Download Completed Excel</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-mono text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-rose-600">error</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-800 cursor-pointer"
            aria-label="Dismiss error"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* TOAST (page level, visible even when the panel is closed) */}
      {toastMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-xs flex items-center gap-2 transition-all">
          <span className="material-symbols-outlined text-[16px] text-emerald-600">
            verified
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* EMPTY / LOADING STATES */}
      {loading && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-10 text-center text-xs font-mono text-gray-500 shadow-sm">
          Loading questionnaire...
        </div>
      )}

      {!loading && !qid && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-[32px] text-gray-400">
            upload_file
          </span>
          <p className="text-sm font-medium text-[#111827]">No questionnaire loaded</p>
          <p className="text-xs text-gray-500">
            Upload an .xlsx questionnaire and the agent will fill it in.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
          >
            {isUploading ? "Processing..." : "Upload Form"}
          </button>
        </div>
      )}

      {hasData && !loading && (
        <>
          {/* STATS ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
                  Total In Scope
                </span>
                <span className="material-symbols-outlined text-[15px]">ballot</span>
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-mono text-xl font-semibold text-[#111827]">
                  {counts.all}
                </span>
                <span className="font-mono text-[10px] text-gray-400">All found in file</span>
              </div>
              <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden mt-2.5">
                <div className="bg-[#3B5BFD] h-full w-full rounded-full"></div>
              </div>
            </div>

            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
                  Ready to Submit
                </span>
                <span className="material-symbols-outlined text-[15px] text-emerald-600">
                  check_circle
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-mono text-xl font-semibold text-emerald-600">
                  {counts.approved}
                </span>
                <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-medium">
                  Confident & verified
                </span>
              </div>
              <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden mt-2.5">
                <div
                  className="bg-emerald-500 h-full rounded-full shadow-[0_0_6px_rgba(16,185,129,0.3)]"
                  style={{ width: `${pct(counts.approved)}%` }}
                ></div>
              </div>
            </div>

            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
                  Need a Quick Look
                </span>
                <span className="material-symbols-outlined text-[15px] text-amber-600">
                  warning
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-mono text-xl font-semibold text-amber-600">
                  {counts.flagged}
                </span>
                <span className="font-mono text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded font-medium">
                  Below safety bar
                </span>
              </div>
              <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden mt-2.5">
                <div
                  className="bg-amber-500 h-full rounded-full shadow-[0_0_6px_rgba(245,158,11,0.3)]"
                  style={{ width: `${pct(counts.flagged)}%` }}
                ></div>
              </div>
            </div>

            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
                  Missing Info
                </span>
                <span className="material-symbols-outlined text-[15px] text-rose-600">
                  error
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-mono text-xl font-semibold text-rose-600">
                  {counts.error}
                </span>
                <span className="font-mono text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1 py-0.2 rounded font-medium">
                  Needs input
                </span>
              </div>
              <div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden mt-2.5">
                <div
                  className="bg-rose-500 h-full rounded-full shadow-[0_0_6px_rgba(239,68,68,0.3)]"
                  style={{ width: `${pct(counts.error)}%` }}
                ></div>
              </div>
            </div>

            <div className="col-span-2 md:col-span-4 lg:col-span-1 rounded-lg border border-[#E5E7EB] bg-white p-3.5 flex flex-col justify-between hover:border-gray-400 transition-all shadow-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span className="text-[10px] font-mono uppercase tracking-wider font-medium">
                  Confidence Bar
                </span>
                <span className="px-1 py-0.2 rounded bg-blue-50 text-[#3B5BFD] font-mono text-[10px] border border-blue-200">
                  {SAFETY_BAR}% Safety
                </span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-xl font-semibold text-[#111827]">
                    {SAFETY_BAR}%
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">Floor</span>
                </div>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-medium">
                  Safe Lock
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400 mt-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>High-accuracy safety limit</span>
              </div>
            </div>
          </div>

          {/* MAIN SPLIT WORKSPACE */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* LEFT COLUMN: QUESTION QUEUE */}
            <div
              className={`flex flex-col gap-2.5 ${
                currentQ ? "xl:col-span-5" : "xl:col-span-12"
              }`}
            >
              {/* Filter Bar */}
              <div className="rounded-lg border border-[#E5E7EB] bg-white p-1.5 flex items-center justify-between shadow-sm flex-wrap gap-2">
                <div className="flex items-center gap-1 bg-[#F3F4F6] p-0.5 rounded-md border border-[#E5E7EB]">
                  {(
                    [
                      ["all", `All (${counts.all})`, null],
                      ["flagged", `Needs Review (${counts.flagged})`, "bg-amber-500"],
                      ["error", `Missing (${counts.error})`, "bg-rose-500"],
                      ["approved", `Approved (${counts.approved})`, "bg-emerald-500"],
                    ] as Array<[Filter, string, string | null]>
                  ).map(([key, label, dot]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={`px-2 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
                        filter === key
                          ? "font-medium text-[#111827] bg-white shadow-sm"
                          : "font-normal text-gray-600 hover:text-[#111827]"
                      }`}
                    >
                      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>}
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-gray-400 font-mono text-[11px] pr-1.5">
                  <span className="material-symbols-outlined text-[14px]">sort</span>
                  <span>Risk first</span>
                </div>
              </div>

              {/* List Cards */}
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[780px] pr-0.5">
                {filteredQuestions.length === 0 && (
                  <div className="rounded-lg border border-[#E5E7EB] bg-white p-6 text-center text-xs text-gray-500">
                    No questions in this tab.
                  </div>
                )}
                {filteredQuestions.map((q) => {
                  const isSelected = q.dbId === selectedId;
                  return (
                    <div
                      key={q.dbId}
                      onClick={() => handleSelect(q)}
                      className={`rounded-lg p-3.5 cursor-pointer transition-all shadow-sm border ${
                        isSelected
                          ? "bg-white border-[#3B5BFD] shadow-[0_0_0_1px_#3B5BFD,0_4px_14px_-2px_rgba(59,91,253,0.12)]"
                          : "bg-white border-[#E5E7EB] hover:border-slate-300 hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.2 rounded bg-blue-50 border border-blue-200 text-[#3B5BFD] font-mono text-[11px] font-semibold">
                            {q.code}
                          </span>
                          {q.status === "flagged" && (
                            <span className="px-2 py-0.2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-mono text-[10px] font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              {q.statusText}
                            </span>
                          )}
                          {q.status === "error" && (
                            <span className="px-2 py-0.2 rounded-full bg-rose-50 border border-rose-200 text-rose-700 font-mono text-[10px] font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                              {q.statusText}
                            </span>
                          )}
                          {q.status === "approved" && (
                            <span className="px-2 py-0.2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              {q.statusText}
                            </span>
                          )}
                          {q.reusedFix && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-50 border border-blue-200 text-[#3B5BFD] font-mono text-[10px]">
                              Reused Fix
                            </span>
                          )}
                        </div>
                        <span
                          className={`font-mono text-xs font-semibold ${
                            q.status === "approved"
                              ? "text-emerald-700"
                              : q.status === "error"
                              ? "text-rose-700"
                              : "text-amber-700"
                          }`}
                        >
                          {q.confMatch}
                        </span>
                      </div>

                      <p className="text-xs font-medium text-[#111827] leading-snug line-clamp-2">
                        {q.title}
                      </p>

                      {q.flagReason && q.status !== "approved" ? (
                        <div className="mt-2 p-1.5 rounded bg-amber-50/60 border border-amber-200 text-amber-800 font-mono text-[11px] flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px] shrink-0 text-amber-600">
                            report_problem
                          </span>
                          <span className="truncate">{q.flagReason}</span>
                        </div>
                      ) : (
                        <div className="mt-2 text-gray-400 font-mono text-[11px] flex items-center justify-between">
                          <span className="text-gray-600 truncate">{q.summaryNote}</span>
                          <span className="shrink-0 text-gray-400 ml-2">Synced</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT COLUMN: INSPECTOR & HUMAN WORKBENCH */}
            {currentQ && (
              <div className="xl:col-span-7 flex flex-col gap-4">
                <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm flex flex-col gap-5">
                  {/* Question Header */}
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5E7EB]">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-[#3B5BFD] text-white font-mono text-xs font-bold">
                          Review Question #{currentQ.id}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-medium flex items-center gap-1.5 ${
                            currentQ.status === "approved"
                              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                              : currentQ.status === "error"
                              ? "bg-rose-50 border border-rose-200 text-rose-700"
                              : "bg-amber-50 border border-amber-200 text-amber-700"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              currentQ.status === "approved"
                                ? "bg-emerald-500"
                                : currentQ.status === "error"
                                ? "bg-rose-500"
                                : "bg-amber-500"
                            }`}
                          ></span>
                          {currentQ.statusText}
                        </span>
                        <span className="text-gray-400 font-mono text-xs">
                          {currentQ.sourceNote}
                        </span>
                      </div>
                      <h2 className="text-base font-semibold text-[#111827] mt-1 leading-snug">
                        {currentQ.title}
                      </h2>
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-right bg-[#F3F4F6] border border-[#E5E7EB] px-3 py-2 rounded-lg">
                        <span className="text-[10px] font-mono uppercase text-gray-400 tracking-wider block">
                          AI Confidence
                        </span>
                        <span
                          className={`font-mono text-lg font-bold ${
                            currentQ.status === "approved"
                              ? "text-emerald-600"
                              : currentQ.status === "error"
                              ? "text-rose-600"
                              : "text-amber-600"
                          }`}
                        >
                          {currentQ.confScore}
                        </span>
                        <span className="font-mono text-[10px] text-gray-400 block">
                          {currentQ.status === "approved"
                            ? "Safe lock verified"
                            : `Below ${SAFETY_BAR}% safety bar`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClose}
                        aria-label="Close review panel"
                        className="p-1.5 rounded-md text-gray-400 hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  </div>

                  {/* Flag Banner */}
                  {currentQ.flagReason && currentQ.status !== "approved" && (
                    <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-amber-800">
                          <span className="material-symbols-outlined text-[16px] text-amber-600">
                            find_in_page
                          </span>
                          Flagged for Review
                        </span>
                        <span className="font-mono text-[10px] text-amber-700 bg-amber-100/70 border border-amber-200 px-1.5 py-0.2 rounded font-medium">
                          AI Check
                        </span>
                      </div>
                      <p className="text-xs text-amber-900/90 leading-relaxed pt-0.5">
                        {currentQ.flagReason}
                      </p>
                    </div>
                  )}

                  {/* AI Suggested Answer */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">
                        AI Suggested Answer
                      </span>
                      <span className="font-mono text-[11px] text-[#3B5BFD] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">
                          psychology
                        </span>
                        Generated from company docs
                      </span>
                    </div>
                    <div className="p-3.5 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB] text-xs text-gray-700 leading-relaxed font-sans">
                      {currentQ.draft || "No answer was generated for this question."}
                    </div>
                  </div>

                  {/* Citations */}
                  {currentQ.citations.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">
                        Grounding Citations &amp; Evidence
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {currentQ.citations.map((cite, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg bg-white border border-[#E5E7EB] hover:border-gray-400 transition-all flex flex-col justify-between shadow-sm"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1.5 gap-2">
                                <span className="font-mono text-xs text-[#3B5BFD] flex items-center gap-1 font-medium break-all">
                                  <span className="material-symbols-outlined text-[14px] shrink-0">
                                    {cite.icon}
                                  </span>
                                  [{i + 1}] {cite.title}
                                </span>
                                {cite.page && (
                                  <span className="font-mono text-[10px] text-gray-400 shrink-0">
                                    {cite.page}
                                  </span>
                                )}
                              </div>
                              {cite.snippet && (
                                <p className="font-mono text-[11px] text-gray-600 line-clamp-2">
                                  {cite.snippet}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#E5E7EB] font-mono text-[10px] text-gray-400">
                              <span>{cite.weight}</span>
                              <span
                                className={`font-medium px-1 py-0.2 rounded border ${cite.tagCls}`}
                              >
                                {cite.tag}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Human Fix Workbench */}
                  <div className="p-4 rounded-xl bg-[#F3F4F6] border border-gray-300 flex flex-col gap-3 shadow-inner">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-[#3B5BFD]">
                          edit_note
                        </span>
                        <span className="text-xs font-semibold text-[#111827]">
                          Your Final Answer (What will go in the Excel sheet):
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetToAgent}
                        className="text-gray-500 hover:text-[#111827] font-mono text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[13px]">undo</span>
                        Reset to AI suggestion
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Edit the final wording if needed before it gets saved into the customer
                      workbook:
                    </p>
                    <textarea
                      value={humanInput}
                      onChange={(e) => setHumanInput(e.target.value)}
                      className="w-full bg-white text-[#111827] p-3 rounded-lg font-mono text-xs border border-[#E5E7EB] focus:border-[#3B5BFD] focus:ring-1 focus:ring-[#3B5BFD] focus:outline-none resize-y leading-relaxed shadow-sm"
                      rows={4}
                    />
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberMemory}
                          onChange={(e) => setRememberMemory(e.target.checked)}
                          className="w-3.5 h-3.5 rounded bg-white border-gray-400 text-[#3B5BFD] focus:ring-0"
                        />
                        <span className="text-xs text-gray-600 hover:text-[#111827] transition-colors">
                          Remember this answer for future bank forms
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setHumanInput(currentQ.draft);
                            saveAnswer(currentQ.draft);
                          }}
                          disabled={isCommitting || !currentQ.draft}
                          className="px-3 py-1.5 rounded-md bg-white hover:bg-gray-100 border border-[#E5E7EB] text-gray-700 hover:text-[#111827] text-xs font-medium transition-all shadow-sm cursor-pointer disabled:opacity-60"
                        >
                          Keep AI Answer
                        </button>
                        <button
                          type="button"
                          onClick={() => saveAnswer(humanInput)}
                          disabled={isCommitting || !humanInput.trim()}
                          className="px-3.5 py-1.5 rounded-md bg-[#3B5BFD] hover:bg-[#2549ED] text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-60"
                        >
                          <span
                            className={`material-symbols-outlined text-[15px] ${
                              isCommitting ? "animate-spin" : ""
                            }`}
                          >
                            {isCommitting ? "sync" : "check"}
                          </span>
                          <span>
                            {isCommitting ? "Saving..." : "Save & Update Memory"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}