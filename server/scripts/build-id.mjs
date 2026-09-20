// Which build is in this directory — run it before starting a session.
//
// A session costs money and cannot be re-run, and T-C2-043 was spent on a build
// that had none of the work it was meant to measure: the server ran from a
// checkout the commits had never reached, and nothing said so until the export
// was read afterwards. This says so beforehand, in one command, from the files
// the server will actually load.
//
// It reads source, not a version string someone remembered to bump.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => {
  const full = resolve(serverDir, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
const has = (relativePath, needle) => read(relativePath).includes(needle);

const snapshot = (() => {
  try {
    return JSON.parse(read("src/prompts/route-prompts.snapshot.v1.json"));
  } catch {
    return {};
  }
})();

// The snapshot is compared with the source it was compiled from, not with a
// version written here. A pinned "1.9.0" outlived two prompt bumps and called
// the correct build old.
const sourceVersion = read("src/prompts/blocks/index.ts").match(/export const VERSION = "([^"]+)"/)?.[1];

const checks = [
  [
    `prompt snapshot compiled from its source (${sourceVersion ?? "source missing"})`,
    Boolean(sourceVersion) && snapshot.sourceVersion === sourceVersion,
  ],
  ["01 cooldown veto skips the Judge", has("src/lib/interventionEngine.ts", "deterministicVetoBeforeJudge")],
  ["02 Judge carries a role goal", has("src/lib/interventionJudge.ts", "Alex chairs this group")],
  // Issue 03's length and reveal-budget bounds went with docs/adr/0010. What a
  // turn may put on the board is now the list the Judge names.
  ["ADR 0010 the Judge names what a turn may spend", has("src/lib/routeScopedGeneration.ts", "trait_outside_selected_contribution")],
  ["04 generator told what it said", has("src/lib/routeContext.ts", "Already stated by you")],
  ["05 focus outranked by salience", has("src/lib/conversationLedger.ts", 'thread.focusBasis !== "current_explicit"')],
  ["06 grounding reads the observation", has("src/lib/routeContext.ts", "taskGroundingInstructionBlock")],
  // A negative check passes when a file is missing or merely worded
  // differently, so this one is pinned to the exact expression that was there.
  ["07 thread action off the prompt", !has("src/lib/conversationLedger.ts", "foreground.requestedAction")],
  ["09 turn records its guard", has("src/models/AIIntervention.ts", "outputGuard")],
  // What the next session is run to measure.
  ["28 an opinion is not a request", has("src/lib/conversationLedger.ts", "proposalOpensRequest")],
  ["ADR 0011 the list counts what the humans pooled", has("src/lib/candidateList.ts", "humanPooledIds")],
  ["ADR 0012 the Chair recaps as an act", has("src/lib/interventionEngine.ts", "recapAvailableFor")],
  ["the Judge replies to what was said since Alex spoke", has("src/lib/interventionJudge.ts", "humanMessagesSinceAlexSpoke")],
  ["the board records the given note and what Alex said", has("src/lib/routeTurn.ts", "[contributedTraitId, ...broadcastExtraction.acceptedIds]")],
  // S-C2-002, the first live session.
  ["a direct reply invents no procedure", has("src/lib/routeContext.ts", "do not propose an exercise, role-play, vote, or decision procedure of your own")],
  ["the Chair is offered the mediation move", has("src/lib/interventionEngine.ts", "mediationAvailableFor")],
  ["one name per arrogance claim", has("src/lib/poolingExtractor.ts", "SHARED_PHRASE_TRAIT_IDS")],
  // S-C4-003.
  ["a stray letter is not a candidate the room is on", has("src/lib/interventionRoutingV2.ts", "const dominant = [...mentions.values()]")],
  ["nobody is asked for evidence outside the notes", has("src/lib/routeContext.ts", "Nobody here has an example, an incident, an anecdote")],
  ["a spent card asks the group for theirs", has("src/lib/interventionJudge.ts", "A turn with nothing left of its own asks the group for theirs")],
];

const width = Math.max(...checks.map(([label]) => label.length));
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(width)}`);
}
const failed = checks.filter(([, ok]) => !ok);
console.log(`\n  dir    ${serverDir}`);
console.log(
  failed.length
    ? `\n  ✗ OLD BUILD — ${failed.length} of ${checks.length} missing. Do not start a session.\n`
    : "\n  ✓ current build — safe to run a session.\n",
);
process.exit(failed.length ? 1 : 0);
