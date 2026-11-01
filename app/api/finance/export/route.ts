import { getSavedClaims, readCardFeed } from "@/agents/expenses";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  try {
    const claims = getSavedClaims();
    const cardTxns = readCardFeed();

    const headers = [
      "Claim ID",
      "Receipt File",
      "Merchant",
      "Date",
      "Invoice Number",
      "Category",
      "Claim Amount (INR)",
      "Allowed Amount (INR)",
      "Approved Amount (INR)",
      "Audit Status",
      "Assigned Approver",
      "Claimant / Cardholder",
      "Matched Card Txn",
      "Match Method",
      "Confidence Score",
      "Policy Issues & Findings",
    ];

    const rows: string[][] = [];

    // Add processed claims
    for (const c of claims) {
      const issuesStr = c.issues
        .map((i) => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`)
        .join("; ");

      rows.push([
        c.id,
        c.file,
        c.extraction?.merchant ?? "",
        c.extraction?.date ?? "",
        c.extraction?.invoice_number ?? "",
        c.type ?? "other",
        c.total != null ? String(c.total) : "",
        c.allowedAmount != null ? String(c.allowedAmount) : "",
        c.approvedAmount != null ? String(c.approvedAmount) : "",
        c.status.toUpperCase(),
        c.approver ?? "Unassigned",
        c.claimant ?? "Unmatched",
        c.card?.txn_id ?? "",
        c.card?.matchedBy ?? "",
        c.confidence != null ? c.confidence.toFixed(2) : "",
        issuesStr,
      ]);
    }

    // Add unmatched card charges section
    const matchedTxnIds = new Set(claims.map((c) => c.card?.txn_id).filter(Boolean));
    const unmatched = cardTxns.filter((t) => !matchedTxnIds.has(t.txn_id) && !t.receipt_ref);

    for (const u of unmatched) {
      rows.push([
        `UNMATCHED-${u.txn_id}`,
        "No Receipt Provided",
        u.merchant,
        u.date,
        "",
        u.category,
        String(u.amount_inr),
        "0",
        "0",
        "MISSING_RECEIPT",
        "Karan Malhotra",
        u.card_holder,
        u.txn_id,
        "Direct Bank Feed",
        "1.00",
        "[WARNING] Missing receipt for corporate card charge",
      ]);
    }

    const csvContent =
      "\uFEFF" + // UTF-8 BOM
      [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\r\n");

    const hash = createHash("sha256").update(csvContent).digest("hex");

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Nimbus-Meridian-Audit-FY24-Q3.csv"',
        "X-Checksum-SHA256": hash,
        "Access-Control-Expose-Headers": "X-Checksum-SHA256",
      },
    });
  } catch (err) {
    return Response.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
