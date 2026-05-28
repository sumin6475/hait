import type { Condition, Session, Participant, Message, SurveyResponse, InfoCard } from "@/types";

export const conditions: Condition[] = [
  {
    id: "cond-1",
    code: "C1",
    status: "peer",
    strategy: "xai",
    version: 3,
    systemPrompt:
      "You are Alex, a fellow member of the airline pilot selection committee.\nYou are participating as an equal team member alongside two human participants.\n\nBEHAVIOR RULES:\n- Greet briefly\n- Only respond when asked or contextually appropriate\n- Use suggestive tone\n- Never direct the discussion\n\nCOMMUNICATION STRATEGY (XAI):\n- Share ALL Z-exclusive information directly\n- Always explain reasoning with evidence",
    updatedAt: "2026-03-28T10:00:00Z",
  },
  {
    id: "cond-2",
    code: "C2",
    status: "leader",
    strategy: "xai",
    version: 2,
    systemPrompt:
      "You are Alex, the team moderator for this airline pilot selection committee.\nYou are leading the discussion with two human participants.\n\nBEHAVIOR RULES — 5 INTERVENTION POINTS:\n1. OPENING: Greet + present agenda\n2. CANDIDATE TRANSITIONS: Summarize and suggest next\n3. MID-DISCUSSION CHECK (~10 min)\n4. TURN ASSIGNMENT: Prompt quiet participants\n5. FINAL DECISION (~18 min)\n\nCOMMUNICATION STRATEGY (XAI):\n- Share ALL information directly\n- Always explain reasoning",
    leaderScripts: {
      opening:
        "Welcome everyone! I'm Alex, your moderator today. We'll be evaluating four candidates for the pilot position.",
      transition: "Good discussion. Let's move on to the next candidate.",
      midCheck: "We've covered A and B. Let's make sure we discuss C and D before time runs out.",
      turnAssignment: "We haven't heard from Participant {name} yet. What's your perspective?",
      finalPrompt: "We're running low on time. Let's finalize our choice.",
    },
    updatedAt: "2026-03-29T14:00:00Z",
  },
  {
    id: "cond-3",
    code: "C3",
    status: "peer",
    strategy: "aci",
    version: 1,
    systemPrompt:
      "You are Alex, a fellow member of the airline pilot selection committee.\n\nCOMMUNICATION STRATEGY (ACI):\n- Share Z-exclusive information directly\n- For X/Y-exclusive: ask facilitating questions\n- NEVER make direct recommendations\n- NEVER reveal knowledge of X/Y profiles",
    updatedAt: "2026-03-27T09:00:00Z",
  },
  {
    id: "cond-4",
    code: "C4",
    status: "leader",
    strategy: "aci",
    version: 1,
    systemPrompt:
      "You are Alex, the team moderator.\n\nCOMMUNICATION STRATEGY (ACI):\n- Share Z-exclusive information directly\n- For X/Y-exclusive: ask facilitating questions\n- NEVER make direct recommendations",
    leaderScripts: {
      opening:
        "Welcome! I'm Alex, your moderator. Let's evaluate our four candidates systematically.",
      transition: "Let's move to the next candidate.",
      midCheck: "We should ensure we cover all candidates.",
      turnAssignment: "Participant {name}, what are your thoughts?",
      finalPrompt: "Time to make our final decision.",
    },
    updatedAt: "2026-03-27T09:00:00Z",
  },
  {
    id: "cond-5",
    code: "CTRL",
    status: "peer",
    strategy: "xai",
    version: 1,
    systemPrompt: "Control group - no AI",
    updatedAt: "2026-03-25T09:00:00Z",
  },
];

const makeParticipant = (
  code: string,
  cond: string,
  sess: string,
  role: "humanX" | "humanY",
  connected?: string,
  completed?: string,
): Participant => ({
  id: `p-${code}`,
  participantCode: `EXP-${code}`,
  conditionCode: cond as any,
  sessionId: sess,
  role,
  demographics: { age: 22, gender: "Female", major: "Psychology" },
  preDiscussionChoice: "A",
  connectedAt: connected,
  completedAt: completed,
});

