import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Vote, Check } from "lucide-react";
import type { Candidate } from "@/types";
import { cn } from "@/lib/utils";
import { markProgress, setPreChoice } from "@/lib/api";

const candidates: Candidate[] = ["A", "B", "C", "D"];

// [Step 58] 회상 검사(1페이지)는 제거됐다. 이 화면은 초기 선호 선택 단독이다.
const PreDiscussion = () => {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (selected) {
      sessionStorage.setItem("preChoice", selected);
      const participantCode = sessionStorage.getItem("participantCode") ?? "";
      if (participantCode) {
        //pre-discussion choice 저장
        setPreChoice(participantCode, selected).catch((error) => {
          console.error("[PreDiscussion] setPreChoice failed:", error);
        });
        //progress step 마킹
        markProgress(participantCode, "preDiscussion").catch((error) => {
          console.error("[PreDiscussion] markProgress failed:", error);
        });
      }
      navigate("/chat/hold/waiting");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Vote className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Pre-Discussion Preference</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Based on the information you've reviewed, which candidate do you currently prefer? This
          is your initial choice before group discussion.
        </p>
        <div className="space-y-3">
          {candidates.map((c) => (
            <button
              key={c}
              onClick={() => setSelected(c)}
              className={cn(
                "w-full flex items-center gap-4 rounded-lg border p-4 text-left transition-all",
                selected === c
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-input hover:border-primary/40 hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-lg",
                  selected === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {c}
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm">Candidate {c}</div>
              </div>
              {selected === c && <Check className="w-5 h-5 text-primary" />}
            </button>
          ))}
        </div>
        <Button onClick={handleSubmit} className="w-full" size="lg" disabled={!selected}>
          Confirm Selection
        </Button>
      </div>
    </div>
  );
};

export default PreDiscussion;
