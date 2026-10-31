"use client";

import { useRef, useState } from "react";
import { RfpGrid, RfpQuestionItem } from "@/components/RfpGrid";
import { MOCK_MERIDIAN_QUESTIONS } from "@/lib/mockRfp";
import { Sparkles, UploadCloud } from "lucide-react";

type UploadResult = {
  questionnaireId: string;
  filled: number;
  flagged: number;
  total: number;
};

export default function RfpPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mock mode state
  const [isMockMode, setIsMockMode] = useState(false);
  const [mockQuestions, setMockQuestions] = useState<RfpQuestionItem[]>(
    MOCK_MERIDIAN_QUESTIONS,
  );

  const mockFilledCount = mockQuestions.filter(
    (q) => q.status === "filled" || Boolean(q.approved_by),
  ).length;
  const mockFlaggedCount = mockQuestions.filter(
    (q) => q.status === "flagged",
  ).length;
  const mockErrorCount = mockQuestions.filter((q) => q.status === "error").length;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);
    setProgress("Uploading and processing…");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("customer", file.name.replace(/\.xlsx$/i, ""));

      const res = await fetch("/api/rfp/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as UploadResult;
      setResult(data);
      setProgress(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            RFP Agent
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Automated questionnaire filling with Meko knowledge search, confidence
            gating, and human-in-the-loop fix loops.
          </p>
        </div>

        {/* Mock Mode Switch */}
        <div className="flex items-center gap-3 bg-slate-900/90 p-2 px-3 rounded-xl border border-slate-800 self-start sm:self-auto shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-300">Mock Mode</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isMockMode}
            onClick={() => setIsMockMode((prev) => !prev)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isMockMode ? "bg-[#4F46E5]" : "bg-slate-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                isMockMode ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Upload Button */}
      {!isMockMode && (
        <div className="mb-6 flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4F46E5] hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium transition-colors shadow-sm"
          >
            {uploading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                Upload RFP (.xlsx)
              </>
            )}
          </button>

          {progress && (
            <span className="text-xs text-slate-400 animate-pulse">{progress}</span>
          )}
        </div>
      )}

      {/* Error State */}
      {error && !isMockMode && (
        <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Mock Mode View */}
      {isMockMode && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm">
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-white tracking-tight leading-none mb-1">
                {mockQuestions.length}
              </div>
              <div className="text-xs text-slate-400 font-medium">Total Questions</div>
            </div>
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#16A34A] tracking-tight leading-none mb-1">
                {mockFilledCount}
              </div>
              <div className="text-xs text-slate-400 font-medium">Filled / Done</div>
            </div>
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#F59E0B] tracking-tight leading-none mb-1">
                {mockFlaggedCount}
              </div>
              <div className="text-xs text-slate-400 font-medium">Flagged</div>
            </div>
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#DC2626] tracking-tight leading-none mb-1">
                {mockErrorCount}
              </div>
              <div className="text-xs text-slate-400 font-medium">Needs Attention / Error</div>
            </div>
          </div>

          <RfpGrid
            questionnaireId="mock_meridian"
            initialQuestions={mockQuestions}
            onQuestionsChange={setMockQuestions}
          />
        </div>
      )}

      {/* Live Upload Results */}
      {!isMockMode && result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 divide-x divide-slate-800 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm">
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-white tracking-tight leading-none mb-1">
                {result.total}
              </div>
              <div className="text-xs text-slate-400 font-medium">Total Questions</div>
            </div>
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#16A34A] tracking-tight leading-none mb-1">
                {result.filled}
              </div>
              <div className="text-xs text-slate-400 font-medium">Filled</div>
            </div>
            <div className="p-4 text-center flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#F59E0B] tracking-tight leading-none mb-1">
                {result.flagged}
              </div>
              <div className="text-xs text-slate-400 font-medium">Flagged</div>
            </div>
          </div>

          <RfpGrid questionnaireId={result.questionnaireId} />
        </div>
      )}

      {/* Empty state */}
      {!isMockMode && !result && !uploading && !error && (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-400 text-sm">
          Upload an RFP questionnaire (.xlsx) or toggle <strong>Mock Mode</strong> above to test every state.
        </div>
      )}
    </div>
  );
}
