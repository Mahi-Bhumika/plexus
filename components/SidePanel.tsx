"use client";

import { useCallback, useRef, useState } from "react";
import { ActivityFeed } from "@/components/ActivityFeed";
import ChatPanel from "@/components/ChatPanel";

// Replaces <ActivityFeed /> in your layout:  <SidePanel />
// One card with two tabs, Activity and Chat. Both stay mounted (the inactive one is hidden),
// so the feed keeps receiving live events and the chat keeps its history while you switch.
// While you are on the Chat tab, new events add a count badge to the Activity tab.
export default function SidePanel({
  role,
  defaultTab = "activity",
}: {
  role?: string;
  defaultTab?: "activity" | "chat";
}) {
  const [tab, setTab] = useState<"activity" | "chat">(defaultTab);
  const [unseen, setUnseen] = useState(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const handleNewEvent = useCallback(() => {
    if (tabRef.current === "chat") setUnseen((n) => n + 1);
  }, []);

  function select(next: "activity" | "chat") {
    setTab(next);
    if (next === "activity") setUnseen(0);
  }

  const tabClass = (active: boolean) =>
    "relative flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors " +
    (active ? "bg-slate-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300");

  return (
    <div className="flex flex-col h-full bg-[#090D16] border border-slate-800/80 rounded-2xl shadow-xl w-80 lg:w-96 text-zinc-100 flex-shrink-0 overflow-hidden">
      <div role="tablist" aria-label="Side panel" className="flex gap-1 p-1.5 border-b border-slate-800/80 bg-[#070A12]/60">
        <button type="button" role="tab" aria-selected={tab === "activity"} onClick={() => select("activity")} className={tabClass(tab === "activity")}>
          Activity
          {unseen > 0 && (
            <span className="ml-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-4 text-black">
              {unseen > 99 ? "99+" : unseen}
            </span>
          )}
        </button>
        <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => select("chat")} className={tabClass(tab === "chat")}>
          Chat
        </button>
      </div>

      <div className={tab === "activity" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <ActivityFeed embedded onNewEvent={handleNewEvent} />
      </div>
      <div className={tab === "chat" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <ChatPanel role={role} />
      </div>
    </div>
  );
}