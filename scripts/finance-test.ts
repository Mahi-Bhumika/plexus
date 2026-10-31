// Checks Zombie SaaS and Expenses against the seeded data.
// Run: pnpm tsx --env-file=.env.local scripts/finance-test.ts [--skip-expenses]
import { loadFinanceData } from "@/lib/finance-data";
import { findZombieSaas } from "@/lib/zombie";
import { runExpenses } from "@/agents/expenses";

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

async function main() {
  loadFinanceData();

  console.log("\n=== Zombie SaaS ===");
  const z = findZombieSaas();
  console.log(`as of ${z.asOf.slice(0, 10)}, ${z.totalToolsChecked} tools checked, threshold ${z.thresholdDays} days`);
  for (const t of z.tools) {
    console.log(`  ${t.tool.padEnd(10)} ${inr(t.monthly_cost_inr).padStart(10)}/month  last login ${t.last_login} (${t.days_idle} days)  owner ${t.owner}`);
  }
  console.log(`  waste: ${inr(z.monthlyWasteInr)}/month, ${inr(z.annualWasteInr)}/year`);

  if (process.argv.includes("--skip-expenses")) return;

  console.log("\n=== Expenses ===");
  const rep = await runExpenses();
  for (const r of rep.receipts) {
    console.log(
      `\n${r.file}: ${r.extraction?.merchant ?? "?"}  total ${r.total != null ? inr(r.total) : "?"}  type ${r.type}  claimant ${r.claimant ?? "unmatched"}` +
        `\n  card: ${r.card ? `${r.card.txn_id} via ${r.card.matchedBy}` : "none"}  status: ${r.status}  approve ${r.approvedAmount != null ? inr(r.approvedAmount) : "-"} -> ${r.approver}  confidence ${r.confidence.toFixed(2)}`,
    );
    if (r.extractionError) console.log(`  READ FAILED: ${r.extractionError}`);
    for (const i of r.issues) console.log(`  [${i.severity}] ${i.message}`);
  }
  console.log("\nCard transactions with no receipt (Finance chases these):");
  for (const t of rep.unmatchedTransactions) {
    console.log(`  ${t.txn_id} ${t.date} ${t.merchant} ${inr(t.amount_inr)} (${t.card_holder}), ${t.daysLeft} days left`);
  }
  console.log(`\nclaimed ${inr(rep.totals.claimed)}, approved ${inr(rep.totals.approved)}, ${rep.totals.violations} violation(s), ${rep.totals.needsReview} to review`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
