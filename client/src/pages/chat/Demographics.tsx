import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ClipboardList, ExternalLink } from "lucide-react";
import { markProgress } from "@/lib/api";

//Qualtrics 사전 설문 URL (환경변수)
const DEMOGRAPHICS_URL =
  import.meta.env.VITE_QUALTRICS_DEMOGRAPHICS_URL ?? "https://qualtrics.com/CHANGE_ME_DEMOGRAPHICS";

const Demographics = () => {
  const navigate = useNavigate();
  const participantCode = sessionStorage.getItem("participantCode") ?? "";

  const demoLinkWithCode = `${DEMOGRAPHICS_URL}?ParticipantCode=${encodeURIComponent(participantCode)}`;

  const handleContinue = () => {
    //버튼 클릭 자체가 완료 확인 — window.confirm()은 "추가 대화상자 차단" 체크 시 먹통(파일럿 중 발견)이라 제거.
    if (participantCode) {
      markProgress(participantCode, "demographics").catch((error) => {
        console.error("[Demographics] markProgress failed:", error);
      });
    }
    navigate("/chat/hold/infoCards");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-7 h-7 text-primary" />
          </div>

          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Step 2 of 3
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Pre-Discussion Survey</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please complete the pre-discussion survey in a new tab.
            </p>
          </div>

          <div className="w-full rounded-xl bg-card shadow-card p-6 space-y-4">
            <div className="rounded-lg bg-muted/40 p-4 space-y-1">
              <p className="text-xs text-muted-foreground">Your participant code</p>
              <p className="font-mono text-sm font-medium">{participantCode || "—"}</p>
              <p className="text-xs text-muted-foreground mt-2">
                This code will be auto-filled in the Qualtrics form. If asked, do not change it.
              </p>
            </div>

            <a
              href={demoLinkWithCode}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Open pre-discussion survey
              <ExternalLink className="w-4 h-4" />
            </a>

            <Button onClick={handleContinue} variant="outline" className="w-full" size="lg">
              I've completed the survey
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-md">
            The survey opens in a new tab. After you submit it on Qualtrics, return here and click
            "I've completed the survey" to continue.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Demographics;
