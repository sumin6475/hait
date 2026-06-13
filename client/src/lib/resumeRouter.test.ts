//resumeRouter 게이트 분기 테스트 (Step 32)
//핵심 회귀: rule 1.5 (in_progress → /chat/room) 무수정 확인 + 6게이트 hold/직행 분기

import { describe, expect, it } from "vitest";
import type { ParticipantState, ProgressState } from "./api";
import type { GateApprovals } from "./gates";
import { resolveResumePath } from "./resumeRouter";

function buildState(overrides: {
  progress?: ProgressState;
  approvals?: GateApprovals;
  sessionStatus?: ParticipantState["sessionStatus"];
  completedAt?: string | null;
}): ParticipantState {
  return {
    participantCode: "T-C1-001-X",
    role: "humanX",
    assignedProfile: "X",
    sessionCode: "T-C1-001",
    conditionCode: "C1",
    sessionStatus: overrides.sessionStatus ?? "waiting",
    progress: overrides.progress ?? {},
    completedAt: overrides.completedAt ?? null,
    approvals: overrides.approvals,
  };
}

describe("resolveResumePath (Step 32 gates)", () => {
  it("rule 1.5: in_progress → /chat/room (progress 무관 — 회귀 핵심)", () => {
    expect(
      resolveResumePath(buildState({ sessionStatus: "in_progress", progress: { waiting: true } })),
    ).toBe("/chat/room");
    expect(resolveResumePath(buildState({ sessionStatus: "in_progress" }))).toBe("/chat/room");
  });

  it("completedAt 존재 → /chat/complete", () => {
    expect(resolveResumePath(buildState({ completedAt: "2026-06-12T00:00:00Z" }))).toBe(
      "/chat/complete",
    );
  });

  it("G1: 신규 → hold/consent, 승인 시 직행", () => {
    expect(resolveResumePath(buildState({}))).toBe("/chat/hold/consent");
    expect(resolveResumePath(buildState({ approvals: { consent: "2026-06-12" } }))).toBe(
      "/chat/consent",
    );
  });

  it("G2: consent 완료 → hold/demographics, 승인 시 직행", () => {
    const progress = { consent: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/demographics");
    expect(
      resolveResumePath(buildState({ progress, approvals: { demographics: "2026-06-12" } })),
    ).toBe("/chat/demographics");
  });

  it("G3: demographics 완료 → hold/infoCards, 승인 시 직행", () => {
    const progress = { consent: true, demographics: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/infoCards");
    expect(
      resolveResumePath(buildState({ progress, approvals: { infoCards: "2026-06-12" } })),
    ).toBe("/chat/info-cards");
  });

  it("infoCards 완료 → /chat/pre-discussion (게이트 없음)", () => {
    expect(
      resolveResumePath(
        buildState({ progress: { consent: true, demographics: true, infoCards: true } }),
      ),
    ).toBe("/chat/pre-discussion");
  });

  it("G4: preDiscussion 완료 → hold/waiting, 승인 시 직행", () => {
    const progress = { consent: true, demographics: true, infoCards: true, preDiscussion: true };
    expect(resolveResumePath(buildState({ progress }))).toBe("/chat/hold/waiting");
    expect(resolveResumePath(buildState({ progress, approvals: { waiting: "2026-06-12" } }))).toBe(
      "/chat/waiting",
    );
  });

  it("G6: completed + postSurvey 완료 → hold/debrief, 승인 시 직행", () => {
    const progress = { teamDecision: true, postSurvey: true };
    expect(resolveResumePath(buildState({ sessionStatus: "completed", progress }))).toBe(
      "/chat/hold/debrief",
    );
    expect(
      resolveResumePath(
        buildState({ sessionStatus: "completed", progress, approvals: { debrief: "2026-06-12" } }),
      ),
    ).toBe("/chat/debrief");
  });

  it("completed + postSurvey 미완 → /chat/post-survey (게이트 없음)", () => {
    expect(
      resolveResumePath(
        buildState({ sessionStatus: "completed", progress: { teamDecision: true } }),
      ),
    ).toBe("/chat/post-survey");
    expect(resolveResumePath(buildState({ sessionStatus: "completed", progress: {} }))).toBe(
      "/chat/team-decision",
    );
  });
});
