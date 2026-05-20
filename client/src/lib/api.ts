//Admin API 호출 wrapper
//
//환경변수:
//  VITE_SERVER_URL    예: http://localhost:3001 / https://hait-server.up.railway.app
//  VITE_ADMIN_TOKEN   서버 .env의 ADMIN_TOKEN과 일치해야 함
//
//모든 admin API 호출은 x-admin-token 헤더 자동 포함
//에러는 throw — React Query가 잡아서 처리

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "";

//---타입 (서버 응답과 동기화 유지)---

export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type ProfileSlot = "X" | "Y" | "Z";

export interface SessionSummary {
  sessionCode: string;
  conditionCode: ConditionCode;
  status: SessionStatus;
  isTest: boolean;
  participantCount: number;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
}

export interface ParticipantInfo {
  participantCode: string;
  role: ParticipantRole;
  assignedProfile: ProfileSlot;
  connectedAt?: string | null;
  lastSeenAt?: string | null;
}

export interface SessionDetail {
  session: {
    sessionCode: string;
    conditionCode: ConditionCode;
    status: SessionStatus;
    isTest: boolean;
    startedAt?: string | null;
    endedAt?: string | null;
    createdAt: string;
  };
  participants: ParticipantInfo[];
}

export interface CreateSessionResponse {
  isTest: boolean;
  session: SessionDetail["session"];
  participants: ParticipantInfo[];
}

//---내부 fetch 헬퍼---

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_TOKEN,
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }

  return data as T;
}

//---API 함수들---

//세션 목록
export async function listSessions(): Promise<SessionSummary[]> {
  const data = await adminFetch<{ ok: true; sessions: SessionSummary[] }>("/api/sessions");
  return data.sessions;
}

//세션 단건 + 참가자
export async function getSession(sessionCode: string): Promise<SessionDetail> {
  const data = await adminFetch<{ ok: true } & SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionCode)}`,
  );
  return { session: data.session, participants: data.participants };
}

//세션 생성
export async function createSession(input: {
  conditionCode: ConditionCode;
  isTest?: boolean;
}): Promise<CreateSessionResponse> {
  const data = await adminFetch<{ ok: true } & CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return {
    isTest: data.isTest,
    session: data.session,
    participants: data.participants,
  };
}

//세션 삭제
export async function deleteSession(sessionCode: string): Promise<void> {
  await adminFetch(`/api/sessions/${encodeURIComponent(sessionCode)}`, {
    method: "DELETE",
  });
}
