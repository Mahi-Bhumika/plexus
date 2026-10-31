import { searchKnowledge, searchMemory } from "../lib/meko";

async function main() {
  const k = await searchKnowledge("plexus_rfp", "encryption at rest");
  const m = await searchMemory("plexus_rfp", "RFP_FIX");
  console.log("knowledge hits:", k.length, k.slice(0, 2).map((h) => h.title));
  console.log("memory hits:", m.length);
}
main();