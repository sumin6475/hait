import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Vote, Check } from "lucide-react";
import type { Candidate } from "@/types";
import { cn } from "@/lib/utils";
import { markProgress, setPreChoice, setRecallTest } from "@/lib/api";

const candidates: Candidate[] = ["A", "B", "C", "D"];

const PreDiscussion = () => {
  const [step, setStep] = useState<0 | 1>(0); // 0 = recall, 1 = preference
  const [recall, setRecall] = useState<Record<Candidate, string>>({ A: "", B: "", C: "", D: "" });
  const [selected, setSelected] = useState<Candidate | null>(null);
  const navigate = useNavigate();

  // 회상 4칸 전부 채워야 다음 (비는건 안됨)
  const recallComplete = candidates.every((c) => recall[c].trim().length > 0);

  const handleContinue = () => {
    if (!recallComplete) return;
    sessionStorage.setItem("recallTest", JSON.stringify(recall));
    const participantCode = sessionStorage.getItem("participantCode") ?? "";
    if (participantCode) {
      //recall test 저장 (fire-and-forget — setPreChoice와 동일 패턴)
      setRecallTest(participantCode, recall).catch((error) => {
        console.error("[PreDiscussion] setRecallTest failed:", error);
      });
    }
    setStep(1);
  };

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
        {/* 진행 인디케이터 1/2 */}
        <div className="flex items-center justify-center gap-2">
          {[0, 1].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                step === i ? "w-6 bg-primary" : "w-2 bg-muted",
              )}
            />
          ))}
        </div>

        {/* 슬라이드 뷰포트 */}
        <div className="overflow-hidden">
          <div
            className="flex items-start transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${step * 100}%)` }}
          >
            {/* ── 1페이지: 회상 검사 ── */}
            <div className="w-full shrink-0 space-y-5">
              <p className="text-sm text-muted-foreground">
                Based on what you just reviewed, write down the attributes of each candidate as you
                remember them. Feel free to jot down as much as comes to mind.
              </p>
              <div className="space-y-4">
                {candidates.map((c) => (
                  <div key={c} className="space-y-1.5">
                    <label htmlFor={`recall-${c}`} className="text-sm font-medium">
                      What are the attributes of Candidate {c}?
                    </label>
                    <Textarea
                      id={`recall-${c}`}
                      value={recall[c]}
                      onChange={(e) => setRecall((prev) => ({ ...prev, [c]: e.target.value }))}
                      placeholder={`Candidate ${c}...`}
                      rows={3}
                    />
                  </div>
                ))}
              </div>
              <Button
                onClick={handleContinue}
                className="w-full"
                size="lg"
                disabled={!recallComplete}
              >
                Continue
              </Button>
            </div>

            {/* ── 2페이지: 선호 선택 (기존) ── */}
            <div className="w-full shrink-0 space-y-6">
              <div className="flex items-center gap-3">
                <Vote className="w-6 h-6 text-primary" />
                <h1 className="text-xl font-semibold">Pre-Discussion Preference</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Based on the information you've reviewed, which candidate do you currently prefer?
                This is your initial choice before group discussion.
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
              <button
                onClick={() => setStep(0)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back
              </button>
              <Button onClick={handleSubmit} className="w-full" size="lg" disabled={!selected}>
                Confirm Selection
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreDiscussion;
