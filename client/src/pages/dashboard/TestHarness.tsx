//Test Harness — 채팅만 바로 테스트하는 개발용 화면.
//
//전체 온보딩(consent→demographics→...→waiting) 없이, 선택한 조건으로 테스트 세션을
//즉석 생성하고 좌(참가자 X)·우(참가자 Y) 두 iframe으로 실제 /chat/room을 띄운다.
//
//왜 iframe인가: client/src/lib/socket.ts의 socket은 모듈 싱글톤이라 한 페이지에
//ChatRoom을 둘 렌더하면 소켓 하나를 두고 충돌한다. same-origin iframe은 각자 별도
//브라우징 컨텍스트 → 각자 소켓 연결을 가지므로, 프로덕션 ChatRoom이 그대로(리더 오프닝/
//개입 judge/클로징 전부) 동작한다. ChatRoom은 URL 쿼리(?session=&participant=)를
//sessionStorage보다 우선 읽도록 되어 있어 두 iframe이 X/Y로 갈린다.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw, Download, Trash2, FlaskConical } from "lucide-react";
import { useCreateSession, useDeleteSession } from "@/hooks/useSessions";
import { exportSession, type ConditionCode, type SessionExport } from "@/lib/api";

//AI가 있는 조건만 (CTRL은 사람 3명·AI 없음 → 테스트 대상 아님)
const CONDITIONS: { code: ConditionCode; label: string; leader: boolean }[] = [
  { code: "C1", label: "C1 (peer)", leader: false },
  { code: "C2", label: "C2 (leader)", leader: true },
  { code: "C3", label: "C3 (peer)", leader: false },
  { code: "C4", label: "C4 (leader)", leader: true },
];

type Run = { sessionCode: string; x: string; y: string };

//senderRole → 표시 라벨 (마크다운 전사용)
const ROLE_LABEL: Record<string, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
  ai: "AI",
};

