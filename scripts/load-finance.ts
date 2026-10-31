// Loads seed/finance/*.csv into SQLite (saas_billing, sso_logins, card_feed).
// Run: pnpm tsx --env-file=.env.local scripts/load-finance.ts
import { loadFinanceData, financeSeedDir } from "@/lib/finance-data";

const dir = financeSeedDir();
console.log(`Loading finance seed data from ${dir}`);
for (const r of loadFinanceData(dir)) {
  console.log(
    `  ${r.table}: ${r.rows} rows from ${r.file}${r.created ? " (table created)" : ""}` +
      (r.skippedColumns.length ? `\n    skipped columns not in the table: ${r.skippedColumns.join(", ")}` : "") +
      (r.filledColumns.length ? `\n    filled required columns the CSV lacks: ${r.filledColumns.join(", ")}` : ""),
  );
}
console.log("Done.");
