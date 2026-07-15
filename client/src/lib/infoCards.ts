import {
  sharedInfoCards,
  xExclusiveCards,
  yExclusiveCards,
  zExclusiveCards,
} from "@/lib/mockData";
import type { ProfileSlot } from "@/lib/api";
import type { Candidate, InfoCard } from "@/types";

export const CANDIDATES: Candidate[] = ["A", "B", "C", "D"];

export const candidateColors: Record<Candidate, string> = {
  A: "bg-chart-1/15 text-chart-1",
  B: "bg-chart-2/15 text-chart-2",
  C: "bg-chart-3/15 text-chart-3",
  D: "bg-chart-4/15 text-chart-4",
};

export function getExclusiveCardsForProfile(profile: ProfileSlot): InfoCard[] {
  switch (profile) {
    case "X":
      return xExclusiveCards;
    case "Y":
      return yExclusiveCards;
    case "Z":
      return zExclusiveCards;
    default:
      return [];
  }
}

export function getInfoCardsForProfile(profile: ProfileSlot): InfoCard[] {
  const exclusiveCards = getExclusiveCardsForProfile(profile);
  if (exclusiveCards.length === 0) {
    console.warn(`[infoCards] unknown profile "${profile}", showing shared cards only`);
  }
  return [...sharedInfoCards, ...exclusiveCards];
}

export function groupInfoCardsByCandidate(cards: InfoCard[]): Record<Candidate, InfoCard[]> {
  return CANDIDATES.reduce(
    (acc, candidate) => {
      acc[candidate] = cards.filter((card) => card.candidate === candidate);
      return acc;
    },
    {} as Record<Candidate, InfoCard[]>,
  );
}

export function sortCardsByValence(cards: InfoCard[]): InfoCard[] {
  return [
    ...cards.filter((card) => card.valence === "positive"),
    ...cards.filter((card) => card.valence === "negative"),
  ];
}
