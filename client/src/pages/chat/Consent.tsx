import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { markProgress } from "@/lib/api";

//Qualtrics 동의서 URL (환경변수)
//participantCode를 ?ParticipantCode= 으로 자동 전달
const CONSENT_URL =
  import.meta.env.VITE_QUALTRICS_CONSENT_URL ?? "https://qualtrics.com/CHANGE_ME_CONSENT";

const Consent = () => {
  const navigate = useNavigate();
  const participantCode = sessionStorage.getItem("participantCode") ?? "";

  //Qualtrics URL에 participantCode 자동 첨부
  const consentLinkWithCode = `${CONSENT_URL}?ParticipantCode=${encodeURIComponent(participantCode)}`;

  const handleContinue = () => {
    const confirmed = window.confirm(
      "Have you finished the consent form on Qualtrics?\n\nClick OK only if you have submitted your consent.",
    );
    if (confirmed) {
      //progress step 마킹
      if (participantCode) {
        markProgress(participantCode, "consent").catch((error) => {
          console.error("[Consent] markProgress failed:", error);
        });
      }
      navigate("/chat/hold/demographics");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>

          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Step 1 of 3
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Informed Consent</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please review and complete the consent form in a new tab.
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
              href={consentLinkWithCode}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Open consent form
              <ExternalLink className="w-4 h-4" />
            </a>

            <Button onClick={handleContinue} variant="outline" className="w-full" size="lg">
              I've completed the consent form
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-md">
            The consent form opens in a new tab. After you submit it on Qualtrics, return here and
            click "I've completed the consent form" to continue.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Consent;
