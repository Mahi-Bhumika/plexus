// Turns a chat message into an intent. Pure and rule-based: no network, no model,
// so the same message always routes the same way (safe for a live demo).

export type Intent =
  | "help"
  | "catchup"
  | "rfp"
  | "actionswarm"
  | "zombie"
  | "expenses"
  | "access"
  | "search";

export type ParsedIntent = {
  intent: Intent;
  topic?: string; // catchup
  days?: number; // catchup
  sheet?: "meridian" | "aegis"; // rfp
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fourteen: 14, fifteen: 15, thirty: 30,
};

export const DEFAULT_CATCHUP_DAYS = 4;
export const DEFAULT_CATCHUP_TOPIC = "Meridian";

export function parseDays(text: string): number | null {
  const t = text.toLowerCase();
  const num = t.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|fifteen|thirty)[\s-]*(day|days|week|weeks|month|months)\b/);
  if (num) {
    const n = /^\d+$/.test(num[1]) ? parseInt(num[1], 10) : WORD_NUMBERS[num[1]];
    const unit = num[2];
    if (unit.startsWith("week")) return n * 7;
    if (unit.startsWith("month")) return n * 30;
    return n;
  }
  if (/\b(a|last|past|this)\s+week\b/.test(t)) return 7;
  if (/\bfortnight\b/.test(t)) return 14;
  if (/\b(a|last|past|this)\s+month\b/.test(t)) return 30;
  if (/\byesterday\b|\btoday\b/.test(t)) return 1;
  if (/\b(few|couple of)\s+days\b/.test(t)) return 3;
  return null;
}

export function parseTopic(text: string): string | null {
  const m = text.match(
    /\b(?:catch(?:ing)?\s*(?:me\s*)?up|brief\s+me|fill\s+me\s+in|update\s+me|bring\s+me\s+up\s+to\s+speed|recap)\s+(?:on|about|with|regarding)\s+(.+?)(?=\s+(?:for|over|in|during|from|since|within)\b|\s+(?:the\s+)?(?:last|past|previous)\b|[.?!,]|$)/i,
  );
  if (!m) return null;
  const topic = m[1].replace(/^(the|our|all)\s+/i, "").trim();
  return topic.length > 0 ? topic : null;
}

export function parseIntent(message: string): ParsedIntent {
  const t = message.trim().toLowerCase();

  if (/^(help|\?|what can you do|what do you do|commands|how do i use)/.test(t)) return { intent: "help" };

  if (
    /\bcatch(ing)?\s*(me\s*)?up\b|\bcatch-?up\b|\bbrief me\b|\bbring me up to speed\b|\bfill me in\b|\bupdate me on\b|\brecap\b|\bwhat('s| has| have)?\s+(been\s+)?(happen|going on)/.test(t)
  ) {
    return {
      intent: "catchup",
      topic: parseTopic(message) ?? DEFAULT_CATCHUP_TOPIC,
      days: parseDays(message) ?? DEFAULT_CATCHUP_DAYS,
    };
  }

  const rfpNoun = /\b(rfp|rfi|questionnaire|security (form|review)|due diligence)\b/.test(t);
  const rfpVerb = /\b(fill|complete|answer|run|do|process|start|auto-?fill|handle|work on|tackle)\b/.test(t);
  if (rfpNoun && rfpVerb) return { intent: "rfp", sheet: /\baegis\b/.test(t) ? "aegis" : "meridian" };

  const meetingNoun = /\b(transcript|kick-?off|meeting notes?|the meeting|the call)\b/.test(t);
  const meetingVerb = /\b(process|run|read|extract|turn|handle|execute|start|create tasks|make tasks|action)\b/.test(t);
  if ((meetingNoun && meetingVerb) || /\baction items?\b|\bfollow-?ups?\s+from\b/.test(t)) return { intent: "actionswarm" };

  if (
    /\b(zombie|unused|idle|inactive|dormant|wasted?)\b.*\b(saas|tools?|software|licen[cs]es?|subscriptions?|apps?)\b/.test(t) ||
    /\bsaas\s+(waste|spend|audit)\b|\bunused\b/.test(t)
  ) {
    return { intent: "zombie" };
  }

  if (/\b(expenses?|receipts?|reimburse(ment)?s?|claims?)\b/.test(t)) return { intent: "expenses" };

  if (/\b(access|permission)\b/.test(t) && /\b(figma|aws|salesforce|notion|production|slack|admin)\b/.test(t)) return { intent: "access" };
  if (/\bi need\b.*\b(figma|aws|salesforce|notion)\b/.test(t)) return { intent: "access" };

  return { intent: "search" };
}
