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

const checks = [
  ["prompt snapshot 1.9.0", snapshot.sourceVersion === "1.9.0"],
  ["01 cooldown veto skips the Judge", has("src/lib/interventionEngine.ts", "deterministicVetoBeforeJudge")],
  ["02 Judge carries a role goal", has("src/lib/interventionJudge.ts", "Alex chairs this group")],
  ["03 length is a post-condition", has("src/lib/routeScopedGeneration.ts", "too_many_words")],
  ["03 reveal budget reaches generation", has("src/lib/routeTurn.ts", "revealBudget")],
  ["04 generator told what it said", has("src/lib/routeContext.ts", "Already stated by you")],
  ["05 focus outranked by salience", has("src/lib/conversationLedger.ts", 'thread.focusBasis !== "current_explicit"')],
  ["06 grounding reads the observation", has("src/lib/routeContext.ts", "taskGroundingInstructionBlock")],
  // A negative check passes when a file is missing or merely worded
  // differently, so this one is pinned to the exact expression that was there.
  ["07 thread action off the prompt", !has("src/lib/conversationLedger.ts", "foreground.requestedAction")],
  ["09 turn records its guard", has("src/models/AIIntervention.ts", "outputGuard")],
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
