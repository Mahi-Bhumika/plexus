import { addMemory, searchMemory } from "../lib/meko";

async function main() {
  const add = await addMemory(
    "plexus_rfp",
    "RFP_FIX | test question | test approved answer | Mahi",
    "meko-check-add",
  );
  console.log("add:", add);
  await new Promise((r) => setTimeout(r, 3000)); // give Meko a moment to index
  const hits = await searchMemory("plexus_rfp", "test question approved answer", "meko-check-search");
  console.log("hits:", hits.length);
  console.log(hits.map((h) => h.text));
}
main();