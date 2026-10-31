"use client";

import { useEffect, useState } from "react";

type RfpQuestion = {
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

type Questionnaire = {
  id: string;
  customer: string;
  uploaded_at: string;
  total: number;
};

type DrawerState = {
  question: RfpQuestion;
  humanAnswer: string;
  saving: boolean;
  saved: boolean;
};

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return "text-emerald-400";
  if (confidence >= 0.6) return "text-amber-400";
  return "text-rose-400";
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "—";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

export function RfpGrid({ questionnaireId }: { questionnaireId: string }) {
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(
    null,
  );
  const [questions, setQuestions] = useState<RfpQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/rfp/${questionnaireId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          questionnaire: Questionnaire;
          questions: RfpQuestion[];
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
  }, [questionnaireId]);

  function openDrawer(q: RfpQuestion) {
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

  async function submitHumanFix() {
    if (!drawer) return;
    setDrawer((prev) => prev && { ...prev, saving: true });

    try {
      await fetch(`/api/rfp/${questionnaireId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: drawer.question.id,
          humanAnswer: drawer.humanAnswer,
        }),
      });

      // Update local state
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === drawer.question.id
            ? { ...q, human_answer: drawer.humanAnswer }
            : q,
        ),
      );
      setDrawer((prev) => prev && { ...prev, saving: false, saved: true });
    } catch {
      setDrawer((prev) => prev && { ...prev, saving: false });
    }
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
          <div className="text-xs text-zinc-500 font-mono">
            {questionnaire.customer} · {questionnaire.total} questions
          </div>
          <div className="text-xs text-zinc-600">
            {new Date(questionnaire.uploaded_at).toLocaleString()}
          </div>
        </div>
        <a
          href={`/api/rfp/${questionnaireId}/download`}
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
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium w-20">
                Status
              </th>
              <th className="text-left px-3 py-2.5 text-zinc-400 font-medium">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const isFlagged = q.status === "flagged";
              const displayAnswer = q.human_answer ?? q.answer;
              return (
                <tr
                  key={q.id}
                  onClick={() => openDrawer(q)}
                  className={`border-b border-zinc-800/50 cursor-pointer transition-colors hover:bg-zinc-800/40 ${
                    isFlagged ? "bg-rose-950/20" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-500 font-mono">
                    {q.number}
                  </td>
                  <td className="px-3 py-2 text-zinc-200 max-w-[220px]">
                    {truncate(q.question, 80)}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 max-w-[220px]">
                    {truncate(displayAnswer, 80)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`font-mono font-semibold ${confidenceColor(q.confidence)}`}
                    >
                      {Math.round(q.confidence * 100)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        isFlagged
                          ? "bg-rose-900/40 text-rose-400 border border-rose-800/50"
                          : "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50"
                      }`}
                    >
                      {q.status}
                    </span>
                    {q.reused_from_fix === 1 && (
                      <span className="ml-1 text-indigo-400 text-[10px]">
                        ✓fix
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 font-mono max-w-[120px] truncate">
                    {q.source_ref ?? "—"}
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
            className="absolute inset-0 bg-black/60"
            onClick={closeDrawer}
          />

          {/* Drawer panel */}
          <div className="relative z-10 w-full max-w-lg h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <div>
                <span className="text-zinc-400 text-xs font-mono">
                  Q{drawer.question.number}
                </span>
                <span
                  className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                    drawer.question.status === "flagged"
                      ? "bg-rose-900/40 text-rose-400 border border-rose-800/50"
                      : "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50"
                  }`}
                >
                  {drawer.question.status}
                </span>
              </div>
              <button
                onClick={closeDrawer}
                className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4 flex-1">
              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">
                  Question
                </div>
                <div className="text-sm text-zinc-200 leading-relaxed">
                  {drawer.question.question}
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">
                  Agent Answer
                </div>
                <div className="text-sm text-zinc-300 leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800">
                  {drawer.question.answer ?? (
                    <span className="text-zinc-600 italic">No answer</span>
                  )}
                </div>
              </div>

              {drawer.question.source_ref && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">
                    Source
                  </div>
                  <div className="text-xs font-mono text-indigo-400">
                    {drawer.question.source_ref}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">
                  Confidence
                </div>
                <div
                  className={`text-sm font-mono font-semibold ${confidenceColor(drawer.question.confidence)}`}
                >
                  {Math.round(drawer.question.confidence * 100)}%
                </div>
              </div>

              {/* Human Fix */}
              <div className="pt-2 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide">
                  Human Fix
                </div>
                <textarea
                  value={drawer.humanAnswer}
                  onChange={(e) =>
                    setDrawer((prev) =>
                      prev && { ...prev, humanAnswer: e.target.value, saved: false },
                    )
                  }
                  rows={4}
                  placeholder="Type corrected answer…"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  onClick={() => void submitHumanFix()}
                  disabled={drawer.saving}
                  className="mt-2 w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
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
      )}
    </div>
  );
}
