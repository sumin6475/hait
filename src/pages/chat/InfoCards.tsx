import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { sharedInfoCards, xExclusiveCards, yExclusiveCards } from "@/lib/mockData";
import type { InfoCard } from "@/types";
import { FileText, ThumbsUp, ThumbsDown } from "lucide-react";

const InfoCardItem = ({ card }: { card: InfoCard }) => (
  <div className="flex items-center justify-between rounded-lg border bg-card p-3">
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs font-semibold text-primary bg-primary/10 rounded px-2 py-1">
        {card.candidate}
      </span>
      <span className="text-sm">{card.attribute}</span>
    </div>
    {card.valence === "positive" ? (
      <ThumbsUp className="w-4 h-4 text-status-success" />
    ) : (
      <ThumbsDown className="w-4 h-4 text-destructive" />
    )}
  </div>
);

const InfoCards = () => {
  const navigate = useNavigate();
  const role = sessionStorage.getItem("role") || "X";
  const exclusiveCards = role === "X" ? xExclusiveCards : yExclusiveCards;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Candidate Information Cards</h1>
        </div>
        <div className="rounded-lg bg-status-warning/10 border border-status-warning/30 p-4">
          <p className="text-sm font-medium text-status-warning">⚠️ Important: You will NOT be able to refer back to these cards during the discussion. Please study them carefully.</p>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Shared Information ({sharedInfoCards.length} items)
            </h2>
            <div className="space-y-2">
              {sharedInfoCards.map((card, i) => <InfoCardItem key={i} card={card} />)}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
              Your Exclusive Information ({exclusiveCards.length} items)
            </h2>
            <div className="space-y-2">
              {exclusiveCards.map((card, i) => <InfoCardItem key={i} card={card} />)}
            </div>
          </div>
        </div>

        <Button onClick={() => navigate("/chat/pre-discussion")} className="w-full" size="lg">
          I've reviewed all cards — Continue
        </Button>
      </div>
    </div>
  );
};

export default InfoCards;
