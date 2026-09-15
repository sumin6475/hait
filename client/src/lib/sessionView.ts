//세션 목록 탭 (All / Main / Test)
//- Main = 실제 실험 세션만. 서버가 발급하는 형식 S-<condition>-<seq> (server/src/lib/codeGen.ts)이면서 isTest가 아닌 것.
//- Test = 그 밖의 모든 세션. T- 세션과, 형식이 다른 옛 하네스 세션(S-Test-<timestamp>, server/src/routes/test.ts)을 포함.
//  목록 API의 isTest는 "T-로 시작하는가"만 보므로, 그것만 쓰면 S-Test- 세션이 Main에 섞인다.

import type { SessionSummary } from "./api";

export type SessionView = "all" | "main" | "test";

export const SESSION_VIEWS: { value: SessionView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "main", label: "Main" },
  { value: "test", label: "Test" },
];

const MAIN_SESSION_CODE = /^S-[A-Z0-9]+-\d{3}$/;

type Classifiable = Pick<SessionSummary, "sessionCode" | "isTest">;

export function isMainSession(session: Classifiable): boolean {
  return !session.isTest && MAIN_SESSION_CODE.test(session.sessionCode);
}

export function sessionsInView<T extends Classifiable>(sessions: readonly T[], view: SessionView): T[] {
  if (view === "all") return [...sessions];
  return sessions.filter((session) => isMainSession(session) === (view === "main"));
}

//주소의 ?view= 값 → 탭. 모르는 값은 All.
export function parseSessionView(value: string | null): SessionView {
  return value === "main" || value === "test" ? value : "all";
}
