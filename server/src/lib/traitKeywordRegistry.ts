import { TRAIT_DB, type Cand, type Trait } from "./traitData.js";

export type FuzzyPolicy = "verify_lexical_near_match";

export interface TraitKeywordEntry {
  traitId: string;
  candidate: Cand;
  valence: Trait["valence"];
  profiles: Trait["profiles"];
  corePhrases: readonly string[];
  acceptedVariants: readonly string[];
  fuzzyPolicy: FuzzyPolicy;
}

// This is the reviewed runtime copy of the draft registry. Keep traitData.ts as
// the source of truth for ownership and valence; the registry only controls
// which lexical evidence is allowed to reach the extractor.
const EXTRA_PHRASES: Record<string, { core?: string[]; variants?: string[] }> = {
  A_p1: { core: ["recognizing dangerous situations"], variants: ["recognize dangerous situations", "recognises dangerous situations", "recognising dangerous situations", "recognizing the dangerous situations"] },
  A_p2: { core: ["good overview of complex contexts"], variants: ["good overview of complex situations", "overview of complex contexts", "good overview of complex context", "good overview of the complex contexts"] },
  A_p3: { core: ["excellent spatial awareness", "spatial awareness"], variants: ["very good spatial awareness"] },
  A_p4: { core: ["very well organized", "well organized"], variants: ["very well organised", "well organised", "very organized", "very organised"] },
  A_n1: { core: ["does not tolerate criticism", "not tolerate criticism"], variants: ["doesn't tolerate criticism", "doesnt tolerate criticism", "cannot tolerate criticism", "can't tolerate criticism", "cannot take criticism", "not tolerant on criticism", "not tolerating criticism"] },
  A_n2: { core: ["sometimes a bit hectic", "a bit hectic"], variants: ["sometimes hectic", "sometimes bit hectic"] },
  A_n3: { core: ["show-off"], variants: ["show off", "showoff"] },
  A_n4: { core: ["not open to new ideas"], variants: ["isn't open to new ideas", "not very open to new ideas", "not being open to new ideas"] },
  A_n5: { core: ["unfriendly"], variants: ["not friendly", "isn't friendly"] },
  A_n6: { core: ["transmits restlessness"], variants: ["transmit restlessness", "transmitting restlessness", "gives off restlessness"] },
  B_p1: { core: ["keeps a cool head in crisis situations", "cool head in crisis situations"], variants: ["keep a cool head in a crisis", "keeps a cool head in crises", "cool head", "keeping a cool head in crisis situations", "keeping a cool head"] },
  B_p2: { core: ["rely on 100%", "100% reliable"], variants: ["can be relied on 100%", "100 percent reliable", "rely on completely", "reliability", "rely on him/her 100%", "rely on him 100%", "rely on them 100%", "rely on b 100%", "relying on him/her 100%"] },
  B_p3: { core: ["assess weather conditions very well", "assess weather conditions"], variants: ["assesses weather conditions very well", "good at assessing weather conditions", "assess weather very well", "assess the weather conditions very well", "assess the weather condition"] },
  B_p4: { core: ["good at multitasking"], variants: ["good multitasker", "can multitask well", "can multitask", "multitasks"] },
  B_n1: { core: ["considered nagging"], variants: ["is nagging", "can be nagging", "considered to be nagging", "being a nagging person", "are nagging", "nagging"] },
  B_n2: { core: ["not very cooperative"], variants: ["isn't very cooperative", "not cooperative", "not so cooperative", "uncooperative", "not being cooperative", "not considered very cooperative", "bad at being cooperative"] },
  B_n3: { core: ["below-average memory for numbers", "memory for numbers"], variants: ["below average memory for numbers", "poor memory for numbers", "weak memory for numbers", "below-average on numbers memory"] },
  B_n4: { core: ["gossips about coworkers"], variants: ["gossips about co-workers", "gossiping about coworkers", "gossips about colleagues", "gossiping about co-workers", "gossips about his coworkers", "gossips about his co-workers", "gossips about his/her coworker", "gossips about his/her coworkers", "gossip about his coworkers"] },
  B_n5: { core: ["considered arrogant", "is arrogant"], variants: ["seems arrogant", "comes across as arrogant"] },
  B_n6: { core: ["abusive in tone", "abusive tone"], variants: ["sometimes abusive in tone", "can be abusive in tone"] },
  C_p1: { core: ["make the right decisions very quickly", "right decisions very quickly"], variants: ["makes the right decisions very quickly", "can make correct decisions very quickly", "make the right decision very quickly", "make right decisions quickly", "right decisions quickly", "making the right decisions very quickly"] },
  C_p2: { core: ["stress resistant"], variants: ["stress-resistant", "resistant to stress", "handles stress well"] },
  C_p3: { core: ["good atmosphere within the crew", "promotes a good atmosphere"], variants: ["creates a good atmosphere within the crew", "promotes a good crew atmosphere", "keeps the crew atmosphere good", "promotes good atmosphere with the crew", "promoting a good atmosphere within the crew"] },
  C_p4: { core: ["very conscientious"], variants: ["is conscientious"] },
  C_p5: { core: ["dealing with complicated technology", "complicated technology"], variants: ["skilled with complicated technology", "skilled with complicated tech", "good at dealing with complicated technology"] },
  C_p6: { core: ["safety of people above everything", "puts people's safety above everything"], variants: ["puts the safety of people in their care above everything else", "puts people's safety first", "putting people's safety above everything", "putting people's safety first"] },
  C_p7: { core: ["very well in sustained attention", "sustained attention"], variants: ["performs very well in terms of sustained attention", "has very good sustained attention"] },
  C_n1: { core: ["verbally skillful"], variants: ["verbally skilful", "verbally skillfull", "not verbally skillful", "isn't verbally skillful", "misses being verbally skillful"] },
  C_n2: { core: ["considered egocentric", "is egocentric"], variants: ["seems egocentric", "comes across as egocentric", "egocentric"] },
  C_n3: { core: ["reluctant to take part in training", "reluctant to train"], variants: ["doesn't want to take part in training", "unwilling to take part in training", "reluctant about training", "reluctant to take parts in training"] },
  D_p1: { core: ["react adequately to unforeseen events", "unforeseen events"], variants: ["reacts adequately to unforeseen events", "handles unforeseen events adequately", "reacting adequately to unforeseen events"] },
  D_p2: { core: ["concentrate very well"], variants: ["concentrates very well", "very good concentration", "concentrating very well"] },
  D_p3: { core: ["very resilient"], variants: ["is resilient"] },
  D_p4: { core: ["very responsible"], variants: ["is responsible"] },
  D_n1: { core: ["considered arrogant", "is arrogant"], variants: ["seems arrogant", "comes across as arrogant"] },
  D_n2: { core: ["not well suited for leading a team"], variants: ["isn't well suited to lead a team", "isnt well suited to lead a team", "not suited for team leadership", "not a good team leader", "not great at leading a team", "not very well suited for leading a team", "not suited to lead a team", "not fit to lead", "not fit for leading team"] },
  D_n3: { core: ["considered a know-all", "is a know-all"], variants: ["know-all", "know it all", "know-it-all", "considered to be a know-all", "know all"] },
  D_n4: { core: ["quick-tempered"], variants: ["quick tempered", "has a quick temper", "loses their temper quickly"] },
  D_n5: { core: ["considered moody", "is moody"], variants: ["seems moody", "can be moody"] },
  D_n6: { core: ["strong prejudices"], variants: ["strongly prejudiced", "has a lot of prejudice"] },
};

