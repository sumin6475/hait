import { buildSystemPrompt } from "../lib/prompts.js";

const conditions = ["C1", "C2", "C3", "C4"] as const;

for (const c of conditions) {
  console.log(`\n=== ${c} ===`);
  const prompt = buildSystemPrompt(c);
  console.log(prompt);
  console.log(`(length: ${prompt.length} chars)`);
}

//CTRL은 throw 검증
try {
  buildSystemPrompt("CTRL");
  console.log("\n❌ CTRL should have thrown");
} catch (e: any) {
  console.log(`\n✅ CTRL throw: ${e.message}`);
}
