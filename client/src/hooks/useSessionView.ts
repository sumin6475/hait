//세션 목록 탭 상태 (All / Main / Test) — Sessions, Chat Logs 페이지 공용
//주소의 ?view= 에 둬서 새로고침/뒤로가기에도 유지. 분류 기준은 @/lib/sessionView

import { useSearchParams } from "react-router-dom";
import { parseSessionView, type SessionView } from "@/lib/sessionView";

export function useSessionView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseSessionView(searchParams.get("view"));
  const setView = (next: SessionView) =>
    setSearchParams(next === "all" ? {} : { view: next }, { replace: true });
  return [view, setView] as const;
}
