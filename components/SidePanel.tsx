"use client";

import { useCallback, useRef, useState } from "react";
import { ActivityFeed } from "@/components/ActivityFeed";
import ChatPanel from "@/components/ChatPanel";

// One full-height panel with two tabs, Activity and Chat. Both stay mounted (the inactive one is
// hidden), so the feed keeps receiving live events and the chat keeps its history while you switch.
// While you are on the Chat tab, new events add a count badge to the Activity tab.
//
// STOPGAP: ActivityFeed and ChatPanel are still styled dark-only, so their bodies get a color-flip
// filter in light mode. Delete BODY_FIX once both files have proper light/dark classes.
const BODY_FIX = "[filter:invert(1)_hue-rotate(180deg)] dark:[filter:none]";

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
    "relative flex-1 rounded-md px-3 py-1.5 text-xs tracking-wide transition-all " +
    (active
      ? "bg-white dark:bg-[#0F172A] text-[#111827] dark:text-[#F3F4F6] font-semibold shadow-sm border border-[#E5E7EB] dark:border-[#1E293B]"
      : "text-gray-600 dark:text-gray-400 hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-white/60 dark:hover:bg-[#1E293B]/60 font-medium border border-transparent");

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-white dark:bg-[#0C1222] text-[#111827] dark:text-[#F3F4F6] transition-colors duration-200">
      <div
        role="tablist"
        aria-label="Side panel"
        className="shrink-0 flex gap-1 p-1.5 border-b border-[#E5E7EB] dark:border-[#1E293B] bg-[#F3F4F6] dark:bg-[#162032]"
      >
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

      <div className={tab === "activity" ? `flex-1 min-h-0 flex flex-col ${BODY_FIX}` : "hidden"}>
        <ActivityFeed embedded onNewEvent={handleNewEvent} />
      </div>
      <div
        className={
          tab === "chat"
            ? `flex-1 min-h-0 flex flex-col ${BODY_FIX} font-sans [&_*]:!text-xs [&_input]:!font-sans [&_select]:!font-sans [&_textarea]:!font-sans [&_button]:!font-sans`
            : "hidden"
        }
      >
        <ChatPanel role={role} />
      </div>
    </div>
  );
}