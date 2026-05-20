import { callAIStructured } from "../lib/openai.js";

(async () => {
  console.log("[test] structured output 호출...");

  const result = await callAIStructured({
    systemPrompt: "You are Alex, an AI participant. Respond briefly to the discussion.",
    userPrompt: "Discussion so far:\nP-X-001: 나는 C가 좋아 보이는데\nP-Y-001: 나도 C가 강해 보여",
  });

  if (result.ok) {
    console.log("✅ ok");
    console.log("  content:", result.parsed.content);
    console.log("  latency:", result.latencyMs, "ms");
    console.log("  input tokens:", result.inputTokens);
    console.log("  output tokens:", result.outputTokens);
    console.log("  request id:", result.requestId);
  } else {
    console.log("❌ failed");
    console.log("  reason:", result.reason);
    console.log("  error:", result.error);
  }

  process.exit(0);
})();
