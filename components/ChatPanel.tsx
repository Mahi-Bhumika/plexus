"use client";

import { useEffect, useRef, useState } from "react";

type Link = { label: string; href: string };
type Message = { id: number; from: "user" | "bot"; text: string; intent?: string; links?: Link[] };

const ROLES = ["founder", "engineering manager", "engineering", "intern"] as const;

const SUGGESTIONS = [
  "Catch me up on Meridian for 4 days",
  "Fill the RFP",
  "Process the kickoff transcript",
  "Show unused SaaS tools",
];

const INTENT_LABEL: Record<string, string> = {
  catchup: "Catch-me-up",
  search: "Search",
  rfp: "RFP",
  actionswarm: "ActionSwarm",
  zombie: "Zombie SaaS",
  expenses: "Expenses",
  access: "Access",
  help: "Help",
  blocked: "Blocked",
};

export default function ChatPanel({ role: roleProp }: { role?: string }) {
  const [role, setRole] = useState<string>(roleProp && (ROLES as readonly string[]).includes(roleProp) ? roleProp : "founder");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: "bot", text: 'Ask me to catch you up, fill the RFP, process the kickoff transcript, or search the documents. Type "help" to see everything.' },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId.current++, from: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, role }),
      });
      const data = (await res.json()) as { status?: string; reply?: string; message?: string; intent?: string; links?: Link[] };
      const reply = data.status === "error" ? `Something went wrong: ${data.message ?? "unknown error"}` : (data.reply ?? "No reply.");
      setMessages((m) => [...m, { id: nextId.current++, from: "bot", text: reply, intent: data.intent, links: data.links }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: nextId.current++, from: "bot", text: `I couldn't reach the server: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-zinc-100">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2 text-xs">
        <span className="text-zinc-500">Acting as</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#070A12] px-2 py-1 text-xs capitalize text-zinc-200 outline-none focus:border-emerald-600"
          aria-label="Role"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.from === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-700 px-3 py-2 text-sm text-white"
                  : "max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-800/80 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100"
              }
            >
              {m.from === "bot" && m.intent && INTENT_LABEL[m.intent] && (
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                  {INTENT_LABEL[m.intent]}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              {m.links && m.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.links.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-emerald-300 underline-offset-2 hover:border-emerald-600 hover:underline"
                    >
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-slate-800/80 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-500">
              Working on it...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-slate-800/80 bg-[#070A12]/60 p-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask Plexus to do something..."
            maxLength={600}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#090D16] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-600"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}