// Times the RFP run 3 times (reset first each time) and prints seconds, filled and flagged.
// Run: pnpm tsx --env-file=.env.local scripts/time-rfp.ts [runs]
// Make sure DEMO_MODE is not "true" or you are timing replayed fixtures.
import { spawnSync } from "node:child_process";

const RUNS = Number(process.argv[2] ?? 3);

function run(args: string[]): { secs: number; out: string; code: number | null } {
  const t0 = Date.now();
  const r = spawnSync("pnpm", ["tsx", "--env-file=.env.local", ...args], {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { secs: (Date.now() - t0) / 1000, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, code: r.status };
}

if (process.env.DEMO_MODE === "true") {
  console.error("DEMO_MODE is true: these times would be replayed fixtures. Unset it first.");
  process.exit(1);
}

const rows: Array<{ run: number; secs: number; filled: string; flagged: string; wrong: string }> = [];
for (let i = 1; i <= RUNS; i++) {
  process.stdout.write(`run ${i}: resetting... `);
  const reset = run(["scripts/reset-demo.ts", "--meko", "--yes"]);
  if (reset.code !== 0) {
    console.error(`reset failed:\n${reset.out.slice(-800)}`);
    process.exit(1);
  }
  process.stdout.write("running RFP... ");
  const t = run(["scripts/rfp-test.ts"]);
  const m = t.out.match(/^filled (\d+), flagged (\d+)/m);
  const w = t.out.match(/wrongly_filled (\d+)/);
  rows.push({ run: i, secs: t.secs, filled: m?.[1] ?? "?", flagged: m?.[2] ?? "?", wrong: w?.[1] ?? "?" });
  console.log(`${t.secs.toFixed(1)} s, filled ${m?.[1] ?? "?"}, flagged ${m?.[2] ?? "?"}${t.code !== 0 ? ` (exit code ${t.code})` : ""}`);
}

console.log("\nrun | seconds | filled | flagged | wrongly_filled");
for (const r of rows) console.log(`${String(r.run).padStart(3)} | ${r.secs.toFixed(1).padStart(7)} | ${r.filled.padStart(6)} | ${r.flagged.padStart(7)} | ${r.wrong}`);
const avg = rows.reduce((s, r) => s + r.secs, 0) / rows.length;
console.log(`average ${avg.toFixed(1)} s (each time includes about 3 to 5 s of script start-up and Meko connect)`);