//읽기 쉬운 마크다운 전사 + AI 개입 부록 생성 (클라 전용 — 서버 추가 호출 없음)
function toMarkdown(data: SessionExport): string {
  const lines: string[] = [];
  lines.push(`# ${data.session.sessionCode} (${data.session.conditionCode})`);
  lines.push(
    `status: ${data.session.status} · language: ${data.session.language} · ` +
      `started: ${data.session.startedAt ?? "—"} · ended: ${data.session.endedAt ?? "—"}`,
  );
  if (data.session.aiState) {
    lines.push(
      `AI: ${data.session.aiState.lifecycle ?? "—"} · summary: ` +
        `${data.session.aiState.summaryStatus ?? "—"} · mediation latched: ` +
        `${data.session.aiState.mediationLatched ?? false}`,
    );
  }
  lines.push("");
  lines.push("## Transcript");
  for (const m of data.messages) {
    lines.push(`**[${m.seq}] ${ROLE_LABEL[m.senderRole] ?? m.senderRole}:** ${m.content}`);
  }
  lines.push("");
  lines.push("## AI interventions");
  lines.push(
    "| turn | stage | decision | route | source | judge | outcome | route reason | silence reason | floor | evidence |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const i of data.interventions) {
    const evidence = (i.judgeEvidence ?? i.priorityEvidence ?? i.silenceReason ?? i.why ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
    lines.push(
      `| ${i.turnIndex} | ${i.decisionStage ?? "—"} | ${i.decision} | ` +
        `${i.routeKind ?? "—"} | ${i.source ?? "—"} | ${i.mainJudgeDecision ?? "—"} | ` +
        `${i.outcome ?? "—"} | ${i.routeReason ?? "—"} | ${i.silenceReason ?? "—"} | ` +
        `${i.floorMs ?? 0}ms | ${evidence} |`,
    );
  }
  return lines.join("\n");
}

//Blob 다운로드 (의존성 없음)
function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const chatSrc = (sessionCode: string, participantCode: string) =>
  `/chat/room?session=${encodeURIComponent(sessionCode)}&participant=${encodeURIComponent(participantCode)}`;

const TestHarness = () => {
  const [condition, setCondition] = useState<ConditionCode>("C2");
  const [language, setLanguage] = useState<"en" | "ko">("en");
  const [run, setRun] = useState<Run | null>(null);
  const [iframeKey, setIframeKey] = useState(0); //bump → 두 iframe 강제 remount (새 소켓)
  const [downloading, setDownloading] = useState(false);

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  //새 런: 테스트 세션 생성 → X/Y 코드 추출 → iframe 재마운트
  const onStart = async () => {
    const resp = await createSession.mutateAsync({ conditionCode: condition, isTest: true, language });
    const x = resp.participants.find((p) => p.assignedProfile === "X")?.participantCode;
    const y = resp.participants.find((p) => p.assignedProfile === "Y")?.participantCode;
    if (!x || !y) {
      console.error("[harness] X/Y participant code missing", resp.participants);
      return;
    }
    setRun({ sessionCode: resp.session.sessionCode, x, y });
    setIframeKey((k) => k + 1);
  };

  //같은 세션 재접속 (끊김 복구) — 세션 재생성 없이 iframe만 다시
  const onReload = () => setIframeKey((k) => k + 1);

  const onDownload = async (fmt: "json" | "md") => {
    if (!run) return;
    setDownloading(true);
    try {
      const data = await exportSession(run.sessionCode);
      if (fmt === "json") {
        download(`${run.sessionCode}.json`, JSON.stringify(data, null, 2), "application/json");
      } else {
        download(`${run.sessionCode}.md`, toMarkdown(data), "text/markdown");
      }
    } catch (e) {
      console.error("[harness] export failed", e);
    } finally {
      setDownloading(false);
    }
  };

  const onDelete = async () => {
    if (!run) return;
    await deleteSession.mutateAsync(run.sessionCode);
    setRun(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/*컨트롤 바*/}
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-card flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          <span className="font-semibold">Test Harness</span>
        </div>

        {/*조건 선택*/}
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {CONDITIONS.map((c) => (
            <button
              key={c.code}
              onClick={() => setCondition(c.code)}
              className={
                "px-3 py-1.5 text-sm rounded-md transition-colors " +
                (condition === c.code
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground")
              }
              title={c.leader ? "리더 조건 — 첫 멘트/클로징 발동" : "peer 조건"}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/*언어 토글*/}
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(["en", "ko"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={
                "px-3 py-1.5 text-sm rounded-md transition-colors " +
                (language === l
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <Button onClick={onStart} disabled={createSession.isPending} className="gap-2">
          <Play className="w-4 h-4" />
          {run ? "Start new run" : "Start"}
        </Button>

        {run && (
          <>
            <Button onClick={onReload} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload panes
            </Button>
            <Button
              onClick={() => onDownload("json")}
              variant="outline"
              disabled={downloading}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              JSON
            </Button>
            <Button
              onClick={() => onDownload("md")}
              variant="outline"
              disabled={downloading}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              MD
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              disabled={deleteSession.isPending}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {run.sessionCode}
            </span>
          </>
        )}
      </div>

      {/*두 채팅 창 (X 좌 · Y 우)*/}
      {run ? (
        <div className="flex-1 grid grid-cols-2 gap-px bg-border min-h-0">
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground border-b bg-muted/40">
              ← Participant X
            </div>
            <iframe
              key={`x-${iframeKey}`}
              title="Participant X"
              src={chatSrc(run.sessionCode, run.x)}
              className="w-full flex-1 border-0"
            />
          </div>
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground border-b bg-muted/40">
              Participant Y →
            </div>
            <iframe
              key={`y-${iframeKey}`}
              title="Participant Y"
              src={chatSrc(run.sessionCode, run.y)}
              className="w-full flex-1 border-0"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          조건을 고르고 <span className="mx-1 font-semibold text-foreground">Start</span>를 누르면
          두 참가자 채팅 창이 좌우로 열립니다.
        </div>
      )}
    </div>
  );
};

export default TestHarness;
