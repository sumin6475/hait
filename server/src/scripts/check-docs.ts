/**
 * check-docs — structural checks on the documentation that travels with this
 * repository.
 *
 * It asserts properties a reader depends on, never prose. Section order, word
 * counts, and the content of any finding are the author's business and are
 * deliberately not checked.
 *
 * Two jobs today:
 *
 *   1. Cross-references resolve. A `§4h`-style pointer must name a section that
 *      exists, and a relative markdown link must name a file that exists.
 *   2. Nothing vanishes from the repair checkpoint unaccounted for. The
 *      migration map is a census taken before any content moved; an entry it
 *      marks `unmoved` or `partial` must still be present, and one it marks
 *      `moved` or `partial` must say where its content went.
 *
 * While the migration is in progress, sections not yet fully `moved` are
 * reported rather than failed — otherwise this would be red from the first
 * commit to the last. The ticket that rewrites the checkpoint flips
 * `enforceAllAccounted` in the map, and from then on an unaccounted section is
 * a failure.
 *
 *   3. The glossary holds terms and only terms.
 *   4. The ADRs are numbered contiguously and each has a title.
 *   5. The checkpoint's invariants are a flat list of a fixed length.
 */
import assert from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MAP_PATH = join(HERE, "docs-migration-map.json");

type MigrationEntry = {
  heading: string;
  capturedAtLine: number;
  status: "unmoved" | "partial" | "moved" | "kept";
  movedTo: string | null;
  /** Required on `partial`: what is still in the source after the move.
   *  Required on `kept`: why this section stays rather than moving. */
  remains?: string;
};
type MigrationMap = {
  source: string;
  enforceAllAccounted: boolean;
  sections: MigrationEntry[];
};

/** The documentation that travels with the repo. Files absent are skipped, so
 *  this list can name artifacts that later tickets create. */
const TRACKED_DOCS = [
  "CONVERSATION-REPAIR-CHECKPOINT.md",
  "CONTEXT.md",
  "CLAUDE.md",
  "README.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "docs/agents/domain.md",
  "docs/measurements.md",
];

function trackedDocPaths(): string[] {
  const paths = TRACKED_DOCS.map((p) => join(REPO_ROOT, p)).filter(existsSync);
  const adrDir = join(REPO_ROOT, "docs", "adr");
  if (existsSync(adrDir)) {
    for (const name of readdirSync(adrDir).filter((n) => n.endsWith(".md"))) {
      paths.push(join(adrDir, name));
    }
  }
  return paths;
}

function headings(body: string): string[] {
  return body.split("\n").filter((line) => /^#{1,6} /.test(line));
}

/** The label a `§` reference names: the leading token of a heading, so
 *  "### 4f-bis. Sixth measurement …" is addressable as §4f-bis. */
function headingLabel(heading: string): string | null {
  const title = heading.replace(/^#+\s+/, "");
  const numeric = title.match(/^(\d+[a-z-]*)\b/i);
  if (numeric) return numeric[1]!.toLowerCase();
  return null;
}

/** Documentation that must exist, not merely be checked when present. A doc
 *  joins this list in the ticket that creates it. */
const REQUIRED_DOCS = ["CONTEXT.md"];

const failures: string[] = [];
const notes: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// ── 1. Cross-references resolve ──────────────────────────────────────────────
for (const path of trackedDocPaths()) {
  const body = readFileSync(path, "utf8");
  const relative = path.slice(REPO_ROOT.length + 1);
  const labels = new Set(headings(body).map(headingLabel).filter(Boolean) as string[]);

  // Numeric section pointers. Non-numeric ones ("§ Open decisions") name a
  // heading in prose; they are matched loosely rather than left unchecked.
  for (const match of body.matchAll(/§\s?([A-Za-z0-9][A-Za-z0-9.\-]*)/g)) {
    const raw = match[1]!.replace(/[.,:;)*]+$/, "");
    if (!raw) continue;
    if (/^\d/.test(raw)) {
      check(
        labels.has(raw.toLowerCase()),
        `${relative}: §${raw} names no section in this file`,
      );
    } else {
      check(
        headings(body).some((h) => h.toLowerCase().includes(raw.toLowerCase())),
        `${relative}: §${raw} matches no heading in this file`,
      );
    }
  }

  // Relative markdown links.
  for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]!;
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [filePart] = target.split("#");
    if (!filePart) continue;
    const cleaned = filePart.replace(/:\d+$/, "");
    check(
      existsSync(resolve(dirname(path), cleaned)) || existsSync(join(REPO_ROOT, cleaned)),
      `${relative}: link target ${cleaned} does not exist`,
    );
  }
}

