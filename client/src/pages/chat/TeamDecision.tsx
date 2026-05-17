import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Users, Check } from "lucide-react";
import type { Candidate } from "@/types";
import { cn } from "@/lib/utils";

const candidates: Candidate[] = ["A", "B", "C", "D"];

const TeamDecision = () => {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (selected) {
      sessionStorage.setItem("teamDecision", selected);
      navigate("/chat/post-survey");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Team Decision</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Based on your team's discussion, which candidate has your team selected as the best fit
          for the airline pilot position? Please confirm the decision your team agreed upon.
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
          Confirm Team Decision
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          This should reflect your team's consensus, not just your personal preference.
        </p>
      </div>
    </div>
  );
};

export default TeamDecision;