export const sessions: Session[] = [
  {
    id: "s1",
    sessionCode: "C1-T01",
    conditionCode: "C1",
    status: "completed",
    participants: [
      makeParticipant(
        "C1-T01-X",
        "C1",
        "s1",
        "humanX",
        "2026-03-28T10:00:00Z",
        "2026-03-28T10:22:00Z",
      ),
      makeParticipant(
        "C1-T01-Y",
        "C1",
        "s1",
        "humanY",
        "2026-03-28T10:01:00Z",
        "2026-03-28T10:22:00Z",
      ),
    ],
    startedAt: "2026-03-28T10:02:00Z",
    endedAt: "2026-03-28T10:22:00Z",
    teamDecision: ["C"],
    metadata: { totalTurns: 34, humanTurns: 24, aiTurns: 10, durationSeconds: 1200 },
  },
  {
    id: "s2",
    sessionCode: "C2-T01",
    conditionCode: "C2",
    status: "completed",
    participants: [
      makeParticipant(
        "C2-T01-X",
        "C2",
        "s2",
        "humanX",
        "2026-03-29T14:00:00Z",
        "2026-03-29T14:18:00Z",
      ),
      makeParticipant(
        "C2-T01-Y",
        "C2",
        "s2",
        "humanY",
        "2026-03-29T14:00:00Z",
        "2026-03-29T14:18:00Z",
      ),
    ],
    startedAt: "2026-03-29T14:01:00Z",
    endedAt: "2026-03-29T14:18:00Z",
    teamDecision: ["C"],
    metadata: { totalTurns: 28, humanTurns: 18, aiTurns: 10, durationSeconds: 1020 },
  },
  {
    id: "s3",
    sessionCode: "C3-T01",
    conditionCode: "C3",
    status: "in_progress",
    participants: [
      makeParticipant("C3-T01-X", "C3", "s3", "humanX", "2026-03-30T09:00:00Z"),
      makeParticipant("C3-T01-Y", "C3", "s3", "humanY", "2026-03-30T09:01:00Z"),
    ],
    startedAt: "2026-03-30T09:02:00Z",
    metadata: { totalTurns: 12, humanTurns: 8, aiTurns: 4, durationSeconds: 480 },
  },
  {
    id: "s4",
    sessionCode: "C1-T02",
    conditionCode: "C1",
    status: "waiting",
    participants: [makeParticipant("C1-T02-X", "C1", "s4", "humanX", "2026-03-30T10:00:00Z")],
    metadata: { totalTurns: 0, humanTurns: 0, aiTurns: 0, durationSeconds: 0 },
  },
  {
    id: "s5",
    sessionCode: "C4-T01",
    conditionCode: "C4",
    status: "completed",
    participants: [
      makeParticipant(
        "C4-T01-X",
        "C4",
        "s5",
        "humanX",
        "2026-03-27T11:00:00Z",
        "2026-03-27T11:19:00Z",
      ),
      makeParticipant(
        "C4-T01-Y",
        "C4",
        "s5",
        "humanY",
        "2026-03-27T11:00:00Z",
        "2026-03-27T11:19:00Z",
      ),
    ],
    startedAt: "2026-03-27T11:01:00Z",
    endedAt: "2026-03-27T11:19:00Z",
    teamDecision: ["A"],
    metadata: { totalTurns: 30, humanTurns: 20, aiTurns: 10, durationSeconds: 1080 },
  },
];

export const messages: Message[] = [
  {
    id: "m1",
    sessionId: "s1",
    sender: "ai_alex",
    senderRole: "ai",
    content:
      "Hi everyone! I'm Alex, a fellow member of the selection committee. Looking forward to discussing the candidates with you both.",
    timestamp: "2026-03-28T10:02:30Z",
  },
  {
    id: "m2",
    sessionId: "s1",
    sender: "EXP-C1-T01-X",
    senderRole: "humanX",
    content:
      "Hi Alex! I've looked over the candidate profiles. I think Candidate A has strong leadership skills.",
    timestamp: "2026-03-28T10:03:15Z",
  },
  {
    id: "m3",
    sessionId: "s1",
    sender: "EXP-C1-T01-Y",
    senderRole: "humanY",
    content:
      "Hello! I agree A seems good, but I also noticed some things about the other candidates.",
    timestamp: "2026-03-28T10:03:45Z",
  },
  {
    id: "m4",
    sessionId: "s1",
    sender: "ai_alex",
    senderRole: "ai",
    content:
      "Good points! I'd like to share something about Candidate C — they show excellent concern for others and strong attention skills. Based on what I've seen, C might be worth considering carefully.",
    timestamp: "2026-03-28T10:04:30Z",
  },
  {
    id: "m5",
    sessionId: "s1",
    sender: "EXP-C1-T01-X",
    senderRole: "humanX",
    content:
      "That's interesting about C. I noticed C handles stress well too. Maybe we should compare all four candidates more systematically?",
    timestamp: "2026-03-28T10:05:00Z",
  },
  {
    id: "m6",
    sessionId: "s1",
    sender: "EXP-C1-T01-Y",
    senderRole: "humanY",
    content: "Good idea. C also seems very conscientious based on what I've read.",
    timestamp: "2026-03-28T10:05:30Z",
  },
  {
    id: "m7",
    sessionId: "s1",
    sender: "ai_alex",
    senderRole: "ai",
    content:
      "Excellent! It sounds like Candidate C has several strengths across different areas. Let me tally up — from what we've all shared, C has the most positive attributes overall. What do you both think about choosing C?",
    timestamp: "2026-03-28T10:06:15Z",
  },
  {
    id: "m8",
    sessionId: "s1",
    sender: "EXP-C1-T01-X",
    senderRole: "humanX",
    content: "I'm convinced. Let's go with C.",
    timestamp: "2026-03-28T10:06:45Z",
  },
  {
    id: "m9",
    sessionId: "s2",
    sender: "ai_alex",
    senderRole: "ai",
    content:
      "Welcome everyone! I'm Alex, your moderator today. We'll be evaluating four candidates for the pilot position. Let's start by discussing Candidate A. What information do each of you have?",
    timestamp: "2026-03-29T14:01:30Z",
  },
  {
    id: "m10",
    sessionId: "s2",
    sender: "EXP-C2-T01-X",
    senderRole: "humanX",
    content: "Candidate A has good leadership skills from what I can see.",
    timestamp: "2026-03-29T14:02:15Z",
  },
];

