import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { sharedInfoCards, xExclusiveCards, yExclusiveCards } from "@/lib/mockData";
import type { InfoCard, Candidate } from "@/types";
import { FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const candidateColors: Record<Candidate, string> = {
  A: "bg-chart-1/15 text-chart-1",
  B: "bg-chart-2/15 text-chart-2",
  C: "bg-chart-3/15 text-chart-3",
  D: "bg-chart-4/15 text-chart-4",
};

const InfoCardItem = ({ card }: { card: InfoCard }) => (
  <div className="flex items-center justify-between rounded-lg border bg-card p-3">
    <span className="text-sm">{card.attribute}</span>
    {card.valence === "positive" ? (
      <ThumbsUp className="w-4 h-4 text-status-success" />
    ) : (
      <ThumbsDown className="w-4 h-4 text-destructive" />
    )}
  </div>
);

const CandidateSection = ({ candidate, cards }: { candidate: Candidate; cards: InfoCard[] }) => {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 hover:bg-muted transition-colors">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm",
              candidateColors[candidate],
            )}
          >
            {candidate}
          </span>
          <span className="font-medium text-sm">Candidate {candidate}</span>
          <span className="text-xs text-muted-foreground">({cards.length} items)</span>
        </div>
        <ChevronDown
          className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2 pl-1">
          {cards.map((card, i) => (
            <InfoCardItem key={i} card={card} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const InfoCards = () => {
  const navigate = useNavigate();
  const role = sessionStorage.getItem("role") || "X";
  const exclusiveCards = role === "X" ? xExclusiveCards : yExclusiveCards;
  const allCards = [...sharedInfoCards, ...exclusiveCards];

  const grouped = (["A", "B", "C", "D"] as Candidate[]).reduce(
    (acc, c) => {
      acc[c] = allCards.filter((card) => card.candidate === c);
      return acc;
    },
    {} as Record<Candidate, InfoCard[]>,
  );

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Your Candidate Information</h1>
        </div>
        <div className="rounded-lg bg-status-warning/10 border border-status-warning/30 p-4">
          <p className="text-sm font-medium text-status-warning">
            ⚠️ Important: You will NOT be able to refer back to these cards during the discussion.
            Please study them carefully.
          </p>
        </div>

        <div className="space-y-4">
          {(["A", "B", "C", "D"] as Candidate[]).map((c) => (
            <CandidateSection key={c} candidate={c} cards={grouped[c]} />
          ))}
        </div>

        <Button onClick={() => navigate("/chat/pre-discussion")} className="w-full" size="lg">
          I've reviewed all cards — Continue
        </Button>
      </div>
    </div>
  );
};

export default InfoCards;
