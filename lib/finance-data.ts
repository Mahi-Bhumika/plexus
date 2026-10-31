import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { parseCsv } from "@/lib/csv";

// Loads the three finance seed CSVs into SQLite:
//   saas_billing.csv -> saas_billing, sso_logins.csv -> sso_logins, card_feed.csv -> card_feed
// It adapts to whatever columns the tables already have in lib/db.ts:
//   - CSV columns the table does not have are skipped (and reported)
//   - NOT NULL table columns the CSV does not have are filled with a placeholder
//   - a table that does not exist yet is created from the CSV header
// Each table is emptied first, so running this twice gives the same result.

export type LoadReport = {
  table: string;
  file: string;
  rows: number;
  created: boolean;
  skippedColumns: string[];
  filledColumns: string[];
};

const FILES: Array<{ table: string; file: string }> = [
  { table: "saas_billing", file: "saas_billing.csv" },
  { table: "sso_logins", file: "sso_logins.csv" },
  { table: "card_feed", file: "card_feed.csv" },
];

export function financeSeedDir(): string {
  const candidates = [
    process.env.FINANCE_SEED_DIR,
    path.join(process.cwd(), "seed", "finance"),
    path.join(process.cwd(), "seed", "finance", "data"),
    path.join(process.cwd(), "data"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "card_feed.csv"))) return dir;
  }
  throw new Error(
    `Could not find card_feed.csv. Looked in: ${candidates.join(", ")}. Set FINANCE_SEED_DIR.`,
  );
}

function isNumeric(v: string): boolean {
  return v !== "" && !isNaN(Number(v));
}

function loadTable(table: string, filePath: string): LoadReport {
  const db = getDb();
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  if (rows.length === 0) throw new Error(`${filePath} has no rows`);
  const csvCols = Object.keys(rows[0]);

  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  let created = false;
  if (!exists) {
    const defs = csvCols.map((c) => {
      const numeric = rows.every((r) => isNumeric(r[c]));
      return `"${c}" ${numeric ? "REAL" : "TEXT"}`;
    });
    db.exec(`CREATE TABLE "${table}" (${defs.join(", ")})`);
    created = true;
  }

  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>;
  const tableCols = new Map(info.map((c) => [c.name, c]));

  const useCols = csvCols.filter((c) => tableCols.has(c));
  const skippedColumns = csvCols.filter((c) => !tableCols.has(c));

  // Columns the table requires that the CSV does not provide
  const fillCols = info.filter(
    (c) =>
      !csvCols.includes(c.name) &&
      c.notnull === 1 &&
      c.dflt_value == null &&
      !(c.pk > 0 && /int/i.test(c.type)), // INTEGER PRIMARY KEY fills itself
  );

  const allCols = [...useCols, ...fillCols.map((c) => c.name)];
  const insert = db.prepare(
    `INSERT INTO "${table}" (${allCols.map((c) => `"${c}"`).join(", ")}) VALUES (${allCols
      .map(() => "?")
      .join(", ")})`,
  );

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM "${table}"`).run();
    rows.forEach((r, i) => {
      const values: unknown[] = useCols.map((c) => {
        const v = r[c];
        if (v === "") return tableCols.get(c)!.notnull ? "" : null;
        return v; // SQLite converts to the column's type
      });
      for (const c of fillCols) {
        if (/int|real|num|floa|doub/i.test(c.type)) values.push(0);
        else if (c.pk > 0) values.push(`${table}_${i + 1}`);
        else values.push("aggregate");
      }
      insert.run(...values);
    });
  });
  tx();

  return {
    table,
    file: path.basename(filePath),
    rows: rows.length,
    created,
    skippedColumns,
    filledColumns: fillCols.map((c) => c.name),
  };
}

export function loadFinanceData(dir = financeSeedDir()): LoadReport[] {
  return FILES.map((f) => loadTable(f.table, path.join(dir, f.file)));
}