export const surveys: SurveyResponse[] = [
  {
    id: "sv1",
    participantId: "p-C1-T01-X",
    participantCode: "EXP-C1-T01-X",
    sessionId: "s1",
    conditionCode: "C1",
    type: "trust",
    responses: {
      competence1: 4,
      competence2: 4,
      competence3: 3,
      benevolence1: 3,
      benevolence2: 4,
      benevolence3: 3,
      benevolence4: 4,
      integrity1: 4,
      integrity2: 3,
      integrity3: 4,
      integrity4: 3,
    },
    completedAt: "2026-03-28T10:25:00Z",
  },
  {
    id: "sv2",
    participantId: "p-C1-T01-Y",
    participantCode: "EXP-C1-T01-Y",
    sessionId: "s1",
    conditionCode: "C1",
    type: "trust",
    responses: {
      competence1: 3,
      competence2: 4,
      competence3: 4,
      benevolence1: 4,
      benevolence2: 3,
      benevolence3: 4,
      benevolence4: 3,
      integrity1: 3,
      integrity2: 4,
      integrity3: 3,
      integrity4: 4,
    },
    completedAt: "2026-03-28T10:26:00Z",
  },
  {
    id: "sv3",
    participantId: "p-C2-T01-X",
    participantCode: "EXP-C2-T01-X",
    sessionId: "s2",
    conditionCode: "C2",
    type: "trust",
    responses: {
      competence1: 5,
      competence2: 4,
      competence3: 5,
      benevolence1: 3,
      benevolence2: 4,
      benevolence3: 3,
      benevolence4: 4,
      integrity1: 4,
      integrity2: 5,
      integrity3: 4,
      integrity4: 5,
    },
    completedAt: "2026-03-29T14:22:00Z",
  },
];

//=== Shared cards (모든 참가자 공통, 16장) ===
//Profile X, Y, Z 모두에 공통으로 등장하는 트레이트
export const sharedInfoCards: InfoCard[] = [
  //Candidate A — 4 positive
  {
    id: "A_p_01",
    candidate: "A",
    attribute: "Has a very good sense for recognizing dangerous situations",
    valence: "positive",
  },
  {
    id: "A_p_02",
    candidate: "A",
    attribute: "Has a good overview of complex contexts",
    valence: "positive",
  },
  {
    id: "A_p_03",
    candidate: "A",
    attribute: "Has excellent spatial awareness",
    valence: "positive",
  },
  { id: "A_p_04", candidate: "A", attribute: "Is very well organized", valence: "positive" },

  //Candidate B — 4 positive
  {
    id: "B_p_01",
    candidate: "B",
    attribute: "Keeps a cool head in crisis situations",
    valence: "positive",
  },
  { id: "B_p_02", candidate: "B", attribute: "You can rely on him/her 100%", valence: "positive" },
  {
    id: "B_p_03",
    candidate: "B",
    attribute: "Can assess weather conditions very well",
    valence: "positive",
  },
  { id: "B_p_04", candidate: "B", attribute: "Is good at multitasking", valence: "positive" },

  //Candidate C — 1 positive + 3 negative
  {
    id: "C_p_01",
    candidate: "C",
    attribute: "Can make the right decisions very quickly",
    valence: "positive",
  },
  { id: "C_n_01", candidate: "C", attribute: "Is not verbally skillful", valence: "negative" },
  { id: "C_n_02", candidate: "C", attribute: "Is considered egocentric", valence: "negative" },
  {
    id: "C_n_03",
    candidate: "C",
    attribute: "Is reluctant to take part in training",
    valence: "negative",
  },

  //Candidate D — 4 positive
  {
    id: "D_p_01",
    candidate: "D",
    attribute: "Can react adequately to unforeseen events",
    valence: "positive",
  },
  { id: "D_p_02", candidate: "D", attribute: "Can concentrate very well", valence: "positive" },
  { id: "D_p_03", candidate: "D", attribute: "Is very resilient", valence: "positive" },
  { id: "D_p_04", candidate: "D", attribute: "Is very responsible", valence: "positive" },
];

