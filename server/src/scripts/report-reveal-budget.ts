import "dotenv/config";
import mongoose from "mongoose";
import { config } from "../config.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { Session } from "../models/Session.js";
import { contributesToBoard } from "../types.js";

/**
 * [Issue 23] How often a delivered message broke the bound its turn was given,
 * per session and per condition.
 *
 * The reveal budget is what keeps Alex's disclosure rate comparable across
 * conditions, so a breach of it is a threat to the one property every change
 * has to preserve. It was never counted, because until this issue the turn left
 * behind only the guard's pre-broadcast evidence — there was nothing to compare
 * the delivered message against.
 *
 * Trait ids and counts only. No message content and no participant text is read
 * or printed here; session exports are where transcripts live.
 */

const REPORTED = [
  "too_many_traits",
  "too_many_restated_traits",
  "trait_outside_selected_contribution",
  "trait_outside_current_candidate",
  "selected_trait_missing",
  "new_trait_in_mediation",
] as const;

interface Tally {
  spokenTurns: number;
  guardedTurns: number;
  /** Turns the guard refused before the broadcast. The bound worked. */
  blockedBeforeBroadcast: number;
  /** Turns whose delivered message broke a bound. The bound did not work. */
  brokenAfterBroadcast: number;
  /** Turns where the guard's evidence and the delivered message disagree. */
  recordCorrected: number;
  /**
   * Turns that can carry a record and do not — written before this record
   * existed. The four routes that never pool are excluded rather than counted
   * here: a summary recites the board and is not a contribution, so it has
   * nothing to record and its absence is not a gap.
   */
  unrecorded: number;
  /** Spoken turns on a route that never pools, and so never records. */
  nonPooling: number;
  byViolation: Record<string, number>;
}

const emptyTally = (): Tally => ({
  spokenTurns: 0,
  guardedTurns: 0,
  blockedBeforeBroadcast: 0,
  brokenAfterBroadcast: 0,
  recordCorrected: 0,
  unrecorded: 0,
  nonPooling: 0,
  byViolation: {},
});

function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...new Set(a ?? [])].sort();
  const right = [...new Set(b ?? [])].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

await mongoose.connect(config.mongodbUri);

const onlySession = process.argv[2];
const sessions = await Session.find(onlySession ? { sessionCode: onlySession } : {})
  .select("sessionCode conditionCode")
  .lean();
const byId = new Map(sessions.map((s) => [String(s._id), s]));

const perSession = new Map<string, Tally>();
const perCondition = new Map<string, Tally>();

const rows = await AIIntervention.find({
  sessionId: { $in: sessions.map((s) => s._id) },
  decision: "speak",
})
  .select("sessionId outcome routeKind outputGuard surfacedTraitIds postBroadcastViolation")
  .lean();

for (const row of rows) {
  const session = byId.get(String(row.sessionId));
  if (!session) continue;
  const guard = (row as any).outputGuard as
    | { inForce?: boolean; violation?: string; traitIds?: string[] }
    | undefined;
  const surfaced = (row as any).surfacedTraitIds as string[] | undefined;
  const broken = (row as any).postBroadcastViolation as string | undefined;
  const spoke = row.outcome === "broadcast";
  // Kept in step with the pooling condition in `routeTurn.ts`. These routes
  // recite the board rather than contribute to it and are not counted.
  const pools = contributesToBoard(String((row as any).routeKind));

  for (const tally of [
    perSession.get(session.sessionCode) ??
      perSession.set(session.sessionCode, emptyTally()).get(session.sessionCode)!,
    perCondition.get(session.conditionCode) ??
      perCondition.set(session.conditionCode, emptyTally()).get(session.conditionCode)!,
  ]) {
    if (spoke) tally.spokenTurns += 1;
    if (guard?.inForce) tally.guardedTurns += 1;
    if (!spoke && guard?.violation) {
      tally.blockedBeforeBroadcast += 1;
      tally.byViolation[guard.violation] = (tally.byViolation[guard.violation] ?? 0) + 1;
    }
    if (spoke && broken) {
      tally.brokenAfterBroadcast += 1;
      tally.byViolation[broken] = (tally.byViolation[broken] ?? 0) + 1;
    }
    if (spoke && !pools) tally.nonPooling += 1;
    else if (spoke && surfaced === undefined) tally.unrecorded += 1;
    else if (spoke && !sameIds(surfaced, guard?.traitIds)) tally.recordCorrected += 1;
  }
}

function print(title: string, tallies: Map<string, Tally>) {
  console.log(`\n## ${title}`);
  const keys = [...tallies.keys()].sort();
  if (!keys.length) return void console.log("  (nothing)");
  for (const key of keys) {
    const t = tallies.get(key)!;
    console.log(
      `  ${key.padEnd(12)} spoken=${t.spokenTurns} guarded=${t.guardedTurns} ` +
        `blocked=${t.blockedBeforeBroadcast} broken=${t.brokenAfterBroadcast} ` +
        `corrected=${t.recordCorrected} unrecorded=${t.unrecorded} ` +
        `non-pooling=${t.nonPooling}`,
    );
    const named = REPORTED.filter((name) => t.byViolation[name]);
    const other = Object.keys(t.byViolation).filter(
      (name) => !(REPORTED as readonly string[]).includes(name),
    );
    for (const name of [...named, ...other.sort()]) {
      console.log(`${"".padEnd(16)}${name}: ${t.byViolation[name]}`);
    }
  }
}

console.log(
  `# Reveal budget, ${rows.length} spoken-decision turns across ${sessions.length} session(s)`,
);
console.log(
  "\nblocked   = the guard refused the draft before the broadcast; the turn was spent\n" +
    "broken    = the delivered message broke a bound, found after the fact; recorded only\n" +
    "corrected = the delivered message carried traits the guard's evidence did not name\n" +
    "unrecorded  = turn that should carry a record and does not; written before this existed\n" +
    "non-pooling = summary, closing, greeting or backchannel; recites rather than contributes",
);
print("Per condition", perCondition);
print("Per session", perSession);

await mongoose.disconnect();
