//Sessions 대시보드 페이지
//
//기능:
//  - 세션 목록 표시 (5초마다 자동 갱신)
//  - 새 세션 생성 (condition + isTest 선택)
//  - 세션 클릭 → 참가자 URL 보기/복사 (모달)
//  - 세션 삭제

import { useState } from "react";
import {
  useSessionList,
  useSessionDetail,
  useCreateSession,
  useDeleteSession,
} from "@/hooks/useSessions";
import type { ConditionCode, SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

const CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

const conditionLabel: Record<ConditionCode, string> = {
  C1: "C1 · Peer + Explanatory",
  C2: "C2 · Leader + Explanatory",
  C3: "C3 · Peer + Anticipatory",
  C4: "C4 · Leader + Anticipatory",
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

  const [selectedCondition, setSelectedCondition] = useState<ConditionCode>("C1");
  const [isTest, setIsTest] = useState(true);
  const [detailCode, setDetailCode] = useState<string | null>(null);

  const handleCreate = () => {
    createMutation.mutate(
      { conditionCode: selectedCondition, isTest },
      {
        onSuccess: (res) => {
          //생성 직후 바로 상세 모달 열기 — 어드민이 URL 복사하기 쉽게
          setDetailCode(res.session.sessionCode);
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

        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="ml-auto rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending ? "Creating…" : "Create Session"}
        </button>
      </div>

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
              {sessions?.map((s) => (
                <SessionRow
                  key={s.sessionCode}
                  session={s}
                  onOpen={() => setDetailCode(s.sessionCode)}
                  onDelete={() => handleDelete(s.sessionCode)}
                />
              ))}
              {sessions && sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    No sessions yet. Create one above.
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
}: {
  session: SessionSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const max = session.conditionCode === "CTRL" ? 3 : 2;
  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-5 py-3 font-mono text-sm font-medium">
        <button onClick={onOpen} className="hover:underline">
          {session.sessionCode}
        </button>
        {session.isTest && (
          <span className="ml-2 text-[10px] uppercase rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            test
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">
        {conditionLabel[session.conditionCode]}
      </td>
      <td className="px-5 py-3">{statusBadge(session.status)}</td>
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
      <td className="px-5 py-3 text-right">
        <button onClick={onDelete} className="text-xs text-destructive hover:underline font-medium">
          Delete
        </button>
      </td>
    </tr>
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
  participants: { participantCode: string; role: string }[];
  baseUrl: string;
}) {
  const message = [
    `[HAIT 실험 안내 — ${sessionCode}]`,
    ``,
    `실험은 3단계로 진행됩니다 (총 ~45분):`,
    ``,
    `1. 사전 동의 + 설문 (~10분)`,
    `   링크: (Qualtrics 링크 — 곧 추가)`,
    ``,
    `2. 채팅 실험 (~20분)`,
    ...participants.map((p) => `   ${p.role}: ${baseUrl}?code=${p.participantCode}`),
    ``,
    `3. 사후 설문 (~10분): 채팅 종료 후 안내됩니다`,
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
