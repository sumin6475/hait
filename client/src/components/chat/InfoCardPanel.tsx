import { useState } from "react";
import { ChevronDown, FileText, ThumbsDown, ThumbsUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ProfileSlot } from "@/lib/api";
import {
  CANDIDATES,
  candidateColors,
  getInfoCardsForProfile,
  groupInfoCardsByCandidate,
  sortCardsByValence,
} from "@/lib/infoCards";
import { cn } from "@/lib/utils";
import type { Candidate, InfoCard } from "@/types";

type InfoCardPanelVariant = "interactive" | "static";

interface InfoCardPanelProps {
  profile: ProfileSlot;
  variant?: InfoCardPanelVariant;
  compact?: boolean;
  showNote?: boolean;
  showTitle?: boolean;
}

// Step 46 — always-visible task criterion. Condition-invariant (shown incl. CTRL):
// it states the equal-weighting rule the briefing/video promised would stay on screen.
// Broad domains only — never the company's enumerated criteria, never a candidate letter.
const CompanyStandardCard = ({ compact }: { compact?: boolean }) => (
  <div
    className={cn(
      // opaque, not translucent: cards scroll underneath it in the discussion aside
      "sticky top-0 z-20 rounded-lg border bg-secondary",
      compact ? "p-3" : "p-4",
    )}
  >
    <h3 className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>The Company's Standard</h3>
    <ul
      className={cn(
        "mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground",
        compact ? "text-[11px] leading-snug" : "text-xs",
      )}
    >
      <li>
        The company already decided what this role needs — things like skill, reliability, teamwork,
        and conduct.
      </li>
      <li>
        On the cards: <ThumbsUp className="inline w-3 h-3 text-status-success align-[-1px]" /> ={" "}
        <strong>matches</strong> a company requirement,{" "}
        <ThumbsDown className="inline w-3 h-3 text-destructive align-[-1px]" /> ={" "}
        <strong>misses</strong> one.
      </li>
      <li>
        All requirements count the same. Best fit = the most{" "}
        <ThumbsUp className="inline w-3 h-3 text-status-success align-[-1px]" />, the fewest{" "}
        <ThumbsDown className="inline w-3 h-3 text-destructive align-[-1px]" />.
      </li>
    </ul>
  </div>
);

interface InfoCardItemProps {
  card: InfoCard;
  variant: InfoCardPanelVariant;
  compact?: boolean;
}

const InfoCardItem = ({ card, variant, compact }: InfoCardItemProps) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-lg border bg-card",
      variant === "interactive" && "group relative",
      compact ? "p-2" : "gap-3 p-3",
    )}
  >
    <span className={cn("text-sm", compact && "text-xs leading-snug")}>{card.attribute}</span>
    {card.valence === "positive" ? (
      <ThumbsUp
        className={cn(
          "text-status-success shrink-0 ml-auto",
          compact ? "w-3.5 h-3.5" : "w-4 h-4",
        )}
      />
    ) : (
      <ThumbsDown
        className={cn("text-destructive shrink-0 ml-auto", compact ? "w-3.5 h-3.5" : "w-4 h-4")}
      />
    )}
    {variant === "interactive" && (
      <img
        src={`/info-images/${card.id}.png`}
        alt=""
        className="hidden group-hover:block absolute right-full top-0 mr-2 w-48 rounded-lg border bg-card shadow-lg z-10"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    )}
  </div>
);

interface CandidateSectionProps {
  candidate: Candidate;
  cards: InfoCard[];
  variant: InfoCardPanelVariant;
  compact?: boolean;
  defaultOpen?: boolean;
}

const CandidateSection = ({
  candidate,
  cards,
  variant,
  compact,
  defaultOpen = true,
}: CandidateSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "w-full flex items-center justify-between rounded-lg bg-muted/50 hover:bg-muted transition-colors",
          compact ? "px-3 py-2" : "px-4 py-3",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-lg flex items-center justify-center font-mono font-bold",
              candidateColors[candidate],
              compact ? "w-6 h-6 text-xs" : "w-8 h-8 text-sm",
            )}
          >
            {candidate}
          </span>
          <span className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
            Candidate {candidate}
          </span>
          <span className="text-xs text-muted-foreground">({cards.length} items)</span>
        </div>
        <ChevronDown
          className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn("space-y-2 pt-2 pl-1", compact && "space-y-1.5")}>
          {sortCardsByValence(cards).map((card) => (
            <InfoCardItem key={card.id} card={card} variant={variant} compact={compact} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const InfoCardPanel = ({
  profile,
  variant = "interactive",
  compact = false,
  showNote = true,
  showTitle = true,
}: InfoCardPanelProps) => {
  const allCards = getInfoCardsForProfile(profile);
  const grouped = groupInfoCardsByCandidate(allCards);

  return (
    <div className={cn(compact ? "p-3 space-y-3" : "space-y-6")}>
      {showTitle && (
        <div className={cn("flex items-center gap-2", compact && "gap-2")}>
          <FileText className={cn("text-primary", compact ? "w-4 h-4" : "w-6 h-6")} />
          <h2 className={cn("font-semibold", compact ? "text-sm" : "text-xl")}>
            Your Candidate Information
          </h2>
        </div>
      )}

      <CompanyStandardCard compact={compact} />

      {showNote && (
        <div
          className={cn(
            "rounded-lg bg-status-warning/10 border border-status-warning/30",
            compact ? "p-3" : "p-4",
          )}
        >
          <p className={cn("text-foreground", compact ? "text-xs" : "text-sm")}>
            <strong>Note:</strong> You may not have all the information about each candidate. Other
            team members may hold additional information. There is one optimal candidate.
          </p>
        </div>
      )}

      <div className={cn(compact ? "space-y-2" : "space-y-4")}>
        {CANDIDATES.map((candidate) => (
          <CandidateSection
            key={candidate}
            candidate={candidate}
            cards={grouped[candidate]}
            variant={variant}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
};
