// 임시 확인용 스크립트 — U-M GPT Toolkit이 제공하는 모델 목록을 뽑는다.
// 확인 끝나면 지워도 됨.
// 실행: server/ 폴더에서  node list-models.mjs
// 전제: server/.env 의 OPENAI_API_KEY 를 U-M 키로 바꿔둘 것.
import "dotenv/config";
import OpenAI from "openai";

const c = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE ?? "https://api.toolkit.umgpt.umich.edu/v1",
});

try {
  const models = await c.models.list();
  const ids = models.data.map((m) => m.id).sort();
  console.log(`\n[models] ${ids.length}개:\n`);
  console.log(ids.join("\n"));
} catch (err) {
  console.error("\n[models] 목록 조회 실패:", err.status ?? "", err.message);
  console.error("→ /models 엔드포인트를 게이트웨이가 막아뒀을 수 있음. 그러면 Playground의 모델 드롭다운으로 확인.");
}