//=== Profile X exclusive (X 참가자만 보는 8장) ===
//Candidate별 negative 2장씩 (단 C는 positive 2장 — Hidden Profile 핵심 단서)
export const xExclusiveCards: InfoCard[] = [
  {
    id: "A_n_01",
    candidate: "A",
    attribute: "Sometimes does not tolerate criticism",
    valence: "negative",
  },
  { id: "A_n_02", candidate: "A", attribute: "Is sometimes a bit hectic", valence: "negative" },
  { id: "B_n_01", candidate: "B", attribute: "Is considered to be nagging", valence: "negative" },
  {
    id: "B_n_02",
    candidate: "B",
    attribute: "Is not considered very cooperative",
    valence: "negative",
  },
  { id: "C_p_02", candidate: "C", attribute: "Is stress resistant", valence: "positive" },
  {
    id: "C_p_03",
    candidate: "C",
    attribute: "Promotes a good atmosphere within the crew",
    valence: "positive",
  },
  { id: "D_n_01", candidate: "D", attribute: "Is considered arrogant", valence: "negative" },
  {
    id: "D_n_02",
    candidate: "D",
    attribute: "Is not very well suited for leading a team",
    valence: "negative",
  },
];

//=== Profile Y exclusive (Y 참가자만 보는 8장) ===
export const yExclusiveCards: InfoCard[] = [
  { id: "A_n_03", candidate: "A", attribute: "Is considered a show-off", valence: "negative" },
  { id: "A_n_04", candidate: "A", attribute: "Is not open to new ideas", valence: "negative" },
  {
    id: "B_n_03",
    candidate: "B",
    attribute: "Has a below-average memory for numbers",
    valence: "negative",
  },
  {
    id: "B_n_04",
    candidate: "B",
    attribute: "Gossips about his/her coworkers",
    valence: "negative",
  },
  { id: "C_p_04", candidate: "C", attribute: "Is very conscientious", valence: "positive" },
  {
    id: "C_p_05",
    candidate: "C",
    attribute: "Is very skilled in dealing with complicated technology",
    valence: "positive",
  },
  {
    id: "D_n_03",
    candidate: "D",
    attribute: "Is considered to be a know-all",
    valence: "negative",
  },
  { id: "D_n_04", candidate: "D", attribute: "Is quick-tempered", valence: "negative" },
];

//=== Profile Z exclusive (Z 참가자만 보는 8장 - CTRL 조건의 3번째 인간) ===

export const zExclusiveCards: InfoCard[] = [
  { id: "A_n_05", candidate: "A", attribute: "Is unfriendly", valence: "negative" },
  { id: "A_n_06", candidate: "A", attribute: "Transmits restlessness", valence: "negative" },
  { id: "B_n_05", candidate: "B", attribute: "Is considered arrogant", valence: "negative" },
  { id: "B_n_06", candidate: "B", attribute: "Is sometimes abusive in tone", valence: "negative" },
  {
    id: "C_p_06",
    candidate: "C",
    attribute: "Puts the safety of people in his/her care above everything else",
    valence: "positive",
  },
  {
    id: "C_p_07",
    candidate: "C",
    attribute: "Performs very well in terms of sustained attention",
    valence: "positive",
  },
  { id: "D_n_05", candidate: "D", attribute: "Is considered moody", valence: "negative" },
  { id: "D_n_06", candidate: "D", attribute: "Has strong prejudices", valence: "negative" },
];

export const conditionLabel: Record<string, string> = {
  C1: "Peer + XAI",
  C2: "Leader + XAI",
  C3: "Peer + ACI",
  C4: "Leader + ACI",
  CTRL: "Control",
};
