import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Settings2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConditionCode, RouteKind } from "@/types";
import { useConditions } from "@/hooks/useConditions";
import { conditionLabel } from "@/lib/conditions";
import { postTestChat } from "@/lib/api";

const matrix: [ConditionCode, ConditionCode][] = [
  ["C1", "C2"],
  ["C3", "C4"],
];

//Test Chat 시뮬레이션 대본
//X/Y는 고정 텍스트, AI는 trigger 라벨만 (text는 런타임 호출)
type ScriptTurn =
  | { speaker: "X" | "Y"; text: string }
  | { speaker: "AI" };

//실제 trigger 임계값 (config/triggers.ts와 동기) — 라벨 표시용
const TRIGGER_LABEL: Record<string, string> = {
  address: "direct address · 2s floor",
  followup: "single reply after Alex · 2s floor",
  long_silence: "15s silence · no extra floor",
  build_on: "main judge contribution · 3s floor",
  mediation: "leader coverage intervention · 3s floor",
  backchannel: "main judge acknowledgment · 3s floor",
  greeting: "session start",
  summary: "one-time leader checkpoint · 3s floor",
  closing: "30-minute deadline or manual stop",
};

const ROUTE_ORDER: RouteKind[] = [
  "greeting",
  "address",
  "followup",
  "long_silence",
  "build_on",
  "mediation",
  "backchannel",
  "summary",
  "closing",
];

//hidden_profile_integration 대본 (sender는 humanX/humanY — eval과 동일)
const SCRIPT: ScriptTurn[] = [
  {
    speaker: "X",
    text: "From my side: Candidate C is stress resistant and promotes a good atmosphere within the crew. But Candidate A is sometimes hectic and doesn't tolerate criticism.",
  },
  {
    speaker: "Y",
    text: "On my end, Candidate C is very conscientious and skilled with complicated technology. Candidate B gossips about coworkers and isn't very cooperative.",
  },
  {
    speaker: "X",
    text: "Also, Candidate D is considered arrogant and not well suited for leading a team.",
  },
  { speaker: "Y", text: "Hmm, and Candidate B has a below-average memory for numbers too." },
  { speaker: "X", text: "Right. So what does everyone think so far?" },
  { speaker: "AI" },
  { speaker: "Y", text: "I'm leaning toward C based on what we've shared." },
  { speaker: "X", text: "Same, C seems strong on the safety side." },
  { speaker: "X", text: "..." },
  { speaker: "AI" },
];

//화면 표시용 메시지 (재생 중 누적)
interface PlayedMessage {
  speaker: "X" | "Y" | "AI";
  text: string;
  trigger?: string; //AI만
  latencyMs?: number; //AI만
}

//audit.final_scores 타입 (표시용으로만 좁힘)
interface AuditScores {
  status_target?: number;
  status_opposite?: number;
  strategy_target?: number;
  strategy_opposite?: number;
}
interface AuditShape {
  final_scores?: AuditScores;
  critic_rationale?: string;
  loop_iterations?: number;
}

