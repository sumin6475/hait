/**
 * Guards that can be switched off for a comparison run.
 *
 * Every flag here silences something that changes what a turn may be — four of
 * them a check that can cost Alex a turn, and the last two a reading that
 * decides what the turn is for. They exist so a
 * session can be run twice — once with a check on, once with it off — and the
 * two transcripts compared, instead of arguing from one session about whether a
 * check earns its cost. T-C4-023 lost seven of twenty-nine turns to four
 * different vetoes; which of them matter is a measurement, not an opinion.
 *
 * Two rules make this safe to keep in the tree.
 *
 * Every flag defaults to ON. An unset environment variable, a typo, and a
 * missing `.env` all produce the shipped behaviour, so a comparison run has to
 * be asked for explicitly and can never happen by accident.
 *
 * Whatever was on is written into the session record. A transcript produced
 * with a check disabled and no note of it is worse than no transcript, because
 * it reads exactly like a normal one — so `guardFlagsForRecord()` goes into the
 * intervention row and the reader can always see which build spoke.
 */

export type GuardFlagName =
  /** The post-generation scope check. Off: a message that names a fact outside the Judge's list is broadcast anyway. */
  | "outputScope"
  /** The ordinary cooldown veto. Off: Alex may take consecutive turns. */
  | "cooldown"
  /** The human-floor veto. Off: Alex may speak while a human still holds the floor. */
  | "humanFloor"
  /** Rejecting a Judge decision because its brief is missing or too long. Off: the decision stands and the brief is used as-is. */
  | "judgeBrief"
  /** Refusing to open a request addressed to Alex from an implicit proposal. Off: an ordinary opinion opens one, as before. */
  | "implicitRequest"
  /** Reading the Observer's own scope fields to authorise the exact board recap. Off: the word list has to agree, as before. */
  | "observerBoardRecap";

const ENV_KEY: Record<GuardFlagName, string> = {
  outputScope: "HAIT_GUARD_OUTPUT_SCOPE",
  cooldown: "HAIT_GUARD_COOLDOWN",
  humanFloor: "HAIT_GUARD_HUMAN_FLOOR",
  judgeBrief: "HAIT_GUARD_JUDGE_BRIEF",
  implicitRequest: "HAIT_GUARD_IMPLICIT_REQUEST",
  observerBoardRecap: "HAIT_GUARD_OBSERVER_BOARD_RECAP",
};

const ALL: GuardFlagName[] = [
  "outputScope",
  "cooldown",
  "humanFloor",
  "judgeBrief",
  "implicitRequest",
  "observerBoardRecap",
];

// "off", "0", "false", "no" all disable. Anything else — including an unset
// variable — leaves the guard on.
function readFlag(name: GuardFlagName): boolean {
  const raw = process.env[ENV_KEY[name]]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

export function guardEnabled(name: GuardFlagName): boolean {
  return readFlag(name);
}

/**
 * Put every guard back on, ignoring `.env`.
 *
 * The offline suites load `server/.env` through dotenvx, so the moment a
 * comparison run left `HAIT_GUARD_HUMAN_FLOOR=off` in that file, the ledger
 * suite started asserting the behaviour of a build nobody ships — and it did not
 * say so, it simply failed on a floor assertion with a message about floors. The
 * inverse is worse: a suite that passes only because a check was disabled reads
 * exactly like a suite that passes.
 *
 * Every test entry point calls this first. A test that wants a guard off sets it
 * afterwards, deliberately and in one visible place.
 */
export function forceGuardsOnForTest(): void {
  for (const key of Object.values(ENV_KEY)) delete process.env[key];
}

/** The guards currently switched off, for the session and intervention records. Empty on a normal run. */
export function disabledGuards(): GuardFlagName[] {
  return ALL.filter((name) => !readFlag(name));
}

/** A one-line description for the startup log, so a comparison build announces itself. */
export function guardFlagsSummary(): string | null {
  const off = disabledGuards();
  return off.length
    ? `COMPARISON BUILD — guards disabled: ${off.map((name) => `${name} (${ENV_KEY[name]})`).join(", ")}`
    : null;
}
