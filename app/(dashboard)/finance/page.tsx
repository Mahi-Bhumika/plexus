export default function FinancePage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white">Finance Agent</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Audit expenses, detect zombie SaaS subscriptions, cross-reference SSO logins, and reconcile invoices.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm">
        Expenses ledger and SaaS zombie detection metrics will appear here.
      </div>
    </div>
  );
}
