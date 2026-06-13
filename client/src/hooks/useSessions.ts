//Sessions 관련 React Query 훅들
//
//사용처: 대시보드 Sessions 페이지
//
//제공하는 훅:
//  useSessionList()      목록 조회 (자동 refetch)
//  useSessionDetail(code) 단건 조회
//  useCreateSession()    생성 mutation
//  useDeleteSession()    삭제 mutation
//
//mutation 성공 시 list 캐시 자동 무효화 → 즉시 새 데이터 반영

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSessions,
  getSession,
  createSession,
  deleteSession,
  approveGate,
  type ConditionCode,
} from "@/lib/api";
import type { GateId } from "@/lib/gates";

const SESSIONS_KEY = ["sessions"] as const;

//세션 목록
//refetchInterval: 5초마다 자동 갱신 (참가자 입장/상태 변화 추적)
//라이브 운영 중 게이트 도착 반영이 더 빨라야 하면 5000→3000 조정 포인트 (Step 32)
export function useSessionList() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: listSessions,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
}

//세션 단건 + 참가자
export function useSessionDetail(sessionCode: string | undefined) {
  return useQuery({
    queryKey: [...SESSIONS_KEY, sessionCode],
    queryFn: () => getSession(sessionCode!),
    enabled: !!sessionCode,
    refetchInterval: (query) => (query.state.data?.session.status === "in_progress" ? 3000 : false),
  });
}

//세션 생성
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      conditionCode: ConditionCode;
      isTest?: boolean;
      language?: "en" | "ko"; // [KO-PILOT]
    }) => createSession(input),
    onSuccess: () => {
      //목록 캐시 무효화 → 새 세션 즉시 반영
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

//게이트 승인 (Step 32)
export function useApproveGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionCode, gate }: { sessionCode: string; gate: GateId }) =>
      approveGate(sessionCode, gate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

//세션 삭제
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionCode: string) => deleteSession(sessionCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}
