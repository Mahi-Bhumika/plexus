// Run: pnpm tsx scripts/chat-intent-test.ts   (no network, no keys needed)
import { parseIntent, parseDays, parseTopic } from "@/lib/chat-intent";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failed++;
}
function intentIs(msg: string, intent: string, more: Record<string, unknown> = {}) {
  const r = parseIntent(msg) as Record<string, unknown>;
  const ok = r.intent === intent && Object.entries(more).every(([k, v]) => r[k] === v);
  check(`"${msg}" -> ${intent}${Object.keys(more).length ? " " + JSON.stringify(more) : ""}`, ok, `got ${JSON.stringify(r)}`);
}

intentIs("Catch me up on Meridian for 4 days", "catchup", { topic: "Meridian", days: 4 });
intentIs("catch me up on the meridian deal for the last 4 days", "catchup", { topic: "meridian deal", days: 4 });
intentIs("Catch me up on pricing over the past week", "catchup", { topic: "pricing", days: 7 });
intentIs("brief me on the launch for two days", "catchup", { topic: "launch", days: 2 });
intentIs("catch me up", "catchup", { topic: "Meridian", days: 4 });
intentIs("what happened with Meridian yesterday", "catchup", { days: 1 });
intentIs("catch me up on this and that for 4 days", "catchup", { topic: "this and that", days: 4 });
intentIs("Fill the RFP", "rfp", { sheet: "meridian" });
intentIs("please fill out the Aegis questionnaire", "rfp", { sheet: "aegis" });
intentIs("run the security questionnaire", "rfp");
intentIs("answer the RFP from Meridian Bank", "rfp", { sheet: "meridian" });
intentIs("process the kickoff transcript", "actionswarm");
intentIs("turn the meeting into tasks", "actionswarm");
intentIs("extract action items from the call", "actionswarm");
intentIs("show me unused SaaS tools", "zombie");
intentIs("find zombie software licences", "zombie");
intentIs("what are our SaaS wasted subscriptions", "zombie");
intentIs("show the expenses", "expenses");
intentIs("any receipts to review?", "expenses");
intentIs("I need Figma access", "access");
intentIs("can Meera get AWS production access", "access");
intentIs("what is our launch date", "search");
intentIs("who owns the Meridian pilot", "search");
intentIs("show me the salary sheet", "search");
intentIs("what can you do", "help");
intentIs("help", "help");
intentIs("catch me up on the RFP", "catchup", { topic: "RFP" });

check("parseDays: 'last 3 days'", parseDays("last 3 days") === 3);
check("parseDays: 'two weeks'", parseDays("in the last two weeks") === 14);
check("parseDays: nothing -> null", parseDays("catch me up") === null);
check("parseTopic: no topic -> null", parseTopic("catch me up for 4 days") === null);

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
