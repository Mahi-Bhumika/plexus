// Finds out why receipt reading fails. Prints sizes, then tries a text call and an
// image call on each model name. Shows the real cause, never your key.
// Run: pnpm tsx --env-file=.env.local scripts/vision-check.ts
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const dirs = [process.env.EXPENSE_RECEIPTS_DIR, "seed/finance/receipts", "seed/finance"].filter(Boolean) as string[];
const dir = dirs.find((d) => existsSync(d) && readdirSync(d).some((f) => /^receipt_/i.test(f)))!;
const files = readdirSync(dir).filter((f) => /^receipt_.*\.(png|jpe?g|webp)$/i.test(f)).sort();
console.log(`receipts in ${dir}:`);
for (const f of files) console.log(`  ${f}  ${(statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB`);

const models = [
  process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite",
  process.env.GEMINI_MODEL_SMART || "gemini-3.6-flash",
  process.env.GEMINI_MODEL_FALLBACK || "gemini-3.1-flash-lite",
];
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function why(e: any): string {
  const c = e?.cause;
  return `${e?.message}${c ? ` | cause: ${c.code || c.message || c}` : ""}${e?.status ? ` | status ${e.status}` : ""}`;
}

async function main() {
  const img = readFileSync(path.join(dir, files[0])).toString("base64");
  for (const model of [...new Set(models)]) {
    try {
      const r = await ai.models.generateContent({ model, contents: "Reply with the word ok." });
      console.log(`${model} text: OK (${r.text?.slice(0, 20)})`);
    } catch (e) {
      console.log(`${model} text: FAILED ${why(e)}`);
    }
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: img } }, { text: "What is the merchant name and total on this receipt?" }] }],
      });
      console.log(`${model} image (${files[0]}): OK -> ${r.text?.slice(0, 120)}`);
    } catch (e) {
      console.log(`${model} image (${files[0]}): FAILED ${why(e)}`);
    }
  }
}
main();