const Conditions = () => {
  const { data, isLoading, isError, error } = useConditions();
  const [selected, setSelected] = useState<ConditionCode>("C1");
  const [selectedRoute, setSelectedRoute] = useState<RouteKind>("build_on");
  const [testOpen, setTestOpen] = useState(false);
  //Test Chat 시뮬레이션 상태
  const [step, setStep] = useState(0); //대본 진행 인덱스
  const [played, setPlayed] = useState<PlayedMessage[]>([]); //재생된 메시지 누적
  const [loading, setLoading] = useState(false); //AI 호출 중
  const [variants, setVariants] = useState<PlayedMessage[]>([]); //끝에서 반복 생성한 응답들
  const [testError, setTestError] = useState<string | null>(null);

  const atEnd = step >= SCRIPT.length;

  const selectedEntry = data?.conditions?.[selected];
  const availableRoutes = ROUTE_ORDER.filter((route) => selectedEntry?.routes?.[route]);
  useEffect(() => {
    if (selected === "CTRL") return;
    if (!selectedEntry?.routes?.[selectedRoute] && availableRoutes.length) {
      setSelectedRoute(availableRoutes[0]);
    }
  }, [availableRoutes, selected, selectedEntry, selectedRoute]);

  //모달 열 때 초기화
  const openTest = () => {
    setStep(0);
    setPlayed([]);
    setVariants([]);
    setTestError(null);
    setTestOpen(true);
  };

  //transcript 빌드 (AI 호출용) — played를 humanX/humanY/ai sender로 변환
  const buildTranscript = (msgs: PlayedMessage[]) =>
    msgs.map((m) => ({
      sender: m.speaker === "X" ? "humanX" : m.speaker === "Y" ? "humanY" : "ai",
      content: m.text,
    }));

  //"다음" — 대본 한 턴 진행
  const handleNext = async () => {
    if (atEnd || loading) return;
    const turn = SCRIPT[step];

    if (turn.speaker !== "AI") {
      //X/Y — 고정 텍스트 즉시 추가
      setPlayed((p) => [...p, { speaker: turn.speaker, text: turn.text }]);
      setStep((s) => s + 1);
      return;
    }

    //AI — 누적 transcript로 호출
    setLoading(true);
    setTestError(null);
    try {
      const res = await postTestChat({
        conditionCode: selected,
        routeKind: selectedRoute,
        transcript: buildTranscript(played),
      });
      setPlayed((p) => [
        ...p,
        { speaker: "AI", text: res.content, trigger: selectedRoute, latencyMs: res.latencyMs },
      ]);
      setStep((s) => s + 1);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  //"한 번 더 생성" — 끝에서 같은 누적 transcript로 AI 재호출 (variant 누적)
  const handleRegenerate = async () => {
    if (loading) return;
    setLoading(true);
    setTestError(null);
    try {
      //마지막 AI 발화 직전까지의 transcript (= 마지막 AI가 받았던 것과 동일)
      const beforeLastAI = played.slice(0, played.length - 1);
      const res = await postTestChat({
        conditionCode: selected,
        routeKind: selectedRoute,
        transcript: buildTranscript(beforeLastAI),
      });
      setVariants((v) => [...v, { speaker: "AI", text: res.content, latencyMs: res.latencyMs }]);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  //선택된 조건의 동결 데이터 (CTRL은 JSON에 없음 → undefined)
  const entry = data?.conditions?.[selected];
  const routeEntry = entry?.routes?.[selectedRoute];
  const audit = entry?.audit as AuditShape | undefined;
  const scores = audit?.final_scores;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-semibold">Condition Manager</h1>
        </div>
        {/* 읽기 전용 안내 — IRB 무결성 */}
        <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
          Read-only · immutable route snapshot
        </span>
      </div>

      {/* 로딩/에러 */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading frozen prompts…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load conditions: {(error as Error)?.message}
        </div>
      )}

      {/* Condition Matrix */}
      <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-center">
          <div />
          <div className="text-xs font-semibold text-muted-foreground uppercase">Peer AI</div>
          <div className="text-xs font-semibold text-muted-foreground uppercase">Leader AI</div>
        </div>
        {(["XAI", "ACI"] as const).map((strat, ri) => (
          <div key={strat} className="grid grid-cols-[120px_1fr_1fr] gap-2">
            <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
              {strat} Strategy
            </div>
            {matrix[ri].map((code) => (
              <button
                key={code}
                onClick={() => setSelected(code)}
                className={cn(
                  "rounded-lg border-2 p-4 text-left transition-all",
                  selected === code
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                    : "border-input hover:border-primary/40",
                )}
              >
                <div className="font-mono font-bold text-sm">{code}</div>
                <div className="text-xs text-muted-foreground mt-1">{conditionLabel[code]}</div>
                <div className="text-xs text-muted-foreground/60 mt-1">
                  v{data?.conditions?.[code]?.version ?? "—"}
                </div>
              </button>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
            Control
          </div>
          <button
            onClick={() => setSelected("CTRL")}
            className={cn(
              "rounded-lg border-2 p-4 text-left transition-all",
              selected === "CTRL"
                ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                : "border-input hover:border-primary/40",
            )}
          >
            <div className="font-mono font-bold text-sm">CTRL</div>
            <div className="text-xs text-muted-foreground mt-1">3-human team, no AI</div>
          </button>
        </div>
      </div>

      {/* CTRL 선택 시 — 프롬프트 없음 안내 */}
      {selected === "CTRL" ? (
        <div className="rounded-xl border bg-card p-6 shadow-card text-sm text-muted-foreground">
          CTRL is a 3-human team with no AI participant. There is no system prompt for this
          condition.
        </div>
      ) : (
        <>
          {/* Audit Scores — 품질 baseline (PMS critic) */}
          {scores && (
            <div className="rounded-xl border bg-card p-6 shadow-card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Manipulation Check — PMS critic baseline</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ScoreCard label="Status — target" value={scores.status_target} good />
                <ScoreCard label="Status — opposite" value={scores.status_opposite} />
                <ScoreCard label="Strategy — target" value={scores.strategy_target} good />
                <ScoreCard label="Strategy — opposite" value={scores.strategy_opposite} />
              </div>
              {audit?.critic_rationale && (
                <p className="text-xs text-muted-foreground leading-relaxed border-t pt-3">
                  {audit.critic_rationale}
                </p>
              )}
            </div>
          )}

          {/* System Prompt — 읽기 전용 스크롤 박스 */}
          <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
            <div className="flex flex-wrap gap-2 pb-2">
              {availableRoutes.map((route) => (
                <Button
                  key={route}
                  variant={selectedRoute === route ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedRoute(route)}
                >
                  {route}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">System Prompt — {selected}.{selectedRoute}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {conditionLabel[selected]} · v{routeEntry?.version ?? "—"} ·{" "}
                  {routeEntry?.promptKey ?? ""}
                  {routeEntry ? ` · ${routeEntry.prompt.length.toLocaleString()} chars` : ""}
                </p>
                {routeEntry && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-1 break-all">
                    sha256 {routeEntry.hash}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={openTest} disabled={!routeEntry}>
                <Play className="w-3.5 h-3.5 mr-1.5" /> Test Chat
              </Button>
            </div>
            <pre className="w-full max-h-[36rem] overflow-auto rounded-lg border border-input bg-muted/30 px-4 py-3 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
              {routeEntry?.prompt ?? ""}
            </pre>
          </div>
        </>
      )}

      {/* Test Chat — 시뮬레이션 재생기 */}
      {testOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTestOpen(false)} />
          <div className="relative w-full max-w-md bg-card border-l shadow-xl flex flex-col animate-in slide-in-from-right">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">
                  Test Chat — {selected}.{selectedRoute}: {conditionLabel[selected]}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Scripted simulation · live runtime model · not saved
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setTestOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {played.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Press "Next" to play the scripted discussion. Alex (AI) responds live at each
                  trigger point.
                </p>
              )}
              {played.map((m, i) => (
                <MsgBubble key={i} m={m} />
              ))}

              {/* 끝에서 반복 생성한 variant들 */}
              {atEnd && variants.length > 0 && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Regenerated variants (same transcript)
                  </p>
                  {variants.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5"
                    >
                      <div className="text-[10px] font-mono text-primary/70 mb-1">
                        variant #{i + 1} · {m.latencyMs}ms
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Alex is responding…
                </div>
              )}
              {testError && (
                <div className="text-xs text-destructive border border-destructive/30 rounded-lg p-2">
                  {testError}
                </div>
              )}
            </div>

            {/* 컨트롤 */}
            <div className="border-t p-4 space-y-2">
              {!atEnd ? (
                <Button className="w-full" onClick={handleNext} disabled={loading}>
                  {SCRIPT[step]?.speaker === "AI" ? "Next — trigger Alex's response" : "Next"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={loading}
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Generate again (same transcript)
                </Button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                {atEnd
                  ? `Script complete (${played.length} turns). Regenerate to compare AI variants.`
                  : `Turn ${step + 1} of ${SCRIPT.length}`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

//audit 점수 카드 — good=목표 차원(높을수록 좋음), 그 외 = 반대 차원(낮을수록 좋음)
const ScoreCard = ({ label, value, good }: { label: string; value?: number; good?: boolean }) => (
  <div className="rounded-lg border p-3">
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
      {label}
    </div>
    <div
      className={cn(
        "text-2xl font-bold mt-1 font-mono",
        good ? "text-status-success" : "text-muted-foreground",
      )}
    >
      {value != null ? value : "—"}
    </div>
  </div>
);

//Test Chat 메시지 버블 — AI는 트리거 배지 + 색 구분(결정 2-나)
const MsgBubble = ({ m }: { m: PlayedMessage }) => {
  const isAI = m.speaker === "AI";
  return (
    <div className={cn("flex gap-3", isAI && "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          isAI ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isAI ? "A" : m.speaker}
      </div>
      <div className="flex-1 min-w-0">
        {isAI && m.trigger && (
          <div className="text-[10px] font-mono text-primary/70 mb-1">
            ⚡ {m.trigger} · {TRIGGER_LABEL[m.trigger]}
            {m.latencyMs != null ? ` · ${m.latencyMs}ms` : ""}
          </div>
        )}
        <div
          className={cn(
            "rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
            isAI ? "border-2 border-primary/30 bg-primary/5" : "bg-muted/50",
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
};

export default Conditions;
