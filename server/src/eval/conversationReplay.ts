import type { ParticipantRole } from "../types.js";
import {
  CONVERSATION_LEDGER_VERSION,
  createConversationLedgerState,
  observerDeltaFromTurn,
  reduceConversationLedger,
  type ConversationActor,
  type ConversationLedgerState,
  type ObservedTurnForLedger,
  type ReducerTransitionAudit,
} from "../lib/conversationLedger.js";

export interface ObservedReplayTurn {
  originalSeq: number;
  replaySeq: number;
  senderRole: ParticipantRole;
  observation: ObservedTurnForLedger;
  alexUptakeRootSeq?: number;
  observerConflicts?: string[];
}

export interface ConversationReplayInput {
  sessionKey: string;
  observerVersion: string;
  roster: ConversationActor[];
  turns: ObservedReplayTurn[];
}

export interface ConversationReplayTurnResult {
  originalSeq: number;
  replaySeq: number;
  stateAfter: ConversationLedgerState;
  transition: ReducerTransitionAudit;
}

/**
 * Frozen-observation replay. It intentionally has no MongoDB, wall-clock, or
 * network dependency so live and evaluation code share the exact reducer.
 */
export function replayObservedConversation(
  input: ConversationReplayInput,
): ConversationReplayTurnResult[] {
  let state = createConversationLedgerState({
    sessionKey: input.sessionKey,
    observerVersion: input.observerVersion,
    roster: input.roster,
  });
  const results: ConversationReplayTurnResult[] = [];
  for (const turn of [...input.turns].sort(
    (left, right) => left.replaySeq - right.replaySeq,
  )) {
    const delta = observerDeltaFromTurn({
      sessionKey: input.sessionKey,
      observerVersion: input.observerVersion,
      roster: input.roster,
      sourceRole: turn.senderRole,
      currentTriggerSeq: turn.replaySeq,
      contextThroughSeq: turn.replaySeq,
      observation: turn.observation,
      alexUptakeRootSeq: turn.alexUptakeRootSeq,
      observerConflicts: turn.observerConflicts,
    });
    const reduced = reduceConversationLedger(state, delta);
    state = reduced.state;
    results.push({
      originalSeq: turn.originalSeq,
      replaySeq: turn.replaySeq,
      stateAfter: state,
      transition: reduced.transition,
    });
  }
  return results;
}

export const CONVERSATION_REPLAY_SCHEMA_VERSION = `${CONVERSATION_LEDGER_VERSION}-replay-v1`;
