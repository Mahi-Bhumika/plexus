export default function ActionsPage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-white">ActionSwarm</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Extracts action items, deliverables, and follow-ups from transcripts, docs, and Slack messages.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm">
        Tasks swarm and extraction feed will appear here.
      </div>
    </div>
  );
}
