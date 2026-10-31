"use client";

import { useRef, useState } from "react";
import { RfpGrid } from "@/components/RfpGrid";

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
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white">
          RFP Agent
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          Automated questionnaire filling with Meko knowledge search, confidence
          gating, and human-in-the-loop fix loops.
        </p>
      </div>

      {/* Upload Button */}
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {uploading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            <>↑ Upload RFP (.xlsx)</>
          )}
        </button>

        {progress && (
          <span className="text-xs text-zinc-400 animate-pulse">{progress}</span>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-sm">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{result.total}</div>
              <div className="text-xs text-zinc-500">Total</div>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {result.filled}
              </div>
              <div className="text-xs text-zinc-500">Filled</div>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">
                {result.flagged}
              </div>
              <div className="text-xs text-zinc-500">Flagged</div>
            </div>
          </div>

          <RfpGrid questionnaireId={result.questionnaireId} />
        </div>
      )}

      {/* Empty state */}
      {!result && !uploading && !error && (
        <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm">
          Upload an RFP questionnaire (.xlsx) to begin automated filling.
        </div>
      )}
    </div>
  );
}
