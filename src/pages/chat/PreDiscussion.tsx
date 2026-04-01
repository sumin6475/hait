import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Vote, Check } from "lucide-react";
import type { Candidate } from "@/types";
import { cn } from "@/lib/utils";

const candidates: { id: Candidate; name: string; desc: string }[] = [
  { id: "A", name: "Candidate A", desc: "Strong leadership and communication skills" },
  { id: "B", name: "Candidate B", desc: "Good problem solving and adaptability" },
  { id: "C", name: "Candidate C", desc: "Physical fitness and potential" },
  { id: "D", name: "Candidate D", desc: "Experience and motivation" },
];

const PreDiscussion = () => {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (selected) {
      sessionStorage.setItem("preChoice", selected);
      navigate("/chat/waiting");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Vote className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Pre-Discussion Preference</h1>
        </div>
        <p className="text-sm text-muted-foreground">Based on the information you've reviewed, which candidate do you currently prefer? This is your initial choice before group discussion.</p>

        <div className="space-y-3">
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={cn(
                "w-full flex items-center gap-4 rounded-lg border p-4 text-left transition-all",
                selected === c.id
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-input hover:border-primary/40 hover:bg-muted/50"
              )}
            >
              <span className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-lg",
                selected === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {c.id}
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </div>
              {selected === c.id && <Check className="w-5 h-5 text-primary" />}
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
