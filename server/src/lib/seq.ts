import { Session } from "../models/Session.js";

// 세션별 단조 증가 seq를 원자적으로 발급한다.
// MongoDB의 $inc는 문서 단위 원자 연산 → 동시 호출이 직렬화되어 절대 같은 값을 안 준다.
// (read-max-then-+1의 경쟁 조건 제거 — Step 18)
export async function allocSeq(sessionId: string): Promise<number> {
  const s = await Session.findByIdAndUpdate(
    sessionId,
    { $inc: { seqCounter: 1 } },
    { returnDocument: "after", projection: { seqCounter: 1 } },
  ).lean();
  if (!s) throw new Error(`allocSeq: session ${sessionId} not found`);
  return (s as { seqCounter: number }).seqCounter;
}
