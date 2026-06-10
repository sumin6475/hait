// seq 원자성 동시성 테스트 (Step 18) — 실행: npm run test:seq
// 임시 세션 1개에 allocSeq를 N회 동시 호출 → 전부 distinct + 1..N 연속이면 PASS.
// read-max-then-+1(구 방식)이면 중복이 발생하므로 이 테스트가 회귀를 차단한다.
// 실 MongoDB(config.mongodbUri)에 임시 세션을 만들고 끝나면 삭제한다.
import mongoose from "mongoose";
import { config } from "../config.js";
import { Session } from "../models/Session.js";
import { allocSeq } from "../lib/seq.js";

const N = 50;

await mongoose.connect(config.mongodbUri);
const tmp = await Session.create({ sessionCode: `TMP_SEQ_${process.pid}`, conditionCode: "C1" });
const sid = tmp._id.toString();
try {
  const results = await Promise.all(Array.from({ length: N }, () => allocSeq(sid)));
  const distinct = new Set(results).size === N;
  const contiguous = Math.min(...results) === 1 && Math.max(...results) === N;
  console.log(`allocSeq x${N} concurrent: distinct=${distinct} contiguous(1..${N})=${contiguous}`);
  if (!distinct || !contiguous) {
    console.error("FAIL — duplicates or gaps:", [...results].sort((a, b) => a - b).join(","));
    process.exitCode = 1;
  } else {
    console.log("PASS");
  }
} finally {
  await Session.deleteOne({ _id: sid });
  await mongoose.disconnect();
}
