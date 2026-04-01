import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface LikertItemProps {
  question: string;
  name: string;
  value: number | null;
  onChange: (v: number) => void;
}

const LikertItem = ({ question, name, value, onChange }: LikertItemProps) => (
  <div className="space-y-2 py-3 border-b last:border-0">
    <p className="text-sm">{question}</p>
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={cn(
            "w-10 h-10 rounded-lg border text-sm font-medium transition-all",
            value === n
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  </div>
);

const trustQuestions = [
  "AI Alex was competent in its role.",
  "AI Alex performed its task well.",
  "AI Alex showed good capability in the discussion.",
  "AI Alex acted in my best interest.",
  "AI Alex was concerned about my welfare.",
  "AI Alex's intentions were good.",
  "AI Alex tried to help us make a good decision.",
  "AI Alex was truthful in its communication.",
  "AI Alex was honest about its information.",
  "AI Alex made fair judgments.",
  "AI Alex was consistent in its behavior.",
];

const manipulationQuestions = [
  "AI Alex acted as a leader in the discussion.",
  "AI Alex directed the flow of conversation.",
  "AI Alex took charge of the group process.",
  "AI Alex explained its reasoning clearly.",
  "AI Alex asked questions to draw out information.",
];

const PostSurvey = () => {
  const navigate = useNavigate();
  const [trustResponses, setTrustResponses] = useState<Record<string, number>>({});
  const [manipResponses, setManipResponses] = useState<Record<string, number>>({});
  const [toolTeam, setToolTeam] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);

  const allTrustDone = trustQuestions.every((_, i) => trustResponses[`t${i}`] !== undefined);
  const allManipDone = manipulationQuestions.every((_, i) => manipResponses[`m${i}`] !== undefined);
  const allToolDone = toolTeam.tool !== undefined && toolTeam.teammate !== undefined;

  const handleFinish = () => {
    sessionStorage.setItem("surveyCompleted", "true");
    navigate("/chat/complete");
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl py-8 space-y-6">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Post-Discussion Survey</h1>
        </div>

        <div className="flex gap-2">
          {[0, 1, 2].map((p) => (
            <div key={p} className={cn("flex-1 h-1.5 rounded-full", page >= p ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        {page === 0 && (
          <div className="bg-card rounded-xl border p-6 space-y-2">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-primary" />
              <h2 className="font-medium">Trust in AI (1 = Strongly Disagree, 5 = Strongly Agree)</h2>
            </div>
            {trustQuestions.map((q, i) => (
              <LikertItem key={i} question={q} name={`t${i}`}
                value={trustResponses[`t${i}`] ?? null}
                onChange={(v) => setTrustResponses((p) => ({ ...p, [`t${i}`]: v }))}
              />
            ))}
            <Button onClick={() => setPage(1)} className="w-full mt-4" disabled={!allTrustDone}>
              Next
            </Button>
          </div>
        )}

        {page === 1 && (
          <div className="bg-card rounded-xl border p-6 space-y-2">
            <h2 className="font-medium mb-4">Manipulation Check</h2>
            {manipulationQuestions.map((q, i) => (
              <LikertItem key={i} question={q} name={`m${i}`}
                value={manipResponses[`m${i}`] ?? null}
                onChange={(v) => setManipResponses((p) => ({ ...p, [`m${i}`]: v }))}
              />
            ))}
            <Button onClick={() => setPage(2)} className="w-full mt-4" disabled={!allManipDone}>
              Next
            </Button>
          </div>
        )}

        {page === 2 && (
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h2 className="font-medium">Tool vs. Teammate Perception</h2>
            <LikertItem question="I perceived AI Alex as a tool." name="tool"
              value={toolTeam.tool ?? null}
              onChange={(v) => setToolTeam((p) => ({ ...p, tool: v }))}
            />
            <LikertItem question="I perceived AI Alex as a team member." name="teammate"
              value={toolTeam.teammate ?? null}
              onChange={(v) => setToolTeam((p) => ({ ...p, teammate: v }))}
            />
            <Button onClick={handleFinish} className="w-full mt-4" disabled={!allToolDone}>
              Submit Survey
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostSurvey;
