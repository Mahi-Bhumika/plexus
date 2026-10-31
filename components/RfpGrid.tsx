"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, X, Check } from "lucide-react";
import { MockRfpQuestion } from "@/lib/mockRfp";

export type RfpQuestionItem = {
  id: string;
  questionnaire_id: string;
  number: number;
  question: string;
  answer: string | null;
  confidence: number;
  status: string; // "filled" | "flagged" | "error" | etc.
  source_title?: string | null;
  source_snippet?: string | null;
  source_ref: string | null;
  human_answer: string | null;
  approved_by?: string | null;
  error_message?: string | null;
  reused_from_fix: number;
};

type Questionnaire = {
  id: string;
  customer: string;
  uploaded_at: string;
  total: number;
};

type DrawerState = {
  question: RfpQuestionItem;
  humanAnswer: string;
  saving: boolean;
  saved: boolean;
};

function confidenceColor(confidence: number, status: string): string {
  if (status === "error") return "text-rose-400";
  if (confidence >= 0.85) return "text-emerald-400";
  if (confidence >= 0.6) return "text-amber-400";
  return "text-rose-400";
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "—";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

export function RfpGrid({
  questionnaireId,
  initialQuestions,
  onQuestionsChange,
}: {
  questionnaireId: string;
  initialQuestions?: RfpQuestionItem[];
  onQuestionsChange?: (questions: RfpQuestionItem[]) => void;
}) {
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(
    questionnaireId.startsWith("mock")
      ? {
          id: questionnaireId,
          customer: "Meridian Bank (Mock Mode)",
          uploaded_at: new Date().toISOString(),
          total: initialQuestions?.length ?? 10,
        }
      : null,
  );
  const [questions, setQuestions] = useState<RfpQuestionItem[]>(
    initialQuestions ?? [],
  );
  const [loading, setLoading] = useState(!initialQuestions);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  useEffect(() => {
    if (initialQuestions) {
      setQuestions(initialQuestions);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/rfp/${questionnaireId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          questionnaire: Questionnaire;
          questions: RfpQuestionItem[];
        }>;
      })
      .then((data) => {
        setQuestionnaire(data.questionnaire);
        setQuestions(data.questions);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [questionnaireId, initialQuestions]);

  function updateQuestion(updated: RfpQuestionItem) {
    const next = questions.map((q) => (q.id === updated.id ? updated : q));
    setQuestions(next);
    onQuestionsChange?.(next);
  }

  function openDrawer(q: RfpQuestionItem) {
    setDrawer({
      question: q,
      humanAnswer: q.human_answer ?? q.answer ?? "",
      saving: false,
      saved: false,
    });
  }

  function closeDrawer() {
    setDrawer(null);
  }

  async function handleApprove(approverName = "Riya Sharma") {
    if (!drawer) return;
    const currentQ = drawer.question;
    const updated: RfpQuestionItem = {
      ...currentQ,
      status: "filled",
      confidence: Math.max(currentQ.confidence, 1.0),
      human_answer: drawer.humanAnswer || currentQ.answer,
      approved_by: approverName,
      error_message: null,
    };

    updateQuestion(updated);
    setDrawer((prev) =>
      prev
        ? {
            ...prev,
            question: updated,
            saved: true,
          }
        : null,
    );

    if (!questionnaireId.startsWith("mock")) {
      try {
        await fetch(`/api/rfp/${questionnaireId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: currentQ.id,
            humanAnswer: drawer.humanAnswer || currentQ.answer,
            status: "filled",
            approvedBy: approverName,
          }),
        });
      } catch (e) {
        console.error("Failed to sync approval", e);
      }
    }
  }

  async function submitHumanFix() {
    if (!drawer) return;
    setDrawer((prev) => prev && { ...prev, saving: true });

    const currentQ = drawer.question;
    const updated: RfpQuestionItem = {
      ...currentQ,
      human_answer: drawer.humanAnswer,
      status: "filled",
      approved_by: "Human Override",
      error_message: null,
    };

    updateQuestion(updated);

    if (!questionnaireId.startsWith("mock")) {
      try {
        await fetch(`/api/rfp/${questionnaireId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: currentQ.id,
            humanAnswer: drawer.humanAnswer,
          }),
        });
      } catch (e) {
        console.error("Failed to submit fix", e);
      }
    }

    setDrawer((prev) =>
      prev && {
        ...prev,
        question: updated,
        saving: false,
        saved: true,
      },
    );
  }

  if (loading) {
    return (
      <div className="text-zinc-400 text-sm p-4">Loading questionnaire…</div>
    );
  }

  if (error) {
    return <div className="text-rose-400 text-sm p-4">Error: {error}</div>;
  }

  if (!questionnaire) {
    return null;
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-zinc-400 font-mono">
            {questionnaire.customer} · {questions.length} questions
          </div>
          <div className="text-xs text-zinc-500">
            {new Date(questionnaire.uploaded_at).toLocaleString()}
          </div>
        </div>
        <a
          href={
            questionnaireId.startsWith("mock")
              ? "#"
              : `/api/rfp/${questionnaireId}/download`
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
        >
          ↓ Download Filled XLSX
        </a>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium w-10">
                ID
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium">
                Question
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium">
                Answer
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium w-20">
                Confidence
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium w-28">
                Status
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const isError = q.status === "error";
              const isFlagged = q.status === "flagged";
              const isFilled = q.status === "filled" || (!isError && !isFlagged);
              const displayAnswer = q.human_answer ?? q.answer;
              const sourceLabel = q.source_title ?? q.source_ref ?? "No source";

              let rowBg = "";
              if (isError) rowBg = "bg-red-950/20";
              else if (isFlagged) rowBg = "bg-amber-950/20";
              else if (q.approved_by) rowBg = "bg-emerald-950/20";

              return (
                <tr
                  key={q.id}
                  onClick={() => openDrawer(q)}
                  className={`border-b border-zinc-800/50 cursor-pointer transition-colors hover:bg-zinc-800/40 ${rowBg}`}
                >
                  <td className="px-3 py-2 text-zinc-500 font-mono">
                    {q.number}
                  </td>
                  <td className="px-3 py-2 text-zinc-200 max-w-[220px]">
                    {truncate(q.question, 80)}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 max-w-[220px]">
                    {isError ? (
                      <span className="text-red-400/90 italic">
                        {truncate(q.error_message || "Error processing question", 60)}
                      </span>
                    ) : (
                      truncate(displayAnswer, 80)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`font-mono font-semibold ${confidenceColor(q.confidence, q.status)}`}
                    >
                      {Math.round(q.confidence * 100)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {isError ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-red-900/40 text-red-400 border border-red-800/50">
                        <AlertCircle className="w-3 h-3" />
                        Error
                      </span>
                    ) : isFlagged ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-900/40 text-amber-400 border border-amber-800/50">
                        <AlertTriangle className="w-3 h-3" />
                        Flagged
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-emerald-900/40 text-emerald-400 border border-emerald-800/50">
                        <CheckCircle2 className="w-3 h-3" />
                        Done
                      </span>
                    )}

                    {q.approved_by && (
                      <div className="text-[10px] text-emerald-400 font-medium mt-0.5">
                        approved by {q.approved_by}
                      </div>
                    )}
                    {q.reused_from_fix === 1 && (
                      <span className="ml-1 text-indigo-400 text-[10px]">
                        ✓fix
                      </span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-zinc-400 font-medium max-w-[150px] truncate"
                    title={sourceLabel}
                  >
                    {sourceLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Details Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex items-end justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeDrawer}
          />

          {/* Drawer panel */}
          <div className="relative z-10 w-full max-w-lg h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 text-xs font-mono font-bold">
                  Q{drawer.question.number}
                </span>

                {drawer.question.status === "error" ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-red-900/40 text-red-400 border border-red-800/50">
                    <AlertCircle className="w-3 h-3" />
                    Error
                  </span>
                ) : drawer.question.status === "flagged" ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-900/40 text-amber-400 border border-amber-800/50">
                    <AlertTriangle className="w-3 h-3" />
                    Flagged
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-emerald-900/40 text-emerald-400 border border-emerald-800/50">
                    <CheckCircle2 className="w-3 h-3" />
                    Done
                  </span>
                )}

                {drawer.question.approved_by && (
                  <span className="text-xs text-emerald-400 font-medium">
                    (approved by {drawer.question.approved_by})
                  </span>
                )}
              </div>
              <button
                onClick={closeDrawer}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 flex-1">
              {/* Error Message if present */}
              {drawer.question.status === "error" && drawer.question.error_message && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs leading-relaxed">
                  <div className="font-semibold flex items-center gap-1 text-red-400 mb-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Agent Error / Unresolved
                  </div>
                  {drawer.question.error_message}
                </div>
              )}

              {/* Question */}
              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide font-medium">
                  Question
                </div>
                <div className="text-sm text-zinc-200 leading-relaxed font-medium">
                  {drawer.question.question}
                </div>
              </div>

              {/* Agent Answer */}
              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide font-medium">
                  Agent Answer
                </div>
                <div className="text-sm text-zinc-300 leading-relaxed bg-zinc-900/80 rounded-lg p-3 border border-zinc-800">
                  {drawer.question.answer ?? (
                    <span className="text-zinc-500 italic">No answer generated</span>
                  )}
                </div>
              </div>

              {/* Confidence & Status */}
              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide font-medium">
                  Confidence
                </div>
                <div
                  className={`text-sm font-mono font-semibold ${confidenceColor(
                    drawer.question.confidence,
                    drawer.question.status,
                  )}`}
                >
                  {Math.round(drawer.question.confidence * 100)}%
                </div>
              </div>

              {/* Closest Source & Snippet */}
              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide font-medium">
                  Closest Source
                </div>
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                  <div className="text-xs font-semibold text-indigo-400 mb-1">
                    {drawer.question.source_title ?? drawer.question.source_ref ?? "No source available"}
                  </div>
                  {drawer.question.source_snippet ? (
                    <div className="text-xs text-zinc-400 leading-relaxed font-mono whitespace-pre-wrap bg-zinc-950/50 p-2 rounded border border-zinc-800/80">
                      {drawer.question.source_snippet}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500 italic">
                      No snippet available for this citation.
                    </div>
                  )}
                </div>
              </div>

              {/* Human Override & Approve */}
              <div className="pt-3 border-t border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-zinc-500 uppercase tracking-wide font-medium">
                    Human Override / Edit Answer
                  </div>
                </div>

                <textarea
                  value={drawer.humanAnswer}
                  onChange={(e) =>
                    setDrawer((prev) =>
                      prev && { ...prev, humanAnswer: e.target.value, saved: false },
                    )
                  }
                  rows={4}
                  placeholder="Type corrected or customized answer…"
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500 transition-colors"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => void handleApprove("Riya Sharma")}
                    className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Answer
                  </button>

                  <button
                    onClick={() => void submitHumanFix()}
                    disabled={drawer.saving}
                    className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {drawer.saving
                      ? "Saving…"
                      : drawer.saved
                        ? "✓ Saved"
                        : "Submit Fix"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
