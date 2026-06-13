import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveResumePath } from "@/lib/resumeRouter";
import { getParticipantState } from "@/lib/api";

//참가자 코드 형식:
//  실제: P-X-C1-001, P-Y-CTRL-001
//  테스트: TP-X-C1-001, TP-Z-CTRL-001
const CODE_PATTERN = /^T?P-[XYZ]-(C[1-4]|CTRL)-\d{3}$/;

const CodeEntry = () => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  //URL에 ?code=... 있으면 자동 채움 (어드민이 배포한 링크 클릭 시)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code");
    if (codeParam) {
      setCode(codeParam.toUpperCase());
      setAutoFilled(true);
    }
  }, []);

  const validateCode = (c: string) => CODE_PATTERN.test(c);

  //코드 파싱 → sessionStorage 저장
  //예: TP-X-C1-001 → { role: "humanX", condition: "C1", isTest: true, seq: "001", sessionCode: "T-C1-001" }
  const parseAndStore = (raw: string) => {
    const upper = raw.toUpperCase();
    //prefix(T?P), slot, condition, seq
    const parts = upper.split("-");
    //TP-X-C1-001 → ["TP","X","C1","001"]
    //P-X-C1-001  → ["P","X","C1","001"]
    const isTest = parts[0] === "TP";
    const slot = parts[1]; //X|Y|Z
    const condition = parts[2]; //C1|C2|C3|C4|CTRL
    const seq = parts[3];
    const sessionPrefix = isTest ? "T" : "S";
    const sessionCode = `${sessionPrefix}-${condition}-${seq}`;
    const role = `human${slot}`;

    sessionStorage.setItem("participantCode", upper);
    sessionStorage.setItem("sessionCode", sessionCode);
    sessionStorage.setItem("condition", condition);
    sessionStorage.setItem("role", role);
    sessionStorage.setItem("assignedProfile", slot);
    sessionStorage.setItem("isTest", String(isTest));
  };

  const handleSubmit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter your participant code.");
      return;
    }
    if (!validateCode(trimmed)) {
      setError("Invalid code format. Example: P-X-C1-001");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      //DB에서 상태 조회 → 재접속 시 어디로 이어갈지 결정
      const state = await getParticipantState(trimmed);

      //sessionStorage 저장 후 분기
      parseAndStore(trimmed);
      //[Step 26-D] 서버 state 기준으로 저장 — WaitingRoom이 읽는 "conditionCode" 키
      //(parseAndStore는 "condition" 키라 WaitingRoom isCTRL이 항상 false였음 → AI Alex 오표시)
      sessionStorage.setItem("conditionCode", state.conditionCode);
      sessionStorage.setItem("assignedProfile", state.role.replace("human", ""));
      const nextPath = resolveResumePath(state);
      navigate(nextPath);
    } catch (error) {
      console.error("[CodeEntry] getParticipantState failed:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      //participant_not_found = 코드는 형식 맞지만 DB에 없음
      if (message === "participant_not_found") {
        setError("Code not found. Please contact the research team.");
      } else {
        setError("Could not connect to the server. Please try again.");
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FlaskConical className="w-7 h-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">HAIT Experiment</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {autoFilled
                ? "Your code has been filled in. Please confirm and continue."
                : "Enter your participant code to begin"}
            </p>
          </div>
          <div className="w-full space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="P-X-C1-001"
              className={cn(
                "w-full rounded-lg border bg-card px-4 py-3 text-center font-mono text-lg tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring",
                error ? "border-destructive focus:ring-destructive" : "border-input",
              )}
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={handleSubmit} className="w-full" size="lg" disabled={submitting}>
              {submitting ? "Checking..." : "Continue"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Your code was provided by the research team.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CodeEntry;
