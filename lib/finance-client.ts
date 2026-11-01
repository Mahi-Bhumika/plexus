import type { CardTxn, ExpenseReport, ExpenseResult } from "@/agents/expenses";
import type { ZombieReport } from "@/lib/zombie";

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status === "error") {
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const getSavedReceipts = () =>
  fetch("/api/finance/expenses", { cache: "no-store" }).then((r) => parse<{ receipts: ExpenseResult[] }>(r));

export const runReceipts = (opts?: { dir?: string; files?: File[] }) => {
  if (opts?.files && opts.files.length > 0) {
    const formData = new FormData();
    opts.files.forEach((f) => formData.append("files", f));
    return fetch("/api/finance/expenses", { method: "POST", body: formData }).then((r) => parse<ExpenseReport>(r));
  }
  return fetch("/api/finance/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir: opts?.dir }),
  }).then((r) => parse<ExpenseReport>(r));
};

export const getCardFeed = () =>
  fetch("/api/finance/card-feed", { cache: "no-store" }).then((r) => parse<{ asOf: string; txns: CardTxn[] }>(r));

export const getZombie = () =>
  fetch("/api/finance/zombie", { cache: "no-store" }).then((r) => parse<ZombieReport>(r));

export const exportAuditReport = async (): Promise<{ blob: Blob; sha256: string }> => {
  const res = await fetch("/api/finance/export", { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const sha256 = res.headers.get("X-Checksum-SHA256") || "";
  return { blob, sha256 };
};
