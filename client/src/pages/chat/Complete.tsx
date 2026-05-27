import { CheckCircle2 } from "lucide-react";
import { useEffect } from "react";
import { markProgress, finalizeSession } from "@/lib/api";

const Complete = () => {
  useEffect(() => {
    const participantCode = sessionStorage.getItem("participantCode");
    const sessionCode = sessionStorage.getItem("sessionCode");
    if (!participantCode || !sessionCode) return;

    (async () => {
      try {
        await markProgress(participantCode, "complete");
        await finalizeSession(sessionCode);
      } catch (e) {
        console.error("[Complete] finalize failed:", e);
      }
    })().catch((e) => console.error("[Complete] async error:", e));
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-sm">
        <div className="w-16 h-16 rounded-full bg-status-success/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-status-success" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Thank You!</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Your participation in the HAIT experiment is now complete. Your responses have been
            recorded and will contribute to important research on human-AI collaboration.
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 border p-4">
          <p className="text-xs text-muted-foreground">
            If you have any questions about this study, please contact the research team at{" "}
            <span className="text-primary font-medium">hait-research@university.edu</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Complete;
