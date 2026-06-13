//연구자 승인 대기 공용 화면 (Step 32) — /chat/hold/:gateId
//마운트 시 도착 기록(fire-and-forget) 후 2.5초 폴링으로 승인 감지 → 다음 단계로 전환.
//6개 게이트가 전부 이 화면 하나를 재사용한다 (게이트별 차이는 gates.ts config).

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Hourglass } from "lucide-react";
import { getParticipantState, markGateArrival } from "@/lib/api";
import { gateById, gateOpen, type GateId } from "@/lib/gates";

const POLL_INTERVAL_MS = 2500;

const Hold = () => {
  const navigate = useNavigate();
  const { gateId } = useParams();
  const [dots, setDots] = useState(0);
  const [checkedOnce, setCheckedOnce] = useState(false);

  const gate = gateId ? gateById(gateId) : undefined;
  const participantCode = sessionStorage.getItem("participantCode") ?? "";

  useEffect(() => {
    if (!gate || !participantCode) {
      navigate("/chat");
      return;
    }

    //도착 기록 — 실패해도 대기/폴링은 계속 (markProgress 관례 동일)
    markGateArrival(participantCode, gate.id as GateId).catch((error) => {
      console.error("[Hold] markGateArrival failed:", error);
    });

    let cancelled = false;
    const check = async () => {
      try {
        const state = await getParticipantState(participantCode);
        if (cancelled) return;
        setCheckedOnce(true);
        if (state.completedAt) {
          navigate("/chat/complete", { replace: true });
          return;
        }
        //[Step 25 일관성] G4 승인 직후 새로고침해도 같은 곳 — 세션 시작됐으면 토론방 직행
        if (gate.id === "waiting" && state.sessionStatus === "in_progress") {
          navigate("/chat/room", { replace: true });
          return;
        }
        if (gateOpen(gate.id, state.approvals)) {
          navigate(gate.nextPath, { replace: true });
        }
      } catch (error) {
        console.error("[Hold] state poll failed:", error);
      }
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId]);

  //dots 애니메이션 (WaitingRoom과 동일)
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);

  if (!gate) return null;

  //첫 fetch 전에는 스피너만 (승인/disabled 시 깜빡 1프레임 허용)
  if (!checkedOnce) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center space-y-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Hourglass className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Please wait</h1>
          <p className="text-sm text-muted-foreground mt-2">
            The researcher will start the next part shortly{".".repeat(dots)}
          </p>
        </div>

        <div className="space-y-3 bg-card rounded-xl border p-6">
          <p className="text-sm">
            Next: <span className="font-medium">{gate.nextLabel}</span>
          </p>
          {gate.holdNote && <p className="text-xs text-muted-foreground">{gate.holdNote}</p>}
        </div>

        <p className="text-xs text-muted-foreground font-mono">{participantCode}</p>
      </div>
    </div>
  );
};

export default Hold;
