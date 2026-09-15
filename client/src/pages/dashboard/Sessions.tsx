//Sessions 대시보드 페이지
//
//기능:
//  - 세션 목록 표시 (5초마다 자동 갱신)
//  - 새 세션 생성 (condition + isTest 선택)
//  - 세션 클릭 → 참가자 URL 보기/복사 (모달)
//  - 세션 삭제
//  - All / Main / Test 탭으로 목록 구분 (주소의 ?view= 로 유지)

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useSessionList,
  useSessionDetail,
  useCreateSession,
  useDeleteSession,
  useApproveGate,
  useStopAI,
} from "@/hooks/useSessions";
import type { ConditionCode, SessionSummary } from "@/lib/api";
import { GATES } from "@/lib/gates";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isMainSession,
  parseSessionView,
  SESSION_VIEWS,
  sessionsInView,
  type SessionView,
} from "@/lib/sessionView";

const CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

const conditionLabel: Record<ConditionCode, string> = {
  C1: "C1 · Peer + XAI",
  C2: "C2 · Leader + XAI",
  C3: "C3 · Peer + ACI",
  C4: "C4 · Leader + ACI",
  CTRL: "CTRL · No AI",
};

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    completed: "bg-status-success/10 text-status-success",
    data_ready: "bg-status-success/10 text-status-success",
    in_progress: "bg-status-warning/10 text-status-warning",
    waiting: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-xs font-medium px-2.5 py-0.5 rounded-full",
        styles[status] || styles.waiting,
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
};