// ── 2. The glossary is a glossary ────────────────────────────────────────────
// Terms follow the project's glossary format: a bolded term, a colon, then the
// definition. These assertions are about the file being usable as a glossary —
// every term resolves to exactly one definition — never about which terms it
// contains or how they are worded.
for (const relative of REQUIRED_DOCS) {
  check(existsSync(join(REPO_ROOT, relative)), `${relative} is required and does not exist`);
}

const glossaryPath = join(REPO_ROOT, "CONTEXT.md");
if (existsSync(glossaryPath)) {
  const body = readFileSync(glossaryPath, "utf8");
  const lines = body.split("\n");
  const seen = new Map<string, number>();

  lines.forEach((line, index) => {
    const term = line.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
    if (!term) return;
    const name = term[1]!.trim();
    const key = name.toLowerCase();
    const inlineBody = term[2]!.trim();
    const nextLine = (lines[index + 1] ?? "").trim();

    check(
      Boolean(inlineBody) || (Boolean(nextLine) && !nextLine.startsWith("**")),
      `CONTEXT.md: "${name}" has no definition body`,
    );
    const earlier = seen.get(key);
    check(
      earlier === undefined,
      `CONTEXT.md: "${name}" is defined twice (lines ${earlier} and ${index + 1})`,
    );
    if (earlier === undefined) seen.set(key, index + 1);
  });

  check(seen.size > 0, "CONTEXT.md defines no terms");

  // A glossary and nothing else. Code fences and file paths are the mechanical
  // proxy for implementation detail leaking in — a term that can only be
  // explained by pointing at a file is not yet a domain term.
  check(!body.includes("```"), "CONTEXT.md contains a code fence");
  // Deliberately excludes a bare "client/" and "server/" prefix: "a client/server
  // split" is ordinary prose a glossary may well contain, while a real path in
  // this repo always carries one of the segments below.
  const pathLike = body.match(/\b(?:src|docs|dist|node_modules|scripts)\/[\w./-]+/);
  check(!pathLike, `CONTEXT.md names a file path: ${pathLike?.[0] ?? ""}`);
  const fileLike = body.match(/\b[\w-]+\.(?:ts|tsx|js|mjs|json|ya?ml)\b/);
  check(!fileLike, `CONTEXT.md names a file: ${fileLike?.[0] ?? ""}`);
}

