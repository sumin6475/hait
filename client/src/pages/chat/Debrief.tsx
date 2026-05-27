import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { markProgress } from "@/lib/api";

const sections = [
  {
    title: "About This Study",
    text: "Thank you for participating. This study investigated how AI communication strategies (explanatory vs. adaptive) and AI roles (leader vs. peer) affect team decision-making in a hidden profile task.",
  },
  {
    title: "The Correct Answer",
    text: "The best candidate for the pilot position was Candidate C (Gamma). When all information from all team members is combined, Candidate C has the highest ratio of positive attributes (7 positive, 3 negative) compared to other candidates.",
  },
  {
    title: "Why This Matters",
    text: "Understanding how AI communicates in teams can help design better human-AI collaboration systems. Your responses will contribute to this research.",
  },
  {
    title: "Questions?",
    text: "If you have any questions about this study, please contact the research team at hait-research@umich.edu",
  },
];

const Debrief = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const participantCode = sessionStorage.getItem("participantCode");
    if (!participantCode) return;
    markProgress(participantCode, "debrief").catch((e) =>
      console.error("[Debrief] markProgress failed:", e),
    );
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Info className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Study Debrief</h1>
        </div>

        <div className="space-y-3">
          {sections.map((s) => (
            <div key={s.title} className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>

        <Button onClick={() => navigate("/chat/complete")} className="w-full" size="lg">
          Continue
        </Button>
      </div>
    </div>
  );
};

export default Debrief;