const Sessions = () => {
  const { data: sessions, isLoading, error } = useSessionList();
  const createMutation = useCreateSession();
  const deleteMutation = useDeleteSession();
  const stopAIMutation = useStopAI();

  const [selectedCondition, setSelectedCondition] = useState<ConditionCode>("C1");
  const [isTest, setIsTest] = useState(true);
  const [koPilot, setKoPilot] = useState(false); // [KO-PILOT]
  const [detailCode, setDetailCode] = useState<string | null>(null);

  //목록 탭 — 주소에 남겨서 새로고침/뒤로가기에도 유지. 5초 자동 갱신과는 무관.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseSessionView(searchParams.get("view"));
  const setView = (next: SessionView) =>
    setSearchParams(next === "all" ? {} : { view: next }, { replace: true });
  const visibleSessions = sessions ? sessionsInView(sessions, view) : undefined;
  const countIn = (v: SessionView) => (sessions ? sessionsInView(sessions, v).length : 0);

  const handleCreate = () => {
    createMutation.mutate(
      { conditionCode: selectedCondition, isTest, language: koPilot ? "ko" : "en" }, // [KO-PILOT]
      {
        onSuccess: (res) => {
          //생성 직후 바로 상세 모달 열기 — 어드민이 URL 복사하기 쉽게
          setDetailCode(res.session.sessionCode);
          //지금 탭에서 안 보이는 종류를 만들었으면 그 탭으로 옮김 (만든 세션이 사라진 것처럼 보이지 않게)
          const createdView: SessionView = isMainSession(res.session) ? "main" : "test";
          if (view !== "all" && view !== createdView) setView(createdView);
        },
        onError: (e) => alert(`생성 실패: ${(e as Error).message}`),
      },
    );
  };

  const handleDelete = (code: string) => {
    if (!confirm(`Delete ${code}? 참가자/메시지 모두 삭제됩니다.`)) return;
    deleteMutation.mutate(code, {
      onError: (e) => alert(`삭제 실패: ${(e as Error).message}`),
    });
  };

  //연구자 킬스위치 — Alex를 이 세션에서 영구 음소거 (사람·채팅·타이머는 계속)
  const handleStopAI = (code: string) => {
    if (!confirm(`Alex를 이 세션(${code})에서 음소거할까요? 되돌릴 수 없습니다.`)) return;
    stopAIMutation.mutate(code, {
      onSuccess: () => alert("AI muted"),
      onError: (e) => alert(`음소거 실패: ${(e as Error).message}`),
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sessions</h1>
      </div>

      {/* 생성 컨트롤 */}
      <div className="rounded-xl bg-card shadow-card p-5 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Condition</label>
          <select
            value={selectedCondition}
            onChange={(e) => setSelectedCondition(e.target.value as ConditionCode)}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {conditionLabel[c]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={isTest}
            onChange={(e) => setIsTest(e.target.checked)}
            className="rounded"
          />
          Test session (T- prefix)
        </label>

        {/* [KO-PILOT] 임시 파일럿 한국어 채팅 */}
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={koPilot}
            onChange={(e) => setKoPilot(e.target.checked)}
            className="rounded"
          />
          Korean chat (pilot)
        </label>

        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="ml-auto rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending ? "Creating…" : "Create Session"}
        </button>
      </div>

      {/* 목록 탭 */}
      <Tabs value={view} onValueChange={(v) => setView(parseSessionView(v))}>
        <TabsList>
          {SESSION_VIEWS.map((v) => (
            <TabsTrigger key={v.value} value={v.value}>
              {v.label}
              {sessions && (
                <span className="ml-1.5 text-xs text-muted-foreground">{countIn(v.value)}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 목록 */}
      <div className="rounded-xl bg-card shadow-card overflow-hidden">
        {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="p-8 text-center text-sm text-destructive">
            Error: {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Session
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Condition
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Gate
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Participants
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Created
                </th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleSessions?.map((s) => (
                <SessionRow
                  key={s.sessionCode}
                  session={s}
                  onOpen={() => setDetailCode(s.sessionCode)}
                  onDelete={() => handleDelete(s.sessionCode)}
                  onStopAI={() => handleStopAI(s.sessionCode)}
                  stopAIPending={stopAIMutation.isPending}
                />
              ))}
              {visibleSessions && visibleSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                    {view === "all" ? "No sessions yet. Create one above." : `No ${view} sessions yet.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 상세 모달 */}
      {detailCode && <SessionDetailModal code={detailCode} onClose={() => setDetailCode(null)} />}
    </div>
  );
};

//---세션 1행---
function SessionRow({
  session,
  onOpen,
  onDelete,
  onStopAI,
  stopAIPending,
}: {
  session: SessionSummary;
  onOpen: () => void;
  onDelete: () => void;
  onStopAI: () => void;
  stopAIPending: boolean;
}) {
  const max = session.conditionCode === "CTRL" ? 3 : 2;
  //AI 음소거는 진행 중 세션 + AI 있는 조건(CTRL 제외)에서만 의미 있음
  const canStopAI = session.status === "in_progress" && session.conditionCode !== "CTRL";
  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-5 py-3 font-mono text-sm font-medium">
        <button onClick={onOpen} className="hover:underline">
          {session.sessionCode}
        </button>
        {!isMainSession(session) && (
          <span className="ml-2 text-[10px] uppercase rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            test
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">
        {conditionLabel[session.conditionCode]}
      </td>
      <td className="px-5 py-3">{statusBadge(session.status)}</td>
      <td className="px-5 py-3">
        <GateCell session={session} />
      </td>
      <td className="px-5 py-3 text-sm">
        {session.participantCount}/{max}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">
        {new Date(session.createdAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {canStopAI && (
          <button
            onClick={onStopAI}
            disabled={stopAIPending}
            title="Alex를 이 세션에서 영구 음소거 (사람·채팅·타이머는 계속)"
            className="text-xs text-status-warning hover:underline font-medium mr-3 disabled:opacity-40"
          >
            Stop AI
          </button>
        )}
        <button onClick={onDelete} className="text-xs text-destructive hover:underline font-medium">
          Delete
        </button>
      </td>
    </tr>
  );
}

//---게이트 셀 (Step 32) — pending 게이트 표시 + Approve / force---
//pending 계산은 클라 config(GATES) 기준 — disabled 게이트는 건너뜀
function GateCell({ session }: { session: SessionSummary }) {
  const approveMutation = useApproveGate();
  // 2단계 인라인 확인 — 1차 클릭 arm, 2차 클릭 실행. 브라우저 confirm()을 안 써서 "대화상자 차단"으로
  // 영구 비활성화될 수 없음(기존 버그 원인). 4초 후 자동 해제.
  const [armed, setArmed] = useState<null | "approve" | "force">(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  const pending = GATES.find((g) => g.enabled && !session.gates?.approvals?.[g.id]);
  if (session.status === "data_ready" || !pending) {
    return <span className="text-sm text-muted-foreground">✓</span>;
  }

  const arrived = session.gates?.arrivals?.[pending.id] ?? 0;
  const expected = session.participantCount;
  const allArrived = arrived === expected;

  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(null);
  };
  // 같은 버튼 두 번째 클릭 = 실행. 첫 클릭 = arm (4초 타이머).
  const click = (which: "approve" | "force") => {
    if (armed === which) {
      disarm();
      approveMutation.mutate(
        { sessionCode: session.sessionCode, gate: pending.id },
        { onError: (e) => alert(`승인 실패: ${(e as Error).message}`) },
      );
      return;
    }
    setArmed(which);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), 4000);
  };

  return (
    <div className="flex items-center gap-2 text-sm whitespace-nowrap">
      <span className="text-muted-foreground">
        → {pending.nextLabel}{" "}
        <span className={cn("font-mono text-xs", allArrived && "text-status-success")}>
          {arrived}/{expected}
        </span>
      </span>
      <button
        onClick={() => click("approve")}
        disabled={!allArrived || approveMutation.isPending}
        title={
          armed === "approve"
            ? "한 번 더 누르면 즉시 승인 — 참가자들이 다음 화면으로 넘어감 (되돌릴 수 없음)"
            : `Approve '${pending.nextLabel}'`
        }
        className={cn(
          "rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40",
          armed === "approve"
            ? "bg-status-warning text-white"
            : "bg-primary text-primary-foreground",
        )}
      >
        {armed === "approve" ? "Confirm?" : "Approve"}
      </button>
      {!allArrived && (
        <button
          onClick={() => click("force")}
          disabled={approveMutation.isPending}
          title={
            armed === "force"
              ? `한 번 더 누르면 ${arrived}/${expected} 강제 승인 (솔로 테스트용)`
              : "force approve (도착 미달)"
          }
          className={cn(
            "text-[10px] underline",
            armed === "force"
              ? "text-status-warning font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {armed === "force" ? "force?" : "force"}
        </button>
      )}
    </div>
  );
}

//---상세 모달 (참가자 URL 복사)---
function SessionDetailModal({ code, onClose }: { code: string; onClose: () => void }) {
  //모달 안에서 상세 fetch는 별도 훅. import는 위에서 이미.

  const { data, isLoading } = useSessionDetail(code);

  const chatBaseUrl = window.location.origin + "/chat";

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold font-mono">{code}</h2>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {conditionLabel[data.session.conditionCode]} · {data.session.status}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

          {data && (
            <>
              <div>
                <h3 className="text-sm font-medium mb-2">Participant URLs</h3>
                <div className="space-y-2">
                  {data.participants.map((p) => {
                    const url = `${chatBaseUrl}?code=${p.participantCode}`;
                    return (
                      <div
                        key={p.participantCode}
                        className="rounded-lg border p-3 flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-muted-foreground">
                            {p.role} (profile {p.assignedProfile})
                          </div>
                          <div className="font-mono text-xs truncate mt-0.5">{url}</div>
                        </div>
                        <button
                          onClick={() => copy(url)}
                          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shrink-0"
                        >
                          Copy URL
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Distribution message</h3>
                <DistributionMessage
                  sessionCode={code}
                  participants={data.participants}
                  baseUrl={chatBaseUrl}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

//---참가자 배포 메시지 (복사 버튼)---
function DistributionMessage({
  sessionCode,
  participants,
  baseUrl,
}: {
  sessionCode: string;
  participants: { participantCode: string; role: string; assignedProfile: string }[];
  baseUrl: string;
}) {
  const message = [
    `[HAIT Study - Session — ${sessionCode}]`,
    ``,
    `The study consists of 3 parts (~45 min total):`,
    ``,
    `1. Consent & pre-survey (~10 min)`,
    `   Link: (Qualtrics link — to be added)`,
    ``,
    `2. Chat task (~20 min)`,
    ...participants.map(
      (p) => `   Participant ${p.assignedProfile}: ${baseUrl}?code=${p.participantCode}`,
    ),
    ``,
    `3. Post-survey (~10 min): you'll be guided here after the chat ends`,
  ].join("\n");

  return (
    <div className="space-y-2">
      <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap font-mono max-h-48 overflow-auto">
        {message}
      </pre>
      <button
        onClick={() => navigator.clipboard.writeText(message)}
        className="rounded-md bg-secondary text-secondary-foreground px-3 py-1.5 text-xs font-medium"
      >
        Copy message
      </button>
    </div>
  );
}

export default Sessions;
