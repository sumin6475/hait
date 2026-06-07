//Conditions 관련 React Query 훅들
//
//사용처: 대시보드 Conditions 페이지
//
//제공하는 훅:
//  useConditions() 모든 조건 목록 조회 (자동 refetch)

import { useQuery } from "@tanstack/react-query";
import { getConditions } from "@/lib/api";

const CONDITIONS_KEY = ["conditions"] as const;

//모든 조건 목록 조회
//동결 데이터라 refetch 안함
export function useConditions() {
  return useQuery({
    queryKey: CONDITIONS_KEY,
    queryFn: getConditions,
    staleTime: Infinity, //캐시 유지 영구적
    refetchOnWindowFocus: false, //포커스 시 자동 갱신 방지
  });
}
