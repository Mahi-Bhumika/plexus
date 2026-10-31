export default function AuditPage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white">Audit Trail & Traces</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Complete trace of every agent reasoning step, guard evaluation, and undo actions.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm">
        Audit log table and trace drawers will appear here.
      </div>
    </div>
  );
}