export const TRAIT_KEYWORD_REGISTRY: readonly TraitKeywordEntry[] = TRAIT_DB.map((trait) => {
  const extra = EXTRA_PHRASES[trait.id] ?? {};
  return {
    traitId: trait.id,
    candidate: trait.candidate,
    valence: trait.valence,
    profiles: trait.profiles,
    // A trait's own wording is always matchable. It is the sentence a
    // participant reads off their card and the sentence Alex is shown in its
    // notes, so quoting it verbatim is the most likely way for it to reach the
    // board — and until now it could be absent from the phrase list entirely.
    // T-C2-047 turn 9 died that way: Alex stated C_p6 twice in its card's words
    // and the matcher, holding a shorter phrase and a variant with the wrong
    // pronoun, found nothing.
    corePhrases: [...new Set([trait.text, ...(extra.core ?? [])])],
    acceptedVariants: extra.variants ?? [],
    fuzzyPolicy: "verify_lexical_near_match" as const,
  };
});

if (TRAIT_KEYWORD_REGISTRY.length !== TRAIT_DB.length || new Set(TRAIT_KEYWORD_REGISTRY.map((e) => e.traitId)).size !== TRAIT_DB.length) {
  throw new Error("Trait keyword registry must contain exactly one entry per TRAIT_DB trait");
}

export const TRAIT_KEYWORD_BY_ID = new Map(TRAIT_KEYWORD_REGISTRY.map((entry) => [entry.traitId, entry]));

for (const entry of TRAIT_KEYWORD_REGISTRY) {
  const source = TRAIT_DB.find((trait) => trait.id === entry.traitId);
  if (!source || entry.candidate !== source.candidate || entry.valence !== source.valence ||
      entry.profiles.length !== source.profiles.length || entry.profiles.some((profile) => !source.profiles.includes(profile))) {
    throw new Error(`Trait keyword registry disagrees with TRAIT_DB for ${entry.traitId}`);
  }
}
