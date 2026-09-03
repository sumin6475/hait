// 임시 진단 — 후보 모델별로 (1) temperature:0 지원 여부(=reasoning 아닌지) (2) 실제 게이트웨이 지연을 잰다.
// 확인 끝나면 지워도 됨. 실행: server/ 에서  node probe-models.mjs
// 공유 구독이라 지연은 시간대 부하에 흔들림 — 참고용. temp 지원 여부는 결정적.
import "dotenv/config";
import OpenAI from "openai";

const c = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE ?? "https://api.toolkit.umgpt.umich.edu/v1",
});

// 후보 — 없는 모델은 자동 skip. 필요하면 편집.
const CANDIDATES = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-5-mini", "gpt-5"];
const N = 3; // 지연 샘플 수 (median 보려고)
const PROMPT = "You are Alex, a teammate in a group decision. In one short Korean sentence, say you lean toward candidate C.";

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log(`\n[probe] model × ${N}회 · temp0 지원여부 + 지연(ms)\n`);
for (const model of CANDIDATES) {
  // 1) reasoning 판별: temperature:0 을 받나?
  let reasoning = false;
  try {
    await c.responses.create({ model, temperature: 0, max_output_tokens: 300, input: "hi" });
  } catch (e) {
    const msg = e?.message ?? "";
    if (/temperature/i.test(msg)) reasoning = true;
    else if (e?.status === 404 || /not found|does not exist|no deployment/i.test(msg)) {
      console.log(`  ${model.padEnd(13)} — 게이트웨이에 없음 (skip)`);
      continue;
    } else {
      console.log(`  ${model.padEnd(13)} ERROR ${e?.status ?? ""} ${msg.slice(0, 70)}`);
      continue;
    }
  }

  // 2) 정상 모드로 N회 지연 측정
  const lat = [];
  let sample = "";
  let outTok = 0;
  const req = reasoning
    ? { model, reasoning: { effort: "minimal" }, max_output_tokens: 800, input: PROMPT }
    : { model, temperature: 0, max_output_tokens: 200, input: PROMPT };
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    try {
      const r = await c.responses.create(req);
      lat.push(Date.now() - t);
      sample = (r.output_text ?? "").replace(/\n/g, " ").slice(0, 40);
      outTok = r.usage?.output_tokens ?? 0;
    } catch (e) {
      console.log(`  ${model.padEnd(13)} 호출실패: ${e?.status ?? ""} ${(e?.message ?? "").slice(0, 60)}`);
    }
  }
  if (!lat.length) continue;
  const tag = reasoning ? "REASONING (temp✗)" : "non-reasoning (temp✓)";
  console.log(
    `  ${model.padEnd(13)} ${tag.padEnd(22)} median=${String(median(lat)).padStart(6)}ms  [${lat.join(", ")}]  out=${outTok}  "${sample}"`,
  );
}
console.log();