// ── 3. The decision record is addressable ───────────────────────────────────
// An ADR is only useful if it can be cited, so the numbering is what is checked:
// unique, contiguous, and matching the filename. What an ADR argues is not.
const adrDir = join(REPO_ROOT, "docs", "adr");
if (existsSync(adrDir)) {
  const files = readdirSync(adrDir).filter((name) => name.endsWith(".md")).sort();
  const numbers: number[] = [];
  for (const name of files) {
    const shape = name.match(/^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
    check(Boolean(shape), `docs/adr/${name}: expected NNNN-kebab-case.md`);
    if (!shape) continue;
    numbers.push(Number(shape[1]));
    const body = readFileSync(join(adrDir, name), "utf8");
    check(
      /^(?:---\n[\s\S]*?\n---\n)?\s*# .+/m.test(body),
      `docs/adr/${name}: has no title heading`,
    );
  }
  const unique = new Set(numbers);
  check(unique.size === numbers.length, "docs/adr: duplicate ADR numbers");
  numbers.sort((a, b) => a - b);
  numbers.forEach((value, index) => {
    check(value === index + 1, `docs/adr: numbering is not contiguous from 0001 (found ${value})`);
  });
}

// ── 4. Nothing vanishes unaccounted for ──────────────────────────────────────
const map: MigrationMap = JSON.parse(readFileSync(MAP_PATH, "utf8"));
const sourcePath = join(REPO_ROOT, map.source);
assert.ok(existsSync(sourcePath), `migration map source ${map.source} is missing`);
const present = new Set(headings(readFileSync(sourcePath, "utf8")).map((h) => h.trim()));

// Three states, because two could not describe what the migration actually did.
// Every section the ADRs and the gate issues draw on gave up part of itself and
// kept the rest, and calling that `moved` is a lie the checker would have to be
// told. A `partial` entry must still be present, must say where the moved part
// went, and must say in prose what is left — so the residue is a claim someone
// wrote down rather than something a later reader has to reconstruct.
let unaccounted = 0;
for (const entry of map.sections) {
  const mustBePresent =
    entry.status === "unmoved" || entry.status === "partial" || entry.status === "kept";
  const mustNameTarget = entry.status === "moved" || entry.status === "partial";

  // `unmoved` and `partial` are both transitional: the migration is not finished
  // while either remains. `kept` is a destination, not a way station — a section
  // that was always meant to stay in the checkpoint — so it is accounted for.
  if (entry.status === "unmoved" || entry.status === "partial") unaccounted += 1;

  if (mustBePresent) {
    check(
      present.has(entry.heading),
      `${map.source}: "${entry.heading}" is gone but the migration map still calls it ${entry.status}`,
    );
  }

  if (mustNameTarget) {
    check(
      Boolean(entry.movedTo),
      `migration map: "${entry.heading}" is marked ${entry.status} but does not say where its content went`,
    );
    if (entry.movedTo) {
      check(
        existsSync(join(REPO_ROOT, entry.movedTo)),
        `migration map: "${entry.heading}" moved to ${entry.movedTo}, which does not exist`,
      );
    }
  }

  if (entry.status === "partial" || entry.status === "kept") {
    check(
      Boolean(entry.remains?.trim()),
      `migration map: "${entry.heading}" is ${entry.status} but does not say what ${
        entry.status === "kept" ? "it keeps and why" : `remains in ${map.source}`
      }`,
    );
  } else {
    check(
      entry.remains === undefined,
      `migration map: "${entry.heading}" is ${entry.status}, so it must not carry a remains note`,
    );
  }

  if (entry.status === "kept") {
    check(
      entry.movedTo === null,
      `migration map: "${entry.heading}" is kept, so it must not name a move target`,
    );
  }

  if (entry.status === "moved" && present.has(entry.heading)) {
    notes.push(`"${entry.heading}" is marked moved but is still in ${map.source}`);
  }
}

const known = new Set(map.sections.map((entry) => entry.heading));
for (const heading of present) {
  if (!known.has(heading)) notes.push(`new section not in the migration map: "${heading}"`);
}

if (map.enforceAllAccounted) {
  check(
    unaccounted === 0,
    `migration map: ${unaccounted} section(s) still unmoved or partial`,
  );
} else if (unaccounted > 0) {
  notes.push(
    `${unaccounted} of ${map.sections.length} sections still unmoved or partial (not enforced yet)`,
  );
}

// ── 5. The invariants are a flat, countable list ─────────────────────────────
// An invariant buried in a paragraph is one nobody can enumerate, and this list
// has already had an entry retired inside its own bullet. Fixing the count here
// means adding or removing one is a deliberate edit to this file, not a quiet
// edit to a document.
const EXPECTED_INVARIANTS = 8;
const INVARIANTS_HEADING = /^##\s+7\. Invariants that must not regress\s*$/;
{
  const body = readFileSync(sourcePath, "utf8").split("\n");
  const start = body.findIndex((line) => INVARIANTS_HEADING.test(line));
  check(start !== -1, `${map.source}: the invariants section is missing`);
  if (start !== -1) {
    let end = body.length;
    for (let i = start + 1; i < body.length; i += 1) {
      if (/^#{1,6} /.test(body[i]!)) {
        end = i;
        break;
      }
    }
    const section = body.slice(start + 1, end);
    const items = section.filter((line) => /^[-*] /.test(line));
    const stray = section.filter(
      (line) => line.trim() !== "" && !/^[-*] /.test(line) && !/^\s+\S/.test(line),
    );
    check(
      items.length === EXPECTED_INVARIANTS,
      `${map.source}: expected ${EXPECTED_INVARIANTS} invariants, found ${items.length} — ` +
        `if this is deliberate, change EXPECTED_INVARIANTS in this script in the same commit`,
    );
    check(
      stray.length === 0,
      `${map.source}: the invariants section has ${stray.length} line(s) outside the list; ` +
        `an invariant in a paragraph cannot be counted`,
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const note of notes) console.log(`  note: ${note}`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL: ${failure}`);
  assert.fail(`${failures.length} documentation check(s) failed`);
}
console.log("docs checks passed");
