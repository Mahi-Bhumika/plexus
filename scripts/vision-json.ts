// Runs ONE receipt through the same code path the Expenses agent uses (generateJson
// with the real schema and prompt), on each model, and prints the exact error if any.
// Run: pnpm tsx --env-file=.env.local scripts/vision-json.ts [receipt_file_name]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { generateJson } from "@/lib/gemini";
import { extractionSchema, EXTRACT_PROMPT, receiptsDir } from "@/agents/expenses";

async function main() {
  const dir = receiptsDir();
  const file =
    process.argv[2] ?? readdirSync(dir).filter((f) => /^receipt_.*\.(png|jpe?g|webp)$/i.test(f)).sort()[0];
  if (!existsSync(path.join(dir, file))) throw new Error(`no such receipt: ${file}`);
  const data = readFileSync(path.join(dir, file)).toString("base64");
  console.log(`receipt: ${file}, base64 length ${data.length}`);

  for (const model of ["FAST", "SMART"] as const) {
    const t0 = Date.now();
    const res = await generateJson(extractionSchema, EXTRACT_PROMPT, {
      model,
      images: [{ mimeType: "image/png", data }],
      timeoutMs: 60000,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.success) {
      console.log(`\n${model} (${res.modelUsed}) OK in ${secs}s:`);
      console.log(JSON.stringify(res.data, null, 2));
    } else {
      console.log(`\n${model} (${res.modelUsed}) FAILED in ${secs}s: ${res.error}`);
      if (res.rawText) console.log(`raw: ${res.rawText.slice(0, 300)}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});