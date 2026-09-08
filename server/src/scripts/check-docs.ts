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
 *      marks `unmoved` must still be present, and one it marks `moved` must say
 *      where it went.
 *
 * While the migration is in progress, sections still marked `unmoved` are
 * reported rather than failed — otherwise this would be red from the first
 * commit to the last. The ticket that rewrites the checkpoint flips
 * `enforceAllAccounted` in the map, and from then on an unaccounted section is
 * a failure.
 *
 * Later tickets add the glossary, ADR and invariant assertions here.
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
  status: "unmoved" | "moved";
  movedTo: string | null;
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

let unmoved = 0;
for (const entry of map.sections) {
  if (entry.status === "unmoved") {
    unmoved += 1;
    check(
      present.has(entry.heading),
      `${map.source}: "${entry.heading}" is gone but the migration map still calls it unmoved`,
    );
    continue;
  }
  check(
    Boolean(entry.movedTo),
    `migration map: "${entry.heading}" is marked moved but does not say where`,
  );
  if (entry.movedTo) {
    check(
      existsSync(join(REPO_ROOT, entry.movedTo)),
      `migration map: "${entry.heading}" moved to ${entry.movedTo}, which does not exist`,
    );
  }
  if (present.has(entry.heading)) {
    notes.push(`"${entry.heading}" is marked moved but is still in ${map.source}`);
  }
}

const known = new Set(map.sections.map((entry) => entry.heading));
for (const heading of present) {
  if (!known.has(heading)) notes.push(`new section not in the migration map: "${heading}"`);
}

if (map.enforceAllAccounted) {
  check(unmoved === 0, `migration map: ${unmoved} section(s) still unmoved`);
} else if (unmoved > 0) {
  notes.push(`${unmoved} of ${map.sections.length} sections still unmoved (not enforced yet)`);
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const note of notes) console.log(`  note: ${note}`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL: ${failure}`);
  assert.fail(`${failures.length} documentation check(s) failed`);
}
console.log("docs checks passed");
