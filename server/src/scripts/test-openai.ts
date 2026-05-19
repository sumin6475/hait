import { callAI } from "../lib/openai.js";

(async () => {
  console.log("[test] calling gpt-5-mini...");

  const result = await callAI({
    systemPrompt:
      "You are Alex, a thoughtful AI participant in a 3-person team discussion. Reply briefly (1-2 sentences).",
    userPrompt:
      'humanX said: "I think candidate C looks strong." humanY said: "Agreed, C seems solid." What is your response?',
  });

  if (result.ok) {
    console.log("[test] ✅ success");
    console.log("  request_id:", result.requestId);
    console.log("  latency:", result.latencyMs, "ms");
    console.log("  content:", result.content);
  } else {
    console.log("[test] ❌ failed");
    console.log("  reason:", result.reason);
    console.log("  error:", result.error);
  }

  process.exit(0);
})();
