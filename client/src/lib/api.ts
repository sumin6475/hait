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
export type Candidate = "A" | "B" | "C" | "D";
export type SenderRole = ParticipantRole | "ai";
export type ProgressStep =
  | "consent"
  | "demographics"
  | "infoCards"
  | "preDiscussion"
  | "waiting"
  | "teamDecision"
  | "postSurvey"
  | "debrief"
  | "complete";
export interface ProgressState {
  consent?: boolean;
  demographics?: boolean;
  infoCards?: boolean;
  preDiscussion?: boolean;
  waiting?: boolean;
  teamDecision?: boolean;
  postSurvey?: boolean;
  debrief?: boolean;
  complete?: boolean;
}
export interface ParticipantState {
  participantCode: string;
  role: ParticipantRole;
  assignedProfile: ProfileSlot;
  sessionCode: string;
  conditionCode: ConditionCode;
  progress: ProgressState;
  preDiscussionChoice?: Candidate | null;
  completedAt?: string | null;
}

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
  messages: Array<{
    seq: number;
    sender: string;
    senderRole: SenderRole;
    content: string;
    createdAt: string;
  }>;
}

export interface CreateSessionResponse {
  isTest: boolean;
  session: SessionDetail["session"];
  participants: ParticipantInfo[];
}

//---내부 fetch 헬퍼---
//각 API 호출에 대한 공통 헤더 설정

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    //관리자 인증 헤더 추가
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

//--public fetch (인증 없음) - 참가자 클라이언트용 ---
async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  //res.ok === false (HTTP 에러) || data?.ok === false (서버 에러)
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
  return { session: data.session, participants: data.participants, messages: data.messages };
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

//---Participant API (public)---

//progress step 마킹 - 각 페이지 완료 시점에 호출
export async function markProgress(
  participantCode: string,
  step: ProgressStep,
): Promise<ProgressState> {
  const data = await publicFetch<{ ok: true; progress: ProgressState }>(
    `/api/participants/${encodeURIComponent(participantCode)}/progress`,
    {
      method: "PATCH",
      body: JSON.stringify({ step }),
    },
  );
  return data.progress;
}

//pre-discussion choice 저장
export async function setPreChoice(participantCode: string, choice: Candidate): Promise<Candidate> {
  const data = await publicFetch<{ ok: true; preDiscussionChoice: Candidate }>(
    `/api/participants/${encodeURIComponent(participantCode)}/pre-choice`,
    {
      method: "PATCH",
      body: JSON.stringify({ choice }),
    },
  );
  return data.preDiscussionChoice;
}

//재접속 시 현재 상태 조회
export async function getParticipantState(participantCode: string): Promise<ParticipantState> {
  const data = await publicFetch<{ ok: true; state: ParticipantState }>(
    `/api/participants/${encodeURIComponent(participantCode)}/state`,
  );
  return data.state;
}

//team-decision 저장 (참가자가 호출, status: in_progress -> completed)
export async function submitTeamDecision(
  sessionCode: string,
  participantCode: string,
  decision: Candidate,
): Promise<{
  teamDecision: Candidate[];
  status: SessionStatus;
  submittedCount: number;
  expected: number;
}> {
  const data = await publicFetch<{
    ok: true;
    sessionCode: string;
    teamDecision: Candidate[];
    status: SessionStatus;
    submittedCount: number;
    expected: number;
  }>(`/api/sessions/${encodeURIComponent(sessionCode)}/team-decision`, {
    method: "PATCH",
    body: JSON.stringify({ participantCode, decision }),
  });
  return {
    teamDecision: data.teamDecision,
    status: data.status,
    submittedCount: data.submittedCount,
    expected: data.expected,
  };
}

//finalize 호출 (참가자가 호출, status: completed -> data_ready)
export async function finalizeSession(sessionCode: string): Promise<{ status: SessionStatus }> {
  const data = await publicFetch<{
    ok: true;
    sessionCode: string;
    status: SessionStatus;
  }>(`/api/sessions/${encodeURIComponent(sessionCode)}/finalize`, {
    method: "PATCH",
  });
  return {
    status: data.status,
  };
}
