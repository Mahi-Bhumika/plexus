import type { CardTxn, ExpenseReport, ExpenseResult } from "@/agents/expenses";

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status === "error") {
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const getSavedReceipts = () =>
  fetch("/api/finance/expenses", { cache: "no-store" }).then((r) => parse<{ receipts: ExpenseResult[] }>(r));

export const runReceipts = () =>
  fetch("/api/finance/expenses", { method: "POST" }).then((r) => parse<ExpenseReport>(r));

export const getCardFeed = () =>
  fetch("/api/finance/card-feed", { cache: "no-store" }).then((r) => parse<{ asOf: string; txns: CardTxn[] }>(r));

export const getZombie = () =>
  fetch("/api/finance/zombie", { cache: "no-store" }).then((r) => parse<unknown>(r));