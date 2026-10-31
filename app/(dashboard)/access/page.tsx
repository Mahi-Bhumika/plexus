export default function AccessPage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white">Access Agent</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Policy-enforced tool and infrastructure access. Auto-approves low risk (Figma), gates high risk (AWS prod) with human approvals.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm">
        Access requests table and approval actions will appear here.
      </div>
    </div>
  );
}